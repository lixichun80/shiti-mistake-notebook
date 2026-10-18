#!/usr/bin/env bash
# 拾题 · 智能错题本 —— 服务器更新脚本
#
# 用法：ssh server-198 "/opt/shiti-mistake-notebook/deploy.sh"
#
# 首次部署需要先手动完成两件事（见 AGENTS.md 部署章节）：
#   1. 写好 .dev.vars（DeepSeek 密钥 + SESSION_SECRET）与 .deploy.vars（播种账号），权限均 600
#   2. pm2 start ecosystem.config.cjs
set -euo pipefail

REPO=/opt/shiti-mistake-notebook
NODE_BIN=/root/.nvm/versions/node/v24.18.0/bin
PORT=3105
WRANGLER_CFG=dist/server/wrangler.json
PERSIST=.wrangler/state
DB=site-creator-d1

export PATH="$NODE_BIN:$PATH"
cd "$REPO"

fail() { echo "  ✗ $1"; exit 1; }
pass() { echo "  ✓ $1"; }

echo "==> 拉取最新代码"
git fetch --prune origin
git reset --hard origin/main
git log --oneline -1

# 配置检查放在构建之前：构建要 5–8 分钟，缺配置没必要等那么久才知道
echo "==> 检查部署配置"
for file in .dev.vars .deploy.vars; do
  [ -f "$REPO/$file" ] || fail "缺少 $file"
  chmod 600 "$REPO/$file"
done

set -a
. "$REPO/.dev.vars"
. "$REPO/.deploy.vars"
set +a

[ -n "${SESSION_SECRET:-}" ] || fail ".dev.vars 缺少 SESSION_SECRET"
[ "${#SESSION_SECRET}" -ge 32 ] || fail "SESSION_SECRET 短于 32 字符"
[ -n "${SHITI_BOOTSTRAP_USER:-}" ] || fail ".deploy.vars 缺少 SHITI_BOOTSTRAP_USER"
[ -n "${SHITI_BOOTSTRAP_PASSWORD:-}" ] || fail ".deploy.vars 缺少 SHITI_BOOTSTRAP_PASSWORD"
# 打开它等于谁手工加一个 oai-authenticated-user-id 请求头就能进后台
[ "${TRUST_OAI_HEADERS:-}" != "1" ] || fail "生产环境禁止 TRUST_OAI_HEADERS=1"
pass "配置齐备"

echo "==> 安装依赖"
npm run install:ci

echo "==> 构建"
npm run build

test -f "$REPO/dist/server/index.js" || fail "构建产物 dist/server/index.js 缺失"
test -f "$REPO/$WRANGLER_CFG" || fail "wrangler 配置缺失"

d1() { npx wrangler d1 execute "$DB" --config "$WRANGLER_CFG" --local --persist-to "$PERSIST" "$@"; }

echo "==> 应用数据库迁移"
# 迁移文件保持原样，执行前用 sed 改写成可重复执行的形式。
# 只覆盖 CREATE TABLE / CREATE [UNIQUE] INDEX：SQLite 的 ALTER TABLE 没有
# IF NOT EXISTS，遇到就中止，免得第二次部署静默失败却看不出来。
ls drizzle/*.sql > /dev/null 2>&1 || fail "drizzle/ 下没有迁移文件"
for migration in drizzle/*.sql; do
  if grep -qi 'ALTER TABLE' "$migration"; then
    fail "$migration 含 ALTER TABLE，sed 无法改成幂等，需要人工处理"
  fi
  sed -e 's/--> statement-breakpoint//' \
      -e 's/^CREATE TABLE `/CREATE TABLE IF NOT EXISTS `/' \
      -e 's/^CREATE UNIQUE INDEX `/CREATE UNIQUE INDEX IF NOT EXISTS `/' \
      -e 's/^CREATE INDEX `/CREATE INDEX IF NOT EXISTS `/' \
      "$migration" > /tmp/shiti-mig.sql
  d1 --file /tmp/shiti-mig.sql > /dev/null
  pass "已应用 $migration"
done
rm -f /tmp/shiti-mig.sql

echo "==> 播种登录账号"
# INSERT OR IGNORE 幂等；密码只经环境变量传给 node，不进命令行参数（ps 对所有人可见）
node scripts/seed-user.mjs > /tmp/shiti-seed.sql
d1 --file /tmp/shiti-seed.sql > /dev/null
rm -f /tmp/shiti-seed.sql
pass "账号 $SHITI_BOOTSTRAP_USER 就绪"

# 播种完就不再需要明文密码；留着会被 pm2 --update-env 带进应用进程环境
BOOTSTRAP_USER="$SHITI_BOOTSTRAP_USER"
BOOTSTRAP_PASSWORD="$SHITI_BOOTSTRAP_PASSWORD"
unset SHITI_BOOTSTRAP_PASSWORD

echo "==> 重启应用"
if pm2 describe shiti-notebook > /dev/null 2>&1; then
  pm2 restart shiti-notebook --update-env
else
  pm2 start ecosystem.config.cjs
fi

echo "==> 等待就绪"
ready=0
for _ in $(seq 1 30); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/status" || true)" = "200" ]; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" = "1" ] || fail "应用未在 60 秒内就绪"

echo "==> 验证"
status=$(curl -s "http://127.0.0.1:$PORT/api/status")
case "$status" in
  *'"aiConfigured":true'*) pass "/api/status $status" ;;
  *) fail "DeepSeek 密钥未生效：$status" ;;
esac

# 登录页必须匿名可访问，否则会变成「要先登录才能看到登录页」
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login")
[ "$code" = "200" ] || fail "/login 匿名访问返回 $code，应为 200"
pass "/login 匿名可访问"

# 未登录必须 401
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/mistakes")
[ "$code" = "401" ] || fail "匿名 /api/mistakes 返回 $code，应为 401"
pass "/api/mistakes 匿名被拒"

# 伪造平台身份头也必须 401。这是「加个请求头就绕过登录」的回归测试，别删。
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'oai-authenticated-user-id: shiti' \
  -H 'oai-authenticated-user-email: shiti@shiti.local' \
  "http://127.0.0.1:$PORT/api/mistakes")
[ "$code" = "401" ] || fail "伪造 oai-* 请求头竟被放行（$code），登录可被绕过"
pass "伪造 oai-* 请求头被拒"

body=$(mktemp)
jar=$(mktemp)
trap 'rm -f "$body" "$jar"' EXIT

SHITI_TEST_USER="$BOOTSTRAP_USER" SHITI_TEST_PASSWORD="definitely-not-the-password" \
  node -e 'process.stdout.write(JSON.stringify({username:process.env.SHITI_TEST_USER,password:process.env.SHITI_TEST_PASSWORD}))' > "$body"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  --data-binary "@$body" "http://127.0.0.1:$PORT/api/auth/login")
[ "$code" = "401" ] || fail "错误密码登录返回 $code，应为 401"
pass "错误密码被拒"

SHITI_TEST_USER="$BOOTSTRAP_USER" SHITI_TEST_PASSWORD="$BOOTSTRAP_PASSWORD" \
  node -e 'process.stdout.write(JSON.stringify({username:process.env.SHITI_TEST_USER,password:process.env.SHITI_TEST_PASSWORD}))' > "$body"
code=$(curl -s -o /dev/null -w '%{http_code}' -c "$jar" -H 'Content-Type: application/json' \
  --data-binary "@$body" "http://127.0.0.1:$PORT/api/auth/login")
[ "$code" = "200" ] || fail "正确密码登录返回 $code，应为 200"
grep -q 'shiti_session' "$jar" || fail "登录成功却没有下发 shiti_session cookie"
pass "登录成功并下发会话"

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "http://127.0.0.1:$PORT/api/mistakes")
[ "$code" = "200" ] || fail "带会话请求 /api/mistakes 返回 $code，应为 200"
pass "带会话可读错题本"

# 登出只断言「响应清除了 cookie」。会话是无状态的，旧 token 在过期前依然有效，
# 所以不能断言「旧 cookie 立刻失效」——那会误报。
headers=$(curl -s -D - -o /dev/null -b "$jar" -X POST "http://127.0.0.1:$PORT/api/auth/logout")
if ! printf '%s' "$headers" | grep -qiE '^set-cookie: *shiti_session=;.*(max-age=0|expires=)'; then
  fail "登出未清除会话 cookie"
fi
pass "登出清除会话 cookie"

echo "==> 部署完成"

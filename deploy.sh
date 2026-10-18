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
# drizzle/*.sql 每次部署都全量重放（没有「已应用」记录表），所以每条语句都必须幂等。
# CREATE TABLE / CREATE INDEX 由 apply-migration.mjs 补上 IF NOT EXISTS；
# ALTER TABLE ADD COLUMN 没有 IF NOT EXISTS 可用，靠「先导出库结构，列已存在就丢掉这条」补。
# 代价是迁移文件**只能追加，不能改**——改了已发布的文件，结构快照跟它对不上，
# 判断就会失准。要改结构请加新文件。详见 AGENTS.md。
ls drizzle/*.sql > /dev/null 2>&1 || fail "drizzle/ 下没有迁移文件"

SCHEMA_JSON=/tmp/shiti-schema.json
MIG_DIR=/tmp/shiti-mig
rm -rf "$MIG_DIR"
mkdir -p "$MIG_DIR"

export SHITI_D1_DB="$DB" SHITI_WRANGLER_CFG="$WRANGLER_CFG" SHITI_PERSIST="$PERSIST"
node scripts/dump-schema.mjs > "$SCHEMA_JSON" || fail "导出库结构失败"
node scripts/apply-migration.mjs --schema "$SCHEMA_JSON" --out "$MIG_DIR" drizzle/*.sql \
  || fail "迁移预处理失败（见上面的原因）"

for migration in drizzle/*.sql; do
  prepared="$MIG_DIR/$(basename "$migration")"
  # 没有待执行语句就不送去 d1，省一次 workerd 启动
  if [ ! -s "$prepared" ]; then
    pass "$migration 已是最新"
    continue
  fi
  d1 --file "$prepared" > /dev/null || fail "$migration 执行失败"
  pass "已应用 $migration"
done
rm -rf "$MIG_DIR"

# 复查新列真的落库了。apply-migration 是「看结构决定跳过哪些 ADD COLUMN」，
# 万一结构导出拿错了库，它会把该执行的 ALTER 也跳掉，而且**不报错**——那样
# 库就少一列，后面所有断言照样全绿，直到线上登录才炸。这条断言专门堵这个洞。
node scripts/dump-schema.mjs > "$SCHEMA_JSON" || fail "复查库结构失败"
SHITI_SCHEMA_JSON="$SCHEMA_JSON" node -e '
const fs = require("node:fs");
const schema = JSON.parse(fs.readFileSync(process.env.SHITI_SCHEMA_JSON, "utf8"));
const missing = ["role", "status", "session_epoch", "last_login_at"]
  .filter((col) => !(schema.users || []).includes(col));
if (missing.length) {
  console.error("users 表缺少列：" + missing.join("、"));
  process.exit(1);
}
' || fail "迁移没有真正生效，users 表缺少新列"
rm -f "$SCHEMA_JSON"
pass "users 表新列已就位"

echo "==> 播种登录账号"
# INSERT OR IGNORE 幂等；密码只经环境变量传给 node，不进命令行参数（ps 对所有人可见）
node scripts/seed-user.mjs > /tmp/shiti-seed.sql
d1 --file /tmp/shiti-seed.sql > /dev/null
rm -f /tmp/shiti-seed.sql
pass "账号 $SHITI_BOOTSTRAP_USER 就绪"

# seed-user.mjs 用 INSERT OR IGNORE，已存在的账号不会因为部署而变成管理员，
# 所以这里补一条。限定条件是「系统里一个管理员都没有」：既保证永远进得去后台，
# 又不会覆盖管理员在后台主动做的降级（只要还有别的 admin 在，这条就什么都不做）。
SHITI_BOOTSTRAP_ID="${SHITI_BOOTSTRAP_ID:-shiti}"
case "$SHITI_BOOTSTRAP_ID" in
  "" | *[!A-Za-z0-9_-]*) fail "SHITI_BOOTSTRAP_ID 含非法字符：$SHITI_BOOTSTRAP_ID" ;;
esac
printf "UPDATE users SET role='admin' WHERE id='%s' AND NOT EXISTS (SELECT 1 FROM users WHERE role='admin');\n" \
  "$SHITI_BOOTSTRAP_ID" > /tmp/shiti-admin.sql
d1 --file /tmp/shiti-admin.sql > /dev/null
rm -f /tmp/shiti-admin.sql
pass "管理员账号已就位"

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
testjar=$(mktemp)
TEST_USER=deploycheck
TEST_PASSWORD="deploycheck-$(date +%s)"

# 下面的注册验证会**真的建一个账号**。无论成功还是中途 fail 退出，都必须清掉，
# 否则它会一直挂在客户的后台账号列表里，而且每部署一次就多一个。
# 直接走 SQL 而不是调删除接口：失败退出时手里未必有可用的管理员 cookie。
cleanup() {
  rm -f "$body" "$jar" "$testjar"
  # 顺序不能变，也不能把 users 塞进上面那个循环：users 没有 user_id 列，
  # 多一条报错语句会让 db.batch() 整个事务回滚，三条都白删。
  : > /tmp/shiti-testclean.sql
  for table in mistakes uploads; do
    printf "DELETE FROM %s WHERE user_id IN (SELECT id FROM users WHERE username='%s');\n" \
      "$table" "$TEST_USER" >> /tmp/shiti-testclean.sql
  done
  printf "DELETE FROM users WHERE username='%s';\n" "$TEST_USER" >> /tmp/shiti-testclean.sql
  d1 --file /tmp/shiti-testclean.sql > /dev/null 2>&1 || true
  rm -f /tmp/shiti-testclean.sql
}
trap cleanup EXIT

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

# 回归测试：这次改动给会话载荷加了 ep 字段。老 cookie 里没有这个字段，必须按 0 处理
# （见 lib/auth.ts 的 normalizeEpoch）。要是写成直接比对 payload.ep === row.session_epoch，
# undefined !== 0 恒真，**所有存量登录会在发版瞬间全部失效**——而上面那些断言一条都不会变红，
# 因为它们用的都是这次新签发的 cookie。这里手工签一张「没有 ep 的旧 cookie」验一下。
LEGACY_COOKIE=$(SHITI_SECRET="$SESSION_SECRET" SHITI_UID="$SHITI_BOOTSTRAP_ID" node -e '
const { createHmac } = require("node:crypto");
const b64url = (buffer) => Buffer.from(buffer).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const payload = {
  v: 1,
  uid: process.env.SHITI_UID,
  name: "legacy-check",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const body = b64url(JSON.stringify(payload));
const signature = createHmac("sha256", process.env.SHITI_SECRET).update(body).digest();
process.stdout.write(body + "." + b64url(signature));
')
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: shiti_session=$LEGACY_COOKIE" \
  "http://127.0.0.1:$PORT/api/mistakes")
[ "$code" = "200" ] || fail "不含 ep 的旧格式会话被拒（$code），存量登录会全部失效"
pass "旧格式会话 cookie 仍然有效"

echo "==> 验证注册与后台"

# 注册页必须匿名可访问，理由同 /login
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/register")
[ "$code" = "200" ] || fail "/register 匿名访问返回 $code，应为 200"
pass "/register 匿名可访问"

SHITI_TEST_USER="$TEST_USER" SHITI_TEST_PASSWORD="$TEST_PASSWORD" \
  node -e 'process.stdout.write(JSON.stringify({username:process.env.SHITI_TEST_USER,password:process.env.SHITI_TEST_PASSWORD,displayName:"部署验证"}))' > "$body"
code=$(curl -s -o /dev/null -w '%{http_code}' -c "$testjar" -H 'Content-Type: application/json' \
  --data-binary "@$body" "http://127.0.0.1:$PORT/api/auth/register")
[ "$code" = "200" ] || fail "注册接口返回 $code，应为 200"
grep -q 'shiti_session' "$testjar" || fail "注册成功却没有下发 shiti_session cookie"
pass "注册成功并下发会话"

# 唯一性靠 users_username_unique 索引兜底，不是「先查再插」——那样有竞态
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  --data-binary "@$body" "http://127.0.0.1:$PORT/api/auth/register")
[ "$code" = "409" ] || fail "重复用户名注册返回 $code，应为 409"
pass "重复用户名被拒"

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$testjar" "http://127.0.0.1:$PORT/api/mistakes")
[ "$code" = "200" ] || fail "新注册账号读错题本返回 $code，应为 200"
pass "新账号可读错题本"

# 后台接口必须区分「没登录」（401）和「登录了但不是管理员」（403）。
# 403 这条尤其别删：只判有没有登录、忘了判 role 的话，任何注册用户都能删别人的号。
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/admin/users")
[ "$code" = "401" ] || fail "匿名访问 /api/admin/users 返回 $code，应为 401"
pass "后台接口匿名被拒"

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$testjar" "http://127.0.0.1:$PORT/api/admin/users")
[ "$code" = "403" ] || fail "普通用户访问 /api/admin/users 返回 $code，应为 403（越权！）"
pass "后台接口普通用户被拒（403）"

list=$(curl -s -b "$jar" "http://127.0.0.1:$PORT/api/admin/users")
case "$list" in
  *"$TEST_USER"*) pass "管理员可读取账号列表" ;;
  *) fail "管理员读到的列表里没有刚注册的 $TEST_USER：$list" ;;
esac

code=$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "http://127.0.0.1:$PORT/admin")
[ "$code" = "200" ] || fail "管理员访问 /admin 返回 $code，应为 200"
pass "/admin 管理员可访问"

# 后台页面本身也要挡住普通用户：requireAdmin 走的是 redirect，不是 403，
# 所以断言「不是 200」而不是具体状态码。用 -L 会跟到 /login 变成 200，别加。
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$testjar" "http://127.0.0.1:$PORT/admin")
[ "$code" != "200" ] || fail "普通用户竟能打开 /admin 页面（200），越权"
pass "/admin 普通用户被挡"

echo "==> 部署完成"

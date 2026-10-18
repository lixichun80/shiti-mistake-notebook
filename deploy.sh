#!/usr/bin/env bash
# 拾题 · 智能错题本 —— 服务器更新脚本
#
# 用法：ssh server-198 "/opt/shiti-mistake-notebook/deploy.sh"
#
# 首次部署需要先手动完成两件事（见 README 部署章节）：
#   1. 写入 .dev.vars（DeepSeek 密钥，权限 600）
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

echo "==> 拉取最新代码"
git fetch --prune origin
git reset --hard origin/main
git log --oneline -1

echo "==> 安装依赖"
npm run install:ci

echo "==> 构建"
npm run build

# 构建失败时 dist/ 会残留旧产物，不检查就会把「构建挂了但旧页面还在」误报成部署成功
test -f "$REPO/dist/server/index.js" || { echo "构建产物缺失，中止"; exit 1; }
test -f "$REPO/$WRANGLER_CFG" || { echo "wrangler 配置缺失，中止"; exit 1; }

echo "==> 应用数据库迁移"
# 加 IF NOT EXISTS 使其可重复执行；原始迁移文件保持不动
sed -e 's/--> statement-breakpoint//' \
    -e 's/^CREATE TABLE `/CREATE TABLE IF NOT EXISTS `/' \
    drizzle/0000_sad_starjammers.sql > /tmp/shiti-mig.sql
npx wrangler d1 execute "$DB" --config "$WRANGLER_CFG" --local --persist-to "$PERSIST" --file /tmp/shiti-mig.sql > /dev/null

echo "==> 密钥检查"
test -f "$REPO/.dev.vars" || { echo "缺少 .dev.vars（DeepSeek 密钥），中止"; exit 1; }
chmod 600 "$REPO/.dev.vars"

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
[ "$ready" = "1" ] || { echo "应用未在 60 秒内就绪"; exit 1; }

echo "==> 验证"
status=$(curl -s "http://127.0.0.1:$PORT/api/status")
echo "  /api/status          $status"
case "$status" in
  *'"aiConfigured":true'*) ;;
  *) echo "DeepSeek 密钥未生效，部署异常"; exit 1 ;;
esac

# 未登录必须 401，确认鉴权链路仍然生效
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/mistakes")
echo "  /api/mistakes (匿名)  $code"
[ "$code" = "401" ] || { echo "匿名请求未被拒绝，鉴权异常"; exit 1; }

# 带上平台身份头必须 200
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'oai-authenticated-user-id: shiti' \
  -H 'oai-authenticated-user-email: shiti@shiti.local' \
  "http://127.0.0.1:$PORT/api/mistakes")
echo "  /api/mistakes (已登录) $code"
[ "$code" = "200" ] || { echo "已登录请求异常"; exit 1; }

echo "==> 部署完成"

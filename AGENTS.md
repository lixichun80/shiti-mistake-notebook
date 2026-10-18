# 拾题 · 智能错题本

拍照上传试卷/作业 → DeepSeek 视觉模型识别错题 → 归档到错题本 → 按需生成举一反三练习题。

## 技术栈

- **vinext**（Next.js 风格的 RSC 框架，跑在 Cloudflare Workers 上）+ Vite 8 + React 19
- **Drizzle ORM** + D1（SQLite）；图片存 R2
- **DeepSeek** `deepseek-flash`（走 `/responses` 端点，支持图片输入）
- 要求 **Node >= 22.13.0**（`package.json` 的 engines）

## 常用命令

```bash
npm run dev      # 本地开发，端口 5173
npm run build    # 构建到 dist/
npm run lint
npm run db:generate   # 改 db/schema.ts 后生成迁移
npm run install:ci    # 服务器上用的依赖安装（等价 npm ci）
```

本地预览构建产物：

```bash
npx wrangler dev --config dist/server/wrangler.json --local \
  --persist-to .wrangler/state --ip 127.0.0.1 --port 3105 --inspector-port 0
```

## 登录机制（改代码前必读）

自托管，登录由应用自己实现，**不依赖任何平台网关**。

- 账号表 `users`（`db/schema.ts`）。`users.id` 同时是 `uploads`/`mistakes` 里的 `user_id`，
  历史数据挂在 `shiti` 上，所以播种时默认 id 也是 `shiti`——换成别的值，老错题会查不到，
  看起来像被清空了。
- 口令用 PBKDF2-SHA256（60 万次迭代）存成 `pbkdf2$<迭代数>$<salt>$<hash>`，见 `lib/auth.ts`。
  迭代数写进格式里，日后调高不用动存量数据。
- 会话是**无状态签名 cookie**（`shiti_session`）：`base64url(载荷).base64url(HMAC-SHA256)`，
  密钥取 `env.SESSION_SECRET`，有效期 30 天。没有服务端会话表，所以**登出只是删掉浏览器
  cookie，旧 token 在过期前密码学上依然有效**（家庭自用可接受）。
- 页面：`/login`（`app/login/`）。未登录访问 `/` 会 `redirect` 到 `/login?return_to=…`。
- 接口：`POST /api/auth/login`、`POST /api/auth/logout`。

### 平台请求头那条老路

`app/chatgpt-auth.ts` 里还留着读 `oai-authenticated-user-*` 的分支，**只在本地开发用**，
由 `env.TRUST_OAI_HEADERS === "1"` 把关；生产环境没设这个变量，直接返回 `null`。
nginx 也会把这四个头置空，但那是第二道防线——配置改错一处（比如某个 location 块自己写了
一条 `proxy_set_header`，会让 server 层的设置整体失效）就全线失守，所以闸门必须留在应用里。

**永远不要在生产环境的 `.dev.vars` 里设 `TRUST_OAI_HEADERS=1`**：请求头是客户端可控的，
设了等于任何人加个请求头就能进后台。`deploy.sh` 会拒绝部署。

### 加账号 / 改密码

播种用 `scripts/seed-user.mjs`，读 `SHITI_BOOTSTRAP_USER/PASSWORD/NAME/ID` 环境变量，
输出一条 `INSERT OR IGNORE`。因为 `OR IGNORE`，**改了 `.deploy.vars` 里的密码再部署
不会更新已有账号**——改密码要手工执行 SQL：

```bash
cd /opt/shiti-mistake-notebook
SHITI_BOOTSTRAP_USER=<用户名> SHITI_BOOTSTRAP_PASSWORD='<新密码>' \
  node scripts/seed-user.mjs | sed 's/INSERT OR IGNORE/INSERT OR REPLACE/' > /tmp/pw.sql
cat /tmp/pw.sql          # 确认无误再执行
npx wrangler d1 execute site-creator-d1 --config dist/server/wrangler.json \
  --local --persist-to .wrangler/state --file /tmp/pw.sql
rm -f /tmp/pw.sql
```

新增家人账号同理，换一组 `SHITI_BOOTSTRAP_USER` / `_NAME` / `_ID` 跑一次即可，
每个账号有各自独立的错题本。

## 存储

- `env.DB`（D1）与 `env.BUCKET`（R2）由 `dist/server/wrangler.json` 声明。
  自托管用 Miniflare 本地模拟，数据在 `.wrangler/state`，**不需要 Cloudflare 账号**。
- `env.DEEPSEEK_API_KEY`、`env.SESSION_SECRET` 来自仓库根目录的 `.dev.vars`。wrangler 会自动加载
  cwd 下的这个文件名，`ecosystem.config.cjs` 里另有一条 `--env-file` 作双保险。
  **本地想复现同样的绑定，就得把文件叫 `.dev.vars`**——`--env-file` 传别的文件名时，值不会
  进到 worker 的 `env` 里（踩过一次：本地 `--env-file .dev.vars.local` 让 `SESSION_SECRET`
  变成 undefined，登录接口 503）。
- 表结构在 `db/schema.ts`，迁移在 `drizzle/`。

## 部署

服务器 `198.44.177.126`，路径 `/opt/shiti-mistake-notebook`，pm2 进程名 `shiti-notebook`，
nginx 反代到 `127.0.0.1:3105`。两个入口：**https://study.zxai.studio/**（主入口，Let's Encrypt
证书）和 http://198.44.177.126:8095/（IP 直连备用）。

服务器上有两个配置文件，都不进 Git：

- `.dev.vars`（600）—— `DEEPSEEK_API_KEY`、`SESSION_SECRET`（≥32 字符）。wrangler 会加载它。
- `.deploy.vars`（600）—— `SHITI_BOOTSTRAP_USER` / `_PASSWORD` / `_NAME` / `_ID`。
  只有 `deploy.sh` 读它，**故意与 `.dev.vars` 分开**，免得明文登录密码被 wrangler 装进
  worker 的 `env` 里。

nginx 侧集中在 snippet `/etc/nginx/snippets/shiti-app.conf`（两个 server block 都 `include`
它），登录接口限速在 `/etc/nginx/conf.d/shiti-limit.conf`——**改代理配置只改这两处**。
`study.zxai.studio` 的证书由 `certbot --nginx` 管理并自动续期，不要手改那个文件的 443 段。

```bash
ssh server-198 "/opt/shiti-mistake-notebook/deploy.sh"
```

`deploy.sh` 会拉取、装依赖、构建、迁移、播种账号、重启、验证；任一步失败即中止。

构建耗时 5–8 分钟（683 个包 + vinext 构建），**必须后台跑**，直接 ssh 执行会撞工具超时。

迁移用 sed 改写成 `CREATE TABLE IF NOT EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS`，
所以可重复执行；**迁移文件里出现 `ALTER TABLE` 会直接中止**（SQLite 没有
`ADD COLUMN IF NOT EXISTS`），那种迁移需要人工处理或另建幂等方案。

## 验证要求

`deploy.sh` 已内置这些断言。改动登录相关代码后至少确认：

1. `/api/status` 返回 `{"aiConfigured":true}`
2. `/login` 匿名可访问（200）——否则会陷入「要先登录才能看登录页」
3. 匿名请求 `/api/mistakes` 返回 **401**
4. **带 `oai-authenticated-user-id` 伪造头请求 `/api/mistakes` 仍返回 401**（防绕过回归测试）
5. 错误密码登录返回 401，正确密码返回 200 并下发 `shiti_session`
6. 带会话 cookie 请求 `/api/mistakes` 返回 200
7. 登出响应清除了 `shiti_session` cookie

域名相关的验证（DNS 解析、证书、公网可达）一律在服务器上做——本地 Clash 会把域名解析成
`198.18.0.25` 的 fake-IP，本地结果没有参考价值。

## 约定

- 密钥、`.wrangler/state`、`用户数据/` 一律不进 Git。
- 不要提交 `dist/`、`.next/`、`node_modules/`。
- `.gitattributes` 强制 LF，服务器上的 `deploy.sh` 才能正常执行。
- `.dev.vars` / `.deploy.vars` 的值若含空格或 `#`，用双引号包起来——`deploy.sh` 用 shell
  `source` 读它们，裸值会被截断。

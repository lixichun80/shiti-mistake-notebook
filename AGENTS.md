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

应用**没有登录页**。`app/chatgpt-auth.ts` 的 `getChatGPTUser()` 直接读请求头：

- `oai-authenticated-user-id`（必需）
- `oai-authenticated-user-email`（必需）
- `oai-authenticated-user-full-name` + `...-encoding: percent-encoded-utf-8`（可选，用作显示名）

这两个头原本由 ChatGPT Sites 平台的网关注入，`/signin-with-chatgpt`、`/callback` 都是平台路由。
**自托管环境下由 nginx 注入**（见 `deploy.sh` 同级的部署说明）。所以：

- 改 `getChatGPTUser()` 就等于改登录逻辑，别随手动。
- 所有写接口都会因缺少用户而返回 401，本地 curl 调试要手动带这两个头。
- 请求头缺失时 `getChatGPTUser()` 返回 `null`，页面降级为「访客」且上传/读取全部 401。

## 存储

- `env.DB`（D1）与 `env.BUCKET`（R2）由 `dist/server/wrangler.json` 声明。
  自托管用 Miniflare 本地模拟，数据在 `.wrangler/state`，**不需要 Cloudflare 账号**。
- `env.DEEPSEEK_API_KEY` 经 `--env-file` 从 `.dev.vars` 加载（本地开发也可用同文件）。
- 表结构在 `db/schema.ts`，迁移在 `drizzle/`。

## 部署

服务器 `198.44.177.126`，路径 `/opt/shiti-mistake-notebook`，pm2 进程名 `shiti-notebook`，
nginx 监听 `8095` 反代到 `127.0.0.1:3105`。

```bash
ssh server-198 "/opt/shiti-mistake-notebook/deploy.sh"
```

`deploy.sh` 会拉取、装依赖、构建、迁移、重启、验证；任一步失败即中止。
首次部署需要先写好 `.dev.vars`（600 权限）并 `pm2 start ecosystem.config.cjs`。

构建耗时 5–8 分钟（683 个包 + vinext 构建），**必须后台跑**，直接 ssh 执行会撞工具超时。

## 验证要求

改完代码至少确认这三条（`deploy.sh` 已内置）：

1. `/api/status` 返回 `{"aiConfigured":true}`
2. 不带身份头请求 `/api/mistakes` 返回 **401**
3. 带身份头请求 `/api/mistakes` 返回 **200**

## 约定

- 密钥、`.wrangler/state`、`用户数据/` 一律不进 Git。
- 不要提交 `dist/`、`.next/`、`node_modules/`。
- `.gitattributes` 强制 LF，服务器上的 `deploy.sh` 才能正常执行。

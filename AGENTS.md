# 拾题 · 智能错题本

拍照上传试卷/作业 → DeepSeek 视觉模型结合已有批改或自动逐题批改 → 归档错题 → 按需生成举一反三练习题。

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
- 页面：`/` 未登录时展示公开介绍首页，登录后展示学习工作台；`/login`（`app/login/`）、
  `/register`（`app/register/`）仍独立。后台 `/admin` 继续要求管理员登录。
- 接口：`POST /api/auth/login`、`POST /api/auth/register`、`POST /api/auth/logout`。

### cookie 只证明「你是谁」，权限每次回查库

`readSession()`（`lib/auth.ts`）**只验证签名**，不代表这个用户现在还有效——账号可能已被删除、
被停用，或密码被重置过。要拿当前状态必须走 `getChatGPTUser()` / `getSessionUser()`
（`app/chatgpt-auth.ts`），它会用 cookie 里的 `uid` 回查一次 `users` 行，用**库里的**
`role` / `status` / `session_epoch` 做判定：

| 情况 | 结果 |
|---|---|
| 行不存在（已删除） | 未登录 |
| `status != 'active'` | 未登录 |
| `payload.ep != session_epoch` | 未登录（密码被重置过 / 被停用过） |
| `env.DB` 未绑定或查询抛错 | **未登录**（fail closed，绝不 fail open） |

因此**不要**用 `readSession()` 做「已登录就跳走」的判断——会造出重定向环：cookie 有效 → 跳首页
→ 首页回查发现已停用 → 跳回登录页 → 登录页又只看 cookie → 死循环。`app/page.tsx` 和
`app/login/page.tsx` 都用 `getSessionUser()` 就是这个原因。

`session_epoch` 在**重置密码**和**停用账号**时递增，用来立刻踢掉该用户手上所有 cookie
（无状态会话没有别的办法做到「停用即时生效」，而后台最核心的功能就是停用）。

**向后兼容是硬约束**：老 cookie 的载荷里没有 `ep` 字段。`normalizeEpoch()` 把缺失按 `0` 处理，
存量行的 `session_epoch` 默认值也是 `0`。若改成直接比 `payload.ep === row.session_epoch`，
`undefined !== 0` 恒真，**所有存量登录会在发版瞬间全部失效**，而 `deploy.sh` 里其他断言一条都
不会变红（它们用的都是新签发的 cookie）。`deploy.sh` 里那条「手工签一张没有 `ep` 的旧 cookie」
的断言就是专门堵这个洞的，别删。

页面侧权限用 `requireAdmin(returnTo)`：未登录送回登录页，登录了但不是管理员 `redirect("/")`
（不是 401——页面场景要给人留退路）。接口侧用 `lib/api-guard.ts` 的 `authenticate()` /
`authenticateAdmin()`：未登录 **401**、非管理员 **403**、存储不可用 **503**。两者刻意不同。

### 平台请求头那条老路

`app/chatgpt-auth.ts` 里还留着读 `oai-authenticated-user-*` 的分支，**只在本地开发用**，
由 `env.TRUST_OAI_HEADERS === "1"` 把关；生产环境没设这个变量，直接返回 `null`。
nginx 也会把这四个头置空，但那是第二道防线——配置改错一处（比如某个 location 块自己写了
一条 `proxy_set_header`，会让 server 层的设置整体失效）就全线失守，所以闸门必须留在应用里。

**永远不要在生产环境的 `.dev.vars` 里设 `TRUST_OAI_HEADERS=1`**：请求头是客户端可控的，
设了等于任何人加个请求头就能进后台。`deploy.sh` 会拒绝部署。

### 加账号 / 改密码

日常的账号管理走**后台**（`/admin`）：新建、停用、重置密码、设/取消管理员、删除。
下面这套手工流程只在「后台进不去」时用——比如管理员密码忘了，或者管理员账号被自己锁死了。

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

## 注册与后台

### 注册是完全开放的，这是有意的

`POST /api/auth/register`（`app/api/auth/register/route.ts`）+ 页面 `/register`。**没有**邀请码、
没有每日额度、没有注册开关。自行注册的新账号从创建时起免费体验 7 天。

后果要说清楚：**站点在公网上，任何能访问该域名的人注册后都能在体验期内调 `/api/analyze` 消耗
DeepSeek 额度。** 事后可由管理员在后台停用/删除账号，所以「停用立刻生效」
（见上面的 `session_epoch`）不是锦上添花，是这套取舍能成立的前提。

注册接口写库 + 跑 60 万次 PBKDF2，比登录更容易被刷，所以 nginx 侧
（`/etc/nginx/conf.d/shiti-limit.conf` 的 `map $uri $shiti_login_key`）把它和
`/api/auth/login` 放进同一个限流区。这是沿用既有做法，不是新增防护。

**微信号注册必填**（`users.wechat`，可空列）：管理员靠它主动加客户微信。只做宽松校验
（非空、无空白、≤40 字符，`checkWechat()`），因为用户可能填手机号或 QQ 号，这些也能搜到人。
存量账号和后台新建的账号可以没有微信号，后台列表显示「未填写」，可在「编辑」里补填或清空。

`users.trial_ends_at` 为 NULL 表示长期可用，存量账号和后台创建账号保持 NULL；自行注册时设置为
创建时间后的 7 天。到期后 `/api/analyze` 和生成类似题的接口返回 403，已有错题仍可查看。
管理员可在后台延长 7 天或开通长期使用。接口必须通过 `authenticateForAi()` 执行限制，
不能只禁用前端按钮。

用户名规则和密码长度在 `lib/credentials.ts` 里集中定义，注册接口和后台建号接口共用，
改规则只改这一处。唯一性靠 `users_username_unique` 索引兜底（捕获约束冲突返回 409），
**不要改成「先查再插」**——那样有竞态。

### 后台

`/admin`（`app/admin/`）+ `app/api/admin/users`、`app/api/admin/users/[id]`。
页面用独立外壳，不复用 dashboard 的侧栏（那个外壳跟 dashboard 的 tab 状态强耦合）。
接口鉴权走 `lib/api-guard.ts`：未登录 401、非管理员 403、存储不可用 503。

**自锁保护**（`[id]/route.ts`）：不能停用/删除/降级自己。没有这几条，一次误操作就能把
最后一个管理员关在门外，而且没有邮箱、没有找回密码，救不回来。

**删除账号是不可恢复的破坏性操作**，会连带删掉该用户的全部 `mistakes`、`uploads` 和
R2 里的原图。代码里的顺序是**先删 R2 对象、再删库里的行**，不能反——反过来的话，
删完 `uploads` 就再也查不到 `file_keys` 了，那些图片会永远留在桶里成为孤儿。
R2 删除失败时**中止整个操作**（账号留着让管理员重试），不要改成「继续删库」。

**不做用户自助改密码**（用户明确决定）：没有「我的账号」页，忘记密码只能找管理员重置。
登录页文案里写明了这一点，免得用户到处找入口。

### 引导管理员

`deploy.sh` 在播种之后跑一条 `UPDATE users SET role='admin' WHERE id='<SHITI_BOOTSTRAP_ID>'
AND NOT EXISTS (SELECT 1 FROM users WHERE role='admin')`。限定「系统里一个管理员都没有」
是刻意的：既保证永远进得去后台，又不会覆盖管理员在后台主动做的降级。
`SHITI_BOOTSTRAP_ID` 默认 `shiti`，含非法字符会直接中止部署。

## 存储

- `env.DB`（D1）与 `env.BUCKET`（R2）由 `dist/server/wrangler.json` 声明。
  自托管用 Miniflare 本地模拟，数据在 `.wrangler/state`，**不需要 Cloudflare 账号**。
- `env.DEEPSEEK_API_KEY`、`env.SESSION_SECRET` 来自仓库根目录的 `.dev.vars`，由
  `ecosystem.config.cjs` 的 `--env-file` 加载。

  ⚠️ **wrangler 是按「配置文件所在目录」解析 `.dev.vars` 的，不是 cwd。** 因为启动命令用的是
  `--config dist/server/wrangler.json`，只把文件放在仓库根目录**不会生效**——worker 拿不到
  `SESSION_SECRET`，注册/登录返回 503「服务端未配置会话密钥」，`/api/status` 报
  `aiConfigured:false`。启动日志里那行 `Using secrets defined in <路径>` 才是判断依据，
  它显示的路径不对就说明没加载上。

  本地要复现生产绑定，把文件放到配置文件旁边（`cp .dev.vars dist/server/.dev.vars`），
  或者 `--env-file` 传绝对路径。生产因为传的是绝对路径 `/opt/shiti-mistake-notebook/.dev.vars`，
  不受这个规则影响。

  另外：`.dev.vars` 必须是**这个文件名**。wrangler 对别的名字有特殊解释（会当成
  `--env <name>` 对应的环境文件），值进不到 worker 的 `env` 里——踩过一次，本地
  `--env-file .dev.vars.local` 让 `SESSION_SECRET` 变成 undefined。
- 表结构在 `db/schema.ts`，迁移在 `drizzle/`。

## 部署

服务器 `198.44.177.126`，路径 `/opt/shiti-mistake-notebook`，pm2 进程名 `shiti-notebook`，
nginx 反代到 `127.0.0.1:3105`。两个入口：**https://study.zxai.studio/**（主入口，Let's Encrypt
证书）和 http://198.44.177.126:8095/（IP 直连备用）。

服务器上有两个配置文件，都不进 Git：

- `.dev.vars`（600）—— `DEEPSEEK_API_KEY`、`SESSION_SECRET`（≥32 字符）。wrangler 会加载它。
- `.deploy.vars`（600）—— `SHITI_BOOTSTRAP_USER` / `_PASSWORD` / `_NAME` / `_ID`。
  只有初始化/部署脚本读它，**故意与 `.dev.vars` 分开**，免得明文登录密码被 wrangler 装进
  worker 的 `env` 里。

nginx 侧集中在 snippet `/etc/nginx/snippets/shiti-app.conf`（两个 server block 都 `include`
它），登录接口限速在 `/etc/nginx/conf.d/shiti-limit.conf`——**改代理配置只改这两处**。
`study.zxai.studio` 的证书由 `certbot --nginx` 管理并自动续期，不要手改那个文件的 443 段。

`deploy.sh` 会拉取、装依赖、构建、迁移、播种账号、重启、验证；任一步失败即中止。

构建耗时 5–8 分钟（683 个包 + vinext 构建）。**不要用 `ssh server-198 "bash deploy.sh"`
前台跑**——SSH 长连接会被服务器掐断（在 `npm ci` 阶段实测断开过，`exit 255`，
脚本被杀在装依赖中间，`node_modules` 残缺），而且本地工具也有超时。

正确姿势是让部署**脱离 SSH 会话**，日志落盘，另开连接轮询：

```bash
ssh server-198 "cd /opt/shiti-mistake-notebook && setsid nohup bash deploy.sh \
  > /tmp/shiti-deploy.log 2>&1 < /dev/null & echo 已启动"

# 之后每隔几分钟看一眼
ssh server-198 "pgrep -f 'bash deploy.sh' >/dev/null && echo 仍在跑 || echo 已结束; \
  tail -20 /tmp/shiti-deploy.log"
```

**日志尾部出现 `==> 部署完成` 才算成功**（前面十几条 `✓` 是验证断言，见下面的「验证要求」）。

### deploy.sh 会覆盖自己（踩过一次）

`deploy.sh` 顶部的 `git reset --hard origin/main` 会把 `deploy.sh` 自己也换掉，而 bash 是
**边读边执行**的：文件在运行中被替换之后，脚本剩余部分读到的可能是新旧两版拼接出来的内容。
表现是「跑的是上一版的逻辑」，不报错、不崩溃，日志看起来完全合理。

踩过一次：某次提交同时改了 `deploy.sh`（迁移段从 sed 换成 `apply-migration.mjs`），
结果这次部署执行的还是旧版的 sed 逻辑，把 `0002` 判成「含 ALTER TABLE，无法幂等」当场中止，
而拉下来的代码明明是对的。

所以脚本在 reset 之后会比对自身哈希，变了就 `exec bash "$SELF"` 用新版本重新执行一遍
（`SHITI_DEPLOY_REEXEC` 防重入）。**改动 deploy.sh 时不要删掉这段**，否则下一次
「改部署脚本」的提交会静默地跑旧逻辑。

同类陷阱：任何在运行中被自己覆盖的脚本都有这个问题。其它文件（`scripts/*.mjs` 等）
是各自起进程时才读的，不受影响。

`deploy.sh` 只重启应用、不碰 nginx。改了 `/etc/nginx/` 下的东西要**另行手动**
`nginx -t && systemctl reload nginx`：先部署验证应用没问题，再 reload 切换流量，
中间不会出现「两边都没防护」的窗口。

### 迁移机制

`drizzle/*.sql` **每次部署都全量重放**（没有「已应用迁移」记录表），所以每条语句都必须幂等。
SQLite 没有 `ADD COLUMN IF NOT EXISTS`，靠两个脚本补：

- `scripts/dump-schema.mjs` —— 导出当前库结构（表 → 列名）到 stdout 的 JSON，其余输出走 stderr。
  用 `process.execPath` + `node_modules/wrangler/bin/wrangler.js` 起 wrangler：Windows 上
  `spawnSync("npx.cmd", …)` 不加 `shell:true` 会直接起不来（`status === null`）。
- `scripts/apply-migration.mjs` —— 读「库结构 + 迁移文件」，输出这次**真正需要执行**的 SQL：
  - `CREATE TABLE` / `CREATE [UNIQUE] INDEX` → 补上 `IF NOT EXISTS`；
  - `ALTER TABLE <t> ADD [COLUMN] <c>` → 列已存在就丢掉这条，不存在才保留；
  - **其它任何形态的 `ALTER TABLE`（`DROP COLUMN` / `RENAME` / `ALTER COLUMN`）→ 直接退出 1**，
    这些没法幂等，必须人工介入。这个保护是有意的，别为了「让它跑通」把它删掉。

同一轮里对 `(表, 列)` 去重，所以两个迁移加同一列不会重复输出。

**代价：迁移文件只能追加，不能改。** 改了已发布的文件，结构快照就跟它对不上，
「列已存在就跳过」的判断会失准。要改结构请加新文件。

`deploy.sh` 迁移后还有一条复查断言：重新导出结构，确认 `users` 的 `role` / `status` /
`session_epoch` / `last_login_at` / `wechat` / `trial_ends_at` 真的在。因为 apply-migration 是「看结构决定跳过什么」，
万一结构导出拿错了库，它会把该执行的 ALTER 也跳掉而且**不报错**——那样库就少一列，
后面所有断言照样全绿，直到线上登录才炸。

本地验证幂等性：

```bash
SHITI_D1_DB=site-creator-d1 SHITI_WRANGLER_CFG=dist/server/wrangler.json \
  SHITI_PERSIST=.wrangler/state node scripts/dump-schema.mjs > /tmp/schema.json
node scripts/apply-migration.mjs --schema /tmp/schema.json --out /tmp/mig drizzle/*.sql
ls -l /tmp/mig        # 已是最新的迁移文件不会产出文件
```

## 验证要求

`deploy.sh` 已内置这些断言。改动登录相关代码后至少确认：

1. `/api/status` 返回 `{"aiConfigured":true}`
2. `/login` 匿名可访问（200）——否则会陷入「要先登录才能看登录页」
3. 匿名请求 `/api/mistakes` 返回 **401**
4. **带 `oai-authenticated-user-id` 伪造头请求 `/api/mistakes` 仍返回 401**（防绕过回归测试）
5. 错误密码登录返回 401，正确密码返回 200 并下发 `shiti_session`
6. 带会话 cookie 请求 `/api/mistakes` 返回 200
7. 登出响应清除了 `shiti_session` cookie
8. **手工签一张没有 `ep` 字段的旧格式 cookie，请求 `/api/mistakes` 仍返回 200**——
   这是「发版瞬间所有存量登录失效」的唯一守卫，别删
9. `/register` 匿名可访问（200）
10. 不填微信号注册返回 **400**；注册接口能建号并下发会话；重复用户名返回 **409**
11. 新注册账号能读自己的 `/api/mistakes`（200）
12. 匿名访问 `/api/admin/users` 返回 **401**
13. **普通账号访问 `/api/admin/users` 返回 403**（越权回归测试，和 4 同等重要）
14. 管理员能读到账号列表（含刚注册的那个），能打开 `/admin`（200）
15. 普通账号打开 `/admin` **不是** 200

注册相关的断言会真的建一个 `deploycheck` 账号，`deploy.sh` 里挂了 `trap cleanup EXIT`
在退出时清掉（成功失败都清）。改那段时**别把 cleanup 弄丢**，否则每部署一次后台就多一个
测试账号。清理走 SQL 而不是删账号接口：失败退出时未必有可用的管理员 cookie。

域名相关的验证（DNS 解析、证书、公网可达）一律在服务器上做——本地 Clash 会把域名解析成
`198.18.0.25` 的 fake-IP，本地结果没有参考价值。

## 约定

- 密钥、`.wrangler/state`、`用户数据/` 一律不进 Git。
- 不要提交 `dist/`、`.next/`、`node_modules/`。
- `.gitattributes` 强制 LF，服务器上的 `deploy.sh` 才能正常执行。
- `.dev.vars` / `.deploy.vars` 的值若含空格或 `#`，用双引号包起来——`deploy.sh` 用 shell
  `source` 读它们，裸值会被截断。

## 本次后台升级文档

- [实施范围](docs/specs/changes/admin-upgrade.md)
- [交付与验收记录](docs/delivery/features/admin-upgrade/feature.md)
- [后台架构](docs/architecture/overview/admin.md)

## 默认账号环境配置

见 [默认登录账号](docs/architecture/default-accounts.md)。本地 `.deploy.vars` 保存两组独立生成的管理员/普通用户凭据，使用 `npm run accounts:check` 检查，`npm run accounts:seed` 初始化缺少的账号。管理员用 SHITI_BOOTSTRAP_*，普通用户用 SHITI_DEFAULT_*。新增管理员使用 seed-user.mjs --admin，既有账号不会因重复播种被覆盖。

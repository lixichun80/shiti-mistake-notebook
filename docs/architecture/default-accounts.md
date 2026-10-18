# 默认登录账号

两组本地初始账号保存在项目根目录 [`.deploy.vars`](../../.deploy.vars)，已被 Git 忽略，密码不写入文档或前端代码。

| 用途 | 用户名 | 环境变量 | 入口 |
|---|---|---|---|
| 管理员 | admin | SHITI_BOOTSTRAP_USER / SHITI_BOOTSTRAP_PASSWORD | /login 登录，随后 /admin |
| 普通用户 | student | SHITI_DEFAULT_USER / SHITI_DEFAULT_PASSWORD | /login 登录，随后 / |

两组随机密码独立生成，可以在 `.deploy.vars` 查看。当前本地数据库已初始化，并核对两组凭据与角色一致。原有 shiti 管理员及其历史数据保留。

## 使用方式

- 检查配置：`npm run accounts:check`，不会修改数据库或输出密码。
- 本地初始化：先构建并应用数据库迁移，再执行 `npm run accounts:seed`。
- 部署配置：参考根目录 `.deploy.vars.example`，将实际 `.deploy.vars` 单独放到服务器项目目录，权限设为 600，执行现有部署流程时会创建缺少的默认账号。

初始化仅创建缺少的账号，不覆盖已存在的用户名、密码、角色、状态和数据。修改环境文件中已有账号的密码不会自动改数据库，已有账号请在后台重置。用户名和 ID 必须分别唯一；不要修改已有账号 ID 来改名或转移数据。

本地新默认管理员 ID 为 shiti-admin，默认普通用户 ID 为 shiti-user。旧服务器 `.deploy.vars` 已有 SHITI_BOOTSTRAP_ID 时保留原值，避免断开历史数据关联。

`.dev.vars` 继续只保存运行时 AI 密钥和会话密钥，登录明文凭据由初始化/部署脚本读取。环境文件不进入客户端构建。

## 验证

已核对本地两组账号的角色、启用状态及 PBKDF2 哈希与环境文件中的密码匹配；内存 SQLite 重放初始化 SQL 验证重复执行不覆盖已有密码。未修改线上环境。

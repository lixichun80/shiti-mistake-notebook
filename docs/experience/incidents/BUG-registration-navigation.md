# 注册入口无法点击

日期：2026-10-18。

## 复现与根因

真实 Chrome 打开线上 /login，点击“立即注册”后仍停留在登录页。浏览器控制台报 vinext RSC prefetch setup error 和 TypeError: e is not a function，来源为 next/link 客户端产物。直接访问 /register 和带真实域名 Origin 的注册 API 均成功，说明主问题在页面跳转而非建号逻辑。

另发现备用 IP:8095 的浏览器 Origin 带端口，而 nginx 使用 $host 转发时丢失端口，注册/登录会被同源校验返回403。不带 Origin 的原部署测试无法覆盖。

## 修复

- 登录页“立即注册”和注册页“返回登录”使用原生 a 链接，全页导航。保持原有注册、密码与权限规则。
- 为切换入口增加链接样式和键盘焦点，手机点击区域至少32px。
- nginx snippet 转发完整 $http_host，保留8095端口；保留 Origin 校验和平台身份头清理。
- 版本化 deploy/nginx/shiti-app.conf，新增 scripts/check-registration-origin.mjs，通过空请求验证同源400和跨源403，不创建账号。

## 验收边界

必须用真实浏览器实际点击两个入口，并通过公网域名和备用 IP 带 Origin 完成注册、会话读取、重复用户名拒绝、重新登录。仅本地构建或直接访问注册 URL 不足以关闭此问题。测试账号单独创建并清理，不修改客户账号。

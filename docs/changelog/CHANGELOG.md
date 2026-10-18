# 后台升级

2026-10-18：完成五个后台页面、统一弹窗及错题导出；补齐批次删除的失败重试顺序与 AI 探针真实模型调用。详见 [交付记录](../delivery/features/admin-upgrade/feature.md)。无数据库结构、登录策略和线上部署变更。

2026-10-18：增加默认管理员/普通用户两组环境配置和本地初始化命令；凭据存于不进 Git 的 .deploy.vars，保留原有账号与历史数据。详见 [默认登录账号](../architecture/default-accounts.md)。

2026-10-18：移除学习界面的管理后台导航入口；管理员通过 /admin 独立路径访问，原有权限校验保留。

2026-10-18：修复认证页面 Link 跳转报错导致立即注册无响应；注册/登录切换改为浏览器全页导航，修复备用 IP 入口丢失 Host 端口引发的同源校验失败。详见 [根因记录](../experience/incidents/BUG-registration-navigation.md)。

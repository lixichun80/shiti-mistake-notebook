# 后台模块开发认领

规格：[admin-upgrade 1.0](../changes/admin-upgrade.md)。

| 工作流 | 负责人 | 范围 | 状态 |
|---|---|---|---|
| 界面与验收 | 主代理 | /admin，admin-console.tsx、admin.css、docs | 完成，桌面/390px验收通过 |
| 新增 API | admin_api | lib/admin.ts、/api/admin/mistakes、uploads、system，验证脚本 | 完成，隔离 API 与51项HTTP验证通过 |

共享用户/鉴权接口仅调用，不修改。git 操作由主代理独占，本次无提交或部署。


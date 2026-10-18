# 站点与后台边界

用户端提供上传识别、私有错题本与练习，管理员通过 /admin 管理全站账号与内容。

| 页面 | API | 规格 | 验收 |
|---|---|---|---|
| /admin 五个入口 | /api/admin/users、stats、mistakes、uploads、system | [后台升级 1.0](../changes/admin-upgrade.md) | [交付记录](../../delivery/features/admin-upgrade/feature.md) |

用户端与后台共用 users 的角色/状态/session_epoch，但页面外壳独立。数据库结构、注册策略及生产部署脚本本轮不变。

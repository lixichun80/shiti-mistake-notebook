# 管理后台

页面 /admin 使用 requireAdmin；所有管理 API 使用 authenticateAdmin，保持匿名 401、普通账号 403 和数据库不可用 503 的既有契约。

客户端只用 import type 引用 lib/admin.ts 的数据类型，构建时擦除，不把 cloudflare:workers 引入浏览器。查询页面取消过期响应写入，切换筛选/刷新时隐藏旧列表。

批次清理顺序为读取并校验 file_keys、删除 R2、D1 batch 删除错题与上传行。R2 操作幂等，失败保留数据库记录便于重试；跨存储操作不能提供统一事务。

AI 探针复用业务服务的 /responses 与 deepseek-flash，使用 20 秒超时，不返回上游原始错误内容。R2 状态仅表示绑定存在，不代表执行了读写探针。

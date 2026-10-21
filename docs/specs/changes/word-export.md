---
name: word-export
status: completed
kind: change
module: notebook
version: "1.0"
lifecycle: approved
created: 2026-10-18T11:00:00Z
---
# 错题 Word 导出

用户要求暂停注册修复的单独上线，将“打印错题”改为生成 Word 后再一起上线。

- REQ-W01：分析结果页、错题本的每张卡片将“打印错题”替换为“生成 Word”。
- REQ-W02：生成真正的可编辑 .docx，文件含学科、知识点、日期、来源、原题与举一反三练习、答题空白，参考答案及解析另起页。
- REQ-W03：点击后触发浏览器下载，并保留可再次点击的下载链接；不再调用 window.print 或弹出系统打印面板。
- REQ-W04：A4 页面、20mm边距、正文12pt、页码，中文/英文/数学字符及原始换行保留。生成操作无额外 AI 用量，仅使用当前账号已保存的错题内容。

实现：lib/mistake-docx.ts 生成标准 OOXML ZIP；`/api/mistakes/[id]/word` 在验证当前账号后返回带 `Content-Disposition: attachment` 的 `.docx`，页面使用真实链接下载，以避免部分手机浏览器在临时 `blob:` 链接上持续加载。单元练习卷的 Word 下载也直接使用已有文件接口。无依赖或数据库结构变更。

验证：node scripts/check-mistake-docx.mjs 使用独立 ZIP/CRC/XML 解析验证文件及特殊字符、长英文、无衍生题、分页/页码、关系文件；python-docx 成功打开样例。本地临时账号经 HTTP 成功下载错题 `.docx`，确认状态码、文件签名、类型和附件响应头，测试数据已清理。华为浏览器真机下载仍需用户在更新后的站点验证。

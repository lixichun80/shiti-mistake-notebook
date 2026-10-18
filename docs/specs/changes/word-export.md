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
- REQ-W04：A4 页面、20mm边距、正文12pt、页码，中文/英文/数学字符及原始换行保留。生成操作无网络请求、无额外AI用量，沿用当前用户已加载的错题内容。

实现：lib/mistake-docx.ts 生成标准 OOXML ZIP；app/dashboard.tsx 对接浏览器 Blob 下载。无依赖或数据库结构变更。

验证：node scripts/check-mistake-docx.mjs 使用独立 ZIP/CRC/XML 解析验证文件及特殊字符、长英文、无衍生题、分页/页码、关系文件；python-docx 成功打开样例。浏览器已实际点击修复后的注册/登录切换及生成 Word 按钮，未出现运行错误。手机/桌面 Word 软件的实际打印由用户下载后操作，本轮不声称实测物理打印。

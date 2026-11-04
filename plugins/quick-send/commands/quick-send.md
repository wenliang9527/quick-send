---
description: 打开快捷发送面板（会话内卡片/侧栏），可带常用语标题关键词直接展开内容
---

打开快捷发送面板：调用 quick-send 插件 server 的 `panel` 工具
（会话工具集中形如 `mcp__plugin_quick-send_quick-send__panel`，name=`panel`）。
面板会以会话内卡片呈现（分类/搜索/置顶/复制/发送均可用）。

若 `$ARGUMENTS` 带了常用语标题关键词：先调 `list_snippets` 找到匹配的一条，
再调 `render_snippet` 展开占位符，直接把展开后的文本给用户
（`{{date}}/{{time}}/{{datetime}}/{{workspace}}/{{clipboard}}` 由 server 展开）；
找不到匹配就打开面板并说明没有匹配项。

不要额外解释，动作要短。

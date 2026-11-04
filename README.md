# Quick-Send

ZCode 会话侧栏「快捷发送」面板：常用语管理，一键复制到剪贴板或发送。
设计与调研结论见 [docs/design.md](docs/design.md)（含宿主 API 调研、spike 实测结论、风险表）。

## 当前状态（v0.3.0）

- M0 Spike ✅ / M1 MVP ✅ / M2 完整功能 ✅（均含自动化测试与实测）
- M3 收尾：自动化验收全过（33 项冒烟 + 24 项单元/并发），剩余日常使用反馈打磨

## 功能

- 常用语增删改查；搜索（标题+正文）；置顶段 + 分类段两级分组，组内上移/下移
- 分类：chips 过滤、编辑器带已有分类建议、批量改名（server `rename_category`）
- 每条两个动作：
  - **📋 复制** → 占位符展开 → 写系统剪贴板（~400ms）→ 粘贴到发送栏改后发送
  - **▶ 发送** → 占位符展开 → 经宿主确认框直达会话（带"来自插件"署名）
- 占位符（复制/发送时由 server 展开；未知原样保留）：

  | 占位符 | 展开为 |
  |---|---|
  | `{{date}}` | `2026-11-03` |
  | `{{time}}` | `14:30` |
  | `{{datetime}}` | `2026-11-03 14:30` |
  | `{{workspace}}` | 当前项目目录名 |
  | `{{clipboard}}` | 当前剪贴板文本（只在此占位符存在时才读取） |

- 界面语言跟随宿主（zh/en）；深浅色跟随宿主主题；搜索词/分类 chips 会话内记忆（widgetState）
- 数据：`${ZCODE_PLUGIN_DATA}/snippets.json`（物理 `~/.zcode/cli/plugins/data/quick-send@quick-send-local/`），原子写，损坏自动留证 `.bad` 后空表启动；上限 200 条 / 正文 10KB / 分类 20 字

## 构建 / 测试

```bash
cd plugins/quick-send/panel
npm install
npm run build     # 产出 dist/panel.html（单文件 MCP 资源,≤4MiB）
npm test          # 单元(expand/store/i18n) + 双会话并发 + 全链路冒烟
```

## 本地安装 / 更新（ZCode Desktop UI）

1. 插件市场 → 添加插件市场 → 粘贴目录：`D:\WORK_VSCODE\Vibe-coding\quick-send\plugins`
2. 个人市场 `quick-send-local` → quick-send → 安装 / 更新（更新前先刷新市场）
3. 更新后**开新会话**（重启 server 进程），插件卡片「打开」→ 侧栏面板

## 结构

```
plugins/quick-send/
├─ .zcode-plugin/plugin.json    # mcpServers(QUICK_SEND_DATA 注入) + ui.surfaces(会话面板)
└─ panel/
   ├─ src/panel.html / app.js / i18n.js        # 面板(ext-apps SDK,离线打包单文件)
   ├─ server/server.mjs         # MCP server:panel 锚点 + 8 个 visibility:app 工具
   ├─ server/store.mjs          # 数据层:原子写/损坏自愈/校验/分段排序
   ├─ server/expand.mjs         # 占位符引擎(vars>内建>原样保留)
   ├─ server/clipboard.mjs      # Set/Get-Clipboard(临时文件+EncodedCommand)
   └─ test/                     # 单元 + 并发 + 冒烟
```

## 工程纪律（实测教训,详见 design.md）

- 面板只用官方 ext-apps SDK（`app.callServerTool` / `app.sendMessage`），不碰 `window.zcode`
- `powershell -Command -` 会把 stdin 逐行当命令执行 → 剪贴板走临时文件 + `-EncodedCommand`
- 面板侧 `navigator.clipboard` 被宿主权限策略拦截 → 复制唯一路径是服务端
- `save_snippet` 全量覆盖 category —— 面板所有保存必须显式带当前分类

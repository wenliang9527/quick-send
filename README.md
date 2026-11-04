# Quick-Send

ZCode 会话侧栏「快捷发送」面板：常用语管理，一键复制到剪贴板或发送。
设计与调研结论见 [docs/design.md](docs/design.md)（含宿主 API 调研、spike 实测、性能优化记录）。

## 当前状态（v0.4.0）

- M0 Spike ✅ / M1 MVP ✅ / M2 完整功能 ✅ / M3 收尾 ✅
- **v0.4.0：server 由 Node 重写为 Rust 原生单文件 exe——常驻内存 54.5MB → 3.8MB（14×），exe 仅 0.5MB**
  面板/数据/工具协议零变化，同一套测试矩阵全过（Rust 单元 14 + 冒烟 33 + 并发 1 + i18n 3）

## 功能

- 常用语增删改查；搜索（标题+正文）；置顶段 + 分类段两级分组，组内上移/下移
- 分类：chips 过滤、编辑器带已有分类建议、批量改名
- 每条两个动作：
  - **📋 复制** → 占位符展开 → 写系统剪贴板（~400ms）→ 粘贴到发送栏改后发送
  - **▶ 发送** → 占位符展开 → 经宿主确认框直达会话（带"来自插件"署名）
- 占位符（server 展开；未知原样保留）：`{{date}}` `{{time}}` `{{datetime}}` `{{workspace}}` `{{clipboard}}`
- 界面跟随宿主语言（zh/en）与主题；搜索词/分类 chips 会话内记忆
- 数据：`${ZCODE_PLUGIN_DATA}/snippets.json`（物理 `~/.zcode/cli/plugins/data/quick-send@quick-send-local/`），原子写、损坏自愈、上限 200 条/10KB/分类 20 字

## 资源占用（实测）

| 组件 | 占用 |
|---|---|
| server（quick-send-server.exe，常驻） | **3.8 MB**（每会话一份；零轮询零后台） |
| 面板 webview | 仅面板打开时（宿主托管） |
| PowerShell | 瞬时，仅复制/读剪贴板时 ~350ms |

## 构建 / 测试

```bash
cd plugins/quick-send/panel
npm install                  # 构建期依赖（esbuild + ext-apps 面板 SDK）
npm run build                # 面板 → dist/panel.html
npm run build:server         # Rust server → server/bin/quick-send-server.exe（需 cargo）
npm run test:rust            # Rust 单元测试
npm test                     # i18n + 双会话并发 + 33 项全链路冒烟（驱动 Rust exe）
```

改 server 逻辑：`server-rs/src/*.rs` → `npm run build:server` → `npm test`。
改面板：`src/*` → `npm run build`。

## 本地安装 / 更新（ZCode Desktop UI）

1. 插件市场 → 添加插件市场 → 粘贴目录：`D:\WORK_VSCODE\Vibe-coding\quick-send\plugins`
2. 个人市场 `quick-send-local` → quick-send → 安装 / 更新（更新前先刷新市场）
3. 更新后**开新会话**（重启 server 进程），插件卡片「打开」→ 侧栏面板

## 结构

```
plugins/quick-send/
├─ .zcode-plugin/plugin.json         # command 直指 Rust exe;QUICK_SEND_DATA 注入
└─ panel/
   ├─ src/panel.html / app.js / i18n.js   # 面板(ext-apps SDK,esbuild 离线打包单文件)
   ├─ server-rs/                      # Rust server 源码(cargo,单线程 stdio JSON-RPC)
   │  └─ src/{main,tools,store,expand,clipboard}.rs
   ├─ server/bin/quick-send-server.exe    # 编译产物(入库,市场按目录安装)
   ├─ build.mjs / scripts/copy-server.mjs
   └─ test/{smoke,concurrency,i18n}.test.mjs … 冒烟
```

## 工程纪律（实测教训,详见 design.md §9/§14）

- 面板只用官方 ext-apps SDK（`app.callServerTool` / `app.sendMessage`），不碰 `window.zcode`
- `powershell -Command -` 会把 stdin 逐行当命令执行 → 剪贴板走临时文件 + `-EncodedCommand`
- 面板侧 `navigator.clipboard` 被宿主权限策略拦截 → 复制唯一路径是服务端
- Rust 版协议应答照抄 SDK 实测捕获（`_meta` 含 SDK 自动补的 `ui/resourceUri`）
- cargo 全局 USTC 镜像对 cargo 不可达时,项目级 `.cargo/config.toml` 覆盖为 rsproxy

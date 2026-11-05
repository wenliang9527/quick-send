# Quick-Send

ZCode 会话侧栏「快捷发送」面板：常用语管理，一键复制到剪贴板或发送。
设计与调研结论见 [docs/design.md](docs/design.md)（含宿主 API 调研、spike 实测、性能优化记录）。

## 当前状态（v0.5.7）

- M0 Spike ✅ / M1 MVP ✅ / M2 完整功能 ✅ / M3 收尾 ✅
- **v0.4.0：server 重写为 Rust 原生单文件 exe——常驻内存 54.5MB → 3.8MB（14×），exe 仅 0.5MB**
- **v0.5.0：常用语与 DSH 侧双向共享**（shared-phrases 契约）：内容进共享 phrases.json（严格六字段），置顶/排序留本地 view.json；旧 snippets.json 启动自动合并迁移（.migrated 留证）
- **v0.5.1：按 DSH 交接文档（HANDOFF-DSH.md）对齐**——长度上限统一 120/20000/20 **字符**（原 50/10KB字节/20，DSH 存的长条目本侧可读可改）；读侧剥 UTF-8 BOM（否则会把 DSH 合法文件误隔离）；缺 schemaVersion 只拒读写**不再隔离**；重复 id 保留首条、缺 id/text 条目跳过、数字时间戳回退当前时间（对齐 normalizePhrase）；坏文件留证 `.bad-<时间戳>`（多次损坏不互相覆盖）
- **v0.5.2：打开感知 + 会话内快捷打开**——首帧纯 CSS 加载指示（延迟实测：服务端全程 5-8ms，大头在宿主 webview 与 SDK 包解析，插件侧已无可压缩）；新增斜杠命令 **`/quick-send`**（插件自带 commands/，不占共用技能池；带标题关键词直接展开该条）
- **v0.5.3：纯打包修复**——0.5.2 的安装快照早于市场刷新（缺 commands/），且版本号相同导致更新按钮不再触发；bump 版本号触发重装（§6 SOP 实例）
- **v0.5.4：分类建议弃用原生 datalist**（webview 里弹层悬空压内容区）→ 输入框下方内联 chips（点击填入，主题配色一致）
- **v0.5.5：agent 整理常用语**——新增 `bulk_add_snippets` 工具（一次调用批量写入：逐条校验、完全重复自动跳过、**整批一次原子写**，返回逐条结果）+ 斜杠命令 `/quick-send-organize` 固化五步纪律（查重→草稿→**等用户确认**→写入→汇报）。跨端对称：DSH 侧同期实现 quick_send_list/add/update 工具
- **v0.5.6：面板手动刷新按钮**——头部新增 ⟳ 按钮：agent 侧改数据（bulk_add_snippets 等）没有 server→UI 推送通道（ext-apps 无该能力），面板原来只在打开时拉一次列表，点一下重拉全量（不做轮询）。**此版本已装机**（市场快照 685,207B + 11-04 exe）
- **v0.5.7：装机后追加修复合辑（bump 触发重装，§6 SOP；内容曾误折进 0.5.6，因版本相同更新按钮不会触发）**——① `list_snippets`/`render_snippet` 改为 agent 可见（原 app-only，但 /quick-send、/quick-send-organize、bulk 描述三处流程都要求 agent 调它们——命令路径实际执行不了）；② save_snippet 更新时不带 pinned 保留现值（原来默认 false 会冲掉置顶）；③ 编辑抽屉 Esc 关闭 / Ctrl+Enter 保存、列表刷新后保持滚动位置；④ **默认数据路径不再写死作者机器目录**（CONTRACT 待办 1，对齐 DSH 0.2.2 修法）——不配置时跟随插件数据目录，要共享必须显式配置 `phrasesPath`；⑤ **并发加固（对齐 DSH 0.3.2 事故复盘）**——唯一 tmp 名（固定 tmp 名并发会 ENOENT）+ 数据目录级 lockfile 串行全部写操作（多会话多 exe 互不丢数据），ZCode↔DSH 跨进程 revision 机制立项为 CONTRACT 双侧待办

## 功能

- 常用语增删改查；搜索（标题+正文）；置顶段 + 分类段两级分组，组内上移/下移
- 分类：chips 过滤、编辑器带已有分类建议、批量改名
- 每条两个动作：
  - **📋 复制** → 占位符展开 → 写系统剪贴板（~400ms）→ 粘贴到发送栏改后发送
  - **▶ 发送** → 占位符展开 → 经宿主确认框直达会话（带"来自插件"署名）
- **⟳ 手动刷新**：agent（bulk_add_snippets 等）或 DSH 侧改动共享文件后，点一下重拉全量（ext-apps 无 server→UI 推送，不做轮询）
- 占位符（server 展开；未知原样保留）：`{{date}}` `{{time}}` `{{datetime}}` `{{workspace}}` `{{clipboard}}`
- 界面跟随宿主语言（zh/en）与主题；搜索词/分类 chips 会话内记忆
- 会话内快捷打开：斜杠命令 **`/quick-send`**（直接出面板卡片；带标题关键词则直接展开该条，如 `/quick-send 复位日志`）；插件卡片「打开」按钮直达侧栏
- **agent 代加常用语**：`/quick-send-organize` 整理当前对话/指定主题 → 查重 → 草稿经你确认 → `bulk_add_snippets` 一次入库（agent 也可直接调工具）
- 数据分层（[CONTRACT.md](docs/shared-phrases/CONTRACT.md)）：**内容** = `phrases.json`，DSH/ZCode 双向写，原子替换+损坏自愈+schemaVersion 守卫；**视图**（置顶/排序）= 本地 `view.json`
- 数据文件位置（两种装法）：
  - **装法 A · 只自己用（默认，零操作）**：不配置任何项，常用语存在插件数据目录 `~/.zcode/cli/plugins/data/quick-send@quick-send-local/phrases.json`，自包含可用
  - **装法 B · 与 DSH 共享**：插件设置 `phrasesPath` 指向共享文件（如 `D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json`），双方读写同一内容源；置顶/排序仍在各自本地 `view.json`
  - 默认值不写死任何机器路径（v0.5.6 起，对齐 DSH 0.2.2 修法）：要共享必须显式配置
- 上限与 DSH 对齐：标题 120 / 正文 20000 / 分类 20 **字符**（DSH 超限截断、本侧超限拒绝，共同上界一致）；条数护栏 2000（契约无上限，超出仅拒新增）；占位符 `{{datetime}}` 带秒（契约），`{{clipboard}}` 仅 ZCode 侧

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
├─ commands/                         # 斜杠命令:/quick-send(开面板/展开)、/quick-send-organize(整理入库)
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

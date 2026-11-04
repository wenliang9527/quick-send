# Quick-Send 插件设计方案

> ZCode 侧栏"快捷发送"面板:管理常用语,一键复制/发送
> 版本:v1.0 草案 · 2026-11-03
> 状态:待评审 → 通过后按里程碑动工

---

## 1. 概述

### 1.1 目标

做一个 ZCode 本地插件,在会话侧栏提供"常用语"面板:

- 增删改查常用语(全局一套,所有项目共用)
- 分类、搜索、置顶
- 变量占位符(`{{date}}` 等),使用时动态展开
- 每条常用语两个动作:
  - **复制** → 写入系统剪贴板,用户粘贴到发送栏,修改后自己发送(主路径)
  - **发送** → 经确认后作为用户消息直接发出(副路径)

### 1.2 非目标(首版不做)

- ❌ "只填入发送栏不发送" —— 宿主不暴露此 API(见 §2.3,硬限制)
- ❌ 云同步 / 多机同步 / 团队共享
- ❌ 全局热键(不在插件能力范围内)
- ❌ 常用语历史记录 / 使用统计
- ❌ 修改宿主应用(违反配置纪律,且升级即失效)

### 1.3 为什么是这个形态

- **插件形式**(而非 skill/命令):用户要的是"侧栏点击"的 GUI 交互,ZCode 的 MCP App 侧栏面板是唯一承载方式,且已有本地成功先例(ocdup 面板)。
- **双按钮**:调研确认宿主无"填草稿"API(§2.3),复制到剪贴板是语义最接近的替代("内容进我手里,可改后发");`sendMessage` 直发作为快速路径。

---

## 2. 调研结论(方案依据)

### 2.1 市场调研:无现成插件

| 市场 | 插件数 | 结论 |
|---|---|---|
| ZCode 官方市场 (`zcode-plugins-official`) | 68 | 无常用语/快捷发送/提示词库类插件 |
| Claude 官方市场 (`claude-plugins-official`) | 315 | 同上(关键词命中均为消息服务类,不相关) |

最接近的原生能力是自定义 slash 命令(commands/*.md),但它是键盘驱动、发给 Agent 执行的,不满足"侧栏点击"诉求。

### 2.2 宿主暴露给面板页的完整 API 面

来源:`D:\Zcode\resources\app.asar` 反查 + `@modelcontextprotocol/ext-apps` SDK 类型定义(ocdup 面板 node_modules 内,v2.x)。

**官方 SDK `App` 类(面板页标准通道,本项目采用):**

| API | 用途 | 本项目使用 |
|---|---|---|
| `app.callServerTool(name, args)` | 调插件 server 工具 | CRUD / 剪贴板 / 占位符展开 |
| `app.sendMessage({role:"user", content:[{type:"text",text}]})` | 向会话发出用户消息,`result.isError` 表示宿主拒绝 | ▶ 发送按钮 |
| `app.updateModelContext()` | 写模型上下文,不触发回复 | 不用 |
| `app.getListResources` / `readResource` / `subscribeResource` | 读/订本 server 资源 | 不用(工具即可) |
| `app.setWidgetState` / `widgetState` | 宿主内存态,会话内活 | 记面板 UI 状态(当前分类/搜索词) |
| `app.getHostContext()` + `onhostcontextchanged` | 主题/locale/显示模式 | 跟随深浅色与中英文 |
| `app.getHostCapabilities()` | 能力探测 | 启动时探测 |

**Gen-UI 兼容桥 `window.zcode`(仅限 fragment 页,本项目不用):**
`widgetState / setWidgetState / sendFollowUpMessage(prompt, title→确认弹窗) / openExternal`。
官方文档明确警告:创建了官方 `App` 的页面不要访问 `window.zcode`(可能建立第二连接)——本项目面板走纯官方 SDK,不碰它。

### 2.3 硬限制:无法"只填发送栏"(关键调研结论)

在 app.asar 中定位到宿主内部确有往发送栏插文本的机制:
`Wa.getState().requestComposerTextInsert(workspaceId, markdown, ...)`(Zustand store action,内部功能"插入到输入框"使用,偏移 362652626/362655366 处)。

但它**只被宿主内置 React 组件调用**,遍历 `ui/*`、`zcode/*` 全部 15 个协议方法(`ui/download-file`、`ui/initialize`、`ui/message`、`ui/open-link`、`ui/request-display-mode`、`ui/set-widget-state`、`ui/update-model-context`、`zcode/gen-ui*` 等),没有任何 IPC/桥接通道把它暴露给插件面板。

**结论:插件层做不到"点击→填入发送栏→用户改→发送",除非官方未来开放 API。** 复制到剪贴板是插件能力范围内语义最接近的替代。

### 2.4 已验证的工程先例

- ocdup-zcode 插件(本地市场,生产在用):`plugin.json` 声明 `mcpServers`(stdio node)+ `ui.surfaces`(session 面板),面板用 ext-apps SDK `callServerTool` 与 server 通信 —— 本项目整体照此模式。
- 插件数据目录物理位置已确认:`~/.zcode/cli/plugins/data/<plugin>@<marketplace>/`,经 `${ZCODE_PLUGIN_DATA}` 注入 server,重启持久。

---

## 3. 需求规格

### 3.1 功能需求

| # | 需求 | 说明 |
|---|---|---|
| FR-1 | 常用语列表 | 卡片:标题 + 正文预览(2 行);按"置顶 → 分类 → order"排序 |
| FR-2 | 新增/编辑 | 抽屉表单:标题(必填,≤50 字)、正文(必填,≤10KB)、分类(自由文本+下拉建议)、置顶开关 |
| FR-3 | 删除 | 带确认;支持从列表直接删 |
| FR-4 | 搜索 | 标题+正文子串匹配,不区分大小写,输入即过滤 |
| FR-5 | 分类 | 自由文本分类;面板顶部 chips 过滤;"未分类"归组;分类列表由数据派生 |
| FR-6 | 置顶 | 每条独立开关;置顶项排最前,组内按 order |
| FR-7 | 复制 | 点击 → 占位符展开 → 写系统剪贴板 → Toast"已复制,粘贴到发送栏(Ctrl+V)" |
| FR-8 | 发送 | 点击 → 占位符展开 → `sendMessage` → 宿主行为(确认弹窗或直发,以 spike 为准)→ Toast 结果 |
| FR-9 | 占位符 | `{{date}}` `{{time}}` `{{datetime}}` `{{workspace}}` `{{clipboard}}`;未知占位符原样保留 |
| FR-10 | 排序 | 同分类内支持上移/下移(order 字段) |
| FR-11 | 持久化 | 全局一套,存 `${ZCODE_PLUGIN_DATA}/snippets.json`,原子写 |
| FR-12 | 会话内 UI 记忆 | 当前分类/搜索词/滚动位置存 widgetState,面板重开恢复 |

### 3.2 非功能需求

| # | 需求 | 指标 |
|---|---|---|
| NFR-1 | 复制响应 | ≤ 600ms(含 PowerShell 冷启动;Toast 先行反馈"复制中") |
| NFR-2 | 数据容量 | 软限制 200 条 / 单条正文 10KB,超限编辑器提示 |
| NFR-3 | 中文安全 | 剪贴板写入、JSON 读写全链路 UTF-8 无乱码 |
| NFR-4 | i18n | zh-CN / en 双语(照 ocdup i18n 模式) |
| NFR-5 | 主题 | 跟随宿主深浅色(getHostContext CSS 变量) |
| NFR-6 | 崩溃安全 | 数据文件损坏时自动降级:`snippets.json.bad` 备份 + 空表启动,不丢旧数据 |

---

## 4. 交互设计

### 4.1 面板布局

```
┌─ 快捷发送 Quick Send ─────────────────┐
│ 🔍 搜索…                    [＋ 新建] │
│ [全部] [📌] [嵌入式] [写作] [日报]     │  ← 分类 chips,横滚
│ ────────────────────────────────────  │
│ 📌 置顶                                │
│ ┌──────────────────────────────────┐  │
│ │ ⚠ 复位日志采集            [⋯]    │  │
│ │ 采集复位后 10s 的日志,{{date}}…  │  │
│ │              [📋 复制]  [▶ 发送]  │  │
│ └──────────────────────────────────┘  │
│ ▸ 嵌入式 (3)                          │
│ ┌──────────────────────────────────┐  │
│ │ 寄存器读取 …                     │  │
│ │        [📋 复制]  [▶ 发送]  [⋯]  │  │
│ └──────────────────────────────────┘  │
│ …                                     │
│ 空态:还没有常用语,点「新建」添加     │
└───────────────────────────────────────┘
```

- 卡片 `[⋯]` 菜单:编辑 / 置顶切换 / 上移 / 下移 / 删除
- 编辑抽屉(右滑出或底部弹出):标题、正文(多行,底部灰字提示可用占位符)、分类(输入+已有分类下拉)、置顶开关、保存/取消
- Toast(面板内 status 条):复制成功 / 已发送 / 宿主拒绝 / 失败原因

### 4.2 核心流程

**复制流程(主路径)**
```
点击[📋] → 面板 callServerTool("copy_snippet", {id})
         → server: 读数据 → 展开占位符 → powershell Set-Clipboard
         → 返回 {ok, expanded 预览} → 面板 Toast「已复制,Ctrl+V 到发送栏」
用户 → 粘贴 → 修改 → 自己发送
```

**发送流程(副路径)**
```
点击[▶] → 面板 callServerTool("render_snippet", {id}) → 得到展开文本
        → 面板 app.sendMessage({role:"user", content:[{type:"text",text:展开文本}]})
        → isError? Toast「宿主拒绝了发送」 : Toast「已发送」
```
发送不经过 server(server 无法触达宿主会话),由面板页直接走 SDK —— 这是官方标准通道,不碰 `window.zcode`。

**数据修改流程**
```
面板表单 → callServerTool("save_snippet", {snippet}) → server 原子写文件
        → 返回最新全量 → 面板重渲染(不做增量,数据量小,全量简单可靠)
```

---

## 5. 技术架构

### 5.1 组件与进程模型

```
ZCode Desktop
├─ 会话侧栏面板(webview)
│   └─ panel/dist/panel.html + app.js     ← ext-apps SDK(App 类)
│         │ callServerTool                      │ sendMessage
│         ▼                                     ▼
│   ┌─ 插件 server(stdio Node 子进程)┐   宿主会话(确认/入列)
│   │  panel/server/server.mjs          │
│   │  工具:CRUD/渲染/剪贴板          │
│   └──────────────┬────────────────────┘
│                  │ 原子读写(UTF-8)
│                  ▼
│   ${ZCODE_PLUGIN_DATA}/snippets.json
│   (物理: ~/.zcode/cli/plugins/data/quick-send@<marketplace>/)
└─ child_process: powershell.exe(Set-Clipboard / Get-Clipboard,按需拉起)
```

### 5.2 插件清单(`.zcode-plugin/plugin.json`)

```json
{
  "name": "quick-send",
  "version": "0.1.0",
  "description": "会话侧栏快捷发送面板:管理常用语,一键复制到剪贴板或发送,支持分类/搜索/置顶/占位符",
  "description_i18n": {
    "en": "Quick-send sidebar panel: manage reusable snippets, copy to clipboard or send with one click; categories, search, pinning, placeholders",
    "zh-CN": "会话侧栏快捷发送面板:管理常用语,一键复制到剪贴板或发送,支持分类/搜索/置顶/占位符"
  },
  "keywords": ["snippets", "quick-send", "clipboard", "mcp-app", "productivity"],
  "mcpServers": {
    "quick-send": {
      "type": "stdio",
      "command": "node",
      "args": ["${ZCODE_PLUGIN_ROOT}/panel/server/server.mjs"],
      "cwd": "${ZCODE_PROJECT_DIR}",
      "env": { "NODE_ENV": "production" }
    }
  },
  "ui": {
    "surfaces": [
      {
        "id": "quick-send",
        "title": { "zh-CN": "快捷发送", "en": "Quick Send" },
        "server": "quick-send",
        "resourceUri": "ui://quick-send/panel.html",
        "availability": "session"
      }
    ]
  }
}
```

- `cwd` 设为工作区:server 可取工作区名实现 `{{workspace}}`
- server 为纯 Node + `@modelcontextprotocol/server`,零原生依赖;面板构建 esbuild,照 ocdup `build.mjs`

### 5.3 仓库与安装

- 仓库:`D:\WORK_VSCODE\Vibe-coding\quick-send`(与 Ocdup/Xcom 同层),插件包在 `plugins/quick-send`
- 发布:本地目录市场(`source: directory`),照 acccom-local/ocdup-local 已有做法注册 `known_marketplaces`
- 本设计文档动工时迁入仓库 `docs/design.md`

---

## 6. 数据模型

`${ZCODE_PLUGIN_DATA}/snippets.json`:

```json
{
  "version": 1,
  "updatedAt": "2026-11-03T12:00:00.000Z",
  "snippets": [
    {
      "id": "b3c9…uuid",
      "title": "复位日志采集",
      "body": "采集复位后 10s 的日志,重点看 {{date}} 之后新增的报错,汇总成表格。",
      "category": "嵌入式",
      "pinned": true,
      "order": 0,
      "createdAt": "2026-11-03T12:00:00.000Z",
      "updatedAt": "2026-11-03T12:00:00.000Z"
    }
  ]
}
```

设计决策:

- **分类存为自由字符串**,不建独立实体:面板分类列表 = 去重派生;改名 = 工具一次性重写所有匹配项(server 提供 `rename_category`);避免两份数据不一致
- **order 为组内相对序**:重排只交换相邻两项的 order,写入量最小
- **原子写**:写 `snippets.json.tmp` → `fs.rename` 覆盖;读时 parse 失败 → 把原文件改名 `.bad` 留证,空数据启动(NFR-6)
- **多会话并发**:多个 ZCode 会话可能各拉起一个 server。写路径短(毫秒级)+ 原子替换,last-write-wins;不做文件锁(复杂度不值,风险见 §10)

---

## 7. MCP 工具协议(server 暴露)

| 工具 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `panel` | – | 文本确认 | 打开面板(surface 入口;agent 可见) |
| `list_snippets` | – | `{ snippets: Snippet[] }` | 全量;面板启动及每次写操作后调用;agent 查重/检索用(可见性见下) |
| `save_snippet` | `{ snippet: Snippet }`(有 `id` 即更新) | `{ snippets }` | 校验:title/body 非空、长度上限;新条目 server 生成 id/createdAt;pinned 缺省保留现值(v0.5.6) |
| `delete_snippet` | `{ id }` | `{ snippets }` | 不存在返回错误 |
| `reorder_snippet` | `{ id, direction: "up"\|"down" }` | `{ snippets }` | 组内相邻交换 order |
| `rename_category` | `{ from, to }` | `{ snippets }` | 批量改分类 |
| `bulk_add_snippets` | `{ phrases: [{title, body, category?}] }` | `{ added, skippedDuplicates, failed, snippets }` | agent 整理路径(v0.5.5):逐条校验/完全重复跳过/整批一次原子写 |
| `render_snippet` | `{ id }` | `{ title, text }` | 展开占位符,不落剪贴板;发送路径与 agent 直取(v0.5.6 起 agent 可见) |
| `copy_snippet` | `{ id }` | `{ ok, preview }` | 展开 → Set-Clipboard;preview 供 Toast 显示(截 80 字) |

约定:

- 可见性三档(v0.5.6 定稿):`panel`/`list_snippets`/`render_snippet`/`bulk_add_snippets` **agent 可见**(无 `_meta`,宿主不隐藏)——/quick-send 与 /quick-send-organize 流程依赖 list/render;`save_snippet`/`delete_snippet`/`reorder_snippet`/`rename_category`/`copy_snippet` 保持 `_meta ui.visibility:["app"]` 仅面板可调
- 错误统一 `{ error: { code, message } }`;code:`not_found` / `validation` / `clipboard_failed` / `io`
- `vars` 自定义变量为协议预留:expand 支持优先级覆盖,但 copy/render 的 tools/call 入口当前未接线(面板与 agent 均传不了)

### 7.1 占位符规范(server 端展开)

| 占位符 | 展开为 | 实现 |
|---|---|---|
| `{{date}}` | `2026-11-03` | 本地时区 `toISOString` 截取 |
| `{{time}}` | `14:30` | 本地时区 |
| `{{datetime}}` | `2026-11-03 14:30` | 组合 |
| `{{workspace}}` | 工作区目录名 | `path.basename(process.cwd())` |
| `{{clipboard}}` | 当前剪贴板文本 | `Get-Clipboard`(有启动开销,文档标注) |
| 未知 `{{xxx}}` | 原样保留 | 容错,不报错 |
| `vars` 传入的 `{{xxx}}` | 对应值 | 优先级最高,覆盖内建 |

---

## 8. 关键实现设计

### 8.1 剪贴板写入(Windows)

```js
// server.mjs 片段思路
import { execFile } from "node:child_process";
const b64 = Buffer.from(text, "utf16le").toString("base64");
execFile("powershell.exe",
  ["-NoProfile", "-NonInteractive", "-EncodedCommand", b64of(`Set-Clipboard -Value '...'`)],
  …);
```

- **编码安全**:脚本经 `-EncodedCommand`(UTF-16LE base64)传入,中文/换行/引号零转义问题;不走 `clip.exe`(控制台代码页会毁中文)
- **延迟**:PowerShell 冷启动 300–600ms。对策:UI 即时 Toast"复制中…",完成后再提示成功;不做进程预热(首版从简,列为优化项)
- **读剪贴板**(`{{clipboard}}`):同法 `Get-Clipboard` 取 stdout

### 8.2 发送路径

```ts
const { expanded } = await app.callServerTool("render_snippet", { id });
const result = await app.sendMessage({
  role: "user",
  content: [{ type: "text", text: expanded }],
});
toast(result.isError ? "宿主拒绝了发送" : "已发送");
```

- 纯官方 SDK 通道;宿主是否弹确认、拒绝时 `isError` 的具体表现 → **Spike-S2 实测**(§9)
- 发送前不需要面板内二次确认(宿主层已有行为;若 Spike-S2 证实直发无确认,再加面板内 confirm,以实测为准)

### 8.3 面板页

- **框架**:无框架,原生 TS + DOM(照 ocdup app.ts,体量小不需要 React)
- **连接**:官方 `App` 类 + `onready`;启动时 `getHostCapabilities()` 探测,缺能力给明确错误条
- **状态**:widgetState 存 `{ category, query }`(会话内恢复);正文数据一律走 server 文件,不进 widgetState(16KiB 上限且不保证重启存活)
- **主题/语言**:`getHostContext()` 取 theme/locale,CSS 变量 + i18n 字典(照 ocdup i18n.ts)
- **打包**:esbuild 单文件 `panel.html`(内联 JS/CSS,远小于 4MiB 资源上限)

### 8.4 目录结构

```
quick-send/
├─ .zcode-plugin/plugin.json
├─ panel/
│  ├─ src/
│  │  ├─ app.ts            # 面板逻辑:列表/搜索/表单/动作
│  │  ├─ i18n.ts
│  │  └─ panel.html
│  ├─ server/
│  │  ├─ server.mjs        # MCP server:工具实现
│  │  ├─ store.mjs         # 读写/原子写/校验
│  │  ├─ expand.mjs        # 占位符展开
│  │  └─ clipboard.mjs     # PowerShell 封装
│  ├─ test/                # node --test
│  ├─ build.mjs
│  ├─ package.json
│  └─ tsconfig.json
└─ docs/design.md          # 本文档迁入
```

---

## 9. Spike 清单(M0,动工第一步,预计半天)

| # | 验证项 | 方法 | 通过标准 |
|---|---|---|---|
| S1 | 面板骨架可用 | 空面板插件装进本地市场,手动打开 | 面板出现在侧栏,`callServerTool` 往返成功 |
| S2 | sendMessage 行为 | 面板按钮发一条固定文本 | 记录:是否弹确认、`isError` 语义、消息在会话中的呈现;据此定 Toast 文案与是否需面板内确认 |
| S3 | Set-Clipboard 中文 | 复制含中文/换行/引号文本,粘贴验证 | 剪贴板内容逐字节一致 |
| S4 | 面板页 navigator.clipboard | `writeText` 尝试 | 若可行且即时,作为快速路径(失败回退 server 路径,不阻塞) |
| S5 | 面板手动打开的入口形态 | 观察宿主 UI | 确认 session 面板的打开交互;若入口深,评估工具唤起兜底(照 ocdup panel 工具) |

S1–S3 任一失败即回到设计评审;S4/S5 失败有既定回退,不阻塞。

### 9.1 Spike 实测结论(2026-11-03,全部完成,M0 通过)

| # | 结果 | 实测证据 |
|---|---|---|
| S1 | ✅ 通过 | 面板在宿主内 `callServerTool` 往返 OK,多次调用稳定 |
| S2 | ✅ 通过 | `sendMessage` isError=false;消息进入会话,带"来自插件 quick-send"署名,触发 Agent 回合;**宿主弹确认框,确认后才发出** |
| S3 | ✅ 通过 | 宿主内 414ms 写入;发送栏实际粘贴两次,中文/换行/引号/`{{date}}` 逐字符原样 |
| S4 | ❌ 不可行 → 按预案 | `navigator.clipboard.writeText` 被权限策略拦截(0ms FAILED):"Clipboard API has been blocked because of a permissions policy" → **快速路径取消,复制唯一路径=服务端**(414ms 达标) |
| S5 | ✅ 通过 | 插件卡片自带"打开"按钮(直达入口);面板以右侧停靠标签页形态打开(独立 × 关闭) |

**M1 落地影响:**
- 复制按钮:只走服务端路径;UI 反馈即时"复制中…"(约 400ms 后转"已复制")
- 发送按钮:消息带插件署名、触发 Agent 回合(真实用户消息,消耗模型调用)——语义符合预期
- ~~面板侧剪贴板快速路径~~ 取消(S4)
- 工程备忘:`powershell -Command -` 会把 stdin 逐行当命令执行(实测坑),剪贴板实现=临时文件 + EncodedCommand(server.mjs 已按此实现并测试)
- 遗留确认(已关闭):S2 实测**弹确认框,确认后才发出**(2026-11-03 用户确认)→ 宿主层已拦截,M1 发送按钮**不加**面板内二次确认,一步直达;§8.2 预案不启用

---

## 10. 风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | sendMessage 宿主行为未知(直发无确认) | 中 | S2 实测;必要时面板内加确认 |
| R2 | 多会话并发写数据文件 | 低 | 原子替换 + last-write-wins;损坏自动降级(.bad 备份) |
| R3 | PowerShell 冷启动延迟感 | 低 | 即时"复制中"反馈;优化项:常驻进程预热 |
| R4 | 面板剪贴板权限被 CSP 拦 | 低 | 主路径走 server,天然免疫;S4 仅作优化 |
| R5 | ZCode 升级改变宿主行为 | 中 | 只依赖官方 SDK 标准协议(不碰 window.zcode/内部 store);升级后跑验收清单 |
| R6 | 占位符 `{{clipboard}}` 泄漏隐私到消息 | 中 | 文档明示语义;Toast 预览让用户发送前可见内容 |
| R7 | 分类自由文本拼写分歧 | 低 | 表单下拉带已有分类;`rename_category` 一键改名 |

---

## 11. 测试计划

**自动化(node --test + smoke,`npm test` 一键跑,2026-11-03 全过)**

- store:原子写/损坏降级/校验/CRUD 幂等/分段排序/批量改名/上限(test/store.test.mjs)
- expand:各占位符、未知保留、vars 覆盖、$ 序列安全、clipboard 单读(test/expand.test.mjs)
- i18n:zh/en 键集一致(test/i18n.test.mjs)
- 并发:双 server 同数据目录交错+真并发写,文件合法/视图一致/无崩溃(test/concurrency.test.mjs)——验收第 5 项自动化
- 协议+全链路:每工具 happy path + 错误码 + 损坏自愈 + 上限(test/smoke.mjs,33 项)

**手工验收清单(发布前)**

| # | 项 | 状态 |
|---|---|---|
| 1 | CRUD/置顶/排序/搜索/分类过滤全链路 | ✅ smoke + 用户 M1/M2 实测 |
| 2 | 复制:中英文混排+占位符展开正确,粘贴可改可发 | ✅ M0/M1 粘贴逐字符核对;{{占位符}} 用户日常验证中 |
| 3 | 发送:消息到达会话,带插件署名,宿主确认框 | ✅ 用户 M1 实测 |
| 4 | 重启 ZCode 数据完好;面板 UI 状态恢复 | ✅ 数据落点已验证;UI 记忆(widgetState)待日常观察 |
| 5 | 双会话同时编辑无文件损坏 | ✅ 自动化(test/concurrency.test.mjs) |
| 6 | 深浅色 + 中英文切换正常 | ⬜ 待用户切换主题时观察 |

---

## 12. 里程碑

| 阶段 | 内容 | 产出 | 预估 |
|---|---|---|---|
| M0 Spike | §9 全表 | 最小可运行插件 + spike 结论记录 | ✅ 2026-11-03 完成(§9.1) |
| M1 MVP | CRUD + 搜索 + 置顶 + 复制/发送双按钮(无分类/占位符) | 日常可用 | ✅ 2026-11-03 完成 v0.2.0(24 项冒烟+实测通过) |
| M2 完整功能 | 分类 + 占位符 + 排序 + widgetState 记忆 + i18n/主题 + 空态 | 功能完整 | ✅ 2026-11-03 完成 v0.3.0(冒烟全过;分类/分组排序/占位符/rename_category/i18n/widgetState) |
| M3 发布 | 本地市场注册 + 文档 + 验收清单过一遍 | v0.1.0 可长期使用 | 市场已注册;验收清单随用户实测收尾 |

---

## 13. 未来扩展(不承诺)

- 面板内拖拽排序;条目多时虚拟滚动
- 使用频次统计 + "最近使用"排序
- 从选中文本/当前剪贴板快速存为常用语
- 若官方开放 composer 草稿 API:复制按钮升级为"填入发送栏"(本方案的 copy 路径一行换掉)
- 提交到 ZCode 官方市场(需按官方 zip 规范打包)
- phrases.json mtime 缓存:当前每次工具调用全量读盘解析(条目少时毫秒级无感);条目上千/正文很长时改为 stat mtime 未变则复用内存解析(**必须** mtime 判定——跨进程与 DSH 双向写,不能无脑缓存)
- server→UI 推送:ext-apps 无该能力(2026-11-04 查证),⟳ 手动刷新是当前解;官方开放通知通道后升级为自动刷新
- 长正文卡片展开交互:卡片正文两行截断,全文需点编辑;可加点击展开/收起
- 面板显示当前 phrases.json 实际路径(CONTRACT 待办②的一半):可在状态条/空态展示注入值,方便确认在装法 A(自包含)还是 B(共享)

## 14. 性能优化记录(v0.4.0,2026-11-04)

用户反馈"这只是个文档功能,55MB 常驻太重"。量化定位:裸 Node 进程地板 41.2MB(实测,
jitless 无效),SDK 仅 ~13MB,业务代码近乎免费 → **在 Node 内无优化空间**。

决策:server 用 Rust 重写(本机 cargo 1.99.1 可用)。要点:

- 协议层手写换行分隔 JSON-RPC,**应答形状逐字段照抄 Node SDK 版的实测捕获**
  (initialize capabilities / tools 的 inputSchema 与 `_meta` 含 SDK 自动补的
  `ui/resourceUri`),消除协议猜测;同一套 33 项冒烟原样回归验证
- 依赖仅 serde/serde_json/base64/chrono;单线程阻塞循环(工具均毫秒级);
  release profile opt-level=z + lto + strip → **exe 0.5MB,常驻 RSS 3.8MB(54.5MB → 14 倍改善)**
- 面板/webview/数据格式/工具协议零变化——升级对用户透明
- 工程坑:cargo 全局 USTC 镜像 curl 可通但 cargo libcurl 0ms 连接失败,
  项目级 `.cargo/config.toml` 覆盖为 rsproxy sparse 解决
- 分发:编译产物 `server/bin/quick-send-server.exe` 随插件入库(本地市场按目录拷贝安装);
  `npm run build:server` = cargo build + 拷贝;`npm run test:rust` = cargo test

测试矩阵(v0.4.0 全过):Rust 单元 14 + i18n 3 + 并发 1(52ms,Node 版 465ms)+ 冒烟 33。

## 15. 共享架构(v0.5.0,2026-11-04)

与 DSH 侧 `dsh-quick-send` 共用常用语,契约见
[`docs/shared-phrases/CONTRACT.md`](shared-phrases/CONTRACT.md)(双方定稿)。

- **分层**:内容(title/text/category/时间戳)= 共享 `phrases.json`,严格六字段+schemaVersion;
  视图(pinned/order)= 各侧本地 view.json(ZCode 侧在 ${ZCODE_PLUGIN_DATA})
- **双向写**,同一纪律:全量读改写 + tmp→rename 原子替换 + 损坏 .bad 自愈;
  schemaVersion 不认识 → 读空表 + 拒写
- **合成**:无 view 条目按 (createdAt,id) 分配确定性虚拟序(全局 max order 之后),
  被 save/reorder 触碰即在 view 固化——DSH 新建的条目在 ZCode 排序稳定
- **迁移**:旧 snippets.json 启动时一次性**合并**进共享文件(同 id 以共享侧为准),
  视图随迁,旧文件 .migrated 留证;真实数据演练通过
- **占位符对齐**:{{datetime}} 改带秒(YYYY-MM-DD HH:mm:ss,契约);{{clipboard}} 仅
  ZCode 侧支持(契约注明);{{workspace}} DSH 首版原样保留
- **路径可配置**:plugin.json userConfig.phrasesPath → env QUICK_SEND_PHRASES,
  替换失败回退默认共享路径
- **协议零变化**:工具层仍输出 body 字段(=共享侧 text),面板 app.js 未改

测试矩阵(v0.5.0):Rust 单元 19(新增严格形状/外部互写/版本守卫/虚拟序固化/合并迁移)
+ i18n 3 + 并发 1 + 冒烟 33,全过。

---

## 附录 A:调研证据索引

- app.asar 桥接实现(window.zcode 全集):偏移 317360309
- 宿主侧 AppBridge 方法面(callTool/sendMessage/downloadFile/…):偏移 317994224
- `ui/*` / `zcode/*` 协议方法常量全集(15 个):偏移 60164982
- `requestComposerTextInsert` 内部实现(仅内置 UI 可达):偏移 362652626、362655366
- SDK `App.sendMessage` 文档(ui/message,role:user,isError 语义):`ext-apps/dist/src/app.d.ts` L820–875
- 插件数据物理目录:`~/.zcode/cli/plugins/data/<plugin>@<marketplace>/`(实际目录列表已验证)

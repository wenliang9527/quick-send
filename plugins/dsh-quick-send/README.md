# dsh-quick-send

[![npm version](https://img.shields.io/npm/v/@wenliang9527/dsh-quick-send.svg)](https://www.npmjs.com/package/@wenliang9527/dsh-quick-send)
[![license](https://img.shields.io/npm/l/@wenliang9527/dsh-quick-send.svg)](https://github.com/wenliang9527/quick-send/blob/master/LICENSE)
[![tests](https://img.shields.io/badge/tests-71%20passed-brightgreen.svg)](#测试)

DSH 常用语快捷发送插件 —— 输入框旁的常用语浮层面板，**点一下插到光标处**（不覆盖、不自动发送）。

与 ZCode 的 `quick-send` 插件**共享同一份内容源**，两侧各自维护置顶与排序。

```
        ┌─ 常用语  2/3 ────────────────── ── ＋新建  ✕ ┐
        │ 🔍 搜索标题 / 正文 / 分类…                    │
        │ [全部] [写作] [嵌入式]                        │
        │ ┌──────────────────────────────────────────┐ │
        │ │ 先给结论                        [写作]    │ │
        │ │ 先给结论，再列步骤，最后给风险点。         │ │
        │ │ [填入] [编辑] [置顶] [↑] [↓] [删除]        │ │
        │ └──────────────────────────────────────────┘ │
        └───────────────────────────────────────────────┘
                    ↓ 浮在输入框上方，不挤压布局
        ┌─ 发消息或创建任务…─────── [📚] [模型] [发送] ─┐
        └───────────────────────────────────────────────┘
```

## 功能

- 输入框工具行 **📚 按钮** → 浮层展开常用语面板（**不占布局、不挤压输入框**）
- **插入到光标处**：一次可撤销的编辑（`Ctrl+Z` 能撤销），不是覆盖草稿
- **管理**：新建 / 编辑 / 删除（二次确认）/ 搜索 / 分类筛选
- **置顶与排序**：置顶项排最前，同段内可上下移动（**仅本侧生效**）
- **占位符**：`{{date}}` `{{time}}` `{{datetime}}`，在**插入时**按本地时区展开
- **失败有明确原因**：不再"点了没反应"，四种情况分别提示（见下）
- **键盘操作**：搜索框内 `↑`/`↓` 选择、`Enter` 插入、`Esc` 清选中
- **占位符预览**：编辑器里实时显示 `{{date}}` 展开后的效果，插入前就能确认
- **导入 / 导出**：一键导出全部常用语为 JSON，或从 JSON 导入（纯客户端，内容不出本机）
- **中英双语**：跟随「设置 → 通用 → 语言」自动切换
- **删除二次确认**：第一次点变红「确认删除」，3 秒内再点才真删（不用原生弹窗）
- **交互**：插入后自动收起；`Esc` 收起（编辑中不响应）；点整条卡片即插入
- **Agent 可读写**：4 个模型可调用工具，让 AI 直接帮你存取常用语（见下）

## Agent 工具

模型可以直接读写常用语，无需你手动操作。注册了 4 个工具：

| 工具 | 作用 | 关键约束 |
|---|---|---|
| `quick_send_list` | 列出常用语，支持分类/关键词过滤 | 只读，可并发；默认不返回正文（省 token） |
| `quick_send_add` | 新增一条 | 正文必填；超长静默截断 |
| `quick_send_update` | 修改一条 | **只按 id 定位**，只传要改的字段 |
| `quick_send_delete` | 删除一条 | **只按 id 定位** + **必须 `confirm: true`** |

### 为什么 update/delete 只认 id

**标题可以重复**——用户完全可能建两条同名短语。如果允许按标题定位，agent 会静默改到/删错那一条。

正确姿势写在工具 description 里，模型会遵守：

```
先 quick_send_list 拿 id  →  再 quick_send_update / quick_send_delete
```

### 长度上限

标题 ≤120 / 正文 ≤20000 / 分类 ≤20 字符，超长**静默截断**（不报错）。
这条也写进了 `quick_send_add` 的 description，模型拟稿时会自行控制长度。

### Agent 建的条目如何识别

新建条目的 id 带 `dsh-agent-` 前缀（如 `dsh-agent-mw1sjfiv-leng`），便于人工辨认。

> **注意**：契约只要求 id 唯一，前缀没有语义约束。ZCode 侧 agent 建的条目是纳秒时间戳 id，
> 没有统一前缀，所以「按前缀识别 agent 条目」**只在 DSH 侧成立**。

如果需要跨侧追溯，契约外的零成本做法是**分类命名约定**：让 agent 把整理的条目写进
`agent/` 开头的分类（如 `agent/整理`）。`category` 本就是自由字符串，两侧面板都能按分类过滤。
工具 description 里对此给的是**建议而非强制**，模型可按内容选更合适的分类。

### 并发安全

写操作（add/update/delete）都标记 `isConcurrencySafe: false`，同一次对话内不会并发写文件。
跨侧（ZCode 与 DSH）同时写遵守契约 §4 的「全量读改写 + 原子替换 + last-write-wins」，
对「单用户手点」和「低频 agent 写入」同样成立。

## 键盘操作

| 按键 | 位置 | 行为 |
|---|---|---|
| `↑` / `↓` | 搜索框 | 在过滤后的列表中上下移动选中（循环） |
| `Enter` | 搜索框（有选中时） | 插入选中那一条 |
| `Esc` | 面板 | 有选中时先清选中；否则收起面板；**编辑器有内容时不收起** |
| `Ctrl+Z` | 输入框 | 撤销上一次插入 |

## 插入失败的原因提示

用 `inputActions.insertText` 而非 `setDraft`，因此能区分失败情形：

| 判断条件 | 提示文案 |
|---|---|
| `phase === 'adjudicating' \| 'submitting'` | 正在发送，等这轮结束再点 |
| `phase === 'inert'` | 当前输入框不可编辑 |
| 无 `insertText` 方法 | 输入框没接上，无法填入 |
| `insertText` 返回 `false`（重试 2 次后） | 草稿刚变过，再点一次 |
| 抛异常 | 填入失败：<具体错误> |

> `captureInsertion()` 抓光标，`insertText(text, span)` 插入。返回 `false` 通常是
> **面板打开期间用户改过草稿**，导致草稿版本变了——重抓一遍光标再试即成功。

## 与 ZCode 共享内容

| 层 | 字段 | 位置 |
|---|---|---|
| 内容（共享） | `id` `title` `text` `category` `createdAt` `updatedAt` | `D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json` |
| 视图（本侧） | `pinned` `order` | `~/.dsh/quick-send/view.json` |

完整契约见 [`shared-phrases/docs/CONTRACT.md`](../../../../shared-phrases/docs/CONTRACT.md)。

- **双向写**，双方遵守同一纪律：全量读改写 + 临时文件原子替换 + 损坏 `.bad` 留证后空表启动
- 一方新增/修改后，另一方**重新打开面板即可看到**（每次打开都重新拉取）
- `pinned` / `order` 各侧本地，互不影响
- **`body` 必须叫 `text`**：ZCode 侧若保留旧字段名，DSH 读到的正文会是空的

## 占位符支持矩阵

| 占位符 | @wenliang9527/dsh-quick-send | ZCode quick-send |
|---|---|---|
| `{{date}}` / `{{time}}` / `{{datetime}}` | ✅ 插入时展开 | ✅ |
| `{{workspace}}` | ⏸ 原样保留（首版） | ✅ 各侧各义 |
| `{{clipboard}}` | ❌ 不支持，原样保留 | ✅ 仅 ZCode |
| 未知 `{{xxx}}` | 原样保留 | 原样保留 |

> 在 DSH 侧建的短语不要用 `{{workspace}}` / `{{clipboard}}`，它们会被原样保留而不是展开。

## 配置

在 `cordis.patch.yml` 的 `config` 里覆盖（改完**重启 DSH** 生效）：

| 键 | 默认值 | 说明 |
|---|---|---|
| `phrasesFile` | `D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json` | 共享内容文件 |
| `viewFile` | `~/.dsh/quick-send/view.json` | 本侧视图文件 |
| `panelSlot` | `'overlay'` | 面板容器：`overlay` 浮层不挤压输入框；`dock` 固定整行、不遮挡但会顶高输入区 |

```yaml
- insert:
    - id: quick-send
      name: '@wenliang9527/dsh-quick-send'
      config:
        panelSlot: 'dock'
```

> `panelSlot` 由 Host 半区经 `/__quick-send/paths` 告知 Client 半区
> （Client 半区拿不到可靠的 config 传递路径，三个参考实现也都不读 config）。

## 安装

```bash
# 从 npm（推荐）
dsh plugin --profile desktop add @wenliang9527/dsh-quick-send

# 从 GitHub 子目录
dsh plugin --profile desktop add github:wenliang9527/quick-send#plugins/dsh-quick-send

# 本地目录（开发时）
dsh plugin --profile desktop add link:D:/WORK_VSCODE/Vibe-coding/quick-send/plugins/dsh-quick-send
```

或在插件管理里装本地目录。装完**重启 DSH**（Host 半区改动需要重启），然后 `Ctrl+R` 刷新界面。

### pnpm store 路径问题

若安装报 `ERR_PNPM_UNEXPECTED_STORE`，说明 profile 的 `node_modules` 由另一个 store 链接而来。
**不要把全局 store 改掉，也不要重装已有依赖**，用原来的 store 装即可：

```powershell
node <dsh>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs add `
  link:D:/WORK_VSCODE/Vibe-coding/quick-send/plugins/dsh-quick-send `
  --store-dir "C:\Users\<you>\.pnpm\store\v11" `
  --dir "C:\Users\<you>\.dsh\profiles\desktop"
```

然后手动把 `"@wenliang9527/dsh-quick-send"` 加进 `~/.dsh/profiles/desktop/package.json` 的
`dsh.profile.bundles` 数组（`plugin_manager` 自动安装失败时不会自动补这一步）。

## 卸载

```powershell
node <dsh>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs remove @wenliang9527/dsh-quick-send `
  --store-dir "C:\Users\<you>\.pnpm\store\v11" --dir "C:\Users\<you>\.dsh\profiles\desktop"
```

再从 `dsh.profile.bundles` 移除对应行。**共享数据文件不会被删除**。

## HTTP 端点（Host 半区）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/__quick-send/list` | GET | 内容 + 视图合并后的列表 + 分类集合 |
| `/__quick-send/save` | POST | `{id?, title, text, category}`，有 `id` 为更新 |
| `/__quick-send/delete` | POST | `{id}` |
| `/__quick-send/view` | POST | `{id, pinned?, order?}` |
| `/__quick-send/reorder` | POST | `{id, direction: 'up'\|'down'}` |
| `/__quick-send/paths` | GET | 实际使用的两个文件路径 |

> **端口每次重启都会变**（`http://127.0.0.1:<port>`），用会话上下文给出的 URL。

## 结构

```
dsh-quick-send/
├─ package.json             dsh.bundle.patch + dsh.client 声明 + npm test
├─ cordis.patch.yml         profile 挂载行 + 可覆盖 config
├─ dsh-plugin.naming.json   命名声明（外部插件命名校验用）
├─ src/
│  ├─ index.js              Host 半区：HTTP 端点 + CRUD + 视图
│  ├─ store.js              共享内容读写 + 本地视图 + 原子写 + 自愈
│  ├─ expand.js             占位符展开（纯函数）
│  ├─ agent-tools.js        4 个 agent 工具（list/add/update/delete）
│  └─ client.js             Client 半区：📚 按钮 + 浮层面板（ModuleLoader bundle）
└─ test/
   ├─ store.test.mjs        存储与占位符单测（25 项）
   ├─ client.test.mjs       Client 半区运行时测试（21 项，含 Hooks 顺序守门）
   ├─ e2e.test.mjs          真实 HTTP 端到端测试（25 项）
   └─ agent-tools.test.mjs  Agent 工具测试（25 项）
```

### 槽位选择

| 用途 | 槽位 | 为什么 |
|---|---|---|
| 触发按钮 | `conversation.input.left` | 输入框工具行，紧凑控件位 |
| 面板 | `conversation.input.overlay` | **浮层**，渲染在 composer 卡片内，不挤压布局 |

> 曾用 `conversation.input.dock`（"Full-width entries above the composer card"），
> 它会让面板**撑高整个输入区、把输入框往下挤**，故改用 `overlay`。

## 测试

```bash
cd plugins/dsh-quick-send && npm test
# 或
node --test test/store.test.mjs test/client.test.mjs test/e2e.test.mjs test/agent-tools.test.mjs
```

**共 96 项，全部通过。**

### store.test.mjs（25 项）

- **占位符**：三个时间宏按本地时区、占位符内允许空格、`{{workspace}}`/`{{clipboard}}` 原样保留、
  未知占位符保留、多处出现各自展开、空/非字符串安全
- **存储**：文件不存在返回空表、往返一致、中文换行引号无损、BOM 兼容、
  损坏文件隔离为 `.bad` 并空表启动、`schemaVersion` 过高抛错、缺字段抛错、重复 id 去重、未知字段丢弃
- **原子写**：不残留 `.tmp`、重复覆盖同一路径成功
- **视图**：缺失返回空对象、往返一致、非法字段规范化、损坏降级
- **合并排序**：置顶优先 → 分类 → order、同段内按 order、未分类排末尾、视图缺失补默认值

### client.test.mjs（21 项）

用最小 React 替身在 Node 里真实执行 `client.js` 的组件渲染，覆盖：

- **Hooks 顺序守门**（3 项）：`open=false` 与 `open=true` 的 Hook 数量必须一致、反复开关保持稳定、
  序号无断档 → 防止 Hook 被 `if (!open) return null` 跳过导致面板崩溃
- **渲染**：关闭态返回 null、有数据渲染条目、加载/出错/空态提示
- **插入链路**：`captureInsertion` + `insertText`、占位符按当天展开、
  返回 `false` 时重试两次、`phase=inert` 时不尝试
- **删除二次确认**：首次点击只进待确认态
- **搜索/分类过滤**、**键盘导航**（`↓` 选中、`Enter` 插入、`Esc` 停在面板内）
- **i18n**：注册中英双语、两语言键集必须一致（防漏译）、无 locale 服务时退回中文、槽位注入的 `t` 优先
- **占位符预览**：含 `{{date}}` 时显示展开结果、无占位符时不显示
- **导入/导出**：隐藏 file input 存在且 accept 正确

### e2e.test.mjs（25 项）

把 Host 半区注册的 handler 挂到**真实 `http.Server`** 上，走完整 HTTP 往返（不启动 DSH）：

| 分组 | 覆盖 |
|---|---|
| **CRUD** | 空表启动、新建（中文/换行/引号逐字节无损）、多分类去重、编辑（id 与 createdAt 不变、updatedAt 变新）、删除（连带清理本侧 view） |
| **校验** | 空正文/纯空白 400、缺 id 400、不存在 404、非法 JSON 400、错误 method 405、未知路径 404 |
| **长度上限** | 标题 120 / 正文 20000 / 分类 20 的静默截断 |
| **视图排序** | 置顶优先、同段内 up/down 相邻交换、跨分类不移动、`view.json` 不含正文 |
| **契约形状** | 磁盘 `phrases.json` 严格六字段、`createdAt` 是 ISO 字符串、原子写无 `.tmp` 残留 |
| **跨侧共享** | 外部改写文件后能读到、异构 id（UUID/数字式）都保留、**两个实例共用一个 phrases.json 可互相读到** |
| **容错** | phrases 损坏隔离 `.bad` 并空表启动、`schemaVersion` 过高拒绝写入、view 损坏不影响内容 |
| **paths** | 返回实际路径、`panelSlot` 默认 overlay / 配置 dock 时返回 dock |

> **重要分层验证**：磁盘 `phrases.json` 是 **6 字段**（内容契约），
> API `/list` 返回 **8 字段**（6 + `pinned`/`order`）。两者刻意不同，测试都有断言。

### agent-tools.test.mjs（25 项）

验证 4 个 Agent 工具。重点守住三条纪律：

| 分组 | 覆盖 |
|---|---|
| **注册与 schema** | 4 个工具名符合 snake_case、都有 description/parameters/output/execute、写操作不可并发 |
| **定位纪律** | delete 只有 `id`+`confirm`；update 的 `title` 是「新值」而非定位参数；只传 title 不带 id 必须报「缺少 id」 |
| **add** | 六字段落盘、`dsh-agent-` 前缀、空正文报错、超长截断、title/category 可省 |
| **list** | 默认不含正文、`includeText` 才返回、按分类过滤、关键词匹配标题/正文/分类且大小写不敏感 |
| **update** | 只改传入字段、未传保持不变、**id 与 createdAt 不变**（否则另一侧 view 失效）、无改动时不写盘、值没变不计入 changed |
| **delete** | 必须 `confirm:true`、id 不存在报错 |
| **同标题守门** | 两条同名条目时，update/delete **只命中 id 指定的那条** —— 直接验证「按 id 定位」的必要性 |
| **渲染与降级** | 各工具 render 产出可读文本、空结果给提示、tools 服务不可用时不抛错 |

> `client.test.mjs` 是「点了打不开」事故的产物。当时语法检查和单测都通过，
> 但 Hooks 顺序违规是**运行时**错误，只有开关面板才触发——单测测不到。现在这道守门补上了。

## 打包与发布前验证

### 命名校验

```bash
node <plugin-write-skill>/scripts/validate-names.mjs --manifest ./dsh-plugin.naming.json
```

`dsh-plugin.naming.json` 声明了本包实际使用的所有公开名字：

| 项 | 值 |
|---|---|
| packageName | `@wenliang9527/dsh-quick-send` |
| pluginNames | `@wenliang9527/dsh-quick-send` |
| tools | `quick_send_list` `quick_send_add` `quick_send_update` `quick_send_delete` |
| loaderIds | `quick-send` |
| routes | 6 个 `/__quick-send/*` exact 路由 |

> 校验通过（exit 0，无警告）。本插件不注册 service / command / skill / event / settings namespace。

### 打包产物验证

```bash
npm pack                 # 生成 wenliang9527-dsh-quick-send-0.1.0.tgz
npm pack --dry-run       # 只看内容不生成
```

**已实测产物：8 个文件 / 22.9 kB**（解包后 70.8 kB）：

```
README.md  cordis.patch.yml  dsh-plugin.naming.json  package.json
src/client.js  src/expand.js  src/index.js  src/store.js
```

- ✅ `files` 白名单覆盖全部运行时文件（含 `dsh-plugin.naming.json`）
- ✅ 无 `.ts` 残留、无 `test/`（测试不进发布包，本地仍可 `npm test`）
- ✅ 解包后 `src/index.js` 可独立启动，6 个端点全部注册，CRUD 与契约六字段正常

### 发布轨道（需人工确认后才执行）

当前**未发布**。可选轨道：

| 轨道 | 命令 | 说明 |
|---|---|---|
| 本地/局域网安装 | `dsh plugin --profile desktop add link:<path>` | 当前使用方式 |
| GitHub 直装 | `dsh plugin --profile desktop add github:<owner>/<repo>` | 需先推仓库 |
| npm | `npm publish` | 需先 `npm login` |

> ⚠️ 任何 publish / tag push 都要先确认版本号与轨道。本插件尚未建 git 仓库，无 remote。

## 已知限制

- **`{{workspace}}` 首版不展开**：DSH 侧"当前工作区"会随会话切换而变化，语义不可预测，故先原样保留。
- **`{{clipboard}}` 不支持**：浏览器侧拿不到剪贴板内容。
- **无乐观锁**：依赖"单用户跨两窗口手点撞不上毫秒级窗口"的前提；将来若要支持多端并发写，需补 revision 机制。
- **删除不跨侧同步视图**：本侧删除会清掉本侧 view 条目，另一侧的 view 残留会被忽略（不报错、不清理）。
- **长度上限 120 / 20000 / 20**（标题/正文/分类）：超长静默截断，不是契约规定，ZCode 侧若更小需对齐。
- **插入后收起**：连点需重新打开面板（如需要连点体验，可改为不收起）。
- **键盘导航只在搜索框内生效**：从按钮点开面板后，需先点一下搜索框才能用 `↑`/`↓`/`Enter`。
- **`panelSlot` 改动需重启 DSH**：Client 半区通过 HTTP 读取该配置，不支持热切换槽位。
- **导入只做新增，不做去重**：同一文件导入两次会产生重复条目（id 不参与匹配）。

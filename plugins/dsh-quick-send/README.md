# dsh-quick-send

[![npm version](https://img.shields.io/npm/v/@wenliang9527/dsh-quick-send.svg)](https://www.npmjs.com/package/@wenliang9527/dsh-quick-send)
[![license](https://img.shields.io/npm/l/@wenliang9527/dsh-quick-send.svg)](https://github.com/wenliang9527/quick-send/blob/master/LICENSE)
[![tests](https://img.shields.io/badge/tests-112%20passed-brightgreen.svg)](#测试)

DSH 常用语快捷发送插件 —— **浮层一键插到光标处**（不覆盖、不自动发送），
**侧边栏管理页**负责增删改、排序与导入导出。两个界面各管一件事。

装完即用，数据默认存在 `~/.dsh/quick-send/phrases.json`，**不需要建任何文件夹**。
若想与 ZCode 的 `quick-send` 插件共用同一份常用语，配置一下 `phrasesFile` 指向同一个文件即可
（见 [两种装法](#两种装法)），两侧各自维护置顶与排序。

## 两个界面，各管一件事

| 界面 | 怎么打开 | 干什么 |
|---|---|---|
| **浮层（输入框旁）** | 输入框工具行 **📚** 按钮 | **只负责插入**。一屏 9 条，点一下或按 `1-9` 即插入 |
| **管理页（中央面板）** | 侧边栏 **📚** 图标 | **只负责维护**。新建/编辑/删除/搜索/分类/置顶/排序/导入导出 |

管理页左上角有 **`← 返回对话`** 按钮（等价于 `selectPanel(null)`），一键回到对话。
编辑器里有未保存内容时会先确认，避免切走丢改动。

拆开的原因：浮层挤在输入框上方，一屏只放得下几条，正文预览加 6 个按钮会让每行高到 70px，
9 条要滚三四屏。所以浮层只留「序号 + 标题」一行，管理搬到整块中央面板。

```
浮层（插入用）                          管理页（侧边栏 📚，维护用）
┌─ 常用语 9/9  点整条插入，或按 1-9  [管理][✕]┐
│ 🔍 搜索…                                  │   ┌─ 常用语管理 9/9  [← 返回对话] ↑ ↓ ＋新建 ┐
│ [全部] [Obsidian]                         │   │ 🔍 搜索…                        │
│ 1 新建笔记                    [Obsidian]  │   │ ┌────────────────────────────┐ │
│ 2 新建速记                    [Obsidian]  │   │ │ 新建速记          [Obsidian]│ │
│ 3 打开今日日记                [Obsidian]  │   │ │ 在 D:\Obsidian\Inbox…       │ │
│ …                                       │   │ │ [填入][编辑][置顶][↑][↓][删除]│ │
└───────────────────────────────────────────┘   │ └────────────────────────────┘ │
                                                 └────────────────────────────────┘
```

## 功能

- **两个入口**：输入框工具行 **📚** 按钮开浮层（**不占布局、不挤压输入框**）；侧边栏 **📚** 图标开管理页
- **插入到光标处**：一次可撤销的编辑（`Ctrl+Z` 能撤销），不是覆盖草稿
- **数字键直插**：浮层里搜索框为空时，按 `1`-`9` 直接插入第 N 条（搜索框有内容时不抢键）
- **管理**：新建 / 编辑 / 删除（二次确认）/ 搜索 / 分类筛选 / 置顶 / 上下移动
- **列表刷新**：AI 改过常用语后，点管理页 **⟳** 重新拉取；切回窗口/标签页时也会自动刷新
- **筛选记忆**：搜索词与分类选择记在本机（`localStorage`），下次打开自动恢复
- **占位符**：`{{date}}` `{{time}}` `{{datetime}}`，在**插入时**按本地时区展开
- **失败有明确原因**：不再"点了没反应"，四种情况分别提示（见下）
- **键盘操作**：搜索框内 `↑`/`↓` 选择、`Enter` 插入、`Esc` 清选中
- **占位符预览**：管理页编辑器里实时显示 `{{date}}` 展开后的效果，插入前就能确认
- **导入 / 导出**：管理页顶部一键导出全部常用语为 JSON，或从 JSON 导入（纯客户端，内容不出本机）
- **中英双语**：跟随「设置 → 通用 → 语言」自动切换
- **删除二次确认**：第一次点变红「确认删除」，3 秒内再点才真删（不用原生弹窗）
- **交互**：浮层插入后自动收起（管理页常驻，方便连插）；`Esc` 收起浮层（编辑中不响应）
- **AI 总结归纳**：让 AI 从对话里提炼常用语、精简改写、重新归类，直接写进库里（见下）
- **Agent 可读写**：4 个模型可调用工具，让 AI 直接帮你存取常用语（见下）

## Agent 工具

模型可以直接读写常用语，无需你手动操作。注册了 4 个工具：

| 工具 | 作用 | 关键约束 |
|---|---|---|
| `quick_send_list` | 列出常用语，支持分类/关键词过滤 | 只读，可并发；默认不返回正文（省 token） |
| `quick_send_add` | 新增一条 | 正文必填；超长静默截断 |
| `quick_send_update` | 修改一条 | **只按 id 定位**，只传要改的字段 |
| `quick_send_delete` | 删除一条 | **只按 id 定位** + **必须 `confirm: true`** |

### 核心用法：让 AI 帮你总结归纳常用语

这是这套工具最主要的用途——**你平时说的话、反复交代的事，由 AI 归纳成可复用的常用语**，不用自己一条条手写。

**典型场景**

| 你说的话 | AI 会做什么 |
|---|---|
| 「把我们刚讨论的这套调试流程整理成常用语」 | 从对话里提炼步骤 → `quick_send_add` 写入 |
| 「以后让我写周报，就按刚才那个格式来」 | 把格式归纳成模板 → 存为常用语 |
| 「看看我最近总让你重复哪些话，帮我存起来」 | `quick_send_list` 对照 → 归纳共性 → 逐条 `add` |
| 「这几条常用语太啰嗦了，帮我精简一下」 | `list` 取 id → 逐条 `update` 改写正文 |
| 「我的常用语太乱了，按用途重新归类」 | 读全部 → 重新分配 `category` → 逐条 `update` |

**归纳纪律**（写进了工具 description，模型会遵守）

- **先查重再写入**：`quick_send_list` 看过现有条目，避免存出重复短语
- **一条一件事**：不把多个意图塞进同一条，否则点一下插入的内容会太杂
- **标题短、正文可直接用**：标题≤120 字符便于识别，正文是能直接插入发送的完整句子
- **保留占位符**：需要"今天的日期"这类动态内容时写 `{{date}}`，不要写死日期

**注意这是「写入」，不是「自动执行」**

AI 归纳只会**存进常用语库**，不会自动发送。你仍需在面板里点一下才插入草稿——保留人工确认环节。

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

**进程内与跨进程都已串行，不会丢数据。**

#### 进程内（0.3.2 起）

早期版本用固定的 `<file>.tmp` 作临时名，且 `read → modify → write` 之间无锁。
两个并发写会抢同一临时名（一方 `rename` 时目标已被另一方拿走 → `ENOENT` 崩溃），
同时双方读到同一份旧快照，后写者用「旧快照 + 自己那条」覆盖文件，
先写者的新增被静默抹掉。**实测 2 个并发新增就丢 1 条，3 个以上还会崩。**

| 层 | 措施 |
|---|---|
| 临时文件 | 唯一名 `<file>.<pid>.<seq>.<rand>.tmp`，并发写互不干扰 |
| 读改写 | `mutatePhrases` / `mutateView` 把整个「读 → 改 → 写」放进进程内串行队列 |

#### 跨进程（0.3.4 起）

与 ZCode 写同一份 `phrases.json` 时用**文件锁 + revision** 双保险：

| 层 | 措施 |
|---|---|
| 主 | `quick-send.lock`：与 ZCode **同名同目录**，`create_new` 抢锁、25ms 轮询、5s 超时、10s 逾期抢占 |
| 辅 | `revision` 比对：写入前校验，变化则重读重放（防不守锁的旧版本） |

锁文件名与 ZCode 完全一致，所以两侧指向同一文件时**天然互斥**，ZCode 无需改动即可受益。

> **实测教训**：只靠 revision 不够。4 进程 × 8 次并发写，仅用 revision CAS **5 轮全部丢 1 条**
> （31/32）——check 与 write 之间始终有窗口，两个写者能同时通过校验。加文件锁后同一场景
> **5/5 轮均 32/32**。契约原文「毫秒级窗口撞不上」的乐观假设在批量写场景不成立。

因此下列场景都安全：面板连点「保存」、agent 工具与面板同时写、两个浏览器标签页、
`quick_send_add` 与其他写操作交错、**ZCode 与 DSH 同时写共享文件**。

> `isConcurrencySafe: false` 仍然保留，那是给 agent 工具调度器看的提示，
> **不是**并发安全的唯一保障——它只管同一次对话内的工具调用，管不到面板点击和跨进程。

**实现约束**：`mutate` 冲突时会重放，所以必须是纯操作——**id 要在 mutate 外算好**，
内部不得自增计数或重新生成 id，否则重试会写出重复条目。

### 端点安全

6 个 HTTP 端点挂在 DSH 的 loopback 服务上，本身无鉴权。为防「本机任意网页
用 fetch 打这些端点」，0.3.2 起加了同源校验：浏览器发起的请求若带 `Origin`
且其 host 与 `Host` 头不一致，直接 403。无 `Origin` 的请求（curl、服务端调用、
同源导航）放行。

## 键盘操作

| 按键 | 位置 | 行为 |
|---|---|---|
| `1`-`9` | 搜索框（**且搜索框为空**） | 直接插入第 N 条（第 10 条起不绑，两位数太容易按错） |
| `↑` / `↓` | 搜索框 | 在过滤后的列表中上下移动选中（循环） |
| `Enter` | 搜索框（有选中时） | 插入选中那一条 |
| `Esc` | 浮层 | 有选中时先清选中；否则收起面板；**编辑器有内容时不收起** |
| `Ctrl+Z` | 输入框 | 撤销上一次插入 |

> 数字键只在搜索框为空时生效，否则你搜「123」会被抢走按键。管理页不需要数字键
> （那里是整块面板，直接用鼠标点按钮更直观）。

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

## 数据存哪

插件有**两个**数据文件，职责不同：

| 文件 | 存什么 | 默认位置 | 是否需要配置 |
|---|---|---|---|
| **内容文件** | 常用语本体：`id` `title` `text` `category` `createdAt` `updatedAt` | `~/.dsh/quick-send/phrases.json` | **不用** |
| **视图文件** | 本侧界面状态：`pinned` `order` | `~/.dsh/quick-send/view.json` | **不用** |

> 两个文件都**跟着用户主目录走**，装完直接用，**不需要手动建任何文件夹**。
> 面板底部会显示当前实际使用的路径，点一下即可复制。

`~` 在 Windows 上是 `C:\Users\<你的用户名>`。所以默认内容文件的实际位置是：

```
C:\Users\<你的用户名>\.dsh\quick-send\phrases.json
```

**只有想和别的客户端共享时**才需要改这个路径 —— 见下面两种装法。

## 两种装法

### 装法 A：只自己用（默认，绝大多数人）

**什么都不用做。** 装完重启 DSH，首次保存时插件会自动创建
`~/.dsh/quick-send/` 目录和 `phrases.json`。

```bash
dsh plugin --profile desktop add @wenliang9527/dsh-quick-send
```

- 数据在你自己机器上，插件作者接触不到
- 不需要读懂 `shared-phrases` 是什么，跟它没有任何关系
- 卸载插件不会删除数据文件

### 装法 B：和 ZCode quick-send 共享常用语

适用于**同一台机器上同时装了 DSH 和 ZCode**，想让两边的常用语是同一份。

1. 选定共享文件位置，例如 `D:\shared-phrases\phrases.json`（目录不存在也行，会自动建）
2. 在 DSH 的 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里写：

```yaml
- id: quick-send
  name: '@wenliang9527/dsh-quick-send'
  config:
    phrasesFile: 'D:\shared-phrases\phrases.json'
```

3. **ZCode 侧必须填同一个文件**（ZCode 用环境变量 `QUICK_SEND_PHRASES`，见其 README）
4. 重启 DSH

> **关键纪律：两边路径必须完全一致。** 填错成两个不同文件，会表现为
> 「我在 DSH 加了，ZCode 看不到」——因为各写各的。

共享时双方遵循的契约：

| 层 | 字段 | 归属 |
|---|---|---|
| 内容 | `id` `title` `text` `category` `createdAt` `updatedAt` | **共享**，双写 |
| 视图 | `pinned` `order` | **各侧本地**，互不影响 |

- **双向写**，双方遵守同一纪律：全量读改写 + 临时文件原子替换 + 损坏 `.bad` 留证后空表启动
- 一方新增/修改后，另一方**重新打开面板即可看到**（每次打开都重新拉取）
- **`body` 必须叫 `text`**：ZCode 侧若保留旧字段名，DSH 读到的正文会是空的

完整契约见 [`docs/shared-phrases/CONTRACT.md`](https://github.com/wenliang9527/quick-send/blob/master/docs/shared-phrases/CONTRACT.md)。
ZCode 侧对接细节见 [`HANDOFF-DSH.md`](https://github.com/wenliang9527/quick-send/blob/master/docs/shared-phrases/HANDOFF-DSH.md)。

## 占位符支持矩阵

| 占位符 | @wenliang9527/dsh-quick-send | ZCode quick-send |
|---|---|---|
| `{{date}}` / `{{time}}` / `{{datetime}}` | ✅ 插入时展开 | ✅ |
| `{{workspace}}` | ⏸ 原样保留（首版） | ✅ 各侧各义 |
| `{{clipboard}}` | ❌ 不支持，原样保留 | ✅ 仅 ZCode |
| 未知 `{{xxx}}` | 原样保留 | 原样保留 |

> 在 DSH 侧建的短语不要用 `{{workspace}}` / `{{clipboard}}`，它们会被原样保留而不是展开。

## 配置

全部可选，不写就是默认值。写在 `cordis.patch.yml` 的 `config` 里（改完**重启 DSH** 生效）：

| 键 | 默认值 | 说明 |
|---|---|---|
| `phrasesFile` | `~/.dsh/quick-send/phrases.json` | 内容文件。**仅在共享时需要改**，见装法 B |
| `viewFile` | `~/.dsh/quick-send/view.json` | 本侧视图文件，一般不用改 |
| `panelSlot` | `'overlay'` | 面板容器：`overlay` 浮层不挤压输入框；`dock` 固定整行、不遮挡但会顶高输入区 |

也可以用环境变量覆盖（优先级低于 `config`）：
`DSH_QUICK_SEND_PHRASES_FILE` / `DSH_QUICK_SEND_VIEW_FILE`。

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

# 本地目录（开发时，路径换成你自己的仓库位置）
dsh plugin --profile desktop add link:<你的仓库>/plugins/dsh-quick-send
```

或在插件管理里装本地目录。装完**重启 DSH**（Host 半区改动需要重启），然后 `Ctrl+R` 刷新界面。

### pnpm store 路径问题

若安装报 `ERR_PNPM_UNEXPECTED_STORE`，说明 profile 的 `node_modules` 由另一个 store 链接而来。
**不要把全局 store 改掉，也不要重装已有依赖**，用原来的 store 装即可：

```powershell
node <dsh>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs add `
  link:<你的仓库>/plugins/dsh-quick-send `
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
│  └─ client.js             Client 半区：📚 按钮 + 浮层 + 侧边栏管理页（ModuleLoader bundle）
└─ test/
   ├─ store.test.mjs        存储、占位符、默认路径守门（28 项）
   ├─ client.test.mjs       Client 半区运行时测试（34 项，含 Hooks 顺序守门）
   ├─ e2e.test.mjs          真实 HTTP 端到端测试（25 项）
   └─ agent-tools.test.mjs  Agent 工具测试（25 项）
```

### 槽位选择

| 用途 | 槽位 | 为什么 |
|---|---|---|
| 触发按钮 | `conversation.input.left` | 输入框工具行，紧凑控件位 |
| 浮层面板 | `conversation.input.overlay` | 渲染在 composer 卡片内，**不挤压布局** |
| 侧边栏图标 | `sidebar.panellist` | 全局面板启动器，`id` 必须等于下面的 `key` |
| 管理页本体 | `main`（keyed） | 中央整块面板，`key` 必须等于上面的 `id` |

> **两个 id 必须严格同值（都是 `quick-send`）**：宿主侧栏的 PanelRow 自己绑
> `onClick → ctx.layout.selectPanel(id)`，而 `selectPanel` 只认 `main` keyed 槽里
> 同一个 key 的注册项。缺一处就会「点图标毫无反应」——`dsh-serial-panel` 踩过同样的坑。

> 曾用 `conversation.input.dock`（"Full-width entries above the composer card"），
> 它会让面板**撑高整个输入区、把输入框往下挤**，故改用 `overlay`。

## 测试

```bash
cd plugins/dsh-quick-send && npm test
# 或
node --test test/store.test.mjs test/client.test.mjs test/e2e.test.mjs test/agent-tools.test.mjs
```

**共 135 项，全部通过。**

### store.test.mjs（40 项）

- **占位符**：三个时间宏按本地时区、占位符内允许空格、`{{workspace}}`/`{{clipboard}}` 原样保留、
  未知占位符保留、多处出现各自展开、空/非字符串安全
- **占位符一致性**（2 项，0.3.2 新增）：从 `client.js` 源码抽出 `expandText` / `hasSupportedPlaceholder`
  现场编译，与 Host 版比对 20 个边界用例（`{{DATE}}`、`{{date`、`{{}}`、`{{{date}}}` 等），
  防止两份实现漂移
- **存储**：文件不存在返回空表、往返一致、中文换行引号无损、BOM 兼容、
  损坏文件隔离为 `.bad` 并空表启动、`schemaVersion` 过高抛错、缺字段抛错、重复 id 去重、未知字段丢弃
- **原子写**：不残留 `.tmp`、重复覆盖同一路径成功
- **视图**：缺失返回空对象、往返一致、非法字段规范化、损坏降级
- **合并排序**：置顶优先 → 分类 → order、同段内按 order、未分类排末尾、视图缺失补默认值
- **revision**（5 项，0.3.4 新增）：写入自增、外部写入的值不被抹掉（加法演进）、
  缺失按 0（老文件兼容）、非法/负数归一化为 0、外部推高后不回退
- **跨进程锁**（5 项，0.3.4 新增）：写完不残留锁文件、锁被占用时等待而非覆盖、
  过期锁（持有者崩溃残留）被抢占、mutate 抛错时锁也释放、mutate 幂等不产生重复条目

### client.test.mjs（39 项）

用最小 React 替身在 Node 里真实执行 `client.js` 的组件渲染，覆盖：

- **Hooks 顺序守门**（3 项）：`open=false` 与 `open=true` 的 Hook 数量必须一致、反复开关保持稳定、
  序号无断档 → 防止 Hook 被 `if (!open) return null` 跳过导致面板崩溃
- **两种形态**：浮层只渲「序号+标题」紧凑行（无正文预览、无按钮）、管理页渲完整卡片、
  两侧按钮集各不相同、管理页不依赖浮层开关
- **侧边栏注册**：`sidebar.panellist`（id）与 `main`（key）都已注册且同值
- **返回对话**：管理页有 `← 返回对话` 按钮且点击调 `selectPanel(null)`、
  浮层「管理」调 `selectPanel('quick-send')`、`layout` 缺席时不抛错、浮层无返回按钮
- **渲染**：关闭态返回 null、数据渲染、加载/出错/空态提示
- **插入链路**：`captureInsertion` + `insertText`、占位符按当天展开、
  返回 `false` 时重试两次、`phase=inert` 时不尝试
- **数字键**：`1-9` 直插第 N 条、搜索框有内容时不抢键、超出条目数无动作
- **删除二次确认**：首次点击只进待确认态
- **搜索/分类过滤**、**键盘导航**（`↓` 选中、`Enter` 插入、`Esc` 停在面板内）
- **i18n**：注册中英双语、两语言键集必须一致（防漏译）、无 locale 服务时退回中文、槽位注入的 `t` 优先
- **占位符预览**：含 `{{date}}` 时显示展开结果、无占位符时不显示
- **导入/导出**：隐藏 file input 存在且 accept 正确
- **数据路径提示**：拿到 `/paths` 时渲染、拿不到时整块不渲染
- **刷新**（3 项，0.3.3 新增）：管理页有 ⟳ 按钮且可点、浮层无刷新按钮、窗口重新可见时自动刷新
- **筛选记忆**（2 项，0.3.3 新增）：搜索词写入 `localStorage`、存储不可用时不崩溃

### e2e.test.mjs（31 项）

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
| **并发写**（3 项，0.3.2 新增） | 同时新增 8 条一条不丢、增删交错总数正确、目录不残留 `.tmp` |
| **同源校验**（3 项，0.3.2 新增） | 跨源 POST 403 且不改数据、跨源 GET 403、同源与无 Origin 放行 |

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

> ⚠️ 任何 publish / tag push 都要先确认版本号与轨道。
> 仓库：<https://github.com/wenliang9527/quick-send>（子目录 `plugins/dsh-quick-send`）。

## 已知限制

- **`{{workspace}}` 首版不展开**：DSH 侧"当前工作区"会随会话切换而变化，语义不可预测，故先原样保留。
- **`{{clipboard}}` 不支持**：浏览器侧拿不到剪贴板内容。
- **跨进程已加锁（0.3.4 起）**：ZCode 与 DSH 同时写同一份 `phrases.json` 时，靠
  `quick-send.lock`（与 ZCode 同名同目录）+ `revision` 双保险串行化，实测 4 进程并发
  32 条零丢失。**残留风险**：若其他客户端既不守锁也不写 revision（如很老的版本），
  仍可能被覆盖——此时 revision 校验能发现并重试，但不是绝对保证。
- **删除不跨侧同步视图**：本侧删除会清掉本侧 view 条目，另一侧的 view 残留会被忽略（不报错、不清理）。
- **长度上限 120 / 20000 / 20**（标题/正文/分类）：超长静默截断，不是契约规定，ZCode 侧若更小需对齐。
- **浮层插入后收起**：连点需重新打开（管理页不收起，可连插）。
- **数字键只到 9**：第 10 条起不绑数字键（两位数歧义且记不住），请用搜索框过滤。
- **键盘导航只在搜索框内生效**：从按钮点开面板后，需先点一下搜索框才能用 `↑`/`↓`/`Enter`/数字键。
- **`panelSlot` 改动需重启 DSH**：Client 半区通过 HTTP 读取该配置，不支持热切换槽位。
- **导入只做新增，不做去重**：同一文件导入两次会产生重复条目（id 不参与匹配）。
- **浮层不含编辑**：浮层只负责插入，新建/改写请走管理页（侧边栏 📚 或浮层上的「管理」按钮）。
- **占位符逻辑有两份实现**：Host 的 `src/expand.js` 是权威版，`client.js` 的 `expandText()`
  是浏览器侧副本（无法 import 宿主模块）。两者靠 `store.test.mjs` 里的一致性测试钉死
  （20 个边界用例 + 变异测试验证有效），改动任一侧漏改另一侧会立刻测试失败。

## 变更记录

### 0.3.4 —— 跨进程并发：文件锁 + revision

实现 CONTRACT §写入纪律 第 5 条的 ZCode↔DSH 跨进程协议。

| 层 | 机制 |
|---|---|
| 进程内 | `withWriteLock` 队列（0.3.2 已有） |
| **跨进程** | `quick-send.lock` 文件锁，**与 ZCode 同名同目录**，`create_new` 抢锁、25ms 轮询、5s 超时、10s 逾期抢占 |
| 兜底 | `revision` 比对，变化则重读重放 |

锁文件名与 ZCode 完全一致，两侧指向同一文件时天然互斥，**ZCode 无需改动即可受益**。

**实测教训**（已回写 CONTRACT）：契约原设想「revision + 毫秒级窗口撞不上」不成立——

```
仅 revision CAS：4 进程 × 8 次并发写，5 轮全部丢 1 条（31/32）
加文件锁后    ：同一场景 5/5 轮均 32/32，零丢失
```

revision 只能事后发现冲突，check 与 write 之间始终有窗口。必须用独占锁把读写整体串起来。

**mutate 幂等要求**：冲突重试会重放 mutate，id 必须在 mutate 外算好，
内部不得自增计数或重新生成 id，否则会写出重复条目。

**兼容性**：`revision` 是加法字段，`schemaVersion` 保持 1；老文件按 0 处理；
非法值归一化为 0；DSH 全量写同步保留该字段，不会无声抹掉。

测试 125 → 135。

### 0.3.3 —— 列表刷新 + 筛选记忆（纯前端）

便利性改进，Host 半区与数据契约零变化。

**修的问题**：管理页常驻，而数据刷新 effect 依赖 `[show]`，`show` 在 manage 模式恒为
`true` → effect 只在挂载时跑一次。于是「打开着管理页，让 AI 加一条常用语」看不到变化，
必须切走再切回。

- **⟳ 手动刷新按钮**：管理页头部新增，点一下重拉全量（不轮询，零后台开销）
- **窗口重新可见 / 获得焦点时自动刷新**：切回标签页、从最小化恢复都会静默重拉。
  失败时保留旧数据、不弹错——网络抖一下不该把界面变成错误页
- **搜索词与分类记忆**：存 `localStorage`，下次打开自动恢复；隐私模式下静默降级

浮层（quick 模式）刻意**不加**刷新按钮：它每次打开都会重拉，且定位是「点一下就走」。

测试 120 → 125。测试替身同步增强：`useEffect` 桩此前只记录 deps 不执行回调，
无法测试任何 effect 逻辑；现在记录回调并新增 `runEffects()` 按需执行。

### 0.3.2 —— 修复并发写丢数据 + 端点同源校验

**升级建议：所有用户。** 本版修复一个会导致常用语**静默丢失**的缺陷。

#### 1. 并发写丢数据（严重）

`atomicWrite` 用固定的 `<file>.tmp` 作临时名，两个并发写抢同一名字；同时
`read → modify → write` 之间无锁，双方读到同一份旧快照。实测结果：

```
2 个并发新增  → 只剩 1 条
3 个以上并发  → 剩 1 条 + ENOENT 崩溃
读改写交错    → 后写者覆盖先写者
```

**为什么 0.3.1 的 `isConcurrencySafe: false` 没挡住**：它只约束同一次对话内的
agent 工具调用，管不到面板连点「保存」、agent 工具与面板同时写、两个浏览器标签页。

修复：

| 层 | 改动 |
|---|---|
| 临时文件 | 唯一名 `<file>.<pid>.<seq>.<rand>.tmp`，失败时清理自己的临时文件 |
| 读改写 | 新增 `mutatePhrases` / `mutateView`，把整个「读 → 改 → 写」放进进程内串行队列 |
| 接入点 | `index.js` 的 save/remove/setView/reorder、`agent-tools.js` 的 add/update/delete 全部改走原子读改写 |

`reorder` 顺带修正：原先用外部快照算顺序再单独读视图，现在把「读快照 + 归一化 + 交换」放进同一把锁。

#### 2. 端点同源校验

6 个端点挂在 loopback 且无鉴权，本机任意恶意网页可用 `fetch` 删光或读走常用语。
现对带 `Origin` 且 host 与 `Host` 不一致的请求返回 403；无 `Origin`（curl/服务端）放行。

#### 3. 占位符一致性守卫

Host `src/expand.js` 与 `client.js` 的 `expandText()` 是两份实现。新增测试抽源码现场编译
比对 20 个边界用例，并用**变异测试**验证有效性（把 `-` 改成 `/` 会立刻报错）。

#### 4. 发布元数据

- 新增 `LICENSE`（MIT，与 `package.json` 一致）与 `CHANGELOG.md`，均纳入 npm 包
- `index.js` 补注释说明 `inject: []` 为何是有意设计（见「端点安全」与 DEV-NOTES §3）

#### 测试 112 → 120

| 文件 | 项数 | 新增 |
|---|---|---|
| `store.test.mjs` | 30 | +2 占位符一致性 |
| `client.test.mjs` | 34 | — |
| `e2e.test.mjs` | 31 | +3 并发写、+3 同源校验 |
| `agent-tools.test.mjs` | 25 | — |

### 0.3.1 —— 文案对齐（代码零改动）

0.3.0 改了两个界面的结构，但有 3 处说明文字还在讲旧的单面板形态，容易被误导。
本版**只改文案，不动一行逻辑**，测试仍为 112 项全过。

- `package.json` 的 `description`：从「输入框**上方**的常用语**面板**，一键填入草稿」
  改为「**浮层**一键插到光标处，**侧边栏管理页**负责增删改与排序」。
  这一处会显示在 **npm 搜索页和插件市场**里，影响陌生人的第一印象。
- 插件 `README.md` 首段：同步为「浮层插入 + 侧边栏管理页维护」。
- `src/client.js` 顶部槽位注释：补齐 `sidebar.panellist` + `main` 两个槽位，
  并写明 **`id` 必须等于 `key`**（缺一处就会「点侧边栏图标毫无反应」）。

> 如果你是从 0.3.0 升级：**功能完全一致，只是说明文字更准确**。
> 已经装好并用着 0.3.0 的话，可以不升。

### 0.3.0 —— 浮层瘦身 + 侧边栏管理页

**解决「一屏只看得到两条」的可用性问题。**

- **浮层改为紧凑形态**：每条从「标题 + 正文预览 + 6 个按钮」（约 70px）压到
  **「序号 + 标题」一行**（约 26px），9 条一屏全见。正文预览与操作按钮全部移走。
- **新增侧边栏管理页**：侧边栏出现 📚 图标，点开是**中央整块面板**，承担全部维护工作
  （新建/编辑/删除/搜索/分类/置顶/排序/导入导出）。
  机制同 `dsh-serial-panel`：`sidebar.panellist`（id）+ `main`（keyed，同 key）两处注册。
- **数字键直插**：浮层搜索框为空时，按 `1`-`9` 直接插入第 N 条。
  搜索框有内容时不生效，避免抢走用户输入。
- **一处实现两处复用**：同一组件靠 `props.__mode` 切换 `quick` / `manage`，
  Hook 数量完全一致（`client.test.mjs` 有守门用例），不存在两套代码漂移。
- **行为差异**：浮层插入后收起（贴合"插完就走"）；管理页常驻不收起（方便连插、连续整理）。
- **管理页可返回对话**：左上角 `← 返回对话` 调 `layout.selectPanel(null)`
  （契约里 `null` 即"显示 Conversation"）。有未保存改动时先确认。
- **测试**：96 → **112 项**，新增紧凑行/管理页形态、数字键、侧边栏注册同值、返回对话等 16 项。

### 0.2.2 —— 修复默认数据路径写死作者机器路径

**这是一个会影响所有非作者用户的 bug，建议升级。**

- **修复**：`defaultPhrasesFile()` 的默认值原本是 `D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json`
  （开发机路径被当成默认值），现改为 `~/.dsh/quick-send/phrases.json`。
  旧默认值的后果不是报错，而是陌生人保存时会在**自己的 D 盘**凭空创建
  `WORK_VSCODE\Vibe-coding\shared-phrases\` 目录，看起来能用但污染磁盘。
- **行为变化**：不配置 `phrasesFile` 时，数据落在 `~/.dsh/quick-send/phrases.json`。
  **原本靠旧默认值共享的用户**（比如与 ZCode 共用），需要显式配置 `phrasesFile`
  指回原共享文件，否则会看到空列表——**旧数据不会丢失，只是不再被默认读到**。
  本机已在此 profile 的 `cordis.patch.yml` 里补上该配置。
- **新增**：面板底部显示当前实际使用的数据文件路径，点击可复制。
- **文档**：README 拆成「装法 A 只自己用（零操作）」与「装法 B 与 ZCode 共享」；
  新增「数据存哪」路径表。
- **测试**：新增 3 条回归守门（默认路径必须位于 `homedir()` 下、不得含 `WORK_VSCODE`、
  环境变量可覆盖）+ 2 条面板路径显示用例，共 101 项通过。

### 0.2.1 / 0.2.0 —— 仅文档 / Agent 工具

见 git 历史。0.2.0 新增 4 个 agent 工具（`quick_send_list/add/update/delete`），
0.2.1 为纯文档更新（补充「让 AI 帮你总结归纳常用语」用法）。

# DSH 侧交接说明（给 ZCode quick-send 开发者）

> 状态：DSH 侧已实现并验证通过（**v0.3.1，112 项测试全绿**），等待 ZCode 侧对接
> 契约文件：[`CONTRACT.md`](CONTRACT.md)（同目录）
> 本文只讲**对接时容易踩的坑**和**已验证的行为**，契约本身请看上面那份

---

## 1. 现状

| 侧 | 状态 |
|---|---|
| DSH `dsh-quick-send` | ✅ 已装进 `desktop` profile，`fiberPhase: active`，运行中 |
| 共享文件 | ✅ 已建立，运行期数据以实际文件为准（条目数会随时变化，不在文档里固定） |
| ZCode 侧 | ⏳ 待改造 `store.rs`（见 CONTRACT.md 末尾「ZCode 待办」） |

**双向链路已实测**：ZCode 侧那条"新建笔记"（id 为 UUID，非 `dsh-` 前缀）已被 DSH 正确读取并展示。DSH 侧写入的条目也已在共享文件中，ZCode 侧改造后即可读到。

### DSH 侧已具备的能力（供对齐参考，均不影响共享契约）

| 能力 | 说明 | 是否影响 ZCode |
|---|---|---|
| 插入到光标处 | `captureInsertion()` + `insertText()`，一次可撤销 | ❌ 纯 DSH 内部 |
| **两个界面（v0.3.0）** | 浮层只管插入；侧边栏中央面板只管维护。见 §13 | ❌ 纯 DSH 内部 |
| 分类 / 搜索 / 置顶 / 排序 | 分类在共享侧，置顶排序在本侧 `view.json` | ✅ 分类字段共享 |
| 占位符预览 | 编辑区里实时显示 `{{date}}` 展开结果 | ❌ |
| 导入 / 导出 | 纯客户端 Blob + FileReader，导出六字段 JSON | ⚠️ 见 §11 |
| 中英双语 | 跟随 DSH 语言设置，中英各一份字典（键集有测试保证一致） | ❌ |
| 删除二次确认 | 面板内点两次，不用原生弹窗 | ❌ |
| **Agent 可读写（v0.2.0）** | 4 个模型工具：`quick_send_list/add/update/delete` | ⚠️ 见 §12 |

> **v0.2.0 重点**：DSH 侧 agent 现在能直接读写常用语，支持「让 AI 总结归纳常用语」。
> update/delete **仅按 id 定位**（标题可能重复），delete 必须 `confirm: true`。
> 详见 §12。
>
> **v0.2.2 重点**：默认数据路径不再写死作者机器目录，改为 `~/.dsh/quick-send/phrases.json`；
> 共享改为显式配置 `phrasesFile`。**ZCode `store.rs` 有同样的问题，务必一并修**（见 CONTRACT.md）。
>
> **v0.3.0 重点**：界面拆成浮层（插入）+ 侧边栏管理页（维护），纯 DSH 内部改动，
> 不影响共享契约与数据格式。详见 §13。

---

## 2. 共享文件实际长相（DSH 已写入的真实数据）

```json
{
  "schemaVersion": 1,
  "phrases": [
    {
      "id": "dsh-mw1hdeu9-tau9",
      "title": "复位日志采集",
      "text": "采集复位后 10s 的日志，重点看 {{date}} 之后新增的报错，汇总成表格。",
      "category": "嵌入式",
      "createdAt": "2026-11-04T02:11:30.273Z",
      "updatedAt": "2026-11-04T02:11:30.273Z"
    }
  ]
}
```

**注意三条：**

1. `phrases` 里每条**严格只有六个字段**，顺序为 `id, title, text, category, createdAt, updatedAt`（顺序不重要，齐全才重要）。
2. **没有** `pinned` / `order` —— 它们在各自的 `view.json` 里。
3. 文件末尾有换行符，缩进 2 空格（不强制，但保持可读）。

---

## 3. 必须遵守的硬约束

### 3.1 字段形状

DSH 侧读取时会**规范化并丢弃未知字段**（`store.js: normalizePhrase`）。所以：

- ✅ 多写的字段 → 被静默丢弃，不会报错，但下次 DSH 写入就没了
- ❌ 少写 `text` → 该条被跳过
- ❌ 写 `body` 而不是 `text` → 该条 `text` 为空且无 `title` 时被丢弃

**如果 ZCode 侧保留 `body` 字段名，DSH 读到的会是空正文。请务必改名 `body` → `text`。**

### 3.2 `schemaVersion`

- 读：`version > 1` → DSH **抛错并拒绝**，不静默降级（避免破坏新版本数据）
- 缺 `schemaVersion` → DSH 抛错
- 写：DSH 永远写 `schemaVersion: 1`

**ZCode 侧请同样写入 `1`。**

### 3.3 时间戳格式

**ISO 8601 字符串**，如 `"2026-11-04T02:11:30.273Z"`。

⚠️ 不要写成毫秒时间戳数字。DSH 侧 `isStr()` 校验不通过时会回退成"当前时间"，导致排序错乱。

### 3.4 id

- DSH 生成：`dsh-<base36时间>-<4位随机>`，如 `dsh-mw1hdeu9-tau9`
- ZCode 现有：`纳秒-pid-计数` 或 UUID（如 `a45019d5-eb19-4426-a198-b0299e35b0a6`）
- **DSH 不做任何 id 格式校验**，只要求唯一。重复 id 时 DSH 保留第一条并丢弃后续（`store.js` 的 `seen` 去重）
- **不需要为旧数据重新生成 id**，UUID 完全可以

---

## 4. 写入纪律（双方一致，DSH 已按此实现）

```
1. 全量读改写      —— 不基于内存缓存做增量 patch
2. 临时文件原子替换 —— 写 <file>.tmp → rename 覆盖
3. 损坏自愈        —— JSON 解析失败 → 原文件改名 <file>.bad-<时间戳> → 空表启动
4. last-write-wins —— 单用户跨两窗口手点，毫秒级窗口物理上撞不上，不做文件锁
```

**DSH 侧实现细节（供参考）**：

```js
// store.js: atomicWrite
await fs.promises.writeFile(tmp, text, 'utf8')
try {
  await fs.promises.rename(tmp, file)
} catch (e) {
  // Windows: 目标已存在时 rename 失败，退化为先删后改名
  if (e.code === 'EEXIST' || e.code === 'EPERM') {
    await fs.promises.rm(file, { force: true })
    await fs.promises.rename(tmp, file)
  } else throw e
}
```

> ⚠️ **Windows 上的坑**：`std::fs::rename` / `fs.rename` 在目标已存在时行为不同。
> Rust 的 `std::fs::rename` 在 Windows 上**可以覆盖**已存在文件，所以 ZCode 侧现有实现可能没问题；
> 但如果用了 `rename` 以外的替换方式，请确认能覆盖。

---

## 5. DSH 侧已验证的行为（ZCode 侧应对齐）

以下是 DSH 单测 + 端到端测试覆盖的行为，建议 ZCode 侧对齐：

| 行为 | DSH 结果 | 备注 |
|---|---|---|
| 空正文 `text: "   "` | 拒绝，400 / 报错 | DSH 校验 `text.trim() !== ''` |
| 标题可空 | 允许，存空串 | 面板显示时用正文首行降级 |
| 分类可空 | 允许，存空串 | 未分类排在同段末尾 |
| `title` 长度上限 | 120 字符截断 | `MAX_TITLE` |
| `text` 长度上限 | 20000 字符截断 | `MAX_TEXT` |
| `category` 长度上限 | 20 字符截断 | `MAX_CATEGORY` |
| 中文 / 换行 / 引号 | 逐字节无损 | UTF-8 读写 |
| BOM 开头文件 | 可正常解析（剥掉 BOM） | `\ufeff` |
| 重复 id | 只保留第一条 | 不报错 |
| 未知字段 | 静默丢弃 | |
| 视图引用不存在的 id | 忽略，不报错、不清理 | |

**长度上限如果和 ZCode 不一致**，不会报错，但会导致"某侧能存、另一侧读进来被截断"。建议双方统一，或至少 DSH 侧的 120 / 20000 / 20 是**上界**。

---

## 6. 占位符

| 占位符 | DSH | ZCode | 说明 |
|---|---|---|---|
| `{{date}}` | ✅ 填入时展开 | ✅ | `YYYY-MM-DD` |
| `{{time}}` | ✅ 填入时展开 | ✅ | `HH:mm` |
| `{{datetime}}` | ✅ 填入时展开 | ✅ | `YYYY-MM-DD HH:mm:ss` |
| `{{workspace}}` | ⏸ **原样保留** | ✅ 各侧各义 | DSH 首版不展开，见下 |
| `{{clipboard}}` | ❌ **原样保留** | ✅ 仅 ZCode | DSH 拿不到剪贴板 |
| 未知 `{{xxx}}` | 原样保留 | 原样保留 | 天然兼容 |

**关键点：展开发生在"使用时"，不在"存储时"。** 共享文件里永远存 `{{date}}` 原文，各侧用自己的规则展开。

**`{{workspace}}` 为什么不展开**：DSH 侧的"当前工作区"会随会话切换而变化（一个 DSH profile 下有多个 workspace），同一条短语在不同会话里点会展开出不同值，语义不可预测。故先原样保留。如果将来要支持，需要满足"点之前能看到展开结果"这个条件。

**`{{clipboard}}` 建议不要砍 ZCode 的代码**，只是文档标注"DSH 侧不展开"。用户在 DSH 建的短语里写它，会被原样保留而不是静默吃掉——比展开成空串更不容易误导。

---

## 7. ZCode 侧改造清单

```
□ store.rs: 内容层改读 phrases.json（路径可配置，建议经 plugin.json userConfig 注入）
□ store.rs: 叠加本地 view.json 合成现有 Snippet 结构
□ store.rs: body → text 字段名对齐
□ store.rs: 写入时保持六字段严格形状 + schemaVersion: 1
□ store.rs: 时间戳用 ISO 字符串（如果原来是数字，需要改）
□ 一次性迁移：${ZCODE_PLUGIN_DATA}/snippets.json → phrases.json + view.json
            body → text；pinned/order → view.json；旧文件保留备份不删
□ 工具协议与面板 app.js 期望零变化
□ 51 项测试回归 + 新增共享文件读写用例
□ v0.5.0
```

**迁移映射表：**

| 旧 `snippets.json` | 新位置 |
|---|---|
| `snippets[].id` | `phrases[].id` 原样 |
| `snippets[].title` | `phrases[].title` 原样 |
| `snippets[].body` | **`phrases[].text`**（改名） |
| `snippets[].category` | `phrases[].category` 原样 |
| `snippets[].createdAt` | `phrases[].createdAt` 原样（已是 ISO） |
| `snippets[].updatedAt` | `phrases[].updatedAt` 原样 |
| `snippets[].pinned` | **`view.json[id].pinned`** |
| `snippets[].order` | **`view.json[id].order`** |

---

## 8. DSH 侧代码位置（可直接参考）

```
D:\WORK_VSCODE\Vibe-coding\quick-send\plugins\dsh-quick-send\
├─ src\store.js            ← 共享读写 / 规范化 / 原子写 / 自愈（核心逻辑）
├─ src\expand.js           ← 占位符展开（纯函数，可直接对照）
├─ src\index.js            ← HTTP 端点（CRUD 逻辑）
├─ src\agent-tools.js      ← 4 个 agent 工具（见 §12）
├─ src\client.js           ← 界面（浮层 + 侧边栏管理页，ZCode 侧不用管）
└─ test\                   ← 112 项（store 28 / client 34 / e2e 25 / agent-tools 25）
```

**`store.js` 里的 `normalizePhrase` 就是契约的权威实现**，ZCode 侧对字段的处理可以逐条对照。

---

## 9. 已知偏差 / 待确认

1. **DSH 的插入方式已改为 `insertText`（光标插入），不再用 `setDraft`**
   → 早期版本用 `setDraft`（追加到末尾）；现已改为 `captureInsertion()` + `insertText(text, span)`，
   插到光标处、一次可撤销，并能区分四种失败原因（正在发送 / 不可编辑 / 未接上 / 草稿版本变了）。
   **此项不影响共享契约**，只是 DSH 侧的草稿写入方式。

2. **长度上限 120 / 20000 / 20 是我定的，不是契约规定的**
   → 如果 ZCode 侧的上限更小，需要双方对齐，否则会出现"存进去但读出来被截断"。

3. **DSH 侧不清理 `view.json` 里指向已删除短语的条目**
   → 读取时忽略。如果 ZCode 侧会清理，双方行为不同但不会互相破坏。

4. **删除操作不跨侧同步视图**
   → DSH 删除时会清掉自己的 view 条目；ZCode 侧的残留会被忽略。反向同理。

5. **DSH 侧长度超限是「静默截断」，不是报错**
   → 若 ZCode 侧是报错拒绝，会出现"DSH 存得进、ZCode 读出来报错"的观感差异。建议双方都用截断。

---

## 10. 快速自测（ZCode 侧改造后）

> ⚠️ **DSH 的 Web GUI 端口每次重启都会变**（`http://127.0.0.1:<port>`）。
> 用当前会话上下文给出的 URL，或看 DSH 窗口标题栏。下面的 `63809` 只是历史示例，**不要照抄**。

```bash
# 0. 先确认端口，换成你实际的
#    当前 DSH Web GUI URL 会在会话上下文里给出

# 1. DSH 侧写一条，看 ZCode 能不能读到
curl -X POST http://127.0.0.1:<port>/__quick-send/save \
  -H "content-type: application/json" \
  -d '{"title":"跨侧测试","text":"来自 DSH 的 {{date}}","category":"测试"}'

# 2. 直接看共享文件（路径以两侧实际配置为准，此处用默认共享文件举例）
type D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json
```

只要 ZCode 面板能刷出"跨侧测试"这条，且点开 `{{date}}` 能展开成当天日期，就算对接成功。

**反向验证**：在 ZCode 面板里新建一条 → 到 DSH 面板点 📚 重新打开（面板每次打开都会重新拉取 `/__quick-send/list`）→ 应能立即看到。

---

## 11. 导入 / 导出（新能力，唯一需要双方对齐的点）

DSH 侧新增了纯客户端的导入导出按钮（`↑` 导出 / `↓` 导入），**不影响 `phrases.json` 契约**，但有两点需要 ZCode 侧知道：

### 11.1 导出格式与共享契约一致

导出文件就是契约结构的快照，只多一个 `exportedAt`：

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-11-04T12:00:00.000Z",
  "phrases": [
    { "id": "...", "title": "...", "text": "...", "category": "...",
      "createdAt": "...", "updatedAt": "..." }
  ]
}
```

- **六字段齐全**，字段名与 `phrases.json` 完全一致
- **不含 `pinned` / `order`**（视图不导出，符合"内容共享、视图本侧"的分层）
- ZCode 侧如果要做导出，**建议用同一格式**，这样两边的导出文件可以互相导入

### 11.2 导入是「只新增」，不按 id 去重

导入实现是逐条调 `POST /__quick-send/save`，**不带 id**（让 Host 生成新 id）：

- 同一文件导入两次 → **产生重复条目**
- 想避免重复：导入前先清空，或手工去重
- ZCode 侧若做导入，**建议同样语义**（简单、可预期），不要做隐式 merge

### 11.3 导入时会丢弃的字段

导入只取 `title` / `text` / `category` 三个字段：

- `id` 丢弃（重新生成，避免与现有条目撞 id）
- `createdAt` / `updatedAt` 丢弃（用导入时刻）
- **`text` 为空的条目会被跳过**

如果 ZCode 侧要保留原始时间戳，需要各自的导入实现里显式处理——**这不是契约要求**，属于各侧自由。

---

## 12. Agent 工具（v0.2.0 新增）

DSH 侧向 `ctx.tools` 注册了 4 个模型可调用工具，让 AI 能直接读写常用语。

### 12.1 工具清单

| 工具 | 作用 | 关键约束 |
|---|---|---|
| `quick_send_list` | 列出，支持 `category` / `query` / `includeText` | 只读，可并发；默认不返回正文（省 token） |
| `quick_send_add` | 新增一条 | `text` 必填；超长静默截断 |
| `quick_send_update` | 修改一条 | **仅按 `id` 定位**，只改传入字段 |
| `quick_send_delete` | 删除一条 | **仅按 `id` 定位** + **必须 `confirm: true`** |

### 12.2 为什么 update/delete 只认 id（ZCode 侧务必对齐）

**标题可以重复**——共享文件不禁止同名条目。如果允许按标题定位，模型会静默改错/删错。

DSH 侧的做法：
- `delete` 参数严格只有 `{ id, confirm }`
- `update` 的 `title` 是「要改成的新值」，**不是定位参数**
- 只传 `title` 不带 `id` → 报错「缺少 id；请先调用 quick_send_list 获取」
- 工具 description 里明确要求「先 list 拿 id，再 update/delete」

**ZCode 侧建议检查**：现有 `save_snippet` / `delete_snippet` 若支持按标题匹配，应考虑收紧为仅 id，
或至少在文档里标注同名条目的行为。

### 12.3 `dsh-agent-` 前缀与跨侧溯源

- DSH 侧新建条目 id 带 `dsh-agent-`（如 `dsh-agent-mw1sjfiv-leng`），便于人工辨认
- **契约只要求 id 唯一，前缀无语义约束**
- ZCode 侧 agent 建的条目是纳秒时间戳 id，**没有统一前缀**，所以「按前缀识别」**只在 DSH 侧成立**
- `update` 时不改原 id（否则另一侧的 `view.json` 里 pinned/order 会失效）

**跨侧溯源的零成本做法**：分类命名约定。让 agent 把整理的条目写进 `agent/` 开头的分类
（如 `agent/整理`），`category` 本就是自由字符串，两侧面板都能按分类过滤。
DSH 侧对此给的是**建议而非强制**，写进了工具 description。

### 12.4 归纳纪律（写进工具 description，模型会遵守）

用户的核心用法是「**让 AI 总结归纳常用语**」，DSH 侧在 description 里固化了这几条：

- 先 `quick_send_list` 查重，再写入，避免存出重复短语
- **一条只讲一件事**，不把多个意图塞进同一条
- 标题简短便于识别，正文写成能直接插入发送的完整句子（不是指令性备注）
- 需要动态内容时写 `{{date}}` 等占位符，不要写死日期

### 12.5 并发安全

- 写操作（add/update/delete）都标 `isConcurrencySafe: false`，同一次对话内不并发写文件
- 跨侧同时写仍遵守契约 §4：全量读改写 + 原子替换 + last-write-wins
- 对「单用户手点」和「低频 agent 写入」都成立

### 12.6 ZCode 侧待办（方案乙，可选）

ZCode 侧从 v0.2 起已有 `save_snippet` / `list_snippets` / `delete_snippet`，**不缺单条写入能力**。
缺的是**批量**与**整理流程**：

- `bulk_add_snippets`：一次读改写写入多条，比 N 次单条 add 快且减少并发窗口
- `/quick-send-整理` 命令：用户主动触发 → AI 读对话 → 出草稿 → 用户确认 → 批量入库

做完后两侧能力对称：任一侧 agent 都能「整理 → 查重 → 草稿 → 确认 → 入库」。

---

## 13. 两个界面（v0.3.0，纯 DSH 内部改动）

> **对 ZCode 侧无影响**：数据格式、契约、共享文件全未改动。
> 这一节只是让 ZCode 侧知道 DSH 现在长什么样，避免沟通时说岔。

### 13.1 为什么拆

原浮层每行是「标题 + 正文预览 + 6 个按钮」，约 70px 高。9 条要滚三四屏，
一屏实际只看得到两条——实用性问题，与契约无关。

### 13.2 拆成什么样

| 界面 | 入口 | 槽位 | 职责 | 行高 |
|---|---|---|---|---|
| **浮层** | 输入框工具行 📚 | `conversation.input.overlay` | **只插入** | ~26px（序号+标题） |
| **管理页** | 侧边栏 📚 | `sidebar.panellist` + `main` | **只维护** | 完整卡片 |

- 浮层三种插入：点整行 / 按 `1`-`9` / 搜索后回车
- 数字键仅在搜索框为空时生效，超过 9 条不绑
- 管理页承担全部 CRUD / 搜索 / 分类 / 置顶 / 排序 / 导入导出
- 管理页左上角 `← 返回对话`，调 `layout.selectPanel(null)`

### 13.3 一处实现两处复用

同一组件靠 `props.__mode` 切 `quick` / `manage`，Hook 数量严格一致
（`client.test.mjs` 有守门用例）。不存在两套 UI 代码，也就不会漂移。

**行为差异是有意的**：浮层插入后收起（插完就走）；管理页常驻不收起（方便连插）。

### 13.4 侧边栏注册的坑（ZCode 若也做面板可参考）

`sidebar.panellist` 的 `id` 与 `main` keyed 槽的 `key` **必须严格同值**。
宿主侧栏的 PanelRow 自己绑 `onClick → ctx.layout.selectPanel(id)`，而 `selectPanel`
只认 `main` 里同 key 的注册项，缺一处就「点图标毫无反应」。
`dsh-serial-panel` 和 `dsh-ocdup-panel` 都踩过这个坑。

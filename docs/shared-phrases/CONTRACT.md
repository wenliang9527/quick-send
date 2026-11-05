# 共享常用语契约（ZCode `quick-send` ↔ DSH `dsh-quick-send`）

> 状态：已定稿 · 双方共同实现
> 内容源：两侧各自配置，**必须指向同一个文件**才能共享
> 本文位置：`quick-send` 仓库的 `docs/shared-phrases/CONTRACT.md`（与代码同仓库，便于版本追溯）

## 分层原则

**内容**放共享侧，**视图**放各侧本地。

| 层 | 字段 | 存放位置 |
|---|---|---|
| 内容 | `id` `title` `text` `category` `createdAt` `updatedAt` | 共享 `phrases.json` |
| 视图 | `pinned` `order` | 各侧自己的 `view.json` |

`title` 属于内容：它是用户给短语起的名字，与 `category` 同级。不砍，避免 ZCode 现有数据被迫改观感。

## 数据文件位置（默认值纪律）

**共享是可选增强，不是前提。** 两侧都必须在「不配置」时自包含可用：

| 侧 | 内容文件默认值 | 配置方式 |
|---|---|---|
| DSH | `~/.dsh/quick-send/phrases.json` | `cordis.patch.yml` 的 `config.phrasesFile`<br>或环境变量 `DSH_QUICK_SEND_PHRASES_FILE` |
| ZCode | `${ZCODE_PLUGIN_DATA}/phrases.json` | 环境变量 `QUICK_SEND_PHRASES` |

> ⚠️ **硬纪律：源码里不得出现任何具体的盘符或作者机器路径作为默认值。**
>
> 历史教训：0.1.0/0.2.1 的 DSH `src/store.js` 与 ZCode `store.rs` 都把
> `D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json` 写死成默认值。
> 后果不是崩溃而是更糟——陌生人安装后，`atomicWrite` 会在**他自己的 D 盘**
> 凭空 mkdir 出 `WORK_VSCODE\Vibe-coding\shared-phrases\`，看起来能用但污染磁盘。
>
> DSH 侧已在 **0.2.2** 修复（默认改为 `~/.dsh/quick-send/phrases.json`，并加了回归测试
> 断言默认路径不含 `WORK_VSCODE`、必须位于 `homedir()` 下）。
> **ZCode 侧已在 0.5.6 修复**（`phrases_path()` 默认 `data_dir().join("phrases.json")`
> + 回归单测），详见文末「ZCode 待办」的回填说明。

**共享时的唯一要求：两侧 `phrasesFile` 必须指向完全相同的文件。**
指向两个不同文件不会报错，只会表现为「我在 A 加了，B 看不到」——最难排查的一类故障。

## 共享文件格式

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "phrases": [
    {
      "id": "dsh-mf3k2a-7x1q",
      "title": "可空串",
      "text": "正文，含 {{date}} 等占位符",
      "category": "可空串",
      "createdAt": "2026-11-05T10:00:00.000Z",
      "updatedAt": "2026-11-05T10:00:00.000Z"
    }
  ]
}
```

- `schemaVersion`：整数，当前 `1`。读到大版本不认识时**拒绝写入**并提示，不静默降级。
- `revision`：整数，**可选**（缺省按 `0`）。跨进程乐观锁载体，见「写入纪律」第 5 条。
  写者每次写入应 +1 且**永不回退**；读方不得因不认识该字段而在写回时丢弃它。
  **双侧均已实现**：DSH 0.3.4 起、ZCode 0.5.7 起。两侧都是「缺字段按 0、全量写保留并 +1」，
  且读侧都容忍未知字段（DSH 用 `JSON.parse` 原样保留；ZCode `SharedFile` 用 `#[serde(default)]`，
  仓库内无 `deny_unknown_fields`）——所以任一侧先升级都不会让对方解析失败。
- `title` / `category` 允许空串。
- `createdAt` / `updatedAt`：ISO 8601 字符串（两侧同格式，避免 ZCode 的 ISO 与早期 DSH 数字时间戳冲突）。

## 本地视图文件格式

```json
{ "<phraseId>": { "pinned": false, "order": 0 } }
```

- ZCode 侧：`${ZCODE_PLUGIN_DATA}/view.json`
- DSH 侧：`~/.dsh/quick-send/view.json`
- 缺项的 id 视为 `{ pinned: false, order: 0 }`；view 里存在但共享侧已删除的 id 直接忽略（不清理、不报错）。

## 写入纪律（双方一致）

1. **双向写**，谁都能增删改。
2. **全量读改写**：不基于内存缓存做增量 patch。
3. **原子替换**：写**唯一**临时文件（`<file>.<pid>.<序号>.<随机>.tmp`）→ rename 覆盖目标。
   固定 `<file>.tmp` 是实测事故（DSH 0.3.2）：并发双方抢同一个 tmp，一方 rename 走后另一方
   ENOENT 崩溃、交错丢更新。失败时各自清理自己的 tmp。
4. **损坏自愈**：解析失败 → 原文件改名 `<file>.bad`（留证）→ 空表启动，不丢旧数据证据。
5. **并发**（分层处理，2026-11-05 定稿；同日 DSH 0.3.4 + ZCode 0.5.7 双侧闭环）：
   - **进程内**：必须串行——DSH 0.3.2 `mutatePhrases`/`mutateView` 队列；ZCode 单线程循环天然串行。
   - **跨进程 lockfile（ZCode↔ZCode 与 ZCode↔DSH 共用同一把锁）**：`<phrases.json 所在目录>/quick-send.lock`，
     create_new 抢锁 + 25ms 重试至 5s + 持有者逾期 10s 崩溃残留抢占。
     **勘误（ZCode 0.5.7）**：ZCode 0.5.6 曾把锁放在自己的插件数据目录——与 DSH 各锁各的、
     等于没锁（DSH 0.3.4 注释「两侧目录相同→天然互斥」的前提并不成立）；0.5.7 起移到
     phrases.json 同目录，跨侧互斥才真正成立。装法 A（自包含）下 phrases 就在数据目录，行为不变。
     - **成立条件是「文件名一致 + 目录一致」**，缺一不可。锚点：DSH `dirname(phrasesFile)`；
       ZCode ≥0.5.7 `phrases_path().parent()`。两者指向同一个 `quick-send.lock` 才算同一把锁。
     - **跨实现实测（2026-11-05，DSH 侧执行，ZCode exe 版本经 serverInfo 确认为 0.5.7）**：
       同一临时目录、同一 `phrases.json`，ZCode server 连写 12 条 + DSH `mutatePhrases` 连写 12 条：

       | 锁位置 | 结果（3 轮） |
       |---|---|
       | 同目录（= 0.5.7 实际行为） | **24 / 24 / 24**，零丢失 |
       | 不同目录（复刻 0.5.6 行为） | **22 / 22 / 23**，每轮都丢 |

       这组反向对照是关键：若两行都零丢失，只能说明测试没敏感度；出现差异才证明
       「零丢失来自同目录同一把锁，而非巧合」。轮询也直接观察到锁文件在
       `phrases.json` 同目录被反复创建/释放（4 次创建 3 次释放）。
     - ⚠️ 判据别只看条数：还要确认 `serverInfo.version` 是 0.5.7。
       拿旧 exe 跑出「零丢失」是假绿——恰恰因为锁放错了目录才检测不到竞争。
   - **辅助：revision 校验（双侧已实现）**。共享文件顶层 `revision: u64`，写者在锁内读 rev、
     写 rev+1；落盘前与磁盘当前值比对，发现变化即整操作重读重放（DSH `CAS_RETRIES=5`；
     ZCode 0.5.7 起同样实现，冲突重放 ≤5 次）。这一层防的是「不守锁的写者」（老版本）。
     - **schemaVersion 保持 1**（加法演进，缺字段按 0）。**双侧全量写均已保留 revision 字段**
       （DSH 0.3.4 起；ZCode 0.5.7 起——不保留会把对方的 CAS 无声打瞎）。
     - ⚠️ **实测教训：只靠 revision 不够**。4 进程 × 8 次并发写，仅用 revision CAS 仍稳定丢
       1 条（31/32）——check 与 write 之间的窗口无法消除。加文件锁后同一场景 5/5 轮均 32/32。
       契约原文「双侧实现前维持 last-write-wins」的乐观假设（毫秒级窗口撞不上）在批量写场景
       不成立，故本版直接上了锁。
     - ⚠️ **mutate 必须幂等**：冲突重试会重放 mutate，其内部不得做自增计数或重新生成 id
       （id 应在 mutate 外算好后传入），否则重试会写出重复条目。DSH 侧 5 条测试锁住此点。

## Agent 写入（双方共同约定）

AI 现在可以直接读写常用语。双方各自实现，但**行为必须一致**：

| 约定 | 说明 |
|---|---|
| **定位只用 id** | 标题可能重复，禁止按标题定位 update/delete |
| **删除必须二次确认** | 模型侧要显式 `confirm: true`，不能一次调用就删 |
| **先查重再写入** | 写入前先 list，避免存出重复短语 |
| **一条只讲一件事** | 不把多个意图塞进同一条 |
| **结果需人工确认** | Agent 只写入库，不自动发送/插入 |

**id 前缀**：DSH 侧 agent 新建用 `dsh-agent-`，便于辨认。契约只要求 id 唯一，**前缀无语义约束**，
所以「按前缀识别 agent 条目」只在 DSH 侧成立。跨侧追溯建议用**分类命名约定**
（如 `agent/整理`），`category` 是自由字符串，零契约改动。

## id 生成

各侧自生成，只需全局唯一，不做跨侧解析：

| 侧 | 规则 |
|---|---|
| ZCode | `纳秒-pid-计数`（现有实现） |
| DSH | `dsh-<base36时间>-<随机>`（`dsh-` 前缀便于溯源） |

## 占位符

| 占位符 | ZCode | DSH | 说明 |
|---|---|---|---|
| `{{date}}` | ✅ | ✅ | `YYYY-MM-DD` |
| `{{time}}` | ✅ | ✅ | `HH:mm` |
| `{{datetime}}` | ✅ | ✅ | `YYYY-MM-DD HH:mm:ss` |
| `{{workspace}}` | ✅ 各侧各义 | ⏸ 首版原样保留 | 见下 |
| `{{clipboard}}` | ✅ 仅 ZCode | ❌ 不支持 | DSH 浏览器侧拿不到剪贴板 |
| 未知 `{{xxx}}` | 原样保留 | 原样保留 | 天然兼容 |

**`{{workspace}}` 说明**：ZCode 侧是 `basename(process.cwd())`（进程启动时固定）；DSH 侧是"当前会话工作区"（会随会话切换变化）。语义不可预测，故 DSH 首版**当未知占位符原样保留**，两侧对未知占位符的行为一致。等有真实需求再补，并需在预览里显示展开结果。

**`{{clipboard}}` 说明**：DSH 侧不实现。ZCode 侧代码与测试保留不砍。在 DSH 面板建的短语里不要写它（写了也原样保留，不会被静默吃掉）。

## 迁移

ZCode 侧现有 `${ZCODE_PLUGIN_DATA}/snippets.json`
（`{version, updatedAt, snippets:[{id, title, body, category, pinned, order, createdAt, updatedAt}]}`）
一次性迁移为 `phrases.json` + `view.json`：

- `body` → `text`
- `pinned` / `order` → 本地 `view.json`
- 其余字段原样
- 旧文件保留备份，不删

## 导出文件格式（可选约定）

各侧的「导出」按钮建议用同一格式，这样两边导出的文件可以互相导入。

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

- **六字段与 `phrases.json` 完全一致**，只多一个 `exportedAt`
- **不含 `pinned` / `order`**（视图不导出，符合分层原则）
- 导入语义：**只新增、不按 id 去重**；`id`/时间戳重新生成；`text` 为空的条目跳过
- DSH 侧已按此实现（`src/client.js` 的 `exportAll` / `importFrom`）

> 这不是硬契约——各侧可以不实现导出。但如果实现，用同一格式能让备份文件互通。

---

## ZCode 待办（DSH 侧已修，等 ZCode 跟进）

> **2026-11-04 更新（ZCode 侧回填）：三条全部了结**——
> ① 已修：`phrases_path()` 默认值改 `data_dir().join("phrases.json")`（v0.5.6,提交见 quick-send 仓 git log）,
>    回归单测 `default_phrases_path_follows_user_data_dir`（未配置→数据目录内且不含 WORK_VSCODE /
>    配置→按环境变量 / 视图路径同理）;
> ② 已做 README「两种装法」（装法 A 只自己用默认零操作 / 装法 B 共享须显式配置 phrasesPath）;
>    「面板内显示当前 phrases.json 路径」未做,登记 design.md §13 观察项;
> ③ 已完成:v0.5.5 实现 `bulk_add_snippets` + `/quick-send-organize`(ZCode 侧取"一个批量工具+命令固化纪律"路线,
>    未做逐条 add/update/delete 四工具;跨端内容层经共享文件已互通)。

### 1. 必修：默认路径写死作者机器路径

**位置**：`plugins/quick-send/panel/server-rs/src/store.rs` 第 116 行

```rust
// 现状（错）：把作者机器路径当默认值
_ => PathBuf::from(r"D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json"),

// 建议改成：跟着用户数据目录走，共享靠 QUICK_SEND_PHRASES 环境变量显式指定
_ => data_dir().join("phrases.json"),
```

`data_dir()` 已存在（第 102 行，读 `QUICK_SEND_DATA` 环境变量，缺省用 `USERPROFILE`），
直接复用即可。这样：不配置 = 自包含可用；要共享 = 设 `QUICK_SEND_PHRASES`。

**为什么必修**：见本文开头「数据文件位置」的硬纪律。默认值写死绝对路径，会让陌生用户的
D 盘凭空多出目录；而 ZCode 是走市场分发的，受影响面比 DSH 更大。

**回归测试建议**（参照 DSH 侧 `test/store.test.mjs` 末尾三条）：

- 未设环境变量时，默认路径必须位于用户数据目录内，且**不含** `WORK_VSCODE`
- 设了 `QUICK_SEND_PHRASES` 时按环境变量走
- 顺带检查视图文件路径同样是相对用户目录的

### 2. 建议：文档补「两种装法」

DSH 侧 README 已拆成「装法 A 只自己用（默认，零操作）」和「装法 B 和 ZCode 共享（要改配置）」。
ZCode 侧 README 目前把共享当作默认前提来写，陌生人读完不知道自己要不要建 `shared-phrases`。
建议同样拆开，并在插件面板或设置里显示当前实际使用的 `phrases.json` 路径。

### 3. 待实现：`bulk_add_snippets` + `/quick-send-organize`

已经和 DSH 侧对齐过的「方案乙」。DSH 侧对应实现是 4 个工具
（`quick_send_list/add/update/delete`，见 `src/agent-tools.js`），已完成并发布。
ZCode 侧 `tools.rs` 增量已在工作区待提交。


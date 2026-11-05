# 变更记录

本文件记录 `@wenliang9527/dsh-quick-send` 的版本变更。
早期版本（0.3.1 及以前）的详细说明见 README 的「变更记录」一节。

## 0.3.2

修复并发写导致的数据丢失，并补上安全边界与发布元数据。**升级建议：所有用户。**

### 修复

- **并发写丢数据（严重）**：`atomicWrite` 用固定的 `<file>.tmp` 作临时名，
  两个并发写会抢同一临时名——先完成的一方把 tmp 改名走，另一方 `rename`
  时目标已不存在，抛 `ENOENT`。同时 `read → modify → write` 之间没有任何锁，
  双方读到同一份旧快照，后写者用「旧快照 + 自己那条」覆盖文件，
  先写者新增的条目被静默抹掉（lost update）。
  实测：**2 个并发新增就丢 1 条**，3 个以上还会崩。
  - 临时名改为唯一：`<file>.<pid>.<seq>.<rand>.tmp`
  - 新增进程内写串行队列（`mutatePhrases` / `mutateView`），把「读改写」
    整体串起来；面板 UI 连点、agent 工具与面板同时写、两个标签页并发，
    都不再丢数据
  - 写失败时清理自己的临时文件，不留垃圾

### 安全

- **端点加同源校验**：6 个 HTTP 端点原本没有任何鉴权，挂在 DSH 的 loopback
  服务上。用户浏览器里任意恶意页面都能 `POST /__quick-send/delete` 清空常用语，
  或 `GET /__quick-send/list` 把内容读走。现对带 `Origin` 头且与 `Host`
  不一致的请求返回 403；无 `Origin`（curl、服务端调用、同源导航）放行。

### 质量

- **占位符实现一致性守卫**：Host 的 `src/expand.js` 与 `client.js` 里的
  `expandText()` 是两份实现（浏览器侧无法 import 宿主模块，只能复制）。
  新增测试从 `client.js` 源码抽出函数体现场编译，与 Host 版比对 20 个边界用例
  （含 `{{DATE}}`、`{{date`、`{{}}`、`{{{date}}}` 等）。已用变异测试验证：
  故意把 `-` 改成 `/` 会立刻报错。
- 新增 **LICENSE**（MIT，与 `package.json` 一致）
- 新增 **CHANGELOG**（本文件），并纳入 npm 包

### 测试

112 → 120 项：

| 文件 | 数量 | 新增 |
|---|---|---|
| `store.test.mjs` | 30 | +2（expand 一致性、hasSupportedPlaceholder 一致性） |
| `client.test.mjs` | 34 | — |
| `e2e.test.mjs` | 31 | +3（并发写不丢数据、增删交错、无 `.tmp` 残留）<br>+3（同源校验：跨源 POST 403、跨源 GET 403、同源与无 Origin 放行） |
| `agent-tools.test.mjs` | 25 | — |

### 已知边界（未在本版解决）

- 跨进程并发（ZCode 与 DSH 同时写同一份 `phrases.json`）仍是
  last-write-wins，需要 revision 机制。见 `docs/shared-phrases/CONTRACT.md` §4。

## 0.3.1

文案对齐，代码零改动。详见 README「变更记录」。

## 0.3.0

浮层瘦身 + 侧边栏管理页。详见 README「变更记录」。

## 0.2.2

修复默认数据路径写死作者机器路径。详见 README「变更记录」。

## 0.2.1 / 0.2.0

仅文档 / 新增 Agent 工具。详见 README「变更记录」。

## 0.1.0

首个发布版。详见 README「变更记录」。

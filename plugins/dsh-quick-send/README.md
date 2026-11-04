# dsh-quick-send

DSH 常用语快捷发送插件 —— 输入框上方的常用语面板，**点一下填入草稿**（不覆盖、不自动发送）。

与 ZCode 的 `quick-send` 插件**共享同一份内容源**，两侧各自维护置顶与排序。

## 功能

- 输入框工具行 **📚 按钮** → 输入框上方展开常用语面板
- **填入**：点条目把文本插入草稿；已有草稿时**追加，不覆盖**
- **管理**：新建 / 编辑 / 删除（二次确认）/ 搜索 / 分类筛选
- **置顶与排序**：置顶项排最前，同段内可上下移动（**仅本侧生效**）
- **占位符**：`{{date}}` `{{time}}` `{{datetime}}`，在**填入时**按本地时区展开
- **数据位置可配置**：见 `cordis.patch.yml` 的 `config`

## 与 ZCode 共享内容

| 层 | 字段 | 位置 |
|---|---|---|
| 内容（共享） | `id` `title` `text` `category` `createdAt` `updatedAt` | `D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json` |
| 视图（本侧） | `pinned` `order` | `~/.dsh/quick-send/view.json` |

完整契约见 [`shared-phrases/docs/CONTRACT.md`](../../../../shared-phrases/docs/CONTRACT.md)。

- **双向写**，双方遵守同一纪律：全量读改写 + 临时文件原子替换 + 损坏 `.bad` 留证后空表启动
- 一方新增/修改后，另一方**刷新面板即可看到**（面板打开时会重新拉取）
- `pinned` / `order` 各侧本地，互不影响

## 占位符支持矩阵

| 占位符 | dsh-quick-send | ZCode quick-send |
|---|---|---|
| `{{date}}` / `{{time}}` / `{{datetime}}` | ✅ 填入时展开 | ✅ |
| `{{workspace}}` | ⏸ 原样保留（首版） | ✅ 各侧各义 |
| `{{clipboard}}` | ❌ 不支持，原样保留 | ✅ 仅 ZCode |
| 未知 `{{xxx}}` | 原样保留 | 原样保留 |

> 在 DSH 侧建的短语不要用 `{{workspace}}` / `{{clipboard}}`，它们会被原样保留而不是展开。

## 安装

```bash
dsh plugin --profile desktop add link:D:/WORK_VSCODE/Vibe-coding/quick-send/plugins/dsh-quick-send
```

或在插件管理里装本地目录。装完**重启 DSH**（Host 半区改动需要重启），然后硬刷新浏览器（`Ctrl+Shift+R`）。

> **pnpm store 路径问题**：若安装报 `ERR_PNPM_UNEXPECTED_STORE`，说明 profile 的
> `node_modules` 由另一个 store 链接而来。用原来的 store 安装即可，不要重装已有依赖：
>
> ```powershell
> node <dsh>/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs add `
>   link:D:/WORK_VSCODE/Vibe-coding/quick-send/plugins/dsh-quick-send `
>   --store-dir "C:\Users\<you>\.pnpm\store\v11" --dir "C:\Users\<you>\.dsh\profiles\desktop"
> ```

## HTTP 端点（Host 半区）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/__quick-send/list` | GET | 内容 + 视图合并后的列表 + 分类集合 |
| `/__quick-send/save` | POST | `{id?, title, text, category}`，有 `id` 为更新 |
| `/__quick-send/delete` | POST | `{id}` |
| `/__quick-send/view` | POST | `{id, pinned?, order?}` |
| `/__quick-send/reorder` | POST | `{id, direction: 'up'\|'down'}` |
| `/__quick-send/paths` | GET | 实际使用的两个文件路径 |

## 结构

```
dsh-quick-send/
├─ package.json          dsh.bundle.patch + dsh.client 声明
├─ cordis.patch.yml      profile 挂载行 + 可覆盖 config
├─ src/
│  ├─ index.js           Host 半区：HTTP 端点 + CRUD
│  ├─ store.js           共享内容读写 + 本地视图 + 原子写 + 自愈
│  ├─ expand.js          占位符展开（纯函数）
│  └─ client.js          Client 半区：📚 按钮 + 面板（ModuleLoader bundle）
└─ test/
   └─ store.test.mjs     单元测试（25 项）
```

## 测试

```bash
node --test plugins/dsh-quick-send/test/store.test.mjs
```

覆盖：占位符展开（时区/空格/未知保留）、原子写无残留、损坏自愈 `.bad`、`schemaVersion` 守卫、
重复 id 去重、BOM 兼容、视图字段规范化、合并排序（置顶→分类→order）。

## 已知限制

- **`{{workspace}}` 首版不展开**：DSH 侧"当前工作区"会随会话切换而变化，语义不可预测，故先原样保留。
- **`{{clipboard}}` 不支持**：浏览器侧拿不到剪贴板内容。
- **无乐观锁**：依赖"单用户跨两窗口手点撞不上毫秒级窗口"的前提；如果将来需要多端并发写，要补 revision 机制。
- **删除不跨侧同步视图**：本侧删除会清掉本侧 view 条目，另一侧的 view 残留会被忽略（不报错、不清理）。

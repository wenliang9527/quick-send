# 提交步骤（awesome-dsh-plugin）

所有材料已核对完毕，按下面步骤操作即可。

## 1. Fork + 建分支

```bash
# 在 GitHub 上 fork：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
git clone https://github.com/<你的用户名>/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git checkout -b add-wenliang9527-quick-send
```

## 2. 加一个文件

把这个仓库里的 `docs/awesome-dsh-plugin-entry.yml` 复制过去，**文件名必须是**：

```
data/plugins/wenliang9527__quick-send--plugins-dsh-quick-send.yml
```

文件名规则（来自 contributing.md）：`<owner>__<repo>--<子包路径用连字符连接>`。
我们的子包路径是 `plugins/dsh-quick-send` → `plugins-dsh-quick-send`。

## 3. 提交并推

```bash
git add data/plugins/wenliang9527__quick-send--plugins-dsh-quick-send.yml
git commit -m "Add wenliang9527/quick-send#dsh-quick-send"
git push origin add-wenliang9527-quick-send
```

然后去 GitHub 开 PR。

## 4. PR 标题

```
Add wenliang9527/quick-send#dsh-quick-send
```

## 5. PR 正文（直接复制）

```markdown
Adds `wenliang9527/quick-send#dsh-quick-send` — a stored-phrase library for the composer.

**What it does**

- **Insert, not send.** A `/quick-send` slash command (alias `/qs`) or a composer picker inserts a stored phrase **at the caret**, replacing nothing and sending nothing. One undoable edit; `Ctrl+Z` reverts it.
- **Sidebar management page.** Create, edit, delete (two-step confirm), search, categorize, pin and reorder; import and export as JSON.
- **Four agent tools.** `quick_send_list`, `quick_send_add`, `quick_send_update`, `quick_send_delete` let the model read and write the library directly. Update and delete locate entries by `id` only (titles may repeat); delete requires an explicit `confirm: true`.
- **Placeholders.** `{{date}}`, `{{time}}` and `{{datetime}}` expand at insert time in the local timezone. Unknown placeholders are left exactly as written.
- **Shared content file.** The `phrases.json` content layer can be pointed at the same file the ZCode `quick-send` plugin uses, so both clients read and write one library. Writes are serialized across processes with a `quick-send.lock` file lock plus a `revision` check.

**Manifest**

`plugins/dsh-quick-send/package.json` declares `dsh.bundle` (`./cordis.patch.yml`) and `dsh.client` (web). A `cordis.patch.yml` sits next to it. Published to npm as `@wenliang9527/dsh-quick-send` (v0.4.2).

**Local install path is not required** — the repo is a monorepo and the entry points at the subdirectory, per the contributing guide.

**Tests:** 169 passing (`npm test` in `plugins/dsh-quick-send`), covering storage, HTTP endpoints, client rendering, agent tools and the slash-command trigger contract.

**Repo age / topic:** repo created 2026-11-04; `dsh-plugin` topic added.
```

## 6. 提交前自查清单

| 要求 | 状态 |
|---|---|
| `dsh.bundle` 在 package.json 里 | ✅ `{"patch":"./cordis.patch.yml"}` |
| `cordis.patch.yml` 就在旁边 | ✅ |
| 仓库创建满 1 天 | ✅ 5 天 |
| `dsh-plugin` topic | ✅ 已加 |
| 描述只用功能、无营销词 | ✅ 逐项对照代码核对过 |
| 描述里提到的名字都真实存在 | ✅ 4 个工具名、占位符、`phrases.json` 全部核实 |
| 一个 PR 只加 1 条 | ✅ |

## 7. 几点提醒

- **不要手工改 README**。两个 README 由 `data/plugins/*.yml` 生成，改了会和别人冲突（贡献指南专门强调这点）。
- **描述准确性是主要退回原因**。如果维护者说某句不准，改那一行重新推即可，不算拒绝。
- 合并后网站会自动重建，不用做别的。
- CI 若报 `READMEs match data/plugins` 红，那不是你的问题（分支快照落后），维护者合并时会重新生成。

## 可选：加图标和截图

- **图标**：`icon:` 字段要 GitHub 托管的 png/jpg/webp，约 96px 方形。不写就用你的 GitHub 头像。目前没写。
- **截图**：在 `plugins/dsh-quick-send/` 下放 `screenshots.json`，列 1-8 张图路径，市场详情页会像 App Store 那样展示。目前没做。

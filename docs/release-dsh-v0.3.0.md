## 解决「一屏只看得到两条」

原来的浮层每行是「标题 + 正文预览 + 6 个按钮」，撑到约 70px 高，9 条要滚三四屏。
这一版把它拆成**两个界面，各管一件事**。

### 浮层：只负责插入

输入框旁的 📚 打开，每条压到 **「序号 + 标题」一行**（约 26px），**9 条一屏全见**。

```
┌─ 常用语 9/9  点整条插入，或按 1-9    [管理] [✕] ┐
│ 🔍 搜索…                                        │
│ [全部] [Obsidian]                               │
│ 1 新建笔记                            [Obsidian]│
│ 2 新建速记                            [Obsidian]│
│ 3 打开今日日记                        [Obsidian]│
│ 4 搜索 Obsidian 笔记                  [Obsidian]│
│ 5 剪贴板存为笔记                      [Obsidian]│
│ 6 对话总结入库                        [Obsidian]│
│ 7 打开指定笔记                        [Obsidian]│
│ 8 最近修改列表                        [Obsidian]│
│ 9 整理 Inbox                          [Obsidian]│
└─────────────────────────────────────────────────┘
```

三种插入方式：点整行 / 按 `1`-`9` / 搜索后回车。

**数字键有分寸**：只在搜索框为空时生效——否则你搜「123」会被抢走按键；
超过 9 条也不绑（两位数歧义且记不住）。

### 管理页：只负责维护

侧边栏出现 📚 图标，点开是**中央整块面板**，原来的全部功能都在：
新建 / 编辑 / 删除（二次确认）/ 搜索 / 分类筛选 / 置顶 / 上下移动 / 导入导出 / 占位符预览。

**左上角有 `← 返回对话`**，一键回到对话。编辑器里有未保存内容时会先确认，
避免切走丢改动。

### 一处实现，两处复用

同一组件靠 `props.__mode` 切 `quick` / `manage`，14 个 Hook 无条件调用、数量完全一致
（`client.test.mjs` 有守门用例），不存在两套代码漂移。

**行为差异**是有意的：浮层插入后收起（贴合「插完就走」）；管理页常驻不收起（方便连插）。

### 顺带修掉一个隐患

`closePanel` 里原本裸调 `editing.text.trim()`，当 `editing === 'new'`（字符串）时会崩。
现已改成先判断 `editing !== 'new'` 再取字段。

### 技术要点

侧边栏注册沿用 `dsh-serial-panel` 踩过的坑：`sidebar.panellist` 的 `id` 与 `main`
keyed 槽的 `key` **必须严格同值**（都是 `quick-send`）。宿主侧栏的 PanelRow 自己绑
`onClick → ctx.layout.selectPanel(id)`，而 `selectPanel` 只认 main 里同 key 的注册项，
缺一处就「点图标毫无反应」。加了测试锁死这个约束。

`← 返回对话` 用 `layout.selectPanel(null)` —— 契约里 `null` 即「显示 Conversation」。

### 测试

96 → **112 项**，全部通过。新增 16 项：

- 浮层只渲紧凑行（无正文预览、无按钮）、序号从 1 开始
- 管理页渲完整卡片、不依赖浮层开关、两侧按钮集不同
- `1`-`9` 直插、搜索有内容时不抢键、超出条目数无动作
- `sidebar.panellist`（id）与 `main`（key）都已注册且同值
- 返回按钮调 `selectPanel(null)`、管理按钮调 `selectPanel('quick-send')`（防接反）
- `layout` 缺席时不抛错、浮层无返回按钮

命名校验 exit 0；`npm pack` 9 files / 38.7 kB。

---

**Full Changelog**: https://github.com/wenliang9527/quick-send/compare/dsh-v0.2.2...dsh-v0.3.0

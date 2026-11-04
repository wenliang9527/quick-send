## dsh-quick-send v0.1.0

DSH 常用语快捷发送插件的首个版本。与同仓库的 ZCode 版 `quick-send` 共享同一份 `phrases.json` 内容源。

### 核心能力

- **📚 浮层面板**：输入框工具行按钮展开，渲染在 composer 卡片内，不挤压布局
- **插入到光标处**：一次可撤销的编辑（`Ctrl+Z` 可撤销），不是覆盖草稿
- **管理**：新建 / 编辑 / 删除（二次确认）/ 搜索 / 分类筛选 / 置顶 / 排序
- **占位符**：`{{date}}` `{{time}}` `{{datetime}}`，插入时按本地时区展开，编辑器内实时预览
- **键盘操作**：`↑↓` 选择、`Enter` 插入、`Esc` 清选中
- **导入 / 导出**：纯客户端 Blob + FileReader，导出六字段契约格式
- **中英双语**：跟随 DSH 语言设置

### 安装

通过 GitHub 直装（指定子目录）：

```bash
dsh plugin --profile desktop add github:wenliang9527/quick-send#plugins/dsh-quick-send
```

或本地目录安装：

```bash
dsh plugin --profile desktop add link:<path>/quick-send/plugins/dsh-quick-send
```

装完**重启 DSH**，然后 `Ctrl+R` 刷新界面。

### 数据分层

| 层 | 字段 | 位置 |
|---|---|---|
| 内容（与 ZCode 共享） | `id` `title` `text` `category` `createdAt` `updatedAt` | `phrases.json`（路径可配置） |
| 视图（本侧） | `pinned` `order` | `~/.dsh/quick-send/view.json` |

### 测试

**71 项全部通过**：

- 25 存储单测（占位符 / 原子写 / 自愈 / 排序）
- 21 客户端运行时测试（最小 React 替身真实渲染，**含 Hooks 顺序守门**）
- 25 端到端 HTTP 测试（真实 `http.Server` 全链路，含跨实例共享与容错）

### 已知限制

- `{{workspace}}` / `{{clipboard}}` 不展开（原样保留，与 ZCode 侧对未知占位符行为一致）
- 无乐观锁，依赖「单用户跨两窗口手点撞不上毫秒级窗口」前提
- 导入只做新增、不按 id 去重
- `panelSlot` 配置改动需重启 DSH

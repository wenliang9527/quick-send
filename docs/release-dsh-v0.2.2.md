## 这是一个会影响所有非作者用户的 bug 修复，建议升级

### 修了什么

`defaultPhrasesFile()` 的默认值原本是：

```
D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json
```

——**开发机路径被当成了产品默认值**。

后果不是报错，而是更隐蔽：别人安装后，第一次点「保存」时 `atomicWrite()` 会
`mkdir -p` 出这个路径，于是在**他自己的 D 盘**凭空创建
`WORK_VSCODE\Vibe-coding\shared-phrases\` 目录。列表能读（空表不报错），看起来能用，
但磁盘被污染了。

现改为：

```
~/.dsh/quick-send/phrases.json
```

与视图文件 `~/.dsh/quick-send/view.json` 一致，都跟着用户主目录走。

### 行为变化（升级必读）

| 场景 | 0.2.1 及以前 | 0.2.2 |
|---|---|---|
| 不配置（绝大多数人） | ❌ 写到 `D:\WORK_VSCODE\...` | ✅ 写到 `~/.dsh/quick-send/phrases.json` |
| 与 ZCode 共享 | 靠写死的默认值"碰巧"共享 | 必须显式配置 `phrasesFile` |

**如果你原本靠旧默认值与 ZCode 共享数据**：升级后需要显式配置，否则会看到空列表。
旧数据**不会丢失**，只是不再被默认读到。

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: quick-send
  name: '@wenliang9527/dsh-quick-send'
  config:
    phrasesFile: 'D:\your\shared-phrases\phrases.json'
```

或用环境变量 `DSH_QUICK_SEND_PHRASES_FILE`。**两侧必须填同一个文件。**

### 新增：面板底部显示数据文件路径

不用再去猜数据存哪了。面板底部会显示当前实际使用的路径，点击可复制。

### 文档

- 新增「数据存哪」章节：两个文件的职责 + 默认路径表 + `~` 在 Windows 的展开
- 拆成**两种装法**：
  - **装法 A：只自己用**（默认）——什么都不用做，装完即用
  - **装法 B：与 ZCode 共享**——要显式配置，两侧路径必须一致
- 清理 README 里剩余的开发机绝对路径（`link:` 安装示例改为占位符）

### 测试

从 96 项增至 **101 项**，全部通过。新增的守门用例：

- `defaultPhrasesFile()` 必须位于 `homedir()` 下
- 默认路径**不得包含 `WORK_VSCODE`**（防止同样的 bug 复发）
- 环境变量可覆盖
- 面板底部在拿到 `/paths` 时渲染路径、拿不到时整块不渲染

命名校验 `validate-names.mjs` exit 0；`npm pack` 9 files / 34.3 kB。

### 相关：ZCode 侧同样的 bug 待修

`plugins/quick-send/panel/server-rs/src/store.rs` 第 116 行有**完全相同的问题**：

```rust
_ => PathBuf::from(r"D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json"),
```

已在 `shared-phrases/docs/CONTRACT.md` 的「ZCode 待办」章节写明改法（复用已有的
`data_dir()`）。ZCode 走市场分发，受影响面比 DSH 更大，建议尽快跟进。

---

**Full Changelog**: https://github.com/wenliang9527/quick-send/compare/dsh-v0.2.1...dsh-v0.2.2

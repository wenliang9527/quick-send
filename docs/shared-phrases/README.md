# docs/shared-phrases · 共享常用语契约

这里放 **ZCode `quick-send`** 与 **DSH `dsh-quick-send`** 两个插件之间的对接文档。

| 文件 | 给谁看 | 内容 |
|---|---|---|
| [`CONTRACT.md`](CONTRACT.md) | 双方开发者 | 数据格式、写入纪律、占位符、Agent 约定、默认路径纪律 |
| [`HANDOFF-DSH.md`](HANDOFF-DSH.md) | ZCode 侧 | DSH 侧已实现并验证的行为、对接要踩的坑、改造清单 |

## 为什么这两个文件在代码仓库里

它们原本放在仓库外的 `D:\WORK_VSCODE\Vibe-coding\shared-phrases\docs\`，
导致两个实际问题：

1. **README 里的相对链接全是死链** —— 从 `plugins/dsh-quick-send/` 出发，
   `../../../../` 会冲出仓库根目录，npm 页面和 GitHub 页面上都点不开
2. **没有任何版本保护** —— 改错了、误删了都找不回来

移到仓库内后：相对链接有效、GitHub 能直接浏览、每次改动都有 diff 可查。

## 数据文件不在这里

实际的常用语数据仍然是**运行时文件**，位置由两侧各自配置：

| 侧 | 默认位置 | 配置方式 |
|---|---|---|
| DSH | `~/.dsh/quick-send/phrases.json` | `cordis.patch.yml` 的 `config.phrasesFile` |
| ZCode | `${ZCODE_PLUGIN_DATA}/phrases.json` | 环境变量 `QUICK_SEND_PHRASES` |

想共享就让两侧填**同一个文件**（比如 `D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json`）。
数据文件**不进仓库**：里面是用户自己写的话，可能含隐私，也不该跟着代码版本滚动。

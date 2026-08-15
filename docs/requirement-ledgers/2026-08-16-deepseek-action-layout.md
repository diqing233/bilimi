# 本轮需求账本：DeepSeek 辅助整理按钮并排与改名

## 原文区

### R001

原文消息：

```text
# Files mentioned by the user:

## codex-clipboard-58ae5a92-c689-40ac-bcc6-338437eda9a7.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-58ae5a92-c689-40ac-bcc6-338437eda9a7.png

## My request:
这里现在只有一个按钮可以跟DeepSeek辅助整理放一排，DeepSeek整理按钮名字改成开始整理
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-58ae5a92-c689-40ac-bcc6-338437eda9a7.png">截图显示“归档预览”的 DeepSeek 辅助整理块：标题在第一行左侧，唯一的“DeepSeek 整理”按钮折到下一行右侧。</image>
```

截图目标区域：`归档预览`内 `DeepSeek 辅助整理`模块的标题行及唯一主操作按钮。截图路径：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-58ae5a92-c689-40ac-bcc6-338437eda9a7.png`。目标是让标题和这一个按钮同排；截图中未要求调整下方说明、整理明细、改动记录或分类卡片。

### R002

原文消息：

```text
开始
```

## 逐项索引表

| 状态 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|
| 已实施待界面验收 | R001 | 将 `DeepSeek 辅助整理`标题和唯一空闲主操作按钮放在同一标题行；主按钮文案由“DeepSeek 整理”改为“开始整理”。 | `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx` 的 DeepSeek 辅助整理标题栏，以及该组件在 `src/renderer/src/styles.css` 的标题栏布局。 | 空闲、可开始整理时显示“开始整理”；进行中继续按既有规则显示“取消整理/正在取消”。窄侧栏仍必须保证标题与单个按钮可读，不与下方说明重叠。 | 仅变更布局与空闲按钮可见文字；原有点击处理、disabled 条件、取消逻辑和 DeepSeek 整理范围保持不变。 | 无本地持久化、迁移或 B 站副作用。 | 不调整下方说明、整理范围、查看整理明细、改动记录、撤销/恢复和分类卡片；不修改 DeepSeek 请求与结果逻辑。 | `deepSeekCancellationAction`、`openDeepSeekDialog`、运行状态分支、既有归档预览组件测试。 | RED：旧文案下聚焦 Vitest 预期失败（2 项失败、29 项通过，2026-08-16）。GREEN：同文件 31/31 通过；`npm run build` 于 2026-08-16 exit 0。代码：空闲按钮 `OldFavoriteArchivePreviewStep.tsx:534-537`；布局 `styles.css:5346-5354`；回归断言 `OldFavoriteArchivePreviewStep.test.tsx:261-276,382-385,938`。Electron 实机视觉验收被 `node_repl exec context not found` 阻断，待可用开发版桌面会话复核。 |

## 被明确替代

无。

## 明确不做

无。

## 实施核对记录（2026-08-16）

- R001 已按最小范围实现：仅把空闲入口改为“开始整理”，并将标题操作容器的 flex 基准从固定 `176px` 改为按内容宽度布局，以便在截图对应的正常侧栏宽度与标题同排；`flex-wrap: wrap` 仍保留，极窄宽度不会重叠。
- 已保护的行为：`openDeepSeekDialog`、原有 disabled 条件、对话框标题“DeepSeek 整理”、确认按钮“开始 DeepSeek 整理”、进行中的“取消整理/正在取消”、请求、范围、进度、明细、历史、撤销/恢复和任何 B 站副作用均未修改。
- 自动化：先执行聚焦 Vitest，新增断言在旧按钮文案下失败；最小实现后再次执行，`src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx` 共 31 项通过。随后 `npm run build` exit 0。
- 实机界面：已从运行中的 bilimi Electron 开发窗口两次发起只读截图/可访问性采集；采集运行环境两次均返回 `Error: node_repl exec context not found`，未能生成或伪造界面证据，仍需在可用 Electron 桌面会话中核对同排、精确文案、禁用状态和极窄宽度换行。

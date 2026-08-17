# 本轮需求账本：本轮总览与当前批次的标签进度展示

## 原文区（不可改写）

### R001

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-a54873bb-1d15-4f0a-8a6e-3412eb6f3531.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-340717cc-5c81-4bc0-80e6-7446d052bd58.png`

截图目标区域：

- 图一“扫描概览 > 当前批次”中的“当前批次”标签进度条、`标签补取发现新增或变化标签，待采用：已处理 150 / 2000 条。`及其四个标签统计格。
- 图二“扫描概览 > 本轮总览”中的本轮汇总、`标签补取中 2563 条：已补取 176 条，待补取 2387 条`，以及该处未显示与当前批次对应标签进度条/详细标签状态的区域。

原文消息：

```text
讨论为什么当前批有这个标签进度条，本轮总览没有
```

### R002

原文消息：

```text
你可以看到当前批次这个标签进度条本轮总览没有这个东西，我想说的是这个
```

### R003

原文消息：

```text
同时保留，顺便把这这两个进度条调整一下，尽量一行显示全
扫描进度[──────────────]  已完成
标签补取[──────────────]  当前批 176 / 2000 条   补取中

扫描进度[──────────────]  已完成
标签补取[──────────────]  本轮 176 / 2873 条   补取中
```

## 逐项索引表

| 状态 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|
| 已实施（已验证） | R001, R002, R003 | 本轮总览也必须显示与当前批次同级的横向标签进度条；顶部整轮文字汇总继续保留。当前批和本轮总览的两条进度均尽量单行展示：`扫描进度` + 条 + 状态；`标签补取` + 条 + 对应范围计数 + 状态。 | 整理收藏 > 扫描概览 > `扫描进度`区域：当前批次与本轮总览的两条横向进度条。 | 当前批第二条显示`当前批 已处理 / 当前批总数 条`和当前批状态；本轮第二条显示`本轮 已处理 / 本轮总数 条`和本轮状态。当前已有的本轮`标签补取中…`文字汇总保留。窄侧栏应优先收缩横条，必要时才换行，不能截断计数或状态。 | 总览进度条须使用整轮 scope；仅讨论和只读取证，不改变 UI、标签状态或按钮。 | 不触发收藏库、DeepSeek 或 B 站副作用。 | 讨论模式不改运行代码；不将当前批的条复制为整轮数据；不复制当前批专属操作控件；不删除已有本轮文字汇总。 | `tagEnrichment.scopes.currentSegment/wholeRun`、批次 readiness、`OldFavoriteScanOverviewStep`、`OldFavoriteWholeRunOverview`、进度条 CSS、项目书 5.3/5.4。 | 代码：`OldFavoriteScanOverviewStep.tsx:169-187,256-262` 使用 `currentSegment/wholeRun` scope；`styles.css:6022-6025,6072-6104` 以四列和 container query 保持单行优先。自动化：`npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`，31/31 通过；关联回归 `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`，169/169 通过；`npm run build` 通过。真实界面：Electron 开发版（5174）中实测当前批`1066 / 2000`、状态`补取中`；切至总览显示`1066 / 2563`、状态`已暂停`并保留`标签补取中 2563 条 · 已补取 1066 条 · 待补取 1497 条`；收窄侧栏后横条收缩、数值和状态完整，随后恢复侧栏宽度和当前批次视图。未点击任何标签控制、保存或同步按钮。 |

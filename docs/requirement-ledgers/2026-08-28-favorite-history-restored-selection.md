# 需求账本：收藏夹历史恢复后的勾选投影

> 本账本记录本轮从用户提出问题到明确说“开始”前的完整原文。讨论阶段只登记与排查，不改功能代码。

## 原文区

### R001

时间：2026-08-28
截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-57280814-d41e-432a-86dd-121e41f61267.png`
截图目标区域：右侧“收藏夹”已保存规则卡片的勾选状态；红箭头附近为 `honke…` 卡片。下方弹层“本轮可恢复记录（2 条）”当前显示“勾选 `honker233` 后…”，另一条为“勾选 `哈米伦的拜错者` 后…”。

原文：

```text
讨论我恢复到bilimihonker233的时候，此时后面勾选的收藏夹应该没有勾选才对吧
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 历史游标恢复到 `bilimi·honker233` 对应位置时，该位置之后才勾选的收藏夹在当前状态不得仍显示为勾选。 | 上方已保存收藏夹卡片、下方推荐投影、工作区历史游标快照中的规则 `enabled` / 参与集合。 | 当前游标早于某一勾选记录时，该规则显示未勾选；后续 redo 记录仍可在改动记录中显示与选择，但不能伪装为当前状态。 | 选择历史位置后，以该位置的权威快照重水合上方、下方与归档/同步投影；重新选择未来记录才恢复相应勾选。 | 仅恢复本地规则目录、账号级参与偏好、推荐采用和本轮分类投影；不自动创建、绑定、删除 B 站收藏夹，也不写入视频。 | 不按同名猜测；不删除未来 redo 记录；不改 DeepSeek、转写、删除确认、视频同步或备册流程；不得使点击、滚动等变卡。 | 主进程历史 cursor、规则历史快照、账号偏好持久化、渲染器乐观勾选缓存、归档预览与同步预检。 | 已实施，真实 Electron 历史验收待隔离历史数据 | 代码：`ControlledFavoriteLedgerPanel.tsx:1471-1498` 对纯 `recommendation-draft` 将上方参与状态投影到当前权威快照 `recommendations.adoptedCandidateIds`；在途上方点击仍优先，稳定 `saved-rule` 仍沿用 `enabled × excludedLedgerIds`。RED：2026-08-28 定向 Vitest 在修复前准确显示后续 `哈米伦的弄笛者` 为“移出同步”，未找到预期“加入同步”；GREEN：同一回归修复后通过。聚焦回归：`npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`，2 文件、519/519 通过。全量：`npm test`，240 文件、4132/4132 通过（`.codex-artifacts/2026-08-28-favorite-history-restored-selection/npm-test.log`）；`npm run build` 通过（`.codex-artifacts/2026-08-28-favorite-history-restored-selection/npm-run-build.log`）。Electron：以隔离用户数据启动开发版，但该隔离配置没有用户的 `honker233` 历史快照；为避免移动真实用户工作区游标，未在已登录窗口点击改动记录，故无目标截图且本项仍待真实界面验收。未执行任何 B 站创建、绑定、删除或视频写入；本改动不调用这些路径。 |

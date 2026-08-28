# 收藏夹改动记录恢复需求账本

> 讨论开始：2026-08-28。讨论模式仅记录原文、读取证据和讨论方案，不修改功能代码。

## 原文区

### R001

```text
讨论，改动记录当前是不是有问题，无法正常恢复到当时的状态
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 改动记录恢复到任一历史位置时，精确复现该位置的分类、收藏夹规则、上方账号级勾选、下方推荐采用和本轮排除集合；仅以该历史分类刷新归档预览、同步预检和就绪度，不能用当前自动分类结果覆盖。 | `整理收藏 → 归档预览 → 改动记录`；主进程历史游标、分类 journal、规则快照、推荐采用状态、归档预览与同步预检投影。 | 用户选择`恢复初始改动`或任一可见历史位置，且工作区可恢复时。 | 先移动分类历史游标，再一次性恢复本地规则与选择状态，最后刷新本地派生投影；只有恢复完成后用户新的明确规则/勾选/推荐/分类操作才可重算并开新分支。 | 仅本地工作区与规则偏好持久化；恢复不创建、绑定、删除、移动 B 站收藏夹，也不写视频。 | 不修改 DeepSeek、转写、删除确认、视频同步、备册入口或其他主题文件；不改变已有 redo 保留、上下规则 ID 联动和推荐草稿结算屏障。 | `moveHistoryCursor`、`undoWorkspaceChange`/`redoWorkspaceChange`、`favoriteRuleHistoryStateAtCursor`、规则目录恢复、overview 分类投影与计划就绪度。 | 已实施，真实历史点击待安全草稿验收 | 代码与自动化通过；Electron 已完成只读可见性和滚动响应验收，未移动用户真实历史游标。 |

## 实施与验收证据（2026-08-28）

### I001

- 项目书：`docs/项目功能项目书.md` §5.5 新增“历史分类快照优先”，并把“恢复初始改动”的分类语义改为使用历史投影重建派生结果，禁止恢复过程重新调用分类器。
- 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts` 的 `moveHistoryCursor()`。该路径先用已有 `undoWorkspaceChange()`/`redoWorkspaceChange()`获得目标分类，再恢复本地规则、账号级勾选、推荐采用与排除集合；随后用 `captureCurrentSegmentOverviewClassifications()`和新增的`calculatePlanReadinessFromOverviewProjection()`刷新本地 overview/就绪度，不再调用`autoClassifyAllSegmentsUnsafe()`。
- RED：`npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "replays the selected historical classification"` 在修改前以预期方式失败：恢复人工`manual`历史位置时分类器调用数由 `2` 增至 `3`，说明历史分类被重新计算覆盖。
- GREEN：同一聚焦用例和“恢复历史基线不重新调用分类器”用例均通过；前者断言恢复后仍为`manual`，且分类器调用数不增加、规则快照仍为目标位置。
- 回归：`electron/main/oldFavoriteWorkspaceCoordinator.test.ts` 355/355、`src/shared/oldFavoriteWorkspace.test.ts` 18/18、`npm test` 240 个测试文件 / 4,131 项测试、`npm run build` 均通过；`git diff --check`通过。
- Electron 只读：开发版打开`掌库 → 整理收藏 → 归档预览`，可见改动记录入口和归档分类；在 1,193 条未匹配项的右侧预览中向下、再向上滚动后持续响应。截图：`.codex-artifacts/2026-08-28-favorite-history-restore-readonly.png`。为不改变当前账号的真实草稿游标，未点击`查看改动记录`、`撤销`、`恢复`、备册、创建、绑定、删除、保存或同步；实际 Electron 历史游标点击仍待有可隔离草稿时验收。
- B 站边界：本轮未执行创建、绑定、删除、移动远端收藏夹或视频写入；恢复路径只写本地工作区 overlay 与本地规则偏好。

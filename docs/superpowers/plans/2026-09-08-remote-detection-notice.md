# 远端收藏夹检测提示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 B 站手动新建或改名后，将只读远端检测结果显示到小咪现有收藏夹提示区，而不改变任何保存、备册或 B 站写入行为。

**Architecture:** WebView 已确认的 `create` 与 `rename` mutation 继续复用现有目录刷新和远端发现；刷新成功后才以正式绑定的精确远端 ID 读取改名候选，并写入 `FavoriteLedgerStatus`。右侧小咪面板只透传该快照，在现有浅蓝提示区显示可展开摘要；该提示没有执行按钮。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Electron IPC。

---

### Task 1: 锁定现有提示区的只读交互

**Requirements:** I008 (R009-R010)

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [x] **Step 1: 写失败测试** — 使用一个 `remoteObservations` 和一个正式绑定改名候选渲染组件；断言红框提示区初始显示两类数量与“查看详情”，详情默认隐藏。
- [x] **Step 2: 验证 RED** — 已运行定向测试，因摘要不存在失败。
- [x] **Step 3: 写第二个失败测试** — 点击“查看详情”后断言显示疑似远端册名、已绑定册当前/目标名称与“下次保存或备册时处理”，并断言 `onSaveLedgers`、`onSyncLedgers` 从未调用。
- [x] **Step 4: 验证第二个 RED** — 已确认详情断言在最小生产实现前失败。
- [x] **Step 5: 最小实现** — 新增只读 props 与局部展开状态；复用 `.favorite-ledger-panel__notice`，保留既有已恢复草稿提醒；无检测项不显示新增提示。
- [x] **Step 6: 验证 GREEN** — `FavoriteLedgerOverview` 定向测试通过。

### Task 2: 将手动 B 站 create/rename 检测写入快照

**Requirements:** I007 (R008-R010)

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`

- [x] **Step 1: 写失败测试** — 以现有 App mutation 测试夹具模拟手动 `rename` 观察；断言远端发现成功后状态含 `remoteObservations` 与正式绑定改名候选，并调用快照变更通知；断言无 B 站写脚本。
- [x] **Step 2: 验证 RED** — 已运行该测试；快照缺少 `boundRenameCandidates` 而失败。
- [x] **Step 3: 最小实现** — 为 `FavoriteLedgerStatus` 增加只读改名候选；仅 create/rename 的刷新完成后读取正式绑定候选，将结果合并入状态缓存并通知快照；保留 delete 与程序化创建抑制路径。
- [x] **Step 4: 透传 UI 数据** — 从 `FloatingAssistantApp` 经 `LedgerWorkspacePanel` 和 `ControlledFavoriteLedgerPanel` 传给 `FavoriteLedgerOverview`，不用新状态系统、不在其它快照读取中新增远端预检。
- [x] **Step 5: 验证 GREEN** — App、小咪面板与提示区定向回归 492/492 通过。

### Task 3: 回归、账本和提交前核对

**Requirements:** I007-I008 (R008-R010)

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-08-favorite-library-duplicate-shards.md`

- [x] **Step 1: 定向回归** — 492/492 通过。
- [x] **Step 2: 构建和差异检查** — `npm run build`、`git diff --check` 均通过；已记录改动范围和未跟踪的无关账本。
- [x] **Step 3: 全量测试** — 已运行；4 个既有无关失败仍在：`oldFavoriteWorkspaceCoordinator` 零匹配推荐、`FloatingAssistantApp` 两个过期结构断言、`FavoriteLibraryDrawer` 标题断言。因此本轮不能提交。
- [x] **Step 4: 逐项账本核对** — 已回读 R008-R010 和 I007-I008，并记录代码位置、RED/GREEN、构建、全量结果与 Electron 验收待办。

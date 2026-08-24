# 同步确认、归档历史恢复与规则响应性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将整理收藏同步改为一次最终确认，令历史位置可安全恢复精确删除的本地规则，并让规则目录变更的整轮重分类保持最新、可中断且不阻塞 Electron 交互。

**Architecture:** 渲染器只发起一次无副作用预检并把暂存选择交给父级最终确认窗；父级将暂存、逻辑夹/分册缺口与精确候选在同一状态机中确认，再沿用既有二次读取/创建/绑定/冻结链。历史游标移动通过主进程的本地规则恢复回调精确恢复删除快照并解除当前轮排除；规则重分类由配置版本驱动，所有重量阶段合作式让步，旧版本在持久化或快照发布前失效。

**Tech Stack:** Electron 主进程、React、TypeScript、Vitest、Testing Library。

---

## 已确认需求映射

| 需求 | 账本原文 | 实施任务 | 验收 |
| --- | --- | --- | --- |
| I001 单窗口同步确认 | R001、R002 | 1–2 | 有暂存与备册缺口时只见一个最终窗口；无两种需求时直达冻结。 |
| I002 历史恢复本地规则 | R001、R002、R003 | 3 | 精确 ID 规则和本轮参与状态恢复；没有任何 B 站动作。 |
| I003 中文历史记录与悬浮全文 | R002、R003 | 4 | 不显示内部 ID，菜单单行截断，`title`有完整中文内容。 |
| I004 规则变更时的响应性 | R004、R005 | 5–6 | 最新版本完成前写入禁用；有界让步、过期结果不发布；Electron 只读交互验收。 |

### Task 1: 把暂存选择放入最终备册确认（I001）

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 写失败的渲染器测试。** 在确认步骤测试中提供“1 条未匹配 + 1 个未备册规则 + 精确候选”的只读预检；点击`确认并同步到 B 站`后断言不存在`同步选项`，只存在一个`同步前备册确认`，其中同时含`同步 bilimi·暂存（1 条）`、候选 `folderId` 和备册目标。在面板测试中断言一次确认把 `includeInbox`、已选候选和分册目标传入同一父级确认链，且不会渲染 `确认创建并绑定`。

- [ ] **Step 2: 运行 RED。** 运行 `npx vitest run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`；预期因旧的`同步选项`独立模态仍存在或父级不接收暂存选择而失败。

- [ ] **Step 3: 最小实现。** 删除 `OldFavoriteConfirmationStep` 的独立 `syncDialogOpen` 模态和本地确认；点击同步始终请求父级无副作用预检，传递 `includeInbox`/未匹配计数。`ControlledFavoriteLedgerPanel` 在已有 `bilibiliBackupPreflight` 窗口中渲染视频数、暂存复选框、缺口、分册和候选；确认调用现有 `requestBackup(..., { suppressConfirmationDialog: true })`，随后重新预检、冻结。预检为空且没有暂存选择时保持现有直接路径。

- [ ] **Step 4: 运行 GREEN 与回归。** 重跑 Step 2 命令，并运行 `npx vitest run src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`；预期全绿。

### Task 2: 单窗口确认的版本与副作用保护（I001）

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify only if test exposes a gap: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`

- [ ] **Step 1: 写失败测试。** 模拟确认窗口打开后预检版本变化；断言确认不创建、不绑定、不冻结，而是刷新同一窗口并要求再次确认。模拟没有暂存也没有备册缺口；断言未出现窗口且沿用直接冻结回调。

- [ ] **Step 2: 运行 RED。** 运行 `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`；预期展示当前旧窗口没有携带新暂存选择或版本失效处理的失败。

- [ ] **Step 3: 最小实现。** 用父级的当前预检版本作为唯一确认输入；版本不匹配时替换同一个 modal 内容并清空确认中的候选选择。继续向 `FavoriteLedgerOverviewHandle.requestBackup` 传入 `suppressConfirmationDialog: true`，禁止内部二次确认。

- [ ] **Step 4: 运行 GREEN。** 重跑 Step 2 命令；验证结果不包含任何真实 B 站调用。

### Task 3: 历史游标精确恢复删除本地规则（I002）

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/index.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

- [ ] **Step 1: 写失败测试。** 用删除快照创建一个规则 ID 与分类 history 引用；调用 `moveHistoryCursor` 后断言仅该精确 ID 被恢复、它从 `excludedLedgerIds` 消失、返回快照仍为该历史位置。再断言注入的 B 站服务从未被调用；同名不同 ID 不恢复。

- [ ] **Step 2: 运行 RED。** 运行 `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`；预期因游标移动没有恢复本地规则而失败。

- [ ] **Step 3: 最小实现。** 在协调器构造选项加入窄的 `restoreDeletedFavoriteLedgerRulesForHistory(accountMid, ids)` 回调；主进程从 `deletedFavoriteLedgerRecords` 只按 ID读取并持久化原快照，绝不调用备册/绑定/删除/成员同步服务。游标移动前收集目标历史应用后的 `targetLedgerIds`，恢复精确缺失规则并移除这些 ID 的当前轮排除，再将更新与游标事件同一队列落盘。前进到不引用的位置不自动删除规则。

- [ ] **Step 4: 运行 GREEN。** 重跑 Step 2 命令，并核查 mock B 站调用数为零。

### Task 4: 改动记录名称投影和完整悬浮提示（I003）

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx` (create if absent)

- [ ] **Step 1: 写失败测试。** 渲染一个已停用的规则、一个已删除规则和长记录；断言已停用规则仍显示 `displayName`，已删除规则显示`已删除的本地收藏夹`而不是 `custom-new-ledger-`，当前记录和菜单项的 `title` 包含完整中文记录。

- [ ] **Step 2: 运行 RED。** 运行 `npx vitest run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`；预期旧 `ledgerNames.get(id) ?? id` 泄漏内部 ID 或缺少 `title`。

- [ ] **Step 3: 最小实现。** 从全部 `ledgers`（不只 enabled）建立 ID→显示名映射；为`inbox`映射 `bilimi·暂存`，未知映射到`已删除的本地收藏夹`。保持既有单行 class/CSS，给当前记录、每个历史菜单项和恢复入口提供完整的 native `title`。

- [ ] **Step 4: 运行 GREEN。** 重跑 Step 2 命令并运行相邻归档预览回归测试。

### Task 5: 规则重分类的让步、最新版本和写入资格（I004）

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceClassification.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Test: `electron/main/oldFavoriteWorkspaceClassification.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

- [ ] **Step 1: 写失败测试。** 为协调器注入可计数的 `yieldToEventLoop`；以多个分段规则重算断言分类以外的应用/聚合/持久化准备阶段也让步。并发发出两个配置版本，断言旧版本不会持久化/发布。快照在最新版本进行时必须说明配置更新并使保存和预检资格为 false。

- [ ] **Step 2: 运行 RED。** 运行 `npx vitest run electron/main/oldFavoriteWorkspaceClassification.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`；预期旧实现只在分类器批次让步、旧任务可发表或资格未锁定。

- [ ] **Step 3: 最小实现。** 为账号/工作区维护递增的配置版本和可取消标记；将 `autoClassifyAllSegmentsUnsafe` 的加载、分类应用、全局聚合、journal/快照准备拆为有界阶段并在阶段间 `await yieldToEventLoop()`。每次持久化和发布前确认版本仍最新；旧任务安全放弃。所有 create/edit/enable/disable/delete/recover/default-toggle IPC 进入同一调度路径，失败保持原目录与预览一致。权威 snapshot 新增只读配置更新状态，保存/同步预检以它为阻塞条件。

- [ ] **Step 4: 运行 GREEN。** 重跑 Step 2 命令；再运行 `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`。

### Task 6: 规则更新状态的渲染器投影与只读 Electron 验收（I004）

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Evidence: `.codex-artifacts/2026-08-25-sync-history-rule-responsiveness/*.png`

- [ ] **Step 1: 写失败渲染器测试。** 注入“规则更新中”的权威快照，断言显示`正在按最新收藏夹规则更新`，并禁用`保存本轮到收藏库`和`确认并同步到 B 站`；结束后恢复由准备度决定的可用性。

- [ ] **Step 2: 运行 RED。** 运行 `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`；预期旧 UI 不显示状态或仍开放写入。

- [ ] **Step 3: 最小实现。** 使用 `useOldFavoriteWorkspace` 的权威 snapshot 状态而不是本地 pending 推测来显示更新提示、禁用保存和同步；不更改 DeepSeek、转写、删除确认、视频同步执行或单个备册入口。

- [ ] **Step 4: 运行 GREEN。** 重跑 Step 2 命令，并运行以上所有相关 Vitest 文件。

- [ ] **Step 5: Electron 只读验收。** 启动开发版，使用现有安全测试/本地草稿数据，只观察：单窗口包含暂存、候选和缺口；历史记录不显示内部 ID且悬浮可见全文；规则变更期间鼠标移动、点击、滚动、缩放、最小化、恢复和关闭可响应。不得点击任何创建、绑定、删除或 B 站写入按钮；截图保存至 `.codex-artifacts/2026-08-25-sync-history-rule-responsiveness/`。

### Task 7: 账本证据、综合验证与选择性提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-25-sync-options-and-archive-history-recovery.md`
- Modify: `docs/contracts/favorites.md`
- Modify: `docs/项目功能项目书.md`

- [ ] **Step 1: 逐项更新证据。** 为 I001–I004 写入实际代码位置、RED/GREEN命令、Electron截图路径以及未验证的真实 B 站副作用；不把未做项目写为完成。

- [ ] **Step 2: 完整验证。** 运行相关 Vitest、`npm test`、`npm run build`、`git diff --check`、`git diff --stat`和`git status --short`。任何失败保留现场并停止提交。

- [ ] **Step 3: 选择性提交。** 仅暂存本计划的代码、测试、项目书、契约、账本和计划文件；不能混入既有 DeepSeek、锁文件、临时输出或其他主题文件。若同一文件存在无法安全拆分的既有未提交改动，保留工作树并报告，不能强行提交。

## 自检

- I001 的暂存、候选和分册仅有一个最终确认窗口；无缺口且无暂存时没有额外窗口。
- I002 只按精确规则 ID 恢复本地快照，所有 B 站服务 mock 保持零调用。
- I003 无原始规则 ID 回退，所有长记录仍单行而完整中文存在于 `title`。
- I004 没有用跳过重分类、旧快照写入或 fire-and-forget 伪造流畅；最新配置版本是唯一可发布结果。

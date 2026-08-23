# DeepSeek 失败与取消非阻塞收束 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DeepSeek 失败或用户取消后保留当前分类、不阻塞保存或同步，并在归档预览始终提供可选的持久化失败项重试入口。

**Architecture:** 主进程继续持久化失败或取消检查点以支持精确重试，但只把权威活动的 `running` / `waiting` 当作写入阻塞。渲染器从快照的失败/未完成数量补齐归档预览重试入口；确认执行移除“沿用原自动分类”门槛。既有分类事实不回写，因而不会覆盖 DeepSeek 期间的人工调整。

**Tech Stack:** Electron main process、共享 TypeScript 快照、React、Vitest。

---

### Task 1: 先锁定失败与取消的非阻塞执行资格

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [x] **Step 1: 写失败测试**

为持久化 `failedAids: [1]` 的 `failed` 检查点和 `pendingAids: [1]` 的 `canceled` 检查点分别调用现有本地保存资格路径，断言不再抛出 `DeepSeek organization must be completed or explicitly resolved`，且不调用 `useOriginalClassificationsForFailedDeepSeekAids`。

- [x] **Step 2: 验证测试确实失败**

Run: `npm exec vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts --reporter=dot`

Expected: 失败原因为 `assertDeepSeekExecutionReady` 仍把 `failed` / `canceled` 检查点当作阻塞。

- [x] **Step 3: 最小实现**

令 `assertDeepSeekExecutionReady` 仅在当前工作区存在未暂停的 `running` 或 `waiting` DeepSeek 检查点时拒绝保存/同步；保留失败和取消检查点及其 AID，以供精确重试，且不得调用 B 站操作或改写分类。

- [x] **Step 4: 验证 GREEN**

Run: `npm exec vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts --reporter=dot`

Expected: 新测试通过，现有 B 站、标签和 DeepSeek 运行中阻塞回归继续通过。

### Task 2: 从持久化快照恢复归档预览的可选重试

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`

- [x] **Step 1: 写失败测试**

构造没有 `deepSeekFeedback.failures`、但 `snapshot.deepSeekRun.status === 'failed'` 且 `failedVideoCount === 1` 的恢复快照，断言归档预览显示 `重试失败 1 条` 并可调用 `onRetryFailedDeepSeekChunks`。另构造 `canceled` 加 `pendingVideoCount === 1`，断言显示 `重试未完成 1 条`。

- [x] **Step 2: 验证测试确实失败**

Run: `npm exec vitest run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx --reporter=dot`

Expected: 失败原因为当前按钮只依赖渲染器内存 `deepSeekFeedback.failures`。

- [x] **Step 3: 最小实现**

从 `snapshot.deepSeekRun` 计算持久化失败数或取消未完成数；没有内存失败详情时仍渲染准确的重试按钮。只在该权威计数大于 0 时显示；保持失败详情按已有内存数据渲染，不伪造明细。

- [x] **Step 4: 验证 GREEN**

Run: `npm exec vitest run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts --reporter=dot`

Expected: 恢复/刷新重试入口、原有运行/取消/完成状态回归通过。

### Task 3: 移除确认执行的回退门槛并更新审计证据

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `docs/requirement-ledgers/2026-08-23-deepseek-failure-fallback-discussion.md`

- [x] **Step 1: 写失败测试**

为带 `failed` 和 `canceled` DeepSeek 快照的确认页断言保存/同步按钮不因该状态禁用，且页面不存在“沿用原自动分类”按钮或旧失败门槛文案。

- [x] **Step 2: 验证测试确实失败**

Run: `npm exec vitest run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx --reporter=dot`

Expected: 当前 `deepSeekBlocksExecution` 仍包含 `failed` / `canceled`，并渲染回退按钮。

- [x] **Step 3: 最小实现**

将 `deepSeekBlocksExecution` 限定为 `running` / `waiting`，删除确认执行中的回退确认 UI 与仅供它使用的回调使用；不改变未匹配暂存、标签、备册预检、同步确认或 B 站执行路径。

- [x] **Step 4: 运行关联回归与更新账本**

Run: `npm exec vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx --reporter=dot`

Expected: 通过。账本 I001 记录具体代码位置、自动化结果、Electron 只读验收和未验证的真实 DeepSeek/B 站副作用。

- [ ] **Step 5: 质量检查与选择性提交**

Run: `npm run build; git diff --check; git diff --stat; git status --short`

Expected: 构建和空白检查通过。仅暂存本计划、项目书、本轮账本以及上述 DeepSeek 文件与测试；不得混入同步前备册预检、转写、视频同步、删除确认或无关文件。

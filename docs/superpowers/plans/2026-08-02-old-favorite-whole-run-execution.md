# Old Favorite Whole-Run Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-batch overview counts truthful and queue one whole-run DeepSeek/save/sync operation until every batch is ready.

**Architecture:** Keep the existing durable DeepSeek checkpoint and add a durable whole-run execution intent at the coordinator/store boundary. Lift the renderer view scope to the guide so the top batch selector and all four steps share one source of truth. Derive overview waiting and inbox counts only from completed segment projections.

**Tech Stack:** TypeScript, Electron main process, React, Vitest, Testing Library.

---

### Task 1: Correct whole-run overview counts

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [ ] Add a failing test where one completed segment contains classified and unmatched videos while another segment is still tagging.
- [ ] Verify the test fails because pending videos are reported as unmatched and inbox is absent.
- [ ] Add completed-segment unique counts, waiting count, and an inbox archive target.
- [ ] Verify coordinator and confirmation tests pass.

### Task 2: Share the guide view scope

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] Add a failing test that selects the second batch and then opens each step.
- [ ] Verify every step still keeps its prior local scope.
- [ ] Lift `OldFavoriteViewScope` into `OldFavoriteGuide`; selecting a segment sets `current`, and any step switch updates the shared scope.
- [ ] Verify single-batch tests remain unchanged.

### Task 3: Queue whole-run confirmation

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Test: `electron/main/oldFavoriteWorkspaceStore.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [ ] Add failing tests for a durable local/sync intent while a segment or DeepSeek run is waiting.
- [ ] Verify no local commit or remote freeze occurs early.
- [ ] Persist the intent, expose it in snapshots, and lock mutations while waiting.
- [ ] Continue the intent after the last ready notification and DeepSeek checkpoint completion.
- [ ] Add cancellation and failure behavior that never executes an incomplete plan.
- [ ] Verify focused main-process and renderer tests pass.

### Task 4: Verification

**Files:**
- Test all modified files and existing old-favorite regression suites.

- [ ] Run `vitest` for coordinator, DeepSeek service, store, IPC, guide, overview, archive, and confirmation tests.
- [ ] Run `git diff --check`.
- [ ] Verify the running Electron development app with at least two batches.
- [ ] Create one local commit and do not push.

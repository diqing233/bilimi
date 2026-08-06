# Old Favorite Authoritative Batch Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make batch readiness, overview statistics, DeepSeek work, local saving, Bilibili synchronization, and managed-folder projection agree on one authoritative per-batch state.

**Architecture:** The main-process coordinator owns exact segment membership and readiness. Renderer actions select either the current segment or whole run, while whole-run execution advances in segment order and persists local results before optional remote synchronization. Managed-folder recovery reuses established logical bindings and does not materialize duplicate recommendation drafts.

**Tech Stack:** Electron, TypeScript, React, Vitest.

---

### Task 1: Authoritative segment readiness and overview

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Test: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [ ] Add failing tests using non-contiguous AIDs to prove unprocessed segments remain waiting.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Replace numeric AID-range inference with exact segment membership and require completed classification state.
- [ ] Repair restored DeepSeek checkpoints by removing work for non-ready segments.
- [ ] Run focused tests until green.

### Task 2: Confidence and running-state projection

**Files:**
- Modify: `src/shared/recommendation/videoClassifier.ts`
- Test: `src/shared/recommendation/videoClassifier.test.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [ ] Add failing tests for exact adopted-tag high confidence and canceled-to-running feedback recovery.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement the minimal confidence and state-projection fixes.
- [ ] Run focused tests until green.

### Task 2A: Current-batch scan overview scope

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [ ] Add failing recovery tests proving exact segment membership keeps every unloaded batch in its real waiting/tagging state.
- [ ] Add failing renderer tests proving current-batch metrics use the current batch's unique eligible-video count and omit protected/unavailable cards.
- [ ] Add failing renderer tests proving source rows retain global relationship counts while the current-batch column reports per-source batch relationships, which may exceed the unique batch size because of duplicates.
- [ ] Run the focused tests and confirm they fail for the missing behavior.
- [ ] Persist and restore exact per-segment AID membership instead of inferring unloaded segments from numeric AID ranges.
- [ ] Project explicit waiting-scan, tagging, ready, and saved states; exclude waiting/tagging batches from processed, inbox, archive-target, and DeepSeek counts.
- [ ] Render current-batch progress and metrics from the selected segment only; retain protected/unavailable metrics in whole-run scope.
- [ ] Run focused coordinator and scan-overview tests until green.

### Task 3: Current-batch and whole-run local save lifecycle

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] Add failing tests for first-ready-batch action availability, ordered whole-run saving, revisiting and replacing a saved batch, and single-batch compact controls.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement current/all save scope, saved-dirty state, ordered execution intent, and local-only finish labels.
- [ ] Add the Bilibili confirmation checkbox for optionally including `bilimi·暂存`, defaulting off and scoped to one confirmation.
- [ ] Run focused tests until green.

### Task 4: Duplicate managed-folder projection

**Files:**
- Modify: `electron/main/favoriteLibraryManagedFolderProjection.ts`
- Test: `electron/main/favoriteLibraryManagedFolderProjection.test.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts`
- Test: `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

- [ ] Add failing tests proving an established remote binding suppresses a same-remote custom draft and duplicate navigation entry.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Reuse the established logical ledger by remote ID and hide safe empty legacy duplicates.
- [ ] Keep ambiguous, populated, or different-remote records visible for manual review.
- [ ] Run focused tests until green.

### Task 5: Verification and Electron acceptance

**Files:**
- Evidence: `.codex-artifacts/`

- [ ] Run coordinator, DeepSeek, classifier, hook, confirmation, controlled-panel, managed-folder, and favorite-library tests.
- [ ] Run `git diff --check`, `git diff --stat`, and inspect `git status --short`.
- [ ] Start Electron development mode and verify click, scroll, resize, minimize/restore, and close responsiveness.
- [ ] Verify unfinished segments do not affect overview/inbox/DeepSeek; save controls and inbox-sync confirmation match the agreed rules.
- [ ] Stop the project and put Windows to sleep.

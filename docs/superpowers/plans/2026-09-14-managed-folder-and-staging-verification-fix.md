# Managed Folder and Staging Verification Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a successfully Bilibili-synchronized managed-folder deletion stay deleted across technical reads, and make the single-batch “save this round” action materialize unmatched videos in the visible `bilimi·暂存` folder.

**Architecture:** The remote deletion service will share the existing account lock and persistent hidden-folder preference boundary already used by the local and legacy managed-folder deletion services. The single-batch confirmation button will use the already-existing whole-run local save command, which first persists the current segment then materializes the complete round into `bilimi-logical:inbox`; it will not change the distinct multi-batch “save current batch” behavior.

**Tech Stack:** Electron main process, TypeScript, React, Vitest, Testing Library.

---

### Task 1: Protect the successful remote-delete local projection

**Files:**

- Modify: `electron/main/favoriteRepositorySyncService.test.ts`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `electron/main/index.ts`

- [x] **Step 1: Write the failing service regression test**

  Add a `FavoriteRepositorySyncService.deleteManagedFolders()` test that supplies a successful remote folder delete plus two injected callbacks: `markLocalManagedFoldersHidden` and `runWithLocalManagedFolderDeletion`. Assert that, only for the full successful delete, the service calls the account lock around a callback that first stores the logical IDs in the hidden set and then commits `delete-local-managed-folders`. Assert that the hidden callback receives the actual logical IDs, not physical folder IDs.

- [x] **Step 2: Run the focused test and verify the regression fails**

  Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts`

  Expected: the new test fails because the successful `deleteManagedFolders()` path has not called the injected hide/lock callbacks.

- [x] **Step 3: Add the smallest service boundary required by the test**

  Extend the sync-service options with the two existing deletion-boundary callbacks. After every requested remote folder is confirmed deleted or absent, wrap the local projection commit in `runWithLocalManagedFolderDeletion(account, ...)`. Inside that callback, call `markLocalManagedFoldersHidden(account, logicalLedgerIds)`, commit `delete-local-managed-folders`, and invoke the returned rollback only if that local commit fails. Do not mark or remove the local projection for partial, failed, or unknown remote deletion results.

- [x] **Step 4: Wire the existing application services into that boundary**

  In `electron/main/index.ts`, pass the existing `FavoriteRepositoryEmptyManagedFolderRecovery.runWithLocalManagedFolderDeletion()` account lock and `persistLocalManagedFolderHiddenIds()` preference transaction into `FavoriteRepositorySyncService`. Preserve current Bilibili refresh deferral/release ordering and do not add remote reads or writes.

- [x] **Step 5: Re-run focused service tests**

  Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts`

  Expected: all tests pass, including the new full-success test; partial/failed/unknown deletion behavior remains covered by its existing tests.

### Task 2: Route single-batch “save this round” to the complete local result

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`

- [x] **Step 1: Write the failing interaction regression test**

  Render a ready, single-batch confirmation snapshot with a distinct `onSaveLocally` and `onSaveWholeRun` mock. Click `保存本轮到收藏库` and assert only `onSaveWholeRun` was called. This specifies the UI boundary that reaches the existing hook → IPC `set-whole-run-execution-intent` → coordinator `saveWholeRunToLocalLibrary()` chain.

- [x] **Step 2: Run the focused renderer test and verify the regression fails**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

  Expected: the new test fails because the current single-batch button calls `onSaveLocally`.

- [x] **Step 3: Make the single-batch round button call the whole-run handler**

  Change only the non-multi-segment round-save button’s click handler from `onSaveLocally` to `onSaveWholeRun`. Keep its present label, availability gate, DeepSeek/tag guard, and the multi-batch current-batch/save-whole-run split unchanged.

- [x] **Step 4: Re-run focused renderer tests**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

  Expected: the new interaction test and all pre-existing confirmation tests pass.

### Task 3: Cross-layer regression and release verification

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-14-managed-folder-and-staging-verification-failure.md`

- [x] **Step 1: Run affected cross-layer tests**

  Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

  Expected: the coordinator proof retains its `bilimi-logical:inbox` materialization and default remote-plan exclusion, while renderer, hook, IPC, and deletion tests pass.

- [x] **Step 2: Update the requirement ledger with per-item code and verification evidence**

  Record exact modified modules, focused/cross-layer test commands, Electron manual test outcome, and anything that cannot be exercised without a real Bilibili deletion.

- [x] **Step 3: Run release gates and inspect the working tree**

  Run: `npm test`, `npm run build`, start `npm run dev` and perform the safe local confirmation-path check, run `npm run preview`, then `git diff --check`, `git diff --stat`, and `git status --short`.

  Expected: no test failures, build/preview start successfully, and only this plan’s source/test/ledger files are modified.

- [ ] **Step 4: Commit the implementation and ledger together**

  Run: `git add docs/requirement-ledgers/2026-09-14-managed-folder-and-staging-verification-failure.md docs/superpowers/plans/2026-09-14-managed-folder-and-staging-verification-fix.md electron/main/favoriteRepositorySyncService.ts electron/main/favoriteRepositorySyncService.test.ts electron/main/index.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx && git commit -m "fix: preserve deleted folders and final staging"`

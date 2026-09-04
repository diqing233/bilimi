# Recommendation Existing Delete Reuse Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Route recommendation-origin rules through the existing three deletion flows and ensure every confirmed flow fully removes the local rule projection without resurrection.

**Architecture:** Keep FavoriteLedgerOverview as the existing delete-plan presenter; remove the recommendation-only shortcut so it supplies recommendation rules to the established local/remote plan. Extend the existing main-process local-rule deletion completion with the repository's existing delete-local-managed-folder(s) command, then pass exact remote-ID suppression to recovery/projection.

**Tech Stack:** Electron main process, React/TypeScript renderer, shared favorite repository command model, Vitest.

---

### Task 1: Document the approved boundary

**Files:**
- Modify: docs/项目功能项目书.md section 9.8
- Modify: docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md

- [x] **Step 1: Record the project-book rule before behavior changes**

Add section 9.8: recommendation rules reuse—not replace—the existing unbacked, local-only, and remote-confirmed deletion flows; all confirmed flows clear the stable local logical rule and only the existing remote-confirmed flow deletes the exact Bilibili ID.

- [x] **Step 2: Record evidence after verification**

Append implementation evidence for I021–I024 with exact locations, RED/GREEN output, remote-spy assertions, and any real-Electron gaps. Do not edit original-user-text entries.

### Task 2: Route recommendation rules to the existing delete plan

**Files:**
- Modify: src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx lines 1090-1263
- Test: src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx

- [x] **Step 1: Write failing route tests**

Add a detail-delete test and a deletion-mode test for ruleOrigin recommendation-draft, bindingState bound, and an exact remote ID. Assert the current preview opens; the current local-only scope calls only deleteFavoriteLedgersLocal; the current Bilibili scope calls only deleteManagedRemoteFolders before local cleanup.

- [x] **Step 2: Run RED**

Run npm.cmd test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --silent. The new assertions must fail because recommendation rules bypass requestManagedDeletion.

- [x] **Step 3: Implement the smallest routing change**

Remove only the recommendation-specific early delete branch. Let the existing isDraftDirectlyDeletable, isPureLocalLedger, and ManagedDeletionPlan route these rules. Do not modify the dialog or add a recommendation-specific API.

- [x] **Step 4: Run GREEN**

Re-run the command from Step 2. The tests pass and local-only has no remote call.

### Task 3: Reuse repository deletion for local-rule completion

**Files:**
- Modify: electron/main/index.ts lines 1848-1915
- Test: electron/main/favoriteLedgerDraftDeletionIpc.test.ts
- Test: electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts

- [x] **Step 1: Write a failing IPC contract test**

Require assistant:delete-favorite-ledgers-local to commit existing delete-local-managed-folder(s) only for existing bilimi-logical stable-rule folders after the account-rule deletion persists. Assert no Bilibili remote bridge/delete is invoked.

- [x] **Step 2: Run RED**

Run npm.cmd test -- electron/main/favoriteLedgerDraftDeletionIpc.test.ts electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts --silent. The new assertion must fail because the handler does not use favoriteRepositoryService.

- [x] **Step 3: Implement bounded cleanup**

After saving the account deletion, read the repository snapshot and commit one existing local-managed-folder deletion command for only matching stable IDs. Do not pass confirmed remote IDs, so local-only deletion retains Bilibili mirrors. If repository cleanup fails, restore the prior account preferences and fail the request.

- [x] **Step 4: Run GREEN**

Re-run the command from Step 2. The IPC contract passes without a remote operation.

### Task 4: Prevent deleted recommendation records from re-projecting

**Files:**
- Modify: electron/main/favoriteLibraryManagedFolderProjection.ts lines 112-297
- Modify: electron/main/index.ts lines 3117-3135
- Test: electron/main/favoriteLibraryManagedFolderProjection.test.ts
- Test: electron/main/oldFavoriteWorkspaceCoordinator.test.ts

- [x] **Step 1: Write failing projection/recovery tests**

Create a snapshot with a recommendation logical folder and exact remote ID. After equivalent local deletion, assert account-open projection recreates neither the stable logical folder nor custom-remote-folderId; a different same-title remote ID remains eligible.

- [x] **Step 2: Run RED**

Run npm.cmd test -- electron/main/favoriteLibraryManagedFolderProjection.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts --silent. The new test must fail because deleted records can still plan a candidate.

- [x] **Step 3: Apply exact-ID suppression**

Pass pending local-deletion remote IDs to managed-folder projection. Exclude deleted recommendation records from restoration while keeping the existing deleted-record recovery entry. Do not match by title.

- [x] **Step 4: Run GREEN**

Re-run the command from Step 2. The exact deleted ID stays absent and a different ID stays independent.

### Task 5: Audit and commit the isolated branch

**Files:**
- Modify: docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md

- [x] **Step 1: Run targeted suites**

Run npm.cmd test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/favoriteLedgerDraftDeletionIpc.test.ts electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts electron/main/favoriteLibraryManagedFolderProjection.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts --silent.

- [x] **Step 2: Run full verification**

Run npm.cmd test -- --silent, npm.cmd run build, git diff --check, git status --short, and git diff --stat.

- [x] **Step 3: Re-read R001–R026 and update ledger evidence**

Record code locations, automatic tests, and unresolved real-Electron/account verification for I021–I024.

- [ ] **Step 4: Commit only this topic**

Commit project book, ledger, source, and tests with fix: reuse managed deletion for recommendation rules. Do not merge, push, rebase, or remove the worktree; wait for explicit “合并”.

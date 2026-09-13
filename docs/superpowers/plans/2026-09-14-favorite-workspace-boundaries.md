# Favorite Workspace Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep scan-only local staging out of the formal bilimi inbox, and let a local-only workspace deletion hide its local projection without losing the formal Bilibili binding.

**Architecture:** The repository service's read models distinguish `local:inbox` from `bilimi-logical:inbox` at both summary and page scope. The reducer distinguishes local projection deletion from confirmed remote deletion: the former drops only the logical folder and local placement records, retaining bound physical shards as durable Bilibili identity; summary suppression hides the retained remote projection until an explicit recovery/backup flow.

**Tech Stack:** TypeScript, Electron main process, Vitest.

---

### Task 1: Formal inbox read-model boundary (R001)

**Files:**

- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`

- [x] **Step 1: Write the failing test**

Create a snapshot with `local:inbox` member `1` and formal `bilimi-logical:inbox` member `2`; assert `getLibrarySummary()` reports count `1` for the formal inbox and `getLibraryPage(..., { kind: 'folder', folderId: 'bilimi-logical:inbox' })` returns only `2`.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts`

Expected: the formal inbox count/page includes the local staging member, proving the leak.

- [x] **Step 3: Write the minimal implementation**

Remove the special union of `local:inbox` with `bilimi-logical:inbox` in `getLibrarySummary()` and `libraryAids()`; preserve ordinary local-inbox behavior and all formal inbox members.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts`

Expected: PASS.

### Task 2: Local-only deletion retains the formal binding (R002)

**Files:**

- Modify: `src/shared/favoriteRepository.test.ts`
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `src/shared/favoriteLedgerBindingProjection.test.ts`

- [x] **Step 1: Write the failing tests**

Extend the local managed-folder deletion fixture to assert that a deletion without `confirmedRemoteFolderIds` removes `bilimi-logical:work` and its local classification, while retaining its bound `physicalShards` record and physical membership. Project the retained shard into a bound rule and assert its Bilibili ID remains `91`.

- [x] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- src/shared/favoriteRepository.test.ts src/shared/favoriteLedgerBindingProjection.test.ts`

Expected: the reducer has removed the physical shard, so the new assertion fails.

- [x] **Step 3: Write the minimal implementation**

In the `delete-local-managed-folder(s)` reducer branch, when no remote folder IDs were confirmed deleted, remove only logical work-folder identity, its local memberships and local placement intent. Retain physical shard records, physical memberships and ordinary Bilibili observations. Keep the existing complete deletion behavior unchanged when confirmed remote IDs are supplied.

- [x] **Step 4: Run the focused tests to verify they pass**

Run: `npm test -- src/shared/favoriteRepository.test.ts src/shared/favoriteLedgerBindingProjection.test.ts`

Expected: PASS.

### Task 3: Regression and handoff

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-14-local-inbox-projection-leak.md`

- [x] **Step 1: Run boundary-specific tests**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts electron/main/favoriteRepositoryManagedFolderService.test.ts src/shared/favoriteRepository.test.ts src/shared/favoriteLedgerBindingProjection.test.ts`

- [x] **Step 2: Run repository checks**

Run: `npm test`, `npm run build`, `git diff --check`, then inspect `git status --short` and `git diff --stat`.

- [x] **Step 3: Perform runtime checks**

Start the Electron development build and preview. Verify a scan with local staging does not increment formal `bilimi·暂存`; verify local-only deletion hides the left work folder, leaves the corresponding right-side state as `已备册`, and does not issue a Bilibili operation.

- [x] **Step 4: Record evidence and commit**

Recorded: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts` passed all 392 tests, including restored scanning inventory and restored preview protection coverage that rebuilds protections from current `bilimi-logical:*` memberships. The suite logs its deliberate simulated Bilibili-binding/backup-preflight failures to stderr. Full `npm test`, `npm run build`, and the boundary suites also pass; live destructive scan/delete flows remain deliberately reserved for manual acceptance so no local or Bilibili user data is changed. Commit only the plan, ledger, focused implementation, and tests with `fix: preserve favorite workspace binding boundaries`.

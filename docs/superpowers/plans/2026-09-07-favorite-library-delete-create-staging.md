# Favorite Library Delete, Preview, and Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge confirmed B站 bilimi deletion locally, use one detail deletion dialog, show zero-match new ledgers in single-batch preview, and include staging in work-folder deletion.

**Architecture:** The main-process repository remains authoritative. Confirmed exact remote removal performs the existing local removal transaction; the organizer extends archive-target projection only; the renderer reuses its final confirmation dialog and current staging synthesis helper.

**Tech Stack:** Electron, TypeScript, React, Vitest.

---

### Task 1: Converge confirmed managed-placement removal

**Files:**

- Modify: `electron/main/favoriteRepositoryBatchOperationService.test.ts`
- Modify: `electron/main/favoriteRepositoryBatchOperationService.ts`

- [x] **Step 1: Write the failing test**

Seed `bilimi-logical:games` and `bilimi-logical:music` for aid `1`, with an exact remote physical observation for games. Test direct success and unknown-then-reconciled success, asserting `games` is removed from memberships, `localDesiredFolderIds`, and remote observation while music remains.

- [x] **Step 2: Verify RED**

Run: `npm test -- electron/main/favoriteRepositoryBatchOperationService.test.ts`

Expected: FAIL because successful removal currently preserves local intent.

- [x] **Step 3: Implement the minimal change**

On successful managed-placement removal, invoke `finalizeManagedPlacementLocalRemoval(operation, true)` then recycling; retain existing failed/unknown restoration and exact remote observation rules.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- electron/main/favoriteRepositoryBatchOperationService.test.ts`

Expected: PASS.

### Task 2: Detail delete dialog and staging candidate

**Files:**

- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [x] **Step 1: Write failing tests**

Test clicking detail remote deletion with a preview mock opens final confirmation immediately and no `继续` button exists. Test delete-all with `local:inbox` asserts `选择 bilimi·暂存` exists.

- [x] **Step 2: Verify RED**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: FAIL because `choice` renders `继续`, and delete-all uses only physical logical folders.

- [x] **Step 3: Implement the minimal change**

Call `beginRemoteUnfavorite` directly from `openRemoteUnfavoriteDialog`, remove only the `choice` rendering state, and build delete-all candidates from `workspaceBackupFolders(folders)`. Preserve final preview, missing-target and unverified states.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: PASS.

### Task 3: Single-batch zero-match new-ledger preview

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [x] **Step 1: Write the failing test**

Create a single-batch workspace with participating saved ledger `{ id: 'custom-genshin', title: 'bilimi·原神' }`, no matching assignments, and an eligible source video. Assert `overview.archiveTargets` contains `{ ledgerId: 'custom-genshin', displayName: 'bilimi·原神', count: 0 }`.

- [x] **Step 2: Verify RED**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: FAIL because the single-batch archive target projection only includes members.

- [x] **Step 3: Implement the minimal change**

Merge participating saved ledger IDs into the existing archive-target set, resolve their saved display titles through `resolveLedgerTitle`, and emit zero only for no-member entries. Do not change member commits, local saving, binding, B站 preflight, or remote writes.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS.

### Task 4: Evidence, regression, and branch checkpoint

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-07-favorite-library-delete-create-staging.md`
- Verify: `docs/项目功能项目书.md`

- [x] **Step 1: Run focused suites**

Run each focused command from Tasks 1–3. Expected: all exit 0.

- [x] **Step 2: Run full verification**

Run `npm test`, `npm run build`, `git diff --check`, and `git status --short`. Expected: tests/build exit 0, diff check empty, only scoped files changed.

- [ ] **Step 3: Electron acceptance**

Verify one detail deletion dialog, no-target message, confirmed deletion removes only the selected current work-folder record, delete-workspace lists staging, and single-batch preview renders `bilimi·原神` with `0 条适合`. Verify mouse move, click, scroll, resize, minimize, restore, and close remain responsive.

- [x] **Step 4: Record and commit**

Record per-index code paths and verification evidence; commit only the scoped code, tests, project book, ledger, and plan using `fix: converge favorite library deletion and preview`.

## Plan self-review

- I001 is Task 1; I002 and I004 are Task 2; I003 is Task 3.
- R002’s replacement boundary is retained: zero-match is preview-only, not an empty-folder write.
- Task 4 requires focused/full tests, build, diff hygiene, Electron responsiveness evidence, and per-ledger evidence.

## Execution record

- Focused service, renderer, organizer and preview suites passed; the complete `npm test` run passed 249 files / 4,472 tests.
- `npm run build` passed on 2026-09-07. It retained only the existing `FloatingAssistantApp` dynamic/static import chunk warning.
- Electron opened with an isolated development profile but stopped at the operating-system network-permission guide before account-backed acceptance could begin. Do not treat this as B站 or input-responsiveness acceptance; it remains a manual verification item.

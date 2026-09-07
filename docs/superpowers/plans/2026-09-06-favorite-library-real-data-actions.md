# Favorite Library Real-Data Actions Implementation Plan

## Task 1: Remove state-based move restriction

**Covers:** R001, R002 / I001.

**Files:** `FavoriteLibraryApp.tsx`, `FavoriteLibraryToolbar.tsx`, `favoriteRepositoryBatchOperationService.ts`, focused tests.

- [x] Add failing tests proving move remains enabled and main service accepts unfinished workspace snapshots.
- [x] Remove renderer `workspaceMoveLocked` wiring and main-process status rejection; keep revision/source/target validation.
- [x] Verify movement writes latest local placement and refreshes existing view.

## Task 2: Make local video deletion data-driven

**Covers:** R001, R002 / I002.

**Files:** `FavoriteLibraryApp.tsx`, `favoriteRepositoryOperationsIpc.ts`, `favoriteRepositoryBatchOperationService.ts`, `favoriteLibraryOperations.ts`, focused tests.

- [x] Add failing tests for deletion from all/unmatched/unfinished contexts and no target no-op behavior.
- [x] Remove source/status gates that hide or reject local deletion; retain actual local placement resolution and audit/recycle behavior.
- [x] Verify deletion does not mutate organizer drafts or classification-adjustment history and refreshes the library.

## Task 3: Keep remote video deletion strictly evidence-based

**Covers:** R001, R003 / I003.

**Files:** `FavoriteLibraryApp.tsx`, `favoriteRepositoryBatchOperationService.ts`, remote deletion tests.

- [x] Add failing tests for observed remote target versus no observed target.
- [x] Preserve the no-target explanatory dialog and execute only observed managed placements.
- [x] Verify ordinary Bilibili sources remain untouched and local view refreshes.

## Task 4: Restore managed-folder delete semantics

**Covers:** R003 / I005.

**Files:** `FavoriteLibraryApp.tsx`, `FavoriteRepositoryManagedFolderService.ts`, related IPC/tests.

- [x] Add failing tests for local-only delete when unbacked and local+remote delete when actual remote target exists.
- [x] Ensure local deletion is always offered; remote deletion is only executed for actual remote candidates, while all selected local work folders still close locally.
- [x] Verify local projection, rules/drafts, ordinary folders, and refresh behavior.

## Task 5: Add sync hover state and verify

**Covers:** R001 / I004.

**Files:** `FavoriteLibraryApp.css`, toolbar/detail style tests.

- [x] Add a failing style assertion for sync button hover/focus color.
- [x] Add the minimal existing-system hover/focus style.
- [x] Run focused tests, build, full test suite, diff checks, and update the ledger with evidence.

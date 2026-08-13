# Favorite Library Delete And Recycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate bilimi work-folder deletion from video-library deletion, remove permanent ordinary-folder dismissal, and make source-aware deletions recoverable without changing ordinary Bilibili content.

**Architecture:** Keep the existing repository command and IPC boundaries, but make local managed-folder deletion source-aware and side-effect free with respect to the legacy dismissed store. Persist a small default-ledger deletion marker while clearing every stale binding field. Keep the settings and library dialogs as separate UI responsibilities, and add dedicated draft deletion paths that never call repository membership deletion.

**Tech Stack:** Electron main process, React renderer, TypeScript shared repository, Vitest, Testing Library.

---

### Task 1: Lock shared deletion and source-recovery behavior

**Files:**
- Modify: `src/shared/favoriteLedgerDeletion.ts`
- Test: `src/shared/favoriteLedgerDeletion.test.ts`
- Modify: `src/shared/favoriteRepository.ts`
- Test: `src/shared/favoriteRepository.test.ts`

- [ ] Write failing tests for default deletion clearing every remote binding field while retaining the stable rule ID and a durable user-deleted marker.
- [ ] Write failing tests for local managed-folder deletion preserving videos with any remaining source and creating only `allowRediscovery: true` recycled tombstones when complete source evidence says no source remains.
- [ ] Implement the smallest shared rule/state and repository command changes needed by those tests.
- [ ] Run the focused shared tests and verify red/green output.

### Task 2: Remove legacy dismissed side effects and protect remote deletion

**Files:**
- Modify: `electron/main/favoriteRepositoryManagedFolderService.ts`
- Test: `electron/main/favoriteRepositoryManagedFolderService.test.ts`
- Modify: `electron/main/favoriteLibraryManagedFolderProjection.ts`
- Test: `electron/main/favoriteLibraryManagedFolderProjection.test.ts`
- Modify: `electron/main/store.ts`
- Test: `electron/main/store.test.ts`

- [ ] Add failing coverage proving local-only deletion does not write `favoriteLibraryDismissedRemoteFolderIdsByAccount` and the next projection can rediscover the retained Bilibili folder.
- [ ] Add failing coverage proving ordinary-folder historical dismissed IDs do not suppress the new projection, while the default deletion marker still prevents automatic default reconstruction.
- [ ] Implement the minimal read/migration filtering and remove the local deletion callback invocation.
- [ ] Keep remote-folder ID revalidation, one-shot remote execution, and failure/result-unknown local retention unchanged.

### Task 3: Add direct draft deletion and binding guards

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Test: existing assistant and ledger API tests plus focused additions.

- [ ] Add failing tests for deleting an unbound remote candidate or local unsaved rule without changing repository memberships, logical folders, or other drafts.
- [ ] Add failing tests that keep “从 B 站 bilimi 收藏夹删除” visible but disabled before formal binding.
- [ ] Implement draft-only deletion IPC/API and retain name-based candidate discovery plus `remoteFolderId` confirmation.

### Task 4: Align both deletion dialogs and refresh behavior

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryDialogs.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Test: corresponding renderer tests.

- [ ] Add failing tests for the exact two-choice work-folder dialog, the renamed local video action, visible-but-disabled remote action, and the existing generic failure notice.
- [ ] Implement success refresh of sidebar, current list, detail, and recycle counts for both video actions.
- [ ] Keep remote folder deletion limited to bound bilimi targets and leave ordinary Bilibili folders untouched.

### Task 5: Remove ordinary-folder menus and user-visible clear-records entry

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryWorkspace.tsx`
- Test: navigation, app, toolbar, and workspace tests.

- [ ] Add failing tests asserting no ordinary group/item three-dot menu and no “清空收藏库整理记录” menu/dialog/callback.
- [ ] Remove only those user-visible entries; retain internal compatibility commands where existing persistence needs them.

### Task 6: Regression and interface verification

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-13-favorite-library-delete-recycle.md`
- Create: `.codex-artifacts/` verification outputs only.

- [ ] Run focused Vitest suites, then `npm test`, `git diff --check`, and the Electron development build.
- [ ] Capture screenshots for the two-choice dialog, hidden ordinary menus, disabled remote video action, success refresh, and generic failure notice.
- [ ] Update every index row with code locations, automated evidence, and interface verification or an explicit blocker.
- [ ] Create one local commit on `main` containing the ledger, plan, and implementation; do not merge, push, or rebase.

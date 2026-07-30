# Favorite Conflict Dialog And Local Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep favorite binding warnings compact while preventing existing Bilimi logical ledgers from being duplicated as same-title local folders during local old-favorite saves.

**Architecture:** The old-favorite coordinator resolves each classified ledger to an existing `bilimi-logical:<id>` folder when available and uses `local:<id>` only for genuinely local ledgers. The repository index reports only ambiguous binding conflicts, while the renderer exposes conflicts through one compact status action and a modal built on the existing dialog shell.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library.

---

### Task 1: Preserve Existing Logical Ledger Identity

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [x] Add a regression test that seeds `bilimi-logical:game`, saves a classified item locally, and expects membership and protection records to target `bilimi-logical:game` without creating `local:game`.
- [x] Run the focused test and confirm it fails because the coordinator currently always prefixes targets with `local:`.
- [x] Resolve target folder IDs from the repository snapshot, preferring an existing matching logical folder and retaining `local:inbox` for unclassified items.
- [x] Re-run the focused coordinator tests and confirm the regression passes.

### Task 2: Exclude Non-Binding Local Duplicates From Binding Conflicts

**Files:**
- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`

- [x] Add a regression test with a bound logical game folder plus `local:game` and assert no binding conflict is emitted.
- [x] Run the focused test and confirm the current title-only grouping reports a false conflict.
- [x] Restrict title binding conflicts to genuinely ambiguous remote/logical binding candidates; keep two same-title unbound Bilibili folders as a conflict.
- [x] Re-run the focused repository tests.

### Task 3: Compact Warning And Conflict Dialog

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryDialogs.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`

- [x] Replace the inline conflict-content expectation with a compact `发现 N 项收藏夹问题 · 点击处理` action and an initially closed dialog.
- [x] Confirm the renderer test fails against the current inline section.
- [x] Add a reusable conflict dialog using the existing modal shell, including reasons, candidate IDs/titles/counts when available, safe guidance, close behavior, and rescan entry.
- [x] Remove the space-consuming inline conflict section and keep only the compact status action near the library header/status surface.
- [x] Re-run renderer tests and accessibility interaction checks.

### Task 4: Verification

**Files:**
- Verify only; no release packaging.

- [x] Run focused coordinator, repository, dialog, and favorite-library tests.
- [x] Run the broader related test files.
- [x] Run `npm run build`.
- [x] Run `git diff --check` and inspect only the files changed by this task.
- [ ] Restart the development app without clearing `%APPDATA%\bilimi-dev` and verify the compact prompt, modal, and game-folder display against the real account state.

  Environment note (2026-07-28): the restarted development app retained the signed-in Bilibili page, but the sidebar reported `未备册` and did not attach the existing account repository. To avoid remote writes, verification stopped without clicking `备册` or `同步`. The on-disk repository remains intact and the regression coverage verifies the legacy membership merge and compact dialog behavior.

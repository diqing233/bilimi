# Library Controls Typography And Menu Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Make the scan overview count read as `全选（N）`, give the classification/ownership menu a short first level and wide single-line second level, and make the batch `转写操作` label typographically identical to its neighboring actions.

**Architecture:** Keep behavior and data flow unchanged. Use the existing scan overview markup, add a classification-menu-specific CSS hook, and define one explicit font contract on the batch action row so native buttons and `VideoSummaryMenu` share the same inherited values.

**Tech Stack:** React, TypeScript, CSS, Vitest, Electron development build.

---

### Task 1: Record and verify the three user-facing contracts

**Files:**
- Modify: `docs/项目功能项目书.md:121, 235, 386-395`
- Create: `docs/requirement-ledgers/2026-08-19-library-controls-typography-and-menu-width.md`
- Create: `docs/superpowers/plans/2026-08-19-library-controls-typography-and-menu-width.md`

- [x] Add the four original user messages and screenshot paths to the ledger without rewriting them.
- [x] Add an index row for each confirmed behavior, including unchanged data and interaction boundaries.
- [x] Update the project book to describe the final `全选（N）` composition, classification menu width contract, and batch-action font contract.

### Task 2: Add failing renderer assertions

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.test.tsx`

- [x] Add a scan overview assertion that the source-select label contains `全选（2）` as one accessible label and that the count is not a sibling outside it.
- [x] Add a classification-menu style contract assertion requiring a dedicated first-level width, a wider second-level width, and `white-space: nowrap` for its option buttons.
- [x] Replace the old partial typography assertion with a failing contract requiring the batch action row to define one inherited `font-size`, `font-weight`, and `line-height` for native buttons and the video summary trigger.
- [x] Run the three focused tests and confirm each new assertion fails for the current implementation, then pass after implementation.

### Task 3: Implement the smallest markup and CSS changes

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] Move the source-folder `<small>` count inside `.favorite-ledger-panel__source-select-all` immediately after the `全选` text; retain the same count value and checkbox callback.
- [x] Add a classification/ownership-only class to the portal root and submenu. Set the first-level menu to a compact `116px` width, the submenu to a `216px` width, and submenu buttons to `white-space: nowrap`; leave generic state and transcription menus unchanged.
- [x] Set `.favorite-library__batch-actions` to an explicit `13px`, normal-weight, `1.2` line-height contract and make its native action buttons, destination trigger, and video summary trigger inherit that contract.
- [x] Run the three focused tests and confirm they pass (327/327).

### Task 4: Validate behavior and real interface presentation

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-19-library-controls-typography-and-menu-width.md`
- Modify: `docs/superpowers/plans/2026-08-19-library-controls-typography-and-menu-width.md`

- [x] Run `npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/FavoriteLibraryToolbar.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx` and record counts: 4 files, 327 tests passed.
- [x] Run `npm test` (234 files, 3879 tests passed) and `npm run build` (Electron main, preload, and renderer bundles passed).
- [x] Start/reload the Electron development app and verify with real screenshots: `全选（N）` is contiguous; classification first-level is shorter and second-level keeps every option on one line; batch `转写操作` matches neighboring labels. Escape closed the classification menu and the existing filter interaction remained functional.
- [x] Update each ledger index row with code location, automated evidence, and real Electron result.
- [x] Run final `git diff --check`, `git status --short --branch`, and `git diff --stat`; commit only the project book, ledger, plan, implementation, and tests on local `main`.

# Favorite Workflow Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate favorite synchronization from deletion, preserve or abandon organization drafts explicitly, and keep the favorite library identity and order coherent.

**Architecture:** The renderer owns transient deletion selection and dialogs; the repository remains the authority for logical-folder identity. Navigation consumes canonical logical folders and persisted ledger priority rather than deriving identity from display titles.

**Tech Stack:** React, TypeScript, Vitest, Electron IPC, favorite repository snapshots.

---

### Task 1: Independent Favorite Deletion Mode

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] Add a failing integration test showing that entering deletion mode survives the parent enabled-state update.
- [x] Replace reuse of synchronization enable state with a deletion-only selection state.
- [x] Verify normal synchronization sends only enabled ledgers and never queries deletion candidates.

### Task 2: Single End-Organization Dialog

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] Add a failing test for one dialog with close-and-keep versus clear-and-abandon actions.
- [x] Close the guide without issuing an abandon command for the keep-draft action.
- [x] Route clear-and-abandon through the existing workspace command with no nested confirmation.

### Task 3: Sync Confirmation and Waiting Copy

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [x] Add failing tests that final Bilibili sync never invokes managed-folder deletion preview.
- [x] Remove the old sync-driven deletion dialog chain.
- [x] Align archive waiting text with recommendation waiting text.

### Task 4: Canonical Library Folders and Navigation Order

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Test: `electron/main/favoriteRepositoryService.test.ts`
- Test: `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

- [x] Add failing tests for a legacy `local:<default-id>` plus its bound `bilimi-logical:<default-id>` appearing once with retained membership.
- [x] Canonicalize only identity-proven legacy/default pairs; never merge arbitrary equal titles.
- [x] Sort logical navigation by persisted ledger priority, then stable fallback order.
- [x] Render folder counts as small black auxiliary text.

### Task 5: Verification

- [x] Run the targeted renderer and main-process suites.
- [x] Run `npx electron-vite build` and `git diff --check`.
- [x] Review `git status --short` and `git diff --stat` for unrelated changes.

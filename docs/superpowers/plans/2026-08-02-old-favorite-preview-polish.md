# Old Favorite Preview Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make archive preview and confirmation compact, consistent, and usable for batch transfers while preserving existing multi-batch and persistence behavior.

**Architecture:** Keep repository facts in the main process and presentation state in the existing React steps. Reuse the bulk manual-classification callback and virtual track; add only local group selection state and a portal for the history overlay.

**Tech Stack:** React, TypeScript, Electron, Vitest, Testing Library, CSS.

---

### Task 1: Repository sync-state consistency

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [ ] Add a failing test where position state is aligned but `libraryStates.sync` is unsynced and assert that both list and detail say `未同步`.
- [ ] Render the detail sync chip from `detailSnapshot.libraryStates.sync`, falling back to the selected row fact while detail loads.
- [ ] Run the focused favorite-library tests and commit with the rest of this polish set.

### Task 2: Archive preview layout and batch transfer

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoritePreviewCard.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoritePreviewCard.test.tsx`

- [ ] Add failing tests for title-row scope placement, fixed five-line cards, normal white cards, automatic expansion on batch entry, card-body selection, select-all, cancel, and one bulk transfer callback.
- [ ] Move the expand control into the group header and add local batch state keyed by group ID.
- [ ] Reuse `onApplyManualClassifications` for one bulk replacement of the source group while preserving other target IDs.
- [ ] Move original classification beside the per-card transfer control and keep it outside the bordered five-line information area.
- [ ] Update CSS so expanded virtual and non-virtual tracks use the same fixed card dimensions.

### Task 3: History overlay and confirmation summary

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [ ] Add failing tests that the history menu is portaled and that confirmation uses ledger display names rather than internal IDs.
- [ ] Portal the history overlay to `document.body` and clamp its vertical and horizontal viewport position.
- [ ] Pass ledger names into confirmation and render target rows separated by borders instead of individual cards.

### Task 4: Verification

**Files:**
- Evidence: `.codex-artifacts/old-favorite-preview-polish/`

- [ ] Run focused tests for all modified components and repository facts.
- [ ] Run the broader old-favorite regression set and `git diff --check`.
- [ ] Verify the reported paths in the running Electron dev build without executing external writes.
- [ ] Review the diff, confirm the worktree contains only this task, and create a local commit without pushing.

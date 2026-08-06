# Old Favorite Summary And Waiting Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make whole-run counts close against the planned total and allow waiting batches to be inspected only through scan overview.

**Architecture:** Keep persisted workspace accounting unchanged because its pending-tag count is already correct. Derive the active tagging batch's total and completed counts from segment summaries in the shared overview component, and change only renderer navigation guards so waiting batches can be selected while non-scan steps remain locked.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Electron.

---

### Task 1: Close the whole-run progress summary

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] Add a failing component test for `1000 processed + 500 tagging + 1052 waiting = 2552`, including `370 completed / 130 pending` within the tagging batch.
- [ ] Run the focused test and confirm it fails because the tagging total and completed count are absent.
- [ ] Derive tagging totals from `snapshot.segments` and render DeepSeek as a processed-item subset.
- [ ] Reduce the compact summary text by one visual size without changing archive target cards.
- [ ] Run the focused overview tests and confirm they pass.

### Task 2: Allow waiting batch inspection without unlocking organization steps

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] Change the existing navigation test to require a waiting option to be enabled and selectable.
- [ ] Require selecting a waiting batch from archive overview to dispatch `select-segment`, switch to current scope, and force the scan step.
- [ ] Require recommendation, archive preview, and confirmation buttons to remain disabled.
- [ ] Run the focused test and confirm it fails against the current waiting guard.
- [ ] Remove the waiting option/handler block and force both tagging and waiting selections to scan overview.
- [ ] Run the focused navigation tests and confirm they pass.

### Task 3: Regression and real Electron verification

**Files:**
- Verify only; do not commit without user authorization.

- [ ] Run coordinator, DeepSeek, controlled panel, scan overview, archive preview, confirmation, and workspace-hook tests.
- [ ] Run `git diff --check`, `git diff --stat`, and `git status --short --branch`.
- [ ] Restart Electron and verify waiting-batch selection, locked steps, scrolling, clicking, resizing, minimizing/restoring, and closing.

# Ledger Dirty Label And Empty Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve ledger edit-state visibility and allow reliably empty Bilibili favorite folders to scan successfully without a detail request.

**Architecture:** Keep the UI change inside `FavoriteLedgerPanel` and its existing CSS/tests. In the scan script, trust only a finite numeric folder-list count of zero; bypass `readFolderVideos` for that folder while preserving the existing terminal handling for HTML responses from folders that are not reliably empty.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Electron renderer scripts.

---

### Task 1: Ledger editor status placement

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write failing UI tests**

Add assertions that a dirty card and editor heading both begin with `（未保存）`, and that the normal `14/20` counter is rendered beside the `册名` label rather than below the input.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx -t "places the dirty marker|places the ledger name count"`

Expected: failure because the dirty marker follows the name and the counter is in the validation block below the input.

- [ ] **Step 3: Implement minimal layout change**

Render the prefix before card names and before `正在编辑`, move the character counter into the name-label row, retain the red over-limit state and its error message, and avoid changing card dimensions.

- [ ] **Step 4: Verify GREEN**

Run the same focused command, then the complete `FavoriteLedgerPanel.test.tsx` suite.

### Task 2: Reliably empty folder scan bypass

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [ ] **Step 1: Write failing scan test**

Create a managed `bilimi·` folder whose folder-list entry contains numeric `media_count: 0`; make any resource-list request return HTML and assert that scanning succeeds with empty target membership and that no resource-list request occurs.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts -t "skips the resource request for a reliably empty managed folder"`

Expected: failure because the current loop still calls the resource endpoint and records a managed-folder failure.

- [ ] **Step 3: Implement minimal bypass**

When the folder-list count is a finite numeric zero, create an empty successful folder-scan result locally. Do not coerce strings or missing counts to zero, and leave all existing HTML/login/risk failure behavior unchanged for other folders.

- [ ] **Step 4: Verify GREEN**

Run the focused test, then the complete `favoriteLedgerApi.test.ts` suite.

### Task 3: Integrated verification and one commit

**Files:**
- Verify all files changed by Tasks 1 and 2.

- [ ] Run `git diff --check`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Review the final diff for scope and append-only safety.
- [ ] Stage only expected files and create exactly one overall commit.

# Button Border Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the default rectangular border from the small help toggles beside the favorite ledger section headings without affecting normal text action buttons.

**Architecture:** Keep the existing `favorite-ledger-panel__help-toggle` component and adjust only its CSS. Lock the behavior with the existing CSS snapshot-style test in `src/renderer/src/styles.test.ts`.

**Tech Stack:** React, CSS, Vitest.

---

### Task 1: Make Favorite Ledger Help Toggles Borderless

**Files:**
- Modify: `src/renderer/src/styles.test.ts`
- Modify: `src/renderer/src/styles.css`
- Modify: `docs/discussions/2026-07-08-button-border-discussion.md`

- [x] **Step 1: Write the failing style test**

Add assertions to the favorite ledger style test:

```ts
expectStyleSnippet('.favorite-ledger-panel__help-toggle { width: 24px; min-width: 24px;')
expectStyleSnippet('.favorite-ledger-panel__help-toggle { border: 0; background: transparent; box-shadow: none;')
expectStyleSnippet('.favorite-ledger-panel__help-toggle:hover:not(:disabled), .favorite-ledger-panel__help-toggle:focus-visible:not(:disabled) { background: rgba(220, 238, 255, 0.72);')
```

- [x] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: the new borderless help-toggle snippet assertion fails before the CSS change.

- [x] **Step 3: Implement the minimal CSS change**

Update `.favorite-ledger-panel__help-toggle` so the default state has no border, no filled background, and no shadow while retaining a stable 24px hit area. Keep the existing hover/focus feedback.

- [x] **Step 4: Run the style test and verify it passes**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: all tests in `styles.test.ts` pass.

- [x] **Step 5: Run the relevant component test**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

Expected: the favorite ledger panel still renders and existing interactions pass.

- [x] **Step 6: Update the discussion document**

Record that implementation chose the borderless icon-button direction and preserved hover/focus feedback.

- [ ] **Step 7: Commit once**

Stage the changed files and commit with:

```bash
git commit -m "fix: remove favorite ledger help toggle borders"
```

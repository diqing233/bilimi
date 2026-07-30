# DeepSeek Cancel Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge DeepSeek archive organization and cancellation into one stable three-state button.

**Architecture:** Keep the existing module-level cancellation flag for async batch control and mirror the cancellation-requested value in the old-favorite runtime store for rendering. The existing button dispatches start or cancel according to the running state; no DeepSeek request or batching behavior changes.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library

---

### Task 1: Specify the state-button behavior

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/styles.test.ts`

- [x] **Step 1: Extend the cancellation regression test**

Assert that the initial `DeepSeek 整理` button becomes `取消整理`, that no second cancel button exists, and that clicking it changes the same control to disabled `取消中...`.

```tsx
const organizeButton = screen.getByRole('button', { name: 'DeepSeek 整理' })
fireEvent.click(organizeButton)
const cancelButton = await screen.findByRole('button', { name: '取消整理' })
fireEvent.click(cancelButton)
expect(screen.getByRole('button', { name: '取消中...' })).toBeDisabled()
```

- [x] **Step 2: Add layout assertions**

Require a stable button width and a warning style selected by `data-action='cancel'`.

```ts
expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-run-button { min-width: 88px;')
expectStyleSnippet(".favorite-ledger-panel__deepseek-archive-run-button[data-action='cancel']")
```

- [x] **Step 3: Run focused tests and verify RED**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx -t "cancels DeepSeek archive organization before starting the next batch"`

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: FAIL because the current UI renders separate organize and cancel buttons and has no state-button styles.

### Task 2: Implement the three-state control

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Mirror cancellation-requested state for rendering**

Add `deepSeekArchiveCancelRequested` to the old-favorite runtime state. Reset it before each run and after the run finishes, and set it when cancellation is requested while retaining `oldFavoriteDeepSeekCancelRequested` for the async loop.

- [x] **Step 2: Replace the two buttons with one dispatcher**

Render one button whose label, disabled state, action, and `data-action` value reflect idle, running, and cancellation-requested states.

- [x] **Step 3: Add stable button styling**

Set the button minimum width to `88px` and apply a restrained warning border and text color while `data-action='cancel'`.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the two Task 1 commands.

Expected: PASS.

### Task 3: Verify and commit

**Files:**
- Verify all files changed above.

- [x] **Step 1: Run complete verification**

Run: `npm test`

Run: `npm run build`

Run: `git diff --check`

Expected: all commands exit with code 0; existing React `act(...)` warnings may remain.

- [x] **Step 2: Inspect the development UI**

Confirm the single toolbar button remains beside the scope selector and visibly transitions through its running and cancellation states without wrapping.

- [ ] **Step 3: Commit the completed requirement**

```bash
git add docs/superpowers/specs/2026-07-12-deepseek-cancel-toggle-design.md docs/superpowers/plans/2026-07-12-deepseek-cancel-toggle.md src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/styles.css src/renderer/src/styles.test.ts
git commit -m "合并 DeepSeek 整理与取消按钮"
```

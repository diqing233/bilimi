# Favorite Ledger Topbar Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `备册` and `整理旧藏` to the right side of the `掌库` title inside the existing topbar, with equal-width buttons matching the `转写音频` primary action scale.

**Architecture:** Preserve `FavoriteLedgerPanel` DOM and event handlers. Update the CSS contract for `.favorite-ledger-panel__topbar` so the title and toolbar share one row, with wrapping for narrow windows.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: Lock The Topbar Layout Contract

**Files:**
- Modify: `src/renderer/src/styles.test.ts`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write the failing test**

Add snippets to `keeps favorite ledger status near the toolbar and ledger copy compact`:

```ts
expectStyleSnippet('.favorite-ledger-panel__topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 8px;')
expectStyleSnippet('.favorite-ledger-panel__toolbar { margin-left: auto;')
expectStyleSnippet('.favorite-ledger-panel__toolbar button { min-width: 88px; min-height: 36px; border-radius: 5px; font-weight: 700;')
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- styles.test.ts
```

Expected: FAIL because `.favorite-ledger-panel__topbar` currently uses `display: grid`, and the toolbar button sizing rule does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Change `.favorite-ledger-panel__topbar` to:

```css
.favorite-ledger-panel__topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 8px;
  border: 1px solid rgba(31, 99, 181, 0.28);
  background: rgba(247, 251, 255, 0.64);
  padding: 8px;
}
```

Add:

```css
.favorite-ledger-panel__toolbar {
  margin-left: auto;
}

.favorite-ledger-panel__toolbar button {
  min-width: 88px;
  min-height: 36px;
  border-radius: 5px;
  font-weight: 700;
}
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm test -- styles.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run broader renderer verification**

Run:

```bash
npm test -- FavoriteLedgerPanel.test.tsx styles.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit once**

Run:

```bash
git add docs/superpowers/specs/2026-06-24-favorite-ledger-topbar-actions-design.md docs/superpowers/plans/2026-06-24-favorite-ledger-topbar-actions.md src/renderer/src/styles.css src/renderer/src/styles.test.ts
git commit -m "Adjust favorite ledger topbar actions"
```

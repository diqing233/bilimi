# Archive History Option Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unhighlighted archive-history dropdown options readable while preserving the arrow-only collapsed control.

**Architecture:** Keep the existing native `select` and custom arrow wrapper. Scope an explicit foreground and background to its `option` elements so the popup does not inherit the collapsed control's transparent text color.

**Tech Stack:** CSS, Vitest

---

### Task 1: Add the regression test and minimal style fix

**Files:**
- Modify: `src/renderer/src/styles.test.ts`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write the failing test**

Add this assertion beside the existing archive-history select assertions:

```ts
expectStyleSnippet(
  '.favorite-ledger-panel__archive-history-select-control option { color: var(--porcelain-deep); background: #ffffff;'
)
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: FAIL because the scoped `option` rule is absent.

- [ ] **Step 3: Add the minimal style**

Add immediately after the archive-history `select` rule:

```css
.favorite-ledger-panel__archive-history-select-control option {
  color: var(--porcelain-deep);
  background: #ffffff;
}
```

- [ ] **Step 4: Run focused and full verification**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit the completed requirement**

Stage the design, plan, test, and CSS files, then create one commit with message `修复改动记录下拉文字不可见`.

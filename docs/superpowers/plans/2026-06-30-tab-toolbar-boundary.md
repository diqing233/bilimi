# Tab Toolbar Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed right-side browser toolbar area with refresh and existing expand or collapse controls while keeping overflowing tabs confined to the left tab strip.

**Architecture:** The top browser toolbar remains in `App.tsx`, but its DOM is split into a scrollable tab-list zone and a fixed control zone. The refresh action reuses the active webview lookup and calls `reload` on the current `Electron.WebviewTag` when available. CSS grid reserves fixed width for the controls so tabs cannot overlap them.

**Tech Stack:** React 19, Electron webview, Vitest, Testing Library, CSS.

---

### Task 1: Add Refresh Behavior Test

**Files:**
- Modify: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test in `describe('App runtime integration', ...)` that renders the app, attaches a `reload` spy to the active `webview`, clicks the `刷新当前网页` button, and expects the spy to be called once.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: FAIL because the refresh button does not exist yet.

- [ ] **Step 3: Implement minimal behavior**

In `src/renderer/src/App.tsx`, add `refreshActiveTab` that calls `getCurrentActiveWebview()?.reload?.()`, then render a `button` with `aria-label="刷新当前网页"` inside the browser toolbar control area.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: PASS.

### Task 2: Add Toolbar Boundary Style Guard

**Files:**
- Modify: `src/renderer/src/styles.test.ts`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write the failing style test**

Add an assertion that `.browser-tabs` uses two grid columns, `.browser-tabs__list` scrolls horizontally with `min-width: 0`, and `.browser-tabs__controls` has a left border and fixed control sizing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: FAIL because the new CSS selectors do not exist yet.

- [ ] **Step 3: Implement the structure and CSS**

Wrap the mapped tab items in `<div className="browser-tabs__list" role="tablist" aria-label="网页标签">`. Add `<div className="browser-tabs__controls" aria-label="网页工具">` after it. Move toolbar-level `role="tablist"` from `.browser-tabs` to `.browser-tabs__list`. Style `.browser-tabs` as `grid-template-columns: minmax(0, 1fr) auto`, put overflow on `.browser-tabs__list`, and add the right boundary on `.browser-tabs__controls`.

- [ ] **Step 4: Run style test to verify it passes**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: PASS.

### Task 3: Verify and Commit

**Files:**
- Modified files from Tasks 1 and 2

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/renderer/src/App.test.tsx src/renderer/src/styles.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Commit only this feature**

Run: `git status --short`, stage the changed spec, plan, app, style, and test files, then commit with message `feat: add fixed browser tab toolbar controls`.

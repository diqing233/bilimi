# Multi-Display Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep bilimi usable when Windows exposes a very small logical work area or the main window moves between displays with different resolutions and DPI scaling, while preserving the always-side-by-side assistant sidebar with a 272px minimum.

**Architecture:** Extend the existing main-window sizing helper so its minimum dimensions can relax below the normal `960x600` floor only when the current display work area is smaller. Add a focused display-layout controller that recalculates minimum size and constrains the current window bounds when the window crosses displays or display metrics change. Keep renderer/sidebar behavior unchanged because its existing compact breakpoint and 272px floor already match the approved product decision.

**Tech Stack:** Electron BrowserWindow and screen APIs, TypeScript, Vitest.

---

### Task 1: Fit Minimum Size Inside Extreme Logical Work Areas

**Files:**
- Modify: `electron/main/mainWindowOptions.test.ts`
- Modify: `electron/main/mainWindowOptions.ts`

- [ ] **Step 1: Write the failing test**

Add a case for a `900x560` work area and assert that initial and minimum dimensions stay within 92% of that work area instead of retaining the `960x600` absolute floor.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run electron/main/mainWindowOptions.test.ts`

Expected: FAIL because the current helper returns a minimum larger than the work area cap.

- [ ] **Step 3: Write minimal implementation**

Change `resolveMinimumDimension` so the absolute floor applies only when the work-area cap can contain it; otherwise use the positive work-area cap as the lower and upper bound.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run electron/main/mainWindowOptions.test.ts`

Expected: PASS.

### Task 2: Reflow Main Window Across Displays

**Files:**
- Create: `electron/main/mainWindowDisplayLayout.ts`
- Create: `electron/main/mainWindowDisplayLayout.test.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write the failing tests**

Cover these behaviors through a small injected controller API:

1. Moving to a smaller display updates minimum dimensions and clamps the current window inside its work area.
2. Moving to a roomier display updates minimum dimensions without enlarging a valid user-sized window.
3. Maximized windows only receive the new minimum and are not forcibly assigned bounds.
4. Repeated move events on the same display do not reapply layout unnecessarily.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run electron/main/mainWindowDisplayLayout.test.ts`

Expected: FAIL because the controller module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create a controller that receives the BrowserWindow-like target and display lookup functions, resolves sizing using `resolveMainWindowSizing`, sets the display-appropriate minimum, and clamps non-maximized bounds to the matched display work area. Return a cleanup callback for installed window/screen listeners.

- [ ] **Step 4: Integrate with main-window creation**

Install the controller after `BrowserWindow` construction in `createMainWindow`, listen for window moves and Electron display metric/add/remove changes, and dispose listeners when the window closes.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run electron/main/mainWindowDisplayLayout.test.ts electron/main/mainWindowOptions.test.ts electron/main/mainWindowLayout.test.ts`

Expected: PASS.

### Task 3: Verify Responsive Guardrails and Repository Health

**Files:**
- Verify: `src/shared/assistantSidebarWidth.ts`
- Verify: `src/renderer/src/styles.css`
- Verify: `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`

- [ ] **Step 1: Run focused responsive tests**

Run: `npm test -- --run electron/main/mainWindowOptions.test.ts electron/main/mainWindowDisplayLayout.test.ts electron/main/mainWindowLayout.test.ts electron/main/floatingSealGeometry.test.ts src/renderer/src/features/assistant/AssistantSidebar.test.tsx`

Expected: PASS, including the existing 272px compact sidebar assertions.

- [ ] **Step 2: Run the full automated suite**

Run: `npm test`

Expected: PASS. If an unrelated pre-existing dirty test assertion remains, reconcile it with the existing stylesheet without changing the approved responsive behavior.

- [ ] **Step 3: Build production assets**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Review the final diff and commit once**

Run: `git diff --check`, review `git diff`, then stage the completed requirement changes and create one repository commit as required by `AGENTS.md`.

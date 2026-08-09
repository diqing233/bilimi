# Sidebar Tooltip and Settings Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sidebar help and global feedback overlays follow the live layout, present global-feedback continuation as a seamless second line, and apply the confirmed settings copy and connection-option layout.

**Architecture:** Keep the existing global-feedback menu and existing portal overlays. Extract no new stateful component: use small measurement callbacks with `ResizeObserver`, animation-frame remeasurement and transition completion to keep portal coordinates current. The connection mode remains the same radio input and persistence flow; only its semantic markup, styling and copy change.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Electron.

---

### Task 1: Refresh help-overlay geometry when it becomes visible

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/sidebarTooltipPosition.test.ts`

- [ ] **Step 1: Write failing geometry coverage**

Add a case showing that a sidebar help card uses the latest panel-left coordinate after the panel has moved from an initial left-edge layout to its final right-sidebar layout:

```ts
it('uses the latest panel coordinate after the sidebar finishes laying out', () => {
  expect(resolveSidebarTooltipPosition(
    { top: 100, bottom: 128, left: 1_472, right: 1_540 },
    { width: 360, height: 180 },
    { width: 1_600, height: 900 },
    { left: 1_456 }
  )).toEqual({ top: 100, left: 1_088 })
})
```

- [ ] **Step 2: Run the focused test and observe the missing live-measurement behavior**

Run: `npm test -- src/renderer/src/features/assistant/sidebarTooltipPosition.test.ts`

Expected: the geometry helper passes but the component still measures only on initial mount; add component-level assertions that fail until hover visibility triggers a fresh measurement.

- [ ] **Step 3: Implement the minimal live-measurement flow**

In each help component, make the layout effect depend on the visible state, schedule an immediate and next-frame measurement after hover/focus, and while visible observe the panel and trigger with `ResizeObserver` plus `transitionend`, `resize` and captured `scroll`. Use the latest `getBoundingClientRect()` values before assigning portal coordinates.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/renderer/src/features/assistant/sidebarTooltipPosition.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`

Expected: all tests pass.

### Task 2: Make truncated global feedback a seamless temporary second line

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/assistant/feedbackContinuation.test.ts`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] **Step 1: Write failing source/behavior coverage**

Require the continuation to have no dashed separator, no independent card shadow, and to recalculate after the feedback line resizes while it is visible. Verify it disappears when the full menu is expanded.

- [ ] **Step 2: Run focused feedback tests and observe the missing resize protection**

Run: `npm test -- src/renderer/src/features/assistant/feedbackContinuation.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/styles.test.ts`

Expected: the new assertion fails because the current continuation has a dashed border and has no resize observer.

- [ ] **Step 3: Implement the minimal continuation refinement**

Keep the existing first-line button and full menu. Recalculate only while the pointer/focus continuation is eligible, use `ResizeObserver` on the feedback line and its status panel, and render the suffix as a borderless, shadowless, same-background second line directly below the first line. Clicking the first line still opens the original menu and hides the suffix.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/renderer/src/features/assistant/feedbackContinuation.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/styles.test.ts`

Expected: all tests pass.

### Task 3: Restore readable Bilibili connection choices and confirmed copy

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] **Step 1: Write failing copy and layout coverage**

Assert that each connection choice has one radio input followed by a title and description in the same text column, and that the four confirmed default-favorite paragraphs contain the final wording without DeepSeek participation.

- [ ] **Step 2: Run focused tests and observe the old copy/layout assertions fail**

Run: `npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/styles.test.ts`

Expected: failures because the old default-favorite wording still names DeepSeek and the connection-choice markup does not expose a dedicated body column.

- [ ] **Step 3: Implement the minimal semantic and CSS changes**

Render every radio option as a two-column grid: a fixed radio column and one content column containing its title and description. Preserve `name`, checked state and `chooseMode` behavior. Apply these exact paragraphs in the favorite-system setting:

```text
默认收藏夹体系包含掌库的七个默认分类，不包括 bilimi·暂存。
开启后，七个默认收藏夹会固定参与批阅预分类、整理收藏分类、备册；适合大多数使用场景。主人仍可在此基础上自建收藏夹或采用推荐收藏夹，让收藏库更整洁。
关闭后，七个默认收藏夹将停用，不再参与分类，不会备册；主人可以 DIY 自己的收藏夹体系。bilimi·暂存仍会保留，作为安全区使用。建议参考默认分类创建几个自己的收藏夹，也可以和小咪交流想法～
已备册到b站但不再需要的默认收藏夹，可在掌库收藏夹区域统一删除。
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/styles.test.ts`

Expected: all tests pass.

### Task 4: End-to-end verification and local checkpoint

**Files:**
- Verify only the files above plus test files.

- [ ] **Step 1: Run the complete relevant regression suite**

Run: `npm test -- src/renderer/src/features/assistant/globalStatusTooltipPosition.test.ts src/renderer/src/features/assistant/feedbackContinuation.test.ts src/renderer/src/features/assistant/sidebarTooltipPosition.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/styles.test.ts`

- [ ] **Step 2: Build and inspect the worktree**

Run: `npm run build; git diff --check; git diff --stat; git status --short`

Expected: build succeeds, the diff has no whitespace errors, and only plan, source, styles and matching tests are modified.

- [ ] **Step 3: Verify live Electron interaction**

In the development app, hover both sidebar help titles after the layout settles and during sidebar resizing; verify both cards align left of their corresponding right-sidebar panel. Hover a truncated global message and verify only the hidden suffix appears as a seamless second line; click it and verify the original full menu opens and the suffix vanishes. Verify both connection options remain selectable across their full row without changing their persistence behavior.

- [ ] **Step 4: Commit the validated scope**

Run: `git add docs/superpowers/plans/2026-08-09-sidebar-tooltip-and-settings-copy-plan.md src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/OldFavoriteGuide.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/sidebarTooltipPosition.test.ts src/renderer/src/features/assistant/feedbackContinuation.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/styles.css src/renderer/src/styles.test.ts && git commit -m "fix: stabilize sidebar guidance and settings copy"`


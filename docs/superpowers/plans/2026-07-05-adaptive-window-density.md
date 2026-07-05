# Adaptive Window Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt bilimi's main window, assistant sidebar, and compact chrome density to high Windows display scaling.

**Architecture:** Add pure sizing helpers that take Electron logical work-area/window dimensions as inputs, then wire those helpers into BrowserWindow creation and sidebar clamping. Use CSS media queries for compact density instead of global transforms.

**Tech Stack:** Electron, React, TypeScript, Vitest, CSS.

---

### Task 1: Main Window Sizing

**Files:**
- Modify: `electron/main/mainWindowOptions.ts`
- Modify: `electron/main/mainWindowOptions.test.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write failing tests**

Add tests for roomy work areas keeping `1600x960`, 2K-at-200%-like work areas producing a smaller non-fullscreen initial window, and minimum height not exceeding small logical work areas.

- [ ] **Step 2: Run main window tests**

Run: `npm test -- electron/main/mainWindowOptions.test.ts`
Expected before implementation: FAIL because `createMainWindowOptions` ignores work area.

- [ ] **Step 3: Implement helper**

Add `resolveMainWindowSizing(workAreaSize)` in `mainWindowOptions.ts`, use preferred `1600x960`, cap initial size to 92% work area, and clamp minimum size between compact floors and current work area.

- [ ] **Step 4: Wire Electron**

Pass `screen.getPrimaryDisplay().workAreaSize` from `createMainWindow()` into `createMainWindowOptions`.

### Task 2: Sidebar Width Adaptation

**Files:**
- Modify: `src/shared/assistantSidebarWidth.ts`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`
- Modify: `src/renderer/src/features/state/assistantState.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests showing narrow windows allow a 288px or 272px sidebar floor and saved oversized widths clamp down for the current window.

- [ ] **Step 2: Run sidebar tests**

Run: `npm test -- src/renderer/src/features/assistant/AssistantSidebar.test.tsx src/renderer/src/features/state/assistantState.test.ts`
Expected before implementation: FAIL because current minimum is fixed at 320px.

- [ ] **Step 3: Implement adaptive clamps**

Keep wide-window defaults unchanged, but derive minimum/default/max from window width so compact logical windows keep the webview usable.

### Task 3: Compact CSS Guardrails

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] **Step 1: Write failing CSS tests**

Add assertions for compact media queries and assert no global `transform: scale()` is introduced.

- [ ] **Step 2: Run style tests**

Run: `npm test -- src/renderer/src/styles.test.ts`
Expected before implementation: FAIL because compact density rules are absent.

- [ ] **Step 3: Implement CSS**

Add `@media (max-width: 1200px), (max-height: 760px)` rules to tighten browser tabs and assistant sidebar workspace spacing/font sizes.

### Task 4: Verification and Commit

**Files:**
- All modified implementation and test files.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- electron/main/mainWindowOptions.test.ts src/renderer/src/features/assistant/AssistantSidebar.test.tsx src/renderer/src/features/state/assistantState.test.ts src/renderer/src/styles.test.ts`

- [ ] **Step 2: Run full tests if focused tests pass**

Run: `npm test`

- [ ] **Step 3: Commit once**

Stage all implementation files and commit with `fix: adapt window density to display scaling`.

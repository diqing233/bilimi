# Floating Seal Menu Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the floating seal open the Bilimi project window and toggle the floating menu, closing the menu when it is already open.

**Architecture:** Keep the behavior split across the existing renderer and Electron main-process boundary. `FloatingSealApp` sends a menu-toggle request on click, while `electron/main/index.ts` ensures the main project window is available and then toggles the floating menu controller.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library.

---

## File Structure

- `src/renderer/src/features/assistant/FloatingSealApp.test.tsx`
  - Renderer behavior tests for clicking the floating seal.
- `src/renderer/src/features/assistant/FloatingSealApp.tsx`
  - Floating seal click and drag interaction.
- `electron/main/index.ts`
  - IPC handler and main-window/menu-window orchestration.
- `electron/main/floatingMenuController.test.ts`
  - Existing controller tests for open/close toggle semantics.

## Task 1: Route Seal Clicks To The Floating Menu

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingSealApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingSealApp.tsx`

- [ ] **Step 1: Write the failing renderer test**

Add or update a test that renders `FloatingSealApp`, clicks the button named `打开 Bilimi 助手`, and expects `window.bilimiDesktop.toggleFloatingMenu` to be called once while `toggleFloatingAssistant` is not called.

- [ ] **Step 2: Run the renderer test to verify it fails**

Run:

```powershell
npm run test -- src/renderer/src/features/assistant/FloatingSealApp.test.tsx
```

Expected: the click test fails because the component currently calls `toggleFloatingAssistant`.

- [ ] **Step 3: Implement the minimal renderer change**

Change `FloatingSealApp` so a click calls `window.bilimiDesktop?.toggleFloatingMenu?.()` directly.

- [ ] **Step 4: Run the renderer test to verify it passes**

Run:

```powershell
npm run test -- src/renderer/src/features/assistant/FloatingSealApp.test.tsx
```

Expected: all tests in the file pass.

## Task 2: Ensure Project Window Before Toggling Menu

**Files:**
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Confirm controller toggle semantics**

Use the existing `electron/main/floatingMenuController.test.ts` as coverage that a second toggle closes an open floating menu window.

- [ ] **Step 2: Implement the main-process orchestration**

Change the `floating-menu:toggle` IPC handler to call a function that:

1. Creates the main window if it is missing or destroyed.
2. Restores it if minimized.
3. Shows it if hidden.
4. Focuses it.
5. Toggles `floatingMenuController`.

- [ ] **Step 3: Run targeted Electron main-process tests**

Run:

```powershell
npm run test -- electron/main/floatingMenuController.test.ts src/renderer/src/features/assistant/FloatingSealApp.test.tsx
```

Expected: all targeted tests pass.

## Task 3: Verify Build

**Files:**
- No code changes.

- [ ] **Step 1: Run the build**

Run:

```powershell
npm run build
```

Expected: `electron-vite build` completes with exit code 0.


# Assistant Sidebar Width Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist assistant sidebar width without synchronously rewriting the multi-megabyte shared preference file.

**Architecture:** Introduce a focused main-process layout store and IPC API. Keep direct CSS width updates during dragging, but route mount, save, synchronization, and reset through the lightweight store instead of assistant preferences.

**Tech Stack:** Electron, React, TypeScript, electron-store, Vitest, Testing Library

---

### Task 1: Lightweight Layout Store

**Files:**
- Create: `electron/main/assistantSidebarLayoutStore.ts`
- Test: `electron/main/assistantSidebarLayoutStore.test.ts`

- [ ] Write failing tests for normalized load/save, `null` reset, and legacy fallback seeding.
- [ ] Run `node_modules\.bin\vitest.cmd run electron/main/assistantSidebarLayoutStore.test.ts` and confirm failure because the store module does not exist.
- [ ] Implement a small injected store wrapper using `normalizeAssistantSidebarWidthPx`.
- [ ] Run the focused test and confirm it passes.

### Task 2: Focused Electron IPC

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Test: `electron/main/assistantSidebarLayoutStore.test.ts`

- [ ] Add failing assertions for focused load/save behavior and width-change notification without assistant preference broadcasting.
- [ ] Add `loadAssistantSidebarWidth`, `saveAssistantSidebarWidth`, and `onAssistantSidebarWidthChanged` preload APIs.
- [ ] Register trusted main-window IPC handlers backed by the lightweight store and legacy fallback.
- [ ] Run focused main/preload tests.

### Task 3: Sidebar Integration

**Files:**
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] Write failing renderer tests proving load/save/reset use the focused layout API and do not call `patchPreferences` for width.
- [ ] Replace width preference load/listeners/save with the focused API while preserving live CSS updates and resize completion behavior.
- [ ] Route default-layout sidebar reset through the focused save API.
- [ ] Run sidebar and default-layout tests.

### Task 4: Verification

**Files:**
- No production files expected.

- [ ] Run focused tests for the layout store, sidebar, default-layout controller, shared store, and webview resize behavior.
- [ ] Run `git diff --check` and a TypeScript check, separating existing failures from new errors.
- [ ] Restart the normal Electron development build.
- [ ] Measure real pointer release, immediate sidebar tab click, and focused width-save latency.
- [ ] Confirm existing shared assistant, DeepSeek, LocalData, transcription, modal, pet, and favorite behavior remains untouched by the width path.

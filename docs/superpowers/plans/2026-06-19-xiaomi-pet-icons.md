# 小咪 Pet Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 小咪 pet identity and pet icons to Bilimi's app shell and main controls.

**Architecture:** Reuse the existing pet asset manifest in renderer components, adding small decorative images to key controls while keeping the action APIs unchanged. Configure the Electron main window icon through a shared main-process helper so tests can assert a stable path.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Testing Library.

**Status:** Implemented and verified on 2026-06-19. Primary implementation commit: `4ea1fd2`. Follow-up layout commits: `c739b80`, `3c95503`, `85dad2d`, and `85fa169`.

---

### Task 1: Lock Pet Persona And Control Icons With Tests

**Files:**
- Modify: `src/renderer/src/features/assistant/petState.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingSealApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `electron/main/mainWindowOptions.test.ts`

- [x] Add tests that expect 小咪 state labels/bubbles, decorative pet images on the floating seal, sidebar collapse button, top workspace tabs, and review actions.
- [x] Add a main-window option test that expects `options.icon` to end with `src/renderer/src/assets/pet/blue-white-maid/character/big-head/idle.png`.
- [x] Run the focused tests and confirm they fail for missing behavior.

### Task 2: Implement Shared Pet Icons And Persona

**Files:**
- Modify: `src/renderer/src/features/assistant/petState.ts`
- Modify: `src/renderer/src/features/assistant/FloatingSealApp.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] Update state labels and bubbles to 小咪 persona copy.
- [x] Import existing pet assets where needed and render decorative images with stable class names.
- [x] Update CSS layout for compact pet avatars without changing existing button actions.
- [x] Run focused renderer tests and confirm they pass.

### Task 3: Configure App Icon

**Files:**
- Modify: `electron/main/mainWindowOptions.ts`
- Modify: `electron/main/mainWindowOptions.test.ts`

- [x] Add a small helper that resolves the big-head idle PNG as the main window icon.
- [x] Keep the helper deterministic in tests.
- [x] Run the focused main-process test and confirm it passes.

### Task 4: Verify And Commit

**Files:**
- Review all modified files.

- [x] Run `npm test -- --runInBand` or `npm test` if Vitest does not support that flag.
- [x] Run `npm run build`.
- [x] Inspect `git diff --stat` and `git status --short`.
- [x] Commit all files related to this requested change in one git commit.

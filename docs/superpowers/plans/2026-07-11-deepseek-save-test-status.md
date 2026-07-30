# DeepSeek Save And Test Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge DeepSeek save and test actions while making the status light reflect real connection evidence.

**Architecture:** Keep persisted configuration in existing preferences and credential storage. Add a renderer-session connection state that is updated by connection tests and successful DeepSeek requests, and invalidated by connection-critical edits.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Testing Library

---

### Task 1: Specify status behavior

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [x] Add a failing test that saved configuration starts as `DeepSeek 待测试`.
- [x] Add a failing test that one `保存并测试` click saves and performs the real test.
- [x] Add a failing test that failed tests retain saved settings and show an error state.
- [x] Add a failing test that canceling reset does not clear settings.
- [x] Run `npm test -- --run src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx` and confirm the old behavior fails.

### Task 2: Implement merged action and session status

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [x] Add pending, connected, and failed session connection states.
- [x] Derive status-light labels and tones from enabled, key, task, and connection state.
- [x] Replace separate save/test buttons with `保存并测试` and a running disabled state.
- [x] Preserve saved configuration when testing fails and expose the localized error.
- [x] Confirm reset before clearing credentials and only update the UI after successful reset.
- [x] Mark successful DeepSeek feature requests as connected.

### Task 3: Verify and commit

**Files:**
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Verify: repository TypeScript and build configuration

- [ ] Run the focused component test with no failures or warnings.
- [ ] Run the full test suite.
- [ ] Run the production build.
- [ ] Review `git diff --check` and the final diff.
- [ ] Commit all requirement changes together.

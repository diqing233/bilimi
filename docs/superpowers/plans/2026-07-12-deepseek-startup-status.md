# DeepSeek Startup Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically validate saved DeepSeek configuration once per app run and improve the compact global status presentation.

**Architecture:** Keep connection validation in `FloatingAssistantApp`, reusing the existing preload connection-test API and connection status state. Trigger one silent test only after loaded preferences confirm DeepSeek is enabled with a stored key. Keep the status row compact through CSS ellipsis and native `title` tooltips.

**Tech Stack:** React 19, TypeScript, Electron preload IPC, Vitest, Testing Library, CSS.

---

### Task 1: Startup DeepSeek validation

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] Add a test proving an enabled, stored DeepSeek configuration is tested once after startup and changes from pending to connected.
- [ ] Run the focused test and confirm it fails because startup does not call `testDeepSeekConnection`.
- [ ] Add a one-run guarded effect that silently calls the existing test API after preferences load, shows a running validation state, and records connected or failed.
- [ ] Add coverage proving unconfigured/disabled DeepSeek does not trigger startup validation.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Compact global feedback and complete hover text

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Test: `src/renderer/src/styles.test.ts`

- [ ] Add tests requiring the global feedback element to expose its complete message through `title` and use a 12px font rule.
- [ ] Run the focused tests and confirm they fail for the missing title and old 14px size.
- [ ] Bind the complete displayed message to `title` and change only the global feedback font size to 12px while preserving one-line ellipsis.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Current model in the DeepSeek hover detail

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] Add a test requiring the connected DeepSeek status light title to contain `当前模型：<configured model>` without changing its visible label.
- [ ] Run the focused test and confirm it fails because the model is absent from the tooltip.
- [ ] Add the configured request model to the DeepSeek detail formatter used by the status light.
- [ ] Run the focused test and confirm it passes.

### Task 4: Verification and single delivery commit

**Files:**
- Verify all modified source, test, and plan files.

- [ ] Run the focused assistant and style tests.
- [ ] Run the full test suite and production build.
- [ ] Review the diff and confirm no packaging/release command is involved, so the release checklist is not required.
- [ ] Commit the complete remediation once, as required by `AGENTS.md`.

# DeepSeek Re-enable Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically retest a saved DeepSeek connection whenever the user turns the DeepSeek switch off and back on.

**Architecture:** Reuse the existing guarded connection-validation effect. Reset its per-enable-cycle guard when DeepSeek is disabled, allowing the next enabled state with a stored key to run the same tested request path exactly once.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Re-enable connection validation

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [x] Add a component test that resolves the startup connection test, disables DeepSeek, re-enables it, and expects one additional request with validating and connected status updates.
- [x] Run the focused test and confirm it fails because the one-run guard remains set after disabling DeepSeek.
- [x] Reset the existing validation-attempt guard when the DeepSeek switch is turned off.
- [x] Add or retain coverage proving an enabled state without a stored key does not send a connection request.
- [x] Run the focused component tests and confirm they pass.

### Task 2: Verification and delivery

**Files:**
- Verify all modified design, plan, source, and test files.

- [x] Run the focused `FloatingAssistantApp` test file.
- [x] Run the full test suite.
- [x] Run the production build.
- [x] Review the diff and confirm no packaging or release command is involved.
- [ ] Create one overall git commit for the completed remediation, as required by `AGENTS.md`.

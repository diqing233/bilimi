# DeepSeek Enable Save Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent enabling DeepSeek from creating a repeated preference save and IPC broadcast loop.

**Architecture:** Keep the existing debounced preference saver and multi-window preference broadcasts. Treat a broadcast matching the active local save as an acknowledgement: update the committed snapshot, preserve any newer local fields, and do not enqueue another save unless the merge actually contains unsaved local changes.

**Tech Stack:** Electron IPC, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Reproduce the repeated save

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] Add a test that captures `onAssistantPreferencesChanged`, enables DeepSeek, makes `savePreferences` emit the same saved preferences through that callback, and asserts the save count remains one after the debounce window.
- [ ] Run `npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx -t "does not resave"` and confirm it fails because `savePreferences` is called more than once.

### Task 2: Stop acknowledgement broadcasts from rescheduling saves

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] In the preference broadcast handler, distinguish an acknowledgement of the in-flight save from a genuinely newer external update.
- [ ] Merge fields changed locally after the in-flight save began, but only update or schedule pending work when the merged preferences differ from the acknowledged broadcast.
- [ ] Run the focused regression test and confirm it passes.
- [ ] Run the existing concurrent preference synchronization tests to ensure newer local edits and external window changes remain preserved.

### Task 3: Verify and commit the complete fix

**Files:**
- Verify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Verify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] Run `npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Review `git diff --check` and the final diff for unrelated changes.
- [ ] Create one overall Git commit for the completed requirement, as required by `AGENTS.md`.

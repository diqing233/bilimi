# Concurrent DeepSeek Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one stable `DeepSeek 工作中` indicator while listing every concurrently running DeepSeek request in its hover detail.

**Architecture:** Replace the cross-window single task value with start/finish events carrying a unique task ID, kind, and optional detail. Each renderer keeps a task map and removes only the matching completed task. Derive background summary tasks from the transcription queue only while its progress is `summarizing-deepseek`; local downloading and transcription never enter the DeepSeek list.

**Tech Stack:** React 19, TypeScript, BroadcastChannel, Electron queue snapshots, Vitest, Testing Library.

---

### Task 1: Concurrent cross-window task registry

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/assistant/deepSeekTaskSignal.ts`
- Modify: `src/renderer/src/features/assistant/deepSeekTaskSignal.test.ts`

- [ ] Add failing tests proving two task IDs can start, one can finish without clearing the other, and malformed events are ignored.
- [ ] Replace nullable task broadcasts with `{ action: 'start', task }` and `{ action: 'finish', id }` events.
- [ ] Return a completion function from the task-start helper so callers remove only their own request.
- [ ] Run the signal tests and confirm they pass.

### Task 2: Aggregate DeepSeek indicator and hover detail

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] Add failing component tests for simultaneous classification and archive organization tasks.
- [ ] Add a failing test proving a local transcription step does not appear in the DeepSeek hover detail.
- [ ] Add a failing test proving a `summarizing-deepseek` queue item appears with its video title alongside other tasks.
- [ ] Store active tasks by ID and derive one `DeepSeek 工作中` status whose detail lists every active task.
- [ ] Keep connection status fallback unchanged when the task map becomes empty.
- [ ] Run the focused component tests and confirm they pass.

### Task 3: Migrate all DeepSeek callers

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
- Test: relevant existing App, floating assistant, and pet tests

- [ ] Give each request a stable unique task ID and descriptive detail.
- [ ] Finish the exact task in `finally`, including comment, classification, summary, archive organization, pet chat, rejudge, and connection test flows.
- [ ] Run the affected test files.

### Task 4: Verify and commit

**Files:**
- Verify all modified files.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and review the final diff.
- [ ] Create one overall Git commit for the completed requirement, as required by `AGENTS.md`.

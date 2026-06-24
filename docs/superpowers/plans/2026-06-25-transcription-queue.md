# Transcription Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a serial video audio transcription queue that saves completed jobs into the existing video note archive.

**Architecture:** The Electron main process owns queue state, persistence, and execution. Renderer components enqueue the current video and render queue controls through preload APIs.

**Tech Stack:** Electron IPC, React, TypeScript, Vitest, existing `transcribeCurrentVideoAudio`, `createLocalVideoNoteDraft`, and archive store helpers.

---

### Task 1: Shared Queue Types And Persistence

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `electron/main/store.ts`
- Test: `electron/main/store.test.ts`

- [x] Add `VideoAudioTranscriptionQueueItem`, status, and snapshot types.
- [x] Persist queue items in `electron-store`.
- [x] Normalize `running` items to retryable failures when loading persisted queue state after app restart.

### Task 2: Main Process Queue Manager

**Files:**
- Create: `electron/main/videoTranscriptionQueue.ts`
- Test: `electron/main/videoTranscriptionQueue.test.ts`

- [x] Add a queue manager that enqueues unique pending work, runs one job at a time, saves successful jobs to the archive, and advances after failures.
- [x] Support canceling pending jobs and retrying failed/canceled jobs.
- [x] Emit snapshots whenever queue state changes.

### Task 3: IPC And Preload Bridge

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [x] Register queue IPC handlers for load, enqueue, cancel, retry, and change events.
- [x] Expose typed renderer APIs through preload.

### Task 4: Notes UI Integration

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [x] Add an "add to queue" action beside direct transcription.
- [x] Render queue rows with status, progress, retry, and cancel actions.
- [x] Refresh archive state when queue jobs complete.

### Task 5: Verification

**Files:**
- Modify docs as needed.

- [x] Run focused tests for queue, store, and notes UI.
- [x] Run full `npm test -- --run`.
- [x] Run `npm run build`.
- [x] Commit the complete change once.

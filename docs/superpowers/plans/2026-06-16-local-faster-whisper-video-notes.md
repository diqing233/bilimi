# Local faster-whisper Video Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make video notes default to local `faster-whisper` audio transcription, remove OpenAI Key requirements, and keep manual transcript fallback.

**Architecture:** Keep the existing Electron IPC and `VideoNote` data model. Replace the OpenAI transcription dependency in the main process with a local Python `faster-whisper` adapter, then route default note generation through audio transcription while manual pasted transcripts continue to use the renderer parser.

**Tech Stack:** Electron main process, React renderer, Vitest, `yt-dlp`, `ffmpeg`, Python, `faster-whisper`.

---

### Task 1: Add faster-whisper Transcription Adapter

**Files:**
- Create: `electron/main/fasterWhisperTranscription.ts`
- Create: `electron/main/fasterWhisperTranscription.test.ts`
- Create: `tools/transcribe_faster_whisper.py`

- [ ] **Step 1: Write failing tests**

Add tests that assert JSON segment mapping, Python command selection, and readable dependency errors.

- [ ] **Step 2: Run failing tests**

Run: `npm test -- electron/main/fasterWhisperTranscription.test.ts`

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement adapter**

Create a Node adapter that executes `tools/transcribe_faster_whisper.py`, parses JSON, maps segments to `TranscriptSegment[]`, and converts common Python/import failures into readable messages.

- [ ] **Step 4: Add Python script**

Create a small CLI script using `faster_whisper.WhisperModel`, default model `small`, JSON output, and nonzero exit codes for missing dependency or transcription failure.

- [ ] **Step 5: Run adapter tests**

Run: `npm test -- electron/main/fasterWhisperTranscription.test.ts`

Expected: pass.

### Task 2: Replace OpenAI Transcription in Main Service

**Files:**
- Modify: `electron/main/videoTranscriptionService.ts`
- Modify: `electron/main/videoTranscriptionService.test.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write failing service tests**

Update tests so `transcribeCurrentVideoAudio` no longer accepts `apiKey` and calls the local transcription dependency with segment paths and offsets.

- [ ] **Step 2: Run failing service tests**

Run: `npm test -- electron/main/videoTranscriptionService.test.ts`

Expected: fail because production still requires `apiKey` and OpenAI transcription.

- [ ] **Step 3: Implement service change**

Remove `apiKey` from service deps, import the new faster-whisper adapter, and update `index.ts` so `video-audio:transcribe-current` no longer loads OpenAI Key.

- [ ] **Step 4: Run service tests**

Run: `npm test -- electron/main/videoTranscriptionService.test.ts`

Expected: pass.

### Task 3: Route Default Note Generation Through Audio

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write failing runtime tests**

Update the `generate-video-note` runtime test so default generation calls `transcribeCurrentVideoAudio` and produces `transcriptSource: 'audio'`. Add or keep a manual transcript assertion proving pasted text still avoids audio transcription.

- [ ] **Step 2: Run failing runtime tests**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: fail because default generation still reads page transcript.

- [ ] **Step 3: Implement runtime routing**

Change `generateRuntimeVideoNote` so no manual transcript delegates to `generateRuntimeVideoNoteFromAudio`, while manual transcript keeps `parseManualTranscript` and source metadata.

- [ ] **Step 4: Run runtime tests**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: pass.

### Task 4: Remove OpenAI Key UI and IPC Surface

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `electron/preload/index.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`

- [ ] **Step 1: Write failing UI/store tests**

Update note panel tests to assert no OpenAI Key UI appears and transcription controls are not gated by key status. Update store tests to remove OpenAI Key persistence expectations.

- [ ] **Step 2: Run failing UI/store tests**

Run: `npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx electron/main/store.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

Expected: fail because OpenAI Key UI and handlers still exist.

- [ ] **Step 3: Remove OpenAI Key code paths**

Remove key props from components, preload API methods, IPC handlers, store state, and tests. Keep `onTranscribeAudio` enabled when the handler exists.

- [ ] **Step 4: Run UI/store tests**

Run: `npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx electron/main/store.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

Expected: pass.

### Task 5: Full Verification and Commit

**Files:**
- All changed files.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: build exits successfully.

- [ ] **Step 3: Review diff**

Run: `git diff --stat` and `git diff --check`.

Expected: no whitespace errors and only planned files changed.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add electron src tools docs/superpowers/plans/2026-06-16-local-faster-whisper-video-notes.md
git commit -m "feat: use local faster-whisper for video notes"
```


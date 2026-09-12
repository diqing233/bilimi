# Transcription Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore segment-based estimated transcription percentages while making automatic DeepSeek jobs reach 100% only after their independent summary is saved.

**Architecture:** Keep the existing independent DeepSeek summary state machine unchanged. The renderer derives an overall progress display from existing `segmentIndex`, `segmentCount`, `summarizeWithDeepSeek`, and `summaryStatus`; a running transcription remains the top task while completed items whose summaries are pending or generating appear in the expanded queue.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Electron queue snapshots.

---

### Task 1: Specify Progress Rendering

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

- [x] **Step 1: Write failing renderer tests**

Add three focused test cases: a normal `transcribing-segment` task at segment `2/4` renders `49%`; a completed automatic-DeepSeek task with `summaryStatus: 'generating'` renders `文稿已生成，正在生成 DeepSeek 总结`, `96%`, and an overall progress bar; a running transcription plus that completed summary task renders the former at the top and the latter only after expanding the queue.

- [x] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx`

Expected: the new percentage and summary-progress assertions fail because segment transcription is currently indeterminate and completed summary jobs have no progress bar.

- [x] **Step 3: Restore segment interpolation and project summary progress**

In `VideoNotesPanel.tsx`, restore `clampPercent` and `interpolatePercent`; map `transcribing-segment` from `30` to `68` without automatic DeepSeek and from `30` to `78` with it. In the completed-item branch, render `96%` and an accessible progress bar for `summaryStatus: 'queued' | 'generating'`; render `100%` only for ordinary completed jobs and automatic-summary jobs with `summaryStatus: 'saved'`; preserve the existing retryable failure/cancellation status without any false `100%`.

- [x] **Step 4: Run the focused tests and verify success**

Run: `npm test -- src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx`

Expected: all tests in the file pass.

### Task 2: Regressions And Audit Record

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `docs/requirement-ledgers/2026-09-13-transcription-progress-design.md`

- [x] **Step 1: Add component regression coverage**

Add or update `VideoNotesPanel.test.tsx` coverage for segment interpolation and for a completed automatic-DeepSeek item that is not presented as 100% until its summary is saved.

- [x] **Step 2: Run the focused component tests**

Run: `npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx`

Expected: all selected tests pass.

- [x] **Step 3: Record per-requirement implementation evidence**

Update every `R001-R005` index row with exact code locations, test names/results, and remaining real-Electron UI verification limits. Do not claim a separate summary save stage or collapsed queue hint.

### Task 3: Release Verification

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-13-transcription-progress-design.md`

- [x] **Step 1: Run static and full regression verification**

Run: `git diff --check`, `npm test`, and `npm run build`.

Expected: every command exits `0`.

- [x] **Step 2: Validate scope and record result**

Run: `git status --short`, `git diff --stat`, and inspect `git diff -- src/renderer/src/features/notes/VideoNotesPanel.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx docs/requirement-ledgers/2026-09-13-transcription-progress-design.md docs/superpowers/plans/2026-09-13-transcription-progress-design.md`.

Expected: only the planned renderer, tests, plan, and ledger changes are present.

- [x] **Step 3: Commit the verified discussion round**

Run: `git add docs/requirement-ledgers/2026-09-13-transcription-progress-design.md docs/superpowers/plans/2026-09-13-transcription-progress-design.md src/renderer/src/features/notes/VideoNotesPanel.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx && git commit -m "fix: restore transcription progress estimates"`

Expected: one local commit containing only this round's ledger, plan, renderer, and test files.

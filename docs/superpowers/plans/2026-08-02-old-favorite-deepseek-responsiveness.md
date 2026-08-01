# Old Favorite DeepSeek Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the old-favorite DeepSeek workflow responsive, stop cleanly at unavailable batches, and preserve completed work on cancellation.

**Architecture:** Keep 20-video network chunks and one durable classification mutation per organization segment. Separate progress rendering from memoized archive groups, and make the main-process all-segment loop process ready work without polling unavailable segments.

**Tech Stack:** Electron, TypeScript, React, Vitest, Testing Library

---

### Task 1: Stop at unavailable batches and avoid redundant restores

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Test: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [ ] Add a failing service test where segment 1 is ready and segment 2 is tagging; assert the call returns without polling and reports one deferred segment.
- [ ] Add a failing service test asserting that an already selected first segment is not selected again and is not restored again when no switch occurred.
- [ ] Add a cancellation test that resolves the in-flight 20-video request after cancellation and asserts one aggregated classification mutation is applied before a canceled result returns.
- [ ] Run `node_modules\.bin\vitest.cmd run electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts --pool=forks` and confirm the new assertions fail for the intended behavior.
- [ ] Implement ready-only segment traversal, `deferredSegmentCount`, and conditional segment selection/restoration.
- [ ] Re-run the focused service test and confirm it passes.

### Task 2: Preserve actionable cancellation and failure feedback

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] Add a failing hook test for an Electron-wrapped workspace-change error and assert it is not mapped to the DeepSeek settings message.
- [ ] Add a failing hook test for a completed ready subset with deferred batches and assert the feedback explains that later batches still await tags.
- [ ] Run the focused hook and panel tests and confirm the new assertions fail for the intended message behavior.
- [ ] Extend the shared result shape with optional deferred-batch metadata and map known error categories to specific Chinese feedback.
- [ ] Re-run the focused hook and panel tests and confirm they pass.

### Task 3: Isolate progress from archive-list rendering

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [ ] Add a failing render test using the same snapshot and changed DeepSeek progress; assert archive classification grouping is not recomputed.
- [ ] Run `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx --pool=forks` and confirm it fails because progress currently recomputes the groups.
- [ ] Extract a memoized archive-groups region and stabilize only the callbacks it consumes.
- [ ] Re-run the focused preview test and confirm it passes.

### Task 4: Regression and live validation

**Files:**
- Verify only

- [ ] Run the DeepSeek service, coordinator, hook, archive preview, controlled panel and shared workspace test files.
- [ ] Run `git diff --check`.
- [ ] Run `node_modules\.bin\tsc.cmd --noEmit`; report the existing unrelated diagnostics separately from this change.
- [ ] In the running Electron development build, verify current-batch organization, all-ready-batch organization, cancellation, deferred-tag feedback and immediate mouse/window controls.
- [ ] Record any runtime measurements under `.codex-artifacts/` and create a focused local commit without pushing.

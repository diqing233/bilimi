# Note Reading And DeepSeek Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make transcript reading, timeline seeking, and DeepSeek summaries reliable for short and long archived videos.

**Architecture:** Centralize readable transcript formatting in the shared archive module so UI, persistence, copy, and export use the same text. Reuse an existing browser tab by normalized Bilibili video identity. Split long DeepSeek work into bounded extraction and synthesis stages, persist the completed proofreading checkpoint, and render notices without reducing the document viewport.

**Tech Stack:** TypeScript, React, Electron IPC, Vitest, CSS.

---

### Task 1: Readable transcript formatting

**Files:**
- Modify: `src/shared/videoNoteArchive.ts`
- Test: `src/shared/videoNoteArchive.test.ts`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`

- [x] Add failing tests proving fragments gain conservative terminal punctuation, related fragments form readable paragraphs, and existing punctuation is preserved.
- [x] Implement one shared formatter and use it for current notes, archives, copy, and persisted plain transcript text.
- [x] Replace ordered timeline lists with dedicated timestamp rows so no browser-generated sequence number appears.

### Task 2: Reuse archived video tabs

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [x] Add a failing test that opens two timestamps for the same Bilibili video and observes one internal tab.
- [x] Select the active matching video tab first, then another matching tab, and create a tab only when none exists.
- [x] Preserve CID selection-before-seek and playback state.

### Task 3: Complete long-form DeepSeek output

**Files:**
- Modify: `electron/main/deepseekService.ts`
- Test: `electron/main/deepseekService.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/shared/videoNoteArchive.ts`
- Test: `src/shared/videoNoteArchive.test.ts`

- [x] Add failing tests for a slow final summary, long transcript chunk extraction, missing detailed outline, adaptive key-point counts, and inline review uncertainty.
- [x] Give the final summary stage its own longer timeout while keeping proofreading bounded.
- [x] Extract long transcripts in bounded chunks and synthesize all extracted facts without fixed item-count limits.
- [x] Retry only summary work from a persisted proofreading checkpoint.
- [x] Merge review uncertainty into the relevant detailed content and emit only three sections.

### Task 4: Stable document viewport and compact feedback

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.css`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/notes/VideoNoteArchivePanel.layout.test.ts`
- Test: `src/renderer/src/styles.test.ts`

- [x] Add failing assertions for a minimum document viewport, internal scrolling, unnumbered timeline rows, and compact status placement.
- [x] Make the result panel consume remaining height and remove the legacy 160px archive cap.
- [x] Keep status/error feedback compact and outside the document sizing calculation.

### Task 5: Verification

- [x] Run focused tests for all changed modules.
- [x] Run the full test suite and production build.
- [x] Run `git diff --check` and compare TypeScript errors against the existing baseline.
- [x] Restart the normal development app without clearing user data and verify the real failing archive, repeated timestamp seeks, and 100/125/150% layouts.

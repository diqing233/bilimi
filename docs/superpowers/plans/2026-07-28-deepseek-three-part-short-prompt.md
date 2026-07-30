# DeepSeek Three-Part Short Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate only a complete precise summary, detailed outline, and naturally punctuated polished transcript without wasting tokens on keywords or unused fields.

**Architecture:** Keep the existing two-stage faithful proofreading and summary pipeline. Shorten the summary contract, retain legacy fields only in types/read paths, merge uncertainty into the detailed outline, and reflow corrected transcript fragments into readable paragraphs without deleting source text.

**Tech Stack:** TypeScript, Electron, Vitest, React.

---

### Task 1: Lock the compact summary contract

**Files:**
- Modify: `electron/main/deepseekService.test.ts`
- Modify: `electron/main/deepseekService.ts`

- [x] Add a failing test asserting the summary prompt requests no keywords, prompt field, or separate review section.
- [x] Run the focused test and confirm it fails against the current contract.
- [x] Replace the summary prompt with the approved compact three-part constraints.
- [x] Parse unlimited key points and detailed outline items while returning empty legacy keyword/prompt fields.

### Task 2: Produce readable faithful transcript paragraphs

**Files:**
- Modify: `electron/main/faithfulTranscriptPolishing.test.ts`
- Modify: `electron/main/faithfulTranscriptPolishing.ts`
- Modify: `electron/main/deepseekService.ts`

- [x] Add a failing test for joining short corrected fragments into natural sentences and bounded paragraphs.
- [x] Run the focused test and confirm the old one-fragment-per-paragraph behavior fails.
- [x] Add conservative transcript reflow that preserves every fragment in order.
- [x] Strengthen proofreading instructions to add natural punctuation without guessing facts or names.

### Task 3: Keep display/export to three sections

**Files:**
- Modify: `src/shared/videoNoteArchive.test.ts`
- Modify: `src/shared/videoNoteArchive.ts`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`

- [x] Add failing assertions that newly generated summaries do not display keywords or a fourth review section.
- [x] Remove keyword rendering from the new DeepSeek summary path while preserving legacy archive compatibility.
- [x] Verify uncertainty remains inside the detailed outline.

### Task 4: Verification

- [x] Run focused DeepSeek, polishing, archive, and notes-panel tests.
- [x] Run the relevant full test files.
- [x] Run `npm run build`.
- [x] Run `git diff --check` on touched files.
- [ ] Restart the normal development instance without clearing data and inspect a real generation result.

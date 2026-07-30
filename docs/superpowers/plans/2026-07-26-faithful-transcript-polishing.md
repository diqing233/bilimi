# DeepSeek Faithful Transcript Polishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent DeepSeek transcript polishing from silently deleting or compressing source material by applying validated local corrections to every source segment before a separate summary call.

**Architecture:** Add a focused proofreading module that creates stable segment batches, parses localized correction responses, validates every operation, and assembles the polished transcript locally. Refactor the DeepSeek transport into a reusable single-call helper, then orchestrate `note-poster` as proofreading batches followed by one summary call while preserving its public contract.

**Tech Stack:** TypeScript, Electron main process, DeepSeek OpenAI-compatible chat completions API, Vitest.

---

### Task 1: Define transcript batching and local patch behavior

**Files:**
- Create: `electron/main/faithfulTranscriptPolishing.ts`
- Create: `electron/main/faithfulTranscriptPolishing.test.ts`

- [ ] Write failing tests that require stable IDs, complete primary coverage, bounded batches, read-only preceding context, and preservation of filler words, repetitions, and foreign text.
- [ ] Run `npm test -- electron/main/faithfulTranscriptPolishing.test.ts` and confirm failures are caused by the missing module.
- [ ] Implement `createFaithfulTranscriptBatches(note)` and `createSourceTranscriptText(note)` with deterministic segment ordering and no head/tail sampling.
- [ ] Run the focused test and confirm the batching tests pass.

### Task 2: Validate and apply localized DeepSeek corrections

**Files:**
- Modify: `electron/main/faithfulTranscriptPolishing.ts`
- Modify: `electron/main/faithfulTranscriptPolishing.test.ts`

- [ ] Write failing tests for exact unique substring replacement and for rejection of unknown segments, context-segment edits, duplicate source matches, overlapping changes, empty replacements, unsupported types, invalid confidence, excessive deletion, and `finish_reason: length`.
- [ ] Run the focused test and verify the new tests fail for the intended missing validation.
- [ ] Implement strict response parsing, whole-batch validation, descending-offset patch application, correction logs, and review-item normalization.
- [ ] Run the focused test and confirm all patch and rejection cases pass.

### Task 3: Split DeepSeek proofreading from summarization

**Files:**
- Modify: `electron/main/deepseekService.ts`
- Modify: `electron/main/deepseekService.test.ts`

- [ ] Replace one-shot `note-poster` expectations with failing tests that return one proofreading response per batch and one final summary response.
- [ ] Add assertions that every source segment is present in a primary batch, the summary receives the complete locally polished transcript, filler/repeated/foreign text remains, and summary output cannot supply or replace the polished transcript.
- [ ] Add failing tests that a truncated proofreading or summary response is rejected.
- [ ] Extract a reusable single-request transport helper while leaving non-note request behavior unchanged.
- [ ] Add the dedicated faithful-proofreading and summary prompts agreed with the user.
- [ ] Orchestrate `note-poster` through all proofreading batches, assemble locally, call summary separately, and return the existing `NotePosterSummary` shape.
- [ ] Run `npm test -- electron/main/deepseekService.test.ts electron/main/faithfulTranscriptPolishing.test.ts` and confirm the focused suite passes.

### Task 4: Preserve archive and queue compatibility

**Files:**
- Modify only if required: `electron/main/videoTranscriptionQueue.test.ts`
- Modify only if required: `src/shared/videoNoteArchive.test.ts`

- [ ] Add or update tests proving a DeepSeek proofreading failure does not discard the successfully generated original transcript and that a successful result still produces the existing archive headings.
- [ ] Run `npm test -- electron/main/videoTranscriptionQueue.test.ts src/shared/videoNoteArchive.test.ts` and confirm the compatibility tests pass.

### Task 5: Full verification

**Files:**
- Verify all files changed by Tasks 1-4.

- [ ] Run the complete main/shared test command from `package.json` and record the pass count.
- [ ] Run the renderer test command because the public result contract remains consumed by the renderer.
- [ ] Run `npm run build` and confirm exit code 0.
- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Inspect `git diff -- electron/main/faithfulTranscriptPolishing.ts electron/main/deepseekService.ts electron/main/faithfulTranscriptPolishing.test.ts electron/main/deepseekService.test.ts` against every confirmed preservation rule.
- [ ] Do not package or publish; Windows release checklist is not required until a package or release is requested.

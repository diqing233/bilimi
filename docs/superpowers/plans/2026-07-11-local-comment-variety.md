# Local Comment Variety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand non-DeepSeek comments into varied, human-sounding candidates that address the actual UP author when available.

**Architecture:** Keep local comment composition in `commentComposer.ts`. Each content type owns a larger template pool, the composer resolves a safe author label, then samples three unique templates using an injectable random source so behavior is deterministic in tests.

**Tech Stack:** TypeScript, Vitest, Electron renderer utilities

---

### Task 1: Specify richer local comment behavior

**Files:**
- Modify: `src/renderer/src/features/comments/commentComposer.test.ts`

- [ ] Add tests requiring three unique results from a pool larger than three, real-author interpolation, `UP 主` fallback, varied sentence length, safe wording, and the 100-character limit.
- [ ] Run `npm test -- src/renderer/src/features/comments/commentComposer.test.ts` and confirm the new assertions fail because the current composer always returns the same three short comments and ignores the author.

### Task 2: Implement local pools and sampling

**Files:**
- Modify: `src/renderer/src/features/comments/commentComposer.ts`

- [ ] Add safe author-label normalization with `UP 主` fallback.
- [ ] Replace each three-item list with a larger mix of sincere and lively comment templates.
- [ ] Sample three templates without replacement and render the author label before enforcing the send limit.
- [ ] Run `npm test -- src/renderer/src/features/comments/commentComposer.test.ts` and confirm the focused suite passes.

### Task 3: Verify integration and commit once

**Files:**
- Test: `src/renderer/src/features/comments/commentComposer.test.ts`
- Test: `src/renderer/src/features/assistant/assistantOverlay.test.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] Run the focused composer and assistant suites.
- [ ] Run `npm run build` to verify TypeScript and production bundling.
- [ ] Inspect `git diff` and stage only the comment feature, its tests, and these design/plan documents.
- [ ] Create one requirement-level commit, as required by `AGENTS.md`.

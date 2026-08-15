# DeepSeek Action Layout Implementation Plan

> **For agentic workers:** Execute this plan with test-first verification. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the DeepSeek auxiliary-organization title and its one idle action on a single row, and rename the idle action to “开始整理”.

**Architecture:** The render branch in `OldFavoriteArchivePreviewStep` retains every existing handler and state predicate. A narrow CSS adjustment gives the heading action its content width instead of a forced wide flex basis, so the title and the single action share the heading row; the running cancellation branch remains unchanged.

**Tech Stack:** React, TypeScript, CSS, Vitest, Electron development build.

---

## Requirement coverage and exclusions

- Covers `R001`: one idle action only, inline with “DeepSeek 辅助整理”, and its text becomes “开始整理”.
- Excludes all DeepSeek request, cancellation, range, result, history, classification, persistence, and B站 behavior changes.

## Task 1: Lock the requested idle action layout with a component regression

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [x] Add a rendering test that locates the `DeepSeek 辅助整理` group, asserts its idle button is named `开始整理`, asserts the obsolete `DeepSeek 整理` name is absent, and asserts the heading action is contained by the heading element.
- [x] Run the focused test and observe RED because the idle button still has the old text. Evidence: 2026-08-16 focused Vitest run reported 2 expected old-text assertion failures and 29 passing tests.

## Task 2: Apply the smallest render and layout change

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] Rename only the idle DeepSeek run button to `开始整理`; preserve its handler, disabled expression, and all running cancellation text.
- [x] Change only the heading-action flex sizing needed to keep this single button on the same title row at the screenshot’s sidebar width; keep wrapping available for genuinely constrained widths.
- [x] Re-run the focused component test until GREEN. Evidence: `OldFavoriteArchivePreviewStep.test.tsx` 31/31 passed on 2026-08-16.

## Task 3: Audit and commit the single UI adjustment

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-16-deepseek-action-layout.md`
- Modify: this plan with implementation evidence

- [x] Run the affected archive-preview test file, `npm run build`, `git diff --check`, `git diff --stat`, and `git status --short`. Evidence: 2026-08-16 final focused Vitest 31/31 passed; `npm run build` exit 0; `git diff --check` exit 0; final status contains only this topic’s three source files and two new documentation files.
- [ ] In Electron development build, verify title/button inline placement, exact text, focusability, disabled state, and narrow-width wrapping; store any evidence in `.codex-artifacts/`. Blocked: the only available desktop automation session returned `Error: node_repl exec context not found` before it could capture the already-running bilimi Electron development window.
- [ ] Re-read `R001`–`R002`, record exact code/test/UI evidence in the ledger, then stage only this topic and create one local `main` commit. Do not merge, push, package, or invoke a real B站 action. Pending the final Git checks and resolution or explicit acceptance of the desktop verification limitation.

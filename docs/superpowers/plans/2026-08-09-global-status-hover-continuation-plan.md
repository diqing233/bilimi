# Global Status Hover Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reveal the hidden suffix of a truncated global status on hover as one continuous blue two-line status, without an ellipsis, while preserving click-to-expand details.

**Architecture:** Keep the existing hover and expansion state. Update the pure text splitter to reserve no ellipsis width, and use a data attribute to switch the first line from ellipsis to clipping only while the hover suffix is visible. The detailed menu continues to take precedence when expanded.

**Tech Stack:** React 19, TypeScript, CSS, Vitest.

---

### Task 1: Prove the no-ellipsis text split

**Files:**

- Modify: `src/renderer/src/features/assistant/feedbackContinuation.test.ts`
- Modify: `src/renderer/src/features/assistant/feedbackContinuation.ts`

- [ ] Add a failing assertion that a 15-character first line for `批阅：可以一键三连、自动分类收藏、发送弹幕。` returns `藏、发送弹幕。`, rather than reserving ellipsis width.
- [ ] Run `npm test -- src/renderer/src/features/assistant/feedbackContinuation.test.ts` and observe its expected failure.
- [ ] Remove ellipsis-width reservation from the binary-search splitter; retain its empty-message, nonpositive-width, and already-fitting guards.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Make the hover suffix visually continuous

**Files:**

- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] Add a failing source/style assertion for `data-continuation-visible` and a matching CSS selector that changes only the first line's temporary `text-overflow` to `clip`.
- [ ] Run `npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/styles.test.ts` and observe its expected failure.
- [ ] Add the data attribute when the suffix is visible, then use it to remove only the ellipsis while hovering. Do not alter the existing expanded menu selector or the click handler that hides the suffix before opening it.
- [ ] Re-run the focused tests and confirm they pass.

### Task 3: Verify the complete state sequence

**Files:**

- Test: `src/renderer/src/features/assistant/globalStatusTooltipPosition.test.ts`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx`

- [ ] Run the related five-file regression suite.
- [ ] Verify in Electron development mode: hover shows a seamless blue two-line status; click opens the unchanged detailed menu and hides the suffix; collapsing it restores the hover behavior.
- [ ] Run `npm run build`, `git diff --check`, `git status --short`, and `git diff --stat`.
- [ ] Create the authorized small local commit containing only this plan and the scoped implementation/test changes.

# Status Tooltip and Feedback Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the intended status-light placements, add a hover-only continuation for truncated global feedback, and place Bilibili connection controls before their explanatory text.

**Architecture:** Keep the first status light's left-side tooltip separate from the second and third lights, whose tooltips are horizontally centered on the whole global-status panel. Keep the existing click-expanded feedback menu unchanged; add a separate hover-only continuation layer that renders only the text hidden by ellipsis and is disabled while the existing menu is open.

**Tech Stack:** React, TypeScript, CSS portal overlays, Vitest, Testing Library.

---

### Task 1: Specify tooltip geometry

**Files:**
- Create: `src/renderer/src/features/assistant/globalStatusTooltipPosition.test.ts`
- Create: `src/renderer/src/features/assistant/globalStatusTooltipPosition.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] Write failing geometry tests for a first-light left placement and second/third placements centered on the full status panel, including a narrow-viewport clamp.
- [ ] Run `npm test -- src/renderer/src/features/assistant/globalStatusTooltipPosition.test.ts` and verify the missing helper fails.
- [ ] Implement a pure geometry helper and connect `GlobalStatusLight` to it without changing the existing expanded-menu state.
- [ ] Re-run the focused geometry test and the assistant test suite.

### Task 2: Specify feedback continuation behavior

**Files:**
- Create: `src/renderer/src/features/assistant/feedbackContinuation.test.ts`
- Create: `src/renderer/src/features/assistant/feedbackContinuation.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] Write a failing pure test that returns only the suffix hidden by an ellipsis and returns no suffix when text fits.
- [ ] Run `npm test -- src/renderer/src/features/assistant/feedbackContinuation.test.ts` and verify it fails because the helper is absent.
- [ ] Add the helper, measure the rendered feedback line on hover/focus, and render the suffix in a lightweight dropdown below the unchanged first line only while the existing menu is collapsed.
- [ ] Preserve the original click toggle; clicking it closes the hover continuation, rotates the arrow, and opens the existing menu.
- [ ] Re-run focused feedback tests and style tests.

### Task 3: Restore settings ordering

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] Write a failing source-order assertion requiring `BilibiliConnectionModeControl` between the legend and the two explanatory paragraphs.
- [ ] Run the focused assistant test and verify the order assertion fails.
- [ ] Move only the existing control invocation before the paragraphs, retaining its state and handlers.
- [ ] Re-run the focused test.

### Task 4: Regression verification

**Files:**
- Modify only the files above and the matching style tests if required.

- [ ] Run targeted assistant, tooltip, and style tests.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`, `git diff --stat`, and `git status --short` to verify no unrelated file was modified or overwritten.

# Emotional XiaoMi Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make XiaoMi feel emotionally alive at key moments while keeping normal watching quiet.

**Architecture:** Extend the existing pet state, asset, hint, and webview title-signal paths. New emotional states are semantic first and reuse current PNGs until dedicated 4K transparent assets are approved.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library.

---

## File Map

- `src/renderer/src/features/assistant/petState.ts`: extend pet state union and labels.
- `src/renderer/src/features/assistant/layeredPetTypes.ts`: extend visual expression, effect, motion types.
- `src/renderer/src/features/assistant/layeredPetModel.ts`: map semantic emotional states to current layers.
- `src/renderer/src/features/assistant/petAssets.ts`: provide asset fallback slots for emotional states.
- `src/renderer/src/features/assistant/petInteractionLines.ts`: add welcome-home and video-finished lines.
- `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`: show welcome-home hint when clicked to restore.
- `src/renderer/src/features/browser/linkCaptureScript.ts`: detect one-time video ended event inside guest page.
- `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`: use stronger emotional hint tones for review actions.
- Relevant tests beside each file.

## Tasks

### Task 1: Extend Pet State Model

**Files:**
- Modify: `src/renderer/src/features/assistant/petState.ts`
- Modify: `src/renderer/src/features/assistant/layeredPetTypes.ts`
- Modify: `src/renderer/src/features/assistant/layeredPetModel.ts`
- Modify: `src/renderer/src/features/assistant/petAssets.ts`
- Test: `src/renderer/src/features/assistant/layeredPetModel.test.ts`

- [ ] Write failing tests for `happy`, `shy`, `thinking`, `cheer`, `sleepy`, `surprised`, and `done`.
- [ ] Run `npm test -- src/renderer/src/features/assistant/layeredPetModel.test.ts` and confirm failure.
- [ ] Add semantic states and map them to existing PNG/effect/motion fallbacks.
- [ ] Re-run the same test and confirm pass.

### Task 2: Add Welcome-Home Click Reaction

**Files:**
- Modify: `src/renderer/src/features/assistant/petInteractionLines.ts`
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
- Test: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`

- [ ] Write failing test that clicking the pet shows a welcome-home line and sets an emotional pet state.
- [ ] Run `npm test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx` and confirm failure.
- [ ] Add welcome-home line pool and call `showLocalPetHint('shy', ...)` in the click restore path.
- [ ] Re-run the same test and confirm pass.

### Task 3: Detect Video Completion Reminder

**Files:**
- Modify: `src/renderer/src/features/browser/linkCaptureScript.ts`
- Test: `src/renderer/src/features/browser/linkCaptureScript.test.ts`

- [ ] Write failing test that a video `ended` event emits `__BILIMI_PET_HINT__` with a review reminder.
- [ ] Write failing test that the same URL does not emit the reminder twice.
- [ ] Run `npm test -- src/renderer/src/features/browser/linkCaptureScript.test.ts` and confirm failure.
- [ ] Add guest-page `ended` listener with per-URL cooldown.
- [ ] Re-run the same test and confirm pass.

### Task 4: Emotional Review Action Hints

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] Write failing test that review action progress uses `cheer` tone.
- [ ] Write failing test that successful review action uses `done` tone.
- [ ] Run `npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx` and confirm failure.
- [ ] Extend `ActionFeedback` tone mapping and update review action calls.
- [ ] Re-run the same test and confirm pass.

### Task 5: Full Verification And Commit

**Files:**
- All changed files.

- [ ] Run focused tests from Tasks 1-4.
- [ ] Run `npm test -- --runInBand` if supported, otherwise `npm test`.
- [ ] Clean temporary `.superpowers/brainstorm` files from the commit.
- [ ] Stage changed source, tests, docs.
- [ ] Commit once for the completed requirement.

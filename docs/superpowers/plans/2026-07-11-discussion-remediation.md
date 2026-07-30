# Discussion Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the five confirmed behavior and copy improvements from the 2026-07-11 discussion, verify them together, and deliver one integrated commit.

**Architecture:** Keep changes inside the existing browser tab, assistant runtime, preference/comment, and old-favorite panel boundaries. Add regression tests before production changes, avoid unrelated refactors, and preserve persisted user choices while changing only missing/reset defaults.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library.

---

### Task 1: Independent browser tabs and DeepSeek review feedback

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [ ] Add failing tests proving the same URL can open twice and either tab can close independently.
- [ ] Replace URL-derived tab identity and URL deduplication with unique per-instance tab IDs.
- [ ] Add failing tests for DeepSeek review results that agree, disagree, fail, or cannot adjust.
- [ ] Ensure every completed/failed review produces a concise result message that reaches the realtime feedback path.
- [ ] Run `npm test -- src/renderer/src/App.test.tsx`.

### Task 2: User-visible timeout floor and fallback wording

**Files:**
- Modify: `electron/main/assistantRuntimeSignal.ts`
- Test: `electron/main/assistantRuntimeSignal.test.ts`
- Modify: `src/renderer/src/features/actions/actionExecutor.ts`
- Test: `src/renderer/src/features/actions/actionExecutor.test.ts`

- [ ] Add failing tests requiring all final runtime failures to wait at least 60 seconds.
- [ ] Raise the quick runtime timeout from 8 seconds to 60 seconds without shortening existing long tasks.
- [ ] Add a failing assertion for the 15-second screen-fallback message.
- [ ] Keep the fallback threshold at 15 seconds and change its copy to `页面响应较慢，已尝试屏幕操作。`.
- [ ] Run the two focused test files.

### Task 3: New defaults and natural local comments

**Files:**
- Modify: `electron/main/store.ts`
- Test: `electron/main/store.test.ts`
- Modify: `src/renderer/src/features/state/assistantState.ts`
- Test: `src/renderer/src/features/state/assistantState.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/features/comments/commentComposer.ts`
- Test: `src/renderer/src/features/comments/commentComposer.test.ts`

- [ ] Add failing tests for missing preferences defaulting to two coins and choose mode while persisted values remain unchanged.
- [ ] Make reset settings restore two coins and choose mode.
- [ ] Replace templated pet/owner fallback comments with three short natural user-style choices per content kind.
- [ ] Keep all local comments distinct, grounded, and at most 100 characters.
- [ ] Run the focused store, state, assistant, and composer tests.

### Task 4: Old-favorite protection explanations and separate actions

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify if needed: `src/renderer/src/styles.css`
- Test if styles change: `src/renderer/src/styles.test.ts`

- [ ] Add failing tests for separate all-reorganize and changed-status actions scoped to selected sources.
- [ ] Place the all-reorganize explanation/action directly below the Basic Data heading and above metrics.
- [ ] Keep changed-status explanation/action below metrics, even when both counts match.
- [ ] Rename health labels to `仍在原归档`, `仅保留部分归档`, and `已不在原归档` with understandable help text.
- [ ] Update confirmation copy to explain current-rule recalculation, selected-source scope, and ordinary-favorite safety.
- [ ] Run the panel test and style test if applicable.

### Task 5: Integration review and delivery

**Files:**
- Review all files changed by Tasks 1-4.
- Keep: `docs/discussions/2026-07-07-general-discussion.md`
- Do not stage: pre-existing `AGENTS.md` changes.

- [ ] Review each implementation against the recorded discussion requirements.
- [ ] Run focused tests, then `npm test`, then `npm run build`.
- [ ] Inspect `git diff --check` and the final diff for unrelated changes.
- [ ] Merge into `main` if the current branch is not `main`, preserving unrelated working-tree changes.
- [ ] Stage only this remediation, create one git commit, and report verification evidence.

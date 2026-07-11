# DeepSeek Feature Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all five DeepSeek capabilities independently configurable, enforce them in the main process, and align defaults, resets, status text, recommendations, and layout.

**Architecture:** Extend `AssistantPreferences` with a dedicated old-favorite organization toggle and keep daily review mode separate. Centralize request-to-toggle authorization in a small main-process helper used before `generateDeepSeekResult`, while renderer components remain responsible for immediate visual state.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: Preference schema and defaults

**Files:** `src/shared/types.ts`, `src/renderer/src/features/state/assistantState.ts`, `electron/main/store.ts` and their tests.

- [ ] Add failing tests for a dedicated `deepseekArchiveOrganizationEnabled` preference, default-enabled child features, legacy migration, and reset/default values.
- [ ] Run the focused state/store tests and confirm failures describe the missing preference/default behavior.
- [ ] Add the preference to shared types and normalization/persistence paths.
- [ ] Run focused tests until green.

### Task 2: Main-process capability enforcement

**Files:** create `electron/main/deepseekFeatureAccess.ts`, create `electron/main/deepseekFeatureAccess.test.ts`, modify `electron/main/index.ts`.

- [ ] Write failing table-driven tests mapping every `DeepSeekGenerateRequest.kind` to its required child toggle.
- [ ] Run the new test and confirm the helper is missing.
- [ ] Implement the authorization helper and call it before starting a DeepSeek request.
- [ ] Run helper and DeepSeek service tests until green.

### Task 3: Settings behavior and layout

**Files:** `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`, `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`, `src/renderer/src/styles.css`, `src/renderer/src/styles.test.ts`.

- [ ] Add failing tests for first-enable defaults, preserving later user choices, reset defaults, independent old-favorite control, compact review select, two model copy buttons, and adjacent server copy button.
- [ ] Run focused component/style tests and confirm expected failures.
- [ ] Implement the settings behavior and accessible compact layout with a visibly disabled select.
- [ ] Run focused tests until green.

### Task 4: Status text and pet synchronization regression

**Files:** `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`, `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`, `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`.

- [ ] Add failing tests that require five explanatory lines in idle, pending, failed, disconnected, and working states.
- [ ] Add a failing pet-window test proving a preference broadcast that disables pet chat removes the composer and prevents new requests.
- [ ] Implement shared status-line formatting and retain task details during working state.
- [ ] Run focused tests until green.

### Task 5: Verification and single commit

**Files:** all files changed by Tasks 1-4 plus the design and plan documents.

- [ ] Run focused tests for state, store, access helper, floating assistant, pet assistant, and styles.
- [ ] Run `npm test` and `npm run build`.
- [ ] Inspect `git diff` and ensure unrelated user changes are not staged.
- [ ] Stage only this requirement's files and create one overall commit as required by `AGENTS.md`.

### Task 4.5: Transcription success wording

**Files:** `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`, `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`.

- [ ] Change the existing completed-session expectation to `暂无转写 · 成功 N` and the success-oriented tooltip.
- [ ] Run the focused test and confirm it fails against the old `完成 N` wording.
- [ ] Update the status formatter and rerun the focused test until green.

# Favorite Library Status Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the five approved favorite-library and assistant-status regressions without changing existing DeepSeek organization, transcription, LocalData, archive, or modal behavior.

**Architecture:** Keep authoritative selection and long-running work in the main process, while the renderer receives compact scopes and status projections. Reuse the existing favorite-operation eligibility contract for both batch and detail affordances. Treat completed-workspace acknowledgement as UI state attached to a workspace identity, never as deletion of the saved organization baseline.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library.

---

### Task 1: Persist unavailable Bilibili metadata state

**Files:**
- Modify: `electron/main/favoriteVideoMetadata.ts`
- Modify: `electron/main/favoriteLibraryCommands.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: corresponding `*.test.ts` and `*.test.tsx` files beside those modules

- [ ] Add a failing test proving Bilibili code `62012` becomes `errorCode: 'unavailable'`, while transport errors remain `network`.
- [ ] Run the focused tests and confirm the assertions fail because all errors currently collapse to `network`.
- [ ] Introduce a typed metadata error classification and persist it through the repository mirror summary.
- [ ] Add a failing renderer test for an independent red `已失效` status with code and last-check time while retaining saved title, tags, archive and memberships.
- [ ] Render the status and rerun focused tests to green.

### Task 2: Reorganize select-all scopes without renderer expansion

**Files:**
- Modify: `src/shared/favoriteLibraryOperations.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Test: renderer selection tests, IPC tests and coordinator tests

- [ ] Add a failing test proving scope select-all still exposes `重新整理` and sends `{ kind: 'scope', scope, options, excludedAids }` rather than an AID array.
- [ ] Add a failing main-process test proving a 30,000-item scope is resolved authoritatively and split by the existing 2,000-item workspace segment size.
- [ ] Extend the IPC request union to accept either explicit AIDs or a structured selection scope with strict validation.
- [ ] Resolve scope selection in main, preserve exclusions and start the existing segmented workspace flow.
- [ ] Keep explicit selection behavior unchanged and rerun focused tests.

### Task 3: Restrict Bilibili source folders and remove empty menus

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `FavoriteLibraryToolbar.test.tsx` and `FavoriteLibraryApp.test.tsx`

- [ ] Add a failing toolbar test proving `更多批量操作` is absent when none of `sync`, `delete-local`, or `unfavorite-remote` is allowed.
- [ ] Add a failing app test proving a Bilibili default/user folder does not expose detail `取消B站收藏`.
- [ ] Derive the menu trigger from actual allowed menu actions and reuse the existing `detailAllowsOnlyCopy` source rule for the detail danger action.
- [ ] Preserve the disabled trigger when actions exist but no rows are selected, then rerun focused tests.

### Task 4: Make the background-task dropdown deterministic

**Files:**
- Modify: `src/renderer/src/features/assistant/assistantGlobalStatusCenter.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `assistantGlobalStatusCenter.test.ts` and `FloatingAssistantApp.test.ts`

- [ ] Add failing tests for an always-present background-task section, inclusion of running/warn/error unfinished states, and an explicit idle message.
- [ ] Add a failing test proving a transcription in `summarizing-deepseek` is shown once as a combined transcription status instead of duplicated as a synthetic DeepSeek task.
- [ ] Keep independent DeepSeek comment, classification, archive, pet-chat and connection-test work aggregated in the DeepSeek row.
- [ ] Implement the status projection and rerun focused tests.

### Task 5: Acknowledge a completed organization round

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Add or modify: focused acknowledgement helper/state module if extraction keeps the projection testable
- Test: `ControlledFavoriteLedgerPanel.test.tsx`, `FloatingAssistantApp.test.ts`, and helper tests

- [ ] Add a failing test proving clicking `好的` both closes the guide and acknowledges the current account/workspace identity.
- [ ] Add a failing test proving an acknowledged completed workspace projects `整理空闲`, while a new workspace identity can report completion again.
- [ ] Persist only the acknowledgement identity; do not abandon or delete the completed workspace, repository records, baseline, or history.
- [ ] Implement the callback and status projection, then rerun focused tests.

### Task 6: Verification and local checkpoint

**Files:**
- Verify all modified production and test files
- Preserve without staging: the two pre-existing 2026-07-30 user-edited documents

- [ ] Run all focused suites for the five tasks with `node_modules\.bin\vitest.cmd run <files>`.
- [ ] Run the established favorite/assistant regression group and report any existing React `act(...)` warnings separately.
- [ ] Run `node_modules\.bin\tsc.cmd --noEmit`; distinguish pre-existing diagnostics from new diagnostics in touched areas.
- [ ] Start the development build with `node_modules\.bin\electron-vite.cmd dev` and verify the approved interactions without executing a final Bilibili sync.
- [ ] Review `git diff`, stage only this plan and implementation files, and create a local commit; do not push.

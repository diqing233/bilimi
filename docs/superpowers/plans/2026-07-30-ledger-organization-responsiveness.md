# Ledger And Organization Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make favorite-ledger selection and old-favorite organization controls respond on the next frame while background persistence and reclassification continue without freezing pointer or window controls.

**Architecture:** Keep immediate UI state in focused external/local stores and reconcile it with authoritative Electron results. Coalesce recommendation mutations so rapid clicks submit the latest selection once, isolate unrelated render trees, and add cooperative event-loop yielding around CPU-heavy organization batches without changing durable workspace semantics.

**Tech Stack:** React 18, TypeScript, Electron IPC, Vitest, Testing Library.

---

### Task 1: Favorite ledger card state

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/favoriteLedgerEnableStore.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [ ] Add a failing interaction test proving the ledger name and check button both reflect the local enabled store immediately.
- [ ] Run the focused test and confirm it fails because the name still reads `ledger.enabled`.
- [ ] Move the complete card presentation behind the per-ledger store subscription while retaining drag, edit, bulk toggle, and persistence behavior.
- [ ] Run the focused tests and confirm only the affected card and summary subscribers update.

### Task 2: Recommendation optimistic selection

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Test: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.test.tsx`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [ ] Add failing tests proving a candidate changes immediately, rapid changes coalesce to the latest set, and a failed request rolls back with an error.
- [ ] Run the focused tests and confirm the failures represent the current snapshot-controlled behavior.
- [ ] Add an optimistic candidate-selection controller that serializes one request at a time and submits the latest pending set.
- [ ] Keep recommendation controls interactive during recommendation persistence while disabling only conflicting navigation or confirmation actions.
- [ ] Run the focused tests and verify account changes and authoritative snapshots cannot apply stale optimistic state.

### Task 3: Organization event-loop responsiveness

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] Add a failing scheduler test proving long recommendation reclassification yields between bounded batches.
- [ ] Run the focused coordinator test and confirm no cooperative yield currently occurs.
- [ ] Insert bounded event-loop yields in the existing batch classification path without changing ordering, history, persistence, or recovery semantics.
- [ ] Run coordinator tests covering adoption, removal, manual-classification preservation, and restart recovery.

### Task 4: Render isolation and loading feedback

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] Add failing tests proving recommendation persistence does not disable every candidate and the busy region exposes progress feedback.
- [ ] Isolate the ledger overview from organization snapshot/loading updates with stable props and callbacks.
- [ ] Apply `cursor: progress` only to the busy organization region, without an input-blocking overlay or global `pointer-events: none`.
- [ ] Preserve close, minimize, scroll, cancel, modal, LocalData, transcription, and latest-action behavior.

### Task 5: Verification and local commit

**Files:**
- Verify all files listed above.

- [ ] Run focused renderer and coordinator Vitest files, then the existing assistant render-isolation regression set.
- [ ] Start the development build with `node_modules\.bin\electron-vite.cmd dev` and verify ledger-name lighting, recommendation add/remove, pointer movement, scrolling, minimize, close, and cancellation in the real Electron UI.
- [ ] Inspect `git diff --check`, `git status --short`, and the final diff for unrelated changes.
- [ ] Create a small local commit; do not package, push, or write remotely.

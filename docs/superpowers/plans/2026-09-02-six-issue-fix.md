# Six Issue Fix Implementation Plan

> **For agentic workers:** Execute inline in the current main worktree because the user explicitly requested implementation, commit, and packaging.

**Goal:** Restore the six user-observed favorite-folder and startup behaviors without changing protected Bilibili or organizing semantics.

**Architecture:** Keep account preferences and the Electron workspace coordinator as the only authorities. Separate editor collapse from deletion, route organizing abandonment through the coordinator, derive recommendation actions from stable IDs, and treat remote inventory reconciliation as the only source for current physical shards. Keep pet startup entirely behind cancellable event-loop yielding tasks.

**Tech Stack:** Electron, React, TypeScript, Vitest, electron-builder NSIS.

---

### Task 1: Local rule editor transaction

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] Add failing tests proving `收起` leaves a new local draft in the editor/list and that local deletion works without an organizing workspace.
- [ ] Run the focused tests and observe the current failure from `close()` filtering the new ledger.
- [ ] Make `close()` presentation-only, keep local save independent of workspace state, and refresh the parent projection after a successful local delete.
- [ ] Run both focused test files and verify the existing organizing-period save/delete tests remain green.

### Task 2: Organizing abandonment and recommendation IDs

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [ ] Add failing tests for `结束整理` clearing the recovery marker and for recommendation cancellation remaining ID-based when the snapshot is no longer `previewing` but the rule still exists.
- [ ] Run the focused tests and record the current `pauseScan`/`previewing` failures.
- [ ] Route the finish action through `abandonCurrentWorkspace`, and project recommendation callbacks/maps from the authoritative retained rule/workspace state without enabling actions after the rule was actually removed.
- [ ] Run focused organizing tests and verify adoption, classification, upper/lower linkage, and next-round re-linking.

### Task 3: Remote rename and shard reconciliation

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `electron/main/favoriteRepositoryBindingService.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Test: `electron/main/favoriteRepositoryBindingService.test.ts`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`

- [ ] Add failing tests for a same-ID renamed folder becoming an unbound candidate, explicit backup confirmation repairing its title, and missing historical shard IDs not inflating current counts.
- [ ] Run the tests to confirm current `bound` projection and rename behavior fail the new contract.
- [ ] Separate exact-ID observation from formal binding; only explicit backup confirmation may invoke rename/adoption. Keep historical missing IDs as non-current deletion candidates.
- [ ] Run all repository binding/sync tests and inspect the generated status/deletion projections.

### Task 4: Startup responsiveness and release verification

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/main/floatingSealIdleTask.ts`
- Test: `electron/main/index.mainWindowPetStartup.test.ts`
- Test: `electron/main/floatingSealWakeController.test.ts`
- Update: `docs/requirement-ledgers/2026-09-02-six-issue-implementation-audit.md`

- [ ] Add or tighten scheduling assertions for main-window first frame, Bilibili load settlement, hidden pet creation, visible initialization, and delayed native polish.
- [ ] Run startup tests and verify no fixed-delay task or pre-display mouse-recovery work remains.
- [ ] Make the smallest scheduling change needed to ensure every native stage yields and can be cancelled without changing pet interaction semantics.
- [ ] Run `npm test`, `npm run build`, `npm run preview`, and `npm run dist:win`; perform the release checklist in development, preview, and installed forms, recording mouse and window-control observations before committing.

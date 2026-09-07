# Recommended Favorites and Bilibili Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make recommended-favorite adoption persist as an ordinary saved rule and refresh bilimi after confirmed user-created Bilibili favorite-folder mutations.

**Architecture:** Keep recommendation state derived from scan facts and ordinary saved-rule snapshots. Remove the adoption-only draft marker so the main process remains authoritative. Add a narrow WebView success-response bridge that emits a refresh request only for the current account's `/favlist` create/rename success, with single-flight coordination and no write side effects.

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest.

---

### Task 1: Lock recommendation adoption to ordinary saved-rule persistence

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:7254-7305`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] Write a failing assertion that an adopted recommendation is `saved-rule`, enabled, unbound, and has no `syncState: 'local-draft'`.
- [x] Run the focused test and confirm it fails because adoption currently writes `local-draft`.
- [x] Remove only the adoption upsert's `syncState` field; preserve ordinary rule IDs, names, keywords, type, enabled state, priority, origin, binding state, and all existing link validation.
- [x] Run focused coordinator/persistence tests and confirm green.

### Task 2: Verify renderer backup consumes the authoritative saved snapshot

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Inspect/modify only if required: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [x] Add a regression coverage review for backup consuming the authoritative saved-ledger snapshot; existing `requestBackup` already treats `saved-rule` adoption as eligible.
- [x] Run focused renderer tests; no renderer production change was required.

### Task 3: Bridge confirmed user Bilibili create/rename responses to refresh

**Files:**
- Inspect and modify the existing Bilibili WebView bridge in `src/renderer/src/App.tsx` and/or the owning Electron session module.
- Modify: the narrowest relevant refresh/IPC test file(s), likely `src/renderer/src/App.test.tsx` and `electron/main/bilibiliSessionRefresh.test.ts`.

- [x] Add failing/targeted tests for current-account `/favlist` mutation success and non-`/favlist` filtering.
- [x] Identify the WebView title-signal seam and preserve popup/page-load behavior as non-success.
- [x] Implement the guarded fetch/XHR success-event bridge; single-flight remains in the existing refresh coordinator.
- [x] Run focused bridge and refresh-coordinator tests.

### Task 4: Full verification, ledger evidence, and local commit

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-06-recommended-favorites-redesign-discussion.md`

- [x] Run focused R029/R028 tests, full `npm test`, and `npm run build`.
- [x] Run `git diff --check`, inspect `git diff --stat`, and confirm no unrelated files changed.
- [x] Record code locations, test evidence, and remaining real-Electron/Bilibili acceptance conditions under I018/I019.
- [ ] Perform the required real Electron acceptance if available; current session has no live Bilibili account/UI state, so it remains pending.
- [ ] Create one local commit containing the implementation, tests, plan, and ledger evidence; do not merge, push, rebase, package, or delete the worktree.

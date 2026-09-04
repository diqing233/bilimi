# Bound Rename Confirmation and Deleted-ID Tombstone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require confirmation before renaming an already-bound B站收藏夹, and prevent a remotely deleted exact folder ID from returning as a remote-observation draft.

**Architecture:** The renderer first asks `App.tsx` for a read-only bound-rename preflight.  `FavoriteLedgerOverview` renders a separate rename confirmation modal and retries only after the user confirms, so it reuses the existing exact-ID direct rename IPC without entering the rebind/create flow.  A confirmed-deleted folder ID becomes an account-wide tombstone which removal, old-workspace recovery, and remote-draft projection all consume, while preserving user-authored rules and historical mirrors.

**Tech Stack:** TypeScript, React, Electron IPC, Vitest, existing favorite-ledger repository and account preferences.

---

## File map

- `src/shared/types.ts` — typed explicit confirmation flag for the exact bound-rename preflight.
- `src/renderer/src/App.tsx` — calculate exact bound-title mismatches, fail closed before any page script, and return typed preflight candidates until confirmation.
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` — render/cancel/confirm the distinct rename modal and relay the explicit confirmation flag.
- `src/shared/favoriteLedgerDeletion.ts` — remove only structurally pure observation drafts sharing a confirmed-deleted exact ID.
- `electron/main/oldFavoriteWorkspaceCoordinator.ts` and `electron/main/index.ts` — inject and consume confirmed-deleted-ID tombstones during old scan recovery.
- `src/renderer/src/features/favorites/favoriteLedgerApi.ts` — suppress already persisted pure observation drafts for confirmed-deleted IDs in every renderer projection.
- Tests in the matching `*.test.ts(x)` files — establish exact-ID, no-write, and user-rule preservation regressions.
- `docs/项目功能项目书.md` and `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md` — durable project contract and R023/R024 evidence.

### Task 1: Establish the project contract and baseline

**Files:**
- Modify: `docs/项目功能项目书.md:9.5`
- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`
- Create: `docs/superpowers/plans/2026-09-04-bound-rename-confirm-delete-id.md`

- [x] **Step 1: Record R023/R024 and their exact-ID scope**

  Keep R023/R024 verbatim in the ledger original area; add I020/I021 with exact UI, state, persistence, side-effect, and preservation boundaries.

- [x] **Step 2: Amend project book before production code**

  Document that a title-different formal binding uses a separate `确认修改 B 站收藏夹名称` modal, and that verified deleted IDs are tombstones for deletion cleanup, recovery, and projection.

- [x] **Step 3: Verify docs are structurally sound**

  Run: `git diff --check -- docs/项目功能项目书.md docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md docs/superpowers/plans/2026-09-04-bound-rename-confirm-delete-id.md`

  Expected: exit code 0.

### Task 2: Test and implement the exact-ID deletion tombstone

**Files:**
- Modify: `src/shared/favoriteLedgerDeletion.test.ts`
- Modify: `src/shared/favoriteLedgerDeletion.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/index.ts`

- [x] **Step 1: Write deletion cleanup RED tests**

  Add a test where deleting `4020631311` through default `knowledge` removes only a pure `custom-remote-4020631311` observation draft. Add a separate saved/enabled/keyword local rule with that ID and assert it remains.

- [x] **Step 2: Run the deletion test and observe RED**

  Run: `npm test -- --run src/shared/favoriteLedgerDeletion.test.ts`

  Expected: new exact-ID pure-draft assertion fails because deletion only changes the selected logical ledger.

- [x] **Step 3: Implement minimal exact-ID cleanup**

  In `applyConfirmedManagedFavoriteRemoteFolderDeletion`, aggregate all confirmed deletion IDs and filter only pure remote-observation drafts: one ID, `local-draft`, `unbound`, not `saved-rule`, disabled, no nonblank keyword. Keep every other rule and preserve mirrors.

- [x] **Step 4: Run deletion test GREEN**

  Run: `npm test -- --run src/shared/favoriteLedgerDeletion.test.ts`

  Expected: PASS.

- [x] **Step 5: Write renderer projection RED tests**

  Add a persisted pure observation draft with ID `4020631311` plus a default ledger whose `confirmedDeletedRemoteFolderIds` contains that ID. Assert status projection omits it and `remoteOnlyDraftLedgerIds` omits it; assert a saved/keyword rule remains.

- [x] **Step 6: Run renderer projection test and observe RED**

  Run: `npm test -- --run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

  Expected: new draft remains because the existing code only blocks newly discovered IDs.

- [x] **Step 7: Implement renderer tombstone filtering**

  Build one normalized confirmed-deleted-ID set from account ledgers. Filter existing pure observation drafts with those IDs before indexes and before `remoteOnlyDraftLedgerIds`; continue using exact IDs only.

- [x] **Step 8: Run renderer projection test GREEN**

  Run: `npm test -- --run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

  Expected: PASS.

- [x] **Step 9: Write recovery RED test**

  Create a completed old scan containing remote ID `4020631311`, inject `getConfirmedDeletedRemoteFolderIds: () => ['4020631311']`, and assert recovery neither persists `custom-remote-4020631311` nor creates a pending shard.

- [x] **Step 10: Run coordinator test and observe RED**

  Run: `npm test -- --run electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: new recovered-draft assertion fails because recovery currently sees only deleted default logical IDs.

- [x] **Step 11: Implement recovery tombstone injection and filter**

  Add the callback to coordinator options and `index.ts`, aggregate confirmed deleted IDs from account preferences, filter recovery candidates/persisted custom candidates before `saveRecoveredLedgerDrafts`, bindings, and placements.

- [x] **Step 12: Run coordinator test GREEN**

  Run: `npm test -- --run electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: PASS.

### Task 3: Test and implement the bound-rename confirmation modal

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [x] **Step 1: Write App preflight RED test**

  For a formal shard `(game, 1, 4106106611)` whose remote title differs, invoke explicit backup without confirmation. Assert a typed `boundRenameCandidates` result, no `renameFavoriteRepositoryBoundLedgerShard`, no page script, no adoption, and no creation.

- [x] **Step 2: Run App test and observe RED**

  Run: `npm test -- --run src/renderer/src/App.test.tsx`

  Expected: existing path invokes direct rename immediately.

- [x] **Step 3: Implement typed no-write preflight**

  Add `confirmBoundRename?: boolean` to save options. Before direct rename in `ensureFavoriteLedger` and `saveFavoriteLedgers`, identify title-different formal exact tuples in the explicit target set. If not confirmed, return candidates containing logical ID, current local name/count, current B站 name/count, shard number, and no exposed ID requirement. Do not run any script or IPC.

- [x] **Step 4: Run App test GREEN**

  Run: `npm test -- --run src/renderer/src/App.test.tsx`

  Expected: PASS; existing explicit confirmed calls still use the exact existing rename IPC.

- [x] **Step 5: Write overview modal RED test**

  Mock `onSyncLedgers` to return bound rename candidates. Click `备册收藏夹`; assert title `确认修改 B 站收藏夹名称`, no `ID：`, current and target wording, and no second call. Cancel and assert no second call. Reopen, confirm, and assert the second call includes `confirmBoundRename: true` for the candidate ledger IDs.

- [x] **Step 6: Run overview test and observe RED**

  Run: `npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

  Expected: no distinct modal exists.

- [x] **Step 7: Implement modal state and confirmation relay**

  Add distinct bound-rename candidate state and handler. Keep the existing rebind modal unmodified for unbound candidates. Cancel clears only rename state. Confirm reruns the same narrowed backup with `confirmBoundRename: true`; after success it closes, otherwise preserves actual error state.

- [x] **Step 8: Run overview test GREEN**

  Run: `npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

  Expected: PASS.

### Task 4: Verify, update audit evidence, and commit the isolated branch

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`

- [x] **Step 1: Run focused regression suite**

  Run: `npm test -- --run src/shared/favoriteLedgerDeletion.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

  Expected: PASS.

- [x] **Step 2: Run build**

  Run: `npm run build`

  Expected: exit code 0.

- [x] **Step 3: Inspect scope and whitespace**

  Run: `git status --short --branch; git diff --stat; git diff --check`

  Expected: only this plan, book, ledger, listed production files, and their tests; no whitespace errors.

- [x] **Step 4: Record per-index evidence**

  Update I020/I021 with exact code locations and fresh test results. Mark real Electron interaction and real B站 mutation as pending manual acceptance; no automated test proves mouse responsiveness.

- [x] **Step 5: Commit only this branch**

  Run: `git add docs/项目功能项目书.md docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md docs/superpowers/plans/2026-09-04-bound-rename-confirm-delete-id.md src/shared/types.ts src/shared/favoriteLedgerDeletion.ts src/shared/favoriteLedgerDeletion.test.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/index.ts && git commit -m "fix: confirm bound rename and tombstone deleted folders"`

  Expected: one local commit on `codex/bound-rename-confirm-delete-id`; do not merge or push.

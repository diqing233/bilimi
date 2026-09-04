# Bound Favorite Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an explicit backup of an already formally bound Bilibili favorite rename that exact existing folder and its ledger title without entering the rebind/adoption flow.

**Architecture:** The main process receives a new exact-bound-shard rename IPC, verifies the existing `bound` physical shard before any remote write, and confirms a single rename with existing bounded inventory retries. The renderer invokes it only for an explicit backup target identified from the formal repository snapshot, then runs the existing backup projection after the exact title has converged; unbound candidates remain on the existing adoption route.

**Tech Stack:** Electron IPC, TypeScript, Vitest, React renderer, Bilibili page bridge, JSONL favorite repository.

---

### Task 1: Lock the formal-bound rename service contract

**Files:**
- Modify: `electron/main/favoriteRepositoryBindingService.test.ts`
- Modify: `electron/main/favoriteRepositoryBindingService.ts`

- [x] **Step 1: Write failing service regressions**

Add a `bound game-1` fixture and assert `renameBoundPhysicalShard('100', { logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', remoteFolderId: 'game-1', shardNumber: 1 })` calls `renameFolder` once, never calls `adoptExistingPhysicalShard`, and returns the same bound shard with the new `remoteTitle`. Add an already-target-title fixture that performs no remote rename but commits the same shard title repair. Add a missing exact bound fixture that rejects before remote rename.

- [x] **Step 2: Run the focused service test and observe RED**

Run: `npm test -- --run electron/main/favoriteRepositoryBindingService.test.ts`

Expected: the new method is absent or the old adoption route fails the new exact-bound assertions.

- [x] **Step 3: Implement the minimal exact-bound service method**

In `FavoriteRepositoryBindingService`, add `renameBoundPhysicalShard`. Normalize account, logical ID, shard number and remote ID; load the repository snapshot and require exactly the existing `bound` shard tuple. Read only that ID from the inventory, perform at most one `renameFolder` when its title differs from `favoriteRepositoryManagedShardTitleForDisplay`, reuse bounded yielding reads to verify the exact ID, and commit `upsert-physical-shard-binding` only for the matched existing shard. Return `FavoriteRepositoryBindingSnapshot`; do not call adoption or create/delete/video APIs.

- [x] **Step 4: Run the focused service test and observe GREEN**

Run: `npm test -- --run electron/main/favoriteRepositoryBindingService.test.ts`

Expected: all service assertions pass.

### Task 2: Expose the direct rename through a separate IPC boundary

**Files:**
- Modify: `electron/main/favoriteRepositoryIpc.test.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [x] **Step 1: Write a failing IPC test**

Register a fake binding service with `renameBoundPhysicalShard`, invoke `favorite-repository:rename-bound-ledger-shard` with the exact tuple, and assert its method receives the normalized account and exact tuple. Assert malformed input and a service rejection do not reach `onLedgerBindingAdopted`.

- [x] **Step 2: Run the focused IPC test and observe RED**

Run: `npm test -- --run electron/main/favoriteRepositoryIpc.test.ts`

Expected: no IPC handler exists for the new channel.

- [x] **Step 3: Implement the IPC and renderer type**

Add one handler that keeps the existing trusted-sender/current-account validation, validates the tuple, calls only `renameBoundPhysicalShard`, and preserves the existing post-commit projection callback as best effort. Expose it from preload and declare the same optional renderer API signature.

- [x] **Step 4: Run the focused IPC test and observe GREEN**

Run: `npm test -- --run electron/main/favoriteRepositoryIpc.test.ts`

Expected: all IPC tests pass and adoption channel behavior is unchanged.

### Task 3: Route explicit backup of formal bindings to direct rename

**Files:**
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`

- [x] **Step 1: Write a failing renderer regression**

Mock a formal `game` physical shard and a local target title drift. Trigger explicit backup and assert the new direct-rename IPC receives `game`, shard `1`, and the existing folder ID; assert `adoptFavoriteRepositoryLedgerBinding` is not called and the persisted ledger remains `bound` with the returned target title. Add a local-save-only assertion that does not call the new IPC.

- [x] **Step 2: Run the focused App test and observe RED**

Run: `npm test -- --run src/renderer/src/App.test.tsx`

Expected: the old script reports an unbound candidate or adoption is selected instead of direct rename.

- [x] **Step 3: Implement bounded explicit routing**

Return exact bound physical-shard metadata from `projectFavoriteLedgersToFormalBindings`. In `saveFavoriteLedgers` and `ensureFavoriteLedger`, only when the caller supplies an explicit backup target, call the new direct-rename IPC for those exact formal bound shards before invoking the existing browser script. Apply returned `remoteTitle` to the same local ledger, then retain the existing script/adoption route solely for unbound candidates. On direct rename failure, return a stage-specific failure without creating candidates or changing binding authority.

- [x] **Step 4: Run the focused App test and observe GREEN**

Run: `npm test -- --run src/renderer/src/App.test.tsx`

Expected: direct rename, bound title persistence, and passive-save zero-write boundary all pass.

### Task 4: Update audit evidence and verify regressions

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`
- Modify: `docs/项目功能项目书.md`

- [x] **Step 1: Record code locations and test evidence for I018/I019**

Update the requirement ledger after final commands with method names, test files, direct-rename/no-adoption evidence, and the unresolved real-account Electron validation boundary.

- [x] **Step 2: Run targeted and full verification**

Run: `npm test -- --run electron/main/favoriteRepositoryBindingService.test.ts electron/main/favoriteRepositoryIpc.test.ts src/renderer/src/App.test.tsx`

Run: `npm test -- --run`

Run: `npm run build`

Expected: exit code `0` for each command.

- [ ] **Step 3: Perform non-destructive Electron interaction verification**

  Automated build/test verification is complete. A development launch from this
  worktree detected existing Bilimi Electron instances (the app's single-instance
  lock) and exited without opening a separate window, so the current branch still
  requires a real-window mouse/resize/minimize/close check before this step can be
  marked complete.

Open the development app without performing Bilibili writes. Check mouse movement, click, scrolling, resize, minimize/restore, and close responsiveness. Record actual observations in the ledger; leave real Bilibili rename/delete verification explicitly pending if not performed.

- [x] **Step 4: Inspect the final patch and commit only this topic**

Run: `git status --short`, `git diff --stat`, and `git diff --check`.

Expected: only project book, ledger, direct-rename IPC/service/renderer code, and their tests change. Commit the verified branch once; do not merge or push.

Completed in commit `7cd6acbb`; the branch worktree is clean. The root `main`
worktree has unrelated uncommitted recommendation-toggle changes, so merging
this branch there would mix topics and is intentionally left for a separately
authorized clean working-tree step.

### Post-implementation audit: prevent direct-rename fallback

**Files:**
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`

- [x] **Step 1: Add failing fallback regressions**

Cover a local target still declared `bound` whose formal tuple is absent, a missing direct-rename preload API, a generic post-rename script failure, and a transient old `unbound` projection for the same already-renamed target.

- [x] **Step 2: Observe RED**

`npm test -- --run src/renderer/src/App.test.tsx` initially reported four expected failures: absent tuple and absent API continued to the page script, generic downstream failure became `ok: true`, and stale target output retained an unbound failure message.

- [x] **Step 3: Fail closed and preserve unrelated failures**

Require the original explicit target's bound ID set to match a formal shard before page automation; report an unavailable direct IPC as a direct-rename failure; apply only allowed formal shard tuples from returned snapshots; and convert only a verified, target-only stale projection into a clear rename-success message.

- [x] **Step 4: Re-run the App regression**

Run: `npm test -- --run src/renderer/src/App.test.tsx`

Expected: all App tests pass; login checks are allowed, but neither page backup script nor adoption runs in the two new fail-closed cases.

**Verification record:** `App.test.tsx` passed 149/149. The direct renderer, service, and IPC suite passed 247/247, and `npm run build` exited 0. Three attempts at an otherwise-unrelated all-suite run remained inside the pre-existing 359-test `oldFavoriteWorkspaceCoordinator.test.ts` suite without a final process exit; only those newly created test process trees were stopped to protect interactive responsiveness. This is not a full-suite pass and requires a clean-environment re-run.

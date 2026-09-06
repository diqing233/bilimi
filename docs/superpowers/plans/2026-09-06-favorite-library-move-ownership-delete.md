# Favorite Library Move, Ownership, and Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent location moves during an unfinished organization, make local-save ownership authoritative, and restore explainable local and managed-remote deletion.

**Architecture:** The renderer receives the workspace status only for immediate disabled states; the main-process mutation service independently rejects moves while the workspace is unfinished. The organizer's existing `commit-local-plan` command becomes the one transaction that writes memberships, organization records, and position records, so the existing favorite-library detail and deletion services read one durable local truth.

**Tech Stack:** Electron, TypeScript, React, Vitest, Testing Library.

---

### Task 1: Lock Moves While Organization Is Unfinished

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Modify: `electron/main/favoriteRepositoryBatchOperationService.ts`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Test: `electron/main/favoriteRepositoryBatchOperationService.test.ts`

- [x] **Step 1: Write failing renderer and main-process tests**

```ts
expect(screen.getByRole('button', { name: /移动至/ })).toBeDisabled()
await expect(service.move('100', [1], 'bilimi-logical:source', ['bilimi-logical:target'], 7)).rejects.toThrow('Favorite move is unavailable while organization is unfinished.')
```

- [x] **Step 2: Run focused tests and confirm the new assertions fail because no workspace gate exists.**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteRepositoryBatchOperationService.test.ts`

Expected: FAIL on the move-disabled assertion and the missing main-process rejection.

- [x] **Step 3: Add the minimal shared status gate.**

```ts
const workspaceMoveLocked = Boolean(summary?.workspace && summary.workspace.status !== 'completed')
```

Pass it to batch and detail move controls, keep copy enabled, and reject `move()` from the batch operation service when its fresh snapshot has an unfinished workspace.

- [x] **Step 4: Re-run focused tests and confirm they pass.**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteRepositoryBatchOperationService.test.ts`

Expected: PASS with the new disabled-state and service-guard assertions.

### Task 2: Persist Local-Save Placement With Its Membership

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Write a failing local-save regression test.**

```ts
await coordinator.saveCurrentSegmentToLocalLibrary('100')
await expect(repository.getSnapshot('100')).resolves.toMatchObject({
  memberships: { 'bilimi-logical:knowledge': [1] },
  positions: { '100:1': { localDesiredFolderIds: ['bilimi-logical:knowledge'] } }
})
```

- [x] **Step 2: Run the focused test and confirm it fails because the local-save command omits `placements`.**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: FAIL with an empty `localDesiredFolderIds` position after save.

- [x] **Step 3: Include one placement per selected aid in the existing `commit-local-plan` payload.**

```ts
placements: selectedAids.map((aid) => ({
  aid,
  localDesiredFolderIds: (assignmentsByAid.get(aid)?.targetLedgerIds ?? ['inbox'])
    .filter((id) => id !== 'inbox')
    .map(localFolderIdForLedger)
    .sort(),
  remoteObservedPhysicalFolderIds: [...(repository.positions[`${workspace.accountMid}:${aid}`]?.remoteObservedPhysicalFolderIds ?? [])],
  remoteObservedLogicalFolderIds: [...(repository.positions[`${workspace.accountMid}:${aid}`]?.remoteObservedLogicalFolderIds ?? [])],
  updatedAt: this.now(),
  reason: 'old-favorite-local-save'
}))
```

- [x] **Step 4: Re-run the focused test and confirm it passes.**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS with the position and membership both pointing to the saved work folder.

### Task 3: Exercise Delete Against the Repaired Authority

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: Confirm existing detail/delete regression coverage for saved local ownership.**

```ts
The existing renderer suite covers saved local ownership, local-delete confirmation and the no-managed-remote dialog; the coordinator regression in Task 2 supplies the missing authoritative position fact.
```

- [x] **Step 2: Run the focused renderer test and confirm the saved ownership/delete behavior is covered by the repaired authoritative placement.**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: the focused test should identify any remaining detail/delete regression; the confirmed root cause is the missing local placement in the save transaction, so no speculative stale-response change is planned without a failing reproduction.

- [x] **Step 3: Preserve the existing detail refresh and remote-delete missing-target dialog.**

The local-save placement is written in the same repository transaction, and the existing page/detail refresh reads that revision. Keep the existing `missing-target` dialog for any video without a managed remote observation; do not send a remote request from that branch.

- [x] **Step 4: Re-run focused tests and confirm they pass.**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: PASS with saved local ownership, local-delete confirmation, and no-managed-remote explanatory dialog coverage.

### Task 4: Verify and Audit

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-06-favorite-library-move-ownership-delete.md`

- [x] **Step 1: Run type/build and all directly affected test files.**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteRepositoryBatchOperationService.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx && npm run build`

Expected: exit code 0.

- [x] **Step 2: Run `git diff --check`, re-read R001/R002 and update each index row with code paths and test evidence.**

- [x] **Step 3: Run the Electron development build only for local UI responsiveness.**

Run: `npm run dev`

Expected: verify the disabled move control, saved ownership, local confirmation, and missing-target dialog without sending a real B站 delete request.

- [x] **Step 4: Commit only this branch's project-book, ledger, plan, source, and test changes.**

Run: `git add docs/项目功能项目书.md docs/requirement-ledgers/2026-09-06-favorite-library-move-ownership-delete.md docs/superpowers/plans/2026-09-06-favorite-library-move-ownership-delete.md electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteRepositoryBatchOperationService.ts electron/main/favoriteRepositoryBatchOperationService.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx && git commit -m "fix: protect favorite library organization actions"`

Expected: one local commit on `codex/favorite-library-move-ownership-delete`.

Actual: commit `2e475c78` contains only the project-book, requirement ledger, plan, source, and test changes listed above.

# Empty Managed Folder Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a user removes only a bilimi work folder from the local Favorite Library, restore its empty local shell on the next permitted library operation when its right-side rule is enabled, without changing Bilibili or restoring historical members.

**Architecture:** The local deletion command keeps its formal physical-shard IDs but clears every local member projection, placement, organization record, and protection relationship for that logical folder. A small local-only projection command recreates missing logical folders from enabled account rules and retained physical shard metadata, always with empty membership. The main process invokes the projection after permitted repository activity and before account summary reads; it excludes the deletion command itself so local deletion remains visible until a later operation.

**Tech Stack:** TypeScript, Electron main process, Vitest.

---

### Task 1: Prove local-only deletion drops all reusable local member data

**Files:**

- Modify: `src/shared/favoriteRepository.test.ts`
- Modify: `src/shared/favoriteRepository.ts`

- [x] **Step 1: Write the failing test**

Add a local-only managed-folder deletion fixture containing logical membership, physical-shard membership, local placements, and organization records. Assert that the formal physical shard with its remote ID remains, but neither the deleted logical ID nor its physical shard ID remains in `memberships`, and no position retains the deleted local desired folder.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/shared/favoriteRepository.test.ts -t "clears reusable local members when deleting a managed folder locally"`

Expected: FAIL because local-only deletion currently retains physical-shard memberships.

- [x] **Step 3: Implement the smallest projection change**

In the `delete-local-managed-folder` / `delete-local-managed-folders` branch, preserve formal `physicalShards` when there is no confirmed remote deletion, but remove each matching physical shard folder ID from `memberships` along with the logical work-folder ID. Continue retaining Bilibili mirror folders, remote observations, remote IDs, and `remoteMemberCount`.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- src/shared/favoriteRepository.test.ts -t "clears reusable local members when deleting a managed folder locally"`

Expected: PASS.

### Task 2: Prove enabled rules restore only empty local work-folder shells

**Files:**

- Modify: `electron/main/favoriteLibraryManagedFolderProjection.test.ts`
- Modify: `electron/main/favoriteLibraryManagedFolderProjection.ts`
- Modify: `src/shared/favoriteRepository.ts`

- [x] **Step 1: Write the failing tests**

Add tests for a snapshot that retains a formally bound physical shard but lacks its logical work folder. With an enabled matching rule, assert a local-only restore command recreates the logical folder and leaves both its logical and physical memberships empty. With the same rule disabled, assert no command is emitted. Assert the command payload contains no Bilibili write or remote member input.

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- electron/main/favoriteLibraryManagedFolderProjection.test.ts -t "empty managed"`

Expected: FAIL because no empty-shell projection exists.

- [x] **Step 3: Implement the local-only restore command**

Add a bounded repository command that receives enabled rules and creates only missing `bilimi-logical:<ledgerId>` folders. It must reuse retained physical shard metadata, create empty `memberships` entries, preserve the existing shard ID/binding state/remote ID, and never read or mutate Bilibili. Expose an idempotent projection function that commits this command only for enabled rules with retained local shard state.

- [x] **Step 4: Run the focused tests and verify they pass**

Run: `npm test -- electron/main/favoriteLibraryManagedFolderProjection.test.ts -t "empty managed"`

Expected: PASS.

### Task 3: Wire recovery to permitted local activity without breaking deletion or remote workflows

**Files:**

- Modify: `electron/main/index.ts`
- Modify: `electron/main/favoriteRepositoryIpc.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts` or the narrowest existing main-process test file

- [x] **Step 1: Write the failing integration tests**

Test that account-open/refresh invokes the empty-shell projection before returning the first library summary. Test that a non-deletion repository activity can restore an enabled rule’s empty folder, while the deletion command itself does not immediately restore it. Test that a disabled rule is excluded. Assert the projection writer has no page bridge/Bilibili dependency.

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- electron/main/favoriteRepositoryIpc.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: FAIL because the central local projection is not wired.

- [x] **Step 3: Wire the projection**

Add one main-process helper that reads account rules, filters to enabled rules, and invokes the local empty-shell projection. Call it before local account summaries, and after repository changes other than local managed-folder deletion or its own idempotent restore command. Serialize/coalesce it so rapid scan pages do not make clicks or scrolling wait; do not await it on renderer event paths where it is not needed for correctness.

- [x] **Step 4: Run the focused tests and verify they pass**

Run: `npm test -- electron/main/favoriteRepositoryIpc.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS.

### Task 4: Verify protected workflows and record evidence

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-14-local-managed-folder-recovery-timing.md`

- [x] **Step 1: Run scoped regression tests**

Run: `npm test -- src/shared/favoriteRepository.test.ts electron/main/favoriteLibraryManagedFolderProjection.test.ts electron/main/favoriteRepositoryManagedFolderService.test.ts electron/main/favoriteRepositoryIpc.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/App.test.tsx`

Expected: PASS.

- [x] **Step 2: Run type/build validation and inspect the development app**

Run: `npm run build`

Then start the Electron development app and manually verify: local-only deletion keeps the right rule and Bilibili untouched; a refresh restores an empty folder; disabled rules stay hidden; a newly successful, already-backed review still writes its new item; sync still saves locally before its remote run. Confirm mouse movement, clicks, scrolling, resize, minimize, and close remain responsive while a scan is active.

- [x] **Step 3: Update the requirement ledger per confirmed item**

Record code locations, exact automated-test names, manual UI evidence, and any environment-limited validation separately for I002–I005. Do not mark an item verified solely from a related test.

- [ ] **Step 4: Check repository state and commit**

Run: `git diff --check`, `git diff --stat`, and `git status --short`. Commit only the scoped implementation, tests, plan, and ledger with `git commit -m "fix: restore empty managed favorite folders"`.

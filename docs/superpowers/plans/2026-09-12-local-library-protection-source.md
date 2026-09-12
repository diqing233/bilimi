# Local-library protection source implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make incremental-scan protection depend only on persisted local organization records, never on members observed in Bilibili `bilimi·…` work folders.

**Architecture:** `organizationRecords` remains the sole local source of the runtime protection set. Managed-folder member reads remain intact for remote-observation and folder-binding workflows, but must not alter `protectedAids` or synthesize local organization records. Scan completion and lifecycle reconciliation must preserve a locally saved record even if its prior remote work-folder member is no longer observed or the video is also seen in an ordinary Bilibili source.

**Tech stack:** Electron main process, TypeScript, Vitest.

---

### Task 1: Lock the local-only rule with coordinator regressions

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:642-702, 5180-5217`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Write the failing remote-only regression**

  Replace the bound-remote-member expectation with a test whose complete expectation is:

  ```ts
  await expect(coordinator.finishScan('100')).resolves.toMatchObject({
    plannedAids: [1, 2, 3],
    protectedAids: []
  })
  await expect(repository.getSnapshot('100')).resolves.toMatchObject({
    organizationRecords: []
  })
  ```

  Keep a formally bound `bilimi-music` folder containing `[1, 4]` and a scanned ordinary-source page containing `[1, 2, 3]`. The assertion proves Bilibili membership alone neither skips AID 1 nor writes AIDs 1/4 into local protection records.

- [x] **Step 2: Write the failing local-only regression**

  Rename the remote-loss regression so its expected result is local protection, and assert:

  ```ts
  expect(workspace.plannedAids).not.toContain(1)
  await expect(repository.getSnapshot('100')).resolves.toMatchObject({
    organizationRecords: [{ aid: 1, targetFolderIds: ['bilimi-logical:music'] }]
  })
  ```

  Its only scanned source is an ordinary folder. There is no observed member in the formerly remote `managed-old` folder. This proves remote absence does not revoke a local record.

- [x] **Step 3: Run the focused test file before production changes**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: the two new expectations fail because the current coordinator adds formal remote members to protection and requires a remote member for a non-local target record.

### Task 2: Make protection local-only through scan completion and lifecycle reconciliation

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:2245-2264, 3207-3242`
- Modify: `src/shared/favoriteRepository.ts:2503-2553`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Stop runtime remote-member protection**

  Keep `appendManagedMembers` exactly as the durable scan observation, then return without adding any of `members` to `streaming.protectedAids`:

  ```ts
  await this.options.workspaceStore.appendManagedMembers(workspace.accountMid, workspace.id, { runId, members })
  return true
  ```

- [x] **Step 2: Stop scan-completion migration from remote members**

  Replace the formal-folder/member-derived block with local-record selection only:

  ```ts
  const successfulAids = repository.organizationRecords
    .filter((record) => organizableItemsByAid.has(record.aid))
    .map((record) => record.aid)
  const protectedAidSet = new Set(successfulAids)
  ```

  Do not issue `record-organization-protections` from `finishScan`; do not add remote members to `successfullyClassifiedAids`.

- [x] **Step 3: Preserve local protection during remote lifecycle reconciliation**

  Keep lifecycle states and recycle tombstones as remote-observation facts, but remove the branches that filter `organizationRecords` for `recycled` and `organization-conflict` states:

  ```ts
  if (lifecycleState === 'recycled') {
    tombstones[key] = {
      accountMid: snapshot.accountMid, aid: observation.aid, deletedAt: normalizedTimestamp(command.issuedAt),
      reason: 'complete-scan-no-source', allowRediscovery: true, kind: 'recycled'
    }
  } else if (tombstones[key]?.kind === 'recycled') {
    delete tombstones[key]
  }
  ```

  The regression from Task 1 must remain red until this change: its local record is currently removed when an ordinary source produces `organization-conflict` after a stale remote placement.

- [x] **Step 4: Run the focused test file after the change**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: all tests in this file pass, including the remote-only and local-only regressions.

### Task 3: Verify and document the accepted requirements

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-12-favorite-library-empty-protected-scan.md`
- Verify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`, full `npm test`, `npm run build`

- [x] **Step 1: Record code locations and automatic evidence per accepted ledger item**

  Update R001, R002, and R005 with the changed coordinator locations and the exact regression-test evidence. Record that the screenshot scenario is UI-accepted by the protected-count semantics but requires a signed-in live Bilibili session for final manual observation.

- [x] **Step 2: Run repository-wide automated verification**

  Run: `npm test`

  Expected: exit code 0 with no failed test files.

- [x] **Step 3: Build the Electron application**

  Run: `npm run build`

  Expected: exit code 0.

- [x] **Step 4: Review the implementation and working tree**

  Run:

  ```powershell
  git diff --check
  git diff --stat
  git status --short
  ```

  Expected: only the coordinator, its tests, the plan, and the current requirement ledger are modified; `git diff --check` has no output.

- [x] **Step 5: Commit the verified round**

  Run:

  ```powershell
  git add electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/shared/favoriteRepository.ts src/shared/favoriteRepository.test.ts docs/superpowers/plans/2026-09-12-local-library-protection-source.md docs/requirement-ledgers/2026-09-12-favorite-library-empty-protected-scan.md
  git commit -m "fix: use local library for favorite protection"
  ```

  The commit must contain no unrelated changes.

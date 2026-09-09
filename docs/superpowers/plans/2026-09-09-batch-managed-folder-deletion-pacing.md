# Batch Managed-Folder Deletion Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a confirmed batch deletion from sending consecutive Bilibili folder-delete writes without the bounded pacing already used by other remote favorite writes.

**Architecture:** Keep the existing one-at-a-time, exact-`folder ID` deletion loop and its stop-on-unknown behavior. Before each actual delete request after the first confirmed actual write, call the service's existing pacing mechanism; it already waits 1,200–2,000 ms by default and yields through the injected test seam. Preserve the current reconciliation branch and never retry an unknown write.

**Tech Stack:** TypeScript, Electron main process, Vitest.

---

## Requirement disposition

### Implemented in this batch

1. `R011 / I011`: batch deletion must not issue more than one Bilibili `folder/del` write without an intervening bounded delay; the fix must remain serial and must not resend an unknown result.

### Investigation complete; no code change requested by the later discussion

1. `R001 / I001`, `R007 / I007`, `R008 / I008`, `R009 / I009`, `R010 / I010`: diagnosis and deletion-path evidence only.

### Explicitly superseded or pending user direction

1. `R002 / I002`: its broad display regrouping proposal is superseded by `R004`'s “只需要” minimal-scope proposal.
2. `R004 / I004`, `R006 / I006`: were recorded as “待确认方案”; later evidence in `R007`/`R008` shows that changing the current formal binding ID cannot solve the stale-mirror issue. No user-authorized implementation choice remains for that separate display/data-cleanup topic.

## Allowed files

- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `electron/main/favoriteRepositorySyncService.test.ts`
- Modify: `docs/requirement-ledgers/2026-09-09-favorite-library-duplicate-names.md`
- This plan: `docs/superpowers/plans/2026-09-09-batch-managed-folder-deletion-pacing.md`

## Task 1: Prove the missing deletion pacing

**Files:**

- Modify: `electron/main/favoriteRepositorySyncService.test.ts` near the managed remote folder deletion tests.

- [x] **Step 1: Add a failing three-folder test.**

  Create three bound physical shards (`music`, `game`, `life`) and a page bridge whose inventory contains the same three exact remote IDs. Inject `sleep` and a deterministic `random: () => 0`; collect a shared `events` list in `deleteFolder` and `sleep`. Assert a successful deletion invokes:

  ```ts
  expect(events).toEqual([
    'delete:remote-music', 'sleep:1200',
    'delete:remote-game', 'sleep:1200',
    'delete:remote-life'
  ])
  ```

  The test proves two things: every Bilibili delete still uses its exact pre-verified ID, and an interval occurs only between actual remote writes.

- [x] **Step 2: Run the focused test and confirm RED.**

  Run:

  ```powershell
  npm test -- electron/main/favoriteRepositorySyncService.test.ts -t "paces confirmed managed-folder deletes"
  ```

  Expected before the implementation: the test fails because `events` contains consecutive `delete:*` entries and no `sleep:*` entries.

## Task 2: Pace only consecutive Bilibili folder deletion writes

**Files:**

- Modify: `electron/main/favoriteRepositorySyncService.ts` in `deleteManagedRemoteFoldersWithBridge`.

- [x] **Step 1: Add a local counter for successful actual remote delete requests.**

  Keep `missing-remote` candidates as a local confirmation only; they do not make a Bilibili write and must not trigger a wait. Immediately before the second and each later `bridge.deleteFolder` call, invoke the existing `await this.sleep(completedRemoteDeleteCount)`.

- [x] **Step 2: Increment the counter only after a remote deletion is confirmed.**

  Increment after a normal `status: 'ok'` return, and after the existing exact-ID reconciliation confirms absence. Do not increment or continue after `failed` or `result-unknown` results; retain the current immediate return and never repeat that deletion request.

- [x] **Step 3: Run the focused test and confirm GREEN.**

  Run the command from Task 1. Expected: one passing test and no real network request; the fake clock seam receives two 1,200 ms waits.

## Task 3: Protect established deletion behavior

**Files:**

- Modify: `electron/main/favoriteRepositorySyncService.test.ts` only if an assertion is needed to explicitly preserve the unknown-result stop.

- [x] **Step 1: Run all service tests.**

  ```powershell
  npm test -- electron/main/favoriteRepositorySyncService.test.ts
  ```

  Expected: all service tests pass, including the existing assertion that an unknown second deletion leaves the third ID in `unattemptedRemoteFolderIds`.

- [x] **Step 2: Run static/build validation.**

  ```powershell
  npm run build
  git diff --check
  ```

  Expected: both exit with code 0.

## Task 4: Record verification and commit

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-09-favorite-library-duplicate-names.md`

- [x] **Step 1: Append R011 implementation evidence.**

  Record the actual source lines, the focused and service-test commands, build result, and the remaining real-Electron limitation: the implementation can be tested against mocks but must not perform a destructive live Bilibili batch just for verification.

- [x] **Step 2: Review the final scope.**

  Run:

  ```powershell
  git status --short
  git diff --stat
  git diff --check
  ```

  Verify that only the four allowed files changed.

- [x] **Step 3: Commit the audited batch.**

  ```powershell
  git add electron/main/favoriteRepositorySyncService.ts electron/main/favoriteRepositorySyncService.test.ts docs/requirement-ledgers/2026-09-09-favorite-library-duplicate-names.md docs/superpowers/plans/2026-09-09-batch-managed-folder-deletion-pacing.md
  git commit -m "fix: pace batch favorite folder deletion"
  ```

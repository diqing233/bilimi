# Recommendation Unbacked Backup Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an account-saved recommendation rule behave exactly like a normal new favorite folder for backup eligibility while keeping pure remote observation drafts excluded, exact-ID binding failures fail closed, and deleted recommendation IDs permanently suppressed across refresh and recovery paths.

**Architecture:** Keep `ruleOrigin` as recommendation linkage metadata only. Centralize the distinction between account-saved rules and pure remote observation drafts at the favorite-ledger API boundary, and pass one complete exact-ID coverage/suppression set through status, ensure, save, scan recovery, account reopen, and workspace projection. Reuse the existing binding and deletion transactions; do not add recommendation-specific UI or remote operations.

**Tech Stack:** TypeScript, React renderer, Electron main-process IPC, Vitest, existing favorite repository/coordinator services.

---

### Task 1: Capture the failing backup-eligibility regression

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts` (or the existing test file that exercises `buildEnsureFavoriteLedgersScript` / `buildSaveFavoriteLedgersScript`)
- Test fixtures: existing favorite-ledger script fixtures in the same test file

- [x] **Step 1: Write the failing test**

Add a focused test with two ledger records in one account: a saved recommendation rule with `ruleOrigin: 'recommendation-draft'`, `syncState: 'local-draft'`, `bindingState: 'unbacked'`, and a pure remote observation draft with `syncState: 'local-draft'`, `bindingState: 'unbound'`, no `ruleOrigin`, and a remote `folderId`. Assert that the generated ensure/save script includes the saved recommendation in the ordinary create/backup target and excludes only the pure observation draft.

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts -t "backs up saved recommendation local-draft rules but excludes pure remote observations" --silent`

Expected: FAIL because the current script skips every `syncState === 'local-draft'` record.

### Task 2: Implement the minimal pure-observation predicate and backup routing

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] **Step 1: Add the smallest predicate at the existing script boundary**

Implement/reuse a predicate that returns true only for a pure remote observation (`local-draft`, `unbound`, no saved recommendation origin, no user configuration, and an exact remote folder ID). Replace blanket `syncState === 'local-draft'` skips in ensure/save target calculation and creation loops with this predicate. Leave ordinary saved rules, including recommendation-origin local drafts, on the normal create/backup path.

- [x] **Step 2: Run the focused test**

Run the Task 1 command. Expected: PASS with no Bilibili operation invoked for the pure observation fixture.

- [x] **Step 3: Run adjacent favorite-ledger API tests**

Run: `npm.cmd test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts --silent`

Expected: PASS; existing ordinary-rule, bound-rule, malformed-list, and zero-write tests remain green.

### Task 3: Reproduce and fix exact-ID binding mismatch before backup

**Files:**
- Modify: `src/renderer/src/App.tsx` and the existing backup target projection helper in `src/renderer/src/features/favorites/favoriteLedgerApi.ts` only if required by the failing test
- Test: existing App/favorite-ledger backup tests

- [x] **Step 1: Write the failing mismatch test**

Construct a saved recommendation rule whose local repository has a formal `bound` shard for exact `remoteFolderId = A`, while the current authoritative Bilibili directory contains no `A`. Assert that invoking backup does not open a rename/claim path, does not create or rename another folder, and returns the existing refresh/fail-closed result. A fixture with no formal shard must still enter ordinary unbacked creation.

- [x] **Step 2: Run the test to verify RED**

Run the focused App/backup test. Expected: FAIL because stale physical-shard projection currently feeds the rename preflight despite the missing exact remote ID.

- [x] **Step 3: Implement the minimal exact-ID gate**

Before the existing rename/claim/create dispatch, distinguish: (a) exact formal bound shard present in the current remote list, (b) no formal shard and unbacked account rule, and (c) stale formal shard absent from the current remote list. Route (a) through the existing rename transaction, (b) through ordinary create/backup, and (c) to the existing fail-closed refresh error without name-based rebinding. Do not alter confirmation text or ordinary favorite behavior.

- [x] **Step 4: Run adjacent tests**

Run the existing App and favorite-ledger backup test files. Expected: PASS, including ordinary bound rename and ordinary unbacked creation cases.

### Task 4: Add deletion tombstone coverage to every recovery/projection path

**Files:**
- Modify: `electron/main/favoriteLibraryManagedFolderProjection.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/index.ts` only for argument threading already used by these paths
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts` only for status/ensure/save suppression threading
- Tests: `electron/main/favoriteLibraryManagedFolderProjection.test.ts`, `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`, existing favorite-ledger IPC/API tests

- [x] **Step 1: Write failing tombstone tests**

For one saved recommendation rule deleted through the existing local deletion path, seed its exact remote ID in `deletedFavoriteLedgerRecords` and assert all of the following stay absent: recovered physical/logical shard candidates, `repair-persisted-managed-bindings`, `saveRecoveredLedgerDrafts`, status/ensure/save remote observation drafts, account-reopen projection, and a second organization scan. Add a same-title/different-ID fixture and assert the different ID remains observable.

- [x] **Step 2: Run the tests to verify RED**

Run the focused projection/coordinator/API tests. Expected: FAIL where recovery currently ignores the suppression set or where save/ensure merges a deleted ID back into local ledgers.

- [x] **Step 3: Thread one exact-ID suppression set**

Filter recoverable candidates before they are converted into bindings or repair commands; pass the same suppression set into `finishScan`, `reconcilePendingBindingsFromRemote`, status, ensure, save, and account-open projection. Treat saved recommendation deletions as permanent tombstones, separate from the temporary pure-observation rediscovery pending that explicit backup may consume. Apply a final exact-ID guard before `mergeBackupResultIntoLocalLedgers`.

- [x] **Step 4: Run focused recovery tests**

Run the Task 4 test files. Expected: PASS, with same-title different-ID behavior unchanged and no Bilibili delete/create calls.

### Task 5: Verify stable second-round recommendation linkage and local-only interaction boundaries

**Files:**
- Modify: no renderer interaction code unless a failing regression identifies a direct linkage bug
- Tests: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx` and relevant recommendation/workspace tests

- [x] **Step 1: Add/confirm failing cross-round test**

Seed a first-round saved recommendation rule with a stable rule ID and `enabled: true`, reopen a second preview workspace with the same candidate ID, and assert both projections start checked and no duplicate rule is created. Assert toggling/refresh invokes only local account/workspace persistence and preserves `scrollTop`.

- [x] **Step 2: Run RED, then make the smallest linkage/suppression adjustment**

Run the focused test and only adjust the existing stable-ID mapping or stale-result guard if it fails. Do not redesign deletion or add new recommendation commands.

- [x] **Step 3: Run focused renderer tests**

Run the recommendation panel and overview test files. Expected: PASS; ordinary favorites and existing delete/backup flows remain green.

### Task 6: Full verification and branch handoff (no merge)

**Files:**
- Update: `docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md` with I026 implementation locations and per-test/electron evidence

- [x] **Step 1: Run required verification**

Run, in order:

```powershell
npm.cmd test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/favoriteLibraryManagedFolderProjection.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts --silent
npm.cmd test -- --silent
npm.cmd run build
git diff --check
git status --short
```

Expected: focused and full suites exit 0, build exits 0, diff check has no whitespace errors, and only this plan/project-book/ledger plus recommendation implementation/tests are changed.

- [x] **Step 2: Perform available Electron checks**

In the development Electron build, verify mouse movement, click, scroll, resize, minimize, restore, and close remain responsive; verify recommendation backup only writes Bilibili after the existing explicit backup confirmation; verify second-round checked-state relink and deletion/reopen non-resurrection with a disposable development account. If real-account actions cannot be safely executed, record them as “已实施待真实验证” rather than claiming completion.

> 本轮已完成开发版可用的只读观察与自动化回归；真实账号的勾选、三种删除分流、第二轮整理重开以及窗口连续响应仍需在用户确认的 Electron 验收环境中执行，故保持“已实施待真实验证”。

- [x] **Step 3: Update ledger and commit the branch**

Append exact code locations, RED/GREEN commands, Bilibili spy results, and any unverified Electron conditions to I026. Commit all in-scope files on `codex/recommendation-unbacked-backup-fix` with message `fix: align recommendation backup lifecycle`.

- [ ] **Step 4: Stop and wait for explicit merge instruction**

Report the branch name, commit, verification evidence, and remaining real-Electron gaps. Do not merge, push, rebase, delete the worktree, or modify root `main` until the user explicitly says “合并”.

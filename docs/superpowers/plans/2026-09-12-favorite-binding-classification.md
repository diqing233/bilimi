# Favorite Binding Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让缺失的旧正式绑定回到现有“未绑定→重新绑定”流程，让无本地规则的 B 站 bilimi 收藏夹继续走现有草稿发现流程，同时保留真实清单/凭据失败的 fail-closed 保护。

**Architecture:** 扩展精确远端 ID 预检结果，明确区分“远端 ID 不存在”和“预检不可验证”。前者不再触发名称核验错误，并过滤掉失效的正式分册，让上层复用现有 `unboundCandidates`、重新绑定弹窗和 `remoteObservations` 草稿流程；后者保持现有错误返回。显式重新绑定提交时，备册脚本允许替换失效的历史正式 ID。

**Tech Stack:** React/Electron renderer, TypeScript, Vitest, existing Bilibili page-script bridge.

---

### Task 1: Add regression tests for missing-vs-unavailable exact binding preflight

**Files:**
- Modify: `src/renderer/src/App.test.tsx:4762-4814`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts` near formal rename preflight tests

- [x] **Step 1: Write the failing App integration test**

Add a `save-ledgers` test with a formally bound `game` ledger whose exact old remote ID is absent from the current status projection, while the current inventory exposes a same-name candidate. Make the rename preflight script return `ok: false, verified: true, missingRemoteFolderIds: ['old-game']`; make the status script return `unboundLedgerIds: ['game']` and one `unboundCandidates` entry. Assert the result is the existing remote-observation preflight result with `ok: false`, `unboundLedgerIds: ['game']`, the candidate, and no `名称核验失败` message or write script.

- [x] **Step 2: Write the failing preflight-script test**

Add a test that evaluates `buildFormalBoundFavoriteRenamePreflightScript([{ remoteFolderId: 'missing' }])` against a directory without that ID and asserts the result carries `verified: true` plus `missingRemoteFolderIds: ['missing']`. Keep the existing `verified: false` fail-closed test unchanged.

- [x] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run src/renderer/src/App.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.test.ts --reporter=dot
```

Expected: the new assertions fail because the script has no missing-ID classification and `App.tsx` returns the generic name-verification error.

### Task 2: Classify missing remote IDs without weakening fail-closed errors

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts:552-603`
- Modify: `src/renderer/src/App.tsx:2144-2190, 3265-3375, 3570-3648, 3650-3688`

- [x] **Step 1: Add an explicit missing-ID field to the page script**

When the exact folder lookup misses, return `verified: true`, `observedShards: []`, and `missingRemoteFolderIds: [shard.remoteFolderId]`. Do not use this field for malformed responses, missing credentials, API errors, or invalid member counts.

- [x] **Step 2: Return a discriminated result from the renderer reader**

Change `readBoundRenameCandidatesForTargets()` so a verified response with `missingRemoteFolderIds` returns the existing formal shard list with those IDs removed plus the normalized missing-ID list; continue returning `undefined` for all unverified/invalid responses. This lets callers distinguish a deleted/stale remote folder from a page or credential failure.

- [x] **Step 3: Keep existing observations and rebind candidates authoritative**

In `ensureFavoriteLedger()` and `syncFavoriteLedgers()`, treat the missing-ID result as a non-error. Use the filtered observed formal shards for rename-candidate calculation and remove the missing IDs from the declared-bound map before invoking the existing rename helper. In the `remoteObservationPreflight` branch, return the already-read `observationStatus` fields (`unboundLedgerIds`, `unboundCandidates`, and `remoteObservations`) unchanged so the current UI opens the rebind or draft dialog.

- [x] **Step 4: Preserve fail-closed behavior for unavailable preflight**

Leave the current generic name-verification failure for `undefined` results and for explicit rename confirmation whose exact IDs cannot be verified. No Bilibili mutation may run in those paths.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run the Task 1 command. Expected: the new missing-ID tests pass, and the existing unavailable-preflight test still expects the generic fail-closed message.

### Task 3: Allow an explicit rebind to replace a stale formal ID

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts:714-731, 782-797, 922-1001`
- Modify: `src/shared/types.ts:114-117` only if the existing `buildEnsureFavoriteLedgersScript` option type needs the already-supported `rebindRemoteFolders` field
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts` near lines 775-798 and 1573-1593

- [x] **Step 1: Write the failing explicit-rebind test**

Add a save-script test where the input rule still carries stale formal ID `old`, the current directory contains only `new` with the same logical title, and the options explicitly select `new` through `rebindRemoteFolderIds` and `rebindRemoteFolders`. Assert the script does not return the stale-formal-binding error and returns the selected ID as bound. Add the equivalent ensure-script assertion if the compatibility path accepts the same options.

- [x] **Step 2: Run the new tests and verify RED**

Run:

```powershell
npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts --reporter=dot
```

Expected: the script returns before `syncLedgerFolderIds()` because the stale formal ID guard runs before the explicit selection is applied.

- [x] **Step 3: Implement the narrow bypass**

Include `rebindRemoteFolders` in the ensure-script payload options. Define a local `hasExplicitRebindSelection(ledgerId)` predicate in both page scripts that checks either an exact selected ID or a non-empty selected-folder list. Exclude only those explicitly selected ledger IDs from `staleFormalBindingLedgerIds`; leave all ordinary backups fail-closed.

- [x] **Step 4: Run the focused favorite API tests and verify GREEN**

Run the Task 3 command. Expected: explicit replacement passes; the existing stale formal binding safety test without explicit selection remains unchanged and passes.

### Task 4: Full regression, ledger evidence, and release handoff

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-12-dev-binding-title-verification-failure.md`

- [x] **Step 1: Run all relevant automated tests**

Run:

```powershell
npx vitest run src/renderer/src/App.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot
npm test
```

Expected: all tests pass; existing React `act(...)` warnings may remain documented, but no new warning or failure is accepted.

- [x] **Step 2: Update the R001–R003 index with evidence**

Record the final code locations, the missing-ID regression test, the retained fail-closed test, and the existing rebind/draft UI test evidence separately for each confirmed requirement. Mark each as `已实施待验证` until the development UI check is complete.

- [ ] **Step 3: Perform the required UI acceptance in the Electron development build**

Exercise one local rule with a missing old formal ID and a same-name remote folder: the panel must show `未绑定`, the backup action must open the existing rebind confirmation, and no Bilibili write occurs before confirmation. Exercise one bilimi remote folder with no local rule: the existing discovery dialog must identify it as a draft/observation and preserve the current confirmation flow. Exercise an unavailable exact-ID preflight: the existing fail-closed error must still appear.

- [x] **Step 4: Check the worktree before commit**

Run:

```powershell
git status --short
git diff --stat
git diff --check
```

Confirm only this task's renderer/script tests, requirement ledger, and plan are changed; then create one local commit on `main`. Do not push, merge, rebase, package, or delete any workspace.

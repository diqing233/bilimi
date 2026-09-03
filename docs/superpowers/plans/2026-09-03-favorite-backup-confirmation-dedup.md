# Favorite Backup Confirmation & Draft Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish an explicitly confirmed Bilibili rename/binding on its first click, and prevent a formally bound remote folder from reappearing as a remote-observation draft during any later refresh.

**Architecture:** The main-process binding service remains the sole writer for an explicit exact-ID adoption. It gains a longer but finite, awaited inventory confirmation window. Renderer script builders receive the full account-level remote-ID coverage set on every read/ensure/save path, while pure remote-observation identification becomes structural instead of title-prefix based; saved or edited local rules remain protected.

**Tech Stack:** TypeScript, Electron IPC, React renderer, Vitest, Bilibili page-script bridge.

---

## Confirmed requirement coverage

- R012 / I010: exact-ID rename success must commit the formal physical shard and close the confirmation on the first click; post-adoption projection failure cannot masquerade as remote binding failure.
- R013 / I011: every refresh path must suppress and structurally reconcile a historical pure remote-observation draft when its exact remote ID is formally bound; unknown IDs remain visible once.
- R008 / I007: all new waiting stays in the existing async remote-operation boundary and yields between reads; no startup/input/window behavior changes.

### Task 1: Document the finalized contract

**Files:**

- Modify: `docs/项目功能项目书.md:697-706`
- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`

- [x] **Step 1: Add the project-book constraints before code changes**

Add clauses that require exact-ID, bounded post-rename confirmation plus formal binding commit; require every renderer projection entry point to receive full account coverage and structurally remove only pure observation drafts sharing a bound exact ID.

- [x] **Step 2: Record I010/I011 implementation scope**

Keep R012/R013 original text untouched. Update their index entries only after tests and real validation evidence are available.

### Task 2: Give explicit rename confirmation enough bounded time

**Files:**

- Modify: `electron/main/favoriteRepositoryBindingService.ts:195-315`
- Test: `electron/main/favoriteRepositoryBindingService.test.ts:790-834`

- [x] **Step 1: Write the failing delayed-mirror test**

```ts
it('confirms an explicitly renamed shard after a delayed exact-id inventory mirror', async () => {
  // Before the fix the rename verification reads only three times and rejects.
  // The mock returns the old title until the fourth post-rename read, then the target title.
  await expect(service.adoptExistingPhysicalShard('100', input)).resolves.toMatchObject({
    shards: [expect.objectContaining({ remoteFolderId: 'life-1', bindingState: 'bound' })]
  })
  expect(renameFolder).toHaveBeenCalledOnce()
  expect(readFolderInventory).toHaveBeenCalledTimes(5) // initial exact-ID read + 4 verification reads
})
```

- [x] **Step 2: Run the test and confirm the expected RED failure**

Run: `npx vitest run electron/main/favoriteRepositoryBindingService.test.ts -t "delayed exact-id inventory mirror"`

Expected: FAIL with `Favorite repository remote shard rename is not confirmed.` because the current three verification reads end before the mock publishes the new title.

- [x] **Step 3: Implement the minimal bounded retry schedule**

Replace the rename-verification delay literal with a named finite schedule including one additional later read (for example `[0, 250, 750, 1500]`). Keep `await waitForInventoryRetry(delayMs)` inside the existing remote operation; inspect only `normalized.remoteFolderId`; issue no second rename.

- [x] **Step 4: Run binding-service regressions**

Run: `npx vitest run electron/main/favoriteRepositoryBindingService.test.ts`

Expected: PASS, including exact-ID absence, account mismatch, ordinary no-rename, and existing short-delay rename tests.

### Task 3: Keep post-adoption projection from rejecting a committed binding

**Files:**

- Modify: `electron/main/favoriteRepositoryIpc.ts:509-533`
- Test: `electron/main/favoriteRepositoryIpc.test.ts:58-81`

- [x] **Step 1: Write the failing IPC test**

```ts
it('returns a committed exact-ID adoption when the later projection notification fails', async () => {
  adoptExistingPhysicalShard.mockResolvedValue({ logicalLedgerId: 'music' })
  onLedgerBindingAdopted.mockRejectedValueOnce(new Error('projection refresh unavailable'))

  await expect(ipcMain.invoke('favorite-repository:adopt-ledger-binding', 7, '100', input))
    .resolves.toEqual({ logicalLedgerId: 'music' })
})
```

- [x] **Step 2: Run the test and confirm the expected RED failure**

Run: `npx vitest run electron/main/favoriteRepositoryIpc.test.ts -t "later projection notification fails"`

Expected: FAIL with `projection refresh unavailable` because the current IPC handler awaits the post-commit notification as part of the adoption request.

- [x] **Step 3: Isolate the post-commit refresh failure**

After `adoptExistingPhysicalShard` resolves, invoke `onLedgerBindingAdopted` in a `try/catch` that preserves the successful adoption result. Do not suppress an adoption-service failure and do not run an additional remote operation.

- [x] **Step 4: Run IPC regressions**

Run: `npx vitest run electron/main/favoriteRepositoryIpc.test.ts`

Expected: PASS, including the existing requirement that notification is not called when adoption itself rejects.

### Task 4: Structurally reconcile formal-ID observation drafts and pass coverage everywhere

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts:299-430,434-473,577-668`
- Modify: `src/renderer/src/App.tsx:1982-2026,2150-2171,2286-2315`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts:881-934`
- Test: `src/renderer/src/App.test.tsx:3256-3310`

- [x] **Step 1: Write the failing projection tests**

```ts
it('removes an unedited non-prefixed observation draft that repeats a formally bound exact ID', async () => {
  const result = await window.eval(buildFavoriteLedgerStatusScript([
    boundLedger('4080598611'),
    remoteObservationDraft({ id: 'custom-remote-4080598611', displayName: '生活日常哈哈', folderId: '4080598611' })
  ]))
  expect(result.ledgers).toEqual([expect.objectContaining({ id: 'life', bindingState: 'bound' })])
})

it('keeps an edited non-prefixed local rule even when another rule is bound to the same ID', async () => {
  const result = await window.eval(buildFavoriteLedgerStatusScript([
    boundLedger('4080598611'),
    remoteObservationDraft({ id: 'saved-life', displayName: '生活日常哈哈', folderId: '4080598611', ruleOrigin: 'saved-rule' })
  ]))
  expect(result.ledgers.map((ledger) => ledger.id)).toEqual(expect.arrayContaining(['life', 'saved-life']))
})
```

- [x] **Step 2: Run the projection tests and confirm RED**

Run: `npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts -t "non-prefixed"`

Expected: first test fails because `appendRemoteOnlyDrafts` currently requires a `bilimi`-prefixed display title to classify the legacy draft as an observation.

- [x] **Step 3: Implement the smallest structural observation predicate**

Define the predicate inside `sharedScriptHelpers()` from: `syncState === 'local-draft'`, `bindingState === 'unbound'`, exactly one exact remote ID, `ruleOrigin !== 'saved-rule'`, not enabled, and no non-blank keyword. Use it consistently for normalization, bound-ID removal, and `remoteOnlyDraftLedgerIds`. Do not infer identity from a title prefix. Keep multi-ID, edited, enabled, keyword-bearing, member/placement-bearing records intact.

- [x] **Step 4: Pass full coverage to status and ensure scripts**

Extend `buildFavoriteLedgerStatusScript` with `remoteDraftKnownFolderIds`; extend the ensure-script option pick/payload and both initial/recheck calls. In `App.tsx`, destructure `remoteDraftKnownFolderIds` from `projectFavoriteLedgersToFormalBindings(accountMid, targetLedgers, fullAccountLedgers)` and pass it to status, account-wide ensure, and single-ledger ensure. Keep the remote write target limited to the original target ledger(s).

- [x] **Step 5: Add caller coverage tests**

```ts
expect(payload.remoteDraftKnownFolderIds).toEqual(['bound-other', 'life-1', 'pending-other'])
expect(script).toContain('"ledgers":[{"id":"life"')
expect(script).not.toContain('"id":"other"')
```

Cover status and single-ledger ensure in addition to the existing save test. Ensure coverage is payload-only, never a remote-write option.

- [x] **Step 6: Run renderer regressions**

Run: `npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx`

Expected: PASS; unknown exact IDs still project once, and a single-target backup still excludes non-target ledgers from its write payload.

### Task 5: Validate, document evidence, and commit the single discussion round

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`

- [x] **Step 1: Run static and full verification**

Run: `git diff --check && npm test && npm run build`

Expected: each command exits 0. Store complete command output under `.codex-artifacts/`. Final evidence: `git diff --check` clean; `npm test` exit 0 with 246 files / 4293 tests (`.codex-artifacts/favorite-backup-rename-final-full-test-20260903-2236.log`); `npm run build` exit 0 (`.codex-artifacts/favorite-backup-rename-final-build-20260903-2242.log`).

- [ ] **Step 2: Run real Electron development validation**

Partial validation only: in the logged-in development app, opening 掌库 refreshed the account and showed all 9 current folders as 已备册 with no 未保存·未绑定 cards; Bilibili-page scrolling and drawer clicks remained responsive. This account had no title-drift binding candidate, and no recommendation toggle was changed solely for testing, so first-click rename confirmation and the recommendation-triggered refresh remain pending. Resize, minimize, restore, and close were not claimed as validated.

Use the existing logged-in development app to validate: (a) an explicit exact-ID rename changes the Bilibili title and closes the confirmation on the first click; (b) toggling a recommendation does not reintroduce the same bound remote IDs as unsaved cards; (c) mouse movement, click, scroll, resize, minimize, restore, and close remain responsive while the confirmation waits. Do not claim this step if login/session state prevents it.

- [x] **Step 3: Update I010/I011 evidence and final ledger state**

Record exact code paths, named tests, command logs, observed UI result, and any unavailable real-account verification. Preserve all R001-R013 original text. I001/I002 now also cite the non-`bilimi`-prefix exact-ID regressions; I009/I011 cite the legacy-summary RED/GREEN compatibility evidence and final full-test/build logs.

- [x] **Step 4: Check scope and commit**

Run: `git status --short && git diff --stat && git diff --check`.

Commit only the project book, requirement ledger, plan, code, and tests for this topic:

```powershell
git add docs/项目功能项目书.md docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md docs/superpowers/plans/2026-09-03-favorite-backup-confirmation-dedup.md electron/main/favoriteRepositoryBindingService.ts electron/main/favoriteRepositoryBindingService.test.ts electron/main/favoriteRepositoryIpc.ts electron/main/favoriteRepositoryIpc.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx
git commit -m "fix: finalize backup rename binding"
```

Final scope check was clean and the single discussion-round commit was created locally on `main`.

## Plan self-review

- I010 is covered by Tasks 2 and 3: delayed exact-ID confirmation, formal commit, and non-blocking projection notification.
- I011 is covered by Task 4: full coverage propagation and structural historical-draft reconciliation, preserving edited rules and unknown IDs.
- R008 responsiveness is covered by Task 2's existing awaited queue boundary and Task 5's real Electron validation.
- No task changes the unrelated “收藏夹规则分析失败” symptom, recommendation semantics, deletion, video synchronization, or automatic Bilibili writes.

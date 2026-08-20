# 一键备册与批阅目标级写入 Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Every production change follows a verified RED → GREEN cycle; do not stage the unrelated `2026-08-20-deepseek-auto-summary-not-triggered.md` ledger.

**Goal:** Restore one-click backup for selected local folders, formally adopt a newly created replacement even after a local-only default deletion, include selected remote-only drafts in the existing guarded Bilibili deletion path, and make review classify from every enabled saved rule while writing Bilibili only to a target that is actually backed up and bound.

**Architecture:** The renderer keeps two explicit target sets for review: a local suggestion set from all enabled, saved rules, and a remote write set from the same ranking restricted to formally bound rules. If the suggestion is not remotely writable, the best matching bound rule is used; if none matches, the bound `inbox` (`暂存`) fallback is the only permitted write target. Bilibili write authorization checks only the final target set plus fresh target-specific status evidence, never unrelated account-level gaps.

**Tech Stack:** TypeScript, React 19, Electron renderer bridge, Vitest, Testing Library, existing Bilibili page API scripts.

---

## Confirmed requirements and exclusions

| Ledger refs | Decision | Boundary |
| --- | --- | --- |
| R001, R002, R005 | The selected saved local folders run as one-click backup. Missing same-name remote folders create and bind directly; only actual unbound remote candidates open the existing binding-confirmation UI. Remote discovery still produces separate drafts. | Do not change the single-current-folder backup flow. |
| R003, R004 | Remote-only drafts remain unsaved/unbound and never classify. Every saved, enabled rule, including an unbound one, remains a local classification candidate. | Enabling or classifying must not create, bind, rename, move, or delete remote folders. |
| R003, R004 | Existing deletion of an unbound remote candidate remains available only in the existing “also delete from Bilibili” mode after both acknowledgements. | Do not broaden deletion, alter its consent wording, or delete in automated tests/Electron QA. |
| R024 | A default rule that retains a historical ID after local-only deletion must formally adopt the different ID returned by this backup's create response in the same operation. | Do not treat the old ID as authority, create a duplicate, or require unexplained second binding. |
| R025 | A selected `local-draft + unbound` remote-only draft with a real folder ID must appear in the existing Bilibili deletion preview and be deleted only after both acknowledgements. | The local-only draft deletion path remains local-only; never delete an unselected, missing, or merely name-similar remote folder. |
| R008–R012 | Local suggestion and actual remote target are separate. A remotely writable matching target wins; otherwise a backed/bound `暂存` receives the video. The result names both an unbacked suggestion and the actual target. | Never write, bind, or claim success for the unbacked suggestion; no write if there is no writable target. |
| R013 | The “最佳匹配” line shares the exact text metrics of the previous classification line. | Do not alter category selection, default-folder enablement, colors, spacing, or other card rows. |

## Target decision table

| Local best match | Other matching backed/bound rule | Backed/bound `暂存` | Bilibili write | Result feedback |
| --- | --- | --- | --- | --- |
| Backed/bound | Any | Any | Write the selected matching target(s). | Existing success wording. |
| Unbacked/unbound | Yes | Any | Write the highest-ranked matching backed/bound target(s). | State `预分类建议：X（未备册/未绑定）` and `已写入：Y`; never state that X was synchronized. |
| Unbacked/unbound | No | Yes | Write `暂存` only. | State `预分类建议：X（未备册/未绑定）` and `已写入：暂存`. |
| Unbacked/unbound | No | No | Do not write Bilibili or local confirmed membership. | Existing local-only feedback names the suggestion and requests backup/binding. |

## File map

| File | Responsibility in this change |
| --- | --- |
| `src/renderer/src/features/favorites/favoriteLedgerApi.ts` | Remove the all-batch create confirmation gate while keeping actual unbound candidates in the confirmation result. |
| `src/shared/favoriteLedgerCapabilities.ts` | Let a saved enabled unbound rule classify locally; retain remote-only-draft exclusion. |
| `src/renderer/src/features/recommendation/favoriteWriteTargetPlan.ts` | New pure target-selection boundary that derives local suggestions and remote write targets. |
| `src/renderer/src/App.tsx` | Consume the target plan, replace global status gating with target-only eligibility, pass the actual target to Bilibili and local confirmed registration, and prefix fallback feedback. |
| `src/renderer/src/App.test.tsx` | Reproduce a locally deleted default retaining an old ID whose same backup creates a different ID, then assert formal adoption and marker clearing happen once. |
| `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` | Merge selected remote-only drafts into the existing Bilibili deletion preview and retain failed/unknown draft projections. |
| `electron/main/favoriteRepositorySyncService.ts` and tests | Safely verify an explicit remote-draft `{ ledgerId, folderId, title }` by exact ID on both preview and execution, then reuse the existing acknowledgement and deletion result model. |
| `electron/main/oldFavoriteWorkspaceCoordinator.ts`, its IPC, preload and renderer types | Carry validated remote-draft targets through the existing deletion API without treating them as formal physical-shard bindings. |
| `src/renderer/src/features/assistant/MemorialPanel.tsx`, `src/renderer/src/styles.css` | Give the hint the same text class/metrics as the normal category line. |
| `docs/项目功能项目书.md`, `docs/requirement-ledgers/2026-08-20-one-click-backup-confirmation.md` | Record the final contract and per-requirement evidence. |

## Task 1: Define the two backup paths with failing tests

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] Add a batch-backup test for an enabled unbacked local rule with an empty Bilibili inventory. Assert the first all-batch call contains `/x/v3/fav/folder/add`, returns a bound ledger, and does not return an empty-candidate confirmation request.
- [ ] Preserve the existing unbound-candidate regression: a discovered remote candidate returns `unboundCandidates` and never adopts it until explicit selection.
- [ ] Run the focused tests and confirm the new direct-create assertion fails only because `confirmCreateAndBind` is still required.

## Task 2: Implement direct batch creation without weakening explicit binding

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [ ] In both all-batch script builders, return a confirmation result only for actual unbound remote candidates. Let an unbacked selected saved rule enter the existing create-and-bind loop.
- [ ] Keep the race recheck before creation: a remote candidate discovered after the first inventory read still returns an unbound confirmation instead of silently binding or creating a duplicate.
- [ ] Run the Task 1 focused tests; confirm direct creation passes and explicit unbound binding remains blocked until confirmation.

## Task 3: Test and implement local-suggestion/remote-write separation

**Files:**

- Modify: `src/shared/favoriteLedgerCapabilities.test.ts`
- Modify: `src/shared/favoriteLedgerCapabilities.ts`
- Create: `src/renderer/src/features/recommendation/favoriteWriteTargetPlan.ts`
- Create: `src/renderer/src/features/recommendation/favoriteWriteTargetPlan.test.ts`

- [ ] RED: assert a saved enabled `unbound` rule has `canClassify: true`, while `local-draft` stays non-classifiable.
- [ ] RED: assert the new target planner returns an unbacked best local suggestion plus a lower-ranked bound matching remote target; assert it selects bound `inbox` only when no bound match remains; assert it returns no remote targets when `inbox` is not bound.
- [ ] GREEN: make the smallest capability change and implement the pure planner using `planFavoriteArchiveTargets` twice (all saved enabled rules, then bound/write-ready rules). Export an explicit fallback reason so UI feedback can distinguish a normal target from `暂存`.
- [ ] Run the three focused target-planning suites and inspect that the initial RED cases passed only after the production change.

## Task 4: Send review writes only to the final target set

**Files:**

- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] RED: reproduce a video whose best enabled saved rule is unbacked while another matching rule is bound. Assert Bilibili API write and confirmed-review registration use only the bound rule even when `FavoriteLedgerStatus` reports unrelated missing/unbound IDs.
- [ ] RED: reproduce an unbacked best match with no bound match and a bound `inbox`; assert only `inbox` is written and feedback includes both `预分类建议：…（未备册）` and `已写入：暂存`.
- [ ] GREEN: use the pure planner after fresh status projection. Keep the pre-action DeepSeek branch unchanged: it remains eligible only when its directly selected local targets are writable. For normal review writes, authorize only the selected remote target IDs and target-specific conflicts; preserve no-write behavior on status read failure or when no write target exists.
- [ ] Ensure action execution, capacity checks, Bilibili API request, confirmed-review checkpoint/commit, pending inbox queue, and success text all receive the same actual target set. Keep local suggestion IDs for displayed preclassification and learning context.
- [ ] Run the App regressions together with `actionExecutor.test.ts`; confirm no Bilibili request is made in the no-writable-target case.

## Task 5: Lock the deletion boundary and visual equality

**Files:**

- Modify: `src/renderer/src/features/assistant/MemorialPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/styles.css`

- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`

- [ ] Add a rendered assertion that the best-match hint uses `memorial-panel__meta-detail` rather than a smaller dedicated typography class.
- [ ] Change the hint markup/class only; reuse the existing normal-detail rule for its 12px, inherited weight, and 1.45 line height.
- [ ] Run the existing unbound remote deletion tests unchanged to prove two acknowledgements are still required before an unbound name match reaches the main-process deletion call.

## Task 6: Formally bind a newly created replacement after local-only deletion

**Files:**

- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Extend the existing marker-clearing backup regression with a retained old ID.**

```ts
const music = { ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!,
  managedFolderDeletedByUser: true, bilibiliFolderId: 'old-music', bindingState: 'unbound' as const }
const returnedMusic = { ...music, bilibiliFolderId: 'new-music', bindingState: 'bound' as const }
// The backup script returns `returnedMusic`.
expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid,
  expect.objectContaining({ logicalLedgerId: 'music', remoteFolderId: 'new-music' }))
```

- [ ] **Step 2: Run the focused test and confirm RED.**

Run: `npx vitest run src/renderer/src/App.test.tsx -t "formally adopts a newly created replacement" --reporter=dot`

Expected before the implementation: the create result is persisted but `adoptFavoriteRepositoryLedgerBinding` was not called for `new-music`, because the old ID makes the current registration predicate false.

- [ ] **Step 3: Make the registration predicate compare actual IDs, not only ID presence.**

```ts
const inputRemoteFolderIdsByLedger = new Map(inputLedgers.map((ledger) => [ledger.id, new Set([
  ledger.bilibiliFolderId, ...(ledger.bilibiliFolderIds ?? [])
].filter((id): id is string => Boolean(id?.trim())).map((id) => id.trim()))]))

const isNewRemoteFolder = !inputRemoteFolderIdsByLedger.get(ledger.id)?.has(remoteFolderId)
if (selectedFolders.length || explicitlySelectedFolderId === remoteFolderId || isNewRemoteFolder) {
  // register the exact result folder as today
}
```

- [ ] **Step 4: Re-run the focused test and adjacent binding regressions.**

Run: `npx vitest run src/renderer/src/App.test.tsx -t "(formally adopts a newly created replacement|clears a default deletion marker|does not adopt an unbound remote candidate)" --reporter=dot`

Expected: all pass; the old ID never grants authority, a genuinely new create response is adopted once, and an actual unconfirmed remote candidate is still not adopted.

## Task 7: Include selected remote-only drafts in the guarded remote deletion plan

**Files:**

- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `electron/main/favoriteRepositorySyncService.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`

- [ ] **Step 1: Define exact remote-draft deletion targets and RED service coverage.**

```ts
type RemoteDraftDeletionTarget = {
  ledgerId: string
  remoteFolderId: string
  title: string
}

await expect(service.previewManagedFolderDeletion('100', ['music'], { music: 'bilimi·音乐' }, [
  { ledgerId: 'custom-remote-88', remoteFolderId: '88', title: 'bilimi·分无法' }
])).resolves.toEqual(expect.arrayContaining([
  expect.objectContaining({ logicalLedgerId: 'custom-remote-88', remoteFolderId: '88', state: 'unbound-name-match', requiresUnboundAcknowledgement: true })
]))
```

- [ ] **Step 2: Run the focused service test and confirm RED.**

Run: `npx vitest run electron/main/favoriteRepositorySyncService.test.ts -t "includes an exact selected remote draft" --reporter=dot`

Expected before the implementation: the service does not accept remote-draft targets, so the preview cannot produce the selected draft candidate.

- [ ] **Step 3: Extend preview and execution with exact-ID remote-draft verification.**

```ts
// At both preview and execute time, read the current inventory and require the exact ID.
const folder = foldersById.get(target.remoteFolderId)
if (!folder || !isBilimiRemoteFolder(folder.title) ||
    normalizedRemoteFolderTitle(folder.title) !== normalizedRemoteFolderTitle(target.title)) {
  throw new Error('remote-draft-deletion-preview-stale')
}
results.push({ logicalLedgerId: target.ledgerId, remoteFolderId: folder.id, title: folder.title,
  memberCount: folder.memberCount, state: 'unbound-name-match', requiresUnboundAcknowledgement: true })
```

- [ ] **Step 4: Thread targets through the existing trusted IPC and renderer plan.**

```ts
const remoteDraftTargets = selectedDrafts.map((ledger) => ({
  ledgerId: ledger.id, remoteFolderId: ledger.bilibiliFolderId!, title: ledger.displayName
}))
// Local-only scope passes no targets. Bilibili scope previews and deletes them with the existing acknowledgement boolean.
```

The renderer must remove only draft IDs whose exact remote IDs occur in `succeededRemoteFolderIds`; partial failures and stale verification keep their local projections. Existing bound-rule candidates, confirmation wording, and local-only draft deletion remain unchanged.

- [ ] **Step 5: Run renderer, IPC, and service regressions.**

Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/favoriteRepositorySyncService.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts --reporter=dot`

Expected: selected drafts appear in the Bilibili preview, the remote request carries their exact IDs only after both acknowledgements, local-only deletion makes no remote call, and partial failure retains only the failed draft.

## Task 8: Update the project contract, verify, and commit

**Files:**

- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-08-20-one-click-backup-confirmation.md`

- [ ] Update the backup section to say all-batch selected local folders create directly when no candidate exists, while only actual unbound candidates require selection. Record the two-target review rule and `暂存` fallback in the review and lifecycle sections.
- [ ] Update every applicable ledger index row with exact files, test command/results, and Electron visual status. Do not mark Bilibili remote creation/deletion as manually verified without authorization to perform it.
- [ ] Run `npx vitest run` for all modified suites and relevant deletion regression, then `npm test`, `npm run build`, `git diff --check`, `git diff --stat`, and `git status --short`.
- [ ] Launch the Electron development build for read-only UI verification: inspect one-click backup state without confirming a Bilibili mutation, inspect the review-card typography and the existing deletion acknowledgement dialog without pressing delete. Save screenshots under `.codex-artifacts/`.
- [ ] Stage only this plan, the current requirement ledger, project book, changed implementation and tests. Leave the DeepSeek ledger untracked. Create one local `main` commit; do not push, merge, rebase, package, or delete anything.

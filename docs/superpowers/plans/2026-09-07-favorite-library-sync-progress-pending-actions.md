# 收藏库同步进度、待处理与备册后操作收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让收藏库同步运行只轻量更新数字，待处理只显示真实异常，并使备册后的移动与本地删除按权威位置即时收敛。

**Architecture:** 保留现有同步队列、确认弹窗和收藏库数据模型。共享 reducer 负责把批量命令的人工调整语义传给每个位置更新；服务层在只读索引中以位置记录压过残留的 bilimi 成员；渲染器只轮询运行快照而不在运行中读完整摘要，并将完成提示保存在会话 UI 状态中。

**Tech Stack:** TypeScript、React 19、Electron IPC、Vitest、现有收藏仓库事件日志。

---

### Task 1: 固化备册后位置的权威投影

**Files:**
- Modify: `src/shared/favoriteRepository.test.ts`
- Modify: `src/shared/favoriteRepository.ts:1778-1820,2464-2474`
- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Modify: `electron/main/favoriteRepositoryService.ts:1777-1858`

- [x] **Step 1: Write the failing reducer test for a batched move after backup**

```ts
it('removes old logical and physical shard memberships for a batched backed-folder move', () => {
  // Bind game and knowledge physical shards containing aid 1, then move aid 1
  // with one set-favorite-placements command carrying adjustmentKind: local-move.
  expect(result.memberships['bilimi-logical:game']).not.toContain(1)
  expect(result.memberships['bilimi:game:001']).not.toContain(1)
  expect(result.memberships['bilimi-logical:knowledge']).toContain(1)
  expect(result.memberships['bilimi:knowledge:001']).toContain(1)
})
```

- [x] **Step 2: Run the reducer test and verify it fails because command-level `adjustmentKind` is not supplied to `applyPlacement`**

Run: `npm test -- src/shared/favoriteRepository.test.ts`

Expected: FAIL for the old game logical/physical memberships still containing aid `1`.

- [x] **Step 3: Propagate the batch adjustment kind to each position update**

```ts
for (const placement of command.payload.placements) {
  applyPlacement(command.payload.adjustmentKind
    ? { ...placement, adjustmentKind: command.payload.adjustmentKind }
    : placement)
}
```

Keep existing classification-audit recording untouched. Follow-up multi-shard validation showed that local deletion must retain its existing no-classification-adjustment contract, so its physical-membership cleanup is keyed to an actual local-position change rather than a synthetic adjustment kind.

- [x] **Step 4: Run the reducer test and verify it passes**

Run: `npm test -- src/shared/favoriteRepository.test.ts`

Expected: PASS.

- [x] **Step 5: Write the failing service test for historical stale membership**

```ts
it('uses a persisted local desired position instead of stale backed-folder memberships', async () => {
  // Create backed game/knowledge folders, persist a legacy non-explicit placement
  // to knowledge while memberships still contain game.
  await expect(service.getLibraryPage('100', { kind: 'folder', folderId: 'bilimi-logical:game' }, { limit: 10 }))
    .resolves.toMatchObject({ totalCount: 0, items: [] })
  await expect(service.getLibraryPage('100', { kind: 'folder', folderId: 'bilimi-logical:knowledge' }, { limit: 10 }))
    .resolves.toMatchObject({ totalCount: 1, items: [{ video: { aid: 1 } }] })
})
```

- [x] **Step 6: Run the service test and verify it fails with aid `1` still in game**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts`

Expected: FAIL because `createLibraryIndex` currently trusts the stale canonical membership table.

- [x] **Step 7: Apply a read-only position overlay in `createLibraryIndex`**

After indexing raw memberships, for every non-recycled video with `snapshot.positions[accountMid:aid]`:

```ts
const currentBilimiFolderIds = new Set(
  position.localDesiredFolderIds
    .map((folderId) => canonicalIdByRawId.get(folderId) ?? folderId)
    .filter((folderId) => folderId.startsWith('bilimi-logical:'))
)
// Delete aid from every currently indexed bilimi logical folder, then add it
// only to currentBilimiFolderIds. Leave ordinary Bilibili source memberships unchanged.
```

Update both `folderAidsByFolderId` and `folderIdsByAid` before they are converted to arrays; do not mutate the persisted snapshot.

- [x] **Step 8: Extend the reducer regression to multiple physical source shards, then run focused suites**

Run: `npm test -- src/shared/favoriteRepository.test.ts electron/main/favoriteRepositoryService.test.ts`

Expected: PASS, including removal from every old physical shard while adding only the existing target-shard projection.

### Task 2: Make 待处理 an exception-only scope

**Files:**
- Modify: `electron/main/favoriteRepositoryService.test.ts:1188-1212`
- Modify: `electron/main/favoriteRepositoryService.ts:2031-2038`

- [x] **Step 1: Change the existing pending-scope test to require exclusion of local-only and continuation state**

```ts
await expect(service.getLibrarySummary('100')).resolves.toMatchObject({ pendingAidCount: 2 })
await expect(service.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({
  items: [{ video: { aid: 3 } }, { video: { aid: 4 } }]
})
```

Add a `workspace.continuationAids: [2]` fixture and keep aid `2` as `local-only-change` plus a pending sync receipt to prove neither status enters the scope.

- [x] **Step 2: Run the targeted test and verify it fails**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts`

Expected: FAIL because the current actionable predicate includes `unsynced` and `continuation`.

- [x] **Step 3: Restrict the actionable predicate to actual exceptions**

```ts
const actionableStates = new Set<FavoriteRepositoryLibraryPageRow['pendingStates'][number]>([
  'failed', 'result-unknown'
])
return [...this.pendingStatesByAid(snapshot)]
  .filter(([aid, states]) => Boolean(snapshot.videos[String(aid)]) && [...states].some((state) => actionableStates.has(state)))
```

Keep `unsynced` in row details and status filtering; only the left `pending` scope and summary count change.

- [x] **Step 4: Run the focused service suite**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts`

Expected: PASS.

### Task 3: Lightweight progress and dismissible completion feedback

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx:706-758,1205-1258,2404-2428`

- [x] **Step 1: Write failing renderer tests for active progress and dismissing a completed run**

```tsx
expect(screen.getByRole('status')).toHaveTextContent('同步进度：1/2')
expect(screen.getByRole('status')).not.toHaveTextContent('正在处理')
expect(getFavoriteRepositorySnapshot).not.toHaveBeenCalled()

fireEvent.click(screen.getByRole('button', { name: '关闭同步完成提示' }))
expect(screen.queryByText('同步完成：2/2')).not.toBeInTheDocument()
expect(screen.getByText('远程状态待确认：操作失败或结果未知')).toBeInTheDocument()
```

Drive a `libraryPlacementRunProgress` subscription event while the mocked run remains `running`; then return a completed run with an unknown result for the dismissal assertion.

- [x] **Step 2: Run renderer tests and verify they fail**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: FAIL because the status currently includes `currentAid`, reads a complete snapshot for every checkpoint, and has no close control.

- [x] **Step 3: Keep active checkpoint handling lightweight**

```ts
if (change?.libraryPlacementRunProgress && runIsStillInProgress) {
  refreshPendingRef.current = false
  return
}
```

Retain the existing run-snapshot read and `setBatchSyncRun(nextRun)` before that branch. Remove the active-run `getFavoriteRepositorySnapshot`, `setSummary`, and reconciliation update. Render running/paused status as `同步进度：${completed}/${total}` plus only nonzero result counts.

- [x] **Step 4: Add session-only completion dismissal**

```ts
const [dismissedBatchSyncRunId, setDismissedBatchSyncRunId] = useState<string>()
// Reset the dismissal when setBatchSyncRun receives a different run id.
```

For completed/stopped runs, render `关闭同步完成提示` only when the current run id is not dismissed. The click handler sets only that id. Do not hide remote-reconciliation or generic exception feedback below the completion status.

- [x] **Step 5: Run renderer suite and build typecheck**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx && npm run build`

Expected: PASS.

### Task 4: Requirement traceability, integrated verification, and Electron acceptance

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-07-favorite-library-sync-progress-pending-actions.md`

- [x] **Step 1: Record code locations and automated evidence for I001–I006**

Mark only verified clauses as implemented. Keep the original R001/R002 text unchanged and record any Electron-only checks as pending until performed.

- [x] **Step 2: Run integrated checks**

Run: `npm test -- src/shared/favoriteRepository.test.ts electron/main/favoriteRepositoryService.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx && npm run build && git diff --check`

Expected: PASS with no whitespace errors.

- [ ] **Step 3: Perform real Electron development acceptance without user-data or B站 writes**

Use mocked/local fixture data only. Verify: while a test run advances, mouse movement, click, scroll, resize, minimize, restore, and close remain responsive; the progress label shows no AID; `待处理` contains only a failure/unknown fixture; a backed game-to-knowledge move and local delete immediately remove stale source membership and update target/count/detail; completion feedback closes while the unknown warning remains.

- [x] **Step 4: Re-read R001/R002 and index before commit**

Confirm every confirmed requirement has a code location and automated or interface evidence. Run `git status --short`, `git diff --stat`, and `git diff --check`; commit only this ledger, project book, plan, tests, and implementation under one local commit.

### Review follow-up: revision-bound action submission

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: Write a renderer regression for a move clicked after a repository revision signal but before its replacement page resolves**

The test holds the refreshed page promise, opens the batch move menu, and asserts no IPC mutation is dispatched against revision `1`.

- [x] **Step 2: Verify the refresh barrier resolves before the IPC command and re-reads the current selection**

After resolving the page/summary pair at revision `2`, assert a still-present row dispatches with revision `2`; assert a row removed by that same refresh never dispatches its old AID. The production path re-reads the current selection for batch move/copy, sync and B 站 bilimi 删除预览; refresh synchronizes summary/page/selected/detail refs before queued actions resume.

- [x] **Step 3: Run integrated checks**

Run: `npm test -- src/shared/favoriteRepository.test.ts electron/main/favoriteRepositoryBatchOperationService.test.ts electron/main/favoriteRepositoryService.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx && npm run build && git diff --check`

Expected: all focused suites and build pass; only the pre-existing `FloatingAssistantApp` chunk warning remains.

### Review follow-up: queued revisions, scope selection, and detail TOCTOU

- [x] **Step 1: Add failing regressions**

Cover two queued repository revisions during one refresh and preserve a select-all exclusion from another page.

- [x] **Step 2: Implement minimal guards**

Use notification epochs for the refresh barrier, re-read authoritative summary before mutation while a run/refresh is active, re-read current selection for scope operations, and validate detail snapshots after asynchronous reads.

- [x] **Step 3: Verify focused and full suites**

Focused favorite-library suites: 5 files, 404 tests passed. Full `npm test`: 249 files, 4460 tests passed. `npm run build` and `git diff --check` passed.

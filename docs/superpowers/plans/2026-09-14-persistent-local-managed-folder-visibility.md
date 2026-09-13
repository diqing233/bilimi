# 本地删除工作夹持久化可见性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复“仅从收藏库删除 bilimi 工作夹”后被摘要读取或 revision 通知立即重建的问题，同时保留后续明确业务动作恢复空工作夹的既有能力。

**Architecture:** 每个账号在 `FavoriteAccountPreferences` 中持久保存被用户本地隐藏的逻辑工作夹 ID。删除服务在仓库删除提交前写入该标记，普通收藏库读取始终将其传给空壳恢复器并排除；恢复器只在白名单业务命令成功后允许恢复，再仅清除实际已恢复的标记。该机制不使用 B 站读取、创建、改名、移动、同步或删除操作。

**Tech Stack:** Electron main process、TypeScript、Vitest、electron-store 偏好归一化、收藏库仓库快照。

---

## 文件结构

- `src/shared/types.ts`：账号级持久化偏好类型增加独立的本地工作夹隐藏 ID 字段。
- `electron/main/store.ts`：归一化、迁移并保留合法的隐藏 ID。
- `electron/main/managedFavoriteLedgerDeletionPersistence.ts`：原有右侧规则/远端删除投影保持不变；新增仅管理本地隐藏标记的原子写入与失败回滚辅助。
- `electron/main/favoriteRepositoryManagedFolderService.ts`：在本地仓库删除提交前调用标记写入，提交失败时只回滚本次新加 ID。
- `electron/main/favoriteLibraryManagedFolderProjection.ts`：支持排除隐藏逻辑 ID，并报告实际重新创建的空壳 ID。
- `electron/main/favoriteRepositoryEmptyManagedFolderRecovery.ts`：读取时排除持久化隐藏 ID；只对白名单的明确业务命令恢复并在成功后消费标记。
- `electron/main/index.ts`：注入账号偏好读写回调；不让任意仓库变化成为恢复信号。
- `docs/项目功能项目书.md`：补充第 6.7.8 条的“持久化隐藏标记、技术读取不可消费、成功业务动作才消费”实现约束。

### Task 1: 偏好字段与本地隐藏标记持久化

**Files:**
- Modify: `src/shared/types.ts:406-420`
- Modify: `electron/main/store.ts:183-215`
- Modify: `electron/main/store.test.ts:690-760`
- Modify: `electron/main/managedFavoriteLedgerDeletionPersistence.ts`
- Test: `electron/main/managedFavoriteLedgerDeletionPersistence.test.ts`

- [x] **Step 1: Write the failing preference and marker tests**

```ts
expect(loadFavoriteAccountPreferences(store, '100')).toMatchObject({
  hiddenFavoriteLibraryManagedLedgerIds: ['music']
})

const rollback = await persistLocalManagedFolderHiddenIds('100', ['music'], options)
await rollback()
expect(save.mock.calls.at(-1)?.[1].hiddenFavoriteLibraryManagedLedgerIds).toEqual([])
```

- [x] **Step 2: Run tests to verify RED**

Run: `npm test -- electron/main/store.test.ts electron/main/managedFavoriteLedgerDeletionPersistence.test.ts`

Expected: FAIL because `hiddenFavoriteLibraryManagedLedgerIds` and the persistence helper do not exist.

- [x] **Step 3: Implement the minimal preference and persistence behavior**

```ts
export type FavoriteAccountPreferences = {
  // existing fields
  /** Logical bilimi work folders locally hidden by an explicit library deletion. */
  hiddenFavoriteLibraryManagedLedgerIds?: string[]
}

// normalizer: deduplicate non-empty, valid logical IDs, sort, omit when empty
const nextIds = [...new Set([...currentIds, ...requestedIds])].sort()
const addedIds = nextIds.filter((id) => !currentIds.includes(id))
await save(accountMid, { ...current, hiddenFavoriteLibraryManagedLedgerIds: nextIds })
return async () => removeOnlyIdsStillAddedByThisCall(accountMid, addedIds)
```

The helper must not alter `favoriteLedgers`, `managedFolderDeletedByUser`, remote IDs, or B 站 state.

- [x] **Step 4: Run tests to verify GREEN**

Run: `npm test -- electron/main/store.test.ts electron/main/managedFavoriteLedgerDeletionPersistence.test.ts`

Expected: PASS.

### Task 2: 删除前写入标记并确保失败可回滚

**Files:**
- Modify: `electron/main/favoriteRepositoryManagedFolderService.ts:91-99,203-237`
- Test: `electron/main/favoriteRepositoryManagedFolderService.test.ts:560-680`

- [x] **Step 1: Write failing deletion-order tests**

```ts
const calls: string[] = []
const service = new FavoriteRepositoryManagedFolderService({
  repository: { /* commit pushes 'commit' */ },
  markLocalManagedFoldersHidden: async () => { calls.push('mark'); return async () => calls.push('rollback') }
})
await service.deleteLocal('100', preview.executionToken)
expect(calls).toEqual(['mark', 'commit'])

await expect(failingService.deleteLocal('100', token)).rejects.toThrow('disk unavailable')
expect(calls).toEqual(['mark', 'commit', 'rollback'])
```

- [x] **Step 2: Run test to verify RED**

Run: `npm test -- electron/main/favoriteRepositoryManagedFolderService.test.ts`

Expected: FAIL because the existing callback runs only after the repository commit.

- [x] **Step 3: Implement the minimal pre-commit marker protocol**

```ts
const rollbackHidden = await this.options.markLocalManagedFoldersHidden?.(
  normalizedAccount,
  operations.map((operation) => this.logicalLedgerId(operation.logicalFolderId))
)
try {
  await this.options.repository.commitWithAudit(/* existing command */)
} catch (error) {
  await rollbackHidden?.()
  throw error
}
```

Only `bilimi-logical:*` folders participate; `local:inbox` does not get a hidden marker. Retain the existing post-commit callback for the separate remote-deletion/right-side-rule behavior.

- [x] **Step 4: Run test to verify GREEN**

Run: `npm test -- electron/main/favoriteRepositoryManagedFolderService.test.ts`

Expected: PASS.

### Task 3: 持久化隐藏读取与明确业务恢复

**Files:**
- Modify: `electron/main/favoriteLibraryManagedFolderProjection.ts:310-397`
- Modify: `electron/main/favoriteRepositoryEmptyManagedFolderRecovery.ts`
- Test: `electron/main/favoriteLibraryManagedFolderProjection.test.ts`
- Test: `electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`

- [x] **Step 1: Write failing behavior tests**

```ts
await recovery.restoreForLocalRead('100')
expect(memory.current.folders).not.toEqual(expect.arrayContaining([
  expect.objectContaining({ id: 'bilimi-logical:music' })
]))
expect(consumed).not.toHaveBeenCalled()

await recovery.afterRepositoryActivity({ commandId: 'favorite-library:video:100:1:2:x' } as FavoriteRepositoryCommandResult)
expect(memory.current.folders).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: 'bilimi-logical:music' })
]))
expect(consumed).toHaveBeenCalledWith('100', ['music'])
```

Also cover a non-whitelisted revision command: it must neither restore nor consume the marker.

- [x] **Step 2: Run tests to verify RED**

Run: `npm test -- electron/main/favoriteLibraryManagedFolderProjection.test.ts electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`

Expected: FAIL because local reads currently consume a one-shot in-memory skip and arbitrary activity triggers restoration.

- [x] **Step 3: Implement the minimal recovery boundary**

```ts
async restoreForLocalRead(accountMid: string) {
  return this.restore(accountMid, await this.options.loadHiddenLedgerIds(accountMid))
}

async restoreForExplicitBusinessAction(accountMid: string) {
  const hiddenIds = await this.options.loadHiddenLedgerIds(accountMid)
  const restoredIds = await this.restore(accountMid, [])
  const recoveredIds = hiddenIds.filter((id) => restoredIds.includes(id))
  if (recoveredIds.length) await this.options.consumeHiddenLedgerIds(accountMid, recoveredIds)
}
```

`restoreEmptyFavoriteLibraryManagedFolderProjection` must take `excludedLogicalLedgerIds` and return every logical ID whose shell it actually creates. `afterRepositoryActivity` must only delegate to `restoreForExplicitBusinessAction` for known successful local commands from refresh, scan, backup, confirmed review, and organize-save paths; every other repository event is a no-op.

- [x] **Step 4: Run tests to verify GREEN**

Run: `npm test -- electron/main/favoriteLibraryManagedFolderProjection.test.ts electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`

Expected: PASS.

### Task 4: 主进程接线、项目书与回归验证

**Files:**
- Modify: `electron/main/index.ts:2550-2570,2683-2725,3220-3270`
- Modify: `docs/项目功能项目书.md:592`
- Modify: `docs/requirement-ledgers/2026-09-14-local-managed-folder-deletion-regression.md`
- Test: relevant tests from Tasks 1-3

- [x] **Step 1: Wire production callbacks and document exact boundary**

```ts
loadHiddenLedgerIds: (accountMid) =>
  loadFavoriteAccountPreferences(getDesktopStore(), accountMid).hiddenFavoriteLibraryManagedLedgerIds ?? [],
consumeHiddenLedgerIds: async (accountMid, ids) =>
  removePersistedLocalManagedFolderHiddenIds(accountMid, ids, preferencePersistence),
markLocalManagedFoldersHidden: (accountMid, ids) =>
  persistLocalManagedFolderHiddenIds(accountMid, ids, preferencePersistence)
```

Keep `onAccountOpenLocal` on `restoreForLocalRead`; remove its ability to consume the mark. Extend the project-book rule with the same no-B站 and no-technical-read guarantees. Record code locations and test results for I001 in the ledger.

- [x] **Step 2: Run targeted automated verification**

Run: `npm test -- electron/main/store.test.ts electron/main/managedFavoriteLedgerDeletionPersistence.test.ts electron/main/favoriteRepositoryManagedFolderService.test.ts electron/main/favoriteLibraryManagedFolderProjection.test.ts electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`

Run: `npm test`

Run: `npm run build`

Expected: all commands exit 0.

- [x] **Step 3: Attempt development and preview smoke checks**

Run: `npm run dev`

Run: `npm run preview`

Expected: both launch without build/runtime errors. Verify in the controllable Electron development window that local deletion immediately removes the selected folder and that mouse/scroll/window controls remain responsive; do not delete user data merely to automate this test.

- [x] **Step 4: Final audit and commit preparation**

Run: `git diff --check`

Run: `git status --short`

Re-read R001/R002 and I001; update the ledger with each code location, automated test evidence, and any unavailable UI evidence. Commit only the ledger, plan, project book, tests, and implementation files for this topic.

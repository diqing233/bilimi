# Favorite Backup And Deletion Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the confirmed default-folder deletion behavior, keep right and left deletion responsibilities distinct, and make backup preserve every local rule while reconciling Bilibili state.

**Architecture:** `FavoriteLedgerOverview` owns the right-side choice and UI state. It must pass the complete local ledger list into backup persistence while the Bilibili script itself skips disabled and draft items. Default ledgers retain the existing managed-folder path because they deliberately delete the library work folder; non-default right-side remote deletion uses a remote-only service path so it never commits a library deletion.

**Tech Stack:** React, TypeScript, Electron IPC, Vitest, Testing Library.

---

### Task 1: Lock backup preservation with failing tests

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [x] **Step 1: Add a component test that expresses complete local-state backup input**

```tsx
it('backs up eligible ledgers without dropping unchecked rules or unsaved drafts', async () => {
  const sync = vi.fn().mockResolvedValue({ ok: true })
  render(<FavoriteLedgerOverview ledgers={[
    { id: 'enabled', displayName: 'bilimi·已勾选', keywords: [], enabled: true, priority: 10, isDefault: false },
    { id: 'unchecked', displayName: 'bilimi·未勾选', keywords: [], enabled: false, priority: 20, isDefault: false },
    { id: 'draft', displayName: 'bilimi·草稿', keywords: [], enabled: true, priority: 30, isDefault: false, syncState: 'local-draft' }
  ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

  fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

  await waitFor(() => expect(sync).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ id: 'enabled' }),
    expect.objectContaining({ id: 'unchecked', enabled: false }),
    expect.objectContaining({ id: 'draft', syncState: 'local-draft' })
  ]), { deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }))
})
```

- [x] **Step 2: Add an App-level regression that confirms the full list persists after backup**

```tsx
await expect(requestRuntime({ id: 'backup-preserves-local-ledgers', type: 'ensure-ledgers' })).resolves.toMatchObject({ ok: true })
const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
expect(savedLedgers.map((ledger) => ledger.id)).toEqual(expect.arrayContaining(['enabled', 'unchecked', 'draft']))
```

- [x] **Step 3: Run the two tests and verify they fail because backup currently passes only its eligible subset into persistence**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/App.test.tsx --reporter=dot`

Expected: the new assertion fails because `unchecked` and `draft` are absent from the backup call or persisted preferences.

### Task 2: Make backup a non-destructive sync and discovery operation

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:402-406,611-639,711-730`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [x] **Step 1: Pass the complete projected ledger collection into backup persistence**

```ts
const ledgersForPersistence = projectEnabled(draftLedgers)
const result = await onSyncLedgers(ledgersForPersistence, {
  deleteDisabled: false,
  rediscoverDeletedRemoteDrafts: true
})
```

The existing `backupEligibleLedgers` helper remains only for whether the button is available. The Bilibili save script already skips `!ledger.enabled` and `syncState === 'local-draft'`, so this keeps remote writes scoped without treating excluded local items as deletions.

- [x] **Step 2: Use the same complete collection after explicit remote-binding confirmation**

```ts
const result = await onSyncLedgers(projectEnabled(draftLedgers), {
  deleteDisabled: false,
  rediscoverDeletedRemoteDrafts: true,
  rebindRemoteFolderIds: rebindSelections,
  rebindRemoteFolders
})
```

- [x] **Step 3: Keep the visible action label as ordinary backup**

The deleted-default state must render the normal existing `备册收藏夹` action. Remove only the special `恢复备册收藏夹` label/tooltip branch; preserve the existing deleted marker and normal backup callback.

- [x] **Step 4: Run the Task 1 tests and verify they pass**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/App.test.tsx --reporter=dot`

Expected: both new preservation assertions pass and no backup path invokes a deletion API.

### Task 3: Restore the protected default deletion route in the right sidebar

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/managedFavoriteFolderDeletionFeedback.ts`

- [x] **Step 1: Add failing tests for selectable default folders, local-only state, and ordinary backup label**

```tsx
fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
expect(screen.getByRole('button', { name: '加入删除 bilimi·游戏' })).toBeEnabled()
fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·游戏' }))
fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
expect(await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).toBeInTheDocument()

expect(screen.getByRole('button', { name: '备册收藏夹' })).toBeEnabled()
expect(screen.queryByRole('button', { name: '恢复备册收藏夹' })).not.toBeInTheDocument()
```

- [x] **Step 2: Run the component test and verify it fails under commit `73870111` behavior**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot`

Expected: the default selection control is disabled and the right-side alert dialog is absent.

- [x] **Step 3: Restore only the default managed-deletion UI state and handlers**

Restore `ManagedFolderDeletionCandidate`, `ManagedDeletionScope`, preview, confirmation, and `applyManagedFavoriteFolderDeletionToLedgers` solely for selected default IDs. The local-only branch must call `previewFavoriteLibraryManagedFolderDelete(accountMid, 'bilimi-logical:' + id)` then `deleteFavoriteLibraryManagedFoldersLocal`; the Bilibili branch must call `deleteManagedFavoriteFolders` with previewed remote IDs. Both branches finalize the default with `managedFolderDeletedByUser`, cleared bindings, `enabled: false`, and the normal backup label.

- [x] **Step 4: Run the component test and verify it passes**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot`

Expected: default local-only and Bilibili choices remain protected, preserve the default rule, and surface only existing failure text.

### Task 4: Give saved custom right-side folders their own remote-only Bilibili deletion path

**Files:**

- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Add a failing service test for remote-only deletion**

```ts
await service.deleteManagedRemoteFolders('100', ['custom'], false, { custom: 'bilimi·自建' }, { custom: ['9'] })
expect(remoteDelete).toHaveBeenCalledWith(expect.objectContaining({ folderId: '9' }))
expect(repository.commit).not.toHaveBeenCalledWith('100', expect.objectContaining({ type: 'delete-local-managed-folders' }))
```

- [x] **Step 2: Add a failing sidebar test for a saved custom folder’s Bilibili scope**

```tsx
fireEvent.click(screen.getByRole('radio', { name: '同时从 B 站删除收藏夹及其中分类视频' }))
fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
fireEvent.click(screen.getByRole('button', { name: '删除' }))
await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledWith('100', ['custom'], false, { custom: 'bilimi·自建' }, { custom: ['9'] }))
expect(deleteFavoriteLibraryManagedFoldersLocal).not.toHaveBeenCalled()
```

- [x] **Step 3: Run the new tests and verify they fail because no remote-only operation exists and the sidebar has no scope dialog**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot`

Expected: missing method/IPC assertion failures.

- [x] **Step 4: Add remote-only deletion without a repository commit**

Extract the verified remote-candidate deletion loop from `deleteManagedFolders` into a shared private helper. `deleteManagedFolders` calls it then commits `delete-local-managed-folders`; `deleteManagedRemoteFolders` calls it and returns candidates without committing or invoking `onManagedFolderDeletion`. Expose the latter only through a new trusted old-favorite-workspace IPC method.

- [x] **Step 5: Render a right-owned scope dialog for saved custom folders and combine it safely with defaults**

For selected remote-capable custom rules, open the right dialog. Local scope deletes only local right rules; Bilibili scope performs remote-only deletion first and removes local right rules only after success. Selected default IDs remain on the protected default path from Task 3. Remote-only drafts remain local-only and never enter the remote dialog. A failed remote action preserves local rules, library relations, and the existing failure wording.

- [x] **Step 6: Run service and component tests and verify they pass**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot`

Expected: remote-only custom deletion does not commit a local work-folder deletion; default deletion still does; drafts remain local-only.

### Task 5: Protect the left menu and verify the scoped change

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-14-favorite-backup-and-deletion-boundaries.md`
- Modify: `docs/superpowers/plans/2026-08-14-favorite-backup-and-deletion-boundaries.md`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`

- [x] **Step 1: Run left-menu, backup, sidebar, and service regression suites**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/App.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteRepositorySyncService.test.ts --reporter=dot`

Expected: all selected suites pass. Existing React `act(...)` warnings in the left-menu suite may remain, but no assertion failures are permitted.

- [x] **Step 2: Build and inspect the scoped diff**

Run: `npm run build; git diff --check; git diff --stat; git status --short`

Expected: build exits 0, no whitespace errors, and root file `1` remains untracked and unstaged.

- [x] **Step 3: Record per-index evidence and perform real Electron read-only UI checks**

Check right default selection, right custom scope dialog, left menu scope dialog, ordinary backup labels, and draft persistence without confirming a destructive Bilibili operation. Record automation limitations exactly if the Electron context remains unavailable.

- [x] **Step 4: Commit only the scoped files after evidence is recorded**

Run: `git add -- docs/requirement-ledgers/2026-08-14-favorite-backup-and-deletion-boundaries.md docs/superpowers/plans/2026-08-14-favorite-backup-and-deletion-boundaries.md src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/App.test.tsx electron/main/favoriteRepositorySyncService.ts electron/main/favoriteRepositorySyncService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/preload/index.ts src/renderer/src/global.d.ts; git commit -m "fix: preserve favorite backup and deletion boundaries"`

Expected: one local `main` commit, no push, merge, rebase, reset, stash, or cleanup operation.

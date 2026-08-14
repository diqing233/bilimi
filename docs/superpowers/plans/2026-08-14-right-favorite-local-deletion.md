# Right Favorite Local Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make right-side “收藏夹” deletion remove selected local custom configurations—including draft, saved, and mixed selections—without changing 收藏库 or B 站.

**Architecture:** Route right-side custom selections to a new account-scoped preferences IPC. It removes only non-default ledger records and records their existing remote IDs for later backup rediscovery. The renderer removes transient drafts locally and calls the IPC for persisted custom records. Existing protected default and left 收藏库 deletion behavior is unchanged.

**Tech Stack:** Electron IPC, TypeScript, React, Vitest.

---

## Requirement coverage

- `R001`-`R004`, `I001`-`I002`: only the right 收藏夹 deletion path changes; its local deletion preserves 收藏库、left 工作夹、B 站、videos and history.
- `R005`-`R007`, `I003`: remote drafts may be selected in delete mode; draft, saved and mixed custom selections are removed in one action by type.
- Protected boundary: default-system deletion and left-side 收藏库“删除工作夹” are not modified.

### Task 1: Add a preference-only custom-ledger deletion primitive

**Files:**

- Modify: `src/shared/favoriteLedgerDraftDeletion.ts`
- Test: `src/shared/favoriteLedgerDraftDeletion.test.ts`

- [x] **Step 1: Write failing shared tests**

```ts
it('removes selected custom ledgers while retaining every default ledger', () => {
  const next = removeLocalFavoriteLedgers([defaultLedger, savedCustom, remoteDraft], ['saved', 'draft'])
  expect(next).toEqual([defaultLedger])
})

it('does not remove a default ledger through the local custom path', () => {
  expect(removeLocalFavoriteLedgers([defaultLedger], ['default'])).toBe(ledgers)
})
```

- [x] **Step 2: Run test and observe failure**

Run: `npm test -- src/shared/favoriteLedgerDraftDeletion.test.ts --run`

Expected: FAIL because `removeLocalFavoriteLedgers` does not exist.

- [x] **Step 3: Implement the narrow primitive**

```ts
export function removeLocalFavoriteLedgers(ledgers: FavoriteLedger[], ledgerIds: readonly string[]) {
  const removableIds = new Set(ledgerIds.filter((id) => ledgers.some((ledger) => ledger.id === id && !ledger.isDefault)))
  return removableIds.size ? ledgers.filter((ledger) => !removableIds.has(ledger.id)) : ledgers
}
```

- [x] **Step 4: Run test and observe pass**

Run: `npm test -- src/shared/favoriteLedgerDraftDeletion.test.ts --run`

Expected: PASS.

### Task 2: Expose an account-scoped local-configuration IPC

**Files:**

- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `electron/main/favoriteLedgerDraftDeletionIpc.test.ts`

- [x] **Step 1: Write failing IPC contract assertions**

```ts
expect(preloadSource).toContain('deleteFavoriteLedgersLocal: (accountMid: string, ledgerIds: string[])')
expect(preloadSource).toContain("ipcRenderer.invoke('assistant:delete-favorite-ledgers-local', accountMid, ledgerIds)")
expect(rendererTypesSource).toContain('deleteFavoriteLedgersLocal?: (accountMid: string, ledgerIds: string[])')
```

The handler test must require trusted sender validation, current-account equality, `removeLocalFavoriteLedgers`, remote-ID rediscovery marking, preference notification, and absence of repository or B站 remote deletion calls.

- [x] **Step 2: Run test and observe failure**

Run: `npm test -- electron/main/favoriteLedgerDraftDeletionIpc.test.ts --run`

Expected: FAIL because the local-configuration channel is absent.

- [x] **Step 3: Implement the bridge and handler**

```ts
deleteFavoriteLedgersLocal: (accountMid: string, ledgerIds: string[]) =>
  ipcRenderer.invoke('assistant:delete-favorite-ledgers-local', accountMid, ledgerIds)
```

Validate a non-empty, de-duplicated string array. Before removing records, collect their remote IDs; remove custom records only; persist preferences; mark remote IDs for backup rediscovery; notify renderer snapshots; return `{ status: 'succeeded', ledgerIds }`.

- [x] **Step 4: Run test and observe pass**

Run: `npm test -- electron/main/favoriteLedgerDraftDeletionIpc.test.ts --run`

Expected: PASS.

### Task 3: Route right-side deletion mode by configuration type

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Write failing renderer tests**

```tsx
it('allows a remote draft and a saved custom ledger to be selected together and deletes both through the local configuration IPC', async () => {
  await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['remote-draft', 'saved']))
  expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
  expect(deleteManagedFavoriteFolders).not.toHaveBeenCalled()
})

it('deletes a saved custom ledger from its editor without opening the managed-folder dialog', async () => {
  await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['saved']))
  expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
})
```

- [x] **Step 2: Run tests and observe failure**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --run`

Expected: FAIL because remote drafts are disabled in deletion mode and saved custom ledgers open the managed-folder dialog.

- [x] **Step 3: Implement minimal renderer routing**

```ts
const selectedCustom = selected.filter((ledger) => !ledger.isDefault)
const persistedIds = selectedCustom.filter((ledger) => ledgers.some((item) => item.id === ledger.id)).map((ledger) => ledger.id)
if (persistedIds.length) await window.bilimiDesktop?.deleteFavoriteLedgersLocal?.(accountMid, persistedIds)
removeSelectedCustomFromPanelState(selectedCustom.map((ledger) => ledger.id))
```

Remote drafts become selectable in delete mode. A custom right-side deletion does not call `previewManagedFavoriteFolderDeletion`, `previewFavoriteLibraryManagedFolderDelete`, or B站 deletion APIs. Keep default ledgers on their protected pre-existing path. Update right-panel labels and help to say this action only deletes local 收藏夹配置 and retains 收藏库与 B 站.

- [x] **Step 4: Run tests and observe pass**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --run`

Expected: PASS.

### Task 4: Verify, audit, and commit

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-14-managed-folder-delete-semantics.md`
- Test: `src/shared/favoriteLedgerDraftDeletion.test.ts`
- Test: `electron/main/favoriteLedgerDraftDeletionIpc.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: Run targeted checks**

```powershell
npm test -- src/shared/favoriteLedgerDraftDeletion.test.ts --run
npm test -- electron/main/favoriteLedgerDraftDeletionIpc.test.ts --run
npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --run
npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx --run
npm run build
git diff --check
```

Expected: all commands exit `0`.

- [x] **Step 2: Record evidence and commit only this topic**

Update the ledger with code positions, individual test results, and actual Electron verification status. Stage only the listed topic files and never stage the unrelated root file `1`.

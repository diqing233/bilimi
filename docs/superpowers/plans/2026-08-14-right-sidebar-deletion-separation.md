# Right Sidebar Favorite Deletion Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the right sidebar’s deletion mode remove only local custom-ledger configuration and drafts, with no collection-library or Bilibili deletion behavior.

**Architecture:** `FavoriteLedgerOverview` already has separate local deletion helpers for non-default ledgers and drafts. Remove the remaining default-ledger branch that delegates to managed-folder deletion, make default ledgers non-selectable in the right deletion store, and retain the left collection-library menu as the only owner of library/Bilibili folder deletion.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Electron IPC.

---

### Task 1: Lock the right-side boundary with failing component tests

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx:383-415,1413-1528`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Replace the legacy default-deletion expectation with a test that expresses the boundary**

```tsx
it('keeps a default ledger out of the right-side deletion path', async () => {
  const previewManagedFavoriteFolderDeletion = vi.fn()
  const deleteManagedFavoriteFolders = vi.fn()
  render(<FavoriteLedgerOverview ledgers={[defaultLedger]} missingLedgerIds={[]}
    onSaveLedgers={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
  expect(screen.getByRole('button', { name: '加入删除 bilimi·音乐' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

  expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
  expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
  expect(deleteManagedFavoriteFolders).not.toHaveBeenCalled()
})
```

- [x] **Step 2: Change the mixed-selection test to assert that a custom ledger is removed locally while a default ledger never enters the managed path**

```tsx
expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['custom-tech'])
expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
expect(deleteManagedFavoriteFolders).not.toHaveBeenCalled()
expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
```

- [x] **Step 3: Run the single component test file and verify the new tests fail because the default branch still opens the managed deletion dialog**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot`

Expected: the new boundary tests fail while reporting that the default delete-selection control is not disabled or that the managed deletion dialog/API is present.

### Task 2: Remove the managed deletion branch from the right sidebar

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:199-244,637-872,962-970`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Make default ledger entries non-operable in deletion mode**

```ts
operable: deletionMode ? !ledger.isDefault : isOperable(ledger)
```

- [x] **Step 2: Keep `requestSync` on the local route only while deletion mode is active**

```ts
const selectedLedgers = currentLedgers.filter((ledger) => deletionStore.isEnabled(ledger.id) && !ledger.isDefault)
if (selectedLedgers.length && !await deleteLocalFavoriteLedgers(selectedLedgers.map((ledger) => ledger.id), currentLedgers)) return
setDeletionModeActive(false)
```

- [x] **Step 3: Remove `requestManagedDeletion`, `confirmManagedDeletion`, their state, the right-side danger modal, and managed-folder-only imports/types**

The remaining right-side code must not reference `previewManagedFavoriteFolderDeletion`, `previewFavoriteLibraryManagedFolderDelete`, `deleteFavoriteLibraryManagedFoldersLocal`, `deleteManagedFavoriteFolders`, `ManagedFolderDeletionCandidate`, or `ManagedDeletionScope`.

- [x] **Step 4: Run the component test file and verify it passes**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot`

Expected: all tests in the file pass; the old right-side managed-deletion expectations have been replaced with local-boundary assertions.

### Task 3: Protect the two distinct entry points and verify the build

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:80-86`
- Modify: `docs/requirement-ledgers/2026-08-14-right-sidebar-deletion-separation.md`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: Replace the right-side deletion help text with an exact local-only explanation**

```tsx
{ title: '删除 bilimi 收藏夹：', detail: '点击右侧“×”进入删除模式，勾选要删除的自建收藏夹或草稿后点击“删除”。这只会移除右侧本地收藏夹配置，保留收藏库和 B 站收藏夹；默认收藏夹请在左侧收藏库的工作夹菜单中处理。' }
```

- [x] **Step 2: Add a rendering assertion that the right side has no “删除范围” fieldset and no Bilibili-deletion radio option**

```tsx
expect(screen.queryByText('删除范围')).not.toBeInTheDocument()
expect(screen.queryByRole('radio', { name: '同时从 B 站删除收藏夹及其中分类视频' })).not.toBeInTheDocument()
```

- [x] **Step 3: Run protected left-menu regression tests and build**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx --reporter=dot`

Expected: all tests pass and the left menu continues to render its own collection-library deletion dialog.

Run: `npm run build`

Expected: exit 0 with Electron main, preload, and renderer builds successful.

- [x] **Step 4: Record exact code locations, test counts, build output, and real-Electron limitations in the requirement ledger**

### Task 4: Commit the verified single-topic change

**Files:**

- Stage only: `docs/requirement-ledgers/2026-08-14-right-sidebar-deletion-separation.md`, `docs/superpowers/plans/2026-08-14-right-sidebar-deletion-separation.md`, `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`, `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Check the final scoped diff**

Run: `git diff --check; git status --short; git diff --stat`

Expected: no whitespace failures; the pre-existing untracked root file `1` remains unmodified and unstaged.

- [x] **Step 2: Commit only after every I001/I002 index row contains code and verification evidence**

Run: `git add -- <the four scoped files>; git commit -m "fix: separate right sidebar favorite deletion"`

Expected: one local `main` commit; no push, merge, rebase, reset, stash, or cleanup operation.

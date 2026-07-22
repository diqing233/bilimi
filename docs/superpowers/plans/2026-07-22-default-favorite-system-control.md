# Default Favorite System Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide per-account control of bilimi default favorites without compromising staging, authoritative classification, local archive history, or remote-delete safety.

**Architecture:** Persist a small account-keyed favorite projection in the main process. Use the workspace coordinator for global system-result reclassification, and extend the existing repository/binding/sync path for deletion preview, verification, and cleanup. React holds drafts and confirmations only.

**Tech Stack:** Electron, TypeScript, React 19, Vitest.

---

## File Map

- `src/shared/types.ts`, `electron/main/store.ts`, `electron/main/store.test.ts`: account-keyed switch and ledger projection.
- `electron/main/index.ts`, `electron/main/oldFavoriteWorkspaceClassification.ts`, `.test.ts`: account-specific classifier inputs; disabled defaults excluded while inbox staging remains.
- `electron/main/oldFavoriteWorkspaceCoordinator.ts`, `.test.ts`, IPC: one main-process reclassification command and round locking.
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`, `.test.tsx`, `ControlledFavoriteLedgerPanel.tsx`, `.test.tsx`, `FloatingAssistantApp.tsx`: compact controls, native drag, copy, and destructive flow.
- `electron/main/favoriteRepositorySyncService.ts`, `.test.ts`, binding/repository IPC: candidate discovery, recount, delete, stop.
- `src/shared/favoriteRepository.ts`, `.test.ts`, `favoriteArchiveProtection.ts`, `.test.ts`: binding deletion and protection validity.

### Task 1: Account Configuration and Local Targets

**Files:** `src/shared/types.ts`, `electron/main/store.ts`, `electron/main/index.ts`, `electron/main/oldFavoriteWorkspaceClassification.ts`, and their tests.

- [ ] **Step 1: Write a failing account-preference test.**

```ts
it('initializes defaults once and restores each account configuration', () => {
  expect(loadFavoriteAccountPreferences(store, '100').defaultFavoriteSystemEnabled).toBe(true)
  saveFavoriteAccountPreferences(store, '100', { defaultFavoriteSystemEnabled: false, favoriteLedgers: custom })
  expect(loadFavoriteAccountPreferences(store, '200').defaultFavoriteSystemEnabled).toBe(true)
  expect(loadFavoriteAccountPreferences(store, '100').favoriteLedgers).toEqual(custom)
})
```

- [ ] **Step 2: Verify RED.** Run `npm test -- electron/main/store.test.ts -t "initializes defaults once"`; expect the helper to be absent.
- [ ] **Step 3: Implement minimally.** Normalize a numeric-account keyed record with default-on switch and normalized ledgers. Fall back to legacy global ledgers only for unseen accounts; persist an entry once initialized. Clearing local data leaves no entry, so every account is new.
- [ ] **Step 4: Verify GREEN.** Run `npm test -- electron/main/store.test.ts`; expect pass.
- [ ] **Step 5: Write a failing classifier test.**

```ts
it('excludes ordinary defaults but retains inbox staging when disabled', () => {
  const ledgers = classifierLedgersForAccount(defaults, false)
  expect(ledgers.find((ledger) => ledger.id === 'knowledge')?.enabled).toBe(false)
  expect(ledgers.find((ledger) => ledger.id === 'inbox')?.enabled).toBe(true)
})
```

- [ ] **Step 6: Verify RED.** Run `npm test -- electron/main/oldFavoriteWorkspaceClassification.test.ts -t "retains inbox"`; expect failure.
- [ ] **Step 7: Implement the projection.** Disable only ordinary defaults; preserve inbox, custom, and adopted recommendations. Use the account projection for classifier, DeepSeek targets, and title lookup. Do not bind/create a remote folder for unbound logical targets.
- [ ] **Step 8: Verify GREEN.** Run `npm test -- electron/main/store.test.ts electron/main/oldFavoriteWorkspaceClassification.test.ts`; expect pass.
- [ ] **Step 9: Commit.**

```powershell
git add src/shared/types.ts electron/main/store.ts electron/main/store.test.ts electron/main/index.ts electron/main/oldFavoriteWorkspaceClassification.ts electron/main/oldFavoriteWorkspaceClassification.test.ts
git commit -m "feat: scope default favorite controls by account"
```

### Task 2: Reclassification and Compact Controls

**Files:** coordinator + IPC, compact assistant components, and corresponding tests.

- [ ] **Step 1: Write a failing coordinator test.**

```ts
it('reclassifies all segments but preserves manual and deepseek classifications', async () => {
  const next = await coordinator.reclassifyForFavoriteConfiguration('100')
  expect(next.classifications['1'].source).toBe('manual')
  expect(next.classifications['2'].source).toBe('deepseek')
  expect(next.classifications['3'].source).toBe('system-high')
})
```

- [ ] **Step 2: Verify RED.** Run `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "reclassifies all"`; expect missing command.
- [ ] **Step 3: Implement one main-process command.** During preview call `autoClassifyAllSegmentsUnsafe(workspace, true)`; return unchanged frozen/executing plans. Invoke only after explicit save, custom/recommendation changes, master-switch change, or drag completion, never on keystrokes.
- [ ] **Step 4: Verify GREEN.** Run `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`; expect pass.
- [ ] **Step 5: Write failing compact UI tests.**

```tsx
it('keeps required defaults selected when 取消全选 clears custom targets in a round', () => {
  render(<FavoriteLedgerOverview organizationActive ledgers={roundLedgers} onSaveLedgers={save} />)
  fireEvent.click(screen.getByRole('button', { name: '取消全选' }))
  expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
    expect.objectContaining({ id: 'knowledge', enabled: true }),
    expect.objectContaining({ id: 'custom-tech', enabled: false })
  ]), expect.anything())
})
it('persists sequential priorities after native drag drop', () => {
  render(<FavoriteLedgerOverview ledgers={orderedLedgers} onSaveLedgers={save} />)
  const [first, second] = screen.getAllByTestId('favorite-ledger-chip')
  fireEvent.dragStart(first, { dataTransfer: new DataTransfer() })
  fireEvent.drop(second, { dataTransfer: new DataTransfer() })
  expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
    expect.objectContaining({ id: 'second', priority: 10 }),
    expect.objectContaining({ id: 'first', priority: 20 })
  ]), expect.anything())
})
```

- [ ] **Step 6: Verify RED.** Run `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "取消全选|sequential priorities"`; expect failure.
- [ ] **Step 7: Implement compact controls.** Put the only operable switch and caution copy in Settings; the folder overview only reflects `已停用` and local-only state. Lock required defaults during a round but allow their rule edits; keep custom/recommendation controls editable. Restore native 1.0.5 drag handlers, persist sequential priorities after drop, then reclassify. Use one `全选` / `取消全选` toggle and preserve required defaults in a round.
- [ ] **Step 8: Verify GREEN.** Run `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`; expect pass.
- [ ] **Step 9: Commit.**

```powershell
git add electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx
git commit -m "feat: reclassify favorite rules and restore compact ordering"
```

### Task 3: Shared Verified Remote Deletion

**Files:** sync/binding/repository/protection services, IPC declarations, assistant confirmation UI, and tests.

- [ ] **Step 1: Write failing sync tests.**

```ts
it('previews only disabled bilimi-managed bound folders with current counts', async () => {
  await expect(service.previewDisabledManagedFolders('100', disabledLedgers)).resolves.toMatchObject({
    folders: [{ logicalLedgerId: 'knowledge', remoteFolderId: '9', memberCount: 4 }]
  })
})
it('recounts before deleting, stops at first failure, and never deletes user folders', async () => {
  await expect(service.deleteVerifiedDisabledManagedFolders('100', candidates)).rejects.toThrow('bilimi·游戏')
  expect(pageBridge.deleteFolder).toHaveBeenCalledTimes(2)
  expect(pageBridge.deleteFolder).not.toHaveBeenCalledWith(expect.objectContaining({ remoteFolderId: 'user-folder' }))
})
```

- [ ] **Step 2: Verify RED.** Run `npm test -- electron/main/favoriteRepositorySyncService.test.ts -t "previews only|stops at"`; expect missing boundary.
- [ ] **Step 3: Implement deletion service.** Derive candidates only from bilimi logical folders and physical shards. Preview first; re-read remote inventory immediately before deletion; require IDs/titles to match; delete serially through the existing arbiter; commit each successful cleanup; stop on first failure. Master switch/local save never calls it.
- [ ] **Step 4: Verify GREEN.** Run `npm test -- electron/main/favoriteRepositorySyncService.test.ts electron/main/favoriteRepositoryBindingService.test.ts`; expect pass.
- [ ] **Step 5: Write failing repository/protection tests.**

```ts
it('removes bindings and shards without deleting local videos or history', () => {
  const next = applyFavoriteRepositoryCommand(snapshot, deleteBindingCommand)
  expect(next.videos['42']).toBeDefined()
  expect(next.organizationRecords).toHaveLength(1)
  expect(next.physicalShards).toEqual([])
})
it('unprotects only when no valid formal target remains', () => {
  expect(partitionFavoriteArchiveSources(oneRemainingTarget).protectedVideos).toHaveLength(1)
  expect(partitionFavoriteArchiveSources(noRemainingTargets).activeSourceFolders[0]?.videos).toHaveLength(1)
})
```

- [ ] **Step 6: Verify RED.** Run `npm test -- src/shared/favoriteRepository.test.ts src/shared/favoriteArchiveProtection.test.ts`; expect failure.
- [ ] **Step 7: Implement cleanup.** Remove verified bindings/shards/memberships while retaining videos/history. Intersect historical protection targets with surviving formal bound targets; keep protection if any remain, otherwise return the item to the next incremental round.
- [ ] **Step 8: Verify GREEN.** Run `npm test -- src/shared/favoriteRepository.test.ts src/shared/favoriteArchiveProtection.test.ts`; expect pass.
- [ ] **Step 9: Write failing dialog tests.**

```tsx
it('requires 我已确认 before 删除并同步 and shows names, counts, and remote counts', async () => {
  render(<FavoriteLedgerOverview ledgers={disabledBoundLedgers} onSyncLedgers={sync} previewRemoteDeletion={preview} />)
  fireEvent.click(screen.getByRole('button', { name: '同步' }))
  expect(await screen.findByText('bilimi·知识')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '删除并同步' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
  expect(screen.getByRole('button', { name: '删除并同步' })).toBeEnabled()
})
it('returns final synchronization to confirmation after cancellation', async () => {
  render(<OldFavoriteConfirmationStep snapshot={previewSnapshot} loading={false} onConfirmAndSync={confirm} />)
  fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))
  fireEvent.click(await screen.findByRole('button', { name: '取消' }))
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeVisible()
})
```

- [ ] **Step 10: Verify RED.** Run `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`; expect failure.
- [ ] **Step 11: Implement shared two-stage dialogs.** First show sync changes, then default-cancel danger confirmation with the required warning, relationship-not-video explanation, counts, checkbox, and red action. Reuse for standalone and final Bilibili sync. Both final choices persist local library videos/membership/history; only Bilibili sync binds/creates/executes remotely.
- [ ] **Step 12: Verify GREEN.** Run `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`; expect pass.
- [ ] **Step 13: Commit.**

```powershell
git add electron/main/favoriteRepositorySyncService.ts electron/main/favoriteRepositorySyncService.test.ts electron/main/favoriteRepositoryBindingService.ts electron/main/favoriteRepositoryBindingService.test.ts electron/main/favoriteRepositoryIpc.ts electron/preload/index.ts src/renderer/src/global.d.ts src/shared/favoriteRepository.ts src/shared/favoriteRepository.test.ts src/shared/favoriteArchiveProtection.ts src/shared/favoriteArchiveProtection.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx
git commit -m "feat: confirm managed favorite deletion safely"
```

### Task 4: Full Verification

- [ ] **Step 1:** Run related focused tests for store, classifier, coordinator/IPC, sync/binding, repository/protection, and assistant components; expect PASS.
- [ ] **Step 2:** Run `npm test`; expect PASS.
- [ ] **Step 3:** Run `npm run build`; expect exit code 0.
- [ ] **Step 4:** Audit every approved design rule against tests/code; report manual UI checks. Do not invoke `dist` or `dist:win`.

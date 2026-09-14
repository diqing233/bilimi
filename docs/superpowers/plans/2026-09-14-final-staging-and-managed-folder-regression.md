# Final Local Save and Managed Folder Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the “save this round to local library” path entirely local while preserving visible final staging, and prevent a renderer preference save from reviving a deleted managed folder.

**Architecture:** A new payload-free IPC command will directly invoke the coordinator’s existing whole-run local persistence method, bypassing the whole-run execution-intent state machine used for Bilibili operations. Account preference normalization will retain the durable hidden-managed-folder ID projection in the renderer; the main-process full preference save will merge existing IDs into stale renderer snapshots, while dedicated main-process deletion/recovery helpers remain the only paths that can remove them.

**Tech Stack:** Electron, React, TypeScript, Vitest.

---

### Task 1: Add the direct whole-run local-save IPC boundary

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`

- [ ] **Step 1: Write the failing IPC and hook tests**

```ts
await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'save-whole-run-locally' })
expect(coordinator.saveWholeRunToLocalLibrary).toHaveBeenCalledWith('100')
expect(coordinator.setExecutionIntent).not.toHaveBeenCalled()

await result.current.saveWholeRunLocally()
expect(command).toHaveBeenCalledWith('100', { type: 'save-whole-run-locally' })
```

- [ ] **Step 2: Run RED tests**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

Expected: FAIL because `save-whole-run-locally` is not an accepted IPC command and the hook does not expose the method.

- [ ] **Step 3: Add only the new payload-free command**

```ts
| { type: 'save-whole-run-locally' }

if (requested.type === 'save-whole-run-locally') {
  await options.coordinator.saveWholeRunToLocalLibrary(accountMid)
}
```

Expose `saveWholeRunLocally()` from the hook after the existing recommendation queue wait, and use it only for the final whole-run local-save handler. Do not put this command in the execution-intent setter or continuation branch.

- [ ] **Step 4: Run GREEN tests**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS; existing coordinator coverage continues proving unmatched videos materialize as `bilimi-logical:inbox` and the default Bilibili plan excludes them.

### Task 2: Preserve durable deleted-folder IDs across renderer preference saves

**Files:**

- Modify: `src/renderer/src/features/state/assistantState.test.ts`
- Modify: `src/renderer/src/features/state/assistantState.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/store.ts`

- [ ] **Step 1: Write the failing projection and stale-save tests**

```ts
expect(createInitialAssistantPreferences({ favoriteAccountPreferences: {
  '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [], hiddenFavoriteLibraryManagedLedgerIds: ['music', ' music ', 'bad id'] }
}}).favoriteAccountPreferences?.['100']?.hiddenFavoriteLibraryManagedLedgerIds).toEqual(['music'])

saveAssistantPreferences(store, stalePreferencesWithoutHiddenIds)
expect(loadFavoriteAccountPreferences(store, '100').hiddenFavoriteLibraryManagedLedgerIds).toEqual(['music'])
```

- [ ] **Step 2: Run RED tests**

Run: `npm test -- src/renderer/src/features/state/assistantState.test.ts electron/main/store.test.ts`

Expected: FAIL because the renderer removes the field and a full renderer save replaces the persisted account object.

- [ ] **Step 3: Implement the minimal two-layer protection**

Normalize `hiddenFavoriteLibraryManagedLedgerIds` in the renderer with the same valid-ID, trim, deduplicate and sort rules as the main process. In `saveAssistantPreferences()`, merge a current account’s hidden IDs into the requested account projection so stale full snapshots cannot erase the marker; do not change `saveFavoriteAccountPreferences()` because explicit deletion/recovery helpers need its replacement semantics.

- [ ] **Step 4: Run GREEN tests**

Run: `npm test -- src/renderer/src/features/state/assistantState.test.ts electron/main/store.test.ts electron/main/managedFavoriteLedgerDeletionPersistence.test.ts electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`

Expected: PASS; ordinary reads retain deletion hiding and existing explicit business restoration tests remain unchanged.

### Task 3: Verify, document, and commit the two regressions

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-14-final-staging-and-managed-folder-regression.md`
- Modify only if needed: `docs/项目功能项目书.md`

- [ ] **Step 1: Run focused and full verification**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/state/assistantState.test.ts electron/main/store.test.ts electron/main/managedFavoriteLedgerDeletionPersistence.test.ts electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`

Run: `npm test`

Run: `npm run build`

Run: `git diff --check`

- [ ] **Step 2: Perform safe visual checks**

Start `npm run dev`, check the local final-save UI without triggering a real Bilibili operation, then start `npm run preview`. Confirm normal mouse movement, click, scroll, resize, minimize, restore and close responsiveness. Do not use a user’s real Bilibili delete operation as automated test input.

- [ ] **Step 3: Update the ledger and make one local commit**

Record actual code locations and fresh command output for I001 and I002. After `git status --short`, `git diff --stat`, and `git diff --check` show only this topic, commit the code, tests, plan, and ledger with `git commit -m "fix: isolate local save and preserve deleted folders"`. Do not push, merge, rebase, package, or alter real Bilibili data.

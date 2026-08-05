# Favorite Library Actions And Settings Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the finalized favorite-library interaction semantics and make organization-strategy controls update without blocking the settings workspace, while preserving migrations, notes, archives, transcription, and existing synchronization behavior.

**Architecture:** Keep the repository as the source of truth. Add narrow APIs for one-ledger provisioning and bilimi-work-folder-only removal instead of reusing the existing all-ledger provisioner or global Bilibili unfavorite command. In the renderer, separate table/filter layout from business operations and isolate the organization-strategy subtree so optimistic control state does not reconcile the entire settings workspace.

**Tech Stack:** Electron, React 18, TypeScript, Vitest, Testing Library, electron-vite.

---

## File Map

- `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`: favorite-library orchestration, column filters, current-folder actions, and detail/batch confirmations.
- `src/renderer/src/features/favorites/FavoriteLibraryApp.css`: fixed table tracks, truncation, navigation overflow, and compact scrollbars.
- `src/renderer/src/features/favorites/FavoriteLibraryNavigationGroupView.tsx`: ordinary-folder hover menu visibility and accessible labels.
- `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`: behavior regressions for source/status filters, provisioning, and bilimi-only removal.
- `src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`: navigation interaction contract.
- `src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx`: static CSS constraints that jsdom cannot calculate reliably.
- `electron/main/favoriteRepositoryBatchOperationService.ts`: preview/confirm/execute/reconcile lifecycle for bilimi-only remote placement removal.
- `electron/main/favoriteLibraryOperationsIpc.ts`: IPC registration and argument validation.
- `electron/preload/index.ts`, `src/renderer/src/global.d.ts`: narrow renderer bridge contracts.
- `src/renderer/src/App.tsx`: provision exactly one logical ledger without writing any video membership.
- `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`: retain settings workspace persistence but delegate organization-strategy rendering.
- `src/renderer/src/features/assistant/OrganizationStrategySettings.tsx`: memoized strategy, correction-record, and keyword-suggestion surface.
- `src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx`: optimistic response and render-isolation regressions.

### Task 1: Lock The Favorite Library Layout And Filter Contract

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigationGroupView.tsx`

- [x] **Step 1: Write failing behavior tests**

Add tests which assert the visible header order is `视频名称 / 状态 / 转写 / 来源`, the toolbar no longer owns a source block, one `状态筛选` button opens three grouped dimensions, and changing one dimension preserves the other two values sent to `getFavoriteLibraryPage`.

- [x] **Step 2: Write failing overflow and hover tests**

Assert long navigation labels expose full text through `title`, ordinary Bilibili folders expose `⋮` on hover/focus, and CSS contains `overflow-x: hidden`, constrained grid tracks, ellipsis rules, and vertical-only thin blue scrollbars.

- [x] **Step 3: Run RED**

Run:

```powershell
node_modules\.bin\vitest.cmd run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx
```

Expected: failures for the independent status chevrons, toolbar source filter, current column order, and missing overflow constraints.

- [x] **Step 4: Implement the minimal renderer change**

Create a single status popover which renders three labeled groups and updates one key at a time:

```tsx
<FavoriteLibraryStateFilterMenu
  value={libraryStateFilters}
  onChange={(key, value) => applyLibraryStateFilters({ ...libraryStateFilters, [key]: value })}
/>
```

Move the existing source menu into the final column header. Keep the server-side query fields unchanged. Use fixed/minmax grid tracks, `min-width: 0`, one-line ellipsis, and `overflow-x: hidden` so names cannot create horizontal scrolling.

- [x] **Step 5: Run GREEN and regression tests**

Re-run the Task 1 command and confirm all three files pass.

### Task 2: Make Current-Folder Provisioning Truthful And Narrow

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [x] **Step 1: Write failing provisioning tests**

Assert `备册当前收藏夹` calls a narrow bridge with the current logical folder id, never calls `synchronizeFavoriteLibraryPlacements`, and exposes this tooltip:

```text
为当前分类创建并绑定对应的 B 站 bilimi 收藏夹，不会同步视频。视频需通过“同步到B站”另行同步。
```

Also assert `刷新当前分类` is absent while batch `刷新信息` remains.

- [x] **Step 2: Run RED**

Run:

```powershell
node_modules\.bin\vitest.cmd run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/App.test.tsx
```

Expected: failure because only the all-ledger `ensureFavoriteLedgers` path exists and the current button still synchronizes videos.

- [x] **Step 3: Implement one-ledger provisioning**

Add a bridge such as:

```ts
ensureFavoriteLedger: (logicalFolderId: string) => Promise<AssistantAutomationResult>
```

Resolve the active account, find exactly that enabled ledger, invoke the existing trusted folder-create/bind script with only that ledger, persist the returned binding through the existing account-scoped preference migration path, and never call placement synchronization.

- [x] **Step 4: Update the heading action**

Rename the control to `备册当前收藏夹`, wire it to `ensureFavoriteLedger(currentFolderId)`, add the exact tooltip, and remove only `刷新当前分类`.

- [x] **Step 5: Run GREEN**

Re-run the Task 2 command and confirm the narrow bridge and UI tests pass.

### Task 3: Replace Global Unfavorite With Bilimi-Only Placement Removal

**Files:**
- Modify: `electron/main/favoriteRepositoryBatchOperationService.test.ts`
- Modify: `electron/main/favoriteRepositoryBatchOperationService.ts`
- Modify: `electron/main/favoriteLibraryOperationsIpc.test.ts`
- Modify: `electron/main/favoriteLibraryOperationsIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [x] **Step 1: Write failing service tests**

Cover both lifecycle branches:

```ts
it('removes only selected bilimi physical shards and preserves ordinary memberships')
it('moves the local record to recycle when no ordinary membership remains')
it('keeps metadata, transcripts, notes, archives, stars, and history intact')
it('records result-unknown and supports reconciliation without automatic retry')
```

The remote command evidence must contain physical shard `remove` operations only; it must not contain the global `unfavorite` operation.

- [x] **Step 2: Run service RED**

Run:

```powershell
node_modules\.bin\vitest.cmd run electron/main/favoriteRepositoryBatchOperationService.test.ts electron/main/favoriteLibraryOperationsIpc.test.ts
```

Expected: failure because the bilimi-only preview/confirm/execute API does not exist.

- [x] **Step 3: Implement the safe operation lifecycle**

Add preview, confirmation, execution, and reconciliation methods that:

```ts
type BilimiPlacementRemovalPreview = {
  executionToken: string
  affectedAids: number[]
  selectedLogicalFolderIds: string[]
  removablePhysicalFolderIds: string[]
  preservedOrdinarySources: Array<{ id: string; title: string }>
  recycleAids: number[]
  baselineRevision: number
}
```

Resolve managed logical folders to their bound physical shards, serialize remote writes per account, commit local placements only after known remote success, mark unknown results for explicit reconciliation, and retain the existing global unfavorite APIs for callers that truly need them.

- [x] **Step 4: Write failing renderer tests**

Assert managed and ordinary-source detail views both expose `移出 bilimi 工作夹`; managed scope defaults to the current logical folder and may opt into other bilimi folders; ordinary scope never includes the ordinary folder being viewed; confirmation lists preserved ordinary sources; and the no-ordinary-source branch says the item will enter the recycle bin.

- [x] **Step 5: Run renderer RED**

Run the focused `FavoriteLibraryApp.test.tsx` tests and observe failure against the current `取消B站收藏` implementation.

- [x] **Step 6: Wire the new bridge and dialogs**

Replace only the favorite-library UI action with the new operation. Do not delete or change global unfavorite IPCs. Refresh repository state after success or reconciliation and preserve the existing checkpoint/confirmation behavior.

- [x] **Step 7: Run GREEN**

Run all Task 3 test files and confirm both backend and renderer tests pass.

### Task 4: Isolate Organization-Strategy Rendering And Preserve Semantics

**Files:**
- Create: `src/renderer/src/features/assistant/OrganizationStrategySettings.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Write failing interaction and render-count tests**

Cover strategy radios, archive-adjustment checkbox, clear/delete correction records, pending/processed switch, and accept/ignore/delete/restore suggestion actions. Use deferred persistence promises and assert the visible control changes before persistence resolves. Count renders of unrelated settings sections and unchanged record/suggestion cards.

- [x] **Step 2: Run RED**

Run:

```powershell
node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx
```

Expected: interaction tests pass semantically where behavior already exists, but render-isolation assertions fail because the full settings content reconciles and cards are recreated.

- [x] **Step 3: Extract a memoized boundary**

Move only organization strategy, correction records, and keyword suggestions into `OrganizationStrategySettings`. Pass primitive strategy flags, stable callbacks, and the smallest record arrays needed. Preserve the existing `persistPreferencePatch` scheduler and migration fields.

- [x] **Step 4: Make controls optimistic after paint**

Reuse `SettingsPreferenceCheckbox`/post-paint patterns for the raw checkbox and button-driven view/status changes. Memoize record and suggestion rows by stable id plus the fields they render. Never delay UI feedback on `savePreferences`.

- [x] **Step 5: Run GREEN and semantic regressions**

Re-run the render-isolation test, `FloatingAssistantApp.test.ts`, settings preference field tests, favorite-ledger tests, and preference migration tests.

### Task 5: End-To-End Verification And Local Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-08-05-favorite-library-actions-and-settings-performance.md`
- Store diagnostics under: `.codex-artifacts/`

- [x] **Step 1: Run focused and protected-subsystem regression suites**

Run favorite-library, repository/IPC, settings, preference migration, notes, archives, transcription, and old-favorite workspace tests. Report all warnings and failures without relabeling existing failures as new regressions.

- [ ] **Step 2: Run the broad Vitest suite**

Attempted with 120-second and 300-second limits; both runs timed out without a complete failure summary. This remains unchecked and must not be reported as an all-repository pass.

Run all repository tests except the known packaging-config test, because `package.json` is intentionally not restored or changed.

- [x] **Step 3: Compare TypeScript diagnostics**

Run the existing typecheck command, capture output under `.codex-artifacts/`, and compare against the documented 216-diagnostic baseline. Fix every diagnostic introduced in files changed by this plan.

- [x] **Step 4: Verify the real Electron development build**

Start with:

```powershell
node_modules\.bin\electron-vite.cmd dev
```

Without issuing remote writes, verify the four top tabs still show mutually exclusive content; favorite-library navigation has no horizontal scrollbar; status/source menus remain usable; ordinary-folder `⋮` is reachable; settings strategy controls paint immediately; pointer, window resize, minimize, and close remain responsive. Record click-to-next-paint and pointer evidence under `.codex-artifacts/`. Do not infer performance from jsdom.

- [x] **Step 5: Check repository hygiene**

Run `git status --short`, `git diff --stat`, `git diff --check`, and inspect every changed file for unrelated edits. Confirm `package.json`, installed builds, user data, and remote systems were untouched.

- [x] **Step 6: Reconcile this checklist and create a local commit**

Mark only evidenced items complete. Create one or more scoped local commits after all checks pass; do not push.

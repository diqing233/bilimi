# Old Favorite Draft Preview Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recommendation selection accumulate instantly and prepare a 2000-item archive preview cooperatively, with progress and cancellation, before switching pages.

**Architecture:** The renderer owns an optimistic recommendation draft and updates it through functional mutations backed by a synchronous ref. The main process separates compact candidate persistence from an explicit cooperative preview-preparation command. Preparation publishes progress over IPC, observes an out-of-band cancellation flag, commits classifications only after a complete run, and the renderer switches to preview only when the completed candidate fingerprint still matches the current draft.

**Tech Stack:** React 19, TypeScript, Electron IPC, Vitest, Testing Library.

---

### Task 1: Accumulate rapid recommendation input from the latest draft

**Files:**
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [ ] **Step 1: Write failing rapid-click tests**

Add a component test that fires clicks on three different candidate checkboxes without awaiting persistence and expects all three to remain checked. Add a hook test that calls a new `updateRecommendedCandidates((current) => next)` API three times in one `act`, and expects the optimistic IDs to be the accumulated final set while the IPC queue still has only one request in flight.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx
```

Expected: the new tests fail because checkbox handlers derive their next set from the stale render snapshot and the hook has no functional draft updater.

- [ ] **Step 3: Implement a synchronous draft-ref updater**

In the hook, keep `recommendedCandidateIdsRef` synchronized with state and expose:

```ts
const updateRecommendedCandidates = useCallback((update: (current: string[]) => string[]) => {
  const normalized = normalizeCandidateIds(update(recommendedCandidateIdsRef.current))
  recommendedCandidateIdsRef.current = normalized
  setRecommendedCandidateIds(normalized)
  setRecommendationError(null)
  recommendationDesiredRef.current = normalized
  void runRecommendationQueue()
}, [runRecommendationQueue])
```

Change item and group handlers to functional mutations so every event starts from the latest ref rather than the last React render. Preserve immediate optimistic display, coalesced persistence, error rollback, and interactive controls while saving.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: all hook and panel tests pass, apart from already documented React `act(...)` warnings in older tests.

### Task 2: Separate compact candidate persistence from classification

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] **Step 1: Write a failing coordinator test**

Create a previewing workspace with `classifyCurrentItems` mocked, call `setRecommendedCandidates`, and assert that candidate IDs and recommended ledgers persist but `classifyCurrentItems` is not called and existing classifications remain unchanged.

- [ ] **Step 2: Run the exact coordinator test and verify RED**

Run:

```powershell
node_modules\.bin\vitest.cmd run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "stores recommendation selection without preparing classifications"
```

Expected: FAIL because `setRecommendedCandidates` currently calls `autoClassifyAllSegmentsUnsafe`.

- [ ] **Step 3: Remove automatic reclassification from candidate persistence**

Return the updated workspace snapshot immediately after the recommendation overlay and in-memory state are saved. Do not change recommendation validation or ledger add/remove persistence.

- [ ] **Step 4: Re-run the exact test and verify GREEN**

Run the Step 2 command. Expected: PASS.

### Task 3: Add cooperative, cancellable preview preparation with progress

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceClassification.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Test: `electron/main/oldFavoriteWorkspaceClassification.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`

- [ ] **Step 1: Write failing cooperative-helper tests**

Extend `classifyOldFavoriteItemsCooperatively` tests to assert an `onBatchComplete(completed, total)` callback after every batch and a `shouldCancel()` check that rejects with a stable cancellation error before processing the next batch.

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```powershell
node_modules\.bin\vitest.cmd run electron/main/oldFavoriteWorkspaceClassification.test.ts
```

Expected: FAIL because the helper has no progress or cancellation options.

- [ ] **Step 3: Implement helper progress and cancellation hooks**

Extend the options type with:

```ts
onBatchComplete?: (completedItemCount: number, totalItemCount: number) => void
shouldCancel?: () => boolean
```

Check cancellation before each batch, report cumulative completion after each classified batch, and throw `Old favorite preview preparation canceled.` when canceled.

- [ ] **Step 4: Write failing coordinator preparation tests**

Add tests proving `prepareRecommendationPreview(accountMid, candidateIds, onProgress)`:

- processes 2000 items through bounded batches;
- emits monotonic progress ending at 2000/2000;
- applies the supplied recommendation selection;
- leaves prior classifications untouched when cancellation or classification failure occurs;
- exposes `cancelRecommendationPreviewPreparation(accountMid)` without waiting for the coordinator queue.

- [ ] **Step 5: Implement atomic preview preparation**

Add one preparation generation per account. The method validates the previewing workspace and supplied candidate IDs, classifies all selected items into a local workspace value, accumulates overlay classifications/history, and persists them only after all batches complete and the generation is still current. The cancellation method only increments the generation. Reuse the existing classification rules and cooperative batch helper; restore the visible segment cache in `finally`.

- [ ] **Step 6: Write failing IPC contract tests**

Add strict command validation for:

```ts
{ type: 'prepare-recommendation-preview'; candidateIds: string[] }
{ type: 'cancel-recommendation-preview-preparation' }
```

Assert that preparation sends `old-favorite-workspace-v1:preview-preparation-progress` containing `accountMid`, `workspaceId`, `completedItemCount`, and `totalItemCount`, while cancel invokes the out-of-band coordinator method.

- [ ] **Step 7: Implement IPC, preload, and renderer types**

Expose `onOldFavoriteWorkspacePreviewPreparationProgress` in preload/global types. Route preparation through the command handler with a progress callback and route cancellation directly to `cancelRecommendationPreviewPreparation`.

- [ ] **Step 8: Run all Task 3 tests and verify GREEN**

Run:

```powershell
node_modules\.bin\vitest.cmd run electron/main/oldFavoriteWorkspaceClassification.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts
```

Expected: all pass.

### Task 4: Keep the recommendation page visible while preparing and switch only on a current result

**Files:**
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Write failing preparation UI tests**

Cover these behaviors:

- clicking the preview step stays on recommendation content while the command is pending;
- progress text updates from the preload event;
- cancel remains clickable and invokes the cancel command;
- a draft edit during preparation cancels the stale request and prevents it from switching pages;
- only a successful result matching the latest candidate fingerprint calls the panel's preview transition.

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```powershell
node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx
```

Expected: FAIL because preview navigation is currently a direct `setStep` and no preparation state exists.

- [ ] **Step 3: Implement renderer preparation state and navigation interception**

Add hook state for `previewPreparationRunning`, `previewPreparationProgress`, and `previewPreparationError`, plus `prepareRecommendationPreview()` and `cancelRecommendationPreviewPreparation()`. Subscribe to the progress event for the active workspace. Before preparing, await the compact recommendation queue; record a candidate fingerprint; send the prepare command; accept the result only if account, workspace, request generation, and fingerprint still match.

In the panel, intercept a request for `preview`: call preparation and set the step only when it returns a current successful snapshot. In the recommendation page, display `正在准备归档预览：x / y`, keep controls and window navigation usable, and show a cancel button. Apply `cursor: progress` to the guide region without an overlay or `pointer-events: none`.

- [ ] **Step 4: Run renderer tests and verify GREEN**

Run the Step 2 command. Expected: pass with only pre-existing warnings.

### Task 5: Make preview grouping linear and retain bounded rendering

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [ ] **Step 1: Write a failing 2000-item grouping test**

Render a snapshot containing 2000 items distributed across several ledger IDs. Assert group counts, only six initial cards per group, and virtual rendering after expanding a group over 50 items. Add a pure helper assertion that grouping preserves input order and visits each item once.

- [ ] **Step 2: Run the preview test and verify RED**

Run:

```powershell
node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx
```

Expected: the helper test fails because grouping is embedded and uses repeated array copying.

- [ ] **Step 3: Extract and implement linear grouping**

Export a small `groupOldFavoritePreviewItems` helper. Use a `Map<string, Item[]>`, create each bucket once, and `push` items in source order. Keep the existing initial six-item limit and `VirtualOldFavoriteTrack` threshold of 50.

- [ ] **Step 4: Re-run preview tests and verify GREEN**

Run the Step 2 command. Expected: pass.

### Task 6: Verify the complete trial in tests and real Electron

**Files:**
- Verify only all files changed above.

- [ ] **Step 1: Run the full focused regression set**

```powershell
node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx electron/main/oldFavoriteWorkspaceClassification.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts
```

Expected: all focused tests pass; report existing warnings precisely.

- [ ] **Step 2: Run type and diff checks**

```powershell
node_modules\.bin\tsc.cmd --noEmit
git diff --check
git status --short
```

Expected: no new errors in changed files; full `tsc` may still fail on documented unrelated dirty-tree baseline errors.

- [ ] **Step 3: Verify real development Electron behavior**

In the running development app, verify:

- at least four candidate boxes accept rapid consecutive clicks and remain selected;
- preview preparation stays on the recommendation page and displays progress;
- mouse movement, tab switching, and minimize remain responsive during preparation;
- cancel stops preparation without deleting the draft;
- successful preparation switches to preview only after completion;
- a large group initially renders six cards and expands through the virtual track;
- 批阅、札记、掌库、设置 still show mutually exclusive content.

Record that automation timings are not a comprehensive physical input-latency measurement.

- [ ] **Step 4: Review and create one local commit**

Inspect `git diff`, stage only task files, and commit locally with:

```text
fix: prepare favorite preview without blocking selection
```

Do not push or package.

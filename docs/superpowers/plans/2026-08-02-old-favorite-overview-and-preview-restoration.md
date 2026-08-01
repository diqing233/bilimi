# Old Favorite Overview and Preview Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore correct favorite-library state semantics, add a bounded multi-batch overview, and recover the complete 1.0.5 archive-preview interaction contract without reintroducing renderer-wide large-list work.

**Architecture:** The main process remains the source of durable facts, segment summaries, sparse AID indexes, history, and checkpoints. The renderer receives explicit row state and compact overview/history projections; current-segment cards stay memoized, folded, and virtualized. Each behavior is introduced test-first and committed independently.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library, CSS.

---

## File map

- `electron/main/favoriteRepositoryService.ts`: derive and filter explicit sync/protection/organization state beside the repository index.
- `electron/main/favoriteRepositoryIpc.ts`: carry the explicit row state over the existing library-page contract.
- `electron/main/favoriteLibraryCommands.ts`: validate the new independent filter object for scoped batch operations.
- `src/renderer/src/features/favorites/favoriteLibraryModel.ts`: renderer row types and pure labels for explicit state.
- `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`: three independent filters and state chips.
- `src/shared/oldFavoriteWorkspace.ts`: compact overview and readable history summary contracts.
- `electron/main/oldFavoriteWorkspaceCoordinator.ts`: segment-completion summaries, all-segment overview projection, sparse history details, and checkpoint-aware all-segment continuation.
- `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`: stable commands for overview selection, history, and existing durable mutation APIs.
- `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`: current/all overview selector and compact source/unavailable counts.
- `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`: current/all archive view, history shortcuts, stable recently-moved order, and group focus.
- `src/renderer/src/features/assistant/OldFavoritePreviewCard.tsx`: current-target replacement, remove-current/remove-all choice, original-source display, and shared tooltip triggers.
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`: view-state ownership and stable wiring.
- `src/renderer/src/features/favorites/VirtualOldFavoriteTrack.tsx`: fixed-height virtual cells.
- `src/renderer/src/styles.css`: visible full-card outline, fixed card height, compact overview, tooltip, and recent-change styles.

## Task 1: Explicit favorite-library state facts

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts`
- Test: `electron/main/favoriteRepositoryService.test.ts`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [ ] **Step 1: Write the failing service tests**

Add table-driven rows proving that only a remote-observed bilimi logical placement is synced, only a formal `bilimi-logical:*` membership is organized, and protection remains independent:

```ts
expect(row.libraryStates).toEqual({
  sync: 'unsynced',
  protection: 'protected',
  organization: 'unorganized'
})
```

Cover aligned remote observation, missing position, ordinary Bilibili source membership, `local:inbox`, formal work-folder membership, failure, and result-unknown.

- [ ] **Step 2: Verify RED**

Run: `node_modules\.bin\vitest.cmd run electron/main/favoriteRepositoryService.test.ts --reporter=dot`

Expected: FAIL because `libraryStates` does not exist and current rows default to inferred labels.

- [ ] **Step 3: Add one main-process derivation helper**

Implement and use a pure helper with this contract:

```ts
type FavoriteRepositoryLibraryStates = {
  sync: 'synced' | 'unsynced'
  protection: 'protected' | 'unprotected'
  organization: 'organized' | 'unorganized'
}

function libraryStatesForAid(
  snapshot: AccountFavoriteRepositorySnapshot,
  index: FavoriteRepositoryLibraryIndex,
  aid: number
): FavoriteRepositoryLibraryStates
```

`sync` must require observed remote bilimi placement and a non-error reconciliation state. `organization` must use canonical formal work-folder membership, not protection. Attach the result to page and detail rows.

- [ ] **Step 4: Update renderer labels and verify GREEN**

Replace `formatFavoriteLibraryMirrorStatus(pendingStates)` and `formatFavoriteLibraryOrganizationStatus(pendingStates)` row usage with explicit states while retaining detailed failure copy from `pendingStates`.

Run: `node_modules\.bin\vitest.cmd run electron/main/favoriteRepositoryService.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx --reporter=dot`

Expected: PASS; existing React `act(...)` warnings may remain documented but no new warning class appears.

- [ ] **Step 5: Commit**

```powershell
git add -- electron/main/favoriteRepositoryService.ts electron/main/favoriteRepositoryIpc.ts src/renderer/src/features/favorites/favoriteLibraryModel.ts electron/main/favoriteRepositoryService.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
git commit -m "fix(favorites): derive library states from repository facts"
```

## Task 2: Independent three-axis filters

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `electron/main/favoriteLibraryCommands.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `electron/main/favoriteRepositoryService.test.ts`
- Test: `electron/main/favoriteRepositoryIpc.test.ts`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [ ] **Step 1: Write failing filter tests**

Use the desired filter shape:

```ts
type FavoriteRepositoryLibraryStateFilters = {
  sync?: 'synced' | 'unsynced'
  protection?: 'protected' | 'unprotected'
  organization?: 'organized' | 'unorganized'
}
```

Assert cross-axis AND behavior and that no filter means all rows. Assert scoped selections reuse exactly the same filter semantics.

- [ ] **Step 2: Verify RED**

Run: `node_modules\.bin\vitest.cmd run electron/main/favoriteRepositoryService.test.ts electron/main/favoriteRepositoryIpc.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx --reporter=dot`

Expected: FAIL because only one mixed `filter` string is accepted.

- [ ] **Step 3: Implement bounded index filtering**

Replace the mixed page option with `stateFilters`; include the normalized object in the existing query-cache key. Apply all provided axes inside the already bounded main-process AID filter. Preserve transcription filters and sort behavior.

- [ ] **Step 4: Render three compact selectors**

Remove “待处理” from the status column menu and render Sync, Protection, and Organization selectors with All/positive/negative values. Keep the existing pending navigation/history entry for actionable failures, but do not present it as an organization state.

- [ ] **Step 5: Verify GREEN and commit**

Run the RED command again; expected PASS.

```powershell
git add -- electron/main/favoriteRepositoryService.ts electron/main/favoriteRepositoryIpc.ts electron/main/favoriteLibraryCommands.ts src/renderer/src/features/favorites/FavoriteLibraryApp.tsx electron/main/favoriteRepositoryService.test.ts electron/main/favoriteRepositoryIpc.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
git commit -m "feat(favorites): add independent library state filters"
```

## Task 3: Compact multi-segment overview projection

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `src/shared/oldFavoriteWorkspace.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] **Step 1: Write failing projection tests**

Specify a compact snapshot contract:

```ts
overview?: {
  completedSegmentCount: number
  totalSegmentCount: number
  available: boolean
  sourceFolders: Array<{ id: string; title: string; itemCount: number; invalidItemCount: number }>
  unavailableItemCount: number
  recommendationCounts: Array<{ id: string; count: number }>
  archiveTargets: Array<{ ledgerId: string; itemCount: number; segmentCounts: Array<{ segmentId: string; count: number }> }>
}
```

Assert first-segment gating, per-segment atomic publication, unavailable exclusion, and no full AID arrays in the overview payload.

- [ ] **Step 2: Verify RED**

Run: `node_modules\.bin\vitest.cmd run src/shared/oldFavoriteWorkspace.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts --reporter=dot`

Expected: FAIL because `overview` is absent.

- [ ] **Step 3: Store per-segment summaries at completion**

Generate summary counts when a segment becomes ready/saved, persist them beside the segment journal/checkpoint, and merge only completed summaries in `snapshotForRenderer`. Recovery reconstructs a missing summary from stored segment items and classifications without calling Bilibili.

- [ ] **Step 4: Verify GREEN and commit**

Run the RED command again; expected PASS.

```powershell
git add -- src/shared/oldFavoriteWorkspace.ts electron/main/oldFavoriteWorkspaceCoordinator.ts src/shared/oldFavoriteWorkspace.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts
git commit -m "feat(old-favorites): project compact batch overview"
```

## Task 4: Current/all view controls and one-pass workflow

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert single-segment pages have no selector. For multiple segments assert defaults: scan=all, recommendations=current, archive=current, confirmation=all. Assert unavailable first-batch overview is read-only and available overview says `已汇总 1/N 批`.

- [ ] **Step 2: Verify RED**

Run: `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx --reporter=dot`

Expected: FAIL because page-level current/all controls and overview rendering are absent.

- [ ] **Step 3: Implement local view state without mutations**

Add `type OldFavoriteViewScope = 'current' | 'all'`. Keep scope in `ControlledFavoriteLedgerPanel`; switching it only selects `snapshot.currentSegment` or `snapshot.overview` and never invokes a scan/classification command. Render compact counts in all view and preserve the current-segment card tree when it is hidden.

- [ ] **Step 4: Verify GREEN and commit**

Run the RED command again; expected PASS.

```powershell
git add -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/styles.css src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx
git commit -m "feat(old-favorites): add current and whole-run views"
```

## Task 5: Checkpoint-aware DeepSeek all-segment continuation

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [ ] **Step 1: Write failing continuation tests**

Start an all-segment run with segment 1 ready and segment 2 tagging. Assert segment 1 completes, segment 2 waits, the same mode resumes when segment 2 becomes ready, cancellation leaves segment 1's checkpoint, and retry skips it.

- [ ] **Step 2: Verify RED**

Run: `node_modules\.bin\vitest.cmd run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx --reporter=dot`

Expected: FAIL where the existing run ends or restarts instead of waiting/resuming from a checkpoint.

- [ ] **Step 3: Persist a compact run intent**

Persist mode, scope, completed segment IDs, waiting segment IDs, and cancellation state. Schedule the next ready segment through the existing async command path; do not loop over unloaded items in renderer. Treat user cancellation as a non-failure terminal state with resumable checkpoints.

- [ ] **Step 4: Verify GREEN and commit**

Run the RED command again; expected PASS.

```powershell
git add -- electron/main/oldFavoriteWorkspaceCoordinator.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx
git commit -m "fix(old-favorites): resume whole-run DeepSeek by checkpoint"
```

## Task 6: Restore multi-target transfer semantics and target focus

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoritePreviewCard.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoritePreviewCard.test.tsx`

- [ ] **Step 1: Write failing 1.0.5 contract tests**

Assert every target ledger receives a multi-target card. From group A, moving `[A, B]` to C must emit `[B, C]`, not `[C]`. Removing from current group emits `[B]`; removing from all emits `[]`. Assert the moved card becomes the first item in C, both horizontal tracks reset to zero, and C receives `scrollIntoView`.

- [ ] **Step 2: Verify RED**

Run: `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/OldFavoritePreviewCard.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx --reporter=dot`

Expected: FAIL because grouping reads only target index zero and single-target actions replace the full array.

- [ ] **Step 3: Implement sparse group indexes**

Change grouping to index each item into up to three known target groups. Pass `currentLedgerId` and `originalTargetLedgerIds` to the card. Replace only the current target for single transfer, normalize/deduplicate to three entries, and store a small `recentlyMovedAidByLedgerId` ordering map rather than sorting every group.

- [ ] **Step 4: Add stable focus effects**

Attach refs by group ID. After a successful local projection, reset source/target track `scrollLeft`, call target `scrollIntoView({ block: 'nearest' })`, and render `原分类：…` plus a short `原分类 → 新分类` status.

- [ ] **Step 5: Verify GREEN and commit**

Run the RED command again; expected PASS.

```powershell
git add -- src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx src/renderer/src/features/assistant/OldFavoritePreviewCard.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/OldFavoritePreviewCard.test.tsx
git commit -m "fix(old-favorites): restore multi-target archive transfers"
```

## Task 7: Detailed compact history and keyboard undo/redo

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [ ] **Step 1: Write failing history tests**

Require renderer entries to include compact samples and batch reason without the full classification graph:

```ts
summary: {
  title?: string
  beforeTargetLedgerIds: string[]
  afterTargetLedgerIds: string[]
  reason: string
  movedCount: number
}
```

Assert `Ctrl+Z`, `Ctrl+Shift+Z`, and `Ctrl+Y` invoke the same callbacks as buttons, respect baseline/length locks, and do nothing from `input`, `textarea`, `select`, or `contenteditable` targets.

- [ ] **Step 2: Verify RED**

Run: `node_modules\.bin\vitest.cmd run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx --reporter=dot`

Expected: FAIL because current entries only contain source/count/target IDs and no page keydown handler exists.

- [ ] **Step 3: Project sparse readable summaries and register shortcuts**

Create summaries from the existing durable before/after changes at snapshot time. A bulk operation emits one aggregate entry plus a bounded first-title sample. Register one document listener while archive preview is active; call `preventDefault()` only when a valid undo/redo command actually runs.

- [ ] **Step 4: Verify GREEN and commit**

Run the RED command again; expected PASS.

```powershell
git add -- src/shared/oldFavoriteWorkspace.ts electron/main/oldFavoriteWorkspaceCoordinator.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx
git commit -m "fix(old-favorites): restore archive history and shortcuts"
```

## Task 8: Card outline, shared tooltip, and fixed virtual height

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoritePreviewCard.tsx`
- Modify: `src/renderer/src/features/favorites/VirtualOldFavoriteTrack.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/OldFavoritePreviewCard.test.tsx`
- Test: `src/renderer/src/features/favorites/VirtualOldFavoriteTrack.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [ ] **Step 1: Write failing visual-contract tests**

Assert the article owns the full outline class, title/source/tags expose complete text on hover/focus through one portal tooltip, Escape closes it, and expanding more than 50 items retains an explicit fixed cell height.

- [ ] **Step 2: Verify RED**

Run: `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/OldFavoritePreviewCard.test.tsx src/renderer/src/features/favorites/VirtualOldFavoriteTrack.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx --reporter=dot`

Expected: FAIL because the outline is split, no shared tooltip exists, and virtual cards can inherit `height: 100%`.

- [ ] **Step 3: Implement stable presentation**

Move border/radius/background to the outer article, set one CSS custom property for card/cell height, clamp visible text, and mount a single tooltip portal only while a field is hovered or focused. Use semantic theme tokens and keep existing colors/typography.

- [ ] **Step 4: Run UX validation query and verify GREEN**

Run: `python C:\Users\diqing\.codex\skills\ui-ux-pro-max\scripts\search.py "animation accessibility z-index loading" --domain ux -n 12`

Run the RED test command again; expected PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/renderer/src/features/assistant/OldFavoritePreviewCard.tsx src/renderer/src/features/favorites/VirtualOldFavoriteTrack.tsx src/renderer/src/styles.css src/renderer/src/features/assistant/OldFavoritePreviewCard.test.tsx src/renderer/src/features/favorites/VirtualOldFavoriteTrack.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx
git commit -m "fix(old-favorites): stabilize archive preview cards"
```

## Task 9: Integrated regression and real Electron acceptance

**Files:**
- Create evidence under: `.codex-artifacts/old-favorite-overview-restoration/`
- Modify only tests or production files required by a reproduced failure.

- [ ] **Step 1: Run focused regression**

```powershell
node_modules\.bin\vitest.cmd run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteRepositoryService.test.ts electron/main/favoriteRepositoryIpc.test.ts src/shared/oldFavoriteWorkspace.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/OldFavoritePreviewCard.test.tsx src/renderer/src/features/favorites/VirtualOldFavoriteTrack.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx --reporter=dot
```

Expected: all tests pass; record existing React `act(...)` warnings separately rather than describing them as new failures.

- [ ] **Step 2: Run the broader old-favorite regression**

Run the previously established 23-file old-favorite regression set and save console output to `.codex-artifacts/old-favorite-overview-restoration/` using the existing evidence convention. Expected: no new failed test.

- [ ] **Step 3: Start the development app**

Run: `node_modules\.bin\electron-vite.cmd dev`

Do not package or open the installed build.

- [ ] **Step 4: Exercise real UI paths**

Verify single and multiple segments; scan/recommendation/archive current/all views; whole-run DeepSeek waiting/cancel/resume; transfer into one and multiple targets; target-left ordering; original-category message; history buttons and shortcuts; expand/collapse fixed height; final confirmation.

- [ ] **Step 5: Measure responsiveness**

For a 2000-item current segment, record click-to-feedback samples and confirm pointer movement, sidebar interaction, minimize, and close remain responsive during async work. Report measured samples and do not generalize beyond them.

- [ ] **Step 6: Final local checkpoint**

```powershell
git status --short
git diff --check
git log --oneline -10
```

Commit only verified residual fixes with a narrow message. Do not push.

# Draft Visibility, Recommendation, and Sync Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline for this user-authorized local-main task). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the agreed draft presentation rules, keep recommendation selection and work-folder selection synchronized, and add safe pause/continue controls for active Bilibili writes.

**Architecture:** Keep UI presentation state (`guideOpen`) independent from persisted draft existence. Make the renderer project one round-selection change through both the recommendation store and the ledger enable store. Add a persisted user-paused state to the existing frozen Bilibili plan lifecycle so the current remote request is allowed to finish while unstarted operations remain resumable.

**Tech Stack:** Electron main/preload/renderer, React, TypeScript, Vitest.

---

### Task 1: Record and test draft-card visibility separately from draft existence

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Write failing renderer tests**

```ts
it('keeps a recovered unfinished draft hidden until the user opens organize favorites', async () => {
  // initial snapshot is previewing; assert no guide, normal card binding label;
  // click 整理收藏 and 继续上次整理; assert guide exists and card binding label is hidden.
})

it('shows only unsaved on cards while the guide is visible but preserves detail binding status', () => {
  // render an unsaved, unbound ledger with hasExpandedOrganizationGuide;
  // card is 未保存, editor remains 未保存 · 未绑定.
})
```

- [x] **Step 2: Run the two tests and verify they fail because the snapshot auto-opens the guide and cards expose binding states**

Run: `npm test -- ControlledFavoriteLedgerPanel.test.tsx FavoriteLedgerOverview.test.tsx`

Expected: the new assertions fail before production changes.

- [x] **Step 3: Implement the presentation-only gate**

```ts
// ControlledFavoriteLedgerPanel: do not call setGuideOpen(true) merely because
// an initial persisted snapshot exists; open only through the explicit organize,
// scan, recovery, or selection handlers.

// FavoriteLedgerOverview:
const statusLabelForLedger = (ledger: FavoriteLedger) => {
  const unsaved = ledgerHasUnsavedChanges(ledger)
  if (hasExpandedOrganizationGuide) return unsaved ? '未保存' : ''
  const bindingLabel = bindingLabelForLedger(ledger)
  return bindingLabel === '未绑定' && unsaved ? '未保存 · 未绑定' : bindingLabel || (unsaved ? '未保存' : '')
}
```

- [x] **Step 4: Run the focused renderer tests and confirm they pass**

Run: `npm test -- ControlledFavoriteLedgerPanel.test.tsx FavoriteLedgerOverview.test.tsx`

Expected: PASS, including pre-existing close/resume tests.

### Task 2: Make recommendation selection and top ledger enablement one round interaction

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.test.tsx`

- [x] **Step 1: Write failing selection tests**

```ts
it('updates the matching top ledger when a recommended candidate is toggled', async () => {
  // toggle an existing recommendation below; assert the matching top enable control changes.
})

it('removes an unbacked recommended draft but only disables backed or unbound recommendations', async () => {
  // assert local deletion only for the unbacked candidate and no Bilibili deletion command.
})

it('keeps the same recommended targets in single-batch and whole-run views', async () => {
  // toggle in each view and assert selected target IDs are identical.
})
```

- [x] **Step 2: Run the focused tests and verify they fail because lower controls only update recommendedCandidateIds**

Run: `npm test -- ControlledFavoriteLedgerPanel.test.tsx OldFavoriteRecommendationStep.test.tsx`

Expected: new lower-to-upper and deletion assertions fail before production changes.

- [x] **Step 3: Route both control surfaces through one candidate mutation**

```ts
const setRecommendedCandidateEnabled = (ledgerId: string, enabled: boolean) => {
  // update the workspace adopted candidate IDs first;
  // update the matching enable map immediately;
  // when disabled, delete only a local unbacked recommendation draft;
  // for bound or unbound-with-remote candidates, retain the local ledger and set enabled false.
}
```

- [x] **Step 4: Run the focused tests and confirm they pass**

Run: `npm test -- ControlledFavoriteLedgerPanel.test.tsx OldFavoriteRecommendationStep.test.tsx`

Expected: PASS, including existing preview and confirmation-target tests.

### Task 3: Add a persisted, safe Bilibili pause lifecycle

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Write failing service and coordinator tests**

```ts
it('finishes the active write then freezes the remaining plan for user continuation', async () => {
  // request pause while the first remote append is active;
  // complete it; assert the workspace and frozenSyncPlan remain with only later operations pending.
})

it('continues a user-paused frozen plan without replaying completed single- or multi-batch operations', async () => {
  // resume the same persisted plan and assert only pending operation keys are written.
})
```

- [x] **Step 2: Run the main-process tests and verify they fail because stopAndAbandonFrozenPlan removes the plan**

Run: `npm test -- favoriteRepositorySyncService.test.ts oldFavoriteWorkspaceCoordinator.test.ts`

Expected: pause-preservation assertions fail before production changes.

- [x] **Step 3: Add separate pause and finish operations**

```ts
// Sync service: pause requests stop new operations after the active request,
// persists workspace status 'frozen' with its plan and checkpoints intact.
// Existing stopAndAbandonFrozenPlan remains the end-round path.

// Coordinator: expose pauseBilibiliSync and resume the retained frozen plan.
// IPC/preload/shared command union: add only pause-bilibili-sync.
```

- [x] **Step 4: Run the main-process tests and confirm they pass**

Run: `npm test -- favoriteRepositorySyncService.test.ts oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS, with existing retry, reconciliation, idempotency, and end-round tests still green.

### Task 4: Expose the two Bilibili execution controls in both batch modes

**Files:**
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 1: Write failing UI tests**

```ts
it('shows pause and end controls while a single-batch Bilibili plan executes', () => {
  // assert 暂停同步 and 结束本轮整理 beside the progress bar.
})

it('shows continue and end controls for a user-paused whole-run plan', () => {
  // assert 继续同步 invokes the retained-plan execution path without changing view scope.
})
```

- [x] **Step 2: Run the confirmation tests and verify they fail because executing currently renders only the stop-and-end button**

Run: `npm test -- OldFavoriteConfirmationStep.test.tsx ControlledFavoriteLedgerPanel.test.tsx`

Expected: the pause/continue controls are absent before production changes.

- [x] **Step 3: Render the requested controls**

```tsx
<button onClick={paused ? onResumeBilibiliSync : onPauseBilibiliSync}>
  {paused ? '继续同步' : '暂停同步'}
</button>
<button onClick={() => setStopSyncDialogOpen(true)}>结束本轮整理</button>
```

- [x] **Step 4: Run the confirmation tests and confirm they pass**

Run: `npm test -- OldFavoriteConfirmationStep.test.tsx ControlledFavoriteLedgerPanel.test.tsx`

Expected: PASS for both current-batch and whole-run modes, paused retry state, end dialog, and progress labels.

### Task 5: Verify the complete requested surface and record evidence

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-15-deepseek-recovery-decision-stale.md`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Run focused regression suites and static build**

Run: `npm test -- FavoriteLedgerOverview.test.tsx ControlledFavoriteLedgerPanel.test.tsx OldFavoriteRecommendationStep.test.tsx OldFavoriteConfirmationStep.test.tsx favoriteRepositorySyncService.test.ts oldFavoriteWorkspaceCoordinator.test.ts`

Run: `npm run build`

Expected: all selected tests and production build pass.

- [x] **Step 2: Run Electron development validation without changing user data**

```text
Use isolated test fixtures to exercise: hidden-restored draft -> resume -> visible card;
unbacked/bound/unbound recommendation cancellation; single- and multi-batch pause -> continue;
pause -> end. Record screenshots/logs under .codex-artifacts/.
```

- [x] **Step 3: Update ledger index with file locations, automated output, and any unavailable real-Electron evidence**

```text
For I006, I007, and I008, record distinct test names and observed UI behavior.
Do not claim Bilibili remote execution validation if only mocked fixtures ran.
```

- [x] **Step 4: Commit only the current-theme files after diff, status, and verification checks**

Run: `git diff --check && git status --short`

Expected: current-theme files staged; `docs/requirement-ledgers/2026-08-15-local-only-deletion-binding-state-persistence.md` remains untracked and unstaged.

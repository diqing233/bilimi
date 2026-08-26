# Saved Favorite Rule Toggle Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure an upper saved-rule toggle never deletes its linked lower recommendation draft, including an unbacked persisted rule carrying `syncState: 'local-draft'`; a lower re-check restores the same saved rule by stable ID; and heavy returned classification snapshots do not block subsequent pointer input.

**Architecture:** `ControlledFavoriteLedgerPanel` separates the persistent upper-rule membership (the incoming ledger directory) from the transient recommended-candidate projection. Stable-ID membership, not `syncState`, decides whether an action targets a saved upper rule or a pure lower draft. The main-process enabled-preference IPC remains narrow; the existing affected-AID recommendation classifier remains authoritative, while its returned renderer snapshot is published as a React transition so input remains responsive.

**Tech Stack:** React, TypeScript, Vitest, Electron IPC.

---

### Task 1: Stable-ID toggle routing and performance regression tests

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

- [x] **Step 1: Preserve the failing lower re-check regression**

```ts
fireEvent.click(await screen.findByRole('checkbox', { name: 'honker233', checked: false }))
await waitFor(() => expect(saveEnabled).toHaveBeenCalledWith('custom-honker', true))
expect(command).toHaveBeenCalledWith('100', {
  type: 'set-round-excluded-ledger-ids', ledgerIds: []
})
```

- [x] **Step 2: Run the focused tests and observe the missing enabled save**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

Expected: the saved-rule restore test fails because the lower control writes only recommendation selection; the IPC no-full-reclassification test passes.

### Task 2: Route lower recommendation re-check to the linked saved rule

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:407-419`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 1: Resolve changed recommendation IDs through `createRecommendationProjection`**

```ts
const selectedCandidateId = next.find((candidateId) => !current.includes(candidateId))
const linkedSavedLedgerId = selectedCandidateId
  ? createRecommendationProjection(effectiveLedgers, snapshot.recommendations.candidates)
      .candidateToLedgerId.get(selectedCandidateId)
  : undefined
```

- [x] **Step 2: Delegate a re-check of a disabled linked saved rule to the saved-rule participation transaction**

```ts
if (linkedSavedLedgerId && effectiveLedgerEnabledById.get(linkedSavedLedgerId) === false) {
  void setOrganizationSavedLedgerParticipation(linkedSavedLedgerId, true)
  return
}
void setOrganizationRecommendedCandidates(next)
```

- [x] **Step 3: Run the focused tests and confirm all pass**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

Expected: both upper-cancel retention and lower re-check pass; the enabled IPC does not contain a full reclassification.

### Task 3: Record evidence and complete regression checks

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-25-favorite-rule-selection-and-history-linkage.md`

- [x] **Step 1: Record I009’s code locations, automated evidence, and unperformed Electron/remote verification**

- [x] **Step 2: Run focused panel and overview tests, then the full test suite and production build**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`; `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`; `npm test`; `npm run build`; `git diff --check`.

- [ ] **Step 3: Commit only the I009 files and this plan after the checks pass**

```powershell
git add docs/superpowers/plans/2026-08-26-favorite-saved-rule-toggle-integrity.md docs/requirement-ledgers/2026-08-25-favorite-rule-selection-and-history-linkage.md electron/main/index.ts electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx
git commit -m "fix: keep saved favorite rules on upper toggle"
```

## Execution status

- Identity, IPC, overview, workspace and coordinator focused regressions pass (689/689); full `npm test` passes (240 files / 4089 tests); `npm run build` passes.
- Electron opened the saved-rule list read-only and saved the screenshot, but the current account had no safe active recommendation draft. The persisted toggle/re-check interaction remains explicitly unverified in a live account data scenario.

### Task 4: Cover persisted-unbacked upper rules and preserve their action identity

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [x] **Step 1: Write the failing regression using the persisted `local-draft` representation**

```ts
render(<ControlledFavoriteLedgerPanel
  currentAccountMid="100"
  ledgers={[{ id: 'custom-honker', syncState: 'local-draft', /* saved upper-rule fields */ }]}
  /* active workspace with an identically-IDed recommendation */
/>)
expect(screen.getByRole('button', { name: '移出同步 bilimi·honker233' })).toBeEnabled()
fireEvent.click(screen.getByRole('button', { name: '移出同步 bilimi·honker233' }))
await waitFor(() => expect(saveEnabled).toHaveBeenCalledWith('custom-honker', false))
expect(screen.getByRole('button', { name: 'honker233' })).toBeInTheDocument()
```

- [x] **Step 2: Run it and observe the current wrong routing/disabled-control failure**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: FAIL because `syncState: 'local-draft'` is currently used as an upper-rule identity test.

- [x] **Step 3: Use incoming-directory stable IDs for upper-rule mapping**

```ts
const persistedUpperLedgerIds = new Set(ledgers
  .filter((ledger) => isSavedUpperLedger(ledger))
  .map((ledger) => ledger.id))
```

Use this identity set for the upper selection map and for finding a linked saved rule. `isSavedUpperLedger` accepts a non-draft rule or an explicit persisted identity (`bindingState` / exact remote ID), so a plain candidate-only local draft cannot become an upper rule just because it shares a candidate ID. Keep remote-only discovered drafts disabled through their existing remote-draft guard.

- [x] **Step 4: Permit that mapped upper control while retaining the existing remote-draft block**

```ts
const isOperable = (ledger: FavoriteLedger, unsavedLedgerIds = locallyUnsavedLedgerIds) =>
  !unsavedLedgerIds.has(ledger.id) &&
  (ledger.syncState !== 'local-draft' || organizationSavedLedgerEnabledById?.has(ledger.id)) &&
  !isRecoveredRemoteDraft(ledger) /* existing remaining guards */
```

- [x] **Step 5: Re-run the panel regression and the overview regression**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: PASS; only a lower pure recommendation can delete its draft.

### Task 5: Publish returned recommendation snapshots as non-blocking UI work

**Files:**
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [x] **Step 1: Write a failing regression for returned-snapshot transition publication**

The existing immediate-selection/coalescing regression preserves the input semantics. Add a focused mocked React transition regression that stages a selection, returns the authoritative snapshot, and verifies that only snapshot publication uses `startTransition`.

- [x] **Step 2: Run the focused hook test and verify the failure is about synchronous snapshot publication**

Run: `npm test -- src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [x] **Step 3: Transition only the returned recommendation snapshot**

```ts
startTransition(() => setSnapshot(next))
```

Keep `recommendedCandidateIdsRef`, the displayed selection and the command coalescing path synchronous; do not transition or defer the authoritative persistence request, the error rollback, or the execution/preflight guards.

- [x] **Step 4: Re-run the hook, panel and coordinator classification regressions**

Run: `npm test -- src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS; affected-AID recomputation remains authoritative and cancellation-aware.

### Task 6: Electron and final verification

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-25-favorite-rule-selection-and-history-linkage.md`

- [ ] **Step 1: Start the Electron development build and run the non-B站 interaction check**

Click an upper persisted unbacked rule once, observe the linked lower recommendation remains present and becomes unchecked, then click it back to restore the upper rule. Do not press backup, bind, delete, confirm sync, or any B站 write control. Observe mouse movement, scrolling, resizing, minimizing and closing while the affected-AID result returns.

Current result: development Electron opened in read-only mode, but this account had no active recommendation draft that could be safely exercised. The interaction remains unverified rather than inferred from the static rule list.

- [x] **Step 2: Save the screenshot under `.codex-artifacts/` and record its path plus any limitation**

- [x] **Step 3: Run final checks and commit only this theme**

Run: `npm test`; `npm run build`; `git diff --check`; `git diff --stat`; `git status --short`.

Commit candidates are limited to the plan, ledger, panel/overview/workspace hook and their tests, plus the existing narrow enabled IPC files only if still necessary. Never add `pnpm-lock.yaml` or `pnpm-workspace.yaml`.

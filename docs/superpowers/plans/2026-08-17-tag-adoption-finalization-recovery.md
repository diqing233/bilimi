# Tag Adoption Finalization Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an already scanned and classified draft finish `采用当前标签`, then restore its existing save and sync eligibility without rescanning or changing user data.

**Architecture:** Keep cutoff publication, recommendation refresh, and complete classification within the coordinator's authority queue. Persist a specific adoption failure when recomputation cannot complete, so confirmation presents that condition before its generic pending-tag warning. Preserve the current worktree and classifications in every failure branch.

**Tech Stack:** Electron main process, TypeScript, Vitest, React confirmation component, workspace overlay journal.

---

### Task 1: Reproduce the stalled current draft

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Cover the adopted-cutoff and failed-recomputation paths**

```ts
it('publishes an adopted cutoff for a fully classified multi-segment draft with zero pending tags', async () => {
  await coordinator.acceptCurrentTags('100')

  await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
    tagEnrichment: {
      wholeRunTagCutoffAccepted: true,
      pendingItemCount: 0,
      failedItemCount: 0
    }
  })
})
```

- [x] **Step 2: Run the regression before production changes**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "does not publish an adopted cutoff when the complete reclassification fails"`

Result: failed as expected before implementation because the snapshot had no `tagAdoption` failure projection. Existing adopted-cutoff coverage remains in `saves the complete scanned range after accepting the current tag cutoff`.

### Task 2: Persist a complete adoption outcome

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Add a durable adoption-progress/failure projection**

```ts
type TagAdoption = {
  status: 'recomputing' | 'failed'
  failureCode?: 'classification-recompute-failed'
  failureDetail?: string
}
```

Thread it through the overlay, recovery result, coordinator runtime, and public snapshot. Clear it only when the complete cutoff is stored or new tag work is deliberately resumed.

- [x] **Step 2: Finalize the cutoff only after projection work succeeds**

```ts
const accepted = buildAcceptedTagCutoff(workspace, paused)
await rebuildRecommendationsAndClassifications(workspace, accepted)
await workspaceStore.appendOverlay(accountMid, workspaceId, {
  currentSegmentId,
  classifications: [],
  history: [],
  tagEnrichment: accepted,
  tagAdoption: null
})
```

On recomputation failure, preserve `paused`, persist `tagAdoption: { status: 'failed', failureCode: 'classification-recompute-failed' }`, retain prior classifications and rethrow. Do not save locally, freeze a plan, or contact B station.

- [x] **Step 3: Run focused coordinator regressions**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Result: 298/298 passed. The failure state is also asserted after coordinator reconstruction.

### Task 3: Show the correct confirmation blocker

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [x] **Step 1: Write the failing component test**

```tsx
expect(screen.getByText('采用当前标签未完成：本轮分类重算失败，请在当前草稿重试采用。')).toBeInTheDocument()
expect(screen.queryByText(/仍有 0 条待补取或读取失败/)).not.toBeInTheDocument()
```

- [x] **Step 2: Run the focused test before UI changes**

Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx -t "adoption recomputation failure"`

Expected: FAIL because no adoption-failure branch exists.

- [x] **Step 3: Add the adoption-failure branch before generic tag warnings**

Keep save and sync disabled; keep the end-round action and existing classifications intact.

- [x] **Step 4: Run the component suite**

Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

Result: 37/37 passed.

### Task 4: Verify the real draft and record the audit trail

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-17-confirm-execution-missing-sync-plan.md`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [x] **Step 1: Run focused suites**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

Result: coordinator 298/298, confirmation component 37/37, workspace store 35/35.

- [x] **Step 2: Run full verification**

Run: `npm test` and `npm run build`

Result: `npm test` passed 234 test files / 3850 tests; `npm run build` exited 0.

- [x] **Step 3: Preserve the existing Electron draft without a write action**

The ledger prohibits a real retry/adoption in the existing user draft during this implementation. No save, B station sync, end-round, retry, cancel, cleanup, rescan, reorganization, or user-data mutation was performed. The new automated recovery and rendered confirmation tests cover this state; real-draft acceptance remains a user-facing acceptance check.

- [x] **Step 4: Update the ledger and commit one local `main` change**

Record R001-R003 code paths, focused/full test outputs, build output, and UI observation. Then run `git diff --check` and commit only the listed topic files.

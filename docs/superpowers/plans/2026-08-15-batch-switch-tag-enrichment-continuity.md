# Batch Switch Tag Enrichment Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switching a reorganization batch must not pause a running global tag-enrichment queue, while a real coordinator/application restore still pauses that queue safely.

**Architecture:** `selectSegment` currently invokes the same store-recovery path as an application restart. Add an explicit recovery-policy argument to that private path: ordinary restore retains the current safety pause; segment selection requests a reload that preserves an already-running tag queue. Keep queue state, persistence format, renderer snapshot derivation, and remote behavior unchanged.

**Tech Stack:** TypeScript, Electron main process, Vitest.

---

### Task 1: Lock in the two recovery policies with a failing regression test

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Write the failing test**

Add a two-segment scan with 501 untagged AIDs and a 500-item segment size. After `selectSegment('100', 'segment-2')`, assert that the snapshot retains `tagEnrichment.status: 'running'`, that the whole-run queue retains 501 pending items, that the new current segment reports its one pending item, and that `getPendingTagEnrichmentAids('100')` remains non-empty.

```ts
await coordinator.selectSegment('100', 'segment-2')
await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
  tagEnrichment: {
    status: 'running',
    scopes: {
      wholeRun: { pendingItemCount: 501 },
      currentSegment: { pendingItemCount: 1 }
    }
  }
})
await expect(coordinator.getPendingTagEnrichmentAids('100')).resolves.toEqual(
  Array.from({ length: 500 }, (_unused, index) => index + 1)
)
```

- [x] **Step 2: Run the targeted test to verify it fails**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "keeps a running tag-enrichment queue running when switching batches"`

Expected: FAIL because segment selection enters `restoreFromStore`, which persists `status: 'paused'`; the snapshot is `paused` and the pending-AID call returns `[]`.

### Task 2: Separate batch reload from true restore without changing the recovery safety policy

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:2853-2867,4581-4920`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Add the smallest policy input to the private restore method**

Extend `restoreFromStore` with a private option whose default represents a true application/workspace restore. In each existing running-and-pending tag branch, condition the persistent transition to `paused` on that default policy. Do not change tag counts, accepted segments, pending AIDs, scanner state, DeepSeek state, Bilibili sync behavior, or overlay formats.

```ts
private async restoreFromStore(
  marker: FavoriteRepositoryWorkspace,
  updatedAt: string,
  repositorySnapshot: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>>,
  options: { pauseRunningTagEnrichment?: boolean } = {}
)
```

Use `options.pauseRunningTagEnrichment !== false` around the existing `appendTagEnrichmentDelta(... status: 'paused')` and in-memory status assignment.

- [x] **Step 2: Mark only segment selection as a non-pausing reload**

Pass `{ pauseRunningTagEnrichment: false }` only from `selectSegment`. Leave `openUnsafe` and all genuine restore callers on the default policy.

```ts
const restored = await this.restoreFromStore(snapshot.workspace, snapshot.updatedAt, snapshot, {
  pauseRunningTagEnrichment: false
})
```

- [x] **Step 3: Run the new focused test and the existing restart test**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "keeps a running tag-enrichment queue running when switching batches|adopts only the current batch tags while later batches keep enriching and can resume after restart"`

Expected: PASS. The new test proves a batch switch stays running; the existing test proves a newly constructed coordinator still reports paused until explicit resume.

### Task 3: Verify the protected paths and record evidence

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-15-batch-switch-scan-label-pause.md`
- Modify: `docs/superpowers/plans/2026-08-15-batch-switch-tag-enrichment-continuity.md`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Run the coordinator test file and type/build check**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts` and `npm run build`.

Expected: both commands exit successfully. This protects the coordinator's scanning, classification, recovery, save, remote-sync and tag-enrichment paths while confirming the TypeScript/Electron build remains valid.

- [x] **Step 2: Review the source boundary and worktree**

Run: `git diff --check`, `git diff --stat`, and `git status --short`.

Expected: only the coordinator, its test, this plan, and the current-round ledger are changed; the unrelated untracked deletion/binding ledger remains unmodified and unstaged.

- [x] **Step 3: Update the ledger with implementation locations and evidence**

Record the exact source/test locations, targeted and full-file test results, build result, and that real Electron interaction cannot be certified unless the desktop automation context is available. Do not claim the screenshot state has been manually validated without that evidence.

## Verification result

- The new regression test first failed with `tagEnrichment.status: 'paused'` after `selectSegment`, then passed after the minimal policy change.
- The paired recovery test retained the deliberate post-restart pause behavior.
- `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts` passed 280/280 tests; `npm run build` passed.
- Real Electron interaction was not certified because the available Windows automation runtime did not expose its documented UI-control interface. No user data, Bilibili data, or running application state was changed for this verification.

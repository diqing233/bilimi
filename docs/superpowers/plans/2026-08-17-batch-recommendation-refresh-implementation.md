# Batch Recommendation Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore immediate recommendation, archive-preview, and system-classification refresh when a resumed tag batch completes, while keeping a changed post-adoption tag cutoff ineligible for whole-run saving or Bilibili sync until re-adoption.

**Architecture:** Keep tag-version history as the authority for whether an accepted whole-run cutoff remains valid. Decouple that immutable execution-cutoff check from the mutable draft projection: every completed tag batch updates the recommendation index and draft projections; only `acceptCurrentTags` publishes a new accepted cutoff and restores whole-run execution eligibility. Current-batch local saving remains scoped to a ready batch and does not enable Bilibili sync.

**Tech Stack:** TypeScript, Electron main-process coordinator, Vitest, React confirmation UI (regression coverage only), Markdown product contract and requirement ledger.

---

### Task 1: Record the final product contract before runtime work

**Files:**
- Modify: `docs/项目功能项目书.md:226-254`
- Modify: `docs/requirement-ledgers/2026-08-17-batch-recommendation-regression.md`

- [x] **Step 1: Define batch completion as an automatic draft projection update**

  Add the explicit rule that every newly completed/changed tag batch refreshes recommendations, archive preview, and applicable system classification without creating an adopted cutoff, toggling execution eligibility, selecting recommendations, or writing local/remote folders.

- [x] **Step 2: Define post-adoption continuation precisely**

  State that historical accepted tag versions invalidate the whole-run cutoff after `继续补取标签`, but cannot block subsequent batch-result projections. State that re-adoption, not automatic projection, restores whole-run save/sync eligibility.

- [x] **Step 3: Define multi-batch execution scope**

  State that a completed current batch enables only `保存本批到收藏库`; `确认并同步到 B 站` remains a whole-run operation available only after the adopted, safely-paused whole-run snapshot is published.

### Task 2: Write a failing main-process regression test

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:3112-3358`

- [x] **Step 1: Change the continuation regression to expect a draft refresh**

  Use the existing accepted-cutoff continuation setup: scan two items, record item 1, call `acceptCurrentTags`, remember the `classifyCurrentItem` call count, call `resumeTagEnrichment`, then record item 2. Change the assertion after recording item 2 from equality to a greater-than count and assert this snapshot shape:

  ```ts
  await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
    tagEnrichment: {
      wholeRunTagCutoffAccepted: false,
      currentSegmentHasUnacceptedTagChanges: true
    }
  })
  expect(classifyCurrentItem.mock.calls.length).toBeGreaterThan(classificationCountAfterAcceptance)
  ```

- [x] **Step 2: Run the focused test and observe RED**

  Run:

  ```powershell
  npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "refreshes recommendations after a resumed tag batch completes"
  ```

  Expected before production change: the test fails because `currentSegmentWasNotYetAdopted` is false after the earlier acceptance, so no new classification/recommendation projection is rebuilt.

### Task 3: Remove the stale historical-adoption gate from batch projection refresh

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:4275-4300`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:3112-3358`

- [x] **Step 1: Delete only the gate that conflates historical acceptance with current execution eligibility**

  In `recordTagEnrichment`, remove `currentSegmentWasNotYetAdopted` and make the existing completion condition depend solely on the workspace still being previewable and on one of the existing projection triggers:

  ```ts
  if (workspace.status === 'previewing' &&
    (readySegmentIds.length || !pendingAids.length || currentSegmentCompleted)) {
  ```

  Leave the existing order intact: persist tag fact, update recommendation index, update in-memory enrichment/overview, rebuild recommendations, refresh the overlay, then classify only the newly ready/current relevant segment(s).

- [x] **Step 2: Prevent a resumed natural completion from becoming an implicit adoption**

  In `hasWholeRunTagCutoffAccepted`, retain the natural-completion shortcut only when no historical accepted-tag version exists. A `complete` queue that follows `继续补取标签` must continue through the accepted-version equality check and therefore remain ineligible until `acceptCurrentTags` records the new version. Do not change `acceptCurrentTags` or confirmation-button predicates.

- [x] **Step 3: Preserve the execution-cutoff guard**

  A new/changed post-adoption tag result must leave `wholeRunTagCutoffAccepted: false` and require a later explicit `acceptCurrentTags` call before whole-run save or sync. The regression test's first failure proves this boundary before the refresh-condition change is made.

- [x] **Step 4: Run the focused test and observe GREEN**

  Run:

  ```powershell
  npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "refreshes recommendations after a resumed tag batch completes"
  ```

  Expected: PASS; system classification is refreshed, but the snapshot still reports an unaccepted change and no valid whole-run cutoff.

### Task 4: Preserve the in-flight safety boundary with updated expectations

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:3278-3361`

- [x] **Step 1: Replace obsolete test names and assertions**

  Rename `does not rebuild system classifications until an in-flight tag result is adopted` to describe immediate draft refresh while the adopted cutoff becomes stale. Rename `waits for explicit re-adoption before rebuilding an in-flight tag result` to describe explicit re-adoption as restoring the cutoff, not as the first time projections can refresh.

- [x] **Step 2: Assert the two separate facts**

  After an in-flight result returns, assert a classification call-count increase and `currentSegmentHasUnacceptedTagChanges: true`. After `acceptCurrentTags`, assert `status: 'accepted'`, `wholeRunTagCutoffAccepted: true`, and the unchanged manual classification/recommended-candidate preservation test remains green.

- [x] **Step 3: Run the focused coordinator suite**

  Run:

  ```powershell
  npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts
  ```

  Expected: all coordinator tests pass, including resume, restart recovery, adopted cutoff invalidation, manual classification preservation, and in-flight result safety.

### Task 5: Verify protected UI boundaries and record evidence

**Files:**
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Modify: `docs/requirement-ledgers/2026-08-17-batch-recommendation-regression.md`

- [x] **Step 1: Run the confirmation-step regression tests unchanged**

  Run:

  ```powershell
  npm test -- src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx
  ```

  Expected: a ready current batch retains `保存本批到收藏库`; `确认并同步到 B 站` remains governed by whole-run readiness and the accepted cutoff.

- [x] **Step 2: Run repository-wide verification**

  Run:

  ```powershell
  npm test
  npm run build
  git diff --check
  ```

  Expected: all tests and build pass, and the diff has no whitespace errors.

- [x] **Step 3: Record per-requirement evidence and known manual-verification boundary**

  Update the ledger index with exact production/test locations and command results. Record that automated tests do not perform real Bilibili, DeepSeek, or favorite-library writes; Electron manual verification requires a safe test workspace and must not be claimed unless actually performed.

- [x] **Step 4: Create the single local implementation commit**

  Stage only this plan, project book, ledger, coordinator, and relevant tests after verifying no unrelated changes. Commit once on `main` with:

  ```powershell
  git commit -m "fix: refresh recommendations after resumed tag batches"
  ```

# DeepSeek Cancel Progress And Ledger Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent canceled DeepSeek batches from inflating applied progress and keep actual backup status visible in the open favorite-folder detail editor during organization.

**Architecture:** Treat settled DeepSeek results as the only source for successful AIDs. The all-batch coordinator will merge the settled IDs already persisted by each group, will not complete a segment after cancellation, and will derive resumed progress from that durable checkpoint. Keep the organization-guide card masking behavior unchanged while making the detail editor status path explicit and regression-tested.

**Tech Stack:** TypeScript, Vitest, React Testing Library, Electron main-process coordinator/service.

---

### Task 1: Reproduce the canceled all-batch progress inflation

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`
- Reference: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts:257-289`

- [x] **Step 1: Write the failing test**

  Add a test with two ready segments. The first segment has 21 AIDs; the first provider response settles only AIDs 1-20, then cancellation occurs before the next request. Assert the persisted checkpoint contains `successfulAids` 1-20, keeps AID 21 pending, and does not mark the segment complete. Assert a reconstructed run requests AID 21 rather than treating it as already successful.

- [x] **Step 2: Run the focused test and verify it fails for the expected reason**

  Run `npm test -- --run electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts -t "does not count unprocessed all-batch aids after cancellation"`.

  Expected failure: the old implementation includes the unprocessed AID in `successfulAids` or marks the canceled segment completed.

### Task 2: Fix all-batch cancellation bookkeeping

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts:257-289`

- [x] **Step 1: Merge only settled processed AIDs after a segment run**

  Replace the post-segment `remainingAids` blanket insertion with the AIDs present in `segmentResult.progress.processedItems`. Preserve the per-group checkpoint updates as the durable source and do not infer success from an empty failure list.

- [x] **Step 2: Keep canceled segments incomplete**

  Only add a segment to `completedSegmentIds` when `segmentResult.canceled` is false and there are no failed AIDs. Leave the remaining AIDs pending when cancellation interrupts the segment.

- [x] **Step 3: Run the focused test and verify it passes**

  Re-run the Task 1 command. Expected result: PASS, with only settled AIDs counted and the canceled segment resumable.

### Task 3: Protect detail-page backup status during organization

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify if the test exposes a gap: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [x] **Step 1: Add the organizing-detail regression test**

  Render an active bound or explicitly unbacked ledger with `organizationActive` and `hasExpandedOrganizationGuide`, open its editor, and assert the name row still shows the actual backup label. Also assert the list chip retains the existing organization-guide masking behavior.

- [x] **Step 2: Run the focused renderer test**

  Run `npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "keeps detail state visible"` and confirm the test reflects the requested detail-page behavior.

- [x] **Step 3: Make the smallest renderer fix only if the test fails**

  Preserve the existing card masking branch; adjust only the detail status source/fallback needed for the test. Do not alter backup, binding, save, deletion, or B站 operations.

- [x] **Step 4: Re-run the focused renderer test**

  Expected result: PASS with the card masking and detail status both covered.

### Task 4: Verify and record the ledger evidence

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-15-deepseek-cancel-progress-and-ledger-status.md`

- [x] **Step 1: Run targeted service and renderer tests**

  Run the focused tests from Tasks 1-3 plus the existing DeepSeek service and FavoriteLedgerOverview test files.

- [x] **Step 2: Run `git diff --check` and inspect the diff**

  Confirm no unrelated files changed and that the implementation remains within the ledger scope.

- [x] **Step 3: Update each index row with code locations and evidence**

  Record the exact test names, command results, and any remaining Electron interface verification gap. Do not mark R002 complete without real detail-page interface evidence.

- [x] **Step 4: Commit the ledger and implementation together on local `main`**

  Use a focused commit message such as `fix: preserve DeepSeek cancellation progress` after all required verification succeeds.

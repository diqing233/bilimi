# Deletion and Tag Snapshot Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the established deletion-mode selection and tag-acceptance behaviors without changing Bilibili, backup, scan pause/resume, recovery, or DeepSeek semantics.

**Architecture:** The renderer keeps ordinary favorite selection and deletion selection in separate stores. Deletion mode must not inherit the ordinary default-system locking policy. The coordinator is the authoritative owner of tag acceptance, recommendation rebuilding, classification, and persisted workspace snapshots; every tag-ready transition must rebuild the recommendation projection before the renderer consumes the next snapshot. Recommendation cancellation must complete its persisted queue before a local ledger is removed from the renderer projection.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library.

**Requirement ledger:** `docs/requirement-ledgers/2026-08-16-deletion-mode-default-selection.md` (`R001`–`R009`, `I001`–`I011`).

---

### Task 1: Deletion-mode default-favorite selection

**Covers:** `R001`, `I001`.

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [x] **Step 1: Write failing UI regressions.**

Add one test with `organizationActive`, `defaultFavoriteSystemEnabled`, a default ledger, and a custom ledger. Enter deletion mode, assert the default ledger checkbox is enabled, select it, use the top bulk control to select all and cancel all, then exit deletion mode and assert the default ledger returns to its protected ordinary state. Add a focused store-level expectation through the rendered controls so the test proves `forceEnabledOnBulk` no longer overrides deletion mode.

- [x] **Step 2: Verify the tests fail for the current behavior.**

Run:

```powershell
npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot
```

Expected: the deletion-mode default checkbox remains disabled or cannot be cleared by the bulk operation.

- [x] **Step 3: Implement the narrow selection policy.**

In `enableEntries`, make a deletion-mode entry `operable` whenever it is a deletable ledger and set `forceEnabledOnBulk` to `false`. Preserve `isRoundLocked` and `isForcedEnabled` behavior when `deletionMode === false`; do not change managed deletion planning, backup selection, or default-system configuration.

- [x] **Step 4: Verify the focused regression passes.**

Run the Task 1 command again. Expected: all tests in the file pass.

### Task 2: Recommendation deletion completion boundary

**Covers:** `R002-3`, `R003`, `I004`.

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx` only if the callback contract needs the existing queued save to be exposed accurately.

- [x] **Step 1: Write failing regressions for each deletion branch.**

Add tests that prove: an unbacked recommendation calls the local draft deletion path; a bound or unbound selected recommendation awaits cancellation and remains as a saved ledger; cancellation resolves before deletion mode closes; a selected recommendation can be selected again after the cancellation completes. Add a direct-delete test for a local-draft projection that shares an old candidate ID, proving it does not get misclassified as cancellation-only.

- [x] **Step 2: Verify the tests fail for the current behavior.**

Run:

```powershell
npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx --reporter=dot
```

Expected: one or more tests expose an unawaited deletion/cancellation sequence or a local draft preserved as a recommendation.

- [x] **Step 3: Implement the smallest ordered mutation.**

Keep `isDraftDirectlyDeletable` as the direct local-draft branch. Make recommendation cancellation explicitly exclude direct drafts. Await the existing `onBeforeDeleteLedger`, recommendation cancellation callback, and `onDeleteLedger` result before clearing or re-projecting the upper list. Keep remote deletion dialogs, default-ledger restoration, local repository deletion, and Bilibili side effects unchanged.

- [x] **Step 4: Verify focused deletion regressions pass.**

Run the Task 2 command again. Expected: both files pass with no unhandled async warning.

### Task 3: Tag acceptance rebuild and per-batch overview snapshots

**Covers:** `R002-1`, `R002-2`, `R004`, `R008`, `I002`, `I003`, `I005`, `I008`, `I010`.

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx` if a hook test file exists, otherwise add the narrow command-error test to its established renderer owner test.
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`

- [x] **Step 1: Write failing coordinator regressions.**

Add a multi-segment workspace test where accepting segment one keeps tag enrichment running for segment two while immediately rebuilding recommendation candidates, current-segment classifications, archive targets, and the all-round overview. Add a non-current segment-ready test asserting its completion produces the same rebuilt overview without pretending the still-pending segment is complete. Preserve adopted candidate IDs in both expectations.

- [x] **Step 2: Verify the coordinator tests fail.**

Run:

```powershell
npm test -- --run electron/main/oldFavoriteWorkspaceCoordinator.test.ts --reporter=dot
```

Expected: the accepted segment snapshot retains stale recommendation/overview data, or a background-ready segment does not refresh it.

- [x] **Step 3: Implement coordinator snapshot rebuilding.**

At each accepted or newly-ready segment boundary, rebuild the recommendation index from the updated tag index, persist the refreshed recommendation overlay, auto-classify only the relevant completed segment, then return a fresh snapshot. Do not change fetch scheduling, pause/resume, retry, whole-run acceptance semantics, DeepSeek handoff, or Bilibili execution intent.

- [x] **Step 4: Write and run renderer failures for acceptance visibility and errors.**

Add a scan overview test with `tagEnrichment.status === 'running'` and the current segment already accepted while another segment remains pending; assert `采用当前标签` is absent. Add an error-path test that rejects the IPC command and asserts the existing workspace error state is used rather than silently returning `null`.

Run:

```powershell
npm test -- --run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx --reporter=dot
```

Expected before implementation: acceptance control remains visible and/or the command failure produces no surfaced error.

- [x] **Step 5: Implement renderer behavior.**

Derive the acceptance-control visibility from the current segment's acceptance state instead of the global enrichment status. In `sendTagEnrichmentCommand`, route command failures through the hook's existing error state and rethrow or return a rejected result for the caller; retain the existing UI wording and controls.

- [x] **Step 6: Verify all Task 3 regressions pass.**

Run both Task 3 commands again. Expected: the coordinator, scan step, and hook regressions pass.

### Task 4: Protected-flow regression and evidence

**Covers:** `R005`–`R009`, `I006`, `I007`, `I009`, `I011`.

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-16-deletion-mode-default-selection.md`
- Modify: this plan checklist as each task finishes.
- Create: `.codex-artifacts/2026-08-16-deletion-and-tag-snapshot-integrity/` for test and Electron evidence only.

- [x] **Step 1: Run targeted integrations and type/build checks.**

```powershell
npm test -- --run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteRecommendationStep.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx --reporter=dot
npm run build
git diff --check
```

Record exact exit status and test counts in the ledger. Any unrelated failure stops the commit.

- [x] **Step 2: Run the Electron development build safely.**

Use local-only data and do not execute a Bilibili plan. Verify normal mouse movement, deletion-mode entry/exit and selection, clicking, scrolling, resizing, minimizing, restoring, and closing. Capture screenshots and notes under the artifact directory.

- [x] **Step 3: Perform requirement-by-requirement ledger audit.**

Re-read `R001`–`R009` and `I001`–`I011`; add exact code locations, test commands/results, Electron observations, and any limitation to each index item. Mark no item complete without its own evidence.

- [ ] **Step 4: Final workspace check and one local commit.**

Run:

```powershell
git status --short
git diff --stat
git diff --check
```

Stage only the plan, ledger, source, tests, and `.codex-artifacts` evidence belonging to this round, then create one local `main` commit. Do not push, merge, reset, stash, revert, clean, or alter application/Bilibili data.

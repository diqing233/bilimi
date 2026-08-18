# Scan Overview Select-All And Confirmed Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make collection-library reorganization reuse confirmed local tags without an adoption step, and reduce scan-overview source selection to one accurate all-select control.

**Architecture:** Keep remote folder IDs and selected-source persistence in the main-process workspace model, but project only a single source-range control in the renderer. Initialize confirmed tag evidence as an already settled tag fact for selected reorganization, while leaving unconfirmed items in the existing independent tag-enrichment queue. Preserve the existing DeepSeek, transcription, Bilibili sync, and repository schemas.

**Tech Stack:** Electron main-process coordinator, React renderer, TypeScript, Vitest, Testing Library.

---

### Task 1: Record the final product design

**Files:**
- Modify: `docs/项目功能项目书.md:217-230`
- Modify: `docs/requirement-ledgers/2026-08-19-scan-overview-select-all-and-confirmed-tags.md`

- [x] **Step 1: Update the project book**

Document the final scan-overview source projection as `全选（N）`, where N is the confirmed remote-folder count, including zero-member folders. Document that local repository videos with `tagEvidence=confirmed` (including confirmed empty tags) are immediately reusable; the two tag buttons remain visible and disabled when no pending/failed/new tag result exists. Keep the remote relationship model and all unrelated capabilities unchanged.

- [x] **Step 2: Update the ledger index after implementation**

For I001-I004, add exact code locations, tests, UI acceptance evidence, and any unverified conditions. Keep the original-message section immutable.

### Task 2: Reproduce the confirmed-tag and source-projection regressions

**Files:**
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [x] **Step 1: Add a main-process regression test**

Create a selected reorganization with confirmed non-empty and confirmed-empty repository tags, provide a deterministic classifier, and assert the returned snapshot has no unaccepted tag changes, both tag actions disabled, and classified readiness equal to the selected count.

- [x] **Step 2: Run the focused coordinator test and verify RED**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "reuses confirmed tags"`. It must fail because the current initialization leaves accepted tag versions empty and initial readiness at zero until a later classification overlay.

- [x] **Step 3: Replace legacy source-table expectations with the final projection test**

Assert that the renderer exposes exactly one `全选（N）` checkbox, keeps the count based on remote folders, omits folder rows, `总数`, relation metrics, and the count-toggle button, and still sends all remote IDs or an empty array when toggled.

- [x] **Step 4: Run the focused renderer test and verify RED**

Run `npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx -t "projects source selection"`. It must fail against the current table projection.

### Task 3: Fix selected reorganization tag initialization and readiness

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:2023-2190`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Initialize confirmed tag facts as settled**

When building the selected scope, identify segment IDs whose items are all `tagEvidence=confirmed`. Keep unconfirmed empty-tag items in `pendingAids`. For settled segments, initialize `acceptedSegmentIds` and `acceptedTagVersionsBySegment` at version zero; count confirmed evidence (including empty tags) as reused facts. Do not call the tag endpoint or write repository data for those items.

- [x] **Step 2: Preserve actual classification readiness**

After initial classification, ensure the readiness map is refreshed from the resulting classifications even when the classifier produces no new journal entry. Do not invent classifications; readiness must reflect selected, classified, and unclassified counts from the authoritative workspace.

- [x] **Step 3: Run focused coordinator tests and the existing selected-reorganization tests**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "reuses confirmed tags|creates a full-mode selection scope|refreshes and persists"` and confirm PASS.

### Task 4: Reduce the renderer source area to the single all-select control

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [x] **Step 1: Remove only the renderer projection helpers**

Delete the source count-mode state, source metric projection, and per-folder row rendering. Retain the source-folder array solely for the remote count, selected IDs, and the callback payload. Render one checkbox labeled `全选（${userFolders.length}）`; disable it only while loading, read-only whole-run projection, or when the remote-folder list is empty. Preserve all internal IDs and selected subset behavior for legacy drafts.

- [x] **Step 2: Keep tag actions stable**

Leave `继续补取标签` and `采用当前标签` in the existing tag-action row. Their disabled conditions must remain snapshot-driven; no button is removed when there is no action.

- [x] **Step 3: Run focused renderer tests**

Run `npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx -t "projects source selection|tag actions|current-tag"` and confirm PASS.

### Task 5: Full verification and auditable handoff

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-19-scan-overview-select-all-and-confirmed-tags.md`

- [x] **Step 1: Run the complete test suite and build**

Run `npm test -- --retry=2` and `npm run build`. Fix only regressions caused by this theme; do not change DeepSeek, multi-P transcription, or Bilibili sync behavior.

- [x] **Step 2: Run repository checks**

Run `git diff --check`, inspect `git diff --stat`, and confirm only the project book, this ledger, the plan, coordinator, renderer, and their tests changed.

- [x] **Step 3: Perform interface acceptance**

In the Electron development build, verify the source area shows one `全选（N）` control, N remains the remote-folder count including zero-member folders, toggling sends all/none, confirmed historical tags do not show a pending-adoption message, and both tag buttons remain visible but disabled. Record any unavailable live-Bilibili condition in the ledger.

- [ ] **Step 4: Create one local commit on `main`**

Stage only this theme's files and commit with `fix: stabilize scan overview source selection and confirmed tags`.

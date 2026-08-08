# Batch-ready recommendations and safe exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recommendations and archive results visible only after their tag batch is complete, while retaining safe repeated local saves and a round-wide no-sync exit.

**Architecture:** Tag reads keep journaling per-video data and progress, but recommendation candidates rebuild only when a segment's pending tags reach zero. Every navigation and scope entry stays available during enrichment; segment readiness decides whether the selected segment presents data and permits mutations. Persisted completed segments remain editable and re-saveable while later segments enrich; abandoning a round preserves existing local-library records.

**Tech Stack:** Electron main process, TypeScript, React, Vitest, existing workspace journal/store.

---

### Task 1: Batch-bound recommendation publication

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [ ] **Step 1: Write the failing coordinator tests**

Replace the per-tag publication expectation with two tests: recording tags before a segment completes leaves the persisted recommendations unchanged; recording the final pending tag publishes that segment's tag candidate and makes it ready.

- [ ] **Step 2: Verify red**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "does not publish tag recommendations before a batch completes|publishes tag recommendations when a batch completes"`. The first assertion must fail because `recordTagEnrichment` currently calls `updateRecommendationsAfterTagEnrichment` for every aid.

- [ ] **Step 3: Implement the minimal publication change**

Keep per-aid `appendTagEnrichmentDelta` and tag-index updates. Remove per-aid recommendation publication. When `completedCurrentSegmentTagEnrichment(...)` becomes true, rebuild `RecommendationState` from the index while preserving adopted candidates, persist it through `appendOverlay`, then invoke the existing ready-segment callback.

- [ ] **Step 4: Verify green**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts` and confirm the coordinator suite passes.

### Task 2: Renderer readiness boundary

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

Cover a selected `tagging` segment: all four tabs and the current-scope switch are reachable, but recommendation cards and archive cards become a waiting status, and DeepSeek/manual/candidate controls are unavailable. Cover an earlier `ready` segment while a later one is tagging: it remains viewable and editable.

- [ ] **Step 2: Verify red**

Run `npx vitest run src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "tagging|ready batch"`. It must fail because recommendation and archive data render regardless of selected-segment readiness.

- [ ] **Step 3: Implement the presentation boundary**

Derive selected-segment readiness in `OldFavoriteGuide`. Pass a single readiness prop to recommendation, archive and confirmation steps. Keep scope navigation available, but show a concise status-only placeholder instead of baseline candidate/video data for incomplete segments. Preserve ready/saved earlier segments as normal editable views.

- [ ] **Step 4: Verify green**

Run `npx vitest run src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx` and confirm both files pass.

### Task 3: Mutation safety and save/exit behavior

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Assert a tagging segment rejects preparation, DeepSeek/classification, local save, and Bilibili execution even when commands bypass the renderer. Assert ready/saved segments can be saved to the local library again, and no-sync abandonment keeps saved library records while stopping unfinished work.

- [ ] **Step 2: Verify red**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "tagging segment|local library|abandon"`; unsupported direct mutations must expose the missing guard.

- [ ] **Step 3: Implement guards without changing established exits**

Centralize existing segment-readiness validation for current-segment mutations. Keep repeated local-library saves for ready/saved selected segments via existing upsert semantics; keep `abandon-current-workspace` available for no-sync close; preserve the completed Bilibili `好的` acknowledgement path.

- [ ] **Step 4: Verify green**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx` and confirm both suites pass.

### Task 4: Integrated regression and Electron verification

**Files:**

- Modify only reviewed in-scope files if verification finds an in-scope defect.

- [ ] **Step 1: Run automated verification**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`, `npx electron-vite build`, `git diff --check`, `git diff --stat`, and `git status --short`.

- [ ] **Step 2: Verify Electron dev behavior**

Using a disposable test draft, exercise: a tagging batch; a completed batch followed by a tagging batch; repeated local saves after an edit; no-sync close preserving saved records; Bilibili completion acknowledgement; pause/resume and restart recovery. Check mouse movement, clicks, scrolling, resize, minimize, and close while enrichment runs.

- [ ] **Step 3: Create the authorized local checkpoint**

Stage only reviewed in-scope source, test, and plan files and create one local commit. Do not merge, rebase, push, or package.

# Old Favorite Draft Ledger Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace preview-time full reclassification with persistent recommendation AID indexes, save-time cancellable rule analysis, and draft-safe operations while preserving DeepSeek, manual classification, LocalData, modal, and synchronization behavior.

**Architecture:** The Electron main process remains authoritative. Recommendation generation persists per-batch matched AIDs; adoption/removal applies only indexed system-classification deltas. User-created rules run only when the user saves, stage results separately, and commit atomically. Existing manual and DeepSeek command paths remain unchanged and outrank system results.

**Tech Stack:** Electron, TypeScript, React 19, Vitest, Testing Library, append-only workspace overlays.

---

### Task 1: Lock existing DeepSeek and manual behavior with regression tests

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] Add coordinator tests proving recommendation/rule changes never replace `manual` or `deepseek` classifications.
- [ ] Add renderer tests proving manual movement still sends `{ type: 'apply-classifications', source: 'manual', assignments }`.
- [ ] Preserve tests for DeepSeek organize, cancel, retry, progress, and stale-result rejection.
- [ ] Run the three focused test files before production edits and record the baseline warnings.
- [ ] Commit only the guardrail tests with `test: protect old favorite edit behavior`.

### Task 2: Persist recommendation matched-AID indexes

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.test.ts`

- [ ] Write failing tests expecting author/tag recommendations to persist `matchedAidsBySegment` and expose a count derived from unique indexed AIDs.
- [ ] Verify RED with focused coordinator/store tests.
- [ ] Extend the internal stored recommendation shape:

```ts
type StoredRecommendation = {
  id: string
  displayName: string
  kind: 'author' | 'series' | 'tag'
  sourceName: string
  keywords: string[]
  matchedAidsBySegment: Record<string, number[]>
  reason: string
}
```

- [ ] Build author/tag AID buckets during the existing recommendation-generation pass; do not add another scan.
- [ ] Keep renderer snapshots compact by returning `count`, not raw index arrays.
- [ ] Recover new indexes from overlays. For old candidates that contain only `count`, rebuild once from persisted scan pages and store the migrated index.
- [ ] Run complete coordinator/store tests and commit with `feat: persist favorite recommendation indexes`.

### Task 3: Apply recommendation add/remove as indexed deltas

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] Write failing tests for add, remove, rapid toggle, and restore. Assert the classifier sees only the changed indexes, never every planned AID.
- [ ] Assert `manual` and `deepseek` results remain byte-for-byte unchanged.
- [ ] Implement `applyRecommendedLedgerDeltaUnsafe(workspace, beforeIds, afterIds)` using the union of added/removed recommendation indexes and the existing `onlyAids` classification path.
- [ ] Keep optimistic renderer updates and the serialized recommendation save queue; stale IPC responses must not replace newer selections.
- [ ] Change `归档预览` navigation to only change the visible step. It must not call `prepareRecommendationPreview`.
- [ ] Run coordinator, hook, panel, and render-isolation tests.
- [ ] Commit with `fix: apply recommendation changes by AID index`.

### Task 4: Analyze user-created or edited ledger rules only on save

**Files:**
- Create: `electron/main/oldFavoriteLedgerRuleAnalysis.ts`
- Create: `electron/main/oldFavoriteLedgerRuleAnalysis.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] Write failing pure-helper tests for bounded batches, monotonic progress, cancellation before the next batch, and matched-AID output without workspace mutation.
- [ ] Implement the helper using the same normalized title/author/tag semantics as the existing classifier:

```ts
type RuleAnalysisOptions = {
  shouldCancel?: () => boolean
  onProgress?: (completed: number, total: number) => void
  yieldToEventLoop?: () => Promise<void>
}
```

- [ ] Write failing coordinator tests proving old rule/index/classifications remain active until all batches succeed.
- [ ] Prove cancellation/failure preserves the prior draft and the same unchanged rule can resume from a checkpoint.
- [ ] Add strict IPC commands for saving a draft rule and canceling an analysis, plus progress events containing account, workspace, analysis ID, completed, and total.
- [ ] Stage checkpoints separately from active indexes. On success atomically commit the rule version, index, and classification delta.
- [ ] Never call `autoClassifyAllSegmentsUnsafe` without a bounded `onlyAids` set from old/new index union.
- [ ] Run helper, coordinator, and IPC tests; commit with `feat: analyze draft ledger rules on save`.

### Task 5: Add renderer progress, cancellation, and scoped locking

**Files:**
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] Write failing UI tests for analysis state, real progress, cancel, rollback to editing, and successful activation.
- [ ] Add hook state keyed by account/workspace/analysis ID; stale progress and completion are ignored.
- [ ] Replace `createLocalLedgerAndReclassify` UI wiring with the save/analyze command while retaining the current modal/form behavior.
- [ ] Disable only draft-mutating controls during analysis: recommendation changes, manual moves, DeepSeek actions, batch save, and confirmation.
- [ ] Do not add a full-page overlay or `pointer-events: none`; viewing, scrolling, tabs, minimize, and close remain available.
- [ ] Run hook, preview, panel, and `FloatingAssistantApp.renderIsolation.test.tsx`.
- [ ] Commit with `feat: show cancellable draft ledger analysis`.

### Task 6: Upgrade history to complete draft transactions and bind shortcuts

**Files:**
- Create: `src/shared/oldFavoriteDraftTransaction.ts`
- Create: `src/shared/oldFavoriteDraftTransaction.test.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [ ] Write failing tests for create, update, soft delete, recommendation adopt/remove, manual classification, and DeepSeek transactions.
- [ ] Implement compact `before`/`after` deltas plus index-version references; do not store complete batch snapshots.
- [ ] Migrate existing classification history as classification-only transactions.
- [ ] Route undo/redo through transactions and reuse the durable cursor journal. Undo/redo must never invoke rule analysis.
- [ ] Bind `Ctrl+Z`, `Ctrl+Shift+Z`, and `Ctrl+Y` only while archive preview is active.
- [ ] Ignore shortcut events from `input`, `textarea`, `select`, and content-editable elements.
- [ ] Keep frozen batch boundaries non-editable and prevent active history from crossing them.
- [ ] Run transaction and renderer tests; commit with `feat: undo complete favorite draft actions`.

### Task 7: Freeze completed batches in the local favorite library

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `src/renderer/src/features/favorites/oldFavoriteWorkspacePageBridge.ts`
- Modify: `src/renderer/src/features/favorites/oldFavoriteWorkspacePageBridge.test.ts`

- [ ] Write failing tests proving a saved batch stores classifications, rule version, and a remote-operation plan, then unloads active item details.
- [ ] Prove later rule edits do not mutate a frozen batch; reopening creates a new revision.
- [ ] Write failing scheduling tests proving Bilibili writes never execute while scanning is active.
- [ ] Reuse the existing sync service, binding, protection, reconciliation, and retry paths; do not create a second remote executor.
- [ ] Execute queued frozen plans serially only after scanning ends or is explicitly paused through the existing scheduler.
- [ ] Run repository, coordinator, and page-bridge tests; commit with `feat: freeze favorite batches before remote sync`.

### Task 8: Remove obsolete preview preparation and perform full verification

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `docs/superpowers/specs/2026-07-30-old-favorite-draft-preview-preparation-design.md`
- Modify: `docs/superpowers/plans/2026-07-30-old-favorite-draft-preview-preparation.md`

- [ ] Add a failing static test proving preview navigation sends no `prepare-recommendation-preview` command.
- [ ] Remove old preview-preparation state, command, progress listener, progress UI, and cancellation route after old-workspace migration is covered.
- [ ] Add a short superseded notice to the July 30 spec/plan pointing to the July 31 indexed-draft documents; preserve their historical content.
- [ ] Run all old-favorite coordinator, store, IPC, shared model, hook, panel, preview, render-isolation, repository, and page-bridge tests.
- [ ] Run `node_modules\.bin\tsc.cmd --noEmit`, `git diff --check`, and `git status --short`; separate pre-existing TypeScript failures from changed-file failures.
- [ ] Verify real Electron without destructive remote execution: recommendation add/remove, preview entry, save-time progress/cancel, mouse/window responsiveness, manual movement, DeepSeek organize/cancel/retry, undo/redo, batch freezing, and no writes during scanning.
- [ ] Stage only implementation files, inspect the staged diff, and create a local commit. Do not package, push, or touch the installed build.

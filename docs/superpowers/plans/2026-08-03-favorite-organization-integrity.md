# Favorite Organization Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make whole-run DeepSeek organization, local persistence, Bilibili synchronization, and daily-review replacement deterministic, recoverable, and mutually consistent.

**Architecture:** Persist an immutable DeepSeek work plan with stable AID/group identity, separate background work state from renderer view state, and enforce completion gates in the main-process coordinator. Preserve the local-first/frozen-remote-plan workflow and route Bilibili reads and writes through validated page targets and the existing remote-operation arbiter.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library, Electron webview page bridges.

---

## Safety And Tracking

- [ ] Capture `git status --short` before each task and preserve every pre-existing dirty file.
- [ ] Do not use reset, stash, revert, clean, data deletion, packaging, push, or installed-version changes.
- [ ] Do not restore `package.json`; use `node_modules\.bin\vitest.cmd` and `node_modules\.bin\electron-vite.cmd dev` directly.
- [ ] Keep a completion table at the bottom of this document and mark an item complete only with test or real-Electron evidence.
- [ ] Make small local commits only after focused verification; never include unrelated dirty changes.

### Task 1: Fix Daily-review Bilimi Replacement

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/actions/favoriteApiAutomation.ts`
- Modify: `src/renderer/src/features/actions/favoriteApiAutomation.test.ts`

- [ ] Add a red App integration test where the first pass stores an AID in `inbox`, DeepSeek corrects it to `knowledge`, and the adjustment script must contain both `addLedgerIds: ['knowledge']` and `removeLedgerIds: ['inbox']`.
- [ ] Assert the successful repository command contains only `bilimi-logical:knowledge` in `localDesiredFolderIds` and does not retain `bilimi-logical:inbox`.
- [ ] Assert the Bilibili adjustment request resolves the physical temporary folder and sends it in `del_media_ids` while sending knowledge in `add_media_ids`.
- [ ] Add a red test proving an ordinary user-created favorite folder is never included in `del_media_ids`.
- [ ] Run `node_modules\.bin\vitest.cmd run src/renderer/src/App.test.tsx src/renderer/src/features/actions/favoriteApiAutomation.test.ts` and verify the new assertions fail for the inbox exclusion.
- [ ] Change daily-review removal planning from `ledgerId !== 'inbox'` to every prior bilimi-managed ledger absent from the correction target set.
- [ ] Preserve remote evidence for added and removed folders; do not persist an aligned local position when the remote adjustment is incomplete.
- [ ] Re-run the focused tests and verify all pass.

### Task 2: Introduce A Durable DeepSeek Work Plan

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [ ] Add red tests for a three-ready-segment `scope: 'all'` run whose work plan freezes the full AID set and final video total before `generate` is called.
- [ ] Add a red test proving the total remains 129 after later segment selection and progress updates.
- [ ] Add a red test for partially ready segments exposing explicit waiting segment ids without including them in the final-applied count.
- [ ] Run the two main-process suites and verify the work-plan assertions fail.
- [ ] Replace the minimal all-run checkpoint with a versioned work-plan shape containing stable segment work, request group ids, successful AIDs, pending AIDs, failed AIDs, cancellation, and failure state.
- [ ] Persist and restore the work plan through `oldFavoriteWorkspaceStore` without loading all video payloads into every snapshot.
- [ ] Build the plan once at run start; do not recompute included ready-segment AIDs between provider requests.
- [ ] Re-run the focused tests and verify the total and AID identity remain stable.

### Task 3: Repair Cancel-then-restart State

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts`

- [ ] Add a red main-process test: cancel after one successful group, restart the same all-run mode, retain completed AIDs, clear `canceled`, and call `generate` only for remaining AIDs.
- [ ] Add a red hook test: the restarted snapshot immediately maps to `running`, exposes cancellation, and never reuses the previous `DeepSeek stopped` copy.
- [ ] Run the focused tests and verify the stale-canceled assertions fail.
- [ ] Clear historical cancellation synchronously when a new run claims the checkpoint, before publishing progress or a renderer snapshot.
- [ ] Derive global task status and archive feedback from the durable work plan rather than independent promise lifetime.
- [ ] Keep the cancel request cooperative and preserve completed results.
- [ ] Re-run focused tests and verify cancel/restart state is consistent.

### Task 4: Add Adaptive Timeout Recovery

**Files:**
- Modify: `electron/main/deepseekService.ts`
- Modify: `electron/main/deepseekService.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [ ] Add red tests for one 20-video group timing out, backing off, and succeeding on its single retry.
- [ ] Add red tests for two 20-video timeouts splitting into stable 10-video groups.
- [ ] Add red tests for a 10-video timeout splitting into stable 5-video groups and never resending already successful AIDs.
- [ ] Add red tests differentiating timeout, 429, 5xx, network failure, invalid structure, and unavailable target errors.
- [ ] Add a red test proving no second provider request starts while the timed-out request remains unsettled.
- [ ] Run the focused main-process suites and verify each recovery behavior fails before implementation.
- [ ] Use a 180-second default for old-favorite organization requests without changing unrelated DeepSeek operations.
- [ ] Implement bounded backoff and deterministic child group ids so restart resumes the same split plan.
- [ ] Persist successful and failed AIDs after each settled group.
- [ ] Re-run focused tests and verify retry/split behavior and single-flight constraints.

### Task 5: Make Progress Truthful

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.ts`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [ ] Add red model tests for `89 applied / 129 total / 40 waiting retry` and for a split-group denominator change that leaves total videos at 129.
- [ ] Add a red component test proving `129/129` is not rendered while any AID is pending or failed.
- [ ] Add labels that distinguish scan batches from DeepSeek request groups.
- [ ] Run the focused renderer suites and verify the old progress copy fails the assertions.
- [ ] Project provider progress from the durable work plan: applied, retrying, failed, waiting scan batches, and settled request groups.
- [ ] Render cancellation as applied/pending/canceled counts, not generic completion.
- [ ] Re-run focused tests and verify the display is mathematically consistent.

### Task 6: Separate Viewed Batch From Working Batch

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx` if present, otherwise `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`

- [ ] Replace the existing test that expects the batch selector and four guide steps to be disabled during DeepSeek with red tests requiring read-only navigation.
- [ ] Add a red test proving viewed-batch changes do not call `select-segment` while a durable work plan is active.
- [ ] Add red tests for current/whole-run switching in all four steps while mutations remain disabled.
- [ ] Run the focused renderer suites and verify the read-only navigation tests fail.
- [ ] Store renderer-only `viewedSegmentId` and keep the coordinator's working segment private to the work plan.
- [ ] Feed viewed-segment snapshots to the four pages without mutating DeepSeek ownership.
- [ ] Keep source changes, recommendations, transfers, undo/redo, and new organization disabled while background work is active.
- [ ] Re-run renderer suites and verify navigation and locks together.

### Task 7: Enforce Failure Resolution Before Execution

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [ ] Add red coordinator tests rejecting local whole-run save, remote freeze, and remote execution while the work plan is running, waiting, canceled, or failed.
- [ ] Add a red renderer test showing exact failed-AID counts and disabling both execution choices.
- [ ] Add a red test for `Use original automatic classifications for N videos`, including explicit confirmation and a history record.
- [ ] Add a red test proving successful retry clears the gate and resumes a previously queued execution intent.
- [ ] Run the focused tests and verify main-process enforcement is absent or incomplete.
- [ ] Add coordinator-level readiness validation at every freeze/execute entry point.
- [ ] Implement the explicit fallback resolution command using the pre-DeepSeek classifications stored in the work plan.
- [ ] Keep automatic execution intent blocked until retry or explicit resolution clears all failed AIDs.
- [ ] Re-run tests and verify stale renderer calls cannot bypass the gate.

### Task 8: Complete Local Commit Before Remote Writes

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `electron/main/favoriteRepositorySyncService.test.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [ ] Preserve and run the existing red test `commits the complete local organization result before the first Bilibili write starts`.
- [ ] Add red tests for per-batch immutable remote sub-plans and local result survival after remote failure.
- [ ] Add a red hook test proving resumed sync returns control immediately and polling continues to update progress.
- [ ] Add red renderer tests retaining current/all scope controls and read-only navigation during executing/frozen/reconciling states.
- [ ] Run the focused suites and confirm the expected red failures.
- [ ] Commit the full local result before binding or executing the first remote operation.
- [ ] Resume/reconcile Bilibili plans in the background; do not hold the foreground request counter for the full remote run.
- [ ] Keep all mutations locked while allowing read-only navigation.
- [ ] Re-run focused suites and verify progress and local-first ordering.

### Task 9: Harden Bilibili Inventory And Page-target Lifecycle

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/favorites/oldFavoriteWorkspacePageBridge.ts`
- Modify: `src/renderer/src/features/favorites/oldFavoriteWorkspacePageBridge.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.test.ts`
- Modify: `electron/main/favoriteRepositoryRemoteOperationArbiter.ts` if arbitration changes are required by evidence

- [ ] Reproduce and capture the actual inventory response category before altering retry behavior.
- [ ] Add red tests for a non-JSON inventory response retaining local data and checkpoint state.
- [ ] Add red tests for declared nonzero membership plus an anomalous empty list.
- [ ] Add red tests for stale target/navigation epoch, explicit rebind, and one bounded retry.
- [ ] Add a red arbitration test proving scan, reconciliation, and Bilibili writes do not overlap on the remote channel.
- [ ] Run focused scan/page-bridge suites and verify the new cases fail.
- [ ] Return sanitized response diagnostics: HTTP status, content type, Bilibili code, and response category.
- [ ] Validate active webContents id, instance id, navigation epoch, and account before and after execution.
- [ ] Preserve local repository data on every temporary remote failure.
- [ ] Re-run focused tests and verify empty/invalid remote responses are non-destructive.

### Task 10: Focused Regression And Real Electron Verification

**Files:**
- Update completion table in this document only after evidence is collected.
- Store screenshots/logs under `.codex-artifacts/` if diagnostics must be retained.

- [ ] Run focused suites for App, favorite adjustment automation, DeepSeek service, old-favorite DeepSeek service, coordinator, store, hook, guide/preview/confirmation, sync service, scan service, and page bridges.
- [ ] Run the broader related old-favorite and favorite-repository suites.
- [ ] Run TypeScript checking only with the repository's direct tool command; report pre-existing dirty-tree errors separately from new errors.
- [ ] Restart development with `node_modules\.bin\electron-vite.cmd dev`; do not use package scripts.
- [ ] Verify three ready scan batches show the final DeepSeek total at start.
- [ ] Verify cancel then restart resumes remaining AIDs, clears the stopped message, and restores the cancel button.
- [ ] Verify current/whole-run and viewed-batch switching while DeepSeek runs.
- [ ] Exercise a controlled timeout/retry path without creating concurrent provider calls.
- [ ] Verify failed AIDs block local save and Bilibili sync; verify retry and explicit fallback each clear the gate correctly.
- [ ] Verify complete local data exists before the first Bilibili write and remains after a simulated remote failure.
- [ ] Verify resumed sync progress continues to move while the user browses all four steps.
- [ ] Verify temporary inventory failure preserves the existing favorite library.
- [ ] Verify daily review from `bilimi temporary` to another bilimi ledger removes temporary, adds the destination, updates the local repository, and preserves ordinary user favorites.
- [ ] Report exact warnings, failures, and residual performance risks. Do not claim mouse responsiveness without direct observation and do not claim latency improvement without measurements.

## Completion Table

| Requirement | Automated evidence | Real Electron evidence | Status |
| --- | --- | --- | --- |
| Daily-review temporary membership is replaced | Pending | Pending | Not started |
| Full-run total is immutable from start | Pending | Pending | Not started |
| Cancel/restart state is consistent | Pending | Pending | Not started |
| Timeout retries and adaptive splits | Pending | Pending | Not started |
| Progress distinguishes settled/applied/failed | Pending | Pending | Not started |
| Read-only batch and overview navigation works | Pending | Pending | Not started |
| Failed AIDs block execution | Pending | Pending | Not started |
| Explicit original-classification fallback works | Pending | Pending | Not started |
| Local commit precedes remote write | Pending | Pending | Not started |
| Resumed sync publishes progress | Pending | Pending | Not started |
| Temporary Bilibili failures preserve data | Pending | Pending | Not started |


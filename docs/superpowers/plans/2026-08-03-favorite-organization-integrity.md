# Favorite Organization Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make whole-run DeepSeek organization, local persistence, Bilibili synchronization, and daily-review replacement deterministic, recoverable, and mutually consistent.

**Architecture:** Persist an immutable DeepSeek work plan with stable AID/group identity, separate background work state from renderer view state, and enforce completion gates in the main-process coordinator. Preserve the local-first/frozen-remote-plan workflow and route Bilibili reads and writes through validated page targets and the existing remote-operation arbiter.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library, Electron webview page bridges.

---

## Safety And Tracking

- [x] Capture `git status --short` before each task and preserve every pre-existing dirty file.
- [x] Do not use reset, stash, revert, clean, data deletion, packaging, push, or installed-version changes.
- [x] Do not restore `package.json`; use `node_modules\.bin\vitest.cmd` and `node_modules\.bin\electron-vite.cmd dev` directly.
- [x] Keep a completion table at the bottom of this document and mark an item complete only with test or real-Electron evidence.
- [x] Make small local commits only after focused verification; never include unrelated dirty changes.

### Task 1: Fix Daily-review Bilimi Replacement

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/actions/favoriteApiAutomation.ts`
- Modify: `src/renderer/src/features/actions/favoriteApiAutomation.test.ts`

- [x] Add a red App integration test where the first pass stores an AID in `inbox`, DeepSeek corrects it to `knowledge`, and the adjustment script must contain both `addLedgerIds: ['knowledge']` and `removeLedgerIds: ['inbox']`.
- [x] Assert the successful repository command contains only `bilimi-logical:knowledge` in `localDesiredFolderIds` and does not retain `bilimi-logical:inbox`.
- [x] Assert the Bilibili adjustment request resolves the physical temporary folder and sends it in `del_media_ids` while sending knowledge in `add_media_ids`.
- [x] Add a red test proving an ordinary user-created favorite folder is never included in `del_media_ids`.
- [x] Run `node_modules\.bin\vitest.cmd run src/renderer/src/App.test.tsx src/renderer/src/features/actions/favoriteApiAutomation.test.ts` and verify the new assertions fail for the inbox exclusion.
- [x] Change daily-review removal planning from `ledgerId !== 'inbox'` to every prior bilimi-managed ledger absent from the correction target set.
- [x] Preserve remote evidence for added and removed folders; do not persist an aligned local position when the remote adjustment is incomplete.
- [x] Re-run the focused tests and verify all pass.

### Task 2: Introduce A Durable DeepSeek Work Plan

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [x] Add red tests for a three-ready-segment `scope: 'all'` run whose work plan freezes the full AID set and final video total before `generate` is called.
- [x] Add a red test proving the total remains 129 after later segment selection and progress updates.
- [x] Add a red test for partially ready segments exposing explicit waiting segment ids without including them in the final-applied count.
- [x] Run the two main-process suites and verify the work-plan assertions fail.
- [x] Replace the minimal all-run checkpoint with a versioned work-plan shape containing stable segment work, request group ids, successful AIDs, pending AIDs, failed AIDs, cancellation, and failure state.
- [x] Persist and restore the work plan through `oldFavoriteWorkspaceStore` without loading all video payloads into every snapshot.
- [x] Build the plan once at run start; do not recompute included ready-segment AIDs between provider requests.
- [x] Re-run the focused tests and verify the total and AID identity remain stable.

### Task 3: Repair Cancel-then-restart State

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts`

- [x] Add a red main-process test: cancel after one successful group, restart the same all-run mode, retain completed AIDs, clear `canceled`, and call `generate` only for remaining AIDs.
- [x] Add a red hook test: the restarted snapshot immediately maps to `running`, exposes cancellation, and never reuses the previous `DeepSeek stopped` copy.
- [x] Run the focused tests and verify the stale-canceled assertions fail.
- [x] Clear historical cancellation synchronously when a new run claims the checkpoint, before publishing progress or a renderer snapshot.
- [x] Derive global task status and archive feedback from the durable work plan rather than independent promise lifetime.
- [x] Keep the cancel request cooperative and preserve completed results.
- [x] Re-run focused tests and verify cancel/restart state is consistent.

### Task 4: Add Adaptive Timeout Recovery

**Files:**
- Modify: `electron/main/deepseekService.ts`
- Modify: `electron/main/deepseekService.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [x] Add red tests for one 20-video group timing out, backing off, and succeeding on its single retry.
- [x] Add red tests for two 20-video timeouts splitting into stable 10-video groups.
- [x] Add red tests for a 10-video timeout splitting into stable 5-video groups and never resending already successful AIDs.
- [x] Add red tests differentiating timeout, 429, 5xx, network failure, invalid structure, and unavailable target errors.
- [x] Add a red test proving no second provider request starts while the timed-out request remains unsettled.
- [x] Run the focused main-process suites and verify each recovery behavior fails before implementation.
- [x] Use a 180-second default for old-favorite organization requests without changing unrelated DeepSeek operations.
- [x] Implement bounded backoff and deterministic child group ids so restart resumes the same split plan.
- [x] Persist successful and failed AIDs after each settled group.
- [x] Re-run focused tests and verify retry/split behavior and single-flight constraints.

### Task 5: Make Progress Truthful

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.ts`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [x] Add red model tests for `89 applied / 129 total / 40 waiting retry` and for a split-group denominator change that leaves total videos at 129.
- [x] Add a red component test proving `129/129` is not rendered while any AID is pending or failed.
- [x] Add labels that distinguish scan batches from DeepSeek request groups.
- [x] Run the focused renderer suites and verify the old progress copy fails the assertions.
- [x] Project provider progress from the durable work plan: applied, retrying, failed, waiting scan batches, and settled request groups.
- [x] Render cancellation as applied/pending/canceled counts, not generic completion.
- [x] Re-run focused tests and verify the display is mathematically consistent.

### Task 6: Separate Viewed Batch From Working Batch

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx` if present, otherwise `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`

- [x] Replace the existing test that expects the batch selector and four guide steps to be disabled during DeepSeek with red tests requiring read-only navigation.
- [x] Add a red test proving viewed-batch changes do not call `select-segment` while a durable work plan is active.
- [x] Add red tests for current/whole-run switching in all four steps while mutations remain disabled.
- [x] Run the focused renderer suites and verify the read-only navigation tests fail.
- [x] Store renderer-only `viewedSegmentId` and keep the coordinator's working segment private to the work plan.
- [x] Feed viewed-segment snapshots to the four pages without mutating DeepSeek ownership.
- [x] Keep source changes, recommendations, transfers, undo/redo, and new organization disabled while background work is active.
- [x] Re-run renderer suites and verify navigation and locks together.

### Task 7: Enforce Failure Resolution Before Execution

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [x] Add red coordinator tests rejecting local whole-run save, remote freeze, and remote execution while the work plan is running, waiting, canceled, or failed.
- [x] Add a red renderer test showing exact failed-AID counts and disabling both execution choices.
- [x] Add a red test for `Use original automatic classifications for N videos`, including explicit confirmation and a history record.
- [x] Add a red test proving successful retry clears the gate and resumes a previously queued execution intent.
- [x] Run the focused tests and verify main-process enforcement is absent or incomplete.
- [x] Add coordinator-level readiness validation at every freeze/execute entry point.
- [x] Implement the explicit fallback resolution command using the pre-DeepSeek classifications stored in the work plan.
- [x] Keep automatic execution intent blocked until retry or explicit resolution clears all failed AIDs.
- [x] Re-run tests and verify stale renderer calls cannot bypass the gate.

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

- [x] Preserve and run the existing red test `commits the complete local organization result before the first Bilibili write starts`.
- [x] Add red tests for per-batch immutable remote sub-plans and local result survival after remote failure.
- [x] Add a red hook test proving resumed sync returns control immediately and polling continues to update progress.
- [x] Add red renderer tests retaining current/all scope controls and read-only navigation during executing/frozen/reconciling states.
- [x] Run the focused suites and confirm the expected red failures.
- [x] Commit the full local result before binding or executing the first remote operation.
- [x] Resume/reconcile Bilibili plans in the background; do not hold the foreground request counter for the full remote run.
- [x] Keep all mutations locked while allowing read-only navigation.
- [x] Re-run focused suites and verify progress and local-first ordering.

### Task 9: Harden Bilibili Inventory And Page-target Lifecycle

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/favorites/oldFavoriteWorkspacePageBridge.ts`
- Modify: `src/renderer/src/features/favorites/oldFavoriteWorkspacePageBridge.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.test.ts`
- Modify: `electron/main/favoriteRepositoryRemoteOperationArbiter.ts` if arbitration changes are required by evidence

- [x] Reproduce and capture the actual inventory response category before altering retry behavior.
- [x] Add red tests for a non-JSON inventory response retaining local data and checkpoint state.
- [x] Add red tests for declared nonzero membership plus an anomalous empty list.
- [x] Add red tests for stale target/navigation epoch, explicit rebind, and one bounded retry.
- [x] Add a red arbitration test proving scan, reconciliation, and Bilibili writes do not overlap on the remote channel.
- [x] Run focused scan/page-bridge suites and verify the new cases fail.
- [x] Return sanitized response diagnostics: HTTP status, content type, Bilibili code, and response category.
- [x] Validate active webContents id, instance id, navigation epoch, and account before and after execution.
- [x] Preserve local repository data on every temporary remote failure.
- [x] Re-run focused tests and verify empty/invalid remote responses are non-destructive.

### Task 10: Focused Regression And Real Electron Verification

**Files:**
- Update completion table in this document only after evidence is collected.
- Store screenshots/logs under `.codex-artifacts/` if diagnostics must be retained.

- [x] Run focused suites for App, favorite adjustment automation, DeepSeek service, old-favorite DeepSeek service, coordinator, store, hook, guide/preview/confirmation, sync service, scan service, and page bridges.
- [x] Run the broader related old-favorite and favorite-repository suites.
- [x] Run TypeScript checking only with the repository's direct tool command; report pre-existing dirty-tree errors separately from new errors.
- [x] Restart development with `node_modules\.bin\electron-vite.cmd dev`; do not use package scripts.
- [x] Verify three ready scan batches show the final DeepSeek total at start.
- [x] Verify cancel then restart resumes remaining AIDs, clears the stopped message, and restores the cancel button.
- [x] Verify current/whole-run and viewed-batch switching while DeepSeek runs.
- [x] Exercise a controlled timeout/retry path without creating concurrent provider calls.
- [x] Verify failed AIDs block local save and Bilibili sync; verify retry and explicit fallback each clear the gate correctly.
- [x] Verify complete local data exists before the first Bilibili write and remains after a simulated remote failure.
- [x] Verify resumed sync progress continues to move while the user browses all four steps.
- [x] Verify temporary inventory failure preserves the existing favorite library.
- [x] Verify daily review from `bilimi temporary` to another bilimi ledger removes temporary, adds the destination, updates the local repository, and preserves ordinary user favorites.
- [x] Report exact warnings, failures, and residual performance risks. Do not claim mouse responsiveness without direct observation and do not claim latency improvement without measurements.

## Completion Table

| Requirement | Automated evidence | Real Electron evidence | Status |
| --- | --- | --- | --- |
| Daily-review temporary membership is replaced | `App.test.tsx` + `favoriteApiAutomation.test.ts`, included in the final 1412/1412 related regression | Not sent to live Bilibili because remote writes were prohibited | Complete with automated remote-boundary evidence |
| Full-run total is immutable from start | DeepSeek service/coordinator work-plan tests freeze ready and waiting segment AIDs/totals | Existing 3-batch draft restored with stable 3/3 overview and 2123-item whole-run summary | Complete |
| Cancel/restart state is consistent | DeepSeek service + hook feedback tests cover cooperative cancel, retained success, cleared stale canceled state | New paid provider run was not started | Complete with automated provider-boundary evidence |
| Timeout retries and adaptive splits | DeepSeek service tests cover 20 -> 10 -> 5 stable groups, bounded retry, error categories, and single flight | Live timeout was not induced | Complete with automated provider-boundary evidence |
| Progress distinguishes settled/applied/failed | feedback model and archive-preview component tests | Real current/whole-run summaries were distinct and mathematically consistent | Complete |
| Read-only batch and overview navigation works | guide, archive, confirmation, controlled panel, and hook tests | Scan, recommendation, archive, and confirmation pages were browseable; archive current/whole-run switching worked | Complete |
| Failed AIDs block execution | coordinator and confirmation tests cover main-process gates and exact failed counts | Existing draft had no failed checkpoint, so no live failure state was manufactured | Complete with automated failure-state evidence |
| Explicit original-classification fallback works | coordinator, IPC, hook, and confirmation tests cover confirmation, history, command routing, and intent continuation | Existing draft had no failed checkpoint | Complete with automated failure-state evidence |
| Local commit precedes remote write | coordinator test captures repository state at first page-bridge write; remote-failure test proves survival | Live remote write was prohibited | Complete with automated remote-boundary evidence |
| Resumed sync publishes progress | sync service, coordinator, hook, and confirmation tests cover background resume/read-only polling | No live remote checkpoint was resumed | Complete with automated remote-boundary evidence |
| Temporary Bilibili failures preserve data | scan/page-bridge/sync/arbiter tests cover invalid JSON, anomalous empty inventory, stale targets, retry, and non-destructive preservation | Live inventory failure was not induced | Complete with automated remote-boundary evidence |

## Final Verification Record

- Final fresh related regression after independent review fixes: 55 files, 1412 tests passed on 2026-08-03. The earlier task-scoped run also passed 41 files / 955 tests.
- Final coordinator and old-favorite DeepSeek suites: 2 files, 255 tests passed. The added review regressions cover durable original-classification storage, immutable-ledger fallback, source-selection locking, failed-run reconstruction after restart, and per-request-group application/checkpoint accounting.
- Focused groups also passed independently: 78 App/action tests; 133 DeepSeek/store/preview tests; 470 coordinator/UI/sync tests; 75 scan/page-bridge tests.
- Full TypeScript check: failed on the existing dirty-tree baseline; the final pre-commit output is retained at `.codex-artifacts/2026-08-03-favorite-organization-integrity/tsc-final-precommit.txt`. Comparing it with `tsc-after-review.txt` after normalizing line/column numbers produced 118 unique error signatures in each file, with 0 added and 0 removed. The output still includes pre-existing errors in unrelated files and pre-existing type mismatches in changed files; this task did not expand scope to repair the repository-wide baseline.
- Real Electron notes: `.codex-artifacts/2026-08-03-favorite-organization-integrity/real-electron-verification.md`.
- Known warnings: 46 existing React `act(...)` warning occurrences in the final broad test run; no test failures remain.
- Residual risk: no live paid DeepSeek timeout/cancel run and no live Bilibili write/failure were triggered because this task explicitly prohibited remote writes. Read-only pointer movement was responsive during verification, but this is not a latency benchmark and does not prove every historical mouse-stall path is eliminated.


# Recommended Ledger And DeepSeek Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion while implementing this plan.

**Goal:** Make recommended bilimi folders reflect real local/Bilibili state, keep整理阶段手动新建 folders functional, and make DeepSeek use the confirmed range dialog and recover only its own stale workspace decisions.

**Architecture:** Resolve every recommendation candidate to one canonical local ledger by exact ID first and logical rule second, preserving the canonical ledger's state fields. Persist generated recommendations as local drafts only when no remote binding exists, and branch deselection by remote IDs. Keep the existing “整理收藏” recovery dialog untouched; add stale-decision recovery only inside the DeepSeek service path before it starts classification.

**Tech Stack:** React + TypeScript renderer, Electron main-process coordinator/services, Vitest, existing workspace persistence and IPC APIs.

---

### Task 1: Lock Recommendation State Semantics With Failing Tests

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Add renderer failures for a temporary candidate carrying real state.**
  Cover a selected candidate that is absent from `ledgers` but has a matching persisted ledger by logical rule. Assert the rendered card keeps the persisted display name, `syncState`, `bindingState`, `bilibiliFolderId`, `bilibiliFolderIds`, `bilibiliFolderTitle`, and video count in the editor.

- [x] **Step 2: Add renderer failures for candidate-ID/ledger-ID bidirectional toggling.**
  Use a candidate ID different from the existing ledger ID but with the same rule. Assert clicking either the recommendation checkbox or the top card sends `set-recommended-candidates` for the candidate ID and does not create a duplicate top card.

- [x] **Step 3: Add persistence failures for generated unbacked recommendations.**
  Assert `reconcileRecommendedLedgers` removes a generated local recommendation with no remote ID after deselection, preserves a bound ledger, and preserves an unbound ledger that still has a remote ID. Keep the existing edited-rule protection case unchanged.

- [x] **Step 4: Add a coordinator failure proving the real generated recommendation is marked `local-draft` when it has no existing remote ledger.**
  Capture `saveRecommendedLedgers` input from the actual recommendation flow and assert the newly adopted candidate is a local draft.

- [x] **Step 5: Run only these tests and verify they fail for the missing state/mapping behavior.**
  Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
  Expected: failures specifically report missing state fields, duplicate/mismatched IDs, or retained unbacked recommendations.

### Task 2: Fix Canonical Recommendation Projection And Persistence

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceRecommendationPersistence.ts`

- [x] **Step 1: Add a shared renderer-side candidate resolver.**
  Resolve exact candidate ID first, then the same normalized rule type/keywords. Return the existing ledger unchanged when found; otherwise create a `FavoriteLedger` with the candidate rule, `syncState: 'local-draft'`, `bindingState: 'unbacked'`, no remote IDs, and stable priority. Do not resolve a hand-created transient ledger into a recommendation merely because its rules happen to match when an exact recommendation identity is absent.

- [x] **Step 2: Project the canonical ledger into the visible list without dropping state fields.**
  Filter only generated unbacked recommendation drafts when their candidate is deselected. Retain bound/unbound-with-remote ledgers. Ensure the selected recommendation uses the canonical local ledger ID for the top card while the workspace selection continues to use the candidate ID.

- [x] **Step 3: Route both top-card and recommendation toggles through the candidate-ID map.**
  When a top-card ledger corresponds to a recommendation by exact or logical match, update `recommendedCandidateIds`; otherwise retain the normal enabled-state behavior. Avoid calling `onSaveLedgerEnabled` for recommendation participation toggles.

- [x] **Step 4: Mark generated recommendation records as local drafts in the main process.**
  Update `asLocalRecommendedLedger` and reconciliation so a new recommendation without a remote binding is recognized as removable, while an existing bound/unbound-with-remote ledger remains authoritative and edited local rules remain protected.

- [x] **Step 5: Run the Task 1 tests and verify all pass.**
  Run the same command from Task 1. Expected: all new and existing recommendation tests pass.

### Task 3: Keep整理阶段手动新建收藏夹 Functional

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`

- [x] **Step 1: Add failing tests for new-during-organization lifecycle.**
  Assert a new ledger starts as `local-draft`, cannot be toggled or backed up before save, can be saved while the organization guide is open, and becomes an enabled classification target without being inserted into the recommendation list.

- [x] **Step 2: Add a failing test that saving during scan/organization does not require a preview-only rule-analysis command.**
  Assert local preference persistence succeeds immediately and the rule-analysis queue is deferred or applied when the workspace is ready, rather than rejecting the save.

- [x] **Step 3: Implement the smallest save/queue adjustment.**
  Keep the existing explicit-save semantics and `local-draft` protection. Decouple local ledger persistence from optional current-workspace analysis so scanning does not block save; when a preview workspace is available, enqueue the rule analysis and refresh current classification targets.

- [x] **Step 4: Verify the manual ledger is not removed by recommendation deselection.**
  Add the identity guard in the projection path and assert the manually created ledger remains after a similarly-worded recommendation is deselected.

- [x] **Step 5: Run renderer tests for the lifecycle.**
  Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

### Task 4: Restore The Confirmed DeepSeek Range Dialog

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Add failing UI tests for the dialog.**
  Assert the preview has one `DeepSeek 整理` button and no persistent `整理范围` menu; opening the button shows the three mode options, defaults to `整理不确定项和【未分类】（推荐）`, defaults to `当前批次` for a multi-batch current view, defaults to `本轮所有批次` for the whole-run view, hides batch scope for a single batch, and cancel makes no callback.

- [x] **Step 2: Implement the modal using the existing `OldFavoriteModal`.**
  Reset mode and scope each time the dialog opens from the current view scope, call `onOrganizeWithDeepSeek` only on confirmation, and preserve the existing running/cancel/retry feedback.

- [x] **Step 3: Add only the modal layout styles needed by the existing design system.**
  Do not add a second DeepSeek action or alter unrelated preview controls.

- [x] **Step 4: Run the focused DeepSeek preview tests and verify they pass.**
  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

### Task 5: Recover Stale Decisions Only For DeepSeek

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Add a failing service test for a stale recovery snapshot.**
  Return a recovery-required snapshot and a summary offering `merge-latest`; assert DeepSeek does not call the generator before recovery, then retries against the recovered preview snapshot and preserves the existing classification behavior.

- [x] **Step 2: Add a failing test proving ordinary整理收藏 recovery is unchanged.**
  Keep the renderer recovery-dialog test asserting `requestOldFavoriteOrganization` still opens the existing choices instead of auto-merging.

- [x] **Step 3: Add a coordinator helper for an internally guarded DeepSeek merge.**
  Re-read the recovery summary, validate its revisions, select `merge-latest`, and reopen the workspace. Do not expose a new user-facing recovery choice or alter the normal recovery IPC command.

- [x] **Step 4: Invoke the helper at the DeepSeek service boundary and retry once.**
  Only auto-recover when the stale condition is encountered by DeepSeek; propagate unrelated recovery/rebuild/result-unknown errors unchanged. Never scan or write Bilibili during this recovery.

- [x] **Step 5: Run the service/coordinator tests and verify they pass.**
  Run: `npm test -- electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

### Task 6: Audit, Build, Document, And Commit

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-15-local-only-deletion-binding-state-persistence.md`
- Modify: `docs/superpowers/plans/2026-08-15-recommended-ledger-deepseek.md`

- [x] **Step 1: Run the complete focused regression set.**
  Run the recommendation, ledger lifecycle, DeepSeek preview, workspace hook, coordinator, and service suites used above; record exact counts and any pre-existing warnings.

- [x] **Step 2: Run `npm run build` and `git diff --check`.**
  Expected: build exit code 0 and no whitespace errors.

- [ ] **Step 3: Attempt read-only Electron UI verification.**
  Use the existing isolated development profile and inspect the right-panel recommendation status, detail fields, new-folder save state, and DeepSeek dialog without triggering Bilibili mutations. Record blockers if the desktop context is unavailable.

- [x] **Step 4: Update the ledger index item-by-item.**
  Record code locations, tests, UI evidence, and any unverified conditions for I001-I004. Keep the lack of real Electron context explicitly unverified rather than silently claiming UI completion.

- [x] **Step 5: Confirm the worktree contains only this round's code, ledger, and plan; stage and commit on local `main`.**
  Run `git status --short`, `git diff --stat`, and `git diff --check`, then create one local commit for the round.

> The round is committed on local `main`; Step 3 remains intentionally unchecked because the available Electron process has no usable automation window context.

# Ledger State and Backup Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep saved, binding, selection, recommendation, deletion, analysis, and paused-sync states independent so the right-side bilimi 收藏夹 always displays and executes from persisted reality.

**Architecture:** `FavoriteLedgerOverview` owns temporary editor state and renders combined status labels, while `ControlledFavoriteLedgerPanel` owns workspace recommendation selection and promotes selected recommendations into persisted ledgers. The App formal-binding projection remains authoritative for repository bindings; a local default reset must explicitly release that formal binding without deleting its B 站 folder. Workspace rule analysis and paused B 站 execution retain their existing command interfaces and gain regression coverage at their state-boundary projections.

**Tech Stack:** TypeScript, React, Electron IPC, Vitest, Electron development build.

---

## Requirement coverage and exclusions

- `R001`–`R005`, `R006` points 1–2, `R007` point 2: render persisted saving and B 站 binding facts independently; recommendation selection is not deletion or unbinding.
- `R006` point 3 is excluded because `R007` point 1 explicitly replaces it: default ledgers reset, custom ledgers delete locally.
- `R006` point 4: preserve local editing/saving while rule analysis queues only the last change, and project an actual B 站 sync pause to the confirmation UI.
- `R007` point 1 and `R008`: preserve the default-card identity, reset/unbind it after right-side local deletion, delete custom entries locally, and keep `bilimi·暂存` permanently selected but deletable.
- `R009`–`R012`: when the default system is enabled, default folders can be checked and unsaved; unsaved folders never enter backup/classification, only that folder is skipped in bulk, and all non-default folders remain unselectable until saved.
- Out of scope: deleting 收藏库 videos or logical members, changing B 站 deletion scope, automatic name-based rebinding, new historical status labels, scanning/recommendation/confirmation workflow changes unrelated to the above.

## Task 1: Separate state rendering, forced selection, and executable backup input

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] Write failing component tests for:
  - an editing default folder renders `未保存 · 已备册` in detail and, with the organization card open, the outer card renders only `未保存`;
  - a selected recommendation saved in local preferences renders `未备册`, never `未保存`;
  - a non-default unsaved draft cannot be selected;
  - a default folder and `bilimi·暂存` remain checked under their required conditions while unsaved, but an unsaved default is omitted from `onSyncLedgers` and produces a save-first notice; saved selected folders in the same bulk action still reach `onSyncLedgers`.
- [x] Run the focused component test, observe the expected RED assertions, then implement a status formatter with independent `unsaved` and actual binding values, a forced-enabled predicate for default-system entries plus `inbox`, and an executable-backup filter that excludes any unsaved editor snapshot.
- [x] Keep `isOperable` strict for non-default drafts, keep delete-mode selection separate, and render an alert naming only skipped unsaved folders when another saved selection can execute.
- [x] Re-run the component test until green.

## Task 2: Persist recommendation creation and protect default-reset binding state

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx` or the closest existing App binding-projection test

- [x] Write and run focused recommendation-promotion and default-reset projection regressions.
- [x] Promote selected recommendation candidates through `onSaveLedgers` before projecting them as enabled; preserve a `bindingState: 'unbacked'` until a real backup binds it.
- [x] Make App projection honour the explicit unbound/default-reset contract until a later user-initiated backup confirmation succeeds.
- [x] Re-run focused tests until green.

## Task 3: Release only default formal bindings during local reset

**Files:**

- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `electron/main/favoriteLedgerDraftDeletionIpc.test.ts`
- Test: `src/shared/favoriteRepository.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] Write and run the account-scoped default-reset release bridge contract and component regression. It removes only matching local physical-shard bindings; it does not call a B 站 delete API or remove logical 收藏库 memberships.
- [x] Run focused IPC/repository/component tests and reproduce the prior refresh risk where a local-only default reset left `physicalShards` bound.
- [x] Implement the narrowly named bridge and invoke it only for right-side local-only default reset. Existing local custom-deletion and B 站 remote-deletion paths remain separate.
- [x] Save the reset default template with `bindingState: 'unbound'`; preserve the default card and `bilimi·暂存` identity, and never remove 收藏库 logical video members.
- [x] Re-run focused tests until green.

## Task 4: Allow save coalescing during analysis and project persisted sync pauses

**Files:**

- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify only if failing test proves required: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [x] Verify the existing hook queue test: edits during an active analysis coalesce by ledger and the latest version runs after the active analysis.
- [x] Verify the persisted paused-sync projection and confirmation-step regression: `workspaceRef.currentStep: 'sync-paused'` exposes `executionProgress.syncPaused: true` and the continue/end controls.
- [x] Run the focused hook/coordinator/confirmation tests; no further production change was required because the state-boundary implementation was already present and green.
- [x] Keep destructive/remote actions locked during analysis while local rule editing and queued saving remain available.
- [x] Re-run focused tests until green.
- [x] Re-audit after an independent review: the coordinator rereads the persisted `sync-paused` marker rather than relying on runtime `workspaceRef`; the rule editor/save controls remain available during analysis while backup/delete stay locked. `oldFavoriteWorkspaceCoordinator.test.ts`, `FavoriteLedgerOverview.test.tsx`, `useOldFavoriteWorkspace.test.tsx`, and `OldFavoriteConfirmationStep.test.tsx` passed 473/473 on 2026-08-16; no production change was justified by the review reports.

## Task 5: Cross-layer verification, audit, and single local commit

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-16-unbacked-vs-unsaved-status.md`
- Modify: this plan only if implementation facts differ from the approved scope
- Test: all files above plus their protected deletion/binding/recommendation neighbours

- [x] Run the targeted Vitest files and `npm run build`: 8 files / 792 assertions passed; production build exited 0. Run `git diff --check`, `git diff --stat`, and `git status --short` immediately before staging.
- [ ] In the Electron development build, verify the screenshot-targeted chip/detail statuses, default/custom deletion, recommendation save/reopen, an unsaved default skipped from backup while another saved entry proceeds, paused-sync label/buttons, and analysis-time save. Store screenshots/output beneath `.codex-artifacts/`. Blocked for this run: the running `bilimi` window was enumerated but focus/read control returned `Error: node_repl exec context not found`; details are in `.codex-artifacts/2026-08-16-electron-ui-validation-blocked.txt`.
- [x] Re-read `R001`–`R012` and record exact code locations, automated results, Electron evidence, and any unverified condition in the ledger index.
- [x] Stage only this topic’s files and create one local `main` commit. Do not merge, push, package, or perform real B 站 deletion for acceptance. Electron visual acceptance remains explicitly unchecked above.

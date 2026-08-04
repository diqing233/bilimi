# Favorite Lifecycle Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace divergent favorite counts and lifecycle decisions with one ID-based, local-first model shared by organization, Favorite Library, provisioning, review, settings migration, and note/archive integration.

**Architecture:** Add compact canonical inventory/lifecycle projections in shared types and the main-process repository, then make scanning, workspaces, and UI consume them. Implement changes from storage outward using red-green tests, preserving the current remote arbiter and independent note/archive ownership.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library, persisted workspace files, favorite repository events, Bilibili page bridges.

---

## Safety and baseline

- [x] Read `AGENTS.md` completely and honor discussion/start gating.
- [x] Capture the dirty-tree baseline and preserve all 15 pre-existing modified files.
- [ ] Record every newly touched file before each phase; do not stage unrelated changes.
- [ ] Do not reset, stash, revert, clean, package, push, modify installed builds, delete data, or restore `package.json`.
- [ ] Store diagnostic artifacts under `.codex-artifacts/` only.

### Task 1: Canonical inventory metrics and lifecycle types

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `src/shared/favoriteRepository.ts`
- Test: `src/shared/oldFavoriteWorkspace.test.ts`
- Test: `electron/main/favoriteRepositoryService.test.ts`

- [x] Add failing tests for relationship total, global unavailable/protected/planned unique counts, and per-folder total/planned/protected/unavailable projections.
- [x] Add a failing test proving one AID in two folders contributes two relations but one global unique lifecycle state.
- [x] Add failing tests for active, source-pending, organization-conflict, and recycled lifecycle states.
- [x] Run focused tests and confirm failures are caused by missing fields/state transitions.
- [x] Add versioned shared types and normalization that preserve old snapshots without inventing authoritative remote facts.
- [x] Re-run focused tests and keep existing workspace/repository tests green.

### Task 2: Complete-scan authority and recycle transitions

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/favoriteRepositoryService.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] Add failing tests where a complete scan moves a no-source saved video to recycle and an incomplete scan preserves it as source-pending.
- [x] Add failing tests where changed managed placement plus an ordinary source returns a saved video to organization with existing metadata/tags.
- [x] Add a failing test for a local-only saved result remaining protected when no remote placement was ever expected.
- [x] Implement authoritative observation epochs and lifecycle projection without mutating notes/transcripts/archives.
- [x] Verify the new transitions plus all existing protection/recovery tests.

### Task 3: True streaming batches

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Test: corresponding `*.test.ts` files

- [x] Add a failing scan test proving the first configured-size eligible batch seals before later source pages finish.
- [x] Add failing tests proving unavailable/protected/duplicate AIDs do not consume batch slots.
- [x] Add a failing resume test proving sealed batches and source relations survive restart without duplication.
- [x] Add a failing late-duplicate test proving only the source relation changes.
- [x] Persist compact streaming segment descriptors and trigger tag preparation for sealed batches.
- [x] Preserve remote-read arbitration and bounded status publishing.
- [x] Verify scan, store, coordinator, arbiter, and risk-control suites.

### Task 4: Scan overview projections

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`
- Test: `OldFavoriteScanOverviewStep.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/styles.test.ts`

- [x] Add failing UI tests for the four metric cards and their exact tooltips.
- [x] Add failing tests for ordinary and managed folder actual totals plus the three-way projected column.
- [x] Add tests for unselected `—`, incomplete `待确认`, and current/all scope separation.
- [x] Render only compact projections; do not recalculate from mounted current-segment cards.
- [x] Verify narrow-sidebar alignment and no new long-list rendering.

### Task 5: Whole-round recommendation/archive/confirmation projections

**Files:**
- Modify: `OldFavoriteOverviewControls.tsx`
- Modify: `OldFavoriteRecommendationStep.tsx`
- Modify: `OldFavoriteArchivePreviewStep.tsx`
- Modify: `OldFavoriteConfirmationStep.tsx`
- Test: corresponding component tests and `ControlledFavoriteLedgerPanel.test.tsx`

- [ ] Add failing tests proving whole-round scope does not render current-batch progress/cards.
- [ ] Add failing tests requiring every enabled target and `bilimi·暂存` to render at zero.
- [ ] Add regression coverage for adopted author/tag recommendations changing real main-process classifications.
- [ ] Keep current-batch cards mutable and whole-round views aggregate/read-only except documented whole-round intents.
- [ ] Verify DeepSeek waiting/cancel/retry, history, transfer, undo/redo, and execution gates.

### Task 6: Local-first save and pending provisioning/sync

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `useOldFavoriteWorkspace.ts`
- Test: coordinator/sync/hook/confirmation suites

- [ ] Add failing tests proving every local/current/whole-run result is committed before the first remote write.
- [ ] Add failing tests for save-only completion creating pending sync without automatic later execution.
- [ ] Add tests for resumed remote work handling only remaining immutable operations.
- [ ] Keep inventory reads and remote writes mutually exclusive while allowing DeepSeek to run independently.
- [ ] Verify local results survive remote failure and restart.

### Task 7: Central ledger identity and permission policy

**Files:**
- Create: `src/shared/favoriteLedgerCapabilities.ts`
- Modify: `src/shared/favoriteLedgers.ts`
- Modify: `electron/main/oldFavoriteWorkspaceClassification.ts`
- Modify: recommendation persistence/coordinator files as required
- Test: shared/classification/recommendation suites

- [ ] Add failing tests for formal managed, local draft, ambiguous bilimi-like, and ordinary folder capabilities.
- [ ] Add collision tests for slug-equivalent recommendation sources and migration tests for legacy adopted IDs.
- [ ] Preserve user-edited rules, enabled state, priority, and bindings when recommendations reuse identities.
- [ ] Expose one policy consumed by settings, Favorite Library, provisioning, review, and remote deletion.
- [ ] Verify names alone never grant remote authority.

### Task 8: Provisioning UI and default/reset behavior

**Files:**
- Modify: `FavoriteLedgerOverview.tsx`
- Modify: `FloatingAssistantApp.tsx`
- Modify: `electron/main/index.ts` narrow wiring only
- Test: overview/app/render-isolation tests

- [ ] Add failing tests replacing the small `同步` control and copy with `备册` semantics.
- [ ] Add tests for default rules checked/non-cancelable only while the setting is enabled.
- [ ] Add reset tests: restore default names/keywords, preserve custom definitions, uncheck non-defaults, persist immediately, no unsaved labels.
- [ ] Add deletion-mode tests: temporary all-unchecked view, reliable-bound targets only, cancel restores exact prior selections.
- [ ] Keep settings memo isolation and pointer responsiveness tests intact.

### Task 9: Favorite Library navigation, operations, filters, and recycle bin

**Files:**
- Modify: `FavoriteLibraryNavigation*.tsx`
- Modify: `FavoriteLibraryToolbar.tsx`
- Modify: `FavoriteLibraryApp.tsx`
- Modify: `FavoriteLibraryDialogs.tsx`
- Modify: repository operation services/IPC/preload/global declarations
- Test: Favorite Library component/integration/service suites

- [ ] Add failing tests for three-dot menus on both managed and ordinary groups with different permissions.
- [ ] Restore ordinary-folder middle/detail actions while excluding move, ordinary remote mutation, and ordinary-folder remote deletion.
- [ ] Add tests for local-only delete and local-plus-all-managed-placements delete with ordinary-source disclosure and high-risk confirmation.
- [ ] Add status nested filters and source filters, including unknown-source exclusion from `仅在bilimi工作夹`.
- [ ] Add recycle navigation, restore, local clear, note/archive preservation, and reappearance tests.
- [ ] Preserve virtualization, pagination, detached menus, and selection stability.

### Task 10: Review provisioning hints

**Files:**
- Modify: review presentation/classification files in `FloatingAssistantApp.tsx` and/or `App.tsx` only at existing boundaries
- Test: relevant review/app tests

- [ ] Add failing tests preserving title, UP, and existing predicted-location copy.
- [ ] Add the unprovisioned additive line and `最佳匹配：…（未备册）` case.
- [ ] Prove unprovisioned review performs existing non-favorite actions without creating folders or auto-backfilling later.
- [ ] Prove provisioned checked rules use the same stable identities as organization.

### Task 11: Migration and protected note/archive integration

**Files:**
- Modify: `src/shared/localDataMigration.ts`
- Modify: `electron/main/localDataPersistenceAdapter.ts`
- Modify: `LocalDataSettings.tsx` only if contracts change
- Test: migration/local-data/favorite-library-bridge/video-note identity suites

- [ ] Add failing round-trip tests for bindings, checked/provisioned state, recycle records, observation authority, pending sync/reconcile work, and streaming workspace descriptors.
- [ ] Add backward-compatibility tests for existing archives and older favorite snapshots.
- [ ] Add explicit tests proving recycle/clear/folder deletion never removes note archives, transcripts, versions, memos, or stars.
- [ ] Keep import preview atomic, account-scoped, and remote-action-free.

### Task 12: Verification and handoff

- [ ] Run every phase-focused suite fresh and record exact counts/warnings.
- [ ] Run the broader old-favorite, favorite-repository, Favorite Library, review, settings, migration, and note/archive suites.
- [ ] Run direct TypeScript checking and separate pre-existing dirty-tree failures from new errors.
- [ ] Run `git diff --check` and review all touched files for unrelated changes/mojibake.
- [ ] Restart only the development build with `node_modules\.bin\electron-vite.cmd dev`.
- [ ] In real Electron verify scanning, first-batch availability, current/all views, save-only pending state, provisioning, review hints, Favorite Library menus/filters/recycle behavior, migration preview, and note/archive access.
- [ ] During scan, DeepSeek, provisioning, and sync verify pointer motion, resize, minimize/close, sidebar switching, and note editing remain responsive.
- [ ] Report exact root causes, changes, evidence, warnings, and remaining performance/remote-risk limitations without claiming unmeasured latency improvements.

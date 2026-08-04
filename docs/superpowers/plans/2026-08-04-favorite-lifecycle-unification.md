# Favorite Lifecycle Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace divergent favorite counts and lifecycle decisions with one ID-based, local-first model shared by organization, Favorite Library, provisioning, review, settings migration, and note/archive integration.

**Architecture:** Add compact canonical inventory/lifecycle projections in shared types and the main-process repository, then make scanning, workspaces, and UI consume them. Implement changes from storage outward using red-green tests, preserving the current remote arbiter and independent note/archive ownership.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library, persisted workspace files, favorite repository events, Bilibili page bridges.

---

## Safety and baseline

- [x] Read `AGENTS.md` completely and honor discussion/start gating.
- [x] Capture the dirty-tree baseline and preserve all 15 pre-existing modified files.
- [x] Record every newly touched file before each phase; do not stage unrelated changes.
- [x] Do not reset, stash, revert, clean, package, push, modify installed builds, delete data, or restore `package.json`.
- [x] Store diagnostic artifacts under `.codex-artifacts/` only.

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

- [x] Add failing tests proving whole-round scope does not render current-batch progress/cards.
- [x] Add failing tests requiring every enabled target and `bilimi·暂存` to render at zero.
- [x] Add regression coverage for adopted author/tag recommendations changing real main-process classifications.
- [x] Keep current-batch cards mutable and whole-round views aggregate/read-only except documented whole-round intents.
- [x] Verify DeepSeek waiting/cancel/retry, history, transfer, undo/redo, and execution gates.

### Task 6: Local-first save and pending provisioning/sync

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `useOldFavoriteWorkspace.ts`
- Test: coordinator/sync/hook/confirmation suites

- [x] Add failing tests proving every local/current/whole-run result is committed before the first remote write.
- [x] Add failing tests for save-only completion creating pending sync without automatic later execution.
- [x] Add tests for resumed remote work handling only remaining immutable operations.
- [x] Keep inventory reads and remote writes mutually exclusive while allowing DeepSeek to run independently.
- [x] Verify local results survive remote failure and restart.

### Task 7: Central ledger identity and permission policy

**Files:**
- Create: `src/shared/favoriteLedgerCapabilities.ts`
- Modify: `src/shared/favoriteLedgers.ts`
- Modify: `electron/main/oldFavoriteWorkspaceClassification.ts`
- Modify: recommendation persistence/coordinator files as required
- Test: shared/classification/recommendation suites

- [x] Add failing tests for formal managed, local draft, ambiguous bilimi-like, and ordinary folder capabilities.
- [x] Add collision tests for slug-equivalent recommendation sources and migration tests for legacy adopted IDs.
- [x] Preserve user-edited rules, enabled state, priority, and bindings when recommendations reuse identities.
- [x] Expose one policy consumed by settings, Favorite Library, provisioning, review, and remote deletion.
- [x] Verify names alone never grant remote authority.

### Task 8: Provisioning UI and default/reset behavior

**Files:**
- Modify: `FavoriteLedgerOverview.tsx`
- Modify: `FloatingAssistantApp.tsx`
- Modify: `electron/main/index.ts` narrow wiring only
- Test: overview/app/render-isolation tests

- [x] Add failing tests replacing the small `同步` control and copy with `备册` semantics.
- [x] Add tests for default rules checked/non-cancelable only while the setting is enabled.
- [x] Add reset tests: restore default names/keywords, preserve custom definitions, uncheck non-defaults, persist immediately, no unsaved labels.
- [x] Add deletion-mode tests: temporary all-unchecked view, reliable-bound targets only, cancel restores exact prior selections.
- [x] Keep settings memo isolation and pointer responsiveness tests intact.

### Task 9: Favorite Library navigation, operations, filters, and recycle bin

**Files:**
- Modify: `FavoriteLibraryNavigation*.tsx`
- Modify: `FavoriteLibraryToolbar.tsx`
- Modify: `FavoriteLibraryApp.tsx`
- Modify: `FavoriteLibraryDialogs.tsx`
- Modify: repository operation services/IPC/preload/global declarations
- Test: Favorite Library component/integration/service suites

- [x] Add failing tests for three-dot menus on both managed and ordinary groups with different permissions.
- [x] Restore ordinary-folder middle/detail actions while excluding move, ordinary remote mutation, and ordinary-folder remote deletion.
- [x] Add tests for local-only delete and local-plus-all-managed-placements delete with ordinary-source disclosure and high-risk confirmation.
- [x] Add status nested filters and source filters, including unknown-source exclusion from `仅在bilimi工作夹`.
- [x] Add recycle navigation, restore, local clear, note/archive preservation, and reappearance tests.
- [x] Preserve virtualization, pagination, detached menus, and selection stability.

### Task 10: Review provisioning hints

**Files:**
- Modify: review presentation/classification files in `FloatingAssistantApp.tsx` and/or `App.tsx` only at existing boundaries
- Test: relevant review/app tests

- [x] Add failing tests preserving title, UP, and existing predicted-location copy.
- [x] Add the unprovisioned additive line and `最佳匹配：…（未备册）` case.
- [x] Prove unprovisioned review performs existing non-favorite actions without creating folders or auto-backfilling later.
- [x] Prove provisioned checked rules use the same stable identities as organization.

### Task 11: Migration and protected note/archive integration

**Files:**
- Modify: `src/shared/localDataMigration.ts`
- Modify: `electron/main/localDataPersistenceAdapter.ts`
- Modify: `LocalDataSettings.tsx` only if contracts change
- Test: migration/local-data/favorite-library-bridge/video-note identity suites

- [x] Add failing round-trip tests for bindings, checked/provisioned state, recycle records, observation authority, pending sync/reconcile work, and streaming workspace descriptors.
- [x] Add backward-compatibility tests for existing archives and older favorite snapshots.
- [x] Add explicit tests proving recycle/clear/folder deletion never removes note archives, transcripts, versions, memos, or stars.
- [x] Keep import preview atomic, account-scoped, and remote-action-free.

### Task 12: Verification and handoff

- [x] Run every phase-focused suite fresh and record exact counts/warnings.
- [x] Run the broader old-favorite, favorite-repository, Favorite Library, review, settings, migration, and note/archive suites.
- [x] Run direct TypeScript checking and separate pre-existing dirty-tree failures from new errors.
- [x] Run `git diff --check` and review all touched files for unrelated changes/mojibake.
- [x] Restart only the development build with `node_modules\.bin\electron-vite.cmd dev`.
- [ ] In real Electron verify scanning, first-batch availability, current/all views, save-only pending state, provisioning, review hints, Favorite Library menus/filters/recycle behavior, migration preview, and note/archive access.
- [ ] During scan, DeepSeek, provisioning, and sync verify pointer motion, resize, minimize/close, sidebar switching, and note editing remain responsive.
- [x] Report exact root causes, changes, evidence, warnings, and remaining performance/remote-risk limitations without claiming unmeasured latency improvements.

## Local checkpoint evidence (2026-08-04)

- Focused lifecycle/repository/review/settings suites: 11 files, 584 tests passed. Coverage includes flushing and merging pending bulk/single ledger toggles before deletion mode, keeping normal backup separate from explicit managed-folder deletion, routing permanent recycle clearing through `clear-recycled-favorite`, preserving the latest normal selection through deletion confirmation, and entering recycle with search/source/status/transcription filters reset. Existing output still includes React `act(...)` warnings and the duplicate fixture key `music` warning.
- The full repository Vitest run was attempted but timed out after five minutes without an explicit test failure; it is not recorded as passing.
- `node_modules\.bin\tsc.cmd --noEmit` still fails against the existing dirty-tree baseline. Fresh output is `.codex-artifacts/tsc-checkpoint-20260805-final3.txt`; its SHA-256 matches the prior checkpoint exactly, so the diagnostics in the 27 touched files remain unchanged.
- Real development Electron verification covered mutually exclusive Settings, 掌库, 札记, and 批阅 workspaces; Favorite Library recycle/source-filter navigation; sidebar resize; settings scroll; and minimize/restore. No Bilibili write, provisioning, deletion, backup, or synchronization action was triggered.
- Pointer responsiveness and large-library performance remain unmeasured. Manual interaction completion is not latency evidence.
- Remaining acceptance-only work: a real Bilibili scan/provision/sync run and measured pointer/large-library latency under active scan, DeepSeek, provisioning, and sync workloads.

## Final local acceptance evidence (2026-08-05)

- Full repository regression, excluding only the packaging configuration test that cannot run with the current scriptless `package.json`: 215 test files and 3,263 tests passed; the final fresh run completed in 324.9 seconds. Earlier full-run output is stored in `.codex-artifacts/vitest-full-20260805-acceptance.stdout.log` and `.codex-artifacts/vitest-full-20260805-acceptance.stderr.log`.
- A fresh focused run across the nine modified test files passed 371/371 with exit code 0. The full run emitted 67 existing React `act(...)` warnings and one existing duplicate fixture key warning for `music`; it emitted no unhandled test error.
- `node_modules\.bin\tsc.cmd --noEmit --pretty false` still exits 2 with 216 diagnostics. After normalizing line and column numbers, `.codex-artifacts/tsc-checkpoint-20260805-final5.txt` has zero added and zero removed diagnostics against the prior dirty-tree baseline.
- `git diff --check` passed with only LF-to-CRLF notices. A UTF-8 scan of every modified source/test file found no replacement-character or common mojibake sequence.
- Real development Electron verification covered mutually exclusive `批阅`/`札记`/`掌库`/`设置` views, the 2,309-video Favorite Library, ordinary-folder selection and local actions, expanded detail, two list data columns while detail is open, three after collapse, local-data migration navigation, sidebar resize and restore, and minimize/restore.
- No Bilibili write, provisioning, deletion, scan, synchronization, or DeepSeek task was triggered during acceptance. Those external paths remain release/manual acceptance items; pointer latency and large-library throughput remain unquantified and are not claimed as solved.

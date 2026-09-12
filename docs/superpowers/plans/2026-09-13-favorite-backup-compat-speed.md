# 收藏夹备册兼容提速 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the old name-first backup path for the direct favorite-ledger backup entry while preserving explicit rebind confirmation, formal physical-shard authority, deletion protection, and fail-closed status.

**Architecture:** The direct `FavoriteLedgerOverview` backup request will stop adding a separate remote-observation preflight by default. The existing save/backup operation remains responsible for one fresh Bilibili inventory read, candidate/create confirmation, formal binding, and one final authoritative projection. Organizer sync and explicit discovery/rename flows keep their existing preflight opt-in behavior.

**Tech Stack:** React/TypeScript renderer, Electron IPC, Vitest, Markdown project contracts.

---

### Task 1: Lock the direct-backup compatibility contract with a failing UI regression

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test behavior: the normal direct backup call omits `remoteObservationPreflight`, while an explicit caller can still request it.

- [x] **Step 1: Add a focused failing test** that renders a saved, enabled ledger, clicks the existing backup/sync entry, resolves the single `onSyncLedgers` call as a successful result, and asserts the call options contain `backupTargetLedgerIds` but not `remoteObservationPreflight`.
- [x] **Step 2: Run the focused test** with `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "direct backup uses one fresh inventory path"` and verify it fails because the current request adds `remoteObservationPreflight: true`.
- [x] **Step 3: Add the companion assertion** for an explicit `skipRemoteObservationPreflight: false`/preflight request so discovery-sensitive callers remain covered.

### Task 2: Remove only the redundant direct-backup preflight

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1120-1190`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Change `requestBackup` option construction** so the default direct backup call passes no `remoteObservationPreflight`; retain the existing `skipRemoteObservationPreflight` opt-in/escape hatch and the existing confirmation handling for `remoteObservations`, `unboundCandidates`, and `boundRenameCandidates` returned by the save path.
- [x] **Step 2: Preserve the second-call behavior** only for a user-confirmed candidate/rename/create result; a normal successful direct backup must return the first save result rather than invoking `onSyncLedgers` a second time.
- [x] **Step 3: Run the focused UI test** and verify it passes.

### Task 3: Protect the renderer save path and existing explicit preflight consumers

**Files:**
- Modify: `src/renderer/src/App.test.tsx` only if the new direct path needs a regression fixture.
- Test: existing App backup, rebind, rename, and discovery cases.

- [x] **Step 1: Add or update a regression** proving `saveFavoriteLedgers` still performs its fresh inventory read, formal binding, final authoritative discovery, and failure projection when called without `remoteObservationPreflight`.
- [x] **Step 2: Keep explicit `remoteObservationPreflight: true` tests green** for organizer confirmation, remote-only discovery, and rename confirmation; do not change the organizer sync preflight contract.
- [x] **Step 3: Run focused renderer tests** for `App.test.tsx`, `FavoriteLedgerOverview.test.tsx`, and `favoriteLedgerApi.test.ts`.

### Task 4: Document the split between direct backup and organizer preflight

**Files:**
- Modify: `docs/项目功能项目书.md` in the §4 backup/binding state-machine text.
- Modify: `docs/contracts/favorites.md` in the direct-backup contract.
- Modify: `docs/requirement-ledgers/2026-09-13-backup-speed-diagnostics.md` with implementation evidence for R001–R004.

- [x] **Step 1: State that direct backup uses one fresh inventory in the save operation and one authoritative post-operation projection; it does not perform a redundant separate observation preflight by default.**
- [x] **Step 2: State that `确认并同步到 B 站` retains the unified preflight/one-window confirmation requirement.**
- [x] **Step 3: Record exact code locations, tests, and any unverified real-Electron conditions in the ledger index.**

### Task 5: Verify, review, and commit the single topic

**Files:**
- No additional files beyond Tasks 1–4.

- [x] **Step 1: Run `npm test` and inspect the complete exit code and test count.** `2026-09-13`: exit 0, 253 test files and 4623 tests passed. Existing React `act` diagnostics and intentional old-favorite failure-path logs remained non-fatal; there were no failed tests.
- [x] **Step 2: Run `npm run build` and inspect the complete exit code.** `2026-09-13`: exit 0. Vite reported only the existing dynamic/static FloatingAssistantApp chunking notice.
- [x] **Step 3: Run `git diff --check`, `git status --short`, and `git diff --stat`; confirm only this topic's ledger, plan, contract, renderer, and tests changed.** `2026-09-13`: checked before commit; the only changes are the ledger, plan, two documentation contracts, direct-backup renderer/runtime/script/types, and their affected tests.
- [x] **Step 4: Re-read every confirmed R001–R004 item and record per-item evidence before committing.** `2026-09-13`: re-read the full original-text section and index; the ledger's implementation appendix records source locations, automated evidence, and the remaining real-Electron acceptance gap.
- [x] **Step 5: Create one local commit on `main` containing the requirement ledger and implementation changes; do not push or package until separately requested.** `2026-09-13`: committed locally as `cce0cff4 perf: streamline direct favorite backup`; no push or packaging was performed.

### Review follow-up: combined remote-observation safety gate

- [x] **Finding:** Removing the standalone preflight alone would let the save script observe an unknown remote bilimi folder but continue creating a local target without the old confirmation boundary.
- [x] **Fix:** Normal direct backup passes `includeRemoteOnlyDrafts` and `haltOnRemoteObservations`; the save script returns before creation, formal binding, local persistence, or final discovery. The renderer keeps the existing one-window dialog and marks the confirmed continuation `skipRemoteObservationPreflight: true` so it does not re-open itself for intentionally unselected observations.
- [x] **Regression coverage:** API test proves no `folder/add` call. App runtime test proves no binding, `savePreferences`, or second status read. Overview and controlled-panel tests assert the initial gate options and post-dialog continuation behavior.

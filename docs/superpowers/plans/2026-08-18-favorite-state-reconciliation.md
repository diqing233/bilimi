# Favorite State Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make invalid scanned videos stay out of `bilimi·暂存`, distinguish B 站 write receipts from readback state, and ensure abandoning a paused unfinished organization draft returns the user to a fresh scan.

**Architecture:** Preserve the existing account-scoped repository as the only durable truth. Add only local projections: a scan-confirmed `unavailable` video fact, an exact inbox-membership removal command, and a derived library sync state based on existing success receipts plus observation completeness. The recovery flow remains coordinator-owned; the renderer receives either a fresh authoritative snapshot or a real rejected command, never a `null` success surrogate.

**Tech Stack:** TypeScript, Electron main-process services, React renderer, Vitest, Electron Vite.

---

## File map

- `docs/项目功能项目书.md` — product-level final behavior for all three ledger items.
- `src/shared/favoriteRepository.ts` — persisted video fact and precise local-inbox command.
- `src/shared/favoriteRepository.test.ts` — command-level persistence and non-destructive membership tests.
- `electron/main/oldFavoriteWorkspaceCoordinator.ts` — scan completion cleanup and paused-scan abandonment gate.
- `electron/main/oldFavoriteWorkspaceCoordinator.test.ts` — scan-to-staging and recovery lifecycle regressions.
- `electron/main/favoriteRepositoryService.ts` — derives list/detail sync state and user-facing receipt/readback metadata from persisted records.
- `electron/main/favoriteRepositoryService.test.ts` — state derivation tests covering awaiting readback, conflict, and aligned readback.
- `src/renderer/src/features/favorites/favoriteLibraryModel.ts` — maps main-process sync states to exact Chinese labels.
- `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts` — status-label regressions.
- `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx` — displays receipt-aware detail status and ownership text.
- `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx` — detail presentation regression.
- `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts` — distinguishes command failure from a valid empty snapshot.
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx` — retains the recovery dialog and error on abandon failure.
- `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx` and `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx` — renderer recovery error regressions.

### Task 1: Persist scan-confirmed unavailability and clear only those inbox memberships (`R001` in `2026-08-18-invalid-videos-staged.md`)

**Allowed files:** `src/shared/favoriteRepository.ts`, `src/shared/favoriteRepository.test.ts`, `electron/main/oldFavoriteWorkspaceCoordinator.ts`, `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`.

- [x] **Step 1: Write a failing repository test** that seeds `local:inbox` with one scan-confirmed invalid AID and one valid unmatched AID, commits a requested-AID inbox removal, and expects only the invalid AID to be removed while all other memberships and video rows remain.

- [x] **Step 2: Run the focused repository test and verify RED.**

  Run: `npm test -- src/shared/favoriteRepository.test.ts -t "removes only requested videos from local inbox"`

  Expected: FAIL because the precise inbox-removal command does not exist.

- [x] **Step 3: Implement the smallest shared persistence change.** Add optional `unavailable?: boolean` to `FavoriteRepositoryVideo`; add a command whose payload is a validated AID list; in its reducer remove only those IDs from `memberships['local:inbox']` without deleting videos, positions, ordinary sources, audit history, or remote relationships.

- [x] **Step 4: Write a failing coordinator integration test** that scans one `unavailable: true` item and one valid unmatched item, creates both historical inbox memberships, completes the scan, and expects the invalid item alone to leave `local:inbox`, retain its video fact with `unavailable: true`, and perform no remote bridge request.

- [x] **Step 5: Run the focused coordinator test and verify RED.**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "removes only scan-confirmed unavailable videos from staging"`

  Expected: FAIL because scan completion does not persist unavailability or issue the exact inbox removal.

- [x] **Step 6: Implement scan completion projection.** Include scan-confirmed unavailability in mirror-video persistence; after the completed scan has recorded that local mirror, issue the exact local-inbox removal for the completed scan’s unavailable AIDs. Do not perform cleanup while simply opening a library or for non-confirmed videos.

- [x] **Step 7: Run both focused tests and then their full files.**

  Run: `npm test -- src/shared/favoriteRepository.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: PASS with existing valid-unmatched staging behavior preserved.

### Task 2: Derive B 站 write-receipt / readback state without treating a receipt as observation (`R001` in `2026-08-18-bilibili-sync-status-ownership.md`)

**Allowed files:** `electron/main/favoriteRepositoryService.ts`, `electron/main/favoriteRepositoryService.test.ts`, `src/renderer/src/features/favorites/favoriteLibraryModel.ts`, `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`, `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`, `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`.

- [x] **Step 1: Write a failing main-process read-model test.** Seed a bound logical target, a successful sync checkpoint/organization change, and an incomplete `local-only-change` position. Expect a detail/list state `write-confirmed-awaiting-readback`, including its target labels; seed a complete conflicting readback and expect `write-confirmed-readback-conflict`; seed matching complete readback and expect `synced`.

- [x] **Step 2: Run it and verify RED.**

  Run: `npm test -- electron/main/favoriteRepositoryService.test.ts -t "distinguishes successful write receipts from Bilibili readback"`

  Expected: FAIL because `libraryStatesForAid()` only returns `synced` or `unsynced` from current position observation.

- [x] **Step 3: Implement the smallest read-model extension.** Extend the sync-state union and detail shape; derive an immutable latest successful receipt from persisted successful sync records/organization changes only when its target still maps to a trusted binding. Prefer `synced` only for a complete matching observation; derive awaiting-readback for incomplete observation and conflict for complete mismatch. Do not change any `remoteObserved...` fields, add remote operations, or classify receipt-backed rows as pending retry work.

- [x] **Step 4: Write and run failing renderer model tests** for `B站写入已成功，等待回读确认` and `B站写入已成功，回读不一致，需核验`, then extend label mapping until GREEN.

  Run: `npm test -- src/renderer/src/features/favorites/favoriteLibraryModel.test.ts -t "formats write-confirmed readback states"`

- [x] **Step 5: Write and run a failing library detail test** that renders an awaiting-readback detail and expects the receipt-aware status plus the target in both the status explanation and ownership section, never `未同步` / `尚未扫描或未映射`.

  Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "shows successful Bilibili write awaiting readback"`

- [x] **Step 6: Implement the exact detail projection.** Retain ordinary sources and show actual observed folders beside the logical receipt target. The detail can offer reconciliation for conflict but must not cause append/remove writes on render or refresh.

- [x] **Step 7: Run all Task 2 focused files.**

  Run: `npm test -- electron/main/favoriteRepositoryService.test.ts src/renderer/src/features/favorites/favoriteLibraryModel.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

  Expected: PASS with existing `failed`, `result-unknown`, and true `unsynced` labels unchanged.

### Task 3: Abandon a paused scanning draft atomically and expose failures (`R001` in `2026-08-18-abandon-organization-fresh-scan.md`)

**Allowed files:** `electron/main/oldFavoriteWorkspaceCoordinator.ts`, `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`, `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`, `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`, `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`, `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`.

- [x] **Step 1: Write a failing coordinator test** that creates an incremental workspace, records the persisted scan `paused: true` marker, abandons it, verifies the repository workspace marker and in-memory cache are gone, then calls `beginScan()` and verifies a fresh incremental scan starts. Include an adjacent test that a non-paused active scan still rejects and remains intact.

- [x] **Step 2: Run it and verify RED.**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "abandons a paused scanning workspace"`

  Expected: FAIL with `Old favorite workspace cannot be abandoned while it is active.`

- [x] **Step 3: Implement the lifecycle gate.** Treat only `status === 'scanning' && scan.paused === true` as a locally safe abandonment state. Keep every non-paused scan and all non-local remote execution protections unchanged; successful abandonment still commits `abandon-workspace` before calling `forgetWorkspace()`.

- [x] **Step 4: Write a failing hook test** for an IPC rejection during `abandon-current-workspace`, expecting the hook to return a rejection/failure rather than `null` and to retain the prior snapshot.

- [x] **Step 5: Run it and verify RED.**

  Run: `npm test -- src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx -t "does not treat a failed abandon command as success"`

- [x] **Step 6: Implement explicit command failure propagation.** Keep missing IPC/account handling as unavailable, but for a real command rejection return an explicit failure path that callers can distinguish from a legitimate “no workspace” result; record a visible execution error without clearing the authoritative snapshot.

- [x] **Step 7: Write and run a failing panel test** that makes abandon reject and expects the recovery modal to remain open with an alert, then update the panel to close only after confirmed successful abandonment.

  Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "keeps the recovery dialog open when abandoning fails"`

- [x] **Step 8: Run all Task 3 focused files.**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

  Expected: PASS; no path writes, cancels, or repeats a B 站 action.

### Task 4: Cross-feature verification, ledger evidence, and local main commit

**Allowed files:** all Task 1–3 files, the three current ledgers, `docs/项目功能项目书.md`, and this plan.

- [x] **Step 1: Re-read all three ledger original sections and indices.** Check each required display condition, error path, persistence effect, B 站 boundary, and “do not change” boundary against the completed code.

- [x] **Step 2: Run regression and build verification.**

  Run: `npm test`

  Run: `npm run build`

  Expected: both exit 0. A development Electron run remains required for any visual/interactive claim; it must use mock/local data and no B 站 write.

- [x] **Step 3: Perform development-build UI acceptance.** Verify: (a) an unavailable row disappears from `bilimi·暂存` only after a scan confirms it while a valid unmatched row remains, (b) a receipt-awaiting row shows the exact receipt/readback wording and no duplicate write is sent on refresh, and (c) abandon success closes the old-draft choice then next `整理收藏` starts a scan; simulate abandon failure to confirm the modal stays with an error. Record unavailable environments or unverified visual assertions in the ledgers instead of declaring them complete.

- [x] **Step 4: Update each ledger index with exact code locations, individual test names/output, UI evidence, remaining limitations, and project-book section mapping.** Do not alter original user messages.

- [x] **Step 5: Perform final Git checks and make the single authorized local `main` commit.**

  Run: `git status --short`

  Run: `git diff --stat`

  Run: `git diff --check`

  Commit only the Task 1–4 files and the three ledgers with a message describing the three reconciliation repairs. Do not push, merge, rebase, or modify B 站 data.

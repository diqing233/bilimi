# Favorite Binding Ecosystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make migration, provisioning, rebinding, status indicators, repository actions, and deletion use one account-scoped bilimi ledger binding.

**Architecture:** Keep `FavoriteLedger.id` as the logical identity and make the repository binding (`accountMid + logicalLedgerId + remoteFolderId`) the sole authority for remote capability. Migration preserves that binding for the same account and marks only remote inventory verification as pending until the destination reconnects. Remote folder discovery produces explicit unbound candidates; deletion and library operations consume one structured preview and one confirmation dialog.

**Tech Stack:** Electron main-process services and IPC, React/TypeScript renderer, shared repository snapshots, Vitest.

---

### Task 1: Define binding states and deletion candidates

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`

- [ ] Add typed `bound`, `local-only`, `unbound-name-match`, and `missing-remote` candidate states.
- [ ] Add failing tests for local-only selection, exact bound selection, unbound bilimi-name matching, ordinary-folder exclusion, and ambiguous-name rejection.
- [ ] Make preview return structured candidates and reject empty/silent previews.
- [ ] Make execution revalidate account, ID, title, and explicit unbound acknowledgement before deleting.

### Task 2: Make migration preserve formal bindings

**Files:**
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `src/shared/localDataMigration.ts`
- Test: `src/shared/favoriteRepository.test.ts`
- Test: `src/shared/localDataMigration.test.ts`

- [ ] Add a failing round-trip test proving a same-account migration retains remote IDs and bound state while excluding credentials.
- [ ] Preserve binding rows in the portable archive; mark them `pending-reconcile` only when the destination cannot validate the remote inventory.
- [ ] Keep remote membership observations revalidated rather than treating the archive as proof of current membership.

### Task 3: Add rebinding discovery and status projection

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/shared/types.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [ ] Add an IPC preview for explicit rebinding candidates used by the backup dialog.
- [ ] Keep local rules intact for local-only ledgers; create unsaved recovered drafts only for remote-only bilimi folders.
- [ ] Add a confirm-adoption IPC that calls the existing ID-only adoption service and persists the same binding used by the repository.
- [ ] Project `已备册`, `未备册`, and `未绑定` consistently without enabling remote classification before verified binding.

### Task 4: Unify deletion from sidebar and favorite library

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLibraryEntry.tsx` or its current library folder controller
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `electron/main/favoriteRepositoryIpc.test.ts`

- [ ] Replace the two-step deletion UI with exactly one second-level confirmation modal.
- [ ] Require the knowledge checkbox only when selected candidates include unbound name matches.
- [ ] Delete local work-folder memberships and remote bilimi folders through the same command, preserving videos, archives, notes, and ordinary Bilibili folders.
- [ ] Refresh both sidebar and library projections from the same result and show a useful error for an empty candidate set.

### Task 5: Verification and one local commit

- [ ] Run related Vitest suites and the TypeScript/build checks.
- [ ] Run `git diff --check`, inspect `git diff --stat`, and review all changed paths for unrelated edits.
- [ ] Validate the sidebar and library deletion/rebinding flows in the Electron development build where feasible.
- [ ] Commit the complete round once on `main`.

# Sync Binding Reclaim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a saved bilimi ledger reclaim its exact Bilibili folder during sync when the local repository binding is absent.

**Architecture:** The workspace coordinator resolves a saved `bound` ledger to its exact remote folder ID, passes that ID to the existing binding service, and lets the service validate title and account from live inventory before writing a physical shard. A missing or mismatched remote target remains blocked; no name-only automatic claim is introduced.

**Tech Stack:** Electron main process, TypeScript, Vitest.

---

### Task 1: Prove exact binding reclaim

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] Change the reset/reclaim test so a saved `remoteFolderId` must freeze successfully, retain the same remote ID, and never create a folder.
- [x] Run `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "reclaims a saved remote target"` and verify the old implementation fails because it ignores `resolveLedgerBinding`.

### Task 2: Resolve and validate the saved target

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/index.ts`

- [x] Add a typed resolver that returns a saved binding only for a ledger explicitly marked `bound` with a valid remote ID.
- [x] During remote-plan provisioning, pass that ID only to the first missing shard. The binding service remains the authority that verifies the live Bilibili inventory and title.
- [x] Run the focused coordinator tests and verify the reclaim test passes.

### Task 3: Regression verification

**Files:**
- Verify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Verify: `electron/main/favoriteRepositoryBindingService.test.ts`

- [x] Run focused coordinator and binding-service suites, then `npm run build`.
- [x] Run `git diff --check`, inspect `git diff --stat`, and commit only the plan, implementation, and tests.

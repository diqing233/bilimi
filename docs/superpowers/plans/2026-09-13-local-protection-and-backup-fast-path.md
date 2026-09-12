# Local Bilimi Protection and Backup Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict old-favorite protection to actual local Bilimi-folder members and remove the redundant post-save remote read from the ordinary already-bound backup path.

**Architecture:** Add one coordinator helper deriving the protection set solely from snapshot `memberships` keyed by `bilimi-logical:`. Every scan creation, completion, recovery, and inventory projection consumes that helper. In the renderer, derive whether the backup made an externally observable state change from the existing automation/binding results; only changed or uncertain paths await the authoritative post-save discovery, while the stable bound path retains the fresh first inventory result.

**Tech Stack:** Electron main process, React/TypeScript renderer, Vitest, npm scripts.

---

### Task 1: Specify protection from actual local Bilimi memberships

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [x] **Step 1: Write failing regression cases**

Add coordinator tests with a snapshot containing `bilimi-logical:kept: [1]`, `local:archive: [2]`, `local:inbox: [3]`, `bilibili:source: [4]`, historical organization records for all aids, and recovered remote managed member `5`. Assert that only aid `1` is protected in normal scan, completion overview, and restored incremental scan.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: the assertions currently observe `2`, `3`, `4`, and/or `5` as protected because the coordinator reads organization records and restored managed members.

- [x] **Step 3: Implement one local protection helper**

In `oldFavoriteWorkspaceCoordinator.ts`, add a private helper accepting a repository snapshot and returning a `Set<number>` made only from `memberships` whose folder id begins with `bilimi-logical:`. Replace all five independent protection-set constructions: scan start, streamed-page fallback, scan completion, interrupted scan recovery, and inventory metric projection. Remove restored remote managed members from the protection construction but do not remove their observation behavior.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS; only actual local Bilimi members are protected.

### Task 2: Remove the redundant stable backup post-save read

**Files:**
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`

- [x] **Step 1: Write failing renderer regressions**

Add a direct-backup test for a fully bound, unchanged rule that counts remote directory reads and asserts one read. Add separate tests that a newly created, explicitly rebound, renamed, and failed binding still run the final status refresh.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: the stable bound backup performs the current second `readRemoteFavoriteDiscovery` refresh and exceeds one directory read.

- [x] **Step 3: Implement the minimal refresh gate**

In `App.tsx`, compute a local `requiresPostSaveDiscovery` only after the save script, binding registration, and rename result are available. Keep the forced refresh for created/bound/rebound/renamed/failed/unknown/remote-observation paths. For the unchanged formally bound path, persist the first verified inventory result and return it without awaiting a second discovery read. Do not alter candidate confirmation, exact-ID binding, or error reporting.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: PASS; stable backup does one directory read while state-changing and failure paths keep their final refresh.

### Task 3: Full verification and documentation

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-13-backup-speed-diagnostics.md`
- Modify: `docs/requirement-ledgers/2026-09-13-local-bilimi-membership-protection.md`

- [x] **Step 1: Run complete automated checks**

Run: `npm test` then `npm run build`.

Expected: both commands exit 0.

- [x] **Step 2: Perform available preview checks**

Run: `npm run preview` and inspect the local development runtime when it starts. Record any unavailable desktop automation as an explicit limitation rather than treating it as a pass.

- [x] **Step 3: Update per-requirement evidence**

Append actual source locations, focused/full test output, build output, and desktop/preview verification status to each ledger index without modifying original user messages.

- [x] **Step 4: Final repository checks and commit**

Run: `git status --short`, `git diff --stat`, and `git diff --check`. Commit only the plan, two ledgers, coordinator, renderer, and their tests with message `fix: align favorite protection and backup speed`.

**Recovery follow-up before Step 4:** Code review identified two remaining old-rule paths: scanning recovery reused persisted inventory protection counts, and previewing/completed recovery reused journal `baselineCompletedAids`. Regression tests now assert that each recovery branch derives protection and inventory from current `bilimi-logical:*` memberships. The coordinator rebuilds restored inventory projections from the current snapshot and filters the current membership protection set to active aids; it does not alter scan, binding, remote observation, or Bilibili write behavior.

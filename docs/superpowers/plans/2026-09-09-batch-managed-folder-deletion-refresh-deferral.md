# Batch Managed-Folder Deletion Refresh Deferral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one managed-folder remote deletion batch on its bound Bilibili WebView target by deferring observer-triggered favorite-page reloads until the batch is over.

**Architecture:** The main-process runtime bridge establishes a renderer-side, account-and-tab-scoped refresh deferral before a managed deletion sends its first request. The renderer records observer mutations rather than calling the refresh IPC immediately. The deletion service releases the deferral in `finally`; when at least one remote deletion was confirmed, it invokes the existing main-process `onConfirmedRemoteFolderMutation` callback exactly once. That callback remains the sole page/projection refresh mechanism. An unknown deletion with no confirmed result never causes a refresh.

**Tech Stack:** TypeScript, Electron main/renderer runtime IPC, React, Vitest.

---

## Requirement disposition

1. `R014 / I014`: batch remote deletion defers intermediate observer refresh and performs at most one existing unified refresh after the batch.
2. `R015 / I015`: tests first; preserve exact-ID, serial, stop-on-unknown deletion behavior and do not perform live destructive Bilibili verification.
3. `R011 / I011`: excluded because `R013` proved its delay-based implementation wrong.

## Allowed files

- `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/App.test.tsx`
- `electron/main/favoriteRepositoryRuntimePageBridge.ts`
- `electron/main/favoriteRepositoryRuntimePageBridge.test.ts`
- `electron/main/favoriteRepositorySyncService.ts`
- `electron/main/favoriteRepositorySyncService.test.ts`
- `docs/requirement-ledgers/2026-09-09-favorite-library-duplicate-names.md`
- this plan

## Task 1: Specify the runtime deferral handshake

- [x] Add failing runtime-bridge tests asserting that a bound managed-deletion run sends `begin-managed-folder-deletion-refresh-deferral`, receives a normal account-verified result, then sends the matching `end` request and exposes `refreshDeferred`.
- [x] Run `npm test -- electron/main/favoriteRepositoryRuntimePageBridge.test.ts` and confirm failure because the bridge has no begin/end lifecycle methods.
- [x] Add the two typed runtime request variants and idempotent bridge-manager methods. `begin` requires the already bound target; `end` returns only the renderer-recorded `refreshDeferred` flag.
- [x] Re-run the focused runtime bridge test and confirm it passes.

## Task 2: Defer the renderer observer without changing it

- [x] Add a failing `App.test.tsx` runtime test: establish a target-bound managed deletion deferral; dispatch a delete mutation signal; verify no immediate `retryBilibiliFavoriteSpaceRefresh`; finish the matching run; verify it reports `refreshDeferred`; dispatch a later non-deferred mutation and verify normal refresh resumes.
- [x] Run the focused App test and confirm it fails because the runtime requests are unsupported.
- [x] In `App.tsx`, keep a run-keyed suppression map containing account, tab ID, and a deferred flag. Begin validates the same current target used by the page bridge. The mutation handler marks only that target's active run deferred and returns. End removes only its own run and reports the flag. No BiliWebview observer protocol changes are needed.
- [x] Re-run the focused App test and confirm it passes.

## Task 3: Tie the managed deletion lifetime to one refresh

- [x] Add failing sync-service tests for a multi-folder remote deletion: `begin` occurs before the first delete, `end` occurs before the single confirmed-mutation callback, and `release` always follows; an unknown result still ends and releases without a refresh; an end failure does not block a confirmed result's one refresh.
- [x] Run `npm test -- electron/main/favoriteRepositorySyncService.test.ts` and confirm the lifecycle expectation fails before implementation.
- [x] Update both managed-folder remote batch entry points to begin after target binding; end in `finally`; invoke the existing confirmation callback once after end only for a confirmed remote deletion; then release. Preserve the existing serial loop, exact-ID reconciliation, and unknown-result stop behavior.
- [x] Re-run the sync-service test and confirm it passes.

## Task 4: Verify and audit

- [x] Run focused runtime, renderer, and sync service test files; then run `npm run build`, `git diff --check`, `git status --short`, and `git diff --stat`.
- [x] Update `I014/I015` with final source locations and per-test evidence. Record that no destructive live Bilibili batch was run.
- [ ] Commit only the allowed files with the ledger and plan.

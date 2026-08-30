# Favorite Deletion Refresh Installed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure confirmed Bilibili deletions always converge local projections and refresh the UI even when an individual local cleanup callback fails, while preserving single remote deletion and responsive interaction.

**Architecture:** Keep remote deletion and local convergence as separate phases. After the remote result confirms exact folder IDs, derive and persist the next local projection independently, isolate per-item cleanup failures, then request one authoritative account refresh; only a failure of both local convergence and authoritative reread keeps the local-save checkpoint.

**Tech Stack:** React, TypeScript, Electron IPC, Vitest.

---

### Task 1: Documentation and acceptance contract

**Files:**
- Modify: `docs/项目功能项目书.md` in the deletion result/local cleanup section
- Create: `docs/requirement-ledgers/2026-08-31-favorite-deletion-refresh-installed.md`

- [x] Record the complete user discussion and confirmed I001 index.
- [x] Add the explicit phase-isolation and installed-build acceptance rules to the project book.

### Task 2: Regression test for local cleanup isolation

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] Add a test with confirmed remote deletion, multiple local drafts/rules, and a throwing `onDeleteLedger`/refresh callback.
- [x] Assert the remote deletion mock is called once, deleted IDs disappear from the rendered projection, retained defaults render `未备册`, and the success flow does not leave the stale error checkpoint when authoritative refresh succeeds.
- [x] Run the focused test and verify it fails for the current implementation.

### Task 3: Isolate local cleanup errors and reproject

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] Make local persisted cleanup and per-ledger callbacks best-effort after the remote exact-ID result is confirmed.
- [x] Ensure the derived `next` projection is applied before optional refresh callbacks can fail, and preserve a diagnostic checkpoint only when the authoritative reread cannot complete.
- [x] Keep remote deletion invocation and all unrelated整理/DeepSeek/sync behavior unchanged.
- [x] Run focused tests and then the related favorite module regression.

### Task 4: Verify, record evidence, and commit

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-31-favorite-deletion-refresh-installed.md`

- [x] Run `npm test`, `npm run build`, `git diff --check`, and inspect `git diff --stat`/`git status --short`.
- [x] Record exact code locations, test counts, build result, and installed-package version limitation in the ledger.
- [x] Commit only this ledger, project book, plan, deletion implementation, and deletion tests.

# Favorite Library Canonical Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove false duplicate folders from Favorite Library without losing raw recovery data, and stop command idempotency history from growing by one full snapshot per command.

**Architecture:** Keep the repository snapshot as the raw sync/recovery authority. Build a cached, account-and-revision-scoped canonical library index in the main process that aggregates only folders connected by explicit binding identity. Replace persisted full command results with compact receipts while reconstructing duplicate command responses from the current authoritative snapshot and retained affected identifiers.

**Tech Stack:** TypeScript, Electron main process, Vitest, generation-based JSON persistence.

---

### Task 1: Canonical Favorite Library read model

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Test: `electron/main/favoriteRepositoryService.test.ts`

- [ ] Add failing tests proving a logical folder aggregates its physical shards and bound Bilibili mirrors into one navigation folder and one deduplicated member page.
- [ ] Add a failing test proving unrelated same-title Bilibili folders remain separate and are reported as a title conflict.
- [ ] Extend the existing library index with canonical folder rows, raw-to-canonical mappings, canonical membership unions, and conflict metadata.
- [ ] Return canonical folders from `getLibrarySummary()` and resolve folder pages/details through the cached canonical mappings.
- [ ] Keep the index scoped to the loaded account and invalidate it on every repository or checkpoint revision change.
- [ ] Run `npx vitest run electron/main/favoriteRepositoryService.test.ts`.

### Task 2: Compact idempotency receipts

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Test: `electron/main/favoriteRepositoryService.test.ts`

- [ ] Add a failing test proving persisted command history contains compact metadata rather than embedded snapshots.
- [ ] Add a failing restart test proving an old full-result generation is loaded, compacted on the next persistence, and still rejects reapplication of a duplicate command.
- [ ] Store command ID, command fingerprint, accepted revision/time, and affected folder/video IDs instead of a full command result.
- [ ] Reconstruct duplicate command responses from the current authoritative snapshot, while preserving the existing special checks for workspace and physical binding commands.
- [ ] Reject reuse of a command ID with different command content except for the two existing authoritative state-reapplication paths.
- [ ] Normalize legacy full-result entries into compact receipts during load and persist the compact representation atomically on the next normal commit.
- [ ] Run `npx vitest run electron/main/favoriteRepositoryService.test.ts`.

### Task 3: Regression verification and delivery

**Files:**
- Modify only files required by Tasks 1 and 2.

- [ ] Run favorite repository, IPC, sync, binding, workspace, and renderer Favorite Library tests.
- [ ] Run `npm run build`.
- [ ] Inspect `git diff` and ensure unrelated historical `docs/superpowers` files remain untracked and unstaged.
- [ ] Create one overall commit for the completed requirement.

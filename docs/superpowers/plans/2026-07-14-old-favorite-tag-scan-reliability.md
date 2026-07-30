# Old Favorite Tag Scan Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make old-favorite scanning return usable tags reliably while preserving cache and recovery behavior.

**Architecture:** Treat metadata and tag retrieval as two phases of one scan. Persist unique-video progress throughout, resolve tags sequentially with timeout and bounded retry, then build the final preview from enriched source folders. Keep the persisted worker only as a recovery path using the same request behavior.

**Tech Stack:** TypeScript, Electron webview scripts, React, Vitest, Testing Library

---

### Task 1: Capture the regression

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] Replace expectations that the initial scan returns empty tags with expectations that it waits for and returns fetched tags.
- [ ] Add coverage for unique-video totals, cache reuse, bounded retries, and continuing after a terminal tag failure.
- [ ] Run the focused tests and confirm they fail for the current background-only implementation.

### Task 2: Restore reliable tag resolution

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`

- [ ] Centralize tag request timeout and retry behavior inside the generated webview scripts.
- [ ] Resolve queued unique aids before the initial scan returns, persisting progress after each outcome.
- [ ] Apply cached or fetched tags back to every matching source-folder video.
- [ ] Keep failed aids recoverable without blocking subsequent videos.
- [ ] Use the same bounded request behavior when resuming a persisted queue.

### Task 3: Make progress truthful

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] Display unique-video totals for both phases.
- [ ] Show running, paused, completed, and completed-with-failures states explicitly.
- [ ] Avoid presenting an empty-tag preview as a finished organization result.

### Task 4: Verify and integrate

**Files:**
- Modify only files required by preceding tasks.

- [ ] Run focused API and panel tests.
- [ ] Run the complete Vitest suite.
- [ ] Run the production build.
- [ ] Review the final diff and confirm unrelated `tmp/` files remain untouched.
- [ ] Create one git commit for the complete requirement and merge it into `main`.

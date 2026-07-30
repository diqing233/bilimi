# Stability And Large Library Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve DeepSeek configuration across exit/restart, clarify close/reset behavior, support responsive large-library scans, and fix Windows installed-build presentation defects before producing a new installer.

**Architecture:** Three isolated worktrees implement independent settings, archive-scan, and Windows-shell changes with regression tests first. The root agent integrates the branches, reviews cross-cutting persistence behavior, runs the full suite, and validates dev, preview, and installed-package paths from the release checklist.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, electron-store, electron-builder/NSIS, Pillow icon generation.

---

### Task 1: Settings Persistence And Close Semantics

**Files:**
- Modify: `electron/main/store.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `electron/main/mainWindowCloseBehavior.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: corresponding `*.test.ts` and `*.test.tsx` files

- [ ] Add a failing regression test that saves the Yunshulink DeepSeek URL, performs unrelated preference updates, reloads the store, and retains the URL/model.
- [ ] Add patch-based main-process persistence and migrate unrelated callers away from stale full preference snapshots.
- [ ] Add failing close-behavior migration tests for default prompt, remembered direct action, and legacy upgrade.
- [ ] Implement `记住关闭选择` semantics and retain the existing dialog checkbox synchronization.
- [ ] Add failing reset-confirmation tests, then require confirmation before clearing settings and the DeepSeek key.
- [ ] Run focused settings, store, close, App, and assistant tests.

### Task 2: Two-Phase Old Favorite Scan

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: persistence/runtime files required for resumable tag enrichment
- Test: corresponding favorite API, preview, panel, and runtime tests

- [ ] Add failing tests proving basic video metadata completes without waiting for tag-detail requests.
- [ ] Implement a basic-info phase that deduplicates aids while retaining source and managed-folder memberships.
- [ ] Add failing tests for tag cache hits, paced retries, risk-control pause, persistence, and resume.
- [ ] Implement background tag enrichment and incremental preview updates without overwriting manual adjustments.
- [ ] Add two compact progress rows and lock only the three downstream wizard buttons until basic info completes.
- [ ] Add the incomplete-tag execution warning and freeze the selected execution snapshot.
- [ ] Run focused archive-scan and assistant-panel tests.

### Task 3: Windows 10 Rendering, Resize, And Icon

**Files:**
- Modify: `electron/main/floatingSealWhiteStripFix.ts`
- Modify: `electron/main/floatingSealGeometry.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/mainWindowDisplayLayout.ts`
- Modify: `scripts/generate-app-icon.mjs`
- Regenerate: `electron/assets/bilimi-avatar.png`, `electron/assets/bilimi.ico`, `build/icon.png`, `build/icon.ico`
- Test: corresponding Electron and script tests

- [ ] Add failing geometry tests for inward edge nudging and 125% display rounding.
- [ ] Keep the floating transparent host inside the current work area and recompose inward at display edges.
- [ ] Add a failing right-border resize regression test and eliminate display/layout feedback during native resize.
- [ ] Add an icon crop/scale test, enlarge the existing artwork modestly, and regenerate the complete ICO ladder.
- [ ] Run focused Windows shell, layout, packaging, and icon tests.

### Task 4: Integration And Release Verification

**Files:**
- Modify only integration conflicts and release records required by the final result.

- [ ] Review each worktree diff for scope and correctness before integration.
- [ ] Integrate all three branches and run the complete test suite.
- [ ] Run `npm run build` and verify the production bundle.
- [ ] Run and inspect dev and preview critical paths from `docs/release-checklist.md`.
- [ ] Run `npm run dist:win`, install the generated package, and validate installed critical paths including DeepSeek restart, Win10/125% resize, floating-pet edges, and icon surfaces.
- [ ] Merge the integrated result to local `main` and create one overall commit.

# DeepSeek Live Details and Tag Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show details for videos already processed by DeepSeek while excluding unavailable/unprocessed videos, and keep tag-enrichment pause/resume controls usable during DeepSeek work.

**Architecture:** Extend the trusted main-process DeepSeek progress payload with cumulative processed-video details produced only after a request group settles. Keep historical details collapsed, but render the current run's processed details inline. Separate tag-enrichment command locking from the broader DeepSeek read-only browsing state so source-folder mutations remain protected while pause/resume controls stay independent.

**Tech Stack:** Electron IPC, TypeScript, React 19, Vitest, Testing Library.

---

### Task 1: Trusted live DeepSeek detail payload

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] Add a failing service test asserting settled progress contains only actually submitted, available videos, with before/after targets and unchanged results retained.
- [ ] Run the service test and verify it fails because processed details are absent.
- [ ] Add the shared processed-item type and emit cumulative details after each settled group.
- [ ] Forward the optional payload through IPC/preload typing without accepting renderer-authored results.
- [ ] Run service and IPC tests and verify they pass.

### Task 2: Render current-run details without reopening history

**Files:**
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.ts`

- [ ] Add failing hook and component tests for retaining cumulative processed items and showing current-run details inline while historical details stay collapsed.
- [ ] Run the tests and verify the expected missing live-detail failures.
- [ ] Preserve processed items when the final response replaces running feedback, deduplicate by aid, and render only the trusted processed list inline.
- [ ] Run hook, feedback-model, and archive-preview tests and verify they pass.

### Task 3: Decouple tag controls from DeepSeek browsing lock

**Files:**
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [ ] Add a failing guide test proving pause/resume remains enabled while DeepSeek is waiting or running.
- [ ] Run the test and verify the control is currently disabled by the shared loading state.
- [ ] Add a dedicated tag-enrichment mutation state and a separate scan-step tag-control lock; retain the existing lock on source selection and archive mutations.
- [ ] Run guide, scan-overview, and workspace-hook tests and verify they pass.

### Task 4: Regression and real Electron verification

**Files:**
- Evidence only: `.codex-artifacts/`

- [ ] Run targeted DeepSeek, scan, confirmation, and overview tests.
- [ ] Run `npx electron-vite build`.
- [ ] In the real Electron dev app, verify live processed details, filtered unavailable/unprocessed items, scan navigation, pause/resume tag enrichment, cancellation, click, scroll, zoom, minimize, and close.
- [ ] Run `git diff --check`, `git status --short --branch`, and `git diff --stat`; report existing TypeScript/full-suite issues separately.

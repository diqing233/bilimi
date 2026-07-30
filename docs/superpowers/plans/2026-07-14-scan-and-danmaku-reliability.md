# Scan And Danmaku Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore responsive old-favorite scanning with cancellation and reliable progress, and replace the fixed danmaku wake schedule with a layer-readiness trigger.

**Architecture:** Keep the Bilibili guest page as the owner of scan state, but separate the quick favorite-folder scan from the slower tag enrichment worker. The renderer reads only lightweight progress while work is active and stops polling as soon as work completes or is cancelled. Danmaku recovery observes the actual Bilibili danmaku subtree and repaints once the visual layer exists instead of guessing with fixed delays.

**Tech Stack:** Electron 42, React 19, TypeScript, Vitest, Testing Library, injected Bilibili page scripts.

---

### Task 1: Old-favorite scan progress and cancellation contract

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] Add failing tests proving the initial scan returns after basic discovery, starts tag enrichment as a background queue, publishes real basic progress, retries transient folder-page failures, and exposes a full-scan cancel action.
- [ ] Run the focused API and App tests and confirm they fail for the missing behavior.
- [ ] Add a scan control record with a generation/revision and cancelled state in the guest page store.
- [ ] Persist basic progress after every completed folder page using discovered unique-video counts and known total counts where available.
- [ ] Add timeout plus bounded retry/backoff to favorite-folder page reads and preserve the final error code/message in diagnostics.
- [ ] Return immediately after the basic scan queues missing tags, then start the existing low-frequency tag worker.
- [ ] Make cancellation invalidate in-flight results, stop further folder/tag requests, clear the current incomplete queue, and leave the previous successful preview available in React.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Lightweight scan UI and wording

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] Add failing tests for immediate progress rendering, progress-only polling during scan overview, polling shutdown after completion, compact cancellation, previous-preview preservation, the scan guidance sentence, and lowercase `bilimi` user-facing copy.
- [ ] Run the focused component/style tests and confirm they fail for the new requirements.
- [ ] Render the scan overview while a scan is pending even before a new preview returns.
- [ ] Poll the guest scan snapshot only while basic scan or tag enrichment is active; merge progress without rebuilding the large preview outside the archive-preview step.
- [ ] Put a compact `取消` button at the right edge of the running status row; hide it outside active scanning and expose an accessible label.
- [ ] On cancel, increment the scan generation, request guest cancellation, restore the last successful preview, and show `已取消扫描。`.
- [ ] Add the guidance text `请耐心等待扫描完成；完成后按上方步骤从左到右，依次完成本轮整理。` above the progress rows.
- [ ] Change relevant visible `Bilimi` strings to `bilimi` without changing internal identifiers.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Danmaku layer readiness recovery

**Files:**
- Modify: `src/renderer/src/features/browser/BiliWebview.tsx`
- Modify: `src/renderer/src/features/browser/BiliWebview.test.tsx`

- [ ] Add a failing test proving the injected script observes the danmaku subtree and wakes the visual layer when a real danmaku node/layer appears.
- [ ] Add a failing assertion that the obsolete fixed delay list is absent.
- [ ] Run the focused browser test and confirm the new assertions fail.
- [ ] Replace the fixed `0/250/800/1600/3200ms` timers with a bounded `MutationObserver` that watches Bilibili player roots for danmaku container/canvas/node insertion.
- [ ] Repaint the video, danmaku container, active danmaku nodes, canvas and SVG targets once readiness is detected; also run the same repaint when the tab becomes active, the host resizes, or HTML fullscreen ends.
- [ ] Disconnect observers after success, navigation, cleanup, or a bounded observation lifetime; do not toggle the user's danmaku switch.
- [ ] Run the focused browser tests and confirm they pass.

### Task 4: Verification and single commit

**Files:**
- Verify all modified production and test files.

- [ ] Run focused tests for favorite scanning, panel UI, styles, App integration, and BiliWebview.
- [ ] Run `npm run build` and confirm type checking and bundling succeed.
- [ ] Run the complete test suite and distinguish pre-existing failures from regressions using fresh output.
- [ ] Review `git diff --check`, `git diff`, and `git status --short` without reverting unrelated user changes.
- [ ] Perform a final requirements review covering cancellation, progress behavior, retry diagnostics, guidance, lowercase branding, and danmaku readiness.
- [ ] Stage the complete current requirement整改 and create one overall git commit as required by `AGENTS.md`.

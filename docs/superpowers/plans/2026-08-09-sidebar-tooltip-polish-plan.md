# Sidebar Tooltip Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the assistant sidebar’s help, status, and transcription controls more readable without changing organization, transcription, or synchronization behavior.

**Architecture:** Keep behavior in the existing React components. Reuse the existing portal-based help-tooltip positioning for 收藏夹 and 整理收藏, make the status-light tooltip use the same presentation contract, and scope compact menu typography to the shared video-summary component. CSS remains in the existing renderer style sheets.

**Tech Stack:** React, TypeScript, Vitest, CSS.

---

### Task 1: Lock the requested visible behavior in tests

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.test.tsx`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] **Step 1: Write failing expectations**

  Assert that the collapsed guide/help controls keep an accessible tooltip and suppress it in expanded mode; DeepSeek feature lines say `已开启`; the shared operation trigger is named `转写操作`; and style contracts use an elevated left-of-sidebar tooltip plus compact menu text and stronger scan notices.

- [ ] **Step 2: Run focused tests to verify RED**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/favorites/FavoriteLibraryToolbar.test.tsx src/renderer/src/styles.test.ts`

  Expected: failures that mention the old labels, old placement, or missing stronger status classes.

### Task 2: Apply the smallest UI implementation

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/notes/VideoSummaryMenu.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`

- [ ] **Step 1: Position the two portal help tooltips away from the sidebar body**

  Use the existing viewport-clamped placement effect, preferring the space immediately left of the side panel. Retain below/above fallback when the viewport has insufficient room. Keep the portal absent whenever the corresponding expandable help text is open.

- [ ] **Step 2: Unify the status-light presentation and wording**

  Turn each status-light tooltip into a viewport-safe elevated card using the same readable typography as the 收藏夹 help card, change enabled wording to `已开启`, and ensure compressed sidebar widths clamp the card inside the viewport rather than behind the panel.

- [ ] **Step 3: Tighten the transcription operation menu**

  Rename the shared trigger and accessible menu from `视频总结` to `转写操作`. Decrease only the trigger/menu dimensions and menu text size required by the compact toolbar; action labels and handlers remain unchanged.

- [ ] **Step 4: Clarify guide and scan information hierarchy**

  Keep `④ 确认执行：` emphasized while rendering its explanatory continuation as black body text. Render `适合视频较多的情况` as normal body text. Add semantic classes for the tag-paused and scan-summary notices, then give them stronger, readable primary-information styling without turning them into error alerts.

### Task 3: Verify and hand off

**Files:**
- Test: files from Task 1

- [ ] **Step 1: Run focused regression tests**

  Run the Task 1 command and require all selected tests to pass.

- [ ] **Step 2: Run production build and diff checks**

  Run: `npm run build`, `git diff --check`, and `git diff --stat`.

- [ ] **Step 3: Independent review and commit**

  Create the requested maximum-reasoning Terra review task after implementation. Apply any review findings, repeat relevant tests/build, ensure only this round’s files remain changed, then create the one authorized local commit and suspend the computer.

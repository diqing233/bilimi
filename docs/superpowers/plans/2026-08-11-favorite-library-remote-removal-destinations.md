# Favorite Library Remote Removal and Destinations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bilimi remote-placement deletion explicit and safe, and keep copy/move destination folders identical to the left navigation's bilimi work-folder set.

**Architecture:** Keep Bilibili deletion limited to remote bilimi placement APIs. Derive remote availability from the video's observed remote placement, show a user-facing unsynced state before any API call, and preserve the existing preview/confirmation/recycle semantics. Build one renderer-side destination option list from the same navigation items used by the left workspace group, mapping only operation-supported folder ids.

**Tech Stack:** React, TypeScript, Vitest, Electron IPC bridge.

---

### Task 0: Correct recommendation hover metrics

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.test.tsx`

- [x] Keep the existing hover container and interaction, but remove the duplicated fourth line from current-batch recommendations.
- [x] Render Chinese source labels for UP-based and high-frequency-tag recommendations.
- [x] Show `本轮总共匹配：X 条` in the whole-round view; show `当前批次匹配：X 条` only in a batch view, and omit the batch line from whole-round overview.
- [x] Preserve the existing recommendation title, source, and count hierarchy without introducing a larger card or a new visual treatment.

### Task 1: Make remote deletion semantics explicit

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] Add a helper that distinguishes a local bilimi placement from an observed remote bilimi placement using `position.remoteObservedLogicalFolderIds` and `position.remoteObservedPhysicalFolderIds`.
- [x] Rename detail and batch labels to `从 B 站 bilimi 收藏夹删除` while preserving the existing two-step preview/confirmation flow.
- [x] Keep the existing compact danger-action border and placement; update button, aria label, confirmation title, and busy text consistently without enlarging the action row.
- [x] Do not redesign or restructure the Favorite Library UI in this round; preserve existing dimensions, colors, borders, menu structure, and dialog layout.
- [x] Keep the detail-page remote-delete button in the existing `其他操作` section and keep the local `从收藏库删除` button unchanged.
- [x] Keep the remote-delete button clickable while unsynced so its existing nearby note can show `收藏未同步`; only busy/confirmation states may disable it.
- [x] Apply the same label and compact danger styling to the toolbar's batch danger action, while leaving the batch local-delete action unchanged.
- [x] Preserve the existing deletion-dialog layout while increasing only the line-height/paragraph spacing for wrapped text such as `同时从 B 站删除收藏夹及其中分类视频`, consistently across all deletion entry points.
- [x] Keep ordinary B 站 sources untouched; retain `preservedOrdinarySources` and `recycleAids` warnings from the remote preview response.
- [x] When no remote bilimi placement is observed, keep the action clickable and show an inline, readable `收藏未同步` status near the action without invoking the preview API.
- [x] Add tests for synced deletion, unsynced detail feedback, ordinary-source preservation, and recycle warning behavior.

### Task 2: Make mixed batch remote deletion safe

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] Partition selected aids into remotely observed and unsynced groups before opening the batch preview.
- [x] Skip unsynced aids from the remote API request and show the count in a status message using `收藏未同步` wording.
- [x] If no selected aid is remotely observed, do not call the remote preview API.
- [x] Use the new action label in toolbar menus, aria labels, and confirmations.
- [x] Keep batch feedback in the existing toolbar status area and ensure the unsynced count is visible without disrupting the destination controls.

### Task 3: Align copy/move destinations with the left bilimi workspace

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] Derive destination options from the same workspace navigation items used by the left `bilimi 工作夹` group, including local draft entries and the protected staging entry when it is visible.
- [x] Preserve the navigation's duplicate suppression and stable ordering.
- [x] Map destination ids to operation-supported bilimi ids without exposing internal ids in labels.
- [x] Verify singleton and batch copy/move menus include every left-side workspace destination and retain existing virtualization behavior.
- [x] Verify destination menu typography, spacing, checkbox hit targets, and confirmation buttons remain consistent with the current Favorite Library UI.

### Task 4: Verify and commit

**Files:**
- Verify: all files above

- [x] Run focused FavoriteLibrary tests.
- [x] Verify the existing `转写操作` dropdown keeps its behavior and matches adjacent batch buttons for font family, size, weight, line height, border, and spacing.
- [x] Run `npm test` and `npm run build`.
- [x] Run `git diff --check`, inspect `git diff --stat`, and confirm no unrelated files changed.
- [ ] Commit all in-scope changes on `main` with one local commit.

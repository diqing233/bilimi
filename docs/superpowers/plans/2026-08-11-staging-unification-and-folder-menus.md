# Staging Unification and Folder Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar show one safe staging folder without losing either local or bound inbox memberships, and make every bilimi workspace folder manageable.

**Architecture:** Keep `local:inbox` as the durable unmatched safety membership and retain the optional `bilimi-logical:inbox` binding for Bilibili. The repository projection exposes the logical inbox as the single sidebar scope when it exists; reads union the two memberships, counts use the union, and deletion clears both rather than moving data back into staging. When the durable inbox is the only staging source, its menu uses the same local confirmation flow to clear members while retaining the empty safety container. The renderer grants menu access to all workspace folder states.

**Tech Stack:** Electron, React, TypeScript, Vitest, existing repository command/audit services.

---

### Task 1: Lock repository staging projection with tests

**Files:**
- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`

- [x] **Step 1: Write a failing service test** that creates one local inbox video and one bound logical-inbox video, then expects one projected `bilimi-logical:inbox` folder, a union count of two, and both aids from its page.
- [x] **Step 2: Run** `npm test -- electron/main/favoriteRepositoryService.test.ts` and confirm the existing two-folder projection fails the new assertion.
- [x] **Step 3: Implement the projection** by hiding `local:inbox` only while `bilimi-logical:inbox` exists, counting their deduplicated union for the logical inbox, and returning that union whenever the logical inbox scope is read or resolved.
- [x] **Step 4: Re-run the service test** and confirm all cases pass.

### Task 2: Permit safe deletion of the unified inbox

**Files:**
- Modify: `src/shared/favoriteRepository.test.ts`
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `electron/main/favoriteRepositoryManagedFolderService.test.ts`

- [x] **Step 1: Write failing reducer and service tests** proving that deleting `bilimi-logical:inbox` removes the logical binding and clears `local:inbox` instead of falling back into it.
- [x] **Step 2: Run** `npm test -- src/shared/favoriteRepository.test.ts electron/main/favoriteRepositoryManagedFolderService.test.ts` and confirm they fail because the prior reducer retains staging members.
- [x] **Step 3: Implement the inbox-specific reducer branch** so the durable safety folder remains available but empty after local or remote logical-inbox deletion; all ordinary logical folders retain their existing fallback semantics.
- [x] **Step 4: Re-run the focused tests** and confirm no non-inbox managed deletion behavior changed.

### Task 3: Expose menus and preserve confirmation layout

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigationGroupView.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: Write failing renderer tests** for three-dot menus on bound, local-draft, and staging workspace entries, plus a DOM/layout assertion that each delete range label is a block row and long copy aligns below its text column.
- [x] **Step 2: Run** `npm test -- src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx` and confirm the protected/draft menu assertions fail.
- [x] **Step 3: Implement the smallest navigation eligibility change** so all workspace entries render the existing shared menu; preserve edit routing and make deletion use the existing confirmation and repository tokens.
- [x] **Step 4: Implement the two-column delete-range row** with a fixed radio column and block option text, so each scope is separate and wraps from the text start.
- [x] **Step 5: Re-run renderer tests** and inspect the delete dialog at a narrow sidebar width.

### Task 4: Restore the whole-run classification label

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`

- [x] **Step 1: Write a failing assertion** that the inbox title renders exactly as `bilimi·暂存（未分类）` in one title row.
- [x] **Step 2: Run** `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx` and confirm it fails against the unparenthesized subtitle.
- [x] **Step 3: Render the parenthesized small subtitle** while retaining the same title container and tooltip.
- [x] **Step 4: Re-run the focused test** and then all affected renderer/service tests.

### Task 5: Verify and commit

**Files:**
- Verify only: all files above

- [x] **Step 1: Run focused Vitest suites, `npm test`, and `npx tsc --noEmit`.**
- [x] **Step 2: Run `git diff --check`, inspect `git diff --stat`, and verify only planned source, test, stylesheet, and plan files changed.**
- [ ] **Step 3: Commit once on `main`** with the four confirmed user requirements and no remote data operation.

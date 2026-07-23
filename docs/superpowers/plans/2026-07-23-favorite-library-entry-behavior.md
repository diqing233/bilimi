# Favorite Library Entry Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give main-window and floating-XiaoMi favorite-library entries distinct, predictable toggle and reveal behavior.

**Architecture:** Route a typed `toggle` or `reveal` command from the main process, restore the main window for external reveal requests, and keep drawer visibility state authoritative in the main renderer. Reuse the existing main-window restore helper and mounted drawer content.

**Tech Stack:** Electron IPC, React 19, TypeScript, Vitest, Testing Library

---

### Task 1: Define and test drawer commands

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryDrawer.test.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryDrawer.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] Add failing tests for toggle from closed, toggle from collapsed, toggle from expanded, and reveal from every state.
- [ ] Run the focused renderer tests and confirm the missing command behavior fails.
- [ ] Lift collapsed state to `App` and pass controlled state to `FavoriteLibraryDrawer`.
- [ ] Handle typed incoming commands with idempotent reveal semantics.
- [ ] Re-run focused renderer tests.

### Task 2: Restore and focus bilimi for floating reveal

**Files:**
- Create: `electron/main/favoriteLibraryEntryFlow.test.ts`
- Create: `electron/main/favoriteLibraryEntryFlow.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] Add failing tests proving main-renderer requests toggle while floating requests restore and reveal.
- [ ] Add a failing test proving a reveal waits until a newly created renderer is ready.
- [ ] Run the focused main-process tests and confirm expected failures.
- [ ] Implement the small routing helper using the existing main-window restore behavior.
- [ ] Send the typed command through preload and update renderer typings.
- [ ] Re-run focused main-process tests.

### Task 3: Verify and deliver

**Files:**
- Review all files changed by Tasks 1-2.

- [ ] Run all focused favorite-library, App, preload, and restore tests.
- [ ] Run `npm run build`.
- [ ] Inspect `git diff` and exclude unrelated untracked documentation.
- [ ] Commit the complete requirement once with `fix: unify favorite library entry behavior`.
- [ ] Restart the development project and verify the drawer opens, expands, closes, and wakes bilimi as designed.

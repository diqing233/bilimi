# Favorite Library Balanced Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved balanced visual hierarchy to the favorite-library workspace without changing behavior or content.

**Architecture:** Keep the center list as the primary elevated surface, style navigation as a quiet translucent surface without elevation, and style details as a lower-elevation secondary surface. Express hierarchy entirely in existing CSS selectors and protect it with style-contract tests.

**Tech Stack:** React 19, CSS, Vitest

---

### Task 1: Lock the visual hierarchy in tests

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx`

- [x] Add assertions for the translucent navigation surface, selected navigation row, secondary detail elevation, semantic status tones, and narrow-layout behavior.
- [x] Run the named test and verify it fails because the approved styles are absent.

### Task 2: Apply the balanced surface styles

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`

- [x] Give navigation a translucent white surface, subtle border, radius, and no shadow.
- [x] Preserve the existing center primary card and use white/hover/selected row tiers.
- [x] Replace the detail double outline with a softer border and lower shadow.
- [x] Add restrained semantic status backgrounds while keeping visible text.
- [x] Preserve the existing narrow layout that moves detail below the list.
- [x] Run the named contract test and verify it passes.

### Task 3: Verify in the real development app

**Files:**
- Verify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Verify: `src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx`

- [x] Run the focused visual contract test.
- [x] Run `git diff --check` for the touched files.
- [x] Restart `npm run dev` without clearing `%APPDATA%\bilimi-dev`.
- [x] Open the favorite library and capture a screenshot at the current 125% display scale.
- [x] Compare the screenshot with the approved B hierarchy and report any unrelated existing test drift separately.

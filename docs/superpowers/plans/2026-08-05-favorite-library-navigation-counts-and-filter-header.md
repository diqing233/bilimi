# Favorite Library Navigation Counts And Filter Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep navigation counts visible beside long folder names and center the status/source filters while retaining their current filter semantics.

**Architecture:** Preserve the existing navigation item markup and query state. Reserve a fixed trailing count slot so label truncation cannot consume it. Keep the three state dimensions inside their existing single state-filter menu; group the visible status and source triggers in the centered table-header filter region.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library.

---

### Task 1: Lock the layout contract

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [ ] Add static CSS assertions for a fixed, non-shrinking navigation count slot and an elastic label button.
- [ ] Add a renderer assertion that the status and source filter triggers are grouped in the centered header region, while the one status trigger retains all three state dimensions.
- [ ] Run the two test files and observe the new assertions fail before production edits.

### Task 2: Apply the focused layout change

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [ ] Reserve a 44px trailing count slot and allow only the folder label to ellipsize.
- [ ] Add a centered header filter group containing status and source triggers; keep the existing state menu and source filter request callbacks unchanged.
- [ ] Run focused tests, `git diff --check`, and inspect the Electron development window without performing remote writes.

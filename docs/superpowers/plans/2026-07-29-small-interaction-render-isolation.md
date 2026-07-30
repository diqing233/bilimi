# Small Interaction Render Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make small controls respond immediately without rerendering unrelated collection-library, settings, notes, archive, or pet surfaces.

**Architecture:** Move transient interaction state to the smallest owning component, keep persistence asynchronous, and expose stable callbacks/data to memoized heavy children. Preserve existing layout and business behavior; this is a render-boundary refactor, not a visual redesign.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Electron IPC.

---

### Task 1: Establish render-isolation contracts

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`
- Modify: `src/renderer/src/features/favorites/VirtualFavoriteLibraryList.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

- [ ] Add render probes that fail when a navigation disclosure, scroll event, or local settings disclosure renders an unrelated heavy child.
- [ ] Run the focused tests and confirm failures identify the current parent-state coupling.
- [ ] Keep behavior assertions for persisted final state, selection, and current folder unchanged.

### Task 2: Isolate collection navigation and scrolling

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.tsx`
- Modify: `src/renderer/src/features/favorites/VirtualFavoriteLibraryList.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts`

- [ ] Let navigation own an optimistic collapsed-group snapshot, synchronizing only on account changes and persisting the final value through a stable callback.
- [ ] Memoize navigation inputs from stable summary/folder dependencies and precompute group aggregate counts outside render loops.
- [ ] Keep live scroll position inside the virtual list; publish it after scrolling settles and on unmount instead of on every scroll event.
- [ ] Verify collapse does not reload data, clear selection, change scope, or render the list/detail subtree.

### Task 3: Isolate collection search, selection, and detail disclosures

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryDetail.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [ ] Give the search input an immediate local draft and debounce only query application.
- [ ] Provide stable selection callbacks and memoized rows so one checkbox updates the affected row and batch toolbar, not navigation/detail.
- [ ] Move status explanation, archive disclosure, conflict disclosure, event disclosure, and danger disclosure to the detail subtree that owns their markup.
- [ ] Verify query semantics, selected counts, and all existing destructive confirmations remain unchanged.

### Task 4: Isolate settings cards

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Create: `src/renderer/src/features/assistant/SettingsPreferenceField.tsx`
- Create: `src/renderer/src/features/assistant/SettingsPreferenceField.test.tsx`

- [ ] Add a field boundary with local draft state, immediate visual feedback, and a stable field-level commit callback.
- [ ] Migrate ordinary toggles, radio choices, selects, and text fields without changing slow operations such as diagnostics, GPU probing, or connection tests.
- [ ] Keep busy/error state local to the card that initiated an asynchronous operation.
- [ ] Verify a field interaction does not render unrelated settings cards or mounted workspaces and final persistence still coalesces correctly.

### Task 5: Isolate notes, archive, and pet high-frequency interactions

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
- Modify: their focused test files.

- [ ] Extract archive menus/remark editor and transcription queue disclosure into memoized local components.
- [ ] Keep pet chat draft local to the chat composer so typing does not render the animated pet shell.
- [ ] Verify menus, queue selection, remark saving, pet hit testing, and animations retain existing behavior.

### Task 6: Verification

**Files:**
- Modify only if a failing test exposes a regression in the files above.

- [ ] Run focused renderer tests for favorites, assistant settings, notes, archive, and pet.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and compare TypeScript output with the existing baseline without claiming pre-existing errors are new.
- [ ] Restart the normal development instance without clearing `%APPDATA%\bilimi-dev`; verify arrows, settings fields, scrolling, search, selection, archive menus, queue disclosure, and pet chat visually.

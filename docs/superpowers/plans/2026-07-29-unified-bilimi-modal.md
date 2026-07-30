# Unified Bilimi Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace visually inconsistent and browser-native confirmations with one themed, accessible modal foundation across the assistant, favorite library, and transcript export flows.

**Architecture:** Add a shared `BilimiModal` portal shell that owns the scrim, focus trap, focus restoration, scroll lock, Escape handling, semantic dialog role, responsive action layout, and theme variants. Keep feature-specific content and async state in existing feature components, while adapting their current shells to the shared component so behavior changes stay small and testable.

**Tech Stack:** React, TypeScript, React portals, Testing Library, Vitest, CSS.

---

### Task 1: Shared modal foundation

**Files:**
- Create: `src/renderer/src/components/BilimiModal.tsx`
- Create: `src/renderer/src/components/BilimiModal.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] Write a failing component test proving the modal portals to `document.body`, uses `dialog`/`alertdialog`, focuses cancel, traps Tab, closes with Escape or scrim when allowed, locks scrolling, and restores focus.
- [ ] Run `npm test -- src/renderer/src/components/BilimiModal.test.tsx` and confirm it fails because `BilimiModal` does not exist.
- [ ] Implement the minimal shared component with `title`, `tone`, `children`, `actions`, `onClose`, and `busy` props.
- [ ] Write failing style assertions for porcelain gradient surface, title/body divider, semantic danger treatment, themed secondary/primary/danger buttons, hover/focus/active/disabled states, and narrow-window action wrapping.
- [ ] Run `npm test -- src/renderer/src/styles.test.ts` and confirm the new assertions fail.
- [ ] Add the shared `.bilimi-modal__*` styles using existing porcelain variables.
- [ ] Run both tests and confirm they pass.

### Task 2: Assistant modal migration

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteModal.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteModal.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/styles.css`

- [ ] Extend the existing `OldFavoriteModal` test to require the shared `bilimi-modal` shell and explicit primary/danger action tones.
- [ ] Run the test and confirm it fails against the legacy shell.
- [ ] Refactor `OldFavoriteModal` into a compatibility adapter over `BilimiModal`, preserving all callers and focus behavior.
- [ ] Add failing tests that click “重置 DeepSeek” and “重置全部设置”, expect themed alert dialogs, and prove `window.confirm` is not called.
- [ ] Run the focused app tests and confirm the dialogs are missing.
- [ ] Replace both browser confirmations with controlled modal state and invoke the existing reset functions only after confirmation.
- [ ] Run the assistant modal and settings tests and confirm they pass.

### Task 3: Favorite-library confirmation migration

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryDialogs.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`

- [ ] Add failing assertions that favorite-library dialogs use the shared shell, focus the safe action, trap focus, and preserve their local/remote danger choices.
- [ ] Run the focused favorite-library dialog tests and confirm failure on the old shell.
- [ ] Adapt `FavoriteLibraryConfirmationDialog` and managed-folder dialogs to `BilimiModal`, leaving preview and two-step remote confirmation logic in place.
- [ ] Remove obsolete dialog shell CSS while retaining feature-specific preview, conflict-list, and nested confirmation styles.
- [ ] Run the favorite-library tests and confirm they pass.

### Task 4: Export dialog visual alignment

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNoteBatchExportDialog.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteBatchExportDialog.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] Add failing tests requiring the export dialog to use the shared modal surface while preserving export progress, cancellation, content selection, and folder-opening behavior.
- [ ] Run the export tests and confirm the shared shell assertion fails.
- [ ] Wrap export content with `BilimiModal` and map Start/Cancel/Close actions to the shared action area without changing business logic.
- [ ] Retain export-specific section, picker, results, and progress styles; delete duplicate overlay/surface/action shell declarations.
- [ ] Run export and style tests and confirm they pass.

### Task 5: Verification

**Files:**
- Verify all files touched above.

- [ ] Run `npm test -- src/renderer/src/components/BilimiModal.test.tsx src/renderer/src/features/assistant/OldFavoriteModal.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx src/renderer/src/features/notes/VideoNoteBatchExportDialog.test.tsx src/renderer/src/styles.test.ts`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` for the touched files.
- [ ] Search `src/renderer/src` for `window.confirm`, `window.alert`, and `window.prompt`; confirm no application-owned confirmation remains.

# Whole-App Responsive Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current UI and behavior while separating immediate interaction feedback from expensive rendering, persistence, IPC, queries, and background tasks across bilimi.

**Architecture:** Implement three paths: component-local interaction state, narrow incremental data updates, and coalesced background task progress. Complete snapshots remain bootstrap/recovery boundaries. Each stage begins with a failing behavioral or render-isolation test and ends with focused verification before another surface is changed.

**Tech Stack:** React 19, TypeScript, Electron IPC, Vitest, Testing Library, Electron webview.

---

### Task 1: Lock settings interaction behavior

**Files:**
- Modify: `src/renderer/src/features/assistant/SettingsPreferenceField.test.tsx`
- Modify: `src/renderer/src/features/assistant/SettingsPreferenceField.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] Add a failing test proving a checkbox paints its local state before the owner commit begins.
- [ ] Add failing source/behavior contracts proving DeepSeek toggles use the isolated field component and field patches do not call full preference normalization.
- [ ] Implement post-paint field commits with cancellation-safe latest-value delivery.
- [ ] Replace DeepSeek feature toggles without changing markup, labels, titles, or enabled rules.
- [ ] Make ordinary DeepSeek field patches use the immediate patch path; retain normalization at load/save/recovery boundaries.
- [ ] Run `npx vitest run src/renderer/src/features/assistant/SettingsPreferenceField.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`.

### Task 2: Coalesce field patches without full snapshots

**Files:**
- Modify: `src/renderer/src/features/state/preferenceSaveScheduler.test.ts`
- Modify: `src/renderer/src/features/state/preferenceSaveScheduler.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/store.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] Add a failing scheduler test for rapid patches to different fields preserving all final values.
- [ ] Add a failing main-store test that a narrow patch validates only its fields and preserves large untouched branches.
- [ ] Schedule and persist patches rather than regenerated complete preference objects for ordinary controls.
- [ ] Keep full preference save/load APIs for migration, import, reset, and recovery.
- [ ] Prevent an acknowledged local patch from causing a redundant complete renderer preference replacement.
- [ ] Run focused state/store/assistant tests.

### Task 3: Isolate pet interaction and animation

**Files:**
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
- Modify: `src/renderer/src/features/assistant/LayeredPetRenderer.test.tsx`
- Modify: `src/renderer/src/features/assistant/LayeredPetRenderer.tsx`
- Modify: `electron/main/floatingSealMouseTransparency.test.ts`
- Modify: `electron/main/index.ts`

- [ ] Add render probes proving pet chat input and settings persistence do not render the animated pet renderer.
- [ ] Keep hover, click, drag, resize, and animation state inside the pet interaction island.
- [ ] Save drag/resize/style after the visible action and coalesce continuous changes.
- [ ] Verify hit testing recovers during create, wake, drag, and resize.
- [ ] Run focused pet tests and manually verify pointer movement while settings persist.

### Task 4: Isolate favorite-library navigation, list, and detail

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`
- Modify: `src/renderer/src/features/favorites/VirtualFavoriteLibraryList.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryDetail.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: corresponding production components.

- [ ] Add render probes for disclosure, search typing, selection, row progress, and detail expansion.
- [ ] Keep navigation disclosure, search draft, row selection, and detail disclosure in their owning subtrees.
- [ ] Reject stale folder/detail responses by account, scope, entity identity, and request generation.
- [ ] Keep cached content visible during refresh and display loading only in the affected content region.
- [ ] Verify virtual scrolling, cross-page selection, counts, sorting, and repository semantics remain unchanged.

### Task 5: Isolate video webview and timeline commands

**Files:**
- Modify: `src/renderer/src/features/browser/BiliWebview.test.tsx`
- Modify: `src/renderer/src/features/browser/BiliWebview.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts`
- Modify: `src/renderer/src/features/notes/videoNoteTimeAutomation.ts`

- [ ] Add failing tests for immediate tab activation, same-video reuse, and latest-seek-wins behavior.
- [ ] Keep the webview instance stable across unrelated sidebar updates.
- [ ] Separate tab-shell selection from webview load completion.
- [ ] Cancel or invalidate older part-selection/seek commands when a newer timestamp is clicked.
- [ ] Verify play/pause preservation, multi-part identity, and existing external-open fallback.

### Task 6: Coalesce transcription and DeepSeek task progress

**Files:**
- Modify: `electron/main/videoTranscriptionQueue.test.ts`
- Modify: `electron/main/videoTranscriptionQueue.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [ ] Add tests that enqueue/cancel/retry state is immediately observable before worker completion.
- [ ] Add tests that progress bursts publish at a bounded rate while terminal states publish immediately.
- [ ] Patch only the affected task and favorite row in renderer state.
- [ ] Preserve transcript checkpoints, summary-only retry, cancellation, account isolation, and model/device reporting.
- [ ] Verify audio download, transcription, DeepSeek, and archive registration failures remain distinguishable.

### Task 7: Isolate review, notes, archive, and export

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteBatchExportDialog.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteBatchExportDialog.tsx`
- Modify: review surface tests and production component owning the current review card.

- [ ] Add tests for immediate review feedback and preloaded next-item presentation.
- [ ] Keep note drafts local and persist after idle without rerendering archive/list surfaces.
- [ ] Open archive/export shells immediately and load/generate content in the affected region.
- [ ] Preserve partial export results, cancellation, formats, notes inclusion, and conflict-safe filenames.

### Task 8: Startup and whole-app acceptance

**Files:**
- Modify only files exposed by failing startup and integration tests.
- Update: `docs/superpowers/plans/2026-07-29-whole-app-responsive-interaction.md`

- [ ] Add an integration scenario that rapidly changes multiple settings, switches tabs, opens the favorite library, selects rows, opens video detail, clicks timestamps, and interacts with the pet while background work is active.
- [ ] Verify the shell and cached state appear before independent restorations finish.
- [ ] Run all focused suites changed by Tasks 1-7.
- [ ] Run `npm test` and require exit 0.
- [ ] Run `npm run build` and require exit 0.
- [ ] Run TypeScript diagnostics and compare with the recorded existing baseline; fix every newly introduced error.
- [ ] Run `git diff --check` and require exit 0 apart from existing line-ending warnings.
- [ ] Restart the normal development app without clearing `%APPDATA%\bilimi-dev`.
- [ ] Verify at 100%, 125%, 150%, narrow width, and reduced motion without changing the UI.
- [ ] Confirm no background writer remains before reporting completion.

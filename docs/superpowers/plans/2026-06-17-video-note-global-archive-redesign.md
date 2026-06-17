# Video Note Global Archive Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the video note panel around the confirmed flat layout, add copyable plain transcripts and summaries, and persist all video transcription histories in a searchable global archive.

**Implementation status:** Implemented and verified on 2026-06-17. The archive model, Electron persistence, redesigned note panel, global archive panel, app integration, and empty-note flat layout are present in `main`. Relevant commits: `d0e66e4` (archive persistence), `81e3e9f` (archive views), `5b8de6e` (workspace integration), and `9deb604` (empty note layout alignment). Full verification after the final alignment: `npm test` passed 60 files / 315 tests, and `npm run build` passed.

**Architecture:** Shared archive helpers own versioning, search, and text extraction. Electron store exposes archive load/save/delete through preload, while renderer state writes every generated note into the archive and renders a new global archive panel opened from the note page.

**Tech Stack:** TypeScript, React 19, Electron IPC/preload, electron-store, Vitest, Testing Library.

---

## File Structure

- `src/shared/types.ts`: add `VideoNoteArchiveEntry`, `VideoNoteArchiveVersion`, and search filter types.
- `src/shared/videoNoteArchive.ts`: create pure helpers for archive IDs, plain transcript text, summary text, normalization, upsert, deletion, and search.
- `src/shared/videoNoteArchive.test.ts`: cover archive helper behavior.
- `electron/main/store.ts`: add `videoNoteArchives` to store state and expose load/save/delete functions.
- `electron/main/store.test.ts`: cover archive persistence with store-like test doubles.
- `electron/main/index.ts`: register archive IPC handlers.
- `electron/preload/index.ts`: expose archive APIs to renderer.
- `src/renderer/src/global.d.ts`: type the new desktop APIs.
- `src/renderer/src/features/notes/VideoNotesPanel.tsx`: redesign note UI, add result panels, copy plain transcript and summary, add `onOpenArchive`.
- `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`: update and add component tests for ordering and copy behavior.
- `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`: create global archive UI.
- `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`: cover search, selection, version switching, copy, and delete confirmation.
- `src/renderer/src/features/assistant/MemorialPanel.tsx`: pass archive open callback into notes panel.
- `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`: load/archive state, save generated notes into archive, show archive panel.
- `src/renderer/src/styles.css`: style redesigned note page and archive panel.

## Tasks

### Task 1: Shared Archive Model

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/videoNoteArchive.ts`
- Test: `src/shared/videoNoteArchive.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that assert plain transcript extraction, summary text extraction, archive version append, BV/URL merging, search, and deletion behavior.

Run: `npx vitest run src/shared/videoNoteArchive.test.ts`
Expected: FAIL because `videoNoteArchive.ts` does not exist.

- [x] **Step 2: Implement shared archive helpers**

Add archive types to `src/shared/types.ts` and implement pure functions in `src/shared/videoNoteArchive.ts`.

- [x] **Step 3: Verify**

Run: `npx vitest run src/shared/videoNoteArchive.test.ts`
Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add src/shared/types.ts src/shared/videoNoteArchive.ts src/shared/videoNoteArchive.test.ts
git commit -m "feat: add video note archive model"
```

### Task 2: Electron Store And IPC

**Files:**
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [x] **Step 1: Write failing store tests**

Add tests for loading empty archives, saving a note archive version, loading normalized archives, and deleting archive entries or versions.

Run: `npx vitest run electron/main/store.test.ts`
Expected: FAIL because archive store functions do not exist.

- [x] **Step 2: Implement store helpers**

Add `videoNoteArchives` to defaults and implement `loadVideoNoteArchives`, `saveVideoNoteArchiveVersion`, `deleteVideoNoteArchiveEntry`, and `deleteVideoNoteArchiveVersion`.

- [x] **Step 3: Wire IPC and preload**

Expose `video-note-archives:load`, `video-note-archives:save-version`, `video-note-archives:delete-entry`, and `video-note-archives:delete-version`.

- [x] **Step 4: Verify**

Run: `npx vitest run electron/main/store.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

Run:

```bash
git add electron/main/store.ts electron/main/store.test.ts electron/main/index.ts electron/preload/index.ts src/renderer/src/global.d.ts
git commit -m "feat: persist video note archives"
```

### Task 3: Redesigned Note Panel

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

- [x] **Step 1: Write failing component tests**

Add tests for the top video details area, main button order `转写音频` then `档案库`, result entry order `无时间线文稿` then `带时间线文稿` then `一图流总结`, pure transcript copy, summary copy, and archive button callback.

Run: `npx vitest run src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
Expected: FAIL because the new labels and panel behavior are missing.

- [x] **Step 2: Implement panel behavior**

Replace the old tab-heavy display with the confirmed flat layout and result panels. Keep existing annotation, save, manual transcript, audio transcription, and error behavior.

- [x] **Step 3: Verify**

Run: `npx vitest run src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add src/renderer/src/features/notes/VideoNotesPanel.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx
git commit -m "feat: redesign video notes panel"
```

### Task 4: Global Archive Panel

**Files:**
- Create: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- Create: `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`

- [x] **Step 1: Write failing component tests**

Add tests for rendering search, filters, video list, selected detail, version switching, transcript copy, summary copy, open source callback, and delete confirmation.

Run: `npx vitest run src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
Expected: FAIL because the component does not exist.

- [x] **Step 2: Implement archive panel**

Build the dual-pane archive panel using shared search helpers. Keep delete confirmation in-component with clear text and callbacks.

- [x] **Step 3: Verify**

Run: `npx vitest run src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add src/renderer/src/features/notes/VideoNoteArchivePanel.tsx src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx
git commit -m "feat: add video note archive panel"
```

### Task 5: App Integration And Styling

**Files:**
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Write failing integration tests**

Add tests that generated audio notes are saved to archive, archive button opens the archive panel, and the archive panel can return to notes.

Run: `npx vitest run src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
Expected: FAIL because archive integration is missing.

- [x] **Step 2: Integrate archive state**

Load archives from desktop API, save generated audio notes into archive, open the archive panel from `VideoNotesPanel`, and keep existing `掌库` tab behavior unchanged.

- [x] **Step 3: Style UI**

Add CSS for flat note layout, progress bar, result panels, and dual-pane archive. Keep the existing restrained parchment palette.

- [x] **Step 4: Verify focused tests**

Run:

```bash
npx vitest run src/shared/videoNoteArchive.test.ts electron/main/store.test.ts src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: PASS.

- [x] **Step 5: Commit**

Run:

```bash
git add src/renderer/src/features/assistant/MemorialPanel.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/styles.css
git commit -m "feat: integrate video note archives"
```

### Task 6: Final Verification

**Files:**
- All changed files.

- [x] **Step 1: Run full tests**

Run: `npm test`
Expected: PASS.

- [x] **Step 2: Run build**

Run: `npm run build`
Expected: PASS.

- [x] **Step 3: Commit any fixes**

If verification required fixes, commit them with a focused message.

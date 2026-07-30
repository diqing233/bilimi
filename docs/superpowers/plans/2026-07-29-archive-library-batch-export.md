# Archive Library Batch Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive batch-selection mode to the global video archive library and export every selected archive's latest version through the existing export dialog.

**Architecture:** Keep transient selection state inside `VideoNoteArchivePanel`. Derive export identities from the complete archive collection rather than the filtered list, then pass those identities to the existing `VideoNoteBatchExportDialog` with complete-archive scope as the default. Reuse the current main-process batch writer unchanged and add wrapping layout rules to the archive panel styles.

**Tech Stack:** React 19, TypeScript, Testing Library, Vitest, CSS.

---

### Task 1: Lock down archive batch-selection behavior

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`

- [ ] Write failing tests for entering batch mode, default zero selection, row checkboxes, clearing, canceling, and opening detail without losing selection.
- [ ] Run `npm test -- src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`; expect failure because the batch UI is missing.
- [ ] Add `batchMode` and `selectedArchiveIds` state, header entry, wrapping toolbar, and independent row checkboxes while preserving the existing detail action.
- [ ] Re-run the focused test file; expect all archive panel tests to pass.

The tests should exercise this public behavior:

```tsx
fireEvent.click(screen.getByRole('button', { name: '批量导出' }))
expect(screen.getAllByRole('checkbox', { name: /选择档案/ })).toHaveLength(archives.length)
expect(screen.getByText('已选 0 项')).toBeInTheDocument()
expect(screen.getByRole('button', { name: '导出所选档案' })).toBeDisabled()
```

### Task 2: Select the whole library and export latest versions

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`

- [ ] Write failing tests proving “全选全部档案” ignores search/star/memo filters and reports selected items hidden by the current filter.
- [ ] Write a failing test that switches detail to an old version, opens batch export, and expects every selection to use `archive.versions.at(-1)` with initial scope `complete`.
- [ ] Run the archive panel tests; expect failures for whole-library selection and latest-version identities.
- [ ] Derive hidden counts from selected IDs versus filtered IDs. Construct selections from the unfiltered archive collection in archive order, skipping archives without versions, and derive `hasNotes` from the selected latest versions.
- [ ] Re-run the archive panel tests; expect all tests to pass, including existing single-item export behavior.

Expected export request shape:

```tsx
expect(previewVideoNoteArchiveBatch).toHaveBeenLastCalledWith(expect.objectContaining({
  selections: archives.map((archive) => ({
    archiveId: archive.id,
    versionId: archive.versions.at(-1)!.id
  })),
  scope: 'complete'
}))
```

### Task 3: Make the batch toolbar safe in a narrow sidebar

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.layout.test.ts`

- [ ] Write a failing CSS contract test for `flex-wrap: wrap`, shrink-safe status text, and wrapping batch actions.
- [ ] Run `npm test -- src/renderer/src/features/notes/VideoNoteArchivePanel.layout.test.ts`; expect failure because the selectors do not exist.
- [ ] Add full-width, `box-sizing: border-box`, `min-width: 0`, wrapping, gaps, and `overflow-wrap: anywhere`; do not add horizontal scrolling.
- [ ] Re-run the layout test; expect it to pass.

Required CSS contract:

```ts
expect(styles).toMatch(/\.video-note-archive__batch-toolbar \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/)
expect(styles).toMatch(/\.video-note-archive__batch-status \{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/)
expect(styles).toMatch(/\.video-note-archive__batch-actions \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/)
```

### Task 4: Regression verification

**Files:**
- Verify: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- Verify: `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- Verify: `src/renderer/src/features/notes/VideoNoteArchivePanel.layout.test.ts`
- Verify: `src/renderer/src/features/notes/VideoNoteBatchExportDialog.test.tsx`
- Verify: `src/renderer/src/styles.css`

- [ ] Run the related tests:

```powershell
npm test -- src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx src/renderer/src/features/notes/VideoNoteArchivePanel.layout.test.ts src/renderer/src/features/notes/VideoNoteBatchExportDialog.test.tsx
```

- [ ] Run type and whitespace checks:

```powershell
npx tsc --noEmit
git diff --check -- src/renderer/src/features/notes/VideoNoteArchivePanel.tsx src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx src/renderer/src/features/notes/VideoNoteArchivePanel.layout.test.ts src/renderer/src/styles.css
```

- [ ] Review the scoped diff and confirm it contains only archive-library batch selection, latest-version export wiring, tests, and responsive styles.

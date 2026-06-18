# Review Notes Conservative Compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `批阅` and `札记` assistant pages visually smaller without changing their structure.

**Architecture:** Keep React components untouched and implement the change in `src/renderer/src/styles.css`. Add focused stylesheet regression assertions in `src/renderer/src/styles.test.ts` so the compact density remains intentional. The final implementation also prevents grid row stretching with `align-content: start` on the assistant paper and notes grid.

**Tech Stack:** Electron, React, TypeScript, Vitest, CSS.

**Status:** Implemented and verified on 2026-06-19. Primary implementation commit: `6a8801a`. Grid stretch correction commit: `492db67`.

---

### Task 1: Add Compact Density Style Test

**Files:**
- Modify: `src/renderer/src/styles.test.ts`

- [x] **Step 1: Write the failing test**

Append two style assertions inside the existing `describe('renderer porcelain theme styles', ...)` block:

```ts
  it('uses compact spacing for the review panel', () => {
    expect(normalizedStyles).toContain('.memorial-panel__paper {\n  border: 1px solid rgba(31, 99, 181, 0.3);')
    expect(normalizedStyles).toContain('padding: 8px;\n  max-height: calc(100vh - 16px);')
    expect(normalizedStyles).toContain('display: grid;\n  gap: 6px;')
    expect(normalizedStyles).toContain('.memorial-panel__action {\n  min-height: 52px;')
    expect(normalizedStyles).toContain('grid-template-columns: 28px minmax(0, 1fr);')
    expect(normalizedStyles).toContain('.memorial-panel__action strong {\n  grid-area: mark;\n  width: 24px;\n  height: 24px;')
  })

  it('uses compact spacing for the notes panel', () => {
    expect(normalizedStyles).toContain('.video-notes {\n  color: var(--porcelain-text);\n  display: grid;\n  gap: 6px;')
    expect(normalizedStyles).toContain('.video-notes__source {\n  display: grid;\n  gap: 4px;')
    expect(normalizedStyles).toContain('.video-notes__source h3 {\n  margin: 0;\n  color: var(--porcelain-text);\n  font-size: 14px;')
    expect(normalizedStyles).toContain('.video-notes__primary-actions button {\n  min-width: 76px;\n  min-height: 32px;')
    expect(normalizedStyles).toContain('.video-notes__result-tabs {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 4px;')
    expect(normalizedStyles).toContain('.video-notes__result-tabs button {\n  display: grid;\n  gap: 2px;\n  min-height: 44px;')
    expect(normalizedStyles).toContain('.video-notes__plain-text {\n  max-height: 160px;')
    expect(normalizedStyles).toContain('.video-notes textarea {\n  min-height: 60px;')
    expect(normalizedStyles).toContain('.video-notes__memo textarea[readonly] {\n  min-height: 130px;')
  })
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: FAIL because current styles still use the larger spacing and heights.

### Task 2: Compact Review And Notes CSS

**Files:**
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Implement compact review panel CSS**

Change only the existing rules for:
- `.memorial-panel__paper`
- `.memorial-panel__body`
- `.memorial-panel__meta`
- `.memorial-panel__actions`
- `.memorial-panel__action`
- `.memorial-panel__action strong`
- `.memorial-panel__action small`

Use the values asserted in Task 1 and keep the existing layout structure.

- [x] **Step 2: Implement compact notes panel CSS**

Change only the existing rules for:
- `.video-notes`
- `.video-notes__source`
- `.video-notes__source h3`
- `.video-notes__primary-actions`
- `.video-notes__primary-actions button`
- `.video-notes__result-tabs`
- `.video-notes__result-tabs button`
- `.video-notes__result-tabs small`
- `.video-notes__plain-text`
- `.video-notes textarea`
- `.video-notes form`
- `.video-notes #video-notes-annotations > ol`
- `.video-notes #video-notes-annotations > ol > li`
- `.video-notes__memo textarea[readonly]`

Use the values asserted in Task 1 and keep the existing DOM structure.

- [x] **Step 3: Run focused style test**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: PASS.

### Task 2.5: Prevent Full-Height Grid Row Stretching

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [x] **Step 1: Add regression coverage for no-stretch grid layout**

Add a style assertion that requires:

```ts
expect(normalizedStyles).toContain('display: grid;\n  align-content: start;\n  gap: 6px;')
expect(normalizedStyles).toContain(
  '.video-notes {\n  color: var(--porcelain-text);\n  display: grid;\n  align-content: start;\n  gap: 6px;'
)
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: FAIL because the compact CSS did not yet prevent grid rows from stretching in a full-height sidebar.

- [x] **Step 3: Add `align-content: start`**

Add `align-content: start` to `.memorial-panel__paper` and `.video-notes`.

- [x] **Step 4: Verify the correction**

Run:

```bash
npm test -- src/renderer/src/styles.test.ts src/renderer/src/features/assistant/MemorialPanel.test.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx
npm test
```

Expected: PASS. Full verification on 2026-06-19 passed 66 test files and 344 tests.

### Task 3: Run Related Regression Tests And Commit

**Files:**
- Verify: `src/renderer/src/features/assistant/MemorialPanel.test.tsx`
- Verify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Verify: `src/renderer/src/styles.test.ts`

- [x] **Step 1: Run related tests**

Run: `npm test -- src/renderer/src/styles.test.ts src/renderer/src/features/assistant/MemorialPanel.test.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

Expected: PASS.

- [x] **Step 2: Check diff scope**

Run: `git diff -- src/renderer/src/styles.css src/renderer/src/styles.test.ts docs/superpowers/plans/2026-06-19-review-notes-conservative-compact.md`

Expected: Only compact layout styles, focused style test assertions, and this plan changed.

- [x] **Step 3: Commit implementation**

Stage only this task's files:

```bash
git add -- src/renderer/src/styles.css src/renderer/src/styles.test.ts docs/superpowers/plans/2026-06-19-review-notes-conservative-compact.md
git commit -m "Compact review and notes layouts"
```

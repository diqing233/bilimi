# Blue-White Porcelain UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recolor Bilimi's global UI to the approved gentle blue-white porcelain theme.

**Architecture:** Keep the current React component structure untouched and implement the change in the renderer stylesheet. Add one focused regression test that reads the stylesheet and blocks reintroducing the old brown-gold palette in global UI surfaces.

**Tech Stack:** Electron, React, TypeScript, Vitest, CSS.

---

### Task 1: Add Style Regression Test

**Files:**
- Create: `src/renderer/src/styles.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url))
const styles = readFileSync(stylesPath, 'utf8')

describe('renderer porcelain theme styles', () => {
  it('removes the old brown-gold palette from global UI styles', () => {
    const retiredPalette = [
      '#1f140f',
      '#221914',
      '#fff1cf',
      '#8c4327',
      '#512416',
      '#a14d2a',
      '#642918',
      '#5f2c1a',
      '#743720',
      '#f4ead4',
      '#eadbc0',
      '#3f2a1a',
      '#6d4c2d',
      '#113, 81, 48'
    ]

    for (const token of retiredPalette) {
      expect(styles).not.toContain(token)
    }
  })

  it('uses the approved porcelain palette tokens', () => {
    const porcelainPalette = [
      '#071a33',
      '#1f63b5',
      '#174577',
      '#2d86c7',
      '#74c7df',
      '#dceeff',
      '#f7fbff',
      '#18375f',
      '#54749b'
    ]

    for (const token of porcelainPalette) {
      expect(styles).toContain(token)
    }
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: FAIL because the stylesheet still contains old brown-gold tokens and does not contain the full porcelain palette.

- [x] **Step 3: Commit nothing yet**

The failing test is part of the implementation batch and should not be committed until the code passes.

### Task 2: Recolor Global CSS

**Files:**
- Modify: `src/renderer/src/styles.css`

- [x] **Step 1: Replace old global color tokens with porcelain variables**

Add root variables near the top of `styles.css`:

```css
:root {
  --porcelain-edge: #071a33;
  --porcelain-primary: #1f63b5;
  --porcelain-deep: #174577;
  --porcelain-mid: #2d86c7;
  --porcelain-cyan: #74c7df;
  --porcelain-ice: #dceeff;
  --porcelain-surface: #f7fbff;
  --porcelain-white: #fffefd;
  --porcelain-text: #18375f;
  --porcelain-muted: #54749b;
  --porcelain-error: #9b3642;
  --porcelain-success: #2f7f6d;
}
```

- [x] **Step 2: Recolor app shell, tabs, and browser frame**

Change `.app-shell`, `.browser-tabs`, tab buttons, and `.browser-stack` from black/brown to deep blue and ice-blue surfaces.

- [x] **Step 3: Recolor assistant surfaces**

Change `.assistant-sidebar`, `.assistant-sidebar__rail`, `.floating-assistant-workspace`, `.floating-menu`, `.assistant-dialog`, prompts, and status pills to porcelain surfaces with blue borders and shadows.

- [x] **Step 4: Recolor content panels and shared controls**

Change `.memorial-panel`, `.favorite-ledger-panel`, `.video-notes`, `.video-note-archive`, shared buttons, tabs, inputs, selected states, progress color, and chips to the same porcelain palette.

- [x] **Step 5: Keep semantic states distinct**

Retain restrained red for errors and green-blue for success using `--porcelain-error` and `--porcelain-success`.

### Task 3: Verify And Commit

**Files:**
- Test: `src/renderer/src/styles.test.ts`
- Verify: `src/renderer/src/styles.css`

- [x] **Step 1: Run focused test**

Run: `npm test -- src/renderer/src/styles.test.ts`

Expected: PASS.

- [x] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [x] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS.

- [x] **Step 4: Review git diff**

Run: `git diff -- src/renderer/src/styles.css src/renderer/src/styles.test.ts docs/superpowers/plans/2026-06-18-blue-white-porcelain-ui.md`

Expected: Only the approved UI recolor, stylesheet regression test, and implementation plan are changed.

- [x] **Step 5: Commit the completed requirement**

```bash
git add docs/superpowers/plans/2026-06-18-blue-white-porcelain-ui.md src/renderer/src/styles.css src/renderer/src/styles.test.ts
git commit -m "style: apply blue white porcelain ui"
```

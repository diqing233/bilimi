# bilimi App Icon Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the detailed cropped illustration with a square, simplified Xiaomi mascot icon that remains recognizable across Windows icon sizes.

**Architecture:** Generate one square source asset from the approved references, then keep the existing Pillow-based pipeline as the single source of truth for PNG and ICO derivatives. Update the crop contract and its regression test so the full square source is used without legacy portrait cropping.

**Tech Stack:** OpenAI image generation, Node.js ESM, Pillow, Vitest, Electron Builder

---

### Task 1: Lock the square-source contract

**Files:**
- Modify: `scripts/generate-app-icon.test.mjs`
- Modify: `scripts/generate-app-icon.mjs`

- [ ] **Step 1: Update the crop regression test first**

Change the expected crop to a full 1024px square:

```js
expect(APP_ICON_CROP).toMatchObject({
  left: 0,
  top: 0,
  width: 1024,
  height: 1024
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run scripts/generate-app-icon.test.mjs`

Expected: the crop assertion fails because the implementation still uses the legacy `20, 50, 1120, 1120` crop.

- [ ] **Step 3: Update the generator crop**

Set `APP_ICON_CROP` in `scripts/generate-app-icon.mjs` to:

```js
export const APP_ICON_CROP = {
  left: 0,
  top: 0,
  width: 1024,
  height: 1024
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run scripts/generate-app-icon.test.mjs`

Expected: all tests in the file pass.

### Task 2: Generate and install the new source art

**Files:**
- Replace: `electron/assets/bilimi-icon-source.png`
- Regenerate: `electron/assets/bilimi-avatar.png`
- Regenerate: `electron/assets/bilimi.ico`
- Regenerate: `build/icon.png`
- Regenerate: `build/icon.ico`

- [ ] **Step 1: Generate a 1024px square draft from both user references**

Use the approved flat mascot specification: front-facing head-and-shoulders portrait, open red eyes, gentle closed-mouth smile, pale blue-white bob, twin loop buns, prominent ahoge, simplified white play hair ornament, deep navy rounded-square background, large flat shapes, one shadow layer, no text, no hand pose, no jewelry chains, no tassels, no floral clutter, no watermark.

- [ ] **Step 2: Inspect the draft at native size**

Verify identity, centered composition, safe padding, background contrast, and absence of unwanted details.

- [ ] **Step 3: Install the selected source non-destructively through the project path**

Replace `electron/assets/bilimi-icon-source.png` only after visual inspection confirms the approved direction.

- [ ] **Step 4: Regenerate all derived icon assets**

Run: `npm run generate:app-icon`

Expected: the script reports five written PNG/ICO outputs without errors.

### Task 3: Validate small-size rendering and project integrity

**Files:**
- Verify: `electron/assets/bilimi-avatar.png`
- Verify: `build/icon.png`
- Verify: `build/icon.ico`

- [ ] **Step 1: Produce a small-size contact sheet**

Render the generated icon at 16, 24, 32, 48, 64, 128 and 256 pixels on light and dark backgrounds using Pillow.

- [ ] **Step 2: Inspect the contact sheet**

Confirm that the pale hair silhouette, red eyes, ahoge and right-side play ornament remain distinguishable at 32px, and that 16px remains a clean mascot silhouette.

- [ ] **Step 3: Run focused tests**

Run: `npx vitest run scripts/generate-app-icon.test.mjs scripts/packaging-config.test.mjs electron/main/mainWindowOptions.test.ts`

Expected: all focused tests pass.

- [ ] **Step 4: Run full verification**

Run: `npm test`

Expected: zero failed tests.

Run: `npm run build`

Expected: Electron main, preload and renderer builds exit successfully.

- [ ] **Step 5: Review and commit once**

Run: `git diff --check` and inspect `git status --short` plus the final diff. Stage only this requirement's files and create one overall commit, following the repository instruction.

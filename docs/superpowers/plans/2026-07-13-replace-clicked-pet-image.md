# Replace Clicked Pet Image Implementation Plan

> **For agentic workers:** Execute inline in the current task. Do not resume unrelated interrupted work. Follow test-first resource validation and make one final commit for this requirement.

**Goal:** Replace every project `clicked.png` pet asset with the user-selected image while preserving transparency, canvas contracts, and stable visual anchoring.

**Architecture:** Treat the recovered generated PNG as the single source image. Remove its flat magenta background, then render the same transparent character into the existing big-head and classic canvas contracts so all current imports update without business-logic changes.

**Tech Stack:** PNG/RGBA, Python Pillow image processing, Vitest resource validation, Electron/Vite build.

---

### Task 1: Lock the asset contract with a failing test

**Files:**
- Modify: `src/renderer/src/features/assistant/petAssetFiles.test.ts`

- [x] Extend PNG validation to cover all three `clicked.png` destinations.
- [x] Assert canvas size, alpha transparency, centered content, stable bottom anchor, and matching rendered character pixels across variants.
- [x] Run the focused test and confirm it fails against the old assets.

### Task 2: Produce and install adapted transparent assets

**Files:**
- Modify: `src/renderer/src/assets/pet/blue-white-maid/character/big-head/clicked.png`
- Modify: `src/renderer/src/assets/pet/blue-white-maid/character/classic/clicked.png`
- Modify: `src/renderer/src/assets/pet/blue-white-maid/character/clicked.png`

- [x] Remove the source image's flat magenta background with a connected soft alpha matte and despill.
- [x] Render the character into the 434x461 big-head canvas with the existing 16 px bottom anchor.
- [x] Render the same character into both 512x512 compatibility canvases with the existing 23 px bottom anchor.
- [x] Run the focused resource test and confirm it passes.

### Task 3: Verify all consumers and commit only this requirement

**Files:**
- Verify: `src/renderer/src/features/assistant/petAssets.ts`
- Verify: direct imports of `big-head/clicked.png`

- [x] Run assistant-related tests, the complete test suite, and the production build.
- [x] Visually inspect the final transparent PNGs on a checkerboard and at 32px, 48px, 96px, and 160px.
- [x] Confirm the final diff excludes pre-existing app-icon and temporary-file changes.
- [ ] Stage only this plan, the resource test, and the three clicked assets.
- [ ] Create one Git commit for the completed requirement.

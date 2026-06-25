# Old Favorites Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the `整理旧藏` panel into a guided old-favorites visualization with DeepSeek-enhanced favorite-folder candidates and safer final execution.

**Architecture:** Keep all behavior inside `FavoriteLedgerPanel` and reuse `FavoriteLedgerPreview` plus existing DeepSeek enrichment from `App.tsx`. Add local UI state for old-favorites guide steps and refactor preview rendering into clear summary, candidate, row, and confirmation sections.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing Electron renderer code.

---

## File Structure

- Modify `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`: add failing tests for guided old-favorites flow.
- Modify `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`: add step state and render the new guide sections.
- Modify `src/renderer/src/styles.css`: style step navigation, summary metrics, candidate cards, preview rows, and confirmation block.
- Modify `src/renderer/src/styles.test.ts`: assert the new CSS hooks exist and prevent old preview-only layout from regressing.

## Tasks

- [x] Write failing tests for the old-favorites guide.
- [x] Run the focused panel test and verify the new tests fail.
- [x] Implement minimal component changes to pass the guide tests.
- [x] Add CSS and style assertions for the guide layout.
- [x] Run focused component and style tests.
- [x] Run broader affected tests for favorites, DeepSeek, App integration, and styles.
- [x] Run the full test suite or record any blocker.
- [ ] Commit the complete requirement change once.

## Verification Commands

```bash
npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/styles.test.ts
npm test -- src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/features/favorites/favoriteLedgerInsights.test.ts electron/main/deepseekService.test.ts src/renderer/src/App.test.tsx
npm test
```

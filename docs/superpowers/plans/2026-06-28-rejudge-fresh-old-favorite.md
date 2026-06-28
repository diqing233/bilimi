# Fresh Old Favorite Rejudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make old favorite "再次判断" refresh one video's latest Bilibili evidence and rerun classification without staging or writing favorites.

**Architecture:** Add a renderer callback from `FavoriteLedgerPanel` through `FloatingAssistantApp` to `App`. Reuse the old favorite scan API shape with a focused single-aid scan helper, then rebuild one preview item with the current ledgers and replace it in panel state.

**Tech Stack:** React 19, TypeScript, Electron preload IPC bridge, Vitest, Testing Library.

---

### Task 1: Add Fresh Rejudge Contract and Tests

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`

- [ ] **Step 1: Write failing component tests**

Add tests proving `再次判断` awaits a new callback, replaces the preview item, and leaves the new target unselected.

- [ ] **Step 2: Verify red**

Run:

```bash
npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts
```

Expected before implementation: the new callback prop and helper behavior are missing.

- [ ] **Step 3: Implement panel contract**

Add `onRejudgeOldFavorite?: (item: FavoriteLedgerPreviewItem) => Promise<FavoriteLedgerPreviewItem>` and update `rejudgeOldFavorite` to replace one item from the returned fresh item. Do not add the returned target key to `selectedOldFavoriteTargetKeys`.

- [ ] **Step 4: Verify green**

Run the same targeted test command and confirm it passes.

### Task 2: Add Single-video Fresh Scan Path

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] **Step 1: Write failing API and app tests**

Add tests proving the new single-video scan reads the latest tags and target membership by `aid`, and that app rejudge returns a rebuilt preview item.

- [ ] **Step 2: Verify red**

Run:

```bash
npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx
```

Expected before implementation: the script builder and app callback are missing.

- [ ] **Step 3: Implement single-video scan**

Extract shared scan helpers inside the generated favorite API script path where practical, and add `buildScanOldFavoriteVideoScript(ledgers, aid)` returning one source folder plus target membership. Wire it through `App` and `FloatingAssistantApp`.

- [ ] **Step 4: Verify green**

Run the same targeted command and confirm it passes.

### Task 3: Final Verification and Commit

**Files:**
- All modified source, tests, spec, and plan files.

- [ ] **Step 1: Run targeted regression**

```bash
npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

- [ ] **Step 3: Commit once**

```bash
git add docs/superpowers/specs/2026-06-28-rejudge-fresh-old-favorite-design.md docs/superpowers/plans/2026-06-28-rejudge-fresh-old-favorite.md src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/favoriteLedgerPreview.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx
git commit -m "fix: refresh old favorite before rejudging"
```

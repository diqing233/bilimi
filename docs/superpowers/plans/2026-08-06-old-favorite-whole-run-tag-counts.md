# Old Favorite Whole-Run Tag Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the whole-run overview show authoritative whole-run tag totals while preserving current-segment progress.

**Architecture:** Keep the change inside the existing overview presentation component. Resolve statistics from `tagEnrichment.scopes.wholeRun`, then the legacy top-level enrichment projection, then aggregate all segment descriptors as a compatibility fallback.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library

---

### Task 1: Reproduce the incorrect whole-run count

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Update the whole-run progress fixture with authoritative tag scopes**

Add a `tagEnrichment.scopes.wholeRun` projection containing `totalItemCount: 2552`, `completedItemCount: 1370`, and `pendingItemCount: 1182` while keeping the current segment at 500/370/130.

- [ ] **Step 2: Assert the whole-run line**

Expect `标签补取中 2552 条 · 已补取 1370 条 · 待补取 1182 条` and assert that the old current-batch-only line is absent.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "closes the whole-run progress"
```

Expected: FAIL because the component still renders 500/370/130.

### Task 2: Use authoritative whole-run tag statistics

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`

- [ ] **Step 1: Resolve tag statistics by precedence**

Read `snapshot.tagEnrichment?.scopes?.wholeRun`, then `snapshot.tagEnrichment`, then aggregate every segment. Do not read only `readiness === 'tagging'` segments.

- [ ] **Step 2: Keep rendering limited to active tag progress**

Use the resolved whole-run total, completed, and pending counts in the existing tag progress line without changing current-segment rendering.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run the command from Task 1 and expect one passing focused test.

### Task 3: Regression and real UI verification

**Files:**
- Verify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Verify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Run renderer regressions**

```powershell
npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx
```

Expected: both test files pass.

- [ ] **Step 2: Restart Electron and inspect the restored draft**

Confirm the whole-run overview shows 2552/1370/1182 while current batch still shows 500/370/130. Do not trigger tag retrieval, DeepSeek, save, or sync.

- [ ] **Step 3: Check repository state**

```powershell
git diff --check
git status --short --branch
```

Expected: no diff errors and no unrelated new changes.

- [ ] **Step 4: Suggest a local checkpoint**

Do not commit without explicit user authorization.


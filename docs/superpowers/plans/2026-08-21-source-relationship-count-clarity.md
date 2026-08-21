# Source Relationship Count Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scan overview distinguish the deduplicated pending-video total from the source-relationship total without changing source selection or execution.

**Architecture:** The shared workspace already calculates the deduplicated pending AID count and the renderer already sums per-source relationship counts. Keep both projections unchanged. In the scan overview, derive the displayed duplicate relationship count only from the confirmed, selected-source pending projection, then render it as header metadata and a native hover explanation.

**Tech Stack:** React, TypeScript, Vitest, Testing Library.

---

### Task 1: Record the product contract

**Files:**
- Modify: `docs/项目功能项目书.md:295-303`
- Modify: `docs/requirement-ledgers/2026-08-21-source-relationship-count-clarity.md`

- [x] **Step 1: Define the displayed values**

Specify that the default source-table mode is `待整理`, whose metadata is `（来源计数·重复计数）`. Define `来源计数` as the selected source rows summed by relationship and `重复计数` as that value less the top deduplicated pending-video count.

- [x] **Step 2: Preserve scope and side-effect boundaries**

Document that the source area remains absent in multi-batch current-segment view; no source selection, persistence, binding, backup, remote Bilibili mutation, or execution scope changes.

### Task 2: Add a red renderer regression test

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [x] **Step 1: Add the failing overlap fixture**

Add a complete inventory fixture whose selected source rows have `plannedAidCount` values of `1300` and `1336`, while `inventoryMetrics.plannedAidCount` is `2569`. Assert the source table exposes the pending header and its metadata:

```tsx
expect(within(sourceTable).getByRole('columnheader', { name: '待整理（2636·67）' }))
  .toHaveAttribute(
    'title',
    '2636：已选 B 站收藏夹中的待整理来源关系数。67：重叠来源产生的重复计数。顶部“本轮待整理”2569：去重后的实际整理视频数。'
  )
```

- [x] **Step 2: Run the targeted test and confirm RED**

Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: the new assertion fails because the existing header is `本轮待整理（2636）` and has no numeric relationship-overlap tooltip.

### Task 3: Render the confirmed duplicate relationship count

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:12-20,204-213,343-352`

- [x] **Step 1: Rename only the default source-mode label**

Change the planned source-mode label from `本轮待整理` to `待整理`. Leave the `已保护` and `失效视频` labels and the cyclic toggle order unchanged.

- [x] **Step 2: Derive display-only header metadata**

After calculating `sourceModeSummary`, derive the default-mode duplicate only when `inventoryMetrics.authority === 'complete'` and the summary is numeric:

```tsx
const sourceDuplicateCount = showSourceSelection && effectiveSourceCountMode === 'planned' &&
  inventoryMetrics?.authority === 'complete' && typeof sourceModeSummary === 'number'
  ? Math.max(0, sourceModeSummary - plannedAidCount)
  : null
const sourceModeSummaryLabel = sourceDuplicateCount === null
  ? `（${sourceModeSummary}）`
  : `（${sourceModeSummary}·${sourceDuplicateCount}）`
const sourceModeHeadingTitle = sourceDuplicateCount === null
  ? undefined
  : `${sourceModeSummary}：已选 B 站收藏夹中的待整理来源关系数。${sourceDuplicateCount}：重叠来源产生的重复计数。顶部“本轮待整理”${plannedAidCount}：去重后的实际整理视频数。`
```

This calculation must not enter the shared workspace projection or any command path.

- [x] **Step 3: Render accessible header metadata and hover text**

Use `sourceModeSummaryLabel` consistently in the header small text and the header/toggle accessible labels. Add `title={sourceModeHeadingTitle}` to the source column header. Retain the existing `待确认` summary until the inventory projection is confirmed.

- [x] **Step 4: Run the targeted test and confirm GREEN**

Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: PASS, including the overlap assertion and existing single-/multi-batch visibility tests.

### Task 4: Verify, document evidence, and commit only this topic

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-21-source-relationship-count-clarity.md`

- [x] **Step 1: Run focused and type/build checks**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx
npm run build
git diff --check
```

Expected: all pass with no whitespace error.

- [x] **Step 2: Perform read-only Electron visual verification**

Open an existing completed scan overview. Verify `（来源计数·重复计数）` appears beneath the `待整理` source-column header, and use the renderer regression to verify the native hover title explains each number. Capture `.codex-artifacts/2026-08-21-source-relationship-count-clarity.png`. Do not click source selection, backup, binding, deletion, save, sync, or any Bilibili write control.

- [x] **Step 3: Update I001 evidence and commit the scoped files**

Record code locations, exact test outcomes, screenshot path or the environmental limitation, and the absence of Bilibili side effects. Stage only the project book, this requirement ledger, this plan, the renderer component, and its test. Commit with:

```powershell
git commit -m "fix: clarify source relationship counts"
```

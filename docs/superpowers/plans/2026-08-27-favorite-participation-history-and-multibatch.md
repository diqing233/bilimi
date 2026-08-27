# 收藏夹参与、历史恢复与多批总览实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使上方已保存规则的参与状态产生可恢复的真实分类结果，历史恢复不保留失效本地草稿，多批工作区默认稳定显示本轮总览。

**Architecture:** 主进程保存当前轮参与集并将其作为分类输入，以有界异步分类生成真实 journal 迁移；历史恢复继续使用既有权威快照，渲染器只清理已失效的临时推荐草稿；视图范围只在工作区首次实际成为多批时初始化。分类、预览和同步前预检都读取同一主进程结果，不产生 B 站副作用。

**Tech Stack:** Electron main process、React、TypeScript、Vitest。

---

### Task 1: 将上方参与状态纳入真实分类

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/index.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('reclassifies a saved-rule cancellation to another active saved rule and records the move', async () => {
  // Two saved rules match aid 1; remove the higher-priority rule from this round.
  // Expect the snapshot classification and favorite-rules history to name the fallback target.
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "reclassifies a saved-rule cancellation"`

Expected: FAIL because `setRoundExcludedLedgerIds` only filters the preview projection and keeps the old classification/history unchanged.

- [ ] **Step 3: Implement the minimal main-process change**

```ts
// Coordinator: derive final participating saved IDs from saved IDs minus excluded IDs,
// run the existing bounded auto-classifier, then merge classification and rule state.
await this.autoClassifyAllSegmentsUnsafe(workspace, true, false, false, undefined, false, participatingSavedLedgerIds)
```

```ts
// IPC classifier: when a current-round participation set is supplied, project
// saved-rule enabled flags from that set before calling classifyOldFavoriteItemsCooperatively.
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "reclassifies a saved-rule cancellation"`

Expected: PASS; no manual/DeepSeek or remote operation assertions change.

### Task 2: 清理历史恢复后的渲染器临时草稿

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Create or modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('removes a promoted recommendation cache entry after history restores a ledger directory without it', async () => {
  // Render a promoted local recommendation, then rerender the authoritative
  // snapshot with an empty adopted set and no matching saved ledger.
  // Expect the upper saved-rule card to disappear.
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "removes a promoted recommendation cache entry"`

Expected: FAIL because `promotedRecommendationLedgers` is retained until account change.

- [ ] **Step 3: Implement the minimal reconciliation effect**

```tsx
// Only when no recommendation save is in flight, retain promoted cache records
// that still exist in authoritative ledgers or are currently adopted; discard the rest.
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "removes a promoted recommendation cache entry"`

Expected: PASS; in-flight optimistic recommendation saves remain retained.

### Task 3: 仅在实际多批时初始化本轮总览

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('defaults to the whole-run view when one workspace grows from one segment to multiple segments', async () => {
  // Rerender the same workspace ID from one segment to two and expect overview selected.
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx -t "grows from one segment"`

Expected: FAIL because the single-segment snapshot consumes the multi-batch initialization marker.

- [ ] **Step 3: Implement the minimal initialization guard**

```tsx
if (!hasMultipleSegments) return
if (initializedMultiBatchWorkspaceIdRef.current === snapshot.workspaceId) return
initializedMultiBatchWorkspaceIdRef.current = snapshot.workspaceId
setViewScope('all')
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx -t "grows from one segment"`

Expected: PASS; an explicit user switch remains stable across ordinary snapshot refreshes.

### Task 4: 验收与账本

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-27-favorite-cancel-classification-movement.md`
- Modify: `docs/项目功能项目书.md`

- [ ] Run focused coordinator and renderer suites, `npm test`, `npm run build`, `git diff --check`.
- [ ] Run Electron development build read-only: inspect a cancellation migration, history restore and multi-batch default; save screenshots under `.codex-artifacts/` without B 站 writes.
- [ ] Record per-item code paths, automated results, interface evidence and unverified remote boundaries in the ledger.
- [ ] Selectively commit only this favorite-history theme; exclude `pnpm-lock.yaml` and `pnpm-workspace.yaml`.

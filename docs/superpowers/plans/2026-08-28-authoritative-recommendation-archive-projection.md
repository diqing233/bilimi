# 权威推荐归档投影 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已采用推荐的归档预览与同步确认始终显示主进程快照中的真实归档数，不受渲染器临时勾选状态影响。

**Architecture:** 推荐复选框仍可使用渲染器本地状态作即时视觉反馈；分类、归档统计、保存与同步确认只消费同一主进程快照。上方自建规则的完整重分类只是正确性参照，推荐采纳继续按持久化的精确命中 AID异步重排。

**Tech Stack:** Electron、React、TypeScript、Vitest、Testing Library。

---

### Task 1: 记录权威投影边界

**Files:**
- Modify: `docs/项目功能项目书.md` §5.5
- Modify: `docs/requirement-ledgers/2026-08-28-favorite-preview-backup-projection.md`

- [x] **Step 1: 明确投影权威**

项目书规定 `overview.archiveTargets` 是分类收束后的唯一统计来源；本地 `recommendedCandidateIds` 只能画勾选中的临时反馈，不能过滤或补零已发布目标。

- [x] **Step 2: 在账本 I004 记录代码位置和验收结果**

只在自动化回归、Electron 只读验收完成后更新证据；不得将真实 B 站创建、绑定、删除或视频写入作为本轮验证动作。

### Task 2: 写出归档统计不同步的失败回归

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx:87-89`

- [x] **Step 1: 反转过期预期**

```tsx
rendered.rerender(<OldFavoriteConfirmationStep
  snapshot={snapshot}
  ledgers={ledgers}
  {...props}
  recommendedCandidateIds={[]}
  viewScope="all"
/>)
expect(screen.getByText('预计归档 499 条')).toBeInTheDocument()
```

- [x] **Step 2: 运行 RED**

Run: `npm test -- --run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

Expected: 失败，因为当前组件把空的局部推荐选择传给本轮汇总，过滤掉快照中 `knowledge` 的 499 条后再补零。

### Task 3: 让归档视图只读取权威采用快照

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx:19-87`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx:103-161, 551, 654`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx:29, 119, 242, 392`

- [x] **Step 1: 移除统计层的局部推荐选择输入**

```tsx
for (const target of overview.archiveTargets) {
  const ledgerId = canonicalLedgerId(target.ledgerId)
  if (ledgerId !== 'inbox' && enabledLedgerIds && !enabledLedgerIds.has(ledgerId)) continue
  // archiveTargets 已是主进程分类后的事实；不再按局部推荐选择过滤。
}
```

- [x] **Step 2: 归档卡片同样以快照采用集合过滤**

```tsx
const selectedRecommendationKey = snapshot.recommendations.adoptedCandidateIds.join('\u0001')
```

保留 `candidateLedgerIds` 的稳定 ID 映射和 `enabledLedgerIds` 的本轮参与过滤；只删除渲染器局部推荐数组对分类结果的二次裁剪。

- [x] **Step 3: 运行 GREEN**

Run: `npm test -- --run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

Expected: 所有断言通过；局部数组为空时仍显示 499 条，真正未采用或无成员规则仍显示 0 条。

### Task 4: 回归、只读验收与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-28-favorite-preview-backup-projection.md`

- [x] **Step 1: 运行受影响回归和构建**

Run: `npm test -- --run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`，随后 `npm test`、`npm run build`、`git diff --check`。

- [x] **Step 2: Electron 只读验收**

在已有草稿中检查：已采用且有成员的推荐规则显示真实数；未备册规则仍在同一同步前备册确认中；不点击确认备册、不创建/绑定/删除远端收藏夹、不写入视频。截图存入 `.codex-artifacts/`。

- [x] **Step 3: 选择性提交**

只暂存本计划涉及的项目书、账本、计划、三个渲染器文件和测试；排除 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 与所有无关改动。

# 扫描完成状态与来源重复计数修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止标签补取尚未完成时扫描概览错误宣告本轮已结束，并且不再把来源重叠关系显示为未扫描视频。

**Architecture:** 保持主进程的基础扫描和标签补取事实不变。渲染层依据已有 `scan.phase`、`tagEnrichment.status`、待办和失败数派生真实引导；概览数据删除误导性的 `unscannedItemCount`，避免将关系计数与去重 AID 数相减后作为视频遗漏发布。

**Tech Stack:** TypeScript、React、Vitest、Electron。

---

### Task 1: 为暂停标签补取时的结束文案建立回归测试

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [x] **Step 1: 写入失败测试**

构造 `scan.phase: 'complete'` 且 `tagEnrichment.status: 'paused'`、`pendingItemCount: 383` 的多批快照。断言出现“基础扫描已完成，标签补取已暂停：待补取 383 条。”；断言不出现“本轮扫描与标签补取已完成”；第一行仍显示“已完成”。

- [x] **Step 2: 运行失败测试**

Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: 新断言失败，因为当前实现无条件输出完整结束引导。

- [x] **Step 3: 最小实现**

在 `OldFavoriteScanOverviewStep.tsx` 添加只读的标签完成派生：仅 `complete` 且待办/失败为零才使用完整结束引导；暂停/运行/失败使用基础扫描完成的真实状态文案。

- [x] **Step 4: 运行通过测试**

Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: PASS。

### Task 2: 删除把来源重复关系投影为未扫描视频的字段

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 1: 写入失败测试**

将现有协调器测试改为断言扫描中快照 `overview` 不含 `unscannedItemCount`；在整轮概览测试加入带来源总数大于去重 AID 数的快照，并断言不出现“尚未扫描”。

- [x] **Step 2: 运行失败测试**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: 新断言失败，因为协调器仍写出该字段，组件仍渲染该文字。

- [x] **Step 3: 最小实现**

从共享视图类型和 `createOverviewProjection` 删除 `unscannedItemCount`；移除 `OldFavoriteWholeRunOverview` 的对应段落。来源重叠仍只由既有来源表标题的`（来源计数·重复计数）`解释。

- [x] **Step 4: 运行通过测试**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: PASS。

### Task 3: 验证、只读窗口验收并记录

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-21-scan-premature-completion.md`
- Modify: `docs/项目功能项目书.md`
- Create: `.codex-artifacts/2026-08-21-scan-premature-completion.png`

- [x] **Step 1: 运行静态与构建验证**

Run: `npm run build` and `git diff --check`

Expected: both exit 0.

- [x] **Step 2: Electron 只读验收**

打开现有恢复草稿的扫描概览，不点击补取、采用、保存、同步、创建、绑定、删除或 B 站写入按钮。截图验证标签未完成时不出现完整结束引导，且概览中没有“尚未扫描”。

- [x] **Step 3: 更新账本并提交**

记录代码位置、测试、截图和未能验证的真实远端副作用。只暂存本轮项目书、账本、计划、扫描概览/概览投影/对应测试文件，随后提交一次。

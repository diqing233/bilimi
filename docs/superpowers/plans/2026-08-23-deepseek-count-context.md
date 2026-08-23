# DeepSeek 数量口径澄清 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在确认执行中说明 DeepSeek 本次模式、范围与候选数量，避免把批次总视频数和失败数量误读为同一口径。

**Architecture:** 主进程在现有 `deepSeekRun` 快照中投影每批候选 AID 数和本轮候选总数；渲染器只读取该权威快照，在多批当前批视图中显示当前批候选与本轮候选，在其他视图显示本轮候选。失败、回退、保存和同步资格维持现状。

**Tech Stack:** Electron main process、共享 TypeScript 快照类型、React、Vitest。

---

### Task 1: 先锁定确认页的口径文案

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [x] **Step 1: 写失败测试**

在多批当前批快照中提供 `deepSeekRun` 的 `mode: 'unclassified-only'`、`scope: 'all'`、`totalVideoCount: 243` 与第 1 批候选数 196，断言确认页同时出现：

```tsx
expect(screen.getByText('本次 DeepSeek：只整理【未匹配到合适分类】· 本轮所有批次')).toBeInTheDocument()
expect(screen.getByText('当前批候选 196 条；本轮候选 243 条。')).toBeInTheDocument()
```

- [x] **Step 2: 验证测试确实失败**

Run: `npm exec vitest run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx --runInBand`

Expected: 失败原因为共享快照尚无每批候选数，或确认页尚无该文案；不能因测试夹具错误失败。

### Task 2: 投影权威候选口径并渲染

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`

- [x] **Step 1: 写主进程快照失败测试**

构造 `scope: 'all'` 的 DeepSeek 检查点，`segmentWork` 分别包含 196 与 47 个 AID；断言快照投影为：

```ts
expect(snapshot.deepSeekRun).toMatchObject({
  totalVideoCount: 243,
  candidateVideoCountBySegment: { 'segment-1': 196, 'segment-2': 47 }
})
```

- [x] **Step 2: 验证主进程测试失败**

Run: `npm exec vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts --runInBand`

Expected: `candidateVideoCountBySegment` 缺失。

- [x] **Step 3: 最小实现**

为 `OldFavoriteWorkspaceSnapshot.deepSeekRun` 添加可选的 `candidateVideoCountBySegment`。仅在存在 `segmentWork` 的检查点中由主进程按每段 `aids.length` 投影；不得修改检查点、分类、失败数、`readinessFor`、保存或同步逻辑。确认页把 `mode` 映射为现有范围选择文案，`scope: 'all'` 映射为“本轮所有批次”，并在多批当前批视图显示当前批/本轮候选；单批或本轮总览只显示本轮候选。

- [x] **Step 4: 验证 GREEN**

Run: `npm exec vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx --runInBand`

Expected: 两个测试文件通过；既有“失败仍阻塞并要求显式回退”的测试保持通过。

### Task 3: 收尾验证与审计证据

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-23-deepseek-unclassified-count-mismatch.md`
- Modify: `docs/项目功能项目书.md`

- [x] **Step 1: 运行相关回归**

Run: `npm exec vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx --runInBand`

Expected: 通过；不触发真实 DeepSeek 或 B 站操作。

- [x] **Step 2: 运行质量检查**

Run: `git diff --check`

Expected: 无空白错误。

- [x] **Step 3: 更新账本证据并选择性提交**

仅暂存项目书、实施计划、I001 账本、共享快照类型、主进程投影及其测试、确认页及其测试；不得暂存任何已有“同步前备册预检”文件改动。提交信息：

```bash
git commit -m "fix: clarify DeepSeek candidate counts"
```

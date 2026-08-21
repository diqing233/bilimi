# 单批扫描轮次状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让扫描概览在单批和多批本轮总览显示整轮来源与三选一统计，而多批当前批隐藏整个 B 站来源选择区。

**Architecture:** 只在渲染层为完整来源区增加一个由 `hasMultipleSegments` 和 `viewScope` 推导的可见性条件。来源选择回调、快照、分段投影和 B 站动作均保持不变；测试从 DOM 行为锁定三个观察 scope 的边界。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Electron Vite。

---

### Task 1: 同步项目书与实施依据

**Files:**
- Modify: `docs/项目功能项目书.md:294-311`
- Modify: `docs/项目功能项目书.md:335-348`
- Create: `docs/superpowers/plans/2026-08-21-single-batch-scan-round-status.md`

- [x] **Step 1: 重新通读本轮账本原文和索引**

Run: `Get-Content -Raw docs/requirement-ledgers/2026-08-21-single-batch-scan-round-status.md`

Expected: I001 和 I002 均为已确认，且没有待用户决定或明确不做项。

- [x] **Step 2: 先更新项目书第 5.2、5.4 节**

将来源区的 scope 规则写为：

```text
单批与多批本轮总览：来源表可见，默认本轮待整理，可轮换已保护和失效视频。
多批当前批：整个来源区不可见；不清空或按批拆分来源选择。
```

- [x] **Step 3: 检查文档差异空白错误**

Run: `git diff --check -- docs/项目功能项目书.md`

Expected: exit 0。

### Task 2: 用失败测试锁定三种观察 scope

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx:266-355`

- [x] **Step 1: 写入多批当前批隐藏来源区的失败断言**

在现有多批 `viewScope="current"` 快照中加入：

```tsx
expect(screen.queryByText(/已发现 .* 个 B站收藏夹/)).not.toBeInTheDocument()
expect(screen.queryByRole('table', { name: 'B站收藏夹' })).not.toBeInTheDocument()
expect(screen.queryByRole('checkbox', { name: '全选来源' })).not.toBeInTheDocument()
expect(screen.queryByText('默认收藏夹')).not.toBeInTheDocument()
```

- [x] **Step 2: 写入总览和单批保留三选一的回归断言**

在多批 `viewScope="all"` 断言来源表可见，点击当前最后一列的切换按钮后依次断言：

```tsx
expect(screen.getByRole('columnheader', { name: /本轮待整理/ })).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: /本轮待整理/ }))
expect(screen.getByRole('columnheader', { name: /已保护/ })).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: /已保护/ }))
expect(screen.getByRole('columnheader', { name: /失效视频/ })).toBeInTheDocument()
```

保留单批的来源表与同一三选一断言，确认它不显示多批切换器。

- [x] **Step 3: 运行聚焦测试并确认 RED**

Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: 多批当前批的“来源表不存在”断言失败，原因是当前实现总是渲染来源区。

### Task 3: 以最小渲染条件实现隐藏

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:124-126,320-360`

- [x] **Step 1: 推导来源区可见性**

在既有多批判定旁加入：

```ts
const showSourceSelection = !hasMultipleSegments || viewScope === 'all'
```

- [x] **Step 2: 仅包裹完整来源区**

将以下现有 JSX 保持原样地置于 `showSourceSelection` 条件内：

```tsx
<hr className="favorite-ledger-panel__scan-source-divider" aria-hidden="true" />
<p className="favorite-ledger-panel__scan-discovery">已发现 {folders.length} 个 B站收藏夹。</p>
// 增量已保护提示、全选、来源表、总数和最后一列三选一
```

不得改动 `onSelectSourceFolders`、来源快照、上方统计卡、`currentSegmentMetrics`、扫描/标签控制或 B 站调用。

- [x] **Step 3: 运行聚焦测试并确认 GREEN**

Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Expected: exit 0，单批与多批总览仍可选来源并轮换三种数量，多批当前批不再渲染来源区。

### Task 4: 回归、Electron 只读验收与账本证据

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-21-single-batch-scan-round-status.md`
- Create: `.codex-artifacts/2026-08-21-single-batch-scan-round-status-*.png`

- [x] **Step 1: 运行渲染器回归和构建**

Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

Run: `npm run build`

Expected: 两个命令 exit 0。

- [x] **Step 2: Electron 开发版只读检查**

启动 `npm run dev`，只进入扫描概览并拍摄三张图：单批、多个批次的当前批、多个批次的本轮总览。不得点击创建、绑定、删除、保存、同步或其他 B 站写入入口。

- [x] **Step 3: 回填账本 I001、I002**

记录准确代码位置、自动化命令结果、截图绝对路径和“未调用 B 站写入”的边界；若实际可用数据不足以看到三种 UI 状态，明确记录该验收缺口。

- [ ] **Step 4: 最终检查并选择性提交**

Run: `git diff --check`

Run: `git status --short`

Run: `git diff --stat`

仅暂存项目书、本计划、本轮账本、扫描总览组件和它的测试；保留两个无关未跟踪 DeepSeek / Codex 账本。

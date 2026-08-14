# 删除确认提示收拢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在右侧 bilimi 收藏夹删除确认弹窗中，将 B 站删除影响收拢到顶部候选列表，移除逐项重复的长段说明。

**Architecture:** 继续由 `deletionScope` 决定显示语义。弹窗将候选列表从纯文本项改为名称、视频数与按范围计算的 B 站影响摘要；删除调用、候选数据和确认状态完全不变。

**Tech Stack:** React、TypeScript、Vitest、Testing Library。

---

### Task 1: 为紧凑删除摘要建立回归测试

**Covers:** I001 (R001-R003)

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: 添加失败的弹窗文案测试**

在包含一个已绑定候选和一个无远端绑定候选的删除弹窗中，断言：

```ts
expect(dialog).toHaveTextContent('知识学习（当前 310 个视频）B站：删除 1 个实际收藏夹')
expect(dialog).toHaveTextContent('暂存（当前 0 个视频）B站：无绑定，不会删除')
expect(dialog).not.toHaveTextContent('删除“知识学习”时，会同时从 B 站删除')
```

切换到“仅删除右侧 bilimi 收藏夹”后断言每项显示 `B站：保留`，且总说明仍只出现一次。

- [x] **Step 2: 运行测试确认 RED**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: FAIL，当前实现仅在列表显示视频数，并在列表下输出逐项拼接的重复远端删除说明。

### Task 2: 收拢摘要并保留删除语义

**Covers:** I001 (R001-R003)

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: 增加只读显示摘要**

按 `logicalLedgerId` 统计每个候选的远端实际收藏夹数，并在候选 `<li>` 中显示范围对应的短文本。列表使用现有 `candidate.title`、`candidate.memberCount` 和 `candidate.remoteFolderId`，不得改变 `deletionPlan`。

- [x] **Step 2: 删除重复长段并保留单条范围说明**

移除 `remoteDeletionSummaries` 的逐项句子；保留并收紧现有范围级 `<p>`。不修改确认复选、未绑定确认、错误输出、`confirmManagedDeletion` 或远端参数计算。

- [x] **Step 3: 运行测试确认 GREEN**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: PASS，且不输出 React 警告。

### Task 3: 账本、构建和界面验收

**Covers:** I001

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-15-deletion-dialog-summary-layout.md`
- Modify: this plan file

- [x] **Step 1: 完成最终验证**

Run: `git diff --check`

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Run: `npm run build`

- [x] **Step 2: 记录证据并提交**

在账本索引后追加实际代码位置、测试结果和真实 Electron 验收状态。重新读取 R001-R003 与索引，再仅暂存本轮弹窗、测试、账本和计划文件，创建一次本地 `main` 提交；不推送、合并、变基、重置、暂存或清理。

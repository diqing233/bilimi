# 收藏夹新建动作改动记录过滤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只在收藏夹参与状态变化确实移动视频分类时，产生一个可恢复的改动记录；新建规则、推荐草稿和零移动勾选只持久化，不进入历史。

**Architecture:** 以主进程 `OldFavoriteWorkspaceCoordinator` 的持久化历史写入为唯一过滤点，防止空 `changes` 项写进工作区 journal、历史游标或渲染器投影。渲染器只继续显示主进程给出的有移动条目，因此不增加渲染器扫描或点击处理开销。

**Tech Stack:** Electron main process、TypeScript、Vitest、React、Markdown。

---

### Task 1: 固化文档契约和失败回归

**Files:**
- Modify: `docs/项目功能项目书.md:372`
- Modify: `docs/requirement-ledgers/2026-08-27-favorite-history-create-record-filtering.md`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:5835,11033`

- [x] **Step 1: 写出零移动规则状态变化不写历史的失败用例**

```ts
await coordinator.recordFavoriteLedgerHistoryChange('100', { before, after: enabledOff })
await coordinator.recordFavoriteLedgerHistoryChange('100', {
  before: enabledOff,
  after: excluded,
  mergeWithLatestClassification: true
})

const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
expect(snapshot.history.length).toBe(baselineLength)
expect(snapshot.history.entries).toHaveLength(baselineLength)
```

将“新建规则产生历史描述”的断言替换为创建后历史仍为空、规则快照仍可由下一次读取获得的断言。

- [x] **Step 2: 运行测试确认当前实现失败**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts --testNamePattern="no video moved|created through history"`

Expected: FAIL；当前实现会新增 `source: 'favorite-rules'`、`changes: []` 条目。

### Task 2: 在权威历史写入点过滤零移动项

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:5527-5585`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:5835,11033`

- [x] **Step 1: 最小实现**

```ts
const shouldMerge = transition.mergeWithLatestClassification === true &&
  Boolean(latest?.changes.length)
if (!shouldMerge) {
  // The owning recommendation, saved-rule or exclusion command has already
  // persisted the rule state; do not create a restorable archive cursor.
  return clone(workspace)
}
```

实现必须只过滤“没有可合并分类记录”的规则历史写入；当 `mergeWithLatestClassification` 为真且最新分类项有 `changes` 时，仍把前后规则快照合并到该分类记录。

- [x] **Step 2: 运行定向 GREEN 测试**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts --testNamePattern="no video moved|created through history|merges.*classification"`

Expected: PASS；有移动的勾选仍为一条记录，零移动与单独新建不创建历史游标。

### Task 3: 回归、界面只读验收与账本证据

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-27-favorite-history-create-record-filtering.md`
- Create: `.codex-artifacts/2026-08-27-favorite-history-create-record-filtering.png`

- [x] **Step 1: 运行相关回归**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 2: Electron 只读验收**

启动开发版，只打开“整理收藏 → 归档预览 → 改动记录”；不操作勾选、恢复、备册、同步或删除。保存截图并确认菜单不再出现“新建…未产生分类移动”，包括旧工作区遗留的`favorite-rules + changes=[]`检查点；已有的实际分类移动记录仍保留，菜单、鼠标移动和滚动保持响应。

结果：当前开发版主进程早于本轮代码启动，菜单仍显示两条旧空记录；为避免中断用户正在使用的草稿，没有重启该进程，因此截图与新逻辑的真实界面验收待下次重启后完成。

- [x] **Step 3: 完成账本证据和提交前检查**

记录 I001 的实际代码位置、定向/全量测试、Electron 验收与“不发生 B 站副作用”的边界。已运行 `npm test`（240/240、4115/4115）、`npm run build`、`git diff --check`、`git diff --stat`、`git status --short`；只暂存本计划、项目书、账本、协调器与相应测试，不暂存 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`。

# 收藏夹改动记录历史恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让整理收藏的改动记录恢复到所选历史游标时，精确复现该位置的本地分类、规则、勾选与推荐采用状态，而不被当前自动分类覆盖。

**Architecture:** `moveHistoryCursor()` 已通过分类 journal 的 undo/redo 得到目标分类；这份结果改为恢复的权威输入。恢复规则快照后，仅用现有主进程 overview runtime 更新归档预览、同步预检和就绪度，并持久化历史游标，不再调用全轮分类器。渲染器仍只消费主进程返回快照。

**Tech Stack:** TypeScript、Electron 主进程、Vitest、现有本地工作区 journal/overlay 持久化。

---

### Task 1: 明确恢复契约与可审计范围

**Files:**
- Modify: `docs/项目功能项目书.md:351-385`
- Modify: `docs/requirement-ledgers/2026-08-28-favorite-history-restore.md`

- [x] **Step 1: 将项目书恢复语义写为历史分类优先**

在 §5.5 增加“历史分类快照优先”：历史游标移动后，分类 journal 已还原出的目标分类是该位置的事实；恢复规则、勾选、推荐采用和排除集合后，只能据此重建归档预览、同步预检和就绪度，不得再次调用当前自动分类器覆盖系统、DeepSeek 或人工分类。仅在恢复完成后用户明确作出新的规则/勾选/推荐/分类操作，才允许按当前规则重新分类并开新分支。

在 §5.6 补充：恢复目标无法从持久化 journal 重建时保留原权威快照并给出恢复失败，不能静默重算伪装为“恢复当时状态”。

- [x] **Step 2: 更新本轮账本索引**

将 I001 状态更新为“实施中”，写明恢复范围是：目标分类、规则目录、账号级勾选、推荐采用和排除集合；明确 B 站创建、绑定、删除和视频写入均不在本轮范围。

### Task 2: 用回归测试固定历史分类优先语义（RED）

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:11513-11545`

- [x] **Step 1: 写入失败测试**

把现有“恢复规则历史后重建本地分类投影”测试改为：分类器返回 `music`，人工把 aid `1` 移至 `manual` 并把规则状态合并到该移动；游标先回到基线，再恢复到人工移动所在游标。断言分类器调用数不增加，返回快照仍是 `manual` 分类、目标游标和对应规则快照。

- [x] **Step 2: 运行 RED**

```powershell
npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "replays the selected historical classification"
```

预期失败：当前 `moveHistoryCursor()` 调用全轮分类器，调用数增加且 `manual` 被重算成 `music`。

### Task 3: 仅重建本地派生投影（GREEN）

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:5549-5603`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:6737-6775`

- [x] **Step 1: 提取历史投影就绪度计算**

新增私有方法 `calculatePlanReadinessFromOverviewProjection(workspace)`：从 `overviewRuntimes` 各批 `classificationsBySegment` 组合分类；runtime 不存在时使用 `workspace.classifications`；随后调用现有 `calculatePlanReadinessFromClassifications(workspace, classifications)`。该方法不得读取 B 站、调用分类器或写入远端实体。

- [x] **Step 2: 替换恢复后的全轮重算**

在 `moveHistoryCursor()` 的规则快照分支删除 `autoClassifyAllSegmentsUnsafe(..., true, true, true, ...)`；改为 `captureCurrentSegmentOverviewClassifications(updated)`、新就绪度方法和现有 `appendOverlay()`。继续持久化同一 `history-cursor`、推荐采用、排除集合、参与规则集合和就绪度，并以 `updated` 为返回/内存快照。

- [x] **Step 3: 运行 GREEN**

运行同一聚焦测试；预期通过，分类器调用数不增加，`manual` 分类、历史游标和规则快照都保持目标位置。

### Task 4: 回归、只读验收与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-28-favorite-history-restore.md`

- [x] **Step 1: 运行相关回归**

```powershell
npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts
npm test -- src/shared/oldFavoriteWorkspace.test.ts
npm run build
git diff --check
```

预期所有命令退出码为 `0`。

- [x] **Step 2: Electron 只读验收**

启动开发版，仅打开现有整理草稿并查看改动记录；不点击会移动历史游标的恢复按钮，也不点击创建、绑定、删除、备册、保存或同步。把可见界面截图保存到 `.codex-artifacts/2026-08-28-favorite-history-restore-readonly.png`；若没有安全的可观察历史数据，在账本中明确记录该限制。

- [x] **Step 3: 填写证据并提交本轮文件**

在账本 I001 写入代码位置、RED/GREEN 与回归结果、Electron 证据路径和 B 站未操作说明。确认只暂存项目书、计划、账本、协调器和测试后提交 `fix: restore favorite history snapshots`。

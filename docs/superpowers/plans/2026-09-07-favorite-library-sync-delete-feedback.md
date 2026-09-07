# 收藏库远端删除与暂存同步反馈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让远端 bilimi 删除和无远端目标的暂存同步只展示并持久化真实的 B 站事实。

**Architecture:** 受管远端删除继续通过已有位置同步服务请求 B 站删除，但成功后恢复用户本地工作夹意图并保留“远端已移除”的位置差，从而投影为未同步。同步服务在生成任何同步审计或远端请求前验证至少存在一个正式 bound 物理目标，空目标直接落为失败/未同步。

**Tech Stack:** Electron 主进程、TypeScript、Vitest、收藏库权威仓库快照。

---

### Task 1: 项目书与账本事实规则

**Files:**

- Modify: `docs/项目功能项目书.md:583,586`
- Modify: `docs/requirement-ledgers/2026-09-07-favorite-library-sync-delete-feedback.md`

- [x] **Step 1: 写入同步资格和远端删除后的本地/远端事实边界**

在单视频同步条目中明确：无正式 bound 物理分册时不得请求 B 站、不得登记成功、状态保持未同步；在远端删除条目中明确：删除成功后保留本地期望归属、清除对应受管远端事实并投影为未同步。

- [x] **Step 2: 核对文档覆盖 R001 的 I001、I002**

Run: `rg -n "无正式|未同步|保留本地期望归属" docs/项目功能项目书.md docs/requirement-ledgers/2026-09-07-favorite-library-sync-delete-feedback.md`

Expected: 两项都能追溯到 R001，且没有改变普通 B 站收藏夹、档案或转写边界。

### Task 2: 远端 bilimi 删除保留本地意图

**Files:**

- Modify: `electron/main/favoriteRepositoryBatchOperationService.test.ts:179-227,357-379`
- Modify: `electron/main/favoriteRepositoryBatchOperationService.ts:268-380,692-744`

- [x] **Step 1: 写入失败回归**

把受管远端删除成功的既有回归改为断言最终 `localDesiredFolderIds` 仍含被删除的逻辑工作夹、`remoteObservedPhysicalFolderIds`/`remoteObservedLogicalFolderIds` 已清除、`positionState` 为 `local-only-change` 且不进入回收站；未知结果经只读对账确认远端已删除时也应保持同一结果。

- [x] **Step 2: 运行回归并确认旧实现失败**

Run: `npm test -- electron/main/favoriteRepositoryBatchOperationService.test.ts`

Expected: 删除成功后的旧实现仍移除本地期望归属并回收，新增/更新断言失败。

- [x] **Step 3: 最小实现本地意图保留收束**

新增仅在远端删除已经确认、且对应受管远端观察事实已经消失时调用的收束方法：将本地期望归属合回位置记录，不写分类调整、不回收视频；让仓库现有位置推导得到 `local-only-change`。执行成功和后续对账成功都调用它，远端失败/未知不调用。

- [x] **Step 4: 运行回归确认通过**

Run: `npm test -- electron/main/favoriteRepositoryBatchOperationService.test.ts`

Expected: PASS；远端实际删除成功后详情/列表读取到未同步，失败与未知不伪造未同步。

### Task 3: 暂存空目标同步拒绝成功

**Files:**

- Modify: `electron/main/favoriteRepositorySyncService.test.ts:616-637`
- Modify: `electron/main/favoriteRepositorySyncService.ts:1204-1318`

- [x] **Step 1: 写入失败回归**

构造 `localDesiredFolderIds: []` 的本地暂存位置；断言 `synchronizePlacements()` 返回 `failed`、不调用 append/remove、不生成 `succeeded` 同步回执，位置为 `target-missing`、分类同步状态为失败。

- [x] **Step 2: 运行回归并确认旧实现失败**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts`

Expected: 新增回归在旧实现中得到 `succeeded`，证明当前会把零目标同步误报为成功。

- [x] **Step 3: 最小实现空目标预检**

在同步循环中、创建同步审计和调用页面桥之前，要求 `localDesiredFolderIds` 至少有一个正式 `bilimi-logical:` 目标；没有时写入 `target-missing`/`logical-target-unbound` 失败投影及失败分类状态，并继续收束，不生成成功回执或 B 站请求。

- [x] **Step 4: 运行回归确认通过**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts`

Expected: PASS；已绑定正常同步回归仍会调用真实目标，暂存空目标始终未同步。

### Task 4: 回归、账本证据与提交前核对

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-07-favorite-library-sync-delete-feedback.md`

- [x] **Step 1: 运行相关测试、全量测试、构建和静态差异检查**

Run: `npm test -- electron/main/favoriteRepositoryBatchOperationService.test.ts electron/main/favoriteRepositorySyncService.test.ts && npm test && npm run build && git diff --check`

Expected: 每个命令退出 0；无新 TypeScript、测试或空白差异错误。

- [x] **Step 2: 按 R001 更新验收记录**

记录每项精确代码位置、定向自动化证据、全量验证证据与真实账号/Electron 尚待用户验收边界。不得记录未做过的真实 B 站写入或删除。

- [x] **Step 3: 提交前逐项回读**

Run: `git status --short && git diff --stat && git diff --check`

Expected: 仅本计划列出的收藏库代码、测试、项目书和本轮账本/计划有改动。

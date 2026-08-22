# DeepSeek 完成态与 B 站同步响应性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先让已完成的 DeepSeek 全轮整理可靠退出运行态，再让整理收藏点击确认同步到 B 站时不阻塞 Electron 交互。

**Architecture:** DeepSeek 以主进程持久化检查点是否存在作为运行态唯一真相，渲染器在收到无检查点快照时必须清除所有本地运行反馈。B 站路径则把本地完整结果提交、冻结计划和后台执行分开：同一点击只提交一次完整本地结果，耗时准备和后续同步都保留真实状态并让出事件循环，避免全量重复工作和整页大快照阻塞。

**Tech Stack:** Electron、TypeScript、React、Vitest。

---

### Task 1: DeepSeek 自然完成终态（I001 / R001、R002）

**Files:**
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`（若不存在则创建同名测试）
- Modify: `docs/项目功能项目书.md` §5.7
- Modify: `docs/requirement-ledgers/2026-08-22-deepseek-run-stays-running-after-completion.md`

- [x] **Step 1: 写红灯测试**

  模拟先收到带 `deepSeekRun.status: 'running'` 的旧返回快照、随后轮询收到同一工作区但没有 `deepSeekRun` 的权威快照；断言反馈状态变为 `completed`，不再显示取消入口。

- [x] **Step 2: 确认 RED**

  运行：`npm test -- --run src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx -t "clears stale running feedback when a completed DeepSeek snapshot has no checkpoint"`

  预期：失败，当前实现只在反馈状态为 `waiting` 时才收束无检查点快照，旧返回快照会留下 `running`。

- [x] **Step 3: 最小实现**

  把无 `deepSeekRun` 的同工作区终态处理从仅 `waiting` 扩展到本地 `running` 反馈；不改变取消、失败或 DeepSeek 请求本身。只允许主进程无运行检查点的权威快照结束反馈。

- [x] **Step 4: GREEN 与回归**

  运行上面的单测和：`npm test -- --run src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [x] **Step 5: 账本证据**

  记录代码位置、RED/GREEN 结果、Electron 只读截图或无法复现的条件；注明没有触发 DeepSeek 或 B 站写入。

### Task 2: B 站确认同步的准备与执行响应性（I001 / R001）

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`（仅当快照回传需要受控摘要或调度）
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`（仅当渲染器改动）
- Modify: `docs/项目功能项目书.md` §5.8
- Modify: `docs/requirement-ledgers/2026-08-22-organize-favorites-bilibili-save-responsiveness.md`

- [x] **Step 1: 写红灯测试**

  用多批次、两千条以上分类的真实本地工作区，调用 `beginBilibiliExecution()`；用提交计数或可替换的本地提交边界断言同一点击只执行一次完整本地结果提交，并在后台远端写入前返回已持久化的 `executing` 快照。

- [x] **Step 2: 确认 RED**

  运行：`npm test -- --run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "commits the complete local result once before starting a Bilibili run"`

  预期：失败，当前 `beginBilibiliExecution()` 与 `freezeForBilibiliExecution()` 连续调用完整本地结果提交。

- [x] **Step 3: 最小实现**

  删除入口层的重复完整提交，保留 `freezeForBilibiliExecution()` 的本地先保存边界；维持冻结、绑定、计划、检查点、未知结果、暂停和恢复语义。若大批量循环仍有同步复制热点，按有界批次在不改变顺序的条件下让出事件循环。

- [x] **Step 4: GREEN 与回归**

  运行单测和：`npm test -- --run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteRepositorySyncService.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [ ] **Step 5: Electron 本地模拟验收与账本证据（部分完成）**

  只使用本地模拟长计划或暂停态只读检查；不点击真实保存、创建、绑定、删除、移动或视频写入。记录截图、鼠标移动/滚动/窗口操作结果与仍未验证的真实远端副作用。

### Task 3: 合并前核对

**Files:**
- Modify: 两份本轮需求账本的索引证据

- [x] **Step 1: 逐条复读 R001/R002 与两份 I001**

  确认 DeepSeek 终态和 B 站响应性各自都有独立代码位置、自动化测试和 Electron 证据或明确缺口。

- [x] **Step 2: 验证（聚焦回归、构建与空白检查通过；完整套件有独立时序失败，见两份账本）**

  运行：`git diff --check`、相关 Vitest、`npm test`、`npm run build`、`git diff --stat`、`git status --short`。

- [ ] **Step 3: 选择性提交（待最终暂存检查后执行）**

  仅暂存本计划、两份账本、项目书对应 hunk 与本主题代码/测试；不得混入现有恢复、规则配置、删除确认、转写、备册或视频同步改动。

# 整理草稿重开静默检查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 正常关闭整理时先持久化暂停状态，重开时静默完成核验并只显示三个恢复动作，同时保持异常退出和 B 站结果未知的保护。

**Architecture:** 渲染进程只在权威恢复摘要可用后打开恢复选择窗，因此移除准备阶段的可见模态框。正常关闭复用现有主进程恢复准备 IPC；扫描和 DeepSeek 服务识别已暂停的持久化检查点，避免正常重开重复写入。异常退出继续走同一后台准备路径，协调器已有的结果未知摘要和对账限制不改动。

**Tech Stack:** Electron main/preload IPC、React、TypeScript、Vitest、Testing Library。

---

## 文件职责与范围

- `docs/项目功能项目书.md`：固定关闭、重开和异常退出的用户可见契约。
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`：静默等待恢复摘要；正常关闭前调用恢复准备。
- `electron/main/oldFavoriteWorkspaceScanService.ts`：已暂停扫描不重复发布暂停标记。
- `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`：已暂停的全轮 DeepSeek 检查点不重复写入。
- 相同目录的三个测试文件：分别保护 UI 与两个服务的边界。
- `docs/requirement-ledgers/2026-08-18-recovery-reentry-silent-check.md`：回填逐项实现与验证证据。

### Task 1: 固定文档契约

**Files:**
- Modify: `docs/项目功能项目书.md:5.1`
- Modify: `docs/requirement-ledgers/2026-08-18-recovery-reentry-silent-check.md`

- [x] **Step 1: 写入项目书的用户可见规则**

将 5.1 明确为：关闭整理先后台安全暂停和持久化；正常重开不显示“正在暂停并保存进度…”；异常退出只根据持久化检查点核验，B 站结果未知仍须对账。

- [x] **Step 2: 核对账本 I001–I003 的目标均能映射到后续任务**

检查 I001 对应 Task 2，I002 对应 Task 2–4，I003 对应 Task 2 与现有协调器保护；不要新增远端写入或改变恢复三按钮。

### Task 2: 恢复入口无可见过渡窗（TDD）

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx:1330-1395`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:541-596,828-830`

- [x] **Step 1: 写失败的 UI 测试**

把既有延迟 `prepareOldFavoriteWorkspaceRecoveryV1` 测试改为：点击 `整理收藏` 后断言准备 IPC 已被调用，但 `正在暂停并保存进度…` 和名为 `整理收藏` 的对话框均不存在；解析 promise 后断言直接出现 `恢复草稿`、`重新扫描`、`放弃本轮整理`。

- [x] **Step 2: 验证测试以现有过渡窗失败**

运行：`npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "shows recovery choices only after the silent background preparation completes"`

预期：失败信息指出不应存在的 `正在暂停并保存进度…` 仍被渲染。

- [x] **Step 3: 最小实现**

保留 `recoveryPreparing` 作为按钮防重复和请求版本守卫；从 JSX 删除仅在 `resumeDialogOpen && recoveryPreparing` 时渲染的 `OldFavoriteModal`。恢复准备失败窗和摘要三按钮窗保持原状，保证摘要未就绪时没有错误地提前展示旧选择。

- [x] **Step 4: 验证通过**

再次运行同一命令，预期通过；确认 `prepareRecovery` 不会启动扫描、标签补取、DeepSeek 或同步的既有 mock 约束仍在。

### Task 3: 正常关闭先暂停，成功才隐藏（TDD）

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx:704-736`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:696-713,OldFavoriteGuide props`

- [x] **Step 1: 写失败的关闭测试**

设置 `prepareOldFavoriteWorkspaceRecoveryV1` 为延迟 promise，打开预览页的“结束本轮整理”确认窗并点击 `关闭整理`；断言 IPC 已调用且向导在 promise 结束前仍可见。解析成功后断言向导关闭；拒绝时断言向导仍在并显示错误。

- [x] **Step 2: 验证测试以即时关闭失败**

运行：`npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "pauses and persists a preview draft before closing the guide"`

预期：失败信息显示尚未调用恢复准备或向导过早消失。

- [x] **Step 3: 最小实现**

新增异步 `closeCurrentWorkspace`：使用 `recoveryPreparing` 防止重复关闭，调用 `workspace.prepareRecovery()`，成功才调用既有 `closeGuide()`；失败时保留向导并写入本地错误状态。只把 `OldFavoriteGuide` 的 `onCloseCurrentWorkspace` 改为该处理器；完成确认、放弃草稿、恢复窗取消仍调用纯 UI 的 `closeGuide()`。

- [x] **Step 4: 验证通过**

运行 Task 3 的定向测试和整个 `ControlledFavoriteLedgerPanel.test.tsx`，预期通过。

### Task 4: 已暂停检查点不重复写入（TDD）

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceScanService.test.ts:692-710`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts:335-341`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts:145-164`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts:621-639`

- [x] **Step 1: 写扫描服务失败测试**

构造 `status: 'scanning'` 且 `scan.paused: true` 的权威快照，调用 `pauseForRecovery('100')`，断言 `coordinator.pauseScan` 从不调用且返回原快照。

- [x] **Step 2: 验证扫描测试失败**

运行：`npm test -- electron/main/oldFavoriteWorkspaceScanService.test.ts -t "does not republish an already paused scan during recovery"`

预期：失败信息显示 `pauseScan` 被调用一次。

- [x] **Step 3: 最小扫描实现并验证通过**

将分支收窄为 `current.status === 'scanning' && !current.scan.paused`，随后再次运行同一命令并预期通过。

- [x] **Step 4: 写 DeepSeek 服务失败测试**

让 `getDeepSeekRunCheckpoint` 返回 `scope: 'all'`、`paused: true`、`canceled: false`、`failed: false` 的检查点；调用 `pauseForRecovery('100')`，断言 `setDeepSeekRunCheckpoint` 不调用。

- [x] **Step 5: 验证 DeepSeek 测试失败**

运行：`npm test -- electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts -t "does not rewrite an already paused whole-run checkpoint during recovery"`

预期：失败信息显示持久化 setter 被调用。

- [x] **Step 6: 最小 DeepSeek 实现并验证通过**

在读取到全轮检查点后，若 `checkpoint.paused` 为真直接返回成功；仅未暂停的异常恢复检查点写入 `{ paused: true, canceled: false }`。再次运行同一命令并预期通过。

### Task 5: 回归、账本与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-18-recovery-reentry-silent-check.md`

- [x] **Step 1: 运行定向与关联回归**

运行三个修改后的测试文件，确保恢复三按钮、正常关闭、扫描暂停和 DeepSeek 暂停都通过；同时运行恢复 IPC 相关测试以确认异常退出的结果未知保护未被替换。

- [x] **Step 2: 运行全量验证**

运行 `npm test`、`npm run build`、`git diff --check`，并记录真实输出。实际 Electron 手工验收需确认鼠标移动、点击、滚动、缩放、最小化和关闭；若本轮无法在隔离数据目录完成，不得声称性能已经验收。

- [x] **Step 3: 逐项回填账本**

为 I001–I003 写入实际代码位置、各自定向测试、全量测试/构建、真实 UI 验收或待界面复核。异常退出的保护只记录现有协调器/恢复摘要的回归证据，不宣称模拟了真实崩溃。

- [x] **Step 4: 创建单个本地提交**

确认 `git status --short` 只包含本轮文件、`git diff --stat` 和 `git diff --check` 无异常后，创建消息为 `fix: silently prepare favorite draft recovery` 的单个本地提交。

只创建本地 `main` 提交；不推送、不合并、不触碰真实 B 站数据。

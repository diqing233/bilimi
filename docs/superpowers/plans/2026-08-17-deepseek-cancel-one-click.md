# DeepSeek 一次点击取消 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DeepSeek 本轮多批整理第一次点击“取消整理”后，IPC 只能返回已取消终态快照，界面无需第二次点击即可恢复“开始整理”。

**Architecture:** `OldFavoriteWorkspaceDeepSeekService` 的活动运行记录既表示请求仍在执行，也表示取消命令尚不能读取最终快照。服务必须先让在途请求收束并持久化取消检查点，再移除活动运行记录；IPC 因此只能在协调器投影为 `deepSeekRun.status === 'canceled'` 后返回。渲染器保留现有“正在取消”禁用态，避免新增第二份状态来源。

**Tech Stack:** TypeScript、Electron IPC、React、Vitest。

---

## 需求对账

### 已确认（按原文顺序）

1. `R001, R002`：DeepSeek 整理中第一次点击`取消整理`必须完成取消，不能需要第二次点击；已完成结果保留、在途请求停止、后续批不再开始、最终显示`开始整理`。
2. `R003`：先把本轮最终状态写入项目书，再实施服务和测试修改。

### 待用户决定

- `R001` 中“采用当前标签/确认执行置灰”的独立问题不在本计划范围内；本轮不改变它的实现。

### 被明确替代

- 无。

### 明确不做

- 不改 DeepSeek 范围、重试策略、分类算法、B 站同步、收藏库保存或界面布局。

## 文件职责与允许修改范围

- `docs/项目功能项目书.md`：定义一次点击取消的最终产品契约。
- `docs/requirement-ledgers/2026-08-17-deepseek-cancel-second-click.md`：记录每项实现位置与验收证据。
- `docs/superpowers/plans/2026-08-17-deepseek-cancel-one-click.md`：本轮实施步骤与范围。
- `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`：取消后活动运行记录与检查点落盘的先后顺序。
- `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`：复现取消命令过早完成的竞态回归。

### Task 1: 写多批取消的竞态红灯

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [x] **Step 1: 在 `describe('OldFavoriteWorkspaceDeepSeekService')` 中新增失败用例**

  使用两个 ready 分段。让第一个分段完成后的常规 checkpoint 暂停，使取消恰好发生在“上一批已完成、下一批尚未开始”的间隙；释放该 checkpoint 后，服务会在下一轮循环入口读到取消。让随后的 `checkpoint.canceled === true` 写入再等待一个 deferred promise。开始 `organizeAllSegments('100')`，在第一个分段完成 checkpoint 暂停时调用 `cancelPendingAllSegments('100')`，释放前者并等待取消 checkpoint 开始落盘，再断言取消 promise 尚未完成：

  ```ts
  const cancellation = service.cancelPendingAllSegments('100')
  let settled = false
  void cancellation.then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  releaseCanceledCheckpoint()
  await expect(cancellation).resolves.toBe(true)
  await expect(run).resolves.toMatchObject({ canceled: true })
  ```

  再断言最终 checkpoint 包含 `canceled: true`、成功 AID 只含已经落库的项、待处理 AID 未被伪造为成功。

  另加两条独立红灯：开始调用已使界面显示运行、但服务仍在读取/建立初始检查点时，第一次取消不得被确认后继续发起 provider 请求；取消检查点写入抛错时，`cancelPendingAllSegments` 必须抛出同一失败，不能解析为 `true`。

- [x] **Step 2: 运行红灯**

  Run: `npm test -- --run electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

  Expected: 跨批用例在 `releaseCanceledCheckpoint()` 前发现 `cancelPendingAllSegments` 已完成；启动窗口用例发现 provider 仍被调用；持久化失败用例发现取消 promise 错误解析为成功。其他现有用例继续通过。

### Task 2: 让活动运行覆盖取消检查点的最终落盘

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts:188-327`

- [x] **Step 1: 保持分段恢复的内部 finally，仅延后活动运行清理**

  保留当前 `selectedSegmentId` 恢复逻辑，但从其 `finally` 删除：

  ```ts
  if (this.activeRuns.get(accountMid) === run) this.activeRuns.delete(accountMid)
  ```

  将方法的“循环/恢复、读取 latest、计算等待批、持久化 checkpoint、rememberFailedRun、返回结果”包在外层 `try/finally` 中，在外层 `finally` 执行该删除。这样错误路径仍清理运行记录，正常取消路径则在 `persistCheckpoint(waitingSegmentIds)` 完成后才允许取消命令继续。

  在第一个 `await` 前登记 `ActiveDeepSeekRun`，并在初始化、建计划与初始 checkpoint 后检查其取消标记，保证首次取消阻止 provider 请求。取消检查点持久化失败时，`cancelPendingAllSegments` 必须等待活动运行收束后抛出该错误，不能返回 `true`。

- [x] **Step 2: 运行绿灯**

  Run: `npm test -- --run electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

  Expected: 新用例确认取消 promise 在取消检查点落盘前不完成；启动期取消不会调用 provider；取消检查点失败会同步拒绝取消命令而不会产生未处理拒绝；现有恢复、重试、当前批取消与全批取消用例全部通过。

### Task 3: 对账、质量门槛与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-17-deepseek-cancel-second-click.md`
- Modify: `docs/superpowers/plans/2026-08-17-deepseek-cancel-one-click.md`

- [x] **Step 1: 更新账本证据**

  将 R001/R002 标记为“已实施待验证”，记录实际服务与测试位置、红灯/绿灯命令结果。R001 中“采用当前标签/确认执行置灰”作为待用户决定项保留，不混入本轮取消修复。真实 Electron 验收必须按 R002 三图的顺序：开始整理、第一次点击取消、确认直接显示`开始整理`和已停止反馈；不得进行收藏库保存、同步、备册、删除或其他 B 站写入。

- [x] **Step 2: 执行验证**

  Run: `git diff --check`

  Run: `npm test -- --run electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

  Run: `npm test`

  Run: `npm run build`

  Actual: `git diff --check`、定向服务测试 `51/51`、全量 `npm test` 的 `234/234` 文件 / `3838/3838` 测试和 `npm run build` 都通过。全量测试保留既有 React `act(...)` 与渲染期状态更新警告，未导致失败；真实 Electron 验收仍需安全测试工作区。

- [x] **Step 3: 提交本轮主题**

  Run: `git status --short`

  Run: `git diff --stat --cached`

  Stage exactly:

  ```text
  docs/项目功能项目书.md
  docs/requirement-ledgers/2026-08-17-deepseek-cancel-second-click.md
  docs/superpowers/plans/2026-08-17-deepseek-cancel-one-click.md
  electron/main/oldFavoriteWorkspaceDeepSeekService.ts
  electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts
  ```

  Commit:

  ```text
  fix: make DeepSeek cancellation complete on first click
  ```

## 自查

- R001/R002 都由 Task 1 的竞态红灯、Task 2 的持久化顺序和 Task 3 的界面验收覆盖。
- 活动运行记录始终在异常路径清理；没有新持久化字段、迁移或 B 站副作用。
- 当前批、重试与恢复路径继续使用同一活动运行语义，作为定向回归范围。

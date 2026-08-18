# 未结束整理轮次统一恢复入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任何未结束的整理收藏轮次均能在再次点击“整理收藏”后安全收束，并展示“恢复草稿、重新扫描、放弃本轮整理”三项选择。

**Architecture:** 恢复摘要由主进程持久化工作区标记决定；除真正 `completed` 或镜像损坏状态外，摘要统一返回三项恢复选择。B 站同步计划仍按冻结计划和逐项检查点执行：恢复回到确认执行页，重新扫描/放弃只结束本轮，不自动反向写 B 站。自动整轮执行的“领取计划”只持久化本地边界，不能被远端操作仲裁队列卡住，保证恢复屏障能继续暂停同步并返回摘要。

**Tech Stack:** TypeScript、Electron 主进程、React、Vitest。

---

### Task 1: 更新产品契约与本轮审计资料

**Files:**
- Modify: `docs/项目功能项目书.md:204-212`
- Modify: `docs/requirement-ledgers/2026-08-18-recovery-preparation-never-settles.md`
- Create: `docs/superpowers/plans/2026-08-18-unfinished-round-unified-recovery.md`

- [x] **Step 1: 将“普通草稿”改为“未结束轮次”**

写明扫描、标签补取、DeepSeek、预览、冻结、同步中、同步暂停与结果待核对均会显示三项恢复操作；恢复同步轮次回到同步进度页，保留已完成数；重扫/放弃不自动回滚 B 站。

- [x] **Step 2: 记录 R001–R003 的实现范围与安全边界**

账本索引应保持用户原文，说明冻结计划不再排除三项入口、实际远端写入不自动回滚、结果待核对的恢复仍必须先对账。

### Task 2: 用主进程回归测试定义未结束轮次的恢复摘要

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:9832-9855, 10230-10258`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:3280-3429`

- [x] **Step 1: 写出失败测试：冻结计划仍返回三项恢复选择**

将既有冻结计划断言改为：

```ts
await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
  status: 'frozen',
  recoveryChoices: ['recover-draft', 'rescan', 'abandon']
})
```

并为 `currentStep: 'result-unknown'` 的未完成标记断言同一组三项选择和保留的 `resultUnknownEvidence`。

- [x] **Step 2: 运行失败测试**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: 现有实现失败，显示冻结计划仅返回 `['view']`、结果待核对仅返回查看/对账选择。

- [x] **Step 3: 最小实现统一摘要与决策守卫**

`getRecoverySummaryUnsafe` 的决策应只把真正完成轮次设为只读：

```ts
const recoveryChoices = marker.status === 'completed'
  ? ['view'] as const
  : ['recover-draft', 'rescan', 'abandon'] as const
```

保留 `resultUnknownEvidence`；移除只因 `currentStep === 'result-unknown'` 而拒绝恢复决策的早退。恢复该状态只打开确认执行页，由既有对账控件阻止继续写入；重扫/放弃不触发自动回滚。

- [x] **Step 4: 运行主进程测试确认变绿**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS。

### Task 3: 让恢复安全屏障不被本地“领取计划”堵住

**Files:**
- Modify: `electron/main/favoriteRepositorySyncService.test.ts`
- Modify: `electron/main/favoriteRepositorySyncService.ts:291-306`

- [x] **Step 1: 写出失败测试：领取冻结计划不进入远端操作仲裁器**

构造其`run`会立即失败的`remoteOperations`与 `frozen` 工作区；断言本地领取仍返回`running`、不调用远端仲裁器，并把工作区持久化为`executing`：

```ts
await expect(service.claimFrozenPlan('100', frozenPlan)).resolves.toMatchObject({ status: 'running' })
await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'executing' } })
```

- [x] **Step 2: 运行失败测试**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts`

Expected: FAIL；当前 `claimFrozenPlan` 经 `runRemote` 调用了测试桩并拒绝。

- [x] **Step 3: 只让本地领取使用本计划锁**

把 `claimFrozenPlan` 保留为 `withRunLock(account, plan.id, ...)`，移除外层 `this.runRemote(account, ...)`。领取只改本地仓库状态，不绑定页面、不读取或写入 B 站；真实执行仍保留在 `executeFrozenPlan` 的远端仲裁器内。

- [x] **Step 4: 确认既有恢复编排可以穿过本地领取边界**

不修改 `electron/main/index.ts`：`prepareRecovery` 仍会在执行意图完成后读取权威快照并调用 `pauseBilibiliSync`。本地领取不再进入远端仲裁器后，整轮意图可以迅速交回控制权，现有编排即可抵达暂停检查点与恢复摘要；真实远端执行仍保留在 `executeFrozenPlan` 的远端仲裁器内。

- [x] **Step 5: 运行同步服务与受影响协调器测试**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS。

### Task 4: 验证三项按钮与恢复进度页

**Files:**
- Verify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [x] **Step 1: 确认渲染器已按恢复摘要渲染三项按钮**

`ControlledFavoriteLedgerPanel` 已根据 `recoveryChoices` 逐项渲染`恢复草稿`、`重新扫描`、`放弃本轮整理`，没有把冻结、暂停或结果待核对写死在渲染器中。缺失的主进程摘要契约已由 Task 2 的红绿测试覆盖；不新增一个只 mock 三项摘要、且在旧实现也能通过的无效“红灯”测试。

- [x] **Step 2: 运行定向 UI 回归**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

Expected: PASS。

### Task 5: 全量验证、开发版界面验收与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-18-recovery-preparation-never-settles.md`

- [x] **Step 1: 运行完整自动化验证与构建**

Run: `npm test`，随后 `npm run build`。

Expected: 两项均以退出码 0 完成。

- [ ] **Step 2: Electron 开发版验证**

在隔离的临时开发配置中验证：点击整理收藏时恢复准备不会无限显示“正在暂停并保存进度…”，冻结/已暂停同步轮次显示三项按钮；选择恢复后显示确认执行同步进度，已完成数与继续同步/结束本轮整理按钮保持可用。确认鼠标移动、点击、滚动、窗口缩放、最小化和关闭均流畅；不在用户真实 B 站页面执行恢复、重扫、放弃或同步。

- [x] **Step 3: 回读账本并记录证据**

将每个 I001/I002 的具体代码位置、定向测试、全量测试、构建和真实界面验收结果写回索引表；不能把未验证项标为已完成。

- [x] **Step 4: 提交本轮单一改动**

Run: `git diff --check`、`git status --short`，确认仅包含本轮项目书、账本、实施计划、测试和恢复实现后：

```powershell
git add docs/项目功能项目书.md docs/requirement-ledgers/2026-08-18-recovery-preparation-never-settles.md docs/superpowers/plans/2026-08-18-unfinished-round-unified-recovery.md electron/main/favoriteRepositorySyncService.ts electron/main/favoriteRepositorySyncService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts
git commit -m "fix: recover every unfinished favorite organization round"
```

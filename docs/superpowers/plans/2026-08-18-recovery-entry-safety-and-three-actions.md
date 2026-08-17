# 恢复入口安全屏障与三操作模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“整理收藏”仅对普通可恢复草稿显示固定的恢复草稿、重新扫描、放弃本轮整理三个操作，并在显示前安全暂停全部会继续改变本轮事实或远端结果的任务。

**Architecture:** 读取恢复摘要保持纯只读；新增单独的主进程恢复准备入口，在顶层编排扫描、标签、DeepSeek、执行意图与 B 站同步的安全暂停，再返回新的权威恢复摘要。普通恢复选择在主进程仍使用内部 `merge-latest` 决策以按当前事实重算系统分类，渲染器只暴露一个“恢复草稿”按钮。

**Tech Stack:** Electron main/preload IPC、TypeScript、React、Vitest。

---

## 文件边界

- `docs/项目功能项目书.md`：恢复入口的最终产品行为。
- `docs/requirement-ledgers/2026-08-18-recovery-only-original-draft-choice.md`：本轮原文、索引和验收证据。
- `electron/main/oldFavoriteWorkspaceScanService.ts`：账户级扫描/标签暂停并等待在途读取收束。
- `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`：DeepSeek 暂停检查点，不把暂停写成取消。
- `electron/main/oldFavoriteWorkspaceCoordinator.ts`：恢复摘要三操作投影、恢复内部决策和执行意图暂停边界。
- `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`、`electron/main/index.ts`：恢复准备 IPC 与跨服务编排。
- `src/shared/oldFavoriteWorkspace.ts`、`electron/preload/index.ts`、`src/renderer/src/global.d.ts`、`src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`：跨进程类型与受控调用。
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`：恢复过渡、三操作弹窗、无草稿直达扫描和专属异常入口。
- 相关 `*.test.ts` / `*.test.tsx`：主进程、IPC、服务与渲染器回归。

### Task 1: 固化恢复产品契约和主进程摘要测试

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`

- [x] **Step 1: 写入失败测试，普通草稿不再投影旧的双恢复模型。**

```ts
await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
  recoveryChoices: ['recover-draft', 'rescan', 'abandon']
})
```

同时覆盖基线未变与已变；二者都只给该三个用户选项，`result-unknown` 与 `rebuild-required` 保持专属选项。

- [x] **Step 2: 运行该测试并确认因旧 `continue-original` / `merge-latest` 投影失败。**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: 新断言失败，现有恢复测试仍指出旧选项名称。

- [x] **Step 3: 最小实现共享恢复选项类型与摘要投影。**

```ts
export type OldFavoriteWorkspaceRecoveryChoice =
  | 'recover-draft' | 'rescan' | 'abandon' | 'reconcile-result-unknown' | 'view'
```

普通、可恢复草稿固定投影 `recover-draft`、`rescan`、`abandon`；内部恢复仍由带版本保护的决策 API 选择 `merge-latest`。

- [x] **Step 4: 重新运行主进程恢复测试。**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: 测试通过，人工分类保留与异常路径断言不回归。

### Task 2: 先为扫描、标签与 DeepSeek 写安全暂停测试

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceScanService.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`

- [x] **Step 1: 写入失败测试，暂停扫描/标签会阻止下一次读取并等待当前读取结束。**

```ts
const pausing = service.pauseForRecovery('100')
await expect(pausing).not.toHaveResolved()
resolveActiveRead()
await expect(pausing).resolves.toMatchObject({ tagEnrichment: { status: 'paused' } })
expect(readNextItem).not.toHaveBeenCalled()
```

- [x] **Step 2: 写入失败测试，DeepSeek 暂停等待当前请求成功落库，写入 `paused: true` 检查点且不写 `canceled: true`。**

```ts
await service.pauseForRecovery('100')
expect(setDeepSeekRunCheckpoint).toHaveBeenLastCalledWith('100', expect.objectContaining({
  paused: true, canceled: false
}))
```

- [x] **Step 3: 运行两组测试，确认新增 API 尚不存在而失败。**

Run: `npm test -- electron/main/oldFavoriteWorkspaceScanService.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

Expected: 失败原因是 `pauseForRecovery` 缺失或检查点没有暂停状态。

- [x] **Step 4: 最小实现账户级暂停。**

扫描服务撤销本账户内存租约、持久化暂停、等待对应运行收束；标签服务撤销领取权、等待当前标签读取收束。DeepSeek 在当前请求完成后退出循环，持久化 `paused` 检查点，自动续跑只忽略该暂停检查点，用户显式再次整理时才解除 `paused`。

- [x] **Step 5: 重新运行服务测试。**

Run: `npm test -- electron/main/oldFavoriteWorkspaceScanService.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

Expected: 所有测试通过；取消和破坏性维护语义保持原样。

### Task 3: 恢复准备 IPC 和同步/执行意图编排

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: 写入失败 IPC 测试，摘要读取无副作用，准备入口才依次调用暂停编排。**

```ts
await ipcMain.invoke('old-favorite-workspace-v1:recovery-summary', 7, '100')
expect(prepareRecovery).not.toHaveBeenCalled()
await ipcMain.invoke('old-favorite-workspace-v1:prepare-recovery', 7, '100')
expect(prepareRecovery).toHaveBeenCalledWith('100')
```

- [x] **Step 2: 写入失败编排测试，执行中同步等待当前远端请求并进入持久化 `sync-paused`，不重复远端操作。**

```ts
await prepareRecovery('100')
expect(pauseFrozenPlan).toHaveBeenCalledWith('100')
expect(summary.recoveryChoices).toEqual(['recover-draft', 'rescan', 'abandon'])
```

- [x] **Step 3: 运行主进程和 IPC 测试确认失败。**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: `prepare-recovery` 未注册，或暂停编排/三操作断言失败。

- [x] **Step 4: 最小实现独立恢复准备入口。**

`recovery-summary` 保持只读。`prepare-recovery` 仅接受可信的当前账号、按快照状态暂停扫描或标签、调用 DeepSeek 暂停、保留等待中的执行意图、对真实执行中的 B 站计划调用现有 `pauseFrozenPlan`，然后读取并返回新的恢复摘要。任何暂停异常必须拒绝请求而非返回伪造摘要。

- [x] **Step 5: 重新运行主进程和 IPC 测试。**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: 读摘要无副作用、准备入口有序暂停、同步不会重复执行、异常路径保留专属恢复状态。

### Task 4: 暴露受控 API 并先修复渲染器交互测试

**Files:**
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`

- [x] **Step 1: 写入失败渲染器测试。**

```tsx
await user.click(screen.getByRole('button', { name: '整理收藏' }))
expect(screen.getByText('正在暂停并保存进度…')).toBeVisible()
await screen.findByRole('button', { name: '恢复草稿' })
expect(screen.getAllByRole('button', { name: /恢复草稿|重新扫描|放弃本轮整理/ })).toHaveLength(3)
```

还要覆盖无草稿直接调用扫描、基线变化仍只有一个恢复按钮、`result-unknown` 显示检查同步结果而非三个按钮。

- [x] **Step 2: 运行渲染器测试确认因旧按钮/旧 API 失败。**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: 找不到过渡文案或新按钮，或错误显示旧的“继续上次整理”弹窗。

- [x] **Step 3: 最小实现预加载、hook 和弹窗。**

预加载只公开 `prepareOldFavoriteWorkspaceRecoveryV1(accountMid)`；hook 返回该调用。面板等待该调用期间只显示不可操作的过渡；普通草稿固定按顺序显示三个按钮。`恢复草稿`内部发送 `merge-latest`，`重新扫描`继续使用现有明确重扫确认，`放弃本轮整理`保留现有安全检查。移除无摘要时的旧“继续上次整理/全部重新整理”弹窗分支；无草稿直接开始增量扫描。

- [x] **Step 4: 重新运行渲染器测试。**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: 新弹窗顺序、过渡、无草稿直达和异常专属路径全部通过。

### Task 5: 文档核对、完整验证与 Electron 验收

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-18-recovery-only-original-draft-choice.md`

- [x] **Step 1: 回读 R001-R004，更新逐项索引的代码位置、自动化测试、界面验收和未验证条件。**

- [x] **Step 2: 运行静态与自动化验证。**

Run: `npm test`

Expected: exit 0。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 3: 在 Electron 开发版进行账户安全的模拟验收。**

确认：普通草稿显示三按钮和“正在暂停并保存进度”；无草稿直接扫描；标签/DeepSeek/同步暂停后不自动继续；鼠标移动、点击、滚动、窗口缩放、最小化、恢复和关闭均可响应；不触发真实 B 站写入。

- [x] **Step 4: 在提交前运行工作树检查。**

Run: `git diff --check`

Run: `git diff --stat`

Run: `git status --short`

Expected: 只有本轮代码、测试、项目书、计划和需求账本改动；无空白错误。

# 收藏整理批次与应用内清空恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 稳定多批标签顺序和统计口径，并让全部清除在不退出应用的情况下安全退出 B 站登录和重建空服务。

**Architecture:** 批次顺序由工作区持久化段唯一决定，标签服务只消费最早仍有待补取项的段。扫描 UI 从工作区快照投影当前批和本轮两套统计。主进程清空使用可恢复维护生命周期，完成后重建依赖服务并广播运行时重置。

**Tech Stack:** Electron、React、TypeScript、Vitest、electron-vite。

---

### Task 1: 稳定标签批次队列

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceScanService.test.ts`

- [ ] 添加失败测试：乱序 AID 的多个批次始终先返回第 1 批待补取项，第一批完成后才返回第二批。
- [ ] 添加失败测试：协调器重建后仍按持久化批次顺序继续。
- [ ] 修改 `getPendingTagEnrichmentAids`，按 `segment.index` 和段内冻结顺序过滤待补取项，不使用全局 AID 顺序决定跨批顺序。
- [ ] 运行上述两个测试文件并确认通过。

### Task 2: 当前批次与本轮统计投影

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

- [ ] 添加失败测试：快照包含每批沿用、获取、无标签、失败和待整理统计。
- [ ] 添加失败测试：当前批次视角显示“本批待整理”和本批标签结果，本轮总览显示本轮汇总。
- [ ] 在主进程从段 AID、视频标签证据和补取日志生成紧凑段统计。
- [ ] 让扫描概览的统计卡和来源表标题跟随视角切换。
- [ ] 运行协调器和扫描概览测试并确认通过。

### Task 3: 应用内全部清除生命周期

**Files:**
- Modify: `electron/main/localDataService.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/localDataIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `electron/main/localDataService.test.ts`
- Test: `electron/main/localDataIpc.test.ts`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] 添加失败测试：全部清除调用停止任务和退出登录，但不调用退出应用。
- [ ] 添加失败测试：清空后重建空服务、解除维护围栏并广播运行时重置。
- [ ] 添加失败测试：设置页清空后显示空本地数据，而非“服务暂不可用”；掌库清除账号投影。
- [ ] 将清理实现改为受控低并发删除，并在批次间让出事件循环。
- [ ] 增加主进程重建钩子和完成事件；渲染器收到后清空快照缓存并重新读取空服务。
- [ ] 运行本地数据和助手测试并确认通过。

### Task 4: 回归与真实 Electron 验收

**Files:**
- Store evidence: `.codex-artifacts/`

- [ ] 运行收藏工作区、掌库、收藏库和本地数据相关 Vitest 回归。
- [ ] 运行 `npx electron-vite build`。
- [ ] 使用隔离测试数据触发应用内清空，确认不触碰真实用户数据和真实 B 站写入。
- [ ] 清空期间实测鼠标移动、点击、滚动、拖动、缩放、最小化、恢复和关闭。
- [ ] 验证清空后应用仍运行、B 站已退出、设置页为空服务、重新登录后整理收藏恢复。
- [ ] 运行 `git status --short --branch`、`git diff --stat`、`git diff --check`，检查无关文件。

### Task 5: 单账号清除登录生命周期

**Files:**
- Modify: `electron/main/localDataIpc.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `electron/main/localDataIpc.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `src/renderer/src/features/assistant/LocalDataSettings.test.tsx`

- [ ] 写失败测试：删除当前登录 UID 时调用当前账号删除生命周期；删除其他 UID 时不调用。
- [ ] 写失败测试：账号删除通知必须等待生命周期完成，失败时执行维护恢复。
- [ ] 增加账号级工作区缓存清理入口，并在删除成功后清理转写队列和收藏工作区运行时投影。
- [ ] 当前账号删除期间围住活动任务和远程操作，清 Cookie 后等待 B 站访客页刷新，再广播 `local-data:reset` 与 `bilibili:account-changed`。
- [ ] 历史账号删除继续只更新本地账号列表和收藏库投影，不触碰当前登录会话。
- [ ] 运行单账号、本地数据、助手账号变化相关回归测试并进行隔离 Electron 验收。

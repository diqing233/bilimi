# 推荐收藏夹采用快照顺序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让推荐收藏夹首次勾选后直接显示该次权威分类结果，且保存推荐草稿触发的旧后台读取永远不能覆盖该结果。

**Architecture:** 主进程推荐采用交易已在同一个事务中重分类并返回权威工作区快照；本轮只为渲染器后台读取增加轻量失效代次。每次推荐选择变化和每个有效采用响应都会取消此前开始的保留快照刷新；不触碰分类算法、不增加全轮同步扫描，也不改变上方规则、推荐草稿取消、历史、备册或 B 站执行路径。

**Tech Stack:** Electron IPC、React 18 Hooks / `startTransition`、Vitest、Testing Library。

---

## 已确认需求与范围

- I001（R001）：下方推荐首次勾选后立即显示该规则真实“适合”数及归档投影；不得要求上方取消再重勾选。
- 不改：上方取消仅退出参与、下方取消删除纯推荐草稿、稳定规则 ID 联动、历史恢复、备册/同步、DeepSeek、转写、删除确认、视频写入。
- 性能：所有失效只是 ref 自增和普通 React 状态切换；禁止在点击处理器同步遍历视频。

## 文件结构

- 修改 `docs/项目功能项目书.md`：在 §5.5 的推荐采用快照一致性规则中加入“并行草稿保存 / 后台刷新”的失效与采纳顺序。
- 修改 `docs/requirement-ledgers/2026-08-28-recommended-selection-immediate-classification.md`：记录实现、RED/GREEN 结果和 Electron 验收边界。
- 修改 `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`：使推荐选择操作失效其间已启动的 `refresh(true)` 结果。
- 修改 `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`：用受控 promise 固定复现“采用新快照先返回，旧后台读取后返回”的顺序。

### Task 1: 书面契约与回归用例（RED）

**Files:**

- Modify: `docs/项目功能项目书.md:372`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx:519-541`

- [x] **Step 1: 在项目书写入并行刷新约束**

  在“归档统计的快照一致性”段追加：推荐采用与本地草稿持久化可并行，但采用响应发布后必须失效该操作前开始的后台读取；后台读取只有在账号、工作区和读取开始时的操作代次仍有效时才可替换快照。

- [x] **Step 2: 写失败测试**

  在 hook 测试中增加：第一次 `openOldFavoriteWorkspaceV1` 返回 `before`；第二次（`refresh(true)`）返回 `staleOpen.promise`；`set-recommended-candidates` 返回 `adopted`。先发推荐选择，再开始后台刷新；先 resolve `adopted` 并断言快照含 `adoptedCandidateIds: ['author-a']`，再 resolve `staleOpen`。最终断言仍是 `adopted` 且后台刷新返回 `null`。

  ```ts
  it('does not let an earlier background refresh overwrite a returned recommendation snapshot', async () => {
    const before = recommendationWorkspace()
    const adopted = recommendationWorkspace(['author-a'])
    const staleOpen = deferred<typeof before>()
    // initial open → before; recommendation IPC → adopted; background open → staleOpen
    // setRecommendedCandidates(['author-a']); refresh(true); resolve adopted; resolve staleOpen
    // expect(snapshot).toBe(adopted); await expect(background).resolves.toBeNull()
  })
  ```

- [x] **Step 3: 运行失败测试并确认原因**

  Run: `npm test -- src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx -t "does not let an earlier background refresh overwrite a returned recommendation snapshot"`

  Expected: FAIL；旧 `staleOpen` 成为最终 `snapshot`，证明失败来自旧后台读取覆盖，而非推荐分类器。

### Task 2: 最小代次失效（GREEN）

**Files:**

- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts:785-863`

- [x] **Step 1: 仅加入后台刷新的失效 helper**

  在 hook 内定义 `invalidateBackgroundWorkspaceRefreshes`，执行：

  ```ts
  backgroundRequestVersion.current += 1
  setBackgroundRefreshing(false)
  ```

  不修改 `requestVersion`、`recommendedCandidateIds` 或任何主进程命令参数。

- [x] **Step 2: 在推荐选择开始和有效 IPC 返回后失效旧读取**

  `setRecommendedCandidates()` 将新的期望候选写入 ref 前调用 helper；`runRecommendationQueue()` 每次收到同账号有效的 `next` 后也调用 helper，再按既有“仅最新 desired 才 `startTransition(setSnapshot(next))`”规则发布。这样既阻止采用前已读的刷新，也阻止在推荐执行中开始、但在响应后才完成的旧读取。

- [x] **Step 3: 运行 GREEN 测试**

  Run: `npm test -- src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx -t "does not let an earlier background refresh overwrite a returned recommendation snapshot"`

  Expected: PASS；最终快照始终为 `adopted`，且 `background` 为 `null`。

### Task 3: 受保护回归、验收与提交

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-28-recommended-selection-immediate-classification.md`

- [x] **Step 1: 运行关联回归**

  Run: `npm test -- src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: 0 failures；确认 hook 时序、上下勾选联动与主进程推荐快速重分类均保留。

- [ ] **Step 2: Electron 只读验收（受恢复保护门阻断）**

  用开发版打开已有整理草稿：勾选一个有命中推荐，等待“适合”计数和归档预览更新；不点击备册、创建、绑定、删除或 B 站同步。将截图保存到 `.codex-artifacts/2026-08-28-recommended-selection-snapshot-ordering.png`。在账本写入截图、测试结果和未验证的真实 B 站副作用。

- [x] **Step 3: 最终验证并选择性提交**

  Run: `npm test -- src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`; `npm run build`; `git diff --check`; `git status --short`.

  只暂存本计划的项目书、账本、计划、hook 与测试；绝不暂存 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`。本地提交消息：`fix: keep recommendation classification snapshot current`。

# 采用当前标签结果与执行资格 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使“采用当前标签”在完整本轮重算完成后，以同一权威快照刷新推荐与归档预览，并且只在可安全执行时放开本地保存和 B 站同步按钮。

**Architecture:** 主进程的采用命令是唯一的状态转移点：先在工作区构造标签截止版本和安全暂停候选，完成完整重建推荐和系统分类后一次发布，再返回新的快照；重算失败不得发布候选状态。渲染器只投影该快照；确认区从同一快照的完整本轮采用事实、分类准备度和 DeepSeek 状态计算按钮可用性，不维护第二套前端完成状态。

**Tech Stack:** Electron 主进程 TypeScript、React、Vitest、Testing Library。

---

## 修改范围

- [x] `docs/项目功能项目书.md`：最终产品契约，已先行写明完整结果链。
- [x] `docs/requirement-ledgers/2026-08-17-tag-adoption-result-availability.md`：R001 原文索引及逐项验收证据。
- [x] `electron/main/oldFavoriteWorkspaceCoordinator.ts`、相邻的 `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`：保证采用命令在完整本轮范围重建推荐、分类和准备度后才返回快照。
- [x] `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`、相邻测试：让两个本轮写入按钮使用完整采用事实、完整分类结果和 DeepSeek 状态作为同一资格条件。
- [x] 已检查 `ControlledFavoriteLedgerPanel.tsx`、`OldFavoriteRecommendationStep.tsx`、`OldFavoriteArchivePreviewStep.tsx` 的同一快照投影；相关测试覆盖无需创建前端缓存或触发远端命令。

## Task 1: 建立主进程采用完成态的红灯回归

- [x] **Step 1: 追踪并记录根因证据。**

  完整阅读 `acceptCurrentTags`、`tagEnrichmentSegmentIds`、`hasWholeRunTagCutoffAccepted`、`autoClassifySegmentsUnsafe`、`checkpointInitialSystemClassificationsUnsafe`、推荐重建方法和 `createSnapshot`。记录“接受了哪些批、重算了哪些批、何时写入 `planReadiness`、返回的快照有什么字段”。若现有状态已能完成该行为，则将目标缩小为投影/资格断点，不能凭名称修改。

- [x] **Step 2: 在 `electron/main/oldFavoriteWorkspaceCoordinator.test.ts` 写最小失败测试。**

  构造两批、标签补取仍有待办、两批均有分类输入的工作区；调用 `acceptCurrentTags` 后断言返回快照：

  ```ts
  expect(snapshot.tagEnrichment?.wholeRunTagCutoffAccepted).toBe(true)
  expect(snapshot.tagEnrichment?.status).toBe('accepted')
  expect(snapshot.recommendations.candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: expect.any(String) })
  ]))
  expect(snapshot.planReadiness).toEqual(expect.objectContaining({
    selectedAidCount: expectedSelected,
    classifiedAidCount: expectedClassified
  }))
  expect(snapshot.overview?.archiveTargets).toEqual(expect.arrayContaining([
    expect.objectContaining({ itemCount: expect.any(Number) })
  ]))
  ```

  测试必须断言采用命令本身不调用保存或同步依赖。

- [x] **Step 3: 运行红灯。**

  运行：

  ```powershell
  npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts
  ```

  预期：新用例因采用后的完整分类、推荐、预览投影或准备度缺失而失败；若直接通过，保留输出并把根因转向渲染器，不修改主进程。

- [x] **Step 4: 最小实现。**

  只在根因位置修正 `acceptCurrentTags` 或其下游：采用必须针对完整本轮 segment ID 计算分类，等待检查点持久化，重建推荐并返回包含更新 `planReadiness` 和归档统计的快照。不得让未补取项目变成无标签，不得清除人工分类/已勾选推荐，不得调用收藏库或 B 站写入。

- [x] **Step 5: 运行主进程绿灯。**

  重复 Step 3 的命令，预期所有该文件用例通过。

## Task 2: 建立确认执行资格的红灯回归

- [x] **Step 1: 在 `OldFavoriteConfirmationStep.test.tsx` 写失败测试。**

  传入已完成基础扫描、`tagEnrichment.status: 'accepted'`、`wholeRunTagCutoffAccepted: true`、多批均为 `ready`、完整 `planReadiness`、非空归档总览且无 `deepSeekRun` 的快照，断言：

  ```tsx
  expect(screen.getByRole('button', { name: '保存本轮到收藏库' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeEnabled()
  ```

  另写两个独立反例：标签实际 `running`，以及 DeepSeek `running`；两种快照的两个按钮均为禁用，且理由文本准确说明阻塞来源。

- [x] **Step 2: 运行红灯。**

  运行：

  ```powershell
  npm test -- src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx
  ```

  预期：现状若将已采用的完整结果误判为不可执行，新测试在按钮断言失败；若通过，保留结果并查推荐/预览显示断点。

- [x] **Step 3: 最小实现。**

  将 `OldFavoriteConfirmationStep` 的本轮资格收束为一个明确的派生条件：基础扫描完成、标签不是运行、标签截止版本已接受、完整本轮分类准备度满足，且 DeepSeek 不在运行/取消收束中。两个本轮写入按钮使用同一条件；不改变单批保存、实际确认对话、写入命令或 DeepSeek 逻辑。

- [x] **Step 4: 运行渲染器绿灯。**

  重复 Step 2 的命令，预期全部通过。

## Task 3: 验证推荐与归档预览来自采用后的同一快照

- [x] **Step 1: 确认断点。**

  阅读 `ControlledFavoriteLedgerPanel.tsx` 的步骤装配和 `OldFavoriteRecommendationStep.tsx`、`OldFavoriteArchivePreviewStep.tsx` 的空态/过滤条件，核对是否因 `viewScope`、当前批、`ready/saved` 过滤或旧引用使已采用完整快照不显示。

- [x] **Step 2: 在实际断点的相邻测试写失败用例。**

  使用 Task 1 的已采用完成快照，断言页面存在推荐收藏夹候选与归档预览分类/未匹配区；若页面只应在对应步骤显示，则用同一快照分别渲染这两个步骤。断言不点击任何保存或同步回调。

- [x] **Step 3: 运行红灯，并只修正该投影条件。**

  运行对应测试文件。只修改将同一 `snapshot.recommendations`、`snapshot.classifications`、`snapshot.overview` 投影到页面的条件；不得引入前端二次计算、隐式导航或远端副作用。

- [x] **Step 4: 运行该测试绿灯。**

  预期推荐、归档预览和确认区在同一已采用快照下均可见，并且相反运行状态仍正确禁用确认按钮。

## Task 4: 文档、回归、验收与单次本地提交

- [x] **Step 1: 以 R001 回读项目书与需求账本。**

  更新索引表的实际代码位置、每条自动化测试名、测试工作区界面验收结果与“不触发真实写入”边界。不得修改 R001 原文。

- [x] **Step 2: 执行完整验证。**

  ```powershell
  npm test
  npm run build
  git diff --check
  git status --short
  git diff --stat
  ```

  对受影响整理收藏流程，在隔离测试状态中走“扫描完成 → 采用当前标签 → 推荐 → 预览 → 确认”，并记录截图到 `.codex-artifacts/`；不操作真实账号、DeepSeek、收藏库或 B 站。

- [x] **Step 3: 单次提交。** `e2937947`（`fix: complete tag adoption result chain`）已创建，包含本轮项目书、需求账本、计划、主进程状态链、确认区和投影测试。

  仅当所有验证通过、无无关文件、R001 有逐项证据时：

  ```powershell
  git add docs/项目功能项目书.md docs/requirement-ledgers/2026-08-17-tag-adoption-result-availability.md docs/superpowers/plans/2026-08-17-tag-adoption-result-availability.md electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx
  git commit -m "fix: complete tag adoption result chain"
  ```

  如果根因要求额外的已列范围投影文件，将其追加到本命令；不提交生成物或 `.codex-artifacts/`。

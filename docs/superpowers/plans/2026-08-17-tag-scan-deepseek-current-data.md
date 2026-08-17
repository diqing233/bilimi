# 标签扫描与 DeepSeek 当前工作区实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 让标签按钮资格、保存/同步资格和 DeepSeek 结果始终依据主进程当前工作区事实，避免自然完成时误要求采用、失败重试入口分裂和旧草稿覆盖新数据。

**Architecture:** 标签补取由主进程维护 pending/failed/版本事实，渲染层只投影两个固定按钮；`resume-tag-enrichment` 同时恢复待补取和失败项。保存/同步资格由快照中的真实运行状态、待办计数和分类准备度计算，自然完整标签结果不再制造虚假的采用阻塞。DeepSeek 运行记录每个视频的启动事实指纹，返回时在主进程逐视频比较最新快照，非冲突项应用、冲突项保留当前分类并返回可重试信息；整理卡片和归档预览打开时刷新主进程快照。

**Tech Stack:** Electron main process, React 19 renderer, TypeScript, Vitest, Testing Library.

---

### Task 1: 锁定标签按钮与执行资格的回归测试

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Write failing renderer tests**

覆盖 R001/R002/R003：完整标签结果时“继续补取标签”和“采用当前标签”仍存在但 disabled；失败项存在时继续按钮可点且不渲染独立“重新补取失败标签”；不再渲染“当前标签尚未采用”阻塞文案。

- [x] **Step 2: Run the focused tests and confirm RED**

Run `npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`。
Expected: 现有实现至少因失败项仍渲染独立按钮、自然完整结果的采用资格或旧阻塞文案而失败。

- [x] **Step 3: Write failing coordinator tests**

验证 `resumeTagEnrichment` 将 `pendingAids` 与 `failedAids` 合并入队，且自然完成、pending/failed 为 0 时 `hasWholeRunTagCutoffAccepted` 返回 true；重复 resume 不会重新读取已完成项。

- [x] **Step 4: Run coordinator tests and confirm RED**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "tag enrichment|whole-run tag"`。

### Task 2: 实现统一标签补取状态

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceIpc.ts` (仅若 IPC 类型仍暴露独立失败命令)

- [x] **Step 1: 让渲染层只计算两个固定按钮**

继续按钮资格改为任务未运行且当前批/本轮 `pendingItemCount > 0 || failedItemCount > 0`；采用按钮只在存在新/变化标签版本时启用；移除失败独立按钮、旧“尚未采用”操作说明和重复“已采用”提示，但保留按钮位置与 disabled 状态。

- [x] **Step 2: 将失败恢复并入 resume 命令**

`useOldFavoriteWorkspace` 只发送 `resume-tag-enrichment`；主进程 resume 在队列中把失败项合并到 pending、清空 failed、重置 completed 计数并保存检查点，保留标签结果和人工分类。

- [x] **Step 3: 调整自然完成判定与快照资格**

自然完成且 pending/failed 均为 0、无 accepted version 时视为当前标签截止有效；采用资格不得因自然完成首次结果误启用。快照应公开按 scope 的 failed/pending 计数，供当前批和总览分别投影。

- [x] **Step 4: Run focused tests and full type/build checks for this slice**

Run `npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts` and `npm run build`。

### Task 3: 以当前工作区事实计算保存/同步资格

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx` (仅若其重复计算采用/刷新条件)
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [x] **Step 1: Add failing natural-complete execution test**

给出基础扫描完成、标签 `status=complete`、pending=0、failed=0、无 accepted version、分类已 ready 的快照，断言保存和同步按钮可用，两个标签按钮的 disabled 由扫描概览单独验证。

- [x] **Step 2: Remove synthetic adoption block**

`tagResultReadyForExecution` 只阻塞 running 或仍有 pending/failed/重算中的状态；不再要求 `wholeRunTagCutoffAccepted` 为 true，也不再显示“当前标签尚未采用”文案。DeepSeek running/waiting 继续独立阻塞。

- [x] **Step 3: Verify real blockers remain**

补取运行、待补取/失败项、完整范围重算、DeepSeek 运行时按钮保持 disabled，并显示对应真实原因；执行资格不写收藏库或 B 站。

### Task 4: DeepSeek 逐视频冲突合并与当前快照刷新

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.ts` (若反馈模型需要冲突字段)

- [x] **Step 1: Write failing merge tests**

构造 DeepSeek 请求启动快照后，先修改一个视频分类/来源选择，再返回两条结果；断言未变化视频应用结果，变化视频保留当前分类并返回冲突 aid，而不是抛出整批 workspace changed。另测配置/请求失败仍保留原分类。

- [x] **Step 2: Expose a per-video expectation and conflict result**

主进程提供按 aid 的事实指纹比较（分类 target/source、来源选择、人工/推荐选择和工作区 id）；`applyDeepSeekClassificationBatch` 只应用仍匹配期望的视频，并返回 `appliedAids` 与 `conflictAids`，不覆盖冲突视频。

- [x] **Step 3: Update service feedback and retry path**

DeepSeek service 使用最新快照构造非冲突 assignments；冲突只进入反馈和可重试列表，重试以当前快照重新请求冲突项。区分配置、网络、provider 请求失败与工作区冲突，普通工作区变化不再映射为整批失败。

- [x] **Step 4: Refresh current snapshot when opening organizer/preview**

整理收藏卡片、归档预览和切换批次时调用主进程 refresh/getSnapshot，不优先使用旧 `snapshot` 或 `viewedSnapshot`；只读刷新不触发 B 站扫描且保留当前工作区人工修改。

- [x] **Step 5: Run DeepSeek and preview tests**

Run `npx vitest run electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`。

### Task 5: 账本验收、构建和本地提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-17-tag-scan-deepseek-current-data.md`
- Modify: `docs/项目功能项目书.md`

- [x] **Step 1: Record per-item implementation evidence**

按 R001、R002、R003、R004 分别写入代码位置、自动化测试、真实界面验收结果和仍无法验证的条件；原文区保持不变。

- [ ] **Step 2: Run required verification**

Run focused tests, `npm test`, `npm run build`, `git diff --check`，并在 Electron 开发版实际检查扫描概览按钮、确认执行按钮和归档预览刷新。

- [x] **Step 3: Check scope and commit on local main**

Run `git status --short`, `git diff --stat`，确认只包含本轮账本、项目书、计划和业务代码后执行 `git add ...; git commit -m "fix: align tag adoption and DeepSeek workspace merge"`。不 push、merge 或 rebase。

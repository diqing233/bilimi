# 收藏夹历史恢复勾选投影实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 历史游标恢复到较早的推荐采用记录时，上方收藏夹卡片只显示该游标实际采用的推荐草稿；未来 redo 草稿保留但不显示为当前勾选。

**Architecture:** 主进程的历史快照和 `adoptedCandidateIds` 已是权威来源，不改变 journal、恢复算法或 B 站路径。渲染器上方参与映射对纯 `recommendation-draft` 按当前快照的候选采用集合取值；稳定已保存规则仍沿用既有 `enabled` 与本轮排除集合投影。

**Tech Stack:** Electron 主进程快照、React/TypeScript、Vitest、现有收藏夹工作区 IPC。

---

### Task 1: 固化恢复投影契约

**Files:**

- Modify: `docs/项目功能项目书.md:353-356`
- Modify: `docs/requirement-ledgers/2026-08-28-favorite-history-restored-selection.md`

- [x] **Step 1: 更新项目书**

项目书已明确：规则目录中仍存在的纯 `recommendation-draft`，上方和下方勾选都读取同一历史快照的 `adoptedCandidateIds`；长期 `enabled` 只说明规则仍存在，不能让未来 redo 分支显示为当前已勾选。

- [x] **Step 2: 记录排查证据**

账本 I001 已记录：开发版 journal 的 `honker233` 历史位置只采用 `custom-author-honker233-小王爱马枪~9.2d`；后续 `哈米伦的弄笛者` 保留在 redo 分支。主进程与下方投影正确，上方映射误把长期 `enabled` 当作本轮采用状态。

### Task 2: 为历史恢复后的上方卡片写 RED 回归

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx:232-280`

- [x] **Step 1: 写入失败测试**

建立两个均为 `enabled: true` 的纯推荐草稿 `honker233` 与 `哈米伦的弄笛者`。初始快照采用两者；选择改动记录里的 `honker233` 位置后，mock IPC 返回只采用 `honker233` 的快照。断言 `move-history-cursor` 的 cursor 为 `1`，上方显示 `移出同步 bilimi·honker233`，并显示 `加入同步 bilimi·哈米伦的弄笛者`。

- [x] **Step 2: 运行 RED**

运行 `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "does not keep a future recommendation draft selected in its upper card after restoring history"`。预期失败于 `哈米伦的弄笛者` 仍显示 `移出同步`。

### Task 3: 最小化上方参与映射

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:1468-1488`

- [x] **Step 1: 从当前快照构造草稿采用状态**

对每一项候选，用 `recommendationProjection` 解析稳定 ID。仅当 `isPureRecommendedLocalDraft(ledger)` 为真时，记录 `activeSnapshot.recommendations.adoptedCandidateIds.includes(candidate.id)`。

- [x] **Step 2: 只替换纯推荐草稿的上方默认值**

保留 `organizationSavedLedgerParticipationById` 对在途上方点击的优先级。没有在途值时先读纯草稿采用映射，再读既有 `ledger.enabled && !excludedLedgerIds.includes(id)`。不改变 `onOrganizationSavedLedgerToggle`，使上方取消仍是参与变更而非草稿删除。

- [x] **Step 3: 运行 GREEN**

重新运行 Task 2 的同一命令，预期通过。

### Task 4: 回归、界面验收与交付

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-28-favorite-history-restored-selection.md`

- [x] **Step 1: 运行收藏夹历史聚焦回归**

运行 `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`，确认主进程恢复、redo 保留、上/下投影和上方取消不删除草稿均不回归。

- [ ] **Step 2: Electron 只读验收**

启动开发版，进入 `掌库 → 整理收藏 → 归档预览 → 改动记录`，选择 `honker233` 历史位置后只读核对：`honker233` 勾选、后续 `哈米伦的弄笛者` 未勾选、redo 记录仍存在。不得点击备册、创建、绑定、删除、保存或同步；截图保存至 `.codex-artifacts/`。

未完成：隔离开发版未承载用户的 `honker233` 历史快照；为保护真实用户工作区，未在已登录窗口移动历史游标。该真实界面验收保留为待验证项，不能由测试替代。

- [x] **Step 3: 全量验证与回填**

运行 `npm test`、`npm run build`、`git diff --check`、`git diff --stat`、`git status --short`。在账本 I001 写入代码位置、RED/GREEN、测试、Electron 截图和未验证条件；仅暂存项目书、计划、账本、测试和渲染器文件，并创建一个本地提交。

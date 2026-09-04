# 推荐收藏夹全阶段可操作与二轮联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让推荐来源收藏夹在任何整理阶段都与新建收藏夹同样可勾选、取消和明确删除，并在第二轮整理按稳定 ID恢复上下联动，且不写 B 站。

**Architecture:** 上方规则在非 `guideOpen && previewing` 阶段只通过账号级 `enabled` 写入；整理中的下方候选以精确稳定 ID同步该规则和工作区投影。删除仍是独立本地事务，删除产生的精确远端 ID抑制会贯穿账户恢复与状态投影，滚动保护则覆盖删除后的异步刷新。

**Tech Stack:** Electron main process, React/TypeScript renderer, Vitest, npm build.

---

### Task 1: 更新项目书与可审计需求账本

**Files:**
- Modify: `docs/项目功能项目书.md:690-700,715-727`
- Modify: `docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md`

- [x] **Step 1: 将下方取消语义改为保留已保存推荐规则**

将 §9.4、§9.6 的“下方取消已保存推荐规则即删除”替换为：在账号目录存在同稳定 ID规则时，原子地保存 `enabled=false`、移除候选采用与分类投影；规则保留，详情/删除模式才删除。

- [x] **Step 2: 记录 I016-I019 的替代关系和验收矩阵**

在账本保留 R019-R021 全文，并将 I016 标记为对 I010 的明确替代；验收矩阵必须覆盖非整理、整理、关闭/恢复、第二轮、详情删除、删除模式、远端草稿抑制和滚动。

- [x] **Step 3: 检查文档差异**

Run: `git diff --check -- docs/项目功能项目书.md docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md`

Expected: exit 0.

### Task 2: 先写并观察推荐取消与删除后的失败回归

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts`

- [x] **Step 1: 写下方取消已保存推荐规则的失败用例**

构造 `recommendation-draft`、无远端写入、与下方候选精确同 ID的已保存规则；取消候选后断言 `onSaveLedgerEnabled(id, false)` 被调用、规则仍显示、候选/分类投影取消，且本地删除 IPC 未调用。

- [x] **Step 2: 写第二轮回填与双向联动用例**

构造新轮候选与已保存推荐规则相同稳定 ID；分别令规则 `enabled=true/false`，断言初始候选匹配、下方与上方操作双向同步；同名不同 ID不得联动。

- [x] **Step 3: 写详情/删除模式删除后的异步恢复用例**

模拟 `deleteLocalFavoriteLedgers → workspace.refresh → parent snapshot repaint`，断言已删除规则不会以相同精确 `folderId` 的纯观察草稿显示；不同 `folderId`同名记录保留。

- [x] **Step 4: 写删除滚动锚点的失败用例**

将掌库容器设为非零 `scrollTop`，模拟删除、刷新和两帧重绘；断言位置保持。再派发用户滚动，断言保护不回拉该用户的新位置。

- [x] **Step 5: 运行测试确认 RED**

Run: `npm.cmd test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts --silent`

Expected: 新增用例因现有删除/恢复/滚动实现缺口而失败，且失败断言与目标行为一致。

### Task 3: 实现保存规则取消、二轮 ID联动和删除滚动保护

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [x] **Step 1: 实现已保存推荐候选取消的本地 enabled 路径**

在候选精确对应已保存的推荐来源规则时，先持久化 `enabled=false`，再更新工作区候选采用和分类投影；失败时回滚 UI。详情/删除模式调用现有本地删除而非本路径。

- [x] **Step 2: 以精确稳定 ID实现新轮 hydration**

新轮创建/恢复时仅根据候选 ID与账号目录同 ID推荐规则的当前 enabled 状态填充采用集合；不得按名称、关键词或来源标签兜底。

- [x] **Step 3: 让详情删除与删除模式捕获并恢复右侧滚动锚点**

删除前记录实际掌库滚动容器位置，使用有限 RAF 在删除、刷新和父快照重绘后恢复；监听用户主动滚动并立即让位。不得在输入或渲染同步路径运行循环。

- [x] **Step 4: 运行对应 GREEN 测试**

Run: `npm.cmd test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts --silent`

Expected: 0 failed.

### Task 4: 阻止删除规则被后台恢复为远端观察草稿

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] **Step 1: 写后台账户恢复的失败用例**

删除推荐来源规则后，把其精确 `folderId` 放入账号 pending 抑制集合；模拟 `favorite-repository:open-account` 恢复和状态刷新，断言不写入、不显示 `custom-remote-<folderId>`；同名但不同 folderId继续显示。

- [x] **Step 2: 运行确认 RED**

Run: `npm.cmd test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts --silent`

Expected: 新增恢复路径测试失败，显示恢复入口忽略 pending 或投影未收敛。

- [x] **Step 3: 贯通 pending 抑制并收敛已有纯观察草稿**

向恢复入口传入当前账号的 pending 精确 ID；`saveRecoveredLedgerDrafts` 跳过这些 ID。渲染状态投影只按精确 folderId清理已存在的纯观察草稿，不删除用户配置规则、不同 ID或 B 站远端夹。

- [x] **Step 4: 运行对应 GREEN 测试**

Run: `npm.cmd test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts --silent`

Expected: 0 failed.

### Task 5: 推荐路径 B站零写入与完整验证

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md`

- [x] **Step 1: 添加统一远端写入 spy**

覆盖上方勾选/取消、下方首次采用/取消、详情删除、删除模式删除和刷新；断言 B 站创建、改名、删除、解绑、移动成员和视频同步调用次数均为零。

- [x] **Step 2: 跑推荐定向与全量验证**

Run: `npm.cmd test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts --silent`

Expected: 0 failed.

Run: `npm.cmd test -- --silent`

Expected: 0 failed.

- [x] **Step 3: 构建与差异检查**

Run: `npm.cmd run build`

Expected: exit 0.

Run: `git diff --check && git status --short && git diff --stat`

Expected: 无空白错误，仅包含本主题代码、测试、项目书、账本与本计划。

- [x] **Step 4: 回填账本和真实 Electron 验收状态**

记录每个 I016-I019 的代码位置、RED/GREEN 结果与远端 spy；若没有用户授权的测试账号，明确标记真实 Electron 操作和鼠标连续响应为待验证，不以自动化替代。

# 收藏夹勾选投影与分类效果记录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让上方已保存收藏夹与下方推荐项按同一稳定规则 ID 双向投影，并将一次勾选/取消及其分类影响写为一条可恢复、可读的改动记录。

**Architecture:** 保持渲染器仅负责乐观显示和发送小型命令；主进程现有串行工作区队列继续负责推荐候选差量分类、排除集合与历史持久化。分类条目与`favoriteRuleState`合并时统一标记为`favorite-rules`，快照从同一持久化状态导出中文动作和聚合的来源→去向分组，历史恢复仍按已有游标恢复本地状态。

**Tech Stack:** Electron 主进程、React、TypeScript、Vitest。

---

### Task 1: 锁定精确 ID 的上下投影

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:82-132,478-580`

- [x] **Step 1: 写出失败的精确 ID 投影测试**

  为同 ID、`ruleOrigin: 'recommendation-draft'`、已显示于上方的规则构造上方取消和下方重新勾选。断言上方规则仍存在、下方采用状态同步、保存调用不进入删除草稿路径，且同名不同 ID不联动。

- [x] **Step 2: 运行该测试确认 RED**

  Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

  Expected: 新增断言失败，当前实现因`isSavedUpperLedger`排除了该`recommendation-draft`的精确映射。

- [x] **Step 3: 最小化修复精确投影**

  保持`createRecommendationProjection`对纯推荐草稿的既有排除，避免下方首次取消误变为“保留规则”。上方入口在候选列表中以`ledger.id === candidate.id`作唯一的直接回退解析：取消时同步移除采用 ID、写入同一 ID的排除集合，并把该 ID传入`retainLinkedSavedLedgerIds`，所以不删除草稿。下方入口仅当同 ID已在当前快照`excludedLedgerIds`中时交给`setOrganizationSavedLedgerParticipation`恢复上方规则；没有这一上方取消事实的纯推荐草稿仍走原有“取消即删草稿”路径。全程不使用同名或语义回退。

- [x] **Step 4: 验证 GREEN 与不误删边界**

  Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

  Expected: 新测试与既有纯推荐草稿“取消即删草稿”测试均通过。

### Task 2: 把一次规则参与变更压成一个历史条目

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:5697-5810`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:2121-2157,3295-3327,5319-5397,7497-7542`
- Modify: `src/shared/oldFavoriteWorkspace.ts:459-478`

- [x] **Step 1: 写出失败的历史原子性测试**

  在已有“saved-rule selection transition”夹具中断言：推荐采用、排除与 enabled 状态后只新增一个游标；该条目`source`为`favorite-rules`，同时有`changes`和`favoriteRuleState`；其快照摘要含中文动作、规则显示名及全部聚合`movementGroups`。再断言无视频变化时只有一个规则条目。

- [x] **Step 2: 运行该测试确认 RED**

  Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "saved-rule selection transition"`

  Expected: 现有条目的`source`仍为`system-high`，快照没有规则动作或来源→去向分组。

- [x] **Step 3: 最小化实现历史合并与快照投影**

  在`recordFavoriteLedgerHistoryChangeUnsafe`合并分类项时保留原`changes`和`favoriteRuleState`，但将合并后的条目统一标为`favorite-rules`。从`favoriteRuleState.before/after`按稳定 ID推导勾选/取消及规则显示名；从`changes`按完整的`beforeTargetLedgerIds + afterTargetLedgerIds`聚合数量。把动作和分组以紧凑的可选字段放入快照摘要，不传原始规则 ID或整份规则快照给渲染器。

- [x] **Step 4: 验证 GREEN、恢复与旧规则条目**

  Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "saved-rule selection transition|rule-only history|restores.*rule-history|recommended-folder adoption"`

  Expected: 单一游标通过 undo/redo 恢复 enabled、采用、排除与分类；无移动仍只有一条明确规则状态条目。

### Task 3: 在归档预览显示清楚的中文效果

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx:373-398`

- [x] **Step 1: 写出失败的改动记录显示测试**

  构造一个带规则动作和两个来源→去向分组的`favorite-rules`快照。断言单行文字为`取消「游戏专区」后，自动分类 24 条：…`，不包含“收藏夹规则与勾选已更新”或内部 ID，`title`含完整的每个中文分组。另写无移动时的中文状态断言。

- [x] **Step 2: 运行该测试确认 RED**

  Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

  Expected: 当前`historyLabel`对全部`favorite-rules`项固定返回“收藏夹规则与勾选已更新”。

- [x] **Step 3: 最小化实现中文格式化**

  在`historyLabel`优先处理快照中的规则动作和聚合分组，使用已有`historyTargetLabel`解析本地收藏夹名与`暂存`，将分组以中文分号连接。继续复用按钮的单行截断与`title`属性；缺少新版摘要的旧历史项降级为现有安全中文文案。

- [x] **Step 4: 验证 GREEN**

  Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

  Expected: 新旧历史显示测试全部通过，人工调整与 DeepSeek 文案不变化。

### Task 4: 集成验证、界面验收与账本收尾

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-27-favorite-selection-bidirectional-projection.md`
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/superpowers/plans/2026-08-27-favorite-selection-projection-and-history.md`

- [x] **Step 1: 运行聚焦回归**

  Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

  Expected: 全部通过；不引入 DeepSeek、删除、备册、同步执行测试失败。

- [ ] **Step 2: 启动 Electron 开发版进行只读验收**（开发版已只读检查并保存截图；当前没有 `previewing` 草稿，无法安全点击验证双向联动、历史文本和响应性。）

  仅检查：上方取消使下方同 ID未勾选且上方规则仍在；下方重新勾选恢复上方；一次参与变更在改动记录中只有一条中文效果记录；鼠标移动、滚动、窗口缩放和关闭保持响应。不得点击备册、绑定、删除、保存或任何 B 站写入按钮；截图存入`.codex-artifacts/`。

- [x] **Step 3: 运行全量验证与账本证据更新**

  Run: `npm test; npm run build; git diff --check; git diff --stat; git status --short`

  Expected: 测试、构建和差异检查通过；账本 I001/I002 分别记录代码位置、自动化结果、Electron 截图和未能验证的远端副作用（本轮应为零远端副作用）。

- [ ] **Step 4: 只提交本轮主题文件**

  Run: `git add -- docs/项目功能项目书.md docs/requirement-ledgers/2026-08-27-favorite-selection-bidirectional-projection.md docs/superpowers/plans/2026-08-27-favorite-selection-projection-and-history.md electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/shared/oldFavoriteWorkspace.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

  Run: `git commit -m "fix: unify favorite selection history"`

  Expected: 不包含`pnpm-lock.yaml`、`pnpm-workspace.yaml`或任何 DeepSeek、转写、删除确认、备册/同步实现之外的文件。

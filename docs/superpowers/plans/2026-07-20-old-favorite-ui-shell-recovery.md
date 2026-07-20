# 整理旧藏 UI 外壳恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不恢复旧状态机的前提下，将正式掌库 UI 恢复为替换前的完整整理旧藏体验，并保留独立收藏库入口。

**Architecture:** Electron 主进程工作区和账号仓库继续是唯一权威。React 面板拆为收藏夹概览、四个向导步骤和收藏库入口等小组件，只订阅当前账号/当前分段快照并发送窄命令；复用现有 CSS 与旧 DOM 信息层级，不复用旧 session/runtime/IPC。

**Tech Stack:** Electron、React 19、TypeScript、Vitest、Testing Library、现有 `old-favorite-workspace-v1` IPC、现有虚拟列表与样式表。

---

### Task 1: 锁定 UI 回归契约

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Create: `src/renderer/src/features/assistant/controlledOldFavoriteGuideModel.test.ts`
- Create: `src/renderer/src/features/assistant/controlledOldFavoriteGuideModel.ts`

- [ ] **Step 1: 写失败测试，要求默认掌库不显示裸露开发骨架**

断言正式掌库存在“整理旧藏”和“收藏库”独立入口；未点击整理旧藏时不显示 `bilimi:知识学习` 等裸露文字列表，也不自动打开向导。

- [ ] **Step 2: 写失败测试，要求点击后立即出现四步向导与扫描中**

断言步骤依次为“扫描概览、推荐收藏夹、归档预览、确认执行”，后续步骤在 scanning 时禁用。

- [ ] **Step 3: 运行 RED**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/controlledOldFavoriteGuideModel.test.ts`

Expected: 因当前骨架默认裸露收藏夹和向导层级不完整而失败。

- [ ] **Step 4: 实现纯展示模型**

模型输入 `OldFavoriteWorkspaceSnapshot | recovery | null`，输出当前步骤、步骤可用性、主操作文案、进度和错误状态；不得保存业务状态。

- [ ] **Step 5: 运行 GREEN 并提交**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/controlledOldFavoriteGuideModel.test.ts`

Commit: `test: lock controlled old favorite ui contract`

### Task 2: 恢复掌库外壳与独立入口

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Create: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Create: `src/renderer/src/features/assistant/FavoriteLibraryEntry.tsx`

- [ ] **Step 1: 写失败测试锁定区域顺序和折叠行为**

断言收藏夹管理、整理旧藏、收藏库入口顺序稳定；点击整理旧藏只展开向导，不影响收藏库按钮。

- [ ] **Step 2: 恢复替换前 DOM 层级**

复用 `favorite-ledger-panel__topbar`、`__toolbar`、`__ledger-list`、`__old-favorites-guide`，删除当前裸露列表和按钮堆叠。

- [ ] **Step 3: 保持收藏库独立**

`FavoriteLibraryEntry` 只调用 `openFavoriteLibrary`，不得调用工作区命令或改变向导步骤。

- [ ] **Step 4: 运行测试与提交**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Commit: `fix: restore favorite ledger panel shell`

### Task 3: 恢复扫描概览和步骤解锁

**Files:**
- Create: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Create: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 写 scanning、failed、recovery 三组失败测试**

覆盖立即显示扫描中、普通/Bilimi 工作夹、来源勾选、失败重试、损坏镜像重建、切页重挂载恢复。

- [ ] **Step 2: 实现扫描步骤**

来源勾选只调用 `selectSourceFolders`；Bilimi 工作夹只读展示；后续步骤由快照状态解锁。

- [ ] **Step 3: 运行测试与提交**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

Commit: `feat: restore controlled old favorite scan guide`

### Task 4: 恢复推荐收藏夹步骤

**Files:**
- Create: `src/renderer/src/features/assistant/OldFavoriteRecommendationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 写失败测试**

覆盖 UP/标签候选、整轮共享选择、分段切换和重挂载后保持、候选为空的解释文案。

- [ ] **Step 2: 实现候选卡片与采用状态**

仅调用 `setRecommendedCandidates`，不在 React 保存第二份选择。

- [ ] **Step 3: 运行测试与提交**

Commit: `feat: restore old favorite recommendations ui`

### Task 5: 恢复归档预览与人工操作

**Files:**
- Create: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Create: `src/renderer/src/features/assistant/OldFavoritePreviewCard.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 写当前分段与虚拟化失败测试**

单段不显示分组；多段显示切换；超过阈值使用 `VirtualOldFavoriteTrack`；不得把全量 30000 条送入 DOM。

- [ ] **Step 2: 写操作失败测试**

覆盖自动分类、DeepSeek 运行态、人工目标、低置信单目标、人工优先、撤销/恢复、新建收藏夹后重新归类。

- [ ] **Step 3: 实现紧凑预览卡与工具栏**

展示标题、UP 主、来源、分类来源和目标；命令均通过 hook，禁止本地改写分类。

- [ ] **Step 4: 运行测试与提交**

Commit: `feat: restore controlled archive preview ui`

### Task 6: 恢复确认、执行、对账和完成态

**Files:**
- Create: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 写准备度和多分段失败测试**

未分类或未完成分段禁止执行；显示整体完成度；只有多段时提及全局去重。

- [ ] **Step 2: 写执行状态失败测试**

覆盖仅保存收藏库、确认并同步、frozen 继续、executing 进度、防重复提交、reconciling 对账、completed 只读。

- [ ] **Step 3: 实现确认步骤**

按钮文案和可用性完全由展示模型/快照决定；不在 UI 重算冻结计划。

- [ ] **Step 4: 运行测试与提交**

Commit: `feat: restore controlled favorite confirmation ui`

### Task 7: 恢复视觉一致性与可访问性

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 对照替换前样式选择器**

复用现有样式，只添加新小组件缺少的语义类；不得建立第二套主题或任意新宽度。

- [ ] **Step 2: 加无障碍回归**

验证步骤 `aria-current`、进度/错误 status、按钮 disabled、标签关联和键盘操作。

- [ ] **Step 3: 开发版截图对照**

实际打开掌库，验证侧栏宽度、顶部页签、收藏夹区域、四步向导、预览密度与替换前一致；截图记录到验收文档。

- [ ] **Step 4: 提交**

Commit: `fix: align controlled old favorite ui with legacy shell`

### Task 8: 完整流程与防回退验收

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `docs/old-favorites-acceptance.md`
- Modify: `README.md`

- [ ] **Step 1: 完整面板 E2E**

覆盖点击、扫描、来源、推荐、自动分类、DeepSeek、人工、撤销/恢复、多分段、一次确认、执行/对账、完成和下一轮增量。

- [ ] **Step 2: 防旧核心回归**

运行 `electron/main/oldFavoriteLegacyBoundary.test.ts`，确认正式产物无旧 IPC/API/import。

- [ ] **Step 3: 全量验证**

Run: `npm test`

Run: `npm run build`

Run: `git diff --check`

Expected: 全部退出码 0。

- [ ] **Step 4: 独立审查**

重点检查 UI 是否可完成一轮、是否重新引入双权威、收藏库是否仍独立、30000 条是否只渲染当前分段。

- [ ] **Step 5: 整体提交**

Commit: `fix: restore complete controlled old favorite experience`


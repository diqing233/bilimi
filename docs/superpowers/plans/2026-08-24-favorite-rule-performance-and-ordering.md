# 收藏夹规则分类速度与覆盖顺序实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让扫描推荐采用已有命中索引快速更新，让自建规则继续安全地分批分析，并使当前工作区分类按后完成持久化的操作覆盖前一结果。

**Architecture:** 主进程工作区是唯一分类事实。推荐选择通过扫描期持久化的分段 AID 索引走局部重排；普通规则目录变更仍通过主进程命令队列完成整轮重算。渲染器只在对应命令完成后采纳同账号、同工作区快照，不能由一次全局偏好保存额外重算推荐路径。

**Tech Stack:** Electron、TypeScript、React、Vitest。

---

### Task 1: 固化规则分类覆盖语义

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/contracts/favorites.md`
- Modify: `docs/requirement-ledgers/2026-08-24-favorite-rule-changes-not-reflected.md`

- [x] **Step 1: 写入推荐快速路径、自建后台路径与同工作区后完成覆盖前一结果的规范。**
- [x] **Step 2: 补充规则配置版本、删除/恢复入口、候选生命周期与预检失效/冻结前复核规则。**
- [x] **Step 3: 复读上述文件，核对不改变 B 站副作用、删除确认、视频同步和 DeepSeek 请求/失败流程。**

### Task 2: 规则目录变更必须驱动实际工作区

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [ ] **Step 1: 写失败回归。** 父级组织快照为空、子面板为同账号`previewing`时，普通保存和启停仍须发起一次重分类并让内部快照更新；本轮勾选不发重分类。
- [ ] **Step 2: 写失败回归。** 删除和恢复已保存本地规则后，主进程工作区分类、归档目标与本轮预检均不再保留/重新包含该 ID。
- [ ] **Step 3: 写失败回归。** 删除或实质编辑本轮创建规则后，迟到的规则分析不能把旧候选、adopted ID 或分类重新写回。
- [ ] **Step 4: 实现最小协调。** 将规则目录变更集中到主进程的串行重分类与候选失效路径；`previewing`外明确返回未重算事实；渲染器按账号、工作区和版本采纳快照。
- [ ] **Step 5: 运行上列测试至 GREEN。**

### Task 3: 预检只允许使用最新同步目标投影

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] **Step 1: 写失败回归。** 预检打开后规则目录或本轮排除集变化，旧预检不能继续进入备册、冻结或同步；重新读取后只显示新目标。
- [ ] **Step 2: 实现最小失效与确认前复读。** 预检记录快照身份；变化即废弃，确认时重读同一权威投影，保持既有无副作用与候选确认边界。
- [ ] **Step 3: 运行面板和协调器预检回归至 GREEN。**

### Task 4: 推荐采纳不触发额外全轮重分

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] **Step 1: 写失败测试，证明采纳扫描推荐只提交推荐命令/推荐规则持久化，不额外发送`reclassify-favorite-configuration`。**
- [ ] **Step 2: 运行该测试并确认因通用规则保存路径触发全轮重分而失败。**
- [ ] **Step 3: 用推荐专用保存路径做最小修复，保留普通保存、启停、删除和默认体系的完整重分。**
- [ ] **Step 4: 运行对应面板与应用回归测试。**

### Task 5: 主进程分类按有效完成顺序覆盖

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [ ] **Step 1: 写失败测试，证明后完成的规则重分可替换早先人工`manual`和 DeepSeek 分类。**
- [ ] **Step 2: 运行该测试并确认当前保护过滤导致失败。**
- [ ] **Step 3: 最小化调整主进程分类过滤，只保留账号/工作区、取消与命令队列的失效边界。**
- [ ] **Step 4: 运行 coordinator、IPC、规则分析与恢复相关回归。**

### Task 6: 验证与交接

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-24-favorite-rule-changes-not-reflected.md`
- Create: `.codex-artifacts/2026-08-24-favorite-rule-performance-readonly.png`

- [ ] **Step 1: 运行聚焦 Vitest、`npm test`、`npm run build`与`git diff --check`。**
- [ ] **Step 2: 使用已登录 Electron 开发版做只读验收：查看推荐、自建规则分析进度、预览与同步前状态；不点击任何 B 站写入动作。**
- [ ] **Step 3: 将每个 I001–I004 的代码位置、测试、截图与未验证远端副作用写回账本。**
- [ ] **Step 4: 仅在本轮文件没有混入既有 DeepSeek/其他主题改动时创建本地提交。**

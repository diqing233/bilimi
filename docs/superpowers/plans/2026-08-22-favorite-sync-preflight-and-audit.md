# 收藏同步备册预检与分类审计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一次整理收藏只留下一个有意义的分类审计，并在确认同步前通过统一备册确认补齐新增分册和已启用未备册规则。

**Architecture:** 观察投影不再携带分类调整来源；整理分类写入为每个视频保留稳定审计身份，后续恢复/同步仅按该身份更新状态。同步冻结之前由主进程构造只读备册缺口，渲染器展示并复用现有备册确认，完成后再次预检；冻结器只接受已完整绑定的物理分册。

**Tech Stack:** Electron 主进程、React、TypeScript、Vitest、账号级收藏仓库。

---

### Task 1: 记录项目书和收藏夹契约

**Files:**

- Modify: `docs/项目功能项目书.md`
- Modify: `docs/contracts/favorites.md`

- [x] **Step 1: 声明同步前统一备册预检、无缺口直进和冻结禁止隐式创建/绑定。**
- [x] **Step 2: 声明一轮分类审计身份、同步状态更新及观察/空变化不记录分类历史。**

### Task 2: 阻止观察和恢复性补写生成重复分类审计（I006、I007）

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/shared/favoriteRepository.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/shared/favoriteRepository.ts`

- [x] **Step 1: 写 RED 测试。** 扫描观察的空归属投影不应产生分类审计或最近调整；同一 `organize-favorites` 分类在恢复性本地补写后仍只有一条审计，且 B 站状态更新复用原 `classificationAdjustmentId`。
- [x] **Step 2: 运行聚焦测试并确认失败原因是当前观察带 `manual` 调整，恢复性整批重提交会携带新的随机命令 ID。**
- [x] **Step 3: 作最小实现。** 观察命令只更新观察字段；过滤无实际变化的分类写入，并只为尚未完成本地提交的计划项补写，保留原审计 ID。
- [x] **Step 4: 重跑聚焦仓库与协调器测试。** `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/shared/favoriteRepository.test.ts`：387/387 通过（2026-08-22）。

### Task 3: 同步前统一备册缺口确认（I008）

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`

- [ ] **Step 1: 写 RED 测试。** 预检同时返回容量新增分册和所有已启用未备册规则；存在缺口时冻结器不调用 `ensurePhysicalShard`、不写 B 站；没有缺口时不打开对话并沿用直接冻结。
- [ ] **Step 2: 运行聚焦测试并确认当前实现会在冻结中调用 `ensurePhysicalShard`，且页面只显示临时准备文字。**
- [ ] **Step 3: 作最小实现。** 通过受信 IPC 取得只读缺口；页面在一个确认窗口中列出全部缺口并复用现有备册流程，完成后重新预检；冻结器把缺口作为阻塞错误而不作远端变更。
- [ ] **Step 4: 重跑主进程、IPC 与 React 回归。**

### Task 4: 证据、验收和提交

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-22-favorite-shard-picker-count-and-label.md`

- [ ] **Step 1: 记录 I003–I008 的代码位置、测试和未完成实机验收；I001/I002 维持待用户决定。**
- [ ] **Step 2: 运行修改套件、`npm test`、`npm run build`、`git diff --check` 和 `git diff --stat`。**
- [ ] **Step 3: Electron 开发版仅做只读界面验收并将截图放入 `.codex-artifacts/`；不确认创建/绑定/删除，不写 B 站视频。**
- [ ] **Step 4: 只暂存本轮收藏夹实现、测试、项目书、契约、计划与账本，创建一个本地 `main` 提交。**

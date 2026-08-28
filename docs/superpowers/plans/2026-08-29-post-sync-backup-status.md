# 备册完成后的状态刷新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or equivalent). Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让同步/备册完成后的掌库状态立即从最新权威快照投影，消除旧缓存导致的“已备册仍显示未备册”。

**Architecture:** 在主渲染器的备册保存成功路径统一失效当前账号状态缓存，并在浮窗请求快照时强制读取一次最新状态；不改变远端写入和既有勾选分类链路。仓库正式绑定优先于短暂滞后的 B 站列表。

**Tech Stack:** TypeScript、React、Electron、Vitest。

---

### Task 1: 固定状态缓存刷新回归

**Files:**

- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

- [x] **Step 1: 写入 RED 测试**

构造备册保存返回已绑定 `ledgers`、但首次快照状态仍含目标 `missingLedgerIds` 的场景；断言保存完成后的快照请求不会继续使用旧状态。

- [x] **Step 2: 运行 RED**

Run: `npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts -t "backup.*status|stale.*cache|已备册"`

Expected: 新增断言在当前实现失败，原因是普通备册路径没有失效或强制刷新收藏夹状态缓存。

### Task 2: 最小实现缓存失效与强制读取

**Files:**

- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`（仅在需要时调整快照刷新调用）

- [x] **Step 1: 在普通备册保存完成后失效缓存**

在 `saveFavoriteLedgers` 的成功/绑定结果持久化路径清除当前账号状态缓存；不要将该逻辑放入收藏夹勾选回调。

- [x] **Step 2: 强制读取一次最新状态**

让备册完成后的快照刷新只触发一次 `readFavoriteLedgerStatus(accountMid, { force: true })`，避免旧 `missingLedgerIds` 在 UI 中短暂回流。

- [x] **Step 3: 运行 GREEN 与保护性回归**

Run: `npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts electron/main/favoriteLibraryManagedFolderProjection.test.ts src/shared/favoriteRepository.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: 新增回归与上一轮投影、仓库、勾选响应回归全部通过。

### Task 3: 文档、构建与提交

- [x] **Step 1: 回读账本原文区与索引表**

分别补齐 I001/I002 的代码位置、测试、Electron 截图和未验证真实副作用。

- [x] **Step 2: 运行最终验证**

Run: `npm test`; `npm run build`; `git diff --check`; `git diff --stat`; `git status --short`。

- [x] **Step 3: 只提交本轮文件**

提交项目书、契约卡（如有本轮同步状态补充）、本轮账本/设计/计划、状态刷新代码及测试；不得加入 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`。

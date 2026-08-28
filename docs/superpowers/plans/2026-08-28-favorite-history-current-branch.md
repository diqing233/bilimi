# 收藏夹改动记录当前分支实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让归档预览的改动记录明确展示当前可恢复分支中每一条分类动作，并把当前条目作为可辨识的记录行呈现。

**Architecture:** 主进程继续只投影基线之后的当前 history 分支，不改变 journal、游标或恢复算法。渲染器基于已经发布的短 history 摘要计算记录数量，统一绘制当前行与可选择的历史行；不对视频、分类或 B 站状态做额外读取和计算。

**Tech Stack:** Electron 主进程快照、React/TypeScript、Vitest、既有归档预览样式。

---

### Task 1: 锁定当前分支的可见性契约

**Files:**
- Modify: `docs/项目功能项目书.md:387-388`
- Modify: `docs/requirement-ledgers/2026-08-28-favorite-history-record-visibility.md`

- [x] **Step 1: 记录已确认语义**

项目书和账本明确：只显示`historyBaselineCursor`之后、当前可恢复分支的最终一致分类条目；当前游标条目是记录行，基线、零移动规则状态和新分支已替换的 redo 不显示。

- [x] **Step 2: 核对副作用与性能边界**

确认该展示只消费快照 history 摘要，不触发分类、持久化、规则保存、B 站写入或整轮视频遍历。

### Task 2: 为当前记录行写 RED 测试

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx:540-582`

- [x] **Step 1: 写入失败测试**

在现有含一个当前人工记录和一个较早 DeepSeek 记录的归档预览测试中，断言弹层显示`本轮可恢复记录（2 条）`，当前条目具有`role="menuitem"`、`aria-current="true"`且文字为`当前：Preview：Archive → Manual`；较早条目仍可选择恢复。

- [x] **Step 2: 运行测试并确认 RED**

运行：`npm test -- src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx -t "renders the current branch history as records"`

预期：失败于尚不存在`本轮可恢复记录（2 条）`或当前 history menuitem。

### Task 3: 最小化渲染器实现

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx:424-428,618-641`
- Modify: `src/renderer/src/assets/main.css`（仅在现有历史菜单类无法表达当前项状态时）

- [x] **Step 1: 统一构造当前分支记录行**

以`historyEntries`长度显示`本轮可恢复记录（N 条）`；当前 cursor 对应条目渲染为带`aria-current="true"`和`当前：`前缀的禁用 menuitem，其他已投影条目继续调用既有`onMoveHistoryCursor(entry.cursor)`。

- [x] **Step 2: 保持边界**

不修改 snapshot 主进程投影、history cursor、`onMoveHistoryCursor`、分类、规则、归档统计、同步预检或 B 站执行路径；仅映射已发布的 history 摘要。

- [x] **Step 3: 运行 GREEN 与相关回归**

运行：`npm test -- src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

预期：归档预览历史菜单全部通过，既有“恢复初始改动”、redo、中文历史文案和可视区域定位断言不回归。

### Task 4: 验证与交付

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-28-favorite-history-record-visibility.md`

- [x] **Step 1: 运行协调器历史与渲染器聚焦回归**

运行：`npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 2: Electron 只读验收**

启动开发版，打开`掌库 → 整理收藏 → 归档预览 → 改动记录`；只读核对当前行、记录数量、较早行与恢复入口。不得点击恢复、备册、创建、绑定、删除、保存或同步；截图放入`.codex-artifacts/`。

- [x] **Step 3: 完整验证并回填**

运行`npm test`、`npm run build`、`git diff --check`和`git status --short`；向账本 I001 回填代码位置、测试与界面验收证据，再只提交本轮账本、项目书、计划、测试和渲染器文件。

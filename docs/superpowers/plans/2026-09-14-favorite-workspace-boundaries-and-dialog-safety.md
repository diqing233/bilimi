# 收藏库工作夹边界与确认弹窗安全实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让备册状态、正式工作夹导航、结束整理、批量删除与候选勾选都只消费当前权威事实，且不改变既有 B 站确认语义或前台交互响应。

**Architecture:** 备册状态只由正式物理分册与当前可确认远端候选决定，历史删除标记仅阻止自动认领。收藏库渲染层删除 `local:inbox` 到伪逻辑工作夹的投影，使扫描安全暂存继续留在仓库而不进入工作夹导航或批量命令。结束成功结果由现有关闭向导路径收束；确认弹窗的选择状态只同步读取布尔值并改变 React 本地状态。

**Tech Stack:** Electron、React 19、TypeScript、Vitest、Testing Library、CSS。

---

### Task 1: 备册状态投影（I001 / R001）

**Files:**
- Modify: `src/shared/favoriteLedgerBackupState.test.ts`
- Modify: `src/shared/favoriteLedgerBackupState.ts`

- [x] 写失败用例：曾删除但没有正式分册、也没有当前候选时返回 `unbacked`；传入 `unboundLedgerIds` 时返回 `unbound`。
- [x] 运行 `npx vitest run src/shared/favoriteLedgerBackupState.test.ts`，确认新用例因历史删除标记过早返回 `unbound` 而失败。
- [x] 以最小改动让历史删除标记不再独立决定显示状态，同时保留正式分册的 `partial` 与当前候选的 `unbound`。
- [x] 重跑同一测试并记录结果：3/3，通过。

### Task 2: 正式工作夹与本地扫描暂存边界（I003/I004/I006/I007 / R003/R004/R006/R007）

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `electron/main/favoriteRepositoryManagedFolderService.test.ts`

- [x] 写失败渲染用例：仅有 `local:inbox` 时左侧不出现 `bilimi·暂存`，其不会进入备册或批量删除候选；真实 `bilimi-logical:inbox` 仍出现。
- [x] 写失败删除用例：多个真实逻辑工作夹仍以一个原子本地批量命令执行，任何 `local:inbox` 都不进入该命令。
- [x] 分别运行针对性 Vitest，确认失败来自虚拟暂存投影/候选混入。
- [x] 移除 `workspaceBackupFolders()` 的虚拟工作夹合成，仅以真实 `bilimi-logical:*` 驱动左侧、备册和删除候选；保留 `local:inbox` 后台数据及正式工作夹批量删除语义。
- [x] 重跑对应测试，确认真实工作夹路径仍通过：`FavoriteLibraryApp` 187/187、managed-folder service 43/43、model 23/23。

### Task 3: 结束整理收束与非阻塞候选勾选（I005/I008 / R005/R008）

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [x] 写失败用例：成功结束工作区后向导不再渲染；失败时仍保留。
- [x] 写失败用例：备册候选和批量删除候选复选框仅改变本地选择，页面不触发 API、不进入错误边界。
- [x] 运行各自针对性 Vitest，确认失败来自未关闭 `guideOpen` 与事件对象跨状态更新器读取。
- [x] 在成功停止回调使用现有 `closeGuide()` 语义关闭 UI；在所有相关 `onChange` 中先读取 `const checked`，再调用状态更新。
- [x] 重跑对应测试，确认失败/取消收束与正式确认语义不变：`ControlledFavoriteLedgerPanel` 170/170，`FavoriteLibraryApp` 187/187。

### Task 4: 绑定弹窗固定结构与滚动条（I002 / R002）

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteModal.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteModal.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] 写失败 DOM 用例：绑定候选内容放入独立中段滚动容器，固定标题和操作区不在该容器内。
- [x] 运行对应测试，确认新选择器不存在。
- [x] 为专用绑定弹窗增加结构类和候选内容容器；以 flex 固定头/尾、中段 `overflow-y:auto` 与浅蓝轨道/蓝色圆角滑块实现。不得改候选、选择、排序或确认命令。
- [ ] 重跑测试，并在开发版检查窄窗口下标题、关闭、按钮可见且滚动仅发生在候选区。（组件测试 163/163 已通过；桌面自动化服务未配置，实机界面验收待可控窗口完成。）

### Task 5: 全量回归、界面验收与账本回填

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-13-unbacked-status-and-binding-modal-layout.md`

- [x] 运行相关组件测试、`npm test`、`npm run build`、`npm run preview`；检查 `git diff --check`。
- [ ] 在 Electron 开发版验证：候选勾选、全选、滚动、结束整理成功/失败及批量删除期间鼠标、点击、滚动、缩放、最小化、恢复、关闭保持响应；不执行未经用户确认的 B 站写入。（启动日志正常；桌面自动化服务未配置，不能对现有用户 Electron 窗口做安全的真实操作。）
- [x] 将每个 I001–I008 的实际代码位置、自动化与真实界面验收结果逐项回填账本；本地提交将在最终 `git diff --check`、状态和范围复核后创建；真实界面验收缺口将如实保留，不混称为全部实机通过。

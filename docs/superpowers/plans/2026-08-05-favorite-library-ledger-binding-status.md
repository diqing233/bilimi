# Favorite Library Ledger Binding Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 bilimi 工作夹删除、草稿识别、暂存归属和收藏库标题备册状态，使无可信绑定的远端文件夹不会被误删或误分组。

**Architecture:** 主进程仓库投影负责可信绑定与草稿身份，renderer 只消费明确的 folder kind/syncState 并复用现有 workspace request 导航。删除链路在仓库 reducer 中原子维护文件夹、成员和 position，设置回写按默认/自建规则分别处理。

**Tech Stack:** TypeScript, React 19, Electron IPC, Vitest, Testing Library

---

### Task 1: 删除后数据一致性

**Files:**
- Modify: `src/shared/favoriteRepository.ts`
- Test: `electron/main/favoriteRepositoryService.test.ts`
- Test: `electron/main/favoriteRepositoryManagedFolderService.test.ts`

- [ ] 写失败测试：删除工作夹后，无其他 logical 归属的视频加入 `local:inbox`，空工作夹使用普通 commit。
- [ ] 运行聚焦测试，确认因暂存归属缺失而失败。
- [ ] 最小修改 `delete-local-managed-folder` reducer，原子更新 membership 和 position。
- [ ] 重跑测试确认通过。

### Task 2: 备册规则删除回写

**Files:**
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `src/renderer/src/features/assistant/managedFavoriteFolderDeletionFeedback.ts`
- Test: matching adjacent `*.test.ts`

- [ ] 写失败测试：默认规则保留并清除 `bilibiliFolderId`，自建规则移除。
- [ ] 运行测试确认 RED。
- [ ] 在删除成功后的单一回写边界实现规则更新，不在 `result-unknown` 时提前更新。
- [ ] 重跑测试确认 GREEN。

### Task 3: bilimi 草稿投影和暂存命名

**Files:**
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`
- Test: `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

- [ ] 写失败测试：bilimi-like 无绑定镜像生成 pending-reconcile logical 草稿，普通镜像保持 ordinary；`local:inbox` 显示“暂存”。
- [ ] 运行测试确认 RED。
- [ ] 最小实现名称解析和安全草稿投影，不创建可信 remote binding。
- [ ] 重跑测试确认 GREEN。

### Task 4: 标题状态和掌库跳转

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Test: `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`

- [ ] 写失败测试：已备册、未备册、已生成草稿状态及普通收藏夹无状态。
- [ ] 写失败测试：待绑定状态点击后发出既有 ledger workspace request 并定位 ledger。
- [ ] 运行测试确认 RED。
- [ ] 实现纯派生状态组件和现有导航桥接。
- [ ] 重跑测试确认 GREEN。

### Task 5: 远端批量删除中止和对账

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Test: adjacent test files

- [ ] 写失败测试：`failed` 或 `result-unknown` 后不继续删除后续文件夹。
- [ ] 运行测试确认 RED。
- [ ] 检查每次执行结果并把 unknown 加入对账队列，失败立即停止。
- [ ] 重跑测试确认 GREEN。

### Task 6: 回归和真实交互验证

**Files:**
- Evidence: `.codex-artifacts/`

- [ ] 运行收藏库、掌库、仓库 reducer、受管文件夹和同步服务测试。
- [ ] 运行 `git diff --check` 和类型/构建检查。
- [ ] 启动 Electron dev，验证标题状态、跳转、分组、暂存和删除路径；不执行真实 B 站写入。
- [ ] 检查鼠标、点击、滚动、缩放、最小化和关闭。
- [ ] 检查 `git status --short`、`git diff --stat`，确认无无关文件。

# Favorite Library Risk Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复收藏库返修审计中确认的真实运行风险，并把相关类型契约恢复到可验证状态。

**Architecture:** 先修 UI 状态来源和仓库状态联合类型，再补 IPC 摘要与迁移边界校验；不改变已确认的业务语义，不以强制断言清零错误。

**Tech Stack:** Electron, React, TypeScript, Vitest。

---

### Task 1: 转写列使用真实队列状态

**Files:** `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`, `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [ ] 为未选中视频补充队列状态回归测试：加入队列、排队中、完成后档案详情分别显示正确动作。
- [ ] 让每行按账号+aid从 `transcriptionQueue.items` 解析状态，不依赖 `detailSnapshot` 或不存在的 `pendingStates`。
- [ ] 保留详情页作为补充来源，禁止行内动作冒泡打开详情。
- [ ] 运行收藏库相关测试。

### Task 2: 统一远程操作结果契约

**Files:** `src/shared/favoriteRepository.ts`, `electron/main/favoriteRepositoryBatchOperationService.ts`, `electron/main/favoriteRepositoryManagedFolderService.ts`, tests

- [ ] 为 `reconciliation-required` 建立统一结果联合类型与计数处理。
- [ ] 对虚拟来源先做 `kind === 'virtual'` 收窄，再读取 `eligibleAids/skippedAids`。
- [ ] 补充远程对账、虚拟来源越权和失败状态回归测试。
- [ ] 运行仓库批量操作、managed folder、IPC 测试。

### Task 3: 补齐收藏库 IPC 摘要

**Files:** `electron/main/favoriteRepositoryIpc.ts`, summary tests

- [ ] 从快照生成 `folderCounts`、`scopeCounts`、`remoteReconciliations`，并纳入同步状态计数。
- [ ] 确认待处理数量与提示区使用同一来源，避免重复计数。
- [ ] 补充摘要字段完整性测试。

### Task 4: 修复本地迁移边界类型

**Files:** `src/shared/localDataMigration.ts`, `src/shared/localDataMigration.test.ts`

- [ ] 为档案 source、overview、recovery record 建立窄化守卫。
- [ ] 使用守卫后读取字段，不用 `as any/unknown` 绕过未知数据。
- [ ] 覆盖合法档案、损坏档案、跨账号档案和设备绑定字段拒绝。

### Task 5: 明确 portable draft 恢复语义

**Files:** `electron/main/oldFavoriteWorkspaceCoordinator.ts`, coordinator tests, recovery UI if needed

- [ ] 区分“可显式重新扫描的 portable draft”和“镜像损坏需重建”。
- [ ] 保持已完成本地结果不被删除，并让 UI 文案与恢复选项一致。
- [ ] 补充打开草稿、开始扫描、真正损坏三种回归测试。

### Task 6: 收敛 Bilibili 连接偏好读写

**Files:** `electron/main/index.ts`, `electron/main/store.ts`, tests

- [ ] 保留 `auto/direct` 行为与默认值。
- [ ] 将 IPC 读写统一委托给偏好 store helper，避免两套持久化来源。
- [ ] 验证重启读取、patch、webview reload 触发条件。

### Task 7: 测试夹具治理与验证

- [ ] 为桌面桥接建立 typed partial mock helper，逐步减少 `as unknown as`。
- [ ] 运行相关 Vitest、全量 `npx tsc --noEmit -p tsconfig.json`、`npm run build`、`git diff --check`。
- [ ] 启动开发版验证收藏库转写、批量对账、提示区和整理旧藏恢复。
- [ ] 每个完成批次独立提交；不打包、不发布、不推送。

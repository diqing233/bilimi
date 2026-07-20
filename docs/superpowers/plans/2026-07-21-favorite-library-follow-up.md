# 收藏库后续体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有收藏库核心完善为中文、可并排工作的独立三栏本地镜像工作台，并接入来源跳转和档案摘要。

**Architecture:** 保持 `FavoriteRepositoryService` 和转写队列在 Electron 主进程中的权威地位。新增的账户展示、窗口定位、视频跳转和档案摘要都经预加载层的窄 IPC 提供；`FavoriteLibraryApp` 只保存当前页选择与视图状态。

**Tech Stack:** Electron、React 19、TypeScript、Vitest、Testing Library。

---

### Task 1: 建立窗口与用户数据桥接

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/main/favoriteLibraryWindow.ts`
- Modify: `electron/main/favoriteLibraryWindow.test.ts`
- Modify: `electron/preload/favoriteLibrary.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] 写失败测试，覆盖窗口无菜单栏、左贴布局、单窗口聚焦，以及账户昵称与受控视频/来源跳转 IPC。
- [ ] 运行 `npm test -- electron/main/favoriteLibraryWindow.test.ts`，确认新断言因功能未实现失败。
- [ ] 在主进程实现窗口定位、无菜单栏、受信任调用验证、账号信息读取和向主窗口路由视频/收藏夹 URL；预加载仅公开对应窄接口。
- [ ] 运行相同测试，确认通过。

### Task 2: 建立镜像和档案摘要模型

**Files:**
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `electron/main/favoriteRepositoryIpc.test.ts`
- Modify: `electron/main/favoriteLibraryCommands.ts`
- Modify: `electron/main/favoriteLibraryCommands.test.ts`

- [ ] 写失败测试，覆盖每条库视频的中文镜像状态、同步时间、档案摘要及转写前所需元数据校验。
- [ ] 运行聚焦测试，确认失败。
- [ ] 只在主进程推导镜像/档案状态，保存最后成功镜像并使转写命令使用仓库视频快照；从分页快照提供安全只读字段。
- [ ] 运行聚焦测试，确认通过。

### Task 3: 完善三栏窗口交互和详情

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

- [ ] 写失败组件测试，覆盖昵称 UID、中文错误、全选当前页、数量化操作文案、同步状态、来源跳转和档案摘要。
- [ ] 运行 `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`，确认失败。
- [ ] 实现仅由页面快照驱动的 UI；完整详情和操作均通过 Task 1 的窄 IPC，不在 renderer 保存镜像真相。
- [ ] 运行聚焦组件测试，确认通过。

### Task 4: 全量验证与单次提交

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-21-favorite-library-follow-up-design.md`
- Modify: `docs/superpowers/plans/2026-07-21-favorite-library-follow-up.md`

- [ ] 更新 README 的收藏库说明，不暗示 B 站双向回写。
- [ ] 运行 `npm test -- --run`、`npm run build` 和 `git diff --check`。
- [ ] 检查最终 diff 与需求逐项对应。
- [ ] 将本次完整需求整体提交一次，使用中文提交信息。

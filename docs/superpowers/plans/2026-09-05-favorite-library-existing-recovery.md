# 收藏库既有功能复原 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以现有收藏库与整理状态机为基础，修复备册成员投影、同步、详情与权威刷新，使本轮需求账本中已确认的行为恢复可用。

**Architecture:** 主进程收藏仓库继续作为归属、物理分册和同步事实的唯一来源。渲染器只复用现有收藏库抽屉、批量动作和整理同步状态显示；每个动作完成后重新读取权威快照。礼记跳转扩展现有浮动工作区请求，传入精确档案与版本身份。

**Tech Stack:** Electron、TypeScript、React、Vitest。

---

### Task 1: 迭代项目书并固定范围

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-04-deepseek-second-review-target-only.md`

- [x] 将正式收藏库形态改为底部抽屉、保留全查询范围全选，删去已明确不做的来源/处理记录/左侧状态入口。
- [x] 写明备册保留成员、同步真实回执、精确档案详情、批量同步阶段及动作后权威刷新。
- [x] 把 R013 原文追加到账本，重新列出已确认、明确不做与分支等待合并约束。

### Task 2: 修复备册、改归和移动的成员投影

**Files:**
- Modify: `src/shared/favoriteRepository.test.ts`
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `electron/main/favoriteRepositoryBindingService.test.ts`
- Modify: `electron/main/favoriteRepositoryBindingService.ts`

- [x] 先写“给已有逻辑工作夹绑定首个物理分册后成员与 localDesiredFolderIds 不丢失”的失败回归。
- [x] 运行定向测试确认当前空 `memberAids` 覆盖逻辑成员的 RED。
- [x] 用逻辑成员和位置意图建立首个物理分册的本地投影，不增加 B站视频写入；让 `applyPlacement` 对已备册逻辑工作夹同样收敛成员。
- [x] 运行仓库/绑定定向测试，确认 GREEN，并覆盖 DeepSeek 改归与移动替换旧归属。

### Task 3: 修复同步证据、删除边界和单项/批量同步执行

**Files:**
- Modify: `electron/main/favoriteRepositorySyncService.test.ts`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [x] 先写同步目标来自正式绑定/本地归属、成功回执在详情中不反显“未同步”的失败回归。
- [x] 先写批量 `sync` 菜单确实调用既有同步 IPC 的失败 UI 回归。
- [x] 复用现有同步服务和整理同步状态，最小接通批量 sync 与单项结果收束；远端删除只在受管观察证据存在时可执行。
- [x] 每个同步、移动、复制、删除和采用远端归属动作完成后从主进程重新加载权威快照并收敛选择/详情。

### Task 4: 恢复详情跳转、绑定文案与查询清除

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: corresponding existing assistant/App tests

- [x] 先写档案按钮发出带 `archiveId` 与 `versionId` 的礼记请求、绑定弹窗不显示 UID、查询条件可统一清除的失败回归。
- [x] 用现有礼记选档和浮动工作区链路传递精确身份；不改宠物全局历史入口。
- [x] 最小补充清除条件入口与昵称/非 UID 回退文案。
- [x] 运行详情与助手定向测试确认 GREEN。

### Task 5: 验收、账本回填与待合并提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-04-deepseek-second-review-target-only.md`
- Create: `.codex-artifacts/2026-09-05-favorite-library-existing-recovery/*`

- [x] 运行所有相关 Vitest 测试、全量 `npm test`、`npm run build`、`git diff --check`。
- [ ] 在 Electron 开发版用本地测试数据验收备册、移动、单项/批量同步、暂停/结束、详情跳转、查询清除与抽屉刷新；真实 B站写入只在用户自行触发的实际账号环境下记录边界。（本轮被物理 Escape 中断，待用户重新授权界面验收。）
- [x] 按 I001–I005、I008–I009、I012–I014、I021 回填每项代码位置和验证证据。
- [x] 只提交该分支本轮文件；不 merge、不 push，等待用户明确说“合并”。

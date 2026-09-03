# 推荐收藏夹状态与本地事务收口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按项目书 9.6 修复推荐收藏夹的跨状态勾选、第二轮联动、详情删除、远端观察去重和响应性。

**Architecture:** 以“可编辑整理”单一条件分流推荐队列与账号级本地启用写入；所有远端观察入口共享账号级覆盖集和 fail-closed 状态。推荐本地提交与工作区刷新分离，并以规则 ID/操作版本保护回滚和快照顺序。

**Tech Stack:** TypeScript、React、Electron IPC、Vitest、B 站页面脚本桥接。

---

### Task 1: 建立失败回归基线

**Files:**
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Test: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 写出非整理、第二轮、详情删除、失败回滚和滚动锚点的失败测试。下方取消已采用推荐候选时，断言删除同稳定 ID的推荐来源本地规则；普通/身份不明规则仅取消本轮参与。**
- [x] **Step 2: 分别运行相关 Vitest 测试，确认每个新增断言因现有行为失败而非测试错误。**

### Task 2: 修复账号级状态分流和失败回滚

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `electron/main/index.ts`
- Test: 对应 Task 1 测试文件

- [x] **Step 1: 让非 `guideOpen && previewing` 的推荐上方 toggle 只调用账号级启用 IPC。**
- [x] **Step 2: 将推荐本地保存成功与 workspace refresh 分开处理，刷新失败不撤销持久化规则。**
- [x] **Step 3: 为下方取消的同 ID推荐来源本地删除、采用移除和分类投影增加可恢复顺序及过期操作保护；普通或身份不明规则保留原本地规则。**
- [x] **Step 4: 为账号切换和写入失败增加读回/回滚，运行 Task 1 测试确认转绿。**

### Task 3: 完整覆盖集与历史观察收敛

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `electron/main/oldFavoriteWorkspaceRecommendationPersistence.ts`
- Modify: `electron/main/oldFavoriteWorkspaceClassification.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceRecommendationPersistence.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceClassification.test.ts`

- [x] **Step 1: 让覆盖集包含全部账号规则远端 ID、正式 shard ID和 known ID，并分别传入 status/full ensure/single ensure/save及循环复读。**
- [x] **Step 2: 让 known 与 bound 分离，移除标题抑制身份路径，保护 saved-rule、用户编辑、成员/位置引用和不同远端 ID。**
- [x] **Step 3: 对仓库摘要、字段缺失、凭据失败和远端目录失败执行 fail-closed，运行投影与迁移回归。**
- [x] **Step 4: 移除工作区分类合并中按规则类型/关键词推断“同一推荐”的兜底，只允许相同稳定规则 ID 合并或排除；不同 ID 即使关键词相同也分别保留。**

### Task 4: B 站零写入与并发测试

**Files:**
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/App.test.tsx`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [ ] **Step 1: 从推荐勾选、取消、详情删除和刷新完整链路设置统一远端 fetch/IPC spy，断言只有目录读取，没有任何远端写接口。**（现有 `executeJavaScript` 零调用和本地 IPC 断言只覆盖首次本地保存等子路径，不能替代完整统一 spy。）
- [x] **Step 2: 覆盖快速连续勾选/取消、旧状态晚返回、缓存命中和账号切换，确认新操作不会被旧结果覆盖。**

### Task 5: 验收、账本回填与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`
- Modify: `docs/项目功能项目书.md`

- [x] **Step 1: 运行 `git diff --check`、定向测试、`npm test`、`npm run build`，输出保存到 `.codex-artifacts/`。**
- [ ] **Step 2: 在真实 Electron 验收非整理 toggle、第二轮联动、详情删除、滚动位置、快速点击和窗口响应。**（当前开发版未登录，且本次 Computer Use 被物理 Escape 中止；证据缺口已写入需求账本。）
- [x] **Step 3: 按 R001-R014 和新增 9.6 条款逐项回填代码位置、自动化证据、B 站 spy 和界面证据；未验证项明确标记。**
- [x] **Step 4: 检查工作树无无关文件后创建本轮唯一提交。**（推荐主题文件已完成最终核对；无关 `favorite-backup-rename-dedup.md` 保留在工作树外，不纳入本提交。）

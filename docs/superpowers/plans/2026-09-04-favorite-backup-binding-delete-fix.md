# 备册改名绑定与删除校验修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** 修复精确 B 站收藏夹改名后的正式绑定标题落账和删除收尾，使远端改名、绑定、删除与“未备册”状态按同一权威事实闭环。

**Architecture:** 主进程绑定服务负责检查远端改名回执、按精确 ID进行非阻塞最终一致性复读，并从复读结果提交正式 `physicalShards`。渲染层只消费主进程返回的最终标题；删除服务保留 ID 安全校验并返回稳定的阶段错误，成功删除后提交解绑并刷新权威快照。

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, repository journal snapshots.

---

### Task 1: 改名回执与最终标题的失败回归

**Files:**
- Modify: `electron/main/favoriteRepositoryBindingService.test.ts`
- Modify: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 写失败测试**：增加改名桥接返回 `{status: 'rejected', reason: 'remote-ambiguous'}` 时不提交绑定的测试；增加成功采用返回最终 `remoteTitle` 时渲染结果保留该标题的测试。
- [x] **Step 2: 运行定向测试确认 RED**：运行定向测试确认旧实现会吞掉回执阶段、使用旧标题并错误进入通用失败。

### Task 2: 删除前标题过期与成功解绑的失败回归

**Files:**
- Modify: `electron/main/favoriteRepositorySyncService.test.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`（如现有删除错误映射测试所在文件不同，保持现有测试归属）

- [x] **Step 1: 写失败测试**：构造正式绑定 ID存在但目录标题已变更的快照，断言不调用 `deleteFolder`、返回稳定标题过期错误；保留标题一致且删除返回 `ok` 时的解绑回归。
- [x] **Step 2: 运行定向测试确认 RED**：运行同步服务定向测试确认旧实现使用通用错误，修复后定向回归通过。

### Task 3: 实现主进程绑定与渲染标题收口

**Files:**
- Modify: `electron/main/favoriteRepositoryBindingService.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `src/renderer/src/App.tsx`

- [x] **Step 1: 检查并格式化改名回执**：仅把明确 `status: 'ok'` 视为已受理；`rejected/unknown` 以 reason、HTTP 状态和 B 站 code 组成稳定错误，禁止提交。
- [x] **Step 2: 使用正式结果回写标题**：绑定服务返回的正式快照中提取同一逻辑册/分册/远端 ID的 `remoteTitle`；渲染层成功登记使用该标题和成员数，不再用候选旧标题覆盖本地偏好。
- [x] **Step 3: 保持非阻塞与幂等**：不增加改名次数、不按名称回退、不创建新夹；复读仍使用现有让出事件循环的延迟序列。
- [x] **Step 4: 运行绑定与 App 定向测试确认 GREEN**：绑定服务、运行时桥接和 App 定向测试通过。

### Task 4: 实现删除阶段错误与权威收尾

**Files:**
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [x] **Step 1: 稳定化标题过期错误**：在精确 ID存在但标题不一致时抛出可识别的阶段错误，保留绑定和删除候选，不调用 B 站删除。
- [x] **Step 2: 映射阶段化中文提示**：将标题过期、远端拒绝、结果未知和网络不可用映射为不同可读文案；成功仍只在远端确认后提交解绑。
- [x] **Step 3: 运行同步服务与 UI 定向测试确认 GREEN**：同步服务、删除反馈、收藏库和 IPC 定向测试通过。

### Task 5: 需求账本、全量验证与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`
- Create: `.codex-artifacts/favorite-backup-binding-delete-fix-*.log`

- [x] **Step 1: 回填账本**：逐条补充 I001–I016 的代码位置、自动化证据和真实 Electron 待验收条件；未能真实验证的项目明确标记。
- [x] **Step 2: 运行全量验证**：`npm test` 246 文件/4310 项通过，`npm run build` 通过，输出保存到 `.codex-artifacts/`；`git diff --check` 通过。
- [x] **Step 3: 检查隔离**：已运行 `git status --short --branch`、`git diff --stat`，确认修改集中于本轮项目书、设计/计划、账本、绑定/删除代码和测试；构建产物未纳入提交。
- [x] **Step 4: 提交**：在修复分支创建一次本地提交，提交信息为 `fix: close favorite rename binding and deletion state`。

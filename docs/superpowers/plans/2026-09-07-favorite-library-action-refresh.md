# 收藏库整理结束后操作与列表刷新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复整理结束后同步、删除、移动操作失效，并保证每次收藏库 revision 变化后摘要、列表、详情和选择状态及时收敛到同一最新快照。

**Architecture:** 复用现有 FavoriteLibraryApp `refresh()`、repository revision 订阅和主进程 action service，不新增绑定或对账语义。先以测试锁定整理结束后的操作与统一刷新契约，再用最小改动修复订阅/操作后的刷新竞争和旧 revision 使用问题。

**Tech Stack:** Electron 主进程、React/TypeScript 渲染器、Vitest、Testing Library。

---

### Task 1: 需求账本与刷新契约回归

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-07-favorite-library-actions-after-organization-discussion.md`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Test: `electron/main/favoriteRepositoryBatchOperationService.test.ts`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`

- [x] **Step 1: 写入本轮完整原文与 I004 索引**

保留 `R001` 原文不变，追加 `R002` 原文 `对列表没刷新这个问题很致命`，并记录 I004 的显示、状态、持久化和验收证据字段。

- [x] **Step 2: 写整理结束后的操作失败测试**

覆盖单视频/批量同步、删除、移动在 workspace 已结束时仍调用既有 API，并断言操作结果后触发刷新。

- [x] **Step 3: 写 revision 统一刷新失败测试**

覆盖 repository 事件带来新 revision 时，列表、摘要、详情和选择都收敛到同一 revision；已移出/删除项目从选择和详情清除，仍存在项目保留。

- [x] **Step 4: 运行定向测试确认 RED**

运行：`npx vitest run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteRepositoryBatchOperationService.test.ts electron/main/favoriteRepositorySyncService.test.ts`

预期：新增契约测试至少因当前刷新链路或测试夹具缺失而失败；若测试立即通过，调整断言使其确实覆盖当前缺陷。

### Task 2: 修复统一刷新链路

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify if required: `electron/main/favoriteRepositoryIpc.ts`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: 修复 repository 订阅**

任何影响页面投影的 revision 变化都调用同一 `refresh()`；不得只更新 summary 后留下旧 page/detail。同步进度若确实不影响页面，可仅更新运行进度，但同步完成、停止、删除、移动和整理结束必须完整刷新。

- [x] **Step 2: 修复操作收束竞争**

`runAction` 与 `runDetailAction` 在操作完成后等待最新快照；详情操作不再只更新 detail 而跳过列表/摘要。丢失的选择项清除，仍存在的选择映射到新 page 行。

- [x] **Step 3: 运行 RED 测试转 GREEN**

运行同 Task 1 定向命令，预期全部通过且无新的 TypeScript/Vitest 错误。

### Task 3: 保护同步、删除、移动的既有语义

**Files:**
- Modify only if tests prove necessary: `electron/main/favoriteRepositoryBatchOperationService.ts`, `electron/main/favoriteLibraryCommands.ts`, `electron/main/favoriteRepositorySyncService.ts`
- Test: corresponding existing service tests

- [x] **Step 1: 验证结束整理没有资格门控**

确认主进程与渲染器不按 workspace status 永久禁用同步、删除、移动；只保留目标不存在、无选择、远端事实未知等已有事实性提示。

- [x] **Step 2: 修复最小的旧 revision/刷新接口问题**

若测试发现操作本身仍使用错误 revision，只修复快照传递或 action 收束，不重写服务、不新增绑定/对账。

- [x] **Step 3: 运行服务回归测试**

运行：`npx vitest run electron/main/favoriteRepositoryBatchOperationService.test.ts electron/main/favoriteRepositorySyncService.test.ts`

### Task 4: 全量验证与账本收尾

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-07-favorite-library-actions-after-organization-discussion.md`

- [x] **Step 1: 运行全量测试、构建和 diff 检查**

运行：`npm test`、`npm run build`、`git diff --check`、`git status --short`。

- [x] **Step 2: 记录逐项代码位置与证据**

在 I001-I004 的验收证据中分别记录代码位置、自动化测试、构建结果和仍需真实 Electron 界面验收的条件；不得把一次总测试替代逐项证据。

- [ ] **Step 3: 提交本轮改动**

仅提交本轮账本、计划、测试和收藏库刷新修复，不合并 `main`，不修改用户数据或 B 站远端数据。

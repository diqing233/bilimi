# 仅从收藏库删除后隐藏远端镜像 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅从收藏库删除 bilimi 工作夹后，不再显示保留的 B 站镜像，同时继续保留其底层来源事实且不修改 B 站。

**Architecture:** 在本地删除成功时，将该工作夹已知的 B 站文件夹 ID 记入现有的“仅显式备册才允许重新发现”账户级集合。收藏库摘要接收这组 ID，仅从展示用的文件夹、计数和导航投影中排除相应 B 站镜像；原始 repository snapshot、成员关系和视频来源判断保持不变。显式备册既有地消费该集合，因而可重新发现/恢复该远端夹。

**Tech Stack:** TypeScript、Electron IPC、Vitest、React 收藏库界面。

---

### Task 1: 锁定展示过滤的失败回归测试

**Files:**
- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Test: `electron/main/favoriteRepositoryService.test.ts`

- [x] **Step 1: 添加失败测试**

创建一个含 `bilibili:9001` / `bilimi·音乐` 的远端镜像，并断言：向 `getLibrarySummary` 传入 `suppressedRemoteFolderIds: ['9001']` 时，摘要不返回该文件夹、不将其计入工作夹或其他收藏夹；`getSnapshot` 仍返回原镜像和成员关系。

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts`

Expected: FAIL，展示摘要仍含 `bilibili:9001`，证明当前代码会产生残留入口。

### Task 2: 在摘要边界实现隐藏投影

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Test: `electron/main/favoriteRepositoryService.test.ts`

- [x] **Step 1: 扩展摘要选项**

为 `getLibrarySummary` 加入 `suppressedRemoteFolderIds?: readonly string[]`，规范化为 ID 集合，仅过滤 `kind === 'bilibili'` 且 `remoteFolderId` 命中的展示用 folders。

- [x] **Step 2: 让所有摘要派生量使用过滤后的 folders**

`folderCount`、`folders`、`folderCounts`、`workspaceVideoCount` 与 `otherFavoriteVideoCount` 都从过滤后的投影计算；不得改写 snapshot、memberships、positions 或回收逻辑。

- [x] **Step 3: 重跑 Task 1 测试**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts`

Expected: PASS，且原始 snapshot 断言仍成立。

### Task 3: 将本地删除的远端 ID 接到摘要投影

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Test: `electron/main/favoriteRepositoryIpc.test.ts`

- [x] **Step 1: 添加失败 IPC 测试**

构造本地删除回调返回 `remoteDeleted: false` 且包含 ID `9001`，断言它记录到现有 `favoriteLedgerRemoteDraftRediscoveryPending` 集合；读取账户摘要时服务获得同一个隐藏 ID。远端删除 `remoteDeleted: true` 不得新增该隐藏标记。

- [x] **Step 2: 记录本地删除的 ID**

在 `FavoriteRepositoryManagedFolderService` 的 `onManagedFolderDeleted` 处理处，仅为 `remoteDeleted === false` 的删除调用 `markFavoriteLedgerRemoteDraftRediscoveryPending`；不改变 B 站删除调用、远端刷新条件或规则持久化。

- [x] **Step 3: 向账户摘要注入隐藏 ID**

给 repository IPC 选项增加只读的 `getSuppressedRemoteFolderIds`，并在 `open-account` / `get-snapshot` 调用 `getLibrarySummary` 时传入它。`index.ts` 用现有 pending-ID 读取器提供该选项。

- [x] **Step 4: 运行 IPC 与服务测试**

Run: `npm test -- electron/main/favoriteRepositoryIpc.test.ts electron/main/favoriteRepositoryService.test.ts`

Expected: PASS。

### Task 4: 端到端导航回归与交接

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `docs/requirement-ledgers/2026-09-12-local-only-delete-retained-remote-mirror.md`
- Modify: `docs/superpowers/plans/2026-09-12-local-only-managed-folder-hidden-remote-mirror.md`

- [x] **Step 1: 添加导航展示回归**

模拟摘要已过滤本地删除的镜像，断言工作夹分组没有 `0` 项、无操作入口；同时保留普通 B 站收藏夹和已备册逻辑工作夹的分组行为。

- [x] **Step 2: 运行相关回归与构建检查**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts electron/main/favoriteRepositoryIpc.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx && npm run build && git diff --check`

Expected: 全部通过，类型检查和打包构建无错误。

- [x] **Step 3: 记录验收与提交**

按 R001–R005 更新账本的代码位置、自动化证据和未能做的真实界面验收；只暂存本计划、账本和本任务代码/测试，排除 `%SystemDrive%/`，然后创建一次本地提交。

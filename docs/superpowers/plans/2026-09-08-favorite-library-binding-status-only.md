# 收藏库仅联动掌库备册状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 停止账户打开时把远端目录或旧扫描恢复为收藏库分册，仅复用掌库已确认的备册状态和既有仓库 revision 联动收藏库。

**Architecture:** 收藏库成员、归属和归档结果继续只由整理收藏的 `commit-local-plan` 写入；掌库创建、绑定、改名、删除完成后已有正式 `physicalShards` 与 revision 发布链继续驱动收藏库有界刷新。本轮只移除 `onAccountOpen` 中独立的远端/扫描恢复投影，不修改任何备册、同步、删除、复制、移动或回收站命令。

**Tech Stack:** Electron 主进程、TypeScript、Vitest、收藏库账号级 repository revision。

---

## 需求覆盖与状态

- 已确认：R001 — 禁止同名远端观察自动成为待确认分册，消除重复分册与错误成员来源。
- 已确认：R003 — 实际收藏库数据只由归档预览保存覆盖；备册状态不得写成员或归属。
- 已确认：R004 — 掌库备册状态复用既有 revision 联动；不另建系统、不在账户打开时单独读取 B 站；保护备册、同步、删除、复制、移动、回收站。
- 已确认：R005 — 用户确认最小方案。
- 被明确澄清：R002 由 R003 限定为“实时更新仅备册情况”。
- 待用户决定：无。账户打开的 pending 对账读取由 R004 排除；其既有 pending 检查点保留，等待下一次用户明确备册预检对账。

## 允许修改范围

- `electron/main/index.ts`
- `electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`
- `docs/requirement-ledgers/2026-09-08-favorite-library-duplicate-shards.md`
- 本计划文件

不修改：`src/shared/favoriteRepository.ts`、整理保存 `commit-local-plan`、备册/绑定服务、同步、复制、移动、删除、回收站、远端 API 及应用数据。

### Task 1: 为账户打开的无远端恢复边界建立失败回归

**Files:**

- Modify: `electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

- [x] **Step 1: 将旧的“账户打开继续远端恢复”结构断言替换为失败回归**

在现有 `describe` 中用以下测试替代只要求 `recoverPersistedManagedBindings` 存在的旧测试：

```ts
it('does not start a remote inventory or managed-folder restoration when the library account opens', () => {
  expect(mainSource).not.toContain("import { restoreFavoriteLibraryManagedFolderProjection } from './favoriteLibraryManagedFolderProjection'")
  expect(mainSource).not.toContain('onAccountOpen: async (accountMid) => {')
})
```

该测试直接防止账户打开恢复回调及其错误投影导入复活；不否定用户明确备册预检、结果未知检查点或正式 `physicalShards`。

- [x] **Step 2: 运行测试并确认 RED**

Run: `npm test -- electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

Expected: FAIL，断言报告当前 `onAccountOpen` 包含 `reconcilePendingBindingsFromRemote`、`recoverPersistedManagedBindings` 或 `restoreFavoriteLibraryManagedFolderProjection`。

### Task 2: 移除账户打开的错误恢复投影

**Files:**

- Modify: `electron/main/index.ts:121`
- Modify: `electron/main/index.ts:3213-3241`

- [x] **Step 1: 删除错误投影的生产导入**

删除：

```ts
import { restoreFavoriteLibraryManagedFolderProjection } from './favoriteLibraryManagedFolderProjection'
```

- [x] **Step 2: 删除 `registerFavoriteRepositoryIpc` 的 `onAccountOpen` 回调**

保留 `onAccountOpenLocal`，使首次快照继续只从仓库既有正式 `physicalShards` 投影掌库状态：

```ts
onAccountOpenLocal: async (accountMid) => {
  await reconcileFavoriteLedgerBindingProjection(accountMid)
},
```

删除整个如下回调及其仅供该回调使用的 `suppressedRemoteFolderIds` 构造：

```ts
onAccountOpen: async (accountMid) => {
  // reconcilePendingBindingsFromRemote(...)
  // recoverPersistedManagedBindings(...)
  // restoreFavoriteLibraryManagedFolderProjection(...)
},
```

这不删除 `FavoriteRepositoryBindingService.reconcilePendingBindingsFromRemote`、`OldFavoriteWorkspaceCoordinator.recoverPersistedManagedBindings` 或 `favoriteLibraryManagedFolderProjection` 文件本身：它们不再由账户打开或收藏库浏览执行，保留以免改变用户明确备册的既有 pending/恢复检查点语义。

- [x] **Step 3: 运行回归并确认 GREEN**

Run: `npm test -- electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

Expected: PASS，且账户打开不再调度独立 B 站目录读取、持久化扫描恢复或远端观察分册写入。

### Task 3: 保护既有命令与归档覆盖边界

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-08-favorite-library-duplicate-shards.md`

- [x] **Step 1: 运行定向回归组**

Run:

```powershell
npm test -- electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts electron/main/favoriteRepositoryBindingService.test.ts electron/main/favoriteRepositoryIpc.test.ts electron/main/favoriteRepositoryBatchOperationService.test.ts electron/main/favoriteRepositoryManagedFolderService.test.ts electron/main/favoriteLibraryCommands.test.ts electron/main/favoriteLibraryOperationsIpc.test.ts electron/main/favoriteRepositorySyncService.test.ts
```

Expected: PASS。覆盖正式备册/绑定、revision 发布、同步、删除、复制、移动、本地删除、恢复、回收站；并证明其未依赖账户打开的错误远端分册投影。

- [x] **Step 2: 运行类型/打包级构建**

Run: `npm run build`

Expected: exit code 0；没有已删除导入或 IPC 配置类型错误。

- [x] **Step 3: 在需求账本记录逐项代码和验证证据**

将 I001、I003、I004、I005 更新为“已实施待界面验收”或“已实施”，逐项写入实际代码位置、定向测试、构建结果和界面待验收条件。R002 保持“被 R003 明确澄清”。

### Task 4: 提交前核对与本地提交

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-08-favorite-library-duplicate-shards.md`
- Modify: `docs/superpowers/plans/2026-09-08-favorite-library-binding-status-only.md`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

- [x] **Step 1: 逐项回读 R001–R005 与索引表**

确认账户打开不再读 B 站或生成候选分册；正式备册状态仍来自掌库正式分册/revision；收藏库成员写入路径未改；受保护命令未改；不暂存或修改 `docs/requirement-ledgers/2026-09-08-save-round-to-library-disabled.md`。

- [x] **Step 2: 检查工作区和差异质量**

Run:

```powershell
git status --short
git diff --stat
git diff --check
```

Expected: 仅本任务四个文件有改动；无空白错误；无不相关账本被暂存。

- [x] **Step 3: 创建本地提交**

Run:

```powershell
git add electron/main/index.ts electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts docs/requirement-ledgers/2026-09-08-favorite-library-duplicate-shards.md docs/superpowers/plans/2026-09-08-favorite-library-binding-status-only.md
git commit -m "fix: stop restoring remote observations as library shards"
```

Expected: 仅本轮四个文件进入提交；不 push、不 merge、不改应用数据或 B 站状态。

## 自检

- 覆盖：R001、R003、R004、R005 分别由 Task 1–4 覆盖；R002 保留为 R003 的被澄清原文。
- 范围：没有新增远端发现/观察链路，没有改动归档成员覆盖、远端写入或受保护命令。
- 一致性：测试检查的三项调用均在 `index.ts` 同一账户打开回调；实现只删除该回调和唯一导入。

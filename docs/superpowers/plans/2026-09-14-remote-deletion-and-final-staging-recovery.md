# 远端删除隐藏与最终未匹配暂存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 远端删除工作夹后保持本地隐藏，并让有效未匹配视频只在最终本地入库成功后显示在正式 `bilimi·暂存`。

**Architecture:** 远端删除成功后，在同一账号互斥范围内先写已有的持久化隐藏标记，再提交已有本地删除投影；远端失败或未知不会进入这条路径。整理协调器继续使用 `local:inbox` 作为扫描期后台安全暂存，但最终保存/同步前的本地提交将未匹配成员物化为真实 `bilimi-logical:inbox`，其 B 站冻结计划仍默认排除 inbox。

**Tech Stack:** Electron main process、TypeScript、Vitest、收藏库仓库命令、账号偏好持久化。

---

## 文件结构

- `electron/main/favoriteRepositoryManagedFolderService.ts`：远端删除成功后本地投影的隐藏标记时机及账号级互斥。
- `electron/main/favoriteRepositoryManagedFolderService.test.ts`：远端成功、失败/未知与技术读取竞态的回归测试。
- `electron/main/oldFavoriteWorkspaceCoordinator.ts`：最终本地保存把未匹配成员写入正式 inbox 工作夹，而非仅后台暂存。
- `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`：保存与同步前本地入库的正式 inbox、扫描后台暂存与 B 站排除测试。
- `docs/项目功能项目书.md`：明确扫描期后台暂存与最终正式暂存的两阶段边界，以及远端删除隐藏语义。
- `docs/requirement-ledgers/2026-09-14-managed-folder-remote-deletion-and-unmatched-staging-regression.md`：记录每项代码位置、测试与界面验收状态。

### Task 1: 远端删除成功后的持久化隐藏

**Files:**
- Modify: `electron/main/favoriteRepositoryManagedFolderService.ts:90-100,247-370`
- Test: `electron/main/favoriteRepositoryManagedFolderService.test.ts`

- [ ] **Step 1: 写入远端成功但普通读取不应重建的失败测试**

```ts
await service.executeRemote('100', preview.executionToken, confirmationToken)
expect(markLocalManagedFoldersHidden).toHaveBeenCalledWith('100', ['music'])
expect(repository.commit).toHaveBeenCalledWith('100', expect.objectContaining({
  type: 'delete-local-managed-folder'
}))
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- electron/main/favoriteRepositoryManagedFolderService.test.ts`

Expected: FAIL，因为远端 `commitLocalProjection()` 还没有调用隐藏标记回调。

- [ ] **Step 3: 只在远端成功后的本地投影前持久化隐藏**

```ts
const commitProjection = async () => {
  await this.options.markLocalManagedFoldersHidden?.(accountMid, [this.logicalLedgerId(operation.logicalFolderId)])
  await this.commitLocalProjectionUnsafe(operation, snapshot)
}
await (this.options.runWithLocalManagedFolderDeletion
  ? this.options.runWithLocalManagedFolderDeletion(accountMid, commitProjection)
  : commitProjection())
```

调用点必须仅位于 B 站删除成功后的分支；复用对账发现远端已不存在后的相同投影路径。标记发布或本地提交失败时沿用结果未知/对账路径，不把远端失败/未知伪装成隐藏成功。

- [ ] **Step 4: 运行定向测试确认 GREEN**

Run: `npm test -- electron/main/favoriteRepositoryManagedFolderService.test.ts electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`

Expected: PASS。

### Task 2: 最终入库将有效未匹配项写入正式暂存

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:6088-6178`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] **Step 1: 写入“最终保存正式暂存、扫描期仍后台暂存”的失败测试**

```ts
await coordinator.saveWholeRunToLocalLibrary('100')
const snapshot = await repository.getSnapshot('100')
expect(snapshot.memberships['bilimi-logical:inbox']).toEqual([unmatchedAid])
expect(snapshot.memberships['local:inbox'] ?? []).toEqual([])
expect(snapshot.folders).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: 'bilimi-logical:inbox', kind: 'bilimi-logical', logicalLedgerId: 'inbox' })
]))
```

再断言冻结的默认同步计划不含该 AID；只有 `includeInbox: true` 的既有明确确认才可包含它。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: FAIL，因为当前最终提交只写 `local:inbox`。

- [ ] **Step 3: 将最终未匹配成员投影为真实 `bilimi-logical:inbox`**

```ts
const unmatchedFolderId = 'bilimi-logical:inbox'
const memberAidsByFolderId: Record<string, number[]> = { [unmatchedFolderId]: [] }
if (!targets.length) memberAidsByFolderId[unmatchedFolderId].push(item.aid)
// folders entry: kind 'bilimi-logical', logicalLedgerId 'inbox', local-only
```

同步冻结仍过滤 `id !== 'inbox'`，不改变默认不上 B 站；扫描期 `stageUnclassifiedSelectedVideos()`仍使用且只使用 `local:inbox`。

- [ ] **Step 4: 运行定向测试确认 GREEN**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteRepositoryService.test.ts src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

Expected: PASS。

### Task 3: 文档、全量回归与提交

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-14-managed-folder-remote-deletion-and-unmatched-staging-regression.md`

- [ ] **Step 1: 更新项目书和账本实施证据**

说明扫描/草稿阶段不显示 `local:inbox`；最终保存/同步本地提交后才以正式 `bilimi-logical:inbox` 显示未匹配项；远端删除成功后持久隐藏且技术读取不可恢复。

- [ ] **Step 2: 执行完整验证**

Run: `npm test`

Run: `npm run build`

Run: `git diff --check`

Expected: 所有命令退出码为 0；构建可保留既有动态导入警告。

- [ ] **Step 3: 按 R001/R002/R003 逐项回读并本地提交**

```powershell
git add -- <本轮代码、测试、项目书、账本和计划文件>
git commit -m "fix: preserve remote deletion and final staging"
```

提交后运行：`git status --short --branch` 和 `git log -1 --oneline`。不 push、不打包。真实 Electron 验收若仍受桌面控制服务阻断，账本中如实记录为待人工验收。

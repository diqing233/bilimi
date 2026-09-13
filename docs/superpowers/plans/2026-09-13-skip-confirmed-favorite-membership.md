# 跳过已确认目标成员：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新扫描生成冻结同步计划时，只对当前绑定的 bilimi 收藏夹中确实缺少的成员生成 B 站追加操作。

**Architecture:** 只有当前扫描暂存的、`remoteRelationship=bound` 且 ID 精确匹配物理绑定 shard 的成员，才能作为 `BoundRemoteShard.memberAids` 进入计划编译器；本地收藏库投影绝不能充当远端存在证据。编译器以这份证据构造不可变 `beforeFolderIds`，普通扫描同样计算“期望目标减去已观测目标”。完成扫描重建 manifest 时保留同一扫描的成员分块，确保冻结阶段仍可读取它。本地收藏库的 `commit-local-plan` 仍在冻结和远端执行前完成，因此跳过远端追加不改变保护记录或本地 memberships。既有冻结计划不重写，导航诊断不在本轮实现。

**Tech Stack:** TypeScript、Vitest、Electron 主进程共享计划编译器。

---

## 账本核对

### 已确认（按讨论顺序）

1. `I001`（R001）：本轮已证明旧计划会对已观测成员重复生成写入；作为诊断结论保留，不改当前冻结计划。
2. `I002`（R002、R003）：当前 `result-unknown` 的停机行为保持不变。
3. `I003`（R004）：不把本次异常误修为“重复收藏被 B 站拒绝”。
4. `I004`（R005）：不在本轮猜测或修改导航触发根因。
5. `I005`（R006）：当前恢复流程保持先对账后继续；不自动重试。
6. `I006`（R007）：对本轮可信扫描确认已在当前绑定 bilimi 目标中的成员，不生成 `append`；只投影至本地收藏库。
7. `I007`（R007）：导航轻量诊断的性能评估完成，但不在本轮实现。
8. `I008`（R008）：确认跳过不影响本地 `organizationRecords` 保护；作为回归边界验证。
9. `I009`（R009）：授权实施上述范围。

### 待用户决定

- 无。

### 被明确替代 / 明确不做

- 本轮不改当前已冻结的 223 项计划；其不可变边界由 I001、I005、I009 保留。
- 本轮不加入导航 URL/类型/WebView/阶段诊断；I007 只完成性能评估，I009 未授权实施。

### Task 1: 可信扫描成员的差集编译与冻结传递

**Files:**

- Modify: `src/shared/favoriteRepositoryExecutionPlan.test.ts:37-67`
- Modify: `src/shared/favoriteRepositoryExecutionPlan.ts:128-163`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:5145-5161`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:11211-11330`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts:288-327`

- [x] **Step 1: 写入会失败的回归测试。**

  将“捕获冻结远端成员”的断言改为普通扫描不会对同一已观测目标生成操作；再新增“同一视频已有音乐目标、缺少游戏目标时仅追加游戏目标”的测试。测试输入必须只使用 `shards.memberAids` 表示当前可信绑定目标的成员事实：

  ```ts
  expect(result.plan?.operations).toEqual([])

  expect(mixed.plan?.operations).toEqual([
    expect.objectContaining({
      aid: 1,
      kind: 'append',
      folderIds: ['remote-game'],
      beforeFolderIds: ['remote-music']
    })
  ])
  ```

- [x] **Step 2: 运行回归测试并确认红灯。**

  Run: `npm test -- src/shared/favoriteRepositoryExecutionPlan.test.ts`

  Expected: FAIL；普通扫描当前仍生成 `append:1:remote-music`，所以新“不生成操作”断言失败。

- [x] **Step 3: 实现最小差集并只传递可信扫描成员。**

  在 `compileFrozenFavoriteSyncPlan` 的 `!input.replaceManagedMemberships` 分支中，从 `desiredFolderIds` 排除 `beforeFoldersByAid.get(aid)` 中已经存在的目标；仅当差集非空时返回一个 `append`，其 `folderIds` 是该差集，`beforeFolderIds` 仍为完整的已观测目标集合。不要更改 shard 选择、容量计算、selection 的 remove/append 行为或冻结计划执行器。

  ```ts
  const appendedFolderIds = desiredFolderIds.filter(
    (folderId) => !beforeFoldersByAid.get(aid)?.has(folderId)
  )
  if (!input.replaceManagedMemberships) {
    return appendedFolderIds.length ? [{
      operationKey: `append:${aid}:${appendedFolderIds.join(',')}`,
      aid,
      kind: 'append' as const,
      folderIds: appendedFolderIds,
      beforeFolderIds
    }] : []
  }
  ```

  冻结协调器不得读取 `snapshot.memberships[shard.folderId]` 作为远端事实：该值可能已由本地先入库投影写入。改为读取工作区暂存成员；仅在扫描目录中该文件夹关系为 `bound` 且 ID 等于 `shard.remoteFolderId` 时传入；若扫描人数大于最新预检人数，则清空成员证据以免绕过容量检查。`OldFavoriteWorkspaceStore.create()` 在同一 workspace 完成扫描并重建 manifest 时保留既有 `scanRunId` 与 `managedMemberChunks`，使该证据能存活到冻结。

- [x] **Step 4: 重新运行专属测试并确认绿灯。**

  Run: `npm test -- src/shared/favoriteRepositoryExecutionPlan.test.ts`

  Expected: PASS；已存在目标无操作，缺少目标仅生成一条精确的 append，既有 selection 与容量测试继续通过。

- [x] **Step 5: 运行关联回归。**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteRepositorySyncService.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts src/shared/favoriteRepositoryExecutionPlan.test.ts --reporter=dot`

  Result: PASS；4 个文件、530 项测试。专属回归另行验证：编译器 10 项、工作区存储 40 项、协调器完整 392 项。覆盖已确认目标不追加、混合目标只追加缺失项、只有本地投影仍须追加、仅同次扫描的精确绑定目标可跳过，以及扫描成员数与最新预检容量矛盾时不信任该成员清单。

### Task 2: 账本证据、静态检查与提交

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-13-sync-result-unknown-diagnosis.md`
- Modify: `docs/superpowers/plans/2026-09-13-skip-confirmed-favorite-membership.md`

- [x] **Step 1: 逐项回读账本。**

  记录 I006 的实际代码位置、红绿测试命令与结果；记录 I001–I005、I007–I009 的非实现边界未被突破。

- [x] **Step 2: 运行完整质量门。**

  Run: `npm test && npm run build && git diff --check && git status --short && git diff --stat`

  Expected: 测试与构建成功、差异无空白错误，且仅包含本计划列出的共享编译器、测试、账本与计划文档。

  Result: `npm test` 通过（253 个文件、4633 项）；`npm run build` 通过。构建仅报告既有的动态/静态重复导入提示；全量测试输出仍包含既有 React `act(...)` 警告，但均不构成失败。`git diff --check` 通过；待提交文件只包含此计划列出的 5 个代码/测试文件和 2 份文档，`.codex-artifacts/` 中的输出未纳入提交。

- [x] **Step 3: 创建本地提交。**

  ```powershell
  git add electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceStore.ts src/shared/favoriteRepositoryExecutionPlan.ts src/shared/favoriteRepositoryExecutionPlan.test.ts docs/requirement-ledgers/2026-09-13-sync-result-unknown-diagnosis.md docs/superpowers/plans/2026-09-13-skip-confirmed-favorite-membership.md
  git commit -m "fix: skip confirmed favorite memberships"
  ```

  仅在 Task 2 Step 2 的实际输出通过且没有无关文件时提交；不 push、不 merge、不打包。

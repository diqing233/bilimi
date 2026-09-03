# Favorite Backup Rename and Dedup Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让显式备册的改名确认经受 B 站目录最终一致性延迟，并防止单目标绑定把其他已知远端收藏夹短暂投影为未保存未绑定草稿。

**Architecture:** 远端写入继续只接收用户本次确认的目标规则；远端观察则从完整账号规则、正式分册和待对账分册建立精确 `folderId` 覆盖集。改名后只对用户已确认的同一 ID 做有界复读，既不按标题寻找替代目标，也不创建第二个收藏夹。

**Tech Stack:** Electron、React、TypeScript、Vitest。

---

### Task 1: 项目书与可审计范围

**Files:**

- Modify: `docs/项目功能项目书.md` §9.5
- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`
- Create: `docs/superpowers/plans/2026-09-03-favorite-backup-rename-dedup-followup.md`

- [x] **Step 1: 记录 R011 原文、截图区域与根因证据**

  保留用户截图路径、完整原文和“单目标列表被误作全账号目录”的证据；索引明确“不按名称合并、不用延时隐藏、不改其他 B 站夹”。

- [x] **Step 2: 先更新项目书 §9.5**

  规定改名成功后的精确 ID 有界复读，以及 `backupTargetLedgerIds` 只能限制远端写入、不能限制全账号远端观察覆盖集。

### Task 2: RED — 精确 ID 改名的最终一致性确认

**Files:**

- Modify: `electron/main/favoriteRepositoryBindingService.test.ts`
- Modify: `electron/main/favoriteRepositoryBindingService.ts`

- [x] **Step 1: 写失败回归测试**

  模拟 `renameFolder` 已成功，但第一次改名复读仍返回旧标题、第二次才返回新标题。断言 `adoptExistingPhysicalShard` 只为已确认的 `game-2` 改名并最终登记为绑定：

  ```ts
  expect(renameFolder).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'game-2' }))
  expect(waitForInventoryRetry).toHaveBeenCalledWith(250)
  expect((await service.getBindings('100')).shards).toEqual([
    expect.objectContaining({ remoteFolderId: 'game-2', bindingState: 'bound' })
  ])
  ```

- [x] **Step 2: 运行 RED**

  运行：`npx vitest run electron/main/favoriteRepositoryBindingService.test.ts -t "confirms an explicitly renamed shard after its first inventory still has the old title"`

  预期：失败，当前代码在第一次改名复读仍为旧标题时立即抛出 `rename is not confirmed`。

- [x] **Step 3: 实施最小有界复读**

  将改名后的单次 `readFolderInventory` 替换为与现有“精确 ID 存在”相同的有界读取节奏 `[0, 250, 750]`：每次核验账号和唯一目标 ID，仅当标题匹配才继续正式绑定；耗尽后保留既有失败事实。不得查询、改名或绑定其他 ID。

- [x] **Step 4: 运行 GREEN**

  重新运行 Step 2 命令，预期通过；再运行该服务完整测试文件。

### Task 3: RED — 单目标绑定不得把其他正式夹投影为草稿

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/App.tsx`

- [x] **Step 1: 写脚本层失败回归**

  仅传入“生活日常”一个确认绑定目标；模拟 B 站目录包含该目标、两个已由同账号持有的远端 ID与一个真正陌生 ID。传入完整覆盖集后，断言结果只保留陌生 ID的远端观察草稿：

  ```ts
  expect(result.remoteOnlyDraftLedgerIds).toEqual([
    createRemoteObservationFavoriteLedgerId('unknown-folder')
  ])
  expect(result.ledgers).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ bilibiliFolderId: 'already-bound-folder' })
  ]))
  ```

- [x] **Step 2: 写 App 编排层失败回归**

  账号偏好只把本次目标传入保存请求，收藏仓库摘要另含其他正式和待对账 `physicalShards`。断言保存脚本载荷包含所有精确已知 ID，而远端写入目标仍只有当前目标 ID：

  ```ts
  expect(script).toContain('"remoteDraftKnownFolderIds":["bound-other","pending-other"]')
  expect(script).toContain('"nextLedgers":[{"id":"life"')
  ```

- [x] **Step 3: 运行 RED**

  运行：`npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx -t "does not project account-known folders as remote drafts during a single-target backup|passes complete repository coverage into a single-target backup"`

  预期：失败，因为脚本只由窄目标列表建立 `knownRemoteFolderIds`，且 App 没有传递完整仓库覆盖集。

### Task 4: GREEN — 分离写入目标与观察覆盖集

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Test: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 增加仅渲染端使用的精确 ID 覆盖字段**

  在 `FavoriteLedgerSaveOptions` 增加 `remoteDraftKnownFolderIds?: string[]`；保存脚本将它从远端写入选项中剥离，只传给 `projectRemoteOnlyDrafts`，并与本次脚本自身规则的 ID合并去重。该字段只能阻止重复观察，不改变创建、改名、绑定、成员同步或删除。

- [x] **Step 2: 从完整账号事实构建覆盖集**

  `App.tsx` 以“当前完整账号规则（历史规则加本次目标覆盖）”而不是窄目标列表读取一次收藏仓库摘要；覆盖集收集全部规则的 `bilibiliFolderId` / `bilibiliFolderIds`、所有正式分册 `remoteFolderId` 和待对账分册 `knownRemoteFolderIds`。然后只把目标规则送入保存脚本，同时以 `remoteDraftKnownFolderIds` 传入覆盖集。

- [x] **Step 3: 保持刷新与持久化边界**

  不把被覆盖的远端 ID构造成 `local-draft`，因此 `mergeBackupResultIntoLocalLedgers` 无临时草稿可写入；真正陌生的 ID继续沿原结果合并路径持久化。沿用现有单飞、异步状态刷新，不增加额外 B 站目录请求。

- [x] **Step 4: 运行 GREEN 和相关回归**

  重新运行 Task 3 命令，预期通过；再运行：

  ```powershell
  npx vitest run src/renderer/src/App.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.test.ts electron/main/favoriteRepositoryBindingService.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
  ```

### Task 5: 完整验证、账本回填与提交

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-03-favorite-backup-rename-dedup.md`
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/superpowers/plans/2026-09-03-favorite-backup-rename-dedup-followup.md`

- [x] **Step 1: 检查范围和静态错误**

  运行 `git diff --check`、`git diff --stat`、`git status --short`；确认只含项目书、账本、计划、上述三个生产文件及对应测试。

- [x] **Step 2: 跑全量自动化与构建**

  运行 `npm test` 和 `npm run build`，将完整输出写入 `.codex-artifacts/`；全量测试或构建失败时保留现场，不提交。

- [x] **Step 3: 真实 Electron 验收（登录态缺失，保留待验收）**

  仅在开发版使用现有账号复现：将一个已绑定 B 站夹改名→备册→确认绑定，验证改名成功后不误报失败；再确认绑定一个目标时观察右侧，已知其他夹不再闪现，真正未知夹仍符合现有观察规则。持续检查鼠标移动、点击、滚动、缩放、最小化、恢复和关闭；若无法获得真实账号情形，在账本中保留“待界面验收”，不得声称已验收。

- [x] **Step 4: 逐项回填并提交**

  将 I008/I009 的实际代码位置、RED/GREEN命令、全量验证、真实界面证据或缺口回填账本。重新通读 R001–R011 与索引，确认无范围外文件后执行一次本地 `git commit`；不推送、不合并、不修改 B 站数据。

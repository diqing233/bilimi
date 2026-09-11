# 收藏夹发现统一处理弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个可批量处理的发现弹窗同时处理疑似 bilimi 收藏夹草稿和已绑定收藏夹改名；查看详情不备册，备册入口处理后继续原有备册。

**Architecture:** 在 `FavoriteLedgerOverview` 以内聚的 `RemoteDiscoveryProcessingDialog` 状态取代当前只读详情、疑似草稿确认和改名确认三套独立弹窗。它保存一次发现快照、两类默认选中的条目、原始备册目标及入口模式；统一处理器先持久化选中的本地草稿，再用精确预检元组改名选中的已绑定分册，最后仅在备册模式重入既有 `requestBackup`。`App` 新增一个只执行已确认改名的窄操作，保留每个远端分册的二次精确核验，同时绝不创建、绑定、备册或同步视频。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Electron preload IPC、现有 B 站收藏夹 API 自动化。

---

## 文件结构与责任

- `src/shared/types.ts`：为已有 `FavoriteLedgerSaveOptions` 增加“仅确认改名”选项，使渲染层能请求受限的远端改名而不借用备册语义。
- `src/renderer/src/App.tsx`：在 `saveFavoriteLedgers` 里处理该选项；只读预检仍在确认前完成，确认时只对提供的精确分册执行改名，跳过备册脚本、创建、绑定登记、视频同步和发现提示唤醒副作用。
- `src/renderer/src/App.test.tsx`：验证“仅改名”的白名单副作用、精确元组失效保护和正常备册路径不被改变。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`：合并三个发现弹窗、建立统一选择模型、按入口显示唯一主按钮、批量持久化草稿与调用只改名操作，并仅在备册入口续跑 `requestBackup`。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`：驱动并锁定统一弹窗的布局、默认选择、关闭、跨组全选、分组分隔、两条处理路径以及失败阻断。
- `src/renderer/src/styles.css`：为统一弹窗的选择区、两组条目、水平分隔线和窄屏滚动添加局部样式，不调整其他弹窗。
- `docs/requirement-ledgers/2026-09-11-one-click-backup-unbound-notice-order.md`：按 R019-R028 逐项记录真实代码位置、自动化结果和真实 Electron 待验收项。

### Task 1: 定义只改名的受限运行时选项

**Files:**
- Modify: `src/shared/types.ts:119-127`
- Modify: `src/renderer/src/App.tsx:3480-3700`
- Test: `src/renderer/src/App.test.tsx`（紧邻现有 `confirmBoundRename` 运行时测试，约第 4340 行）

- [ ] **Step 1: 编写失败测试，锁定查看详情改名不进入备册脚本**

  在 `App.test.tsx` 的现有已绑定改名测试之后添加测试。准备一个 `bindingState: 'bound'` 的 `game` 工作夹和 `renameFavoriteRepositoryBoundLedgerShard` mock；用 `requestRuntime` 发出：

  ```ts
  const result = await requestRuntime({
    id: 'discovery-rename-only',
    type: 'save-ledgers',
    ledgers: [game],
    options: {
      backupTargetLedgerIds: ['game'],
      renameBoundOnly: true,
      confirmBoundRename: true,
      boundRenameShards: {
        game: [{
          remoteFolderId: '4106106611',
          shardNumber: 1,
          currentRemoteTitle: 'bilimi·旧游戏',
          targetTitle: 'bilimi·游戏'
        }]
      }
    }
  })

  expect(result).toMatchObject({ ok: true, message: '已按掌库当前名称完成已绑定收藏夹改名。' })
  expect(renameFavoriteRepositoryBoundLedgerShard).toHaveBeenCalledTimes(1)
  expect(executeJavaScript).not.toHaveBeenCalledWith(expect.stringContaining('buildSaveFavoriteLedgersScript('))
  expect(savePreferences).toHaveBeenCalledTimes(1)
  ```

  如现有 `executeJavaScript` mock 按脚本文本而不是函数名断言，改用现有保存脚本的特有字串（例如 `favorite:ledger:add`）来证明没有调用写入备册脚本。另加一个测试：`boundRenameShards` 的远端 ID 与新读取的精确预检不一致时返回 `ok: false`，且 rename bridge 不被调用。

- [ ] **Step 2: 运行新测试并确认失败**

  Run:

  ```powershell
  npm test -- src/renderer/src/App.test.tsx --reporter=dot --maxWorkers=1 --minWorkers=1
  ```

  Expected: 新测试失败，因为 `renameBoundOnly` 尚未是类型字段，也尚未有跳过 `buildSaveFavoriteLedgersScript` 的运行时分支。

- [ ] **Step 3: 增加严格类型和运行时短路分支**

  在 `FavoriteLedgerSaveOptions` 的 `confirmBoundRename` 字段后增加：

  ```ts
  /** Process only explicitly confirmed formal bound-shard renames; do not create, bind, back up, or synchronize videos. */
  renameBoundOnly?: boolean
  ```

  在 `saveFavoriteLedgers()` 中，保持 `requireBilibiliLogin()`、`readBilibiliAccountMid()`、`projectFavoriteLedgersToFormalBindings()`、`readBoundRenameCandidatesForTargets()`、`matchesBoundRenamePreflight()` 和 `renameExplicitlyBoundFavoriteLedgers()` 原样可用。紧接 `directRename` 成功、且 `options?.renameBoundOnly === true` 时：

  ```ts
  const renamedResult = {
    ok: true,
    steps: ['favorite:bound-shard-rename'],
    missingTargets: [],
    message: '已按掌库当前名称完成已绑定收藏夹改名。',
    ledgers: directRename.ledgers
  } satisfies AssistantAutomationResult & { ledgers: FavoriteLedger[] }
  ```

  将 `directRename.failures` 分支保留在此短路之前，保证任何失败都返回 `ok: false`。在返回成功前，仅通过既有 `preferencesWithFavoriteLedgers`、`createInitialAssistantPreferences`、`savePreferences` 持久化 `directRename.ledgers`，并更新 `preferencesRef`/`setPreferences`/快照通知；不得调用：

  ```ts
  buildSaveFavoriteLedgersScript(...)
  registerNewFavoriteLedgerBindings(...)
  refreshFavoriteSpaceAfterConfirmedPageCreate(...)
  clearFavoriteDiscoveryNoticeDismissal(...)
  ```

  `hasRemoteSaveOptions` 必须将 `options?.renameBoundOnly` 纳入远端操作判定，避免走纯本地保存分支。若 `renameBoundOnly` 与未确认或空 `boundRenameShards` 同时给入，则现有 `boundRenameCandidates`/`matchesBoundRenamePreflight` 的 fail-closed 返回必须保持生效。

- [ ] **Step 4: 运行 App 定向测试并确认通过**

  Run:

  ```powershell
  npm test -- src/renderer/src/App.test.tsx --reporter=dot --maxWorkers=1 --minWorkers=1
  ```

  Expected: PASS；新测试证明查看详情的改名只调用精确 rename bridge 和偏好持久化，预检变动时不写 B 站。

- [ ] **Step 5: 创建本地检查点提交**

  ```powershell
  git add src/shared/types.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx
  git commit -m "feat: support confirmed favorite rename without backup"
  ```

### Task 2: 以统一处理模型替换分裂的发现状态

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:94-130, 482-530, 1060-1190, 1733-1835`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx:15-80, 2660-2905`

- [ ] **Step 1: 编写失败组件测试：查看详情用一个默认全选的双分组处理弹窗**

  替换文件开头现有 `opens read-only combined remote detection details...` 测试。测试使用一条 `observedRemoteObservations` 和一条 `observedBoundRenameCandidates`，点击“查看详情”后断言：

  ```ts
  const dialog = screen.getByRole('dialog', { name: '发现待处理的 bilimi 收藏夹' })
  expect(within(dialog).getByText('疑似 bilimi 收藏夹（1）')).toBeInTheDocument()
  expect(within(dialog).getByText('已绑定收藏夹名称变更（1）')).toBeInTheDocument()
  expect(dialog.querySelector('.favorite-ledger-panel__remote-discovery-divider')).not.toBeNull()
  expect(within(dialog).getByRole('checkbox', { name: '全选（共 2 项）' })).toBeChecked()
  expect(within(dialog).getByRole('checkbox', { name: 'bilimi·远端观察（2 个视频）' })).toBeChecked()
  expect(within(dialog).getByRole('checkbox', { name: 'bilimi·旧游戏 → bilimi·游戏（2 个视频）' })).toBeChecked()
  expect(within(dialog).getByRole('button', { name: '开始处理' })).toBeEnabled()
  expect(within(dialog).queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
  ```

  再断言说明文本有“处理不会启动备册。”，且页面没有旧的“检测到 B 站中有 … 疑似 bilimi 工作夹”长提示。

- [ ] **Step 2: 运行组件测试并确认失败**

  Run:

  ```powershell
  npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot --maxWorkers=1 --minWorkers=1
  ```

  Expected: FAIL；当前标题为“检测到疑似 bilimi 收藏夹”，打开时全部未选中且没有主处理按钮/分组分隔线。

- [ ] **Step 3: 定义单一弹窗状态与打开/清理函数**

  删除 `RemoteObservationDialogMode`、`remoteObservationDialogMode`、`remoteObservations`、`selectedRemoteObservationFolderIds`、`pendingBoundRenameCandidates`、`remoteDetectionDetailsVisible`、`selectedRemoteDetectionDetailIds`、`boundRenameCandidates` 所产生的发现处理职责；保留无关的 rebind 确认状态。

  在 `FavoriteLedgerOverview.tsx` 定义：

  ```ts
  type RemoteDiscoveryProcessingMode = 'details' | 'backup'

  type RemoteDiscoveryProcessingState = {
    mode: RemoteDiscoveryProcessingMode
    observations: RemoteFavoriteLedgerObservation[]
    renameCandidates: FavoriteLedgerBoundRenameCandidate[]
    backupTargetLedgerIds: string[]
  }
  ```

  使用以下 React state：

  ```ts
  const [remoteDiscoveryProcessing, setRemoteDiscoveryProcessing] = useState<RemoteDiscoveryProcessingState | null>(null)
  const [selectedRemoteObservationFolderIds, setSelectedRemoteObservationFolderIds] = useState<ReadonlySet<string>>(() => new Set())
  const [selectedBoundRenameShardKeys, setSelectedBoundRenameShardKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [remoteDiscoveryProcessingError, setRemoteDiscoveryProcessingError] = useState<string | null>(null)
  const [remoteDiscoveryProcessingBusy, setRemoteDiscoveryProcessingBusy] = useState(false)
  ```

  添加稳定的 shard key helper：

  ```ts
  const boundRenameShardKey = (ledgerId: string, shard: FavoriteLedgerBoundRenameCandidate['shards'][number]) =>
    `${ledgerId}:${shard.remoteFolderId}:${shard.shardNumber}`
  ```

  `openRemoteDiscoveryProcessing(mode, observations, renameCandidates, backupTargetLedgerIds)` 必须复制快照、清空错误、并将全部 `folderId` 与全部 shard key 放入各自 selected set；`closeRemoteDiscoveryProcessing()` 在非 busy 时清空整个 state 和选中集。备册模式关闭不得调用 `requestBackup`，从而完整取消该轮。

  将“查看详情”按钮改为：

  ```ts
  onClick={() => openRemoteDiscoveryProcessing(
    'details',
    observedRemoteObservations,
    observedBoundRenameCandidates,
    []
  )}
  ```

  仅保留精简摘要与“查看详情”“暂不提醒”；删除 `recoveredRemoteLedgers` 对应的列表下方长提示 JSX。不要移除单个草稿编辑器里的 `remote-draft-notice`，它不是图三红框。

- [ ] **Step 4: 渲染统一弹窗**

  使用 `OldFavoriteModal`，固定标题 `发现待处理的 bilimi 收藏夹`，不传 `extraActions`，以 `onCancel={closeRemoteDiscoveryProcessing}` 提供唯一右上角关闭。主按钮：

  ```tsx
  confirmLabel={remoteDiscoveryProcessing.mode === 'backup' ? '确认处理并继续备册' : '开始处理'}
  confirmDisabled={
    remoteDiscoveryProcessingBusy || destructiveActionLocked ||
    (selectedRemoteObservationFolderIds.size === 0 && selectedBoundRenameShardKeys.size === 0)
  }
  ```

  正文使用已确认文案：

  ```tsx
  <p>发现以下 B 站收藏夹需要你确认处理。疑似收藏夹将生成本地草稿；已绑定收藏夹的名称变更将同步修改到 B 站。不会自动绑定或创建收藏夹。</p>
  <p>{remoteDiscoveryProcessing.mode === 'backup' ? '确认处理后将继续执行备册。' : '处理不会启动备册。'}</p>
  ```

  将观察项与改名分册平铺为统一的 choice count。顶部 `aria-label="全选（共 ${total} 项）"` 勾选跨两个集合；用现有 ref 模式提供 indeterminate。两类均非空时输出：

  ```tsx
  <div className="favorite-ledger-panel__remote-discovery-divider" role="separator" />
  ```

  分组标题、每行 `aria-label` 必须与 Step 1 的断言一致；单类时不得生成空组或 divider。

- [ ] **Step 5: 运行组件测试并确认通过**

  Run:

  ```powershell
  npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot --maxWorkers=1 --minWorkers=1
  ```

  Expected: PASS；新详情弹窗默认全选、跨组全选、没有取消按钮、且旧长提示不再出现。

- [ ] **Step 6: 创建本地检查点提交**

  ```powershell
  git add src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx
  git commit -m "feat: unify favorite discovery processing dialog"
  ```

### Task 3: 用一次处理完成草稿、改名和可选备册续跑

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1733-1835`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx:2660-2905`

- [ ] **Step 1: 编写失败测试：查看详情批量处理两种条目但不备册**

  添加测试，使用“一个 observation + 一个 rename candidate”的详情弹窗，点击 `开始处理`。令 `onSaveLedgers` 返回 `{ ok: true }`、`onSyncLedgers` 返回 `{ ok: true }`。断言：

  ```ts
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({
      id: createRemoteObservationFavoriteLedgerId('88'),
      bindingState: 'unbound',
      syncState: 'local-draft',
      pendingRemoteBinding: true,
      pendingRemoteFolderId: '88'
    })
  ]), { deleteDisabled: false }))

  expect(sync).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
    backupTargetLedgerIds: ['game'],
    renameBoundOnly: true,
    confirmBoundRename: true,
    boundRenameShards: { game: [{
      remoteFolderId: '4106106611', shardNumber: 1,
      currentRemoteTitle: 'bilimi·旧游戏', targetTitle: 'bilimi·游戏'
    }] }
  }))
  expect(sync).toHaveBeenCalledTimes(1)
  ```

  断言不会显示 `备册收藏夹` 的忙状态，也不会向 `onBackupConfirmationFinished` 发送成功结果。再取消观察项和改名项中的各一个，确认未选项不出现在 save 的新草稿或 `boundRenameShards` 中。

- [ ] **Step 2: 编写失败测试：备册入口处理后才继续原始目标，关闭无副作用**

  使用备册按钮触发预检，mock 第一次 `onSyncLedgers` 返回 observation 和 rename candidate。断言弹窗主按钮为“确认处理并继续备册”，点击右上角 `关闭弹窗` 后：

  ```ts
  expect(save).not.toHaveBeenCalled()
  expect(sync).toHaveBeenCalledTimes(1)
  ```

  在独立测试中点击主按钮，mock 调用顺序为“预检”“renameBoundOnly”“最终备册”，断言最后一次为：

  ```ts
  expect(sync).toHaveBeenLastCalledWith(expect.any(Array), {
    backupTargetLedgerIds: ['music'],
    deleteDisabled: false,
    rediscoverDeletedRemoteDrafts: true
  })
  ```

  其中 `music` 是原始备册目标，不能将新生成的远端草稿加入该次备册目标。

- [ ] **Step 3: 运行新增测试并确认失败**

  Run:

  ```powershell
  npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot --maxWorkers=1 --minWorkers=1
  ```

  Expected: FAIL；当前实现先弹草稿确认、再弹改名确认，且备册路径没有 `renameBoundOnly` 处理阶段。

- [ ] **Step 4: 实现统一处理器**

  用 `processRemoteDiscoverySelection()` 替换 `confirmRemoteObservations()` 和 `confirmBoundRename()` 的发现处理职责。实现必须遵循这个顺序：

  1. 读取 `remoteDiscoveryProcessing` 的不可变快照；若无 state、已 busy 或 `destructiveActionLocked`，立即返回。
  2. 由 observation selected set 生成未存在的 `FavoriteLedger` 本地草稿，字段与旧 `confirmRemoteObservations()` 完全一致。无选中 observation 时不调用 `onSaveLedgers`。
  3. 保存草稿失败时在同一弹窗设置 `remoteDiscoveryProcessingError`，保留选中和弹窗；不得改名或备册。
  4. 将 selected shard keys 还原成 `FavoriteLedgerBoundRenameCandidate[]`，保留原逻辑工作夹/分册结构。构建：

     ```ts
     const boundRenameShards = Object.fromEntries(selectedRenameCandidates.map((candidate) => [
       candidate.ledgerId,
       candidate.shards.map((shard) => ({
         remoteFolderId: shard.remoteFolderId,
         shardNumber: shard.shardNumber,
         currentRemoteTitle: shard.currentRemoteTitle,
         targetTitle: shard.targetTitle
       }))
     ]))
     ```

  5. 只有 `selectedRenameCandidates.length > 0` 时调用：

     ```ts
     await onSyncLedgers(projectEnabled(nextLedgers), {
       backupTargetLedgerIds: selectedRenameCandidates.map((candidate) => candidate.ledgerId),
       deleteDisabled: false,
       rediscoverDeletedRemoteDrafts: true,
       renameBoundOnly: true,
       confirmBoundRename: true,
       boundRenameShards
     })
     ```

     对 `{ ok: false }` 或 `boundRenameCandidates` 重新出现，留在弹窗显示实际 message；不得开始备册。
  6. 详情模式：草稿/改名成功后关闭弹窗并更新 `draftLedgersRef`、`draftLedgers`、stores 和 saved snapshots；不调用 `requestBackup()` 或 `onBackupConfirmationFinished()`。
  7. 备册模式：所有选中处理成功后关闭弹窗，调用：

     ```ts
     await requestBackup({
       targetLedgerIds: processing.backupTargetLedgerIds,
       skipRemoteObservationPreflight: true
     })
     ```

     仅将原始备册 target IDs 传回；任何草稿不自动加入。处理失败保持弹窗并停止该调用。
  8. `finally` 清除 busy 标记。`OldFavoriteModal` 在 busy 时禁用 `×`，因此无法在远端写入途中取消半个操作。

  `save()` 里“保存规则后发现”与 `requestBackup()` 里预检都改为调用 `openRemoteDiscoveryProcessing()`；预检只发现改名、没有 observation 时也必须打开统一弹窗，不得回退到旧 `setBoundRenameCandidates` 弹窗。

- [ ] **Step 5: 添加失败状态和可重试断言**

  添加一个组件测试：草稿保存返回 `{ ok: false, message: '本地草稿未能保存。' }` 时，统一弹窗保持打开、显示该 message、`onSyncLedgers` 不被调用、备册不继续。再添加改名返回 `{ ok: false, message: 'B 站改名被拒绝。' }` 时，弹窗保持打开且最终备册调用数保持在预检加 rename 两次。

- [ ] **Step 6: 运行组件测试并确认通过**

  Run:

  ```powershell
  npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot --maxWorkers=1 --minWorkers=1
  ```

  Expected: PASS；查看详情只处理选择的草稿/改名，备册入口处理成功后仅备册原始目标，关闭无后续副作用，两个失败路径都 fail closed。

- [ ] **Step 7: 创建本地检查点提交**

  ```powershell
  git add src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx
  git commit -m "feat: process favorite discoveries in one confirmation"
  ```

### Task 4: 添加分组、分隔线与响应式样式

**Files:**
- Modify: `src/renderer/src/styles.css:4890-5030, 8560-8565`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [ ] **Step 1: 编写失败测试：单类不显示分隔线，双类只显示一条**

  添加两个测试：

  ```ts
  expect(dialog.querySelectorAll('.favorite-ledger-panel__remote-discovery-divider')).toHaveLength(1)
  ```

  用两类数据验证第一条；再只提供 `observedRemoteObservations` 验证：

  ```ts
  expect(dialog.querySelector('.favorite-ledger-panel__remote-discovery-divider')).toBeNull()
  expect(within(dialog).queryByText(/已绑定收藏夹名称变更/)).not.toBeInTheDocument()
  ```

- [ ] **Step 2: 运行组件测试并确认失败**

  Run:

  ```powershell
  npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot --maxWorkers=1 --minWorkers=1
  ```

  Expected: FAIL，直至 Task 2 的 JSX 完整落地；如果 Task 2 已使结构通过，本步骤在写 CSS 前可直接通过，因为结构语义由 JSX 保障。

- [ ] **Step 3: 写局部 CSS，不影响已有重绑/删除弹窗**

  在 `styles.css` 中紧挨 `.favorite-ledger-panel__rebind-choice` 添加：

  ```css
  .favorite-ledger-panel__remote-discovery-groups {
    display: grid;
    gap: 12px;
    max-height: min(42vh, 360px);
    overflow-y: auto;
    padding-right: 4px;
  }
  .favorite-ledger-panel__remote-discovery-group {
    display: grid;
    gap: 7px;
  }
  .favorite-ledger-panel__remote-discovery-group > h3 {
    margin: 0;
    color: var(--porcelain-deep);
    font-size: 14px;
    font-weight: 700;
  }
  .favorite-ledger-panel__remote-discovery-choice {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    min-width: 0;
    line-height: 1.5;
  }
  .favorite-ledger-panel__remote-discovery-divider {
    height: 1px;
    border: 0;
    background: rgba(31, 99, 181, 0.26);
  }
  ```

  在已存在的窄屏 media query 中，确保 `.favorite-ledger-panel__remote-discovery-groups` 最大高度不超过视口且不裁掉底部唯一主按钮。不得改变 `.favorite-ledger-panel__notice`、`.favorite-ledger-panel__rebind-choice` 或 `OldFavoriteModal` 全局动作布局。

- [ ] **Step 4: 运行组件样式结构回归**

  Run:

  ```powershell
  npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot --maxWorkers=1 --minWorkers=1
  npm run build
  ```

  Expected: PASS；构建完成，无 TypeScript 或 CSS 导入错误。

- [ ] **Step 5: 创建本地检查点提交**

  ```powershell
  git add src/renderer/src/styles.css src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx
  git commit -m "style: group favorite discovery processing choices"
  ```

### Task 5: 全链路回归、账本核对和单次最终提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-11-one-click-backup-unbound-notice-order.md`

- [ ] **Step 1: 运行受影响的定向回归**

  ```powershell
  npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx src/renderer/src/features/browser/BiliWebview.test.tsx --reporter=dot --maxWorkers=1 --minWorkers=1
  ```

  Expected: PASS；覆盖只改名 API 边界、统一弹窗、原备册入口、暂不提醒、跨页发现缓存和手动创建/改名/删除/刷新发现链路。

- [ ] **Step 2: 运行完整自动化和构建验证**

  ```powershell
  npm test -- --reporter=dot --maxWorkers=1 --minWorkers=1
  npm run build
  git diff --check
  git status --short
  git diff --stat
  ```

  Expected: 全部通过；`git diff --check` 无输出；除账本、实现、测试和样式之外，不新增本轮文件。保留且不暂存原有无关的 `%SystemDrive%/`。

- [ ] **Step 3: 按需求账本逐项记录实施证据**

  在 R019-R028 索引行中填写：实际文件/函数、每一项的定向测试名、全量测试/构建结果和真实 Electron 待验收状态。明确记录：

  - R019：图三红框长提示已移除，但草稿编辑器内的单项提醒未变；右侧精简“查看详情 / 暂不提醒”保留。
  - R021、R025、R026：默认全选、全选跨组、双组上下和 divider、无底部取消、`×` 的两个入口语义。
  - R022-R024：详情仅处理、备册处理后续跑、关闭完整取消且无本地/B 站副作用。
  - R023：按钮精确文案“开始处理”和“确认处理并继续备册”。
  - R028：所有处理失败停止后续备册，精确分册预检失效不会写入。

- [ ] **Step 4: 在真实 Electron 开发版进行必要界面验收**

  用同一 B 站账号分别取得：仅疑似、仅名称变更、两类同时存在三种状态。逐项确认文字、组标题、顶部默认全选、部分选择、横线、按钮文案、无取消按钮和右上角 `×`。从查看详情确认只生成草稿/改名而不触发备册；从备册入口确认处理后继续原有备册，并在 `×` 后确认没有草稿、改名或备册。再验证右侧长提示已移除、精简摘要/暂不提醒/跨网页持久化仍正常。若自动化环境无法控制真实 Electron，记录为“待用户验收”，不得以单元测试替代。

- [ ] **Step 5: 做最终账本回读、状态检查和本地提交**

  从头阅读需求账本的 R019-R028 原文和索引，以及设计规格。确认所有确认项均有代码位置和验证证据；对未能进行的真实 Electron 验收逐项标记“已实施待真实界面验收”。

  ```powershell
  git add -- docs/requirement-ledgers/2026-09-11-one-click-backup-unbound-notice-order.md
  git diff --cached --check
  git commit -m "docs: record unified favorite discovery processing verification"
  git status --short --branch
  ```

  Expected: 只提交本轮代码、测试、样式和账本；不 push、merge、rebase、reset、stash 或接触 `%SystemDrive%/`。

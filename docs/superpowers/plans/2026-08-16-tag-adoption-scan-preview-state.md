# 标签采用、推荐收藏夹与扫描概览状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使标签采用后的当前批控制、推荐收藏夹取消/删除投影，以及备册关系刷新符合 `2026-08-16-tag-adoption-scan-preview-state` 需求账本和项目书的最终产品契约。

**Architecture:** 标签状态由工作区快照中当前批专属字段决定，渲染层只选择准确文案。推荐候选的勾选和取消继续由工作区 `set-recommended-candidates` 作为唯一权威操作；已取消的纯本地投影在该操作成功后才从顶端卡片临时收束，直到偏好快照同步。扫描来源关系则在主进程从本地收藏库的真实物理分片重新投影并持久化到工作区覆盖层，绝不由名称或旧缓存猜测。

**Tech Stack:** TypeScript、React 19、Vitest、Electron IPC、`FavoriteRepositoryService`、`OldFavoriteWorkspaceCoordinator`。

---

## 文件与职责

- `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`：扫描概览的当前批标签控制、远端用户收藏夹短状态及页面区域。
- `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`：按钮文案、跨批状态、来源资格与扫描概览隐藏区域回归。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`：详情删除和删除模式对推荐候选的一致路由。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`：独立掌库删除模式只发起推荐取消、不发起远端或重复本地删除的回归。
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`：当前批推荐操作成功后的顶端卡片投影收束与跨页面刷新。
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`：下方取消后上方卡片同步移除、失败不移除、远端实体保留的集成回归。
- `electron/main/oldFavoriteWorkspaceCoordinator.ts`：根据当前仓库物理分片重投影已扫描远端夹的关系、来源资格、选中状态、本地工作区投影和指标。
- `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`：关系变化后的 `已备册`、`未绑定`/待对账、来源禁用和持久恢复回归。
- `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`：只读本地关系刷新命令的输入校验和分发。
- `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`：备册/规则保存成功后获取刷新过的工作区与助手快照。
- `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`：归档预览按共享扫描资格筛选当前批来源，避免旧兼容标记覆盖新的关系投影。
- `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`：解除关系后重新选择来源仍显示在归档预览中的回归。
- `docs/requirement-ledgers/2026-08-16-tag-adoption-scan-preview-state.md`：按 R001、R002、R003、R005 记录实际代码位置、自动化验证和真实界面验收。

### Task 1: 锁定当前批标签恢复语义（R001）

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx:598-640`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:287-295`
- Regression: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:3034-3120`

- [x] **Step 1: 先写 UI 红灯用例，覆盖采用完当前批但其他批仍在读取的快照。**

  在 `OldFavoriteScanOverviewStep.test.tsx` 新增快照：当前批 `currentSegmentCanResumeTagEnrichment: true`、`pendingItemCount: 1`、全局 `status: 'running'`。断言存在且只能存在：

  ```tsx
  expect(screen.getByRole('button', { name: '继续扫描标签' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '暂停补取标签' })).not.toBeInTheDocument()
  ```

  再点击按钮并断言 `onResumeTagEnrichment` 被调用一次，以证明继续入口不变。

- [x] **Step 2: 运行红灯用例。**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

  Expected: 失败信息显示找不到 `继续扫描标签`，而现有界面仍输出 `继续补取标签`。

- [x] **Step 3: 只替换当前批恢复按钮的精确文案。**

  将现有优先分支改为：

  ```tsx
  {currentSegmentCanResumeTagEnrichment
    ? <button type="button" disabled={tagControlsLoading} onClick={onResumeTagEnrichment}>继续扫描标签</button>
  ```

  保持随后 `pendingItemCount > 0` 的 `暂停补取标签` / `继续补取标签` 分支不变，确保正在读取的当前批仍展示暂停、一般暂停仍展示原有继续文案。

- [x] **Step 4: 运行标签 UI 与协调器回归。**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: 新用例通过；协调器现有“只重新读取剩余标签”“完整采用后可重读”“变化后才再次采用”均通过。

### Task 2: 精简扫描概览并准确显示远端关系（R003、R004、R005）

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx:763-860`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:148,351-387`

- [x] **Step 1: 将现有“远端与本地工作区分别显示”测试改成产品红灯。**

  保留四个远端夹（普通、同名、已绑定、待对账）的测试数据，断言：

  ```tsx
  expect(within(userFolders).getByText(/已绑定的远端收藏夹/).closest('[role="row"]')).toHaveTextContent('已备册')
  expect(within(userFolders).getByText(/待对账的远端收藏夹/).closest('[role="row"]')).toHaveTextContent('未绑定')
  expect(within(userFolders).getByLabelText('选择来源 已绑定的远端收藏夹')).toBeDisabled()
  expect(within(userFolders).getByLabelText('选择来源 待对账的远端收藏夹')).toBeDisabled()
  expect(screen.queryByRole('table', { name: 'bilimi 本地工作区' })).not.toBeInTheDocument()
  expect(screen.queryByText('本地数量')).not.toBeInTheDocument()
  expect(screen.queryByText('待重新备册/绑定/对账')).not.toBeInTheDocument()
  ```

  对普通和仅名称含 `bilimi` 的远端夹断言复选框仍可用，防止名字成为扫描资格。

- [x] **Step 2: 运行扫描概览测试并观察红灯。**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

  Expected: 旧测试/新断言分别看到 `已绑定`、`待对账` 和 `bilimi 本地工作区` 表，证明现象由渲染层造成而不是测试数据遗漏。

- [x] **Step 3: 删除扫描概览的本地工作区投影并映射短状态。**

  删除 `localWorkspaceFolders` 的读取和整个 `aria-label="bilimi 本地工作区"` 表。将来源行标签固定为：

  ```tsx
  const relationshipLabel = relationship === 'bound'
    ? '已备册'
    : relationship === 'reconcile-required'
      ? '未绑定'
      : undefined
  ```

  保持 `oldFavoriteFolderIsScanEligible(folder)` 作为唯一禁用条件，不删除 shared 类型或主进程 `localWorkspaceFolders` 投影。

- [x] **Step 4: 运行扫描概览测试。**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

  Expected: 所有扫描概览用例通过，且没有本地数量、长关系文案或第二个工作区列表。

### Task 3: 统一推荐取消、顶端卡片与删除模式（R002）

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx:398-524`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx:3160-3240,3403-3470`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:277-290,822-853,963-1034`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:196-278,305-337,682-690`

- [x] **Step 1: 写删除模式红灯：未备册推荐也必须走推荐取消。**

  将旧的“按 unbacked 分流本地删除”测试改为：有 `bindingState: 'unbacked'`、无远端 ID 且 `organizationRecommendationEnabledById` 为 true 的候选，点击删除模式确认后断言：

  ```tsx
  expect(onOrganizationRecommendationToggle).toHaveBeenCalledWith('recommended-unbacked', false)
  expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
  expect(deleteManagedFavoriteFolders).not.toHaveBeenCalled()
  expect(deleteManagedRemoteFolders).not.toHaveBeenCalled()
  ```

  保留已绑定/远端未绑定推荐的断言，证明它们只取消本轮推荐并保留真实实体；取消回调返回 false 时删除模式仍打开并保留卡片。

- [x] **Step 2: 写端到端红灯：下方取消成功后顶端纯本地卡片消失，失败保持。**

  在 `ControlledFavoriteLedgerPanel.test.tsx` 使用一个已选 `author-a` 推荐及无远端 ID 的 `bindingState: 'unbacked'` 顶端卡片。下方取消后断言：

  ```tsx
  await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
    type: 'set-recommended-candidates', candidateIds: []
  }))
  expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'A', checked: false })).toBeInTheDocument()
  ```

  失败用例让命令拒绝并断言顶端卡片和下方已勾选状态仍在。另保留有 `bilibiliFolderId` 的 `unbound` 例子，断言卡片保留、没有远端删除调用。

- [x] **Step 3: 运行两个组件测试并确认红灯根因。**

  Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

  Expected: 未备册候选仍调用 `deleteFavoriteLedgersLocal`，而下方取消不移除上方卡片；失败用例证明现有代码没有同一成功边界。

- [x] **Step 4: 让所有已选推荐都先经过工作区的权威取消。**

  将判定改为仅依据同一候选映射和回调可用性：

  ```tsx
  const isRecommendationCancellationOnly = (ledger: FavoriteLedger) =>
    organizationRecommendationEnabledById?.get(ledger.id) === true &&
    Boolean(onOrganizationRecommendationToggle)
  ```

  因此详情删除和删除模式均调用 `onOrganizationRecommendationToggle(ledgerId, false)`；不再因 `unbacked` 或 `missingLedgerIds` 把同一候选绕回独立本地删除。`set-recommended-candidates` 的主进程持久化继续负责删除“未编辑、无远端绑定”的生成规则；绑定、未绑定远端和用户 B 站夹不会触发远端删除。

- [x] **Step 5: 在受控面板中只在取消成功后收束纯本地生成卡片。**

  新增账号隔离的 `dismissedGeneratedRecommendationLedgerIds` 状态；以 `createRecommendationProjection` 将 ledger 映射到本轮 candidate。`handleOrganizationRecommendationToggle` 等待 `workspace.waitForRecommendationQueue()` 成功后：

  ```tsx
  if (!enabled && isPureLocalGeneratedRecommendation(ledger)) {
    removePromotedRecommendationLedger(ledgerId)
    setDismissedGeneratedRecommendationLedgerIds((current) => new Set([...current, ledgerId]))
  }
  ```

  `isPureLocalGeneratedRecommendation` 必须同时要求 `bindingState === 'unbacked'`、无 `bilibiliFolderId`、无 `bilibiliFolderIds`。用该集合过滤 `displayedLedgers`；重新勾选同一 candidate 时清除对应集合项。任何取消/保存失败均不得更新集合或调用远端删除。

- [x] **Step 6: 运行推荐组件回归。**

  Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

  Expected: 下方、详情和删除模式都走一次推荐取消；纯本地卡片在成功后消失；有远端关系的卡片保留；失败后所有投影保持。

### Task 4: 从权威仓库重新投影备册关系并刷新跨页面快照（R003）

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:1157-1162,5876-5936`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts:35-90,143-185,397-539`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx:4837-4879,5067-5074`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx:1-9,120-128,485-491`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx:5-24`

- [x] **Step 1: 写协调器红灯，复现“旧扫描快照没有随重新备册更新”。**

  先以一个普通远端 source 结束扫描，再向 `FavoriteRepositoryService` 提交同一远端 folder ID 的正式物理分片绑定。调用将新增的刷新入口后断言：

  ```ts
  await expect(coordinator.refreshRelationshipProjection('100')).resolves.toMatchObject({
    sourceFolders: [{ id: 'remote-learning', remoteRelationship: 'bound', scanEligible: false, selected: false }],
    inventoryMetrics: { sourceFolders: [expect.objectContaining({ id: 'remote-learning', selected: false })] }
  })
  ```

  再把该分片改为 `pending-reconcile`，断言 `remoteRelationship: 'reconcile-required'`；删除/移除关系后断言 `none` 且不自动勾选。重启一个新 coordinator 并断言持久覆盖层仍给出最后关系。

- [x] **Step 2: 运行协调器红灯用例。**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: 编译/断言失败，因为当前 `getSnapshot` 只读取 `scanOverviews` 缓存，尚无刷新入口。

- [x] **Step 3: 实现无 B 站副作用的关系重投影。**

  在 coordinator 增加公共 `refreshRelationshipProjection(accountMid)`，其队列内通过 `openUnsafe` 取得当前工作区，读取 `repository.getSnapshot(accountMid)`，并调用私有 `refreshRelationshipProjectionUnsafe(workspace, repository)`。

  私有方法必须：

  ```ts
  const relatedLogicalIds = new Set(
    repository.physicalShards
      .filter((shard) => [shard.remoteFolderId, ...(shard.knownRemoteFolderIds ?? [])].includes(folder.id))
      .map((shard) => shard.logicalLedgerId)
  )
  const relationship = relatedLogicalIds.size === 0
    ? 'none'
    : relatedLogicalIds.size === 1 && matchingShards.some((shard) =>
      shard.bindingState === 'bound' && shard.remoteFolderId === folder.id)
      ? 'bound'
      : 'reconcile-required'
  ```

  对每个缓存来源写入 `isBilimiWorkFolder: relationship !== 'none'`、`remoteRelationship`、`scanEligible: relationship === 'none'`，并在不可扫描时强制 `selected: false`。同时更新 `localWorkspaceFolders = projectLocalWorkspaceFolders(repository)`、用原有权威等级重算 `inventoryMetrics`、写入 `scanOverviews` 和 `workspaceStore.appendOverlay(... scanMetadata ...)`，再返回 `createSnapshotWithExecutionProgress(workspace)`。它只读取本地 repository 和工作区存储，绝不读取、写入或删除 B 站数据。

- [x] **Step 4: 添加受限 IPC 命令。**

  在 `WorkspaceCommand`、`command(value)` 与 handler 增加无参数 `refresh-relationship-projection`：

  ```ts
  | { type: 'refresh-relationship-projection' }
  // parser: Object.keys(candidate).length === 1
  if (requested.type === 'refresh-relationship-projection') {
    return options.coordinator.refreshRelationshipProjection(accountMid)
  }
  ```

  它沿用现有账号一致性和可信 sender 检查，不新增绕过 IPC 的 renderer 数据入口。

- [x] **Step 5: 在备册/保存成功后请求新投影和助手快照。**

  在 `FloatingAssistantApp` 提取一个只做本地刷新动作的函数：向已有 `commandOldFavoriteWorkspaceV1` 发送 `{ type: 'refresh-relationship-projection' }`，若返回非 recovery 快照则 `setFavoriteOrganizationSnapshot(workspace)`，然后由既有 `loadSnapshot()` 更新掌库/收藏库偏好。`ensureFavoriteLedgers` 和 `saveFavoriteLedgers` 只在 `result.ok === true` 后调用；失败保留旧权威状态和错误信息。`refreshOrganizationState` 也必须使用此命令，而不是只调用旧缓存的 `openOldFavoriteWorkspaceV1`。

- [x] **Step 6: 运行协调器、IPC 和受影响 renderer 测试。**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

   Expected: 重新备册/解绑状态从真实物理分片重投影；来源资格与统计同步；UI 短状态和隐藏区域不回归。

- [x] **Step 7: 审阅后补齐跨页面资格一致性回归。**

  审阅发现：关系投影解除后虽恢复 `scanEligible`，但旧 `isBilimiWorkFolder` 未同步，归档预览仍可能按旧标记过滤来源。先在协调器断言 `bound`/`reconcile-required` 为工作夹、`none` 解除工作夹标记，再在归档预览用例输入“已解除关系且重新选择”的来源并断言视频出现；两条用例均先红灯。随后让重投影同步兼容标记，且归档预览改用 `oldFavoriteFolderIsScanEligible` 作为共享资格。

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

  Expected: 323 项通过；解除关系后的来源既可重新选择，也不再从归档预览消失。

### Task 5: 账本核对、真实界面验收和提交前验证

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-16-tag-adoption-scan-preview-state.md`
- Verify: 本计划涉及的所有文件

- [x] **Step 1: 逐项更新账本索引，不改写原文区。**

  对 I-01、I-02、I-03、I-05 分别记录实际文件/函数、Vitest 命令、通过结果及界面验收；I-04 保持“被 R005 明确替代”，I-06 保持已完成。不能用一条“相关测试通过”覆盖多个需求。

- [x] **Step 2: 在 Electron 开发版进行受控界面验收。**

  Run: `npm run dev`

  使用测试账号/测试工作区，不执行真实扫描、备册、同步、绑定、删除或任何 B 站写入。检查：当前批采用后按钮为“继续扫描标签”；下方取消纯本地推荐后顶端卡片同步消失、失败时保持；绑定/待对账行显示“已备册”/“未绑定”且禁用来源；扫描概览没有本地工作区表。检查鼠标移动、点击、滚动、窗口缩放、最小化和关闭没有明显卡顿。

- [x] **Step 3: 运行完整自动化和静态差异检查。**

  Run: `npm test`

  Run: `git diff --check`

  Run: `git diff --cached --check`

  Run: `git status --short`

  本轮关联回归和 `npm run build` 已通过；`npm test` 当前在未修改的 `FavoriteLibraryApp.test.tsx` 失败，根因为批量远端删除对 React 事件对象的延迟读取。该独立收藏库问题未纳入本轮 R001–R006，故本步骤和提交保持未完成；两个 diff 检查无输出，且不得包含 `docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md`。

- [x] **Step 4: 提交本轮主题。**

  ```powershell
  git add -- docs/项目功能项目书.md docs/requirement-ledgers/2026-08-16-tag-adoption-scan-preview-state.md docs/superpowers/plans/2026-08-16-tag-adoption-scan-preview-state.md electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx
  git commit -m "fix: synchronize organization workspace states"
  ```

  提交前再次完整回读需求账本原文区和索引表；不 push、pull、merge、rebase 或触及未跟踪的其他主题账本。

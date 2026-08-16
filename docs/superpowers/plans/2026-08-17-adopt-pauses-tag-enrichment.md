# 标签采用自动暂停 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当前批采用标签成功后安全暂停全局补取，并只从未采用批的持久检查点继续，绝不重读已采用当前批。

**Architecture:** `OldFavoriteWorkspaceCoordinator` 是标签状态、采用版本和待办检查点的唯一权威。采用命令将当前批版本持久化并把有未采用待办的全局状态切为 `paused`；恢复命令仅把该检查点切回 `running`，不移除当前批的采用标记。扫描服务每次通过协调器原子领取一条待办；暂停后不能领取下一条，但已领取的一条结果仍可安全落库，并在出现新标签时重新标记该批待采用。领取标记只存在主进程内存，进程重启不会把旧运行时响应当作有效回写。共享快照只暴露“当前已采用批可继续未采用批”的派生状态，扫描概览据此选择精确按钮和文案。

**Tech Stack:** TypeScript、Vitest、React 19、Electron 主进程协调器、持久化工作区覆盖层。

**Scope:** 只覆盖需求账本 `R008 / I-08`。`R007 / I-07` 的“20、30”数字口径尚未确认，本计划不修改任何概览计数。不得读取、写入、删除或同步 B 站数据。

---

## 文件与职责

- `docs/项目功能项目书.md`：第 5.3 节的最终用户可验收契约。
- `docs/requirement-ledgers/2026-08-16-tag-adoption-scan-preview-state.md`：保留原文、替代关系和逐项验收证据。
- `src/shared/oldFavoriteWorkspace.ts`：渲染器可见的标签补取派生状态类型。
- `electron/main/oldFavoriteWorkspaceCoordinator.ts`：采用、暂停、恢复、在途标签写入及持久检查点的权威状态转换。
- `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`：多批采用自动暂停、恢复队列、单批无继续入口和重启恢复回归。
- `electron/main/oldFavoriteWorkspaceScanService.ts`：原子领取下一条标签待办、在运行时响应无效时释放领取标记。
- `electron/main/oldFavoriteWorkspaceScanService.test.ts`：暂停后的在途响应可以收束，而下一条不会被运行时读取的回归。
- `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`：扫描概览精确文案、按钮显示和按钮路由。
- `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`：暂停后的`继续扫描标签`、一般手动暂停的`继续补取标签`及无剩余待办隐藏回归。

### Task 1: 固化最终产品契约与本轮边界

**Files:**

- Modify: `docs/项目功能项目书.md:226-239`
- Modify: `docs/requirement-ledgers/2026-08-16-tag-adoption-scan-preview-state.md:72-103`
- Create: `docs/superpowers/plans/2026-08-17-adopt-pauses-tag-enrichment.md`

- [x] **Step 1: 先更新项目书。**

  第 5.3 节必须精确规定：

  ```text
  采用当前标签成功 → 先持久化采用版本和当前批分类结果 → 安全暂停全局补取。
  存在未采用批待办 → 显示“继续扫描标签” → 只从未采用批检查点继续。
  没有未采用批待办 → 保持“已采用当前标签”，隐藏继续入口。
  已采用当前批不得因继续而重新入队或重读。
  ```

- [x] **Step 2: 记录替代关系。**

  账本 I-08 标为`已确认，待实施`，并明确替代 I-01 中“继续只恢复当前批且不影响其他批后台读取”的跨批边界；I-07 维持`待根因确认`，不被本计划吸收。

- [x] **Step 3: 检查文档差异。**

  Run: `git diff --check -- docs/项目功能项目书.md docs/requirement-ledgers/2026-08-16-tag-adoption-scan-preview-state.md docs/superpowers/plans/2026-08-17-adopt-pauses-tag-enrichment.md`

  Expected: 退出码 0，除 Git 的行尾提示外没有空白错误。

### Task 2: 先写协调器红灯，证明采用会暂停而恢复不重读当前批

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:2157-2230,3034-3080`
- Modify later: `electron/main/oldFavoriteWorkspaceScanService.test.ts`
- Modify later: `src/shared/oldFavoriteWorkspace.ts:256-269`
- Modify later: `electron/main/oldFavoriteWorkspaceCoordinator.ts:4110-4152,4342-4382,6020-6239`

- [x] **Step 1: 编写多批采用的红灯回归。**

  用 `segmentSize: () => 500` 建立 501 条视频的两批工作区；先为第 1 批确认至少一条标签，再采用第 1 批。断言采用立即暂停、当前批只提供恢复未采用批的派生状态，且暂停时不领取任何待办：

  ```ts
  await coordinator.acceptCurrentTags('100')

  await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
    tagEnrichment: {
      status: 'paused',
      pendingItemCount: 501,
      currentSegmentCanContinueTagEnrichment: true
    }
  })
  await expect(coordinator.getPendingTagEnrichmentAids('100')).resolves.toEqual([])

  await coordinator.resumeTagEnrichment('100')
  await expect(coordinator.getPendingTagEnrichmentAids('100')).resolves.toEqual([501])
  await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
    tagEnrichment: { status: 'running', pendingItemCount: 501 }
  })
  ```

  该用例替换旧的“采用后仍为 running”断言，并明确不接受 `[1]` 或第 1 批任何 aid 被重新领取。

- [x] **Step 2: 编写单批和在途结果红灯。**

  单批中先调用新的`claimNextPendingTagEnrichmentAid('100')`领取 `aid: 2`，再采用当前标签。断言没有可继续未采用批的派生状态、`getPendingTagEnrichmentAids` 为空；随后让已领取的同批 aid 回写标签，断言它仍被保存但将该批转回“有新增标签待采用”，且不自动启动另一条：

  ```ts
  await coordinator.acceptCurrentTags('100')
  await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
    tagEnrichment: { status: 'accepted', currentSegmentCanContinueTagEnrichment: false }
  })

  await expect(coordinator.recordTagEnrichment('100', 2, ['Late result'], workspaceId)).resolves.toBe(true)
  await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
    tagEnrichment: { currentSegmentHasUnacceptedTagChanges: true }
  })
  ```

  测试数据必须在采用时让 `aid: 2` 保持在 `pendingAids`且存在内存领取标记，以证明这是一条采用前已经在途、采用后才回写的请求，不是重开扫描。另在扫描服务用例使第 1 条标签请求延迟、在延迟期间采用并暂停，解析该请求后断言运行时从未请求第 2 条视频。

- [x] **Step 3: 运行红灯并记录原因。**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: 新用例因现有实现把状态保持为`running`、`resumeTagEnrichment`重新入队当前批以及暂停状态拒绝在途回写而失败；旧的重读当前批用例也显示与新产品契约冲突。

### Task 3: 先写扫描概览红灯，锁定每个可见状态

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx:598-668`
- Modify later: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:164-172,278-301`

- [x] **Step 1: 写“采用自动暂停”UI 红灯。**

  传入多批快照：当前批 `ready`，标签状态`paused`，待办为 1，并通过 `as never` 传入尚未定义的派生字段。断言精确文案、唯一按钮和点击路由：

  ```tsx
  tagEnrichment: {
    status: 'paused', totalItemCount: 501, completedItemCount: 500,
    pendingItemCount: 1, failedItemCount: 0,
    currentSegmentCanContinueTagEnrichment: true
  }

  expect(screen.getByText('标签补取已暂停：已处理 500 / 501 条。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '继续扫描标签' }))
  expect(resume).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: '暂停补取标签' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '继续补取标签' })).not.toBeInTheDocument()
  ```

- [x] **Step 2: 写“没有剩余未采用批”与一般手动暂停回归。**

  对`status: 'accepted'`、`pendingItemCount: 0`、`currentSegmentCanContinueTagEnrichment: false`断言没有`继续扫描标签`。对`status: 'paused'`但派生字段为 false 的当前未采用批断言只显示`继续补取标签`。这两个测试防止状态名称相同而把两种恢复语义混为一谈。

- [x] **Step 3: 运行 UI 红灯。**

  Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

  Expected: 新的自动暂停快照当前显示`继续补取标签`或由旧`currentSegmentCanResumeTagEnrichment`走错分支，因此精确按钮和说明断言失败。

### Task 4: 最小实现权威状态机和只读 UI 投影

**Files:**

- Modify: `src/shared/oldFavoriteWorkspace.ts:256-269`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:410-422,4110-4152,4180-4310,4342-4382,6020-6239,5170-5180`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts:93-106,593-646`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:164-172,278-301`

- [x] **Step 1: 替换共享派生字段。**

  在 `OldFavoriteWorkspaceSnapshot['tagEnrichment']` 中以如下字段取代旧的“重读当前批”语义：

  ```ts
  currentSegmentCanContinueTagEnrichment?: boolean
  ```

  该字段只表示“当前批已采用、全局已暂停且存在未采用批的持久待办”，不表示当前批可以重读。

- [x] **Step 2: 采用时写入暂停检查点。**

  在 `acceptCurrentTags` 计算当前批加入 `acceptedSegmentIds` 后，按尚未采用的批是否还有 `pendingAids` 决定持久化状态：

  ```ts
  const accepted = new Set(acceptedSegmentIds)
  const hasUnacceptedPending = workspace.segments.some((segment) =>
    !accepted.has(segment.id) && segment.aids.some((aid) => enrichment.pendingAids.includes(aid)))
  const status = hasUnacceptedPending ? 'paused' as const : 'accepted' as const
  ```

  `appendTagEnrichmentDelta(... kind: 'accept-segment', status)` 与内存 `tagEnrichments` 必须使用同一个 `status`。不要调用扫描、B 站或新 IPC 命令。

- [x] **Step 3: 恢复时仅继续未采用批。**

  在 `setTagEnrichmentStatus(..., 'running')` 中先判断当前批已采用且有未采用批待办；命中时只写`status: 'running'`并保持`acceptedSegmentIds`、`acceptedTagVersionsBySegment`和`pendingAids`不变：

  ```ts
  if (status === 'running' && current.acceptedSegmentIds.includes(segmentId) && hasUnacceptedPending) {
    const next = { ...current, status }
    await this.options.workspaceStore.appendTagEnrichmentDelta(accountMid, workspace.id, {
      currentSegmentId: segmentId, kind: 'status', status
    })
    this.tagEnrichments.set(accountMid, next)
    return true
  }
  ```

  删除或禁用旧的“移除当前批采用标记并把当前批 aids 重新入队”的恢复分支；当没有未采用批待办时返回`false`，不得创建重读。

- [x] **Step 4: 原子领取待办并允许采用前已在途的回写安全收束。**

  协调器新增按账号隔离的`inFlightTagEnrichmentAids`集合，以及不经过 IPC 的主进程服务方法：

  ```ts
  async claimNextPendingTagEnrichmentAid(accountMid: string): Promise<number | undefined> {
    return this.queue(async () => {
      const aids = await this.getPendingTagEnrichmentAidsUnsafe(accountMid)
      const inFlight = this.inFlightTagEnrichmentAids.get(accountMid) ?? new Set<number>()
      const aid = aids.find((candidate) => !inFlight.has(candidate))
      if (aid === undefined) return undefined
      inFlight.add(aid)
      this.inFlightTagEnrichmentAids.set(accountMid, inFlight)
      return aid
    })
  }
  ```

  `getPendingTagEnrichmentAids`保留为只读诊断/测试入口，并提取无队列递归的私有`getPendingTagEnrichmentAidsUnsafe`供领取方法使用。扫描服务把每轮的“取数组后选第一个”换成领取方法；运行时回包格式错误、账号不匹配或工作区拒绝回写时调用`releaseClaimedTagEnrichmentAid(accountMid, aid)`后暂停，成功或失败记录则在协调器队列内释放领取标记。`forgetState`清除该账号集合。

  `recordTagEnrichment` 与 `recordTagEnrichmentFailure` 对仍在 `pendingAids`且拥有领取标记的 aid 接受`paused`或`accepted`回写；`running`回写继续兼容现有内部直接调用。仍保持工作区 ID 和 pending aid 校验。若暂停/已采用期间的成功回写使已采用当前批标签内容变化，去除该批的 `acceptedSegmentIds` 标记而保留最近采用版本，以便快照产生`currentSegmentHasUnacceptedTagChanges: true`。回写后的状态遵守原暂停/已采用状态，不得重新变成`running`：

  ```ts
  const acceptsInFlightResult = enrichment.status === 'paused' || enrichment.status === 'accepted'
  const acceptedSegmentIds = tagChanged && acceptsInFlightResult
    ? enrichment.acceptedSegmentIds.filter((id) => id !== segmentId)
    : enrichment.acceptedSegmentIds
  const status = enrichment.status === 'paused' || enrichment.status === 'accepted'
    ? enrichment.status
    : activePendingAids.length ? 'running' as const : pendingAids.length ? 'accepted' as const : 'complete' as const
  ```

  对没有领取标记的已采用 aid，保留现有拒绝；不得让暂停后的服务领取下一条。

- [x] **Step 5: 投影精确 UI。**

  在 `createSnapshot` 只在以下条件为真时设置`currentSegmentCanContinueTagEnrichment`：

  ```ts
  const currentSegmentCanContinueTagEnrichment = Boolean(
    currentSegmentId && tagEnrichment?.status === 'paused' && currentSegmentHasAcceptedTagVersion &&
    !currentSegmentHasUnacceptedTagChanges && hasUnacceptedPending
  )
  ```

  扫描概览优先使用该字段。为真时摘要为`标签补取已暂停`且唯一操作为`继续扫描标签`；普通`paused`保留`继续补取标签`；没有未采用批待办时不显示继续按钮。`采用当前标签`在有新增/变化标签时仍可显示，不能被状态文案隐藏。

- [x] **Step 6: 运行绿灯。**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

  Expected: 所有用例通过；多批采用后先暂停、恢复只返回未采用批的第一个 aid；单批没有继续入口；在途结果被保存且变更时要求再次采用；扫描服务不在暂停后发起下一条运行时读取。

### Task 5: 回归、账本验收和本地提交

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-16-tag-adoption-scan-preview-state.md`
- Verify: `electron/main/oldFavoriteWorkspaceScanService.test.ts`, `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`, 本计划的所有文件

- [x] **Step 1: 运行跨层回归。**

  Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceScanService.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

  Expected: IPC 仍只把暂停/继续命令交给受信任主进程；扫描服务在每次请求前的`getPendingTagEnrichmentAids`空结果停止循环；手动暂停、失败重试和扫描暂停用例均保持通过。

- [x] **Step 2: 构建和静态检查。**

  Run: `npm run build`

  Run: `git diff --check`

  Run: `npm test`

  Expected: 构建和差异检查通过。若完整 `npm test` 仍仅在本轮未修改的`FavoriteLibraryApp.test.tsx`失败，保留失败输出，不能混入该独立修复，也不能宣称全套测试通过。

- [x] **Step 3: 按 I-08 写回逐项证据。**

  在账本 I-08 写入实际函数、每条测试命令、通过结果和真实界面尚未验证的条件；原文区不作任何改写。I-07 继续标为待确认。

- [x] **Step 4: 仅在无无关改动且本轮验证充分时提交。**

  首先运行：

  ```powershell
  git status --short
  git diff --stat
  git diff --check
  ```

  不得暂存或触及 `docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md`。若当前主题以外的改动仍混在工作树，停止提交并报告。若范围干净，按用户项目规则只创建一次本地提交，不执行 pull、merge、push、rebase、reset、stash 或 B 站操作。

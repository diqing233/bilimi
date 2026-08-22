import { useEffect, useState } from 'react'
import {
  type OldFavoriteInventoryMetricProjection,
  type OldFavoriteWorkspaceView
} from '@shared/oldFavoriteWorkspace'
import { OldFavoriteViewScopeSwitch, OldFavoriteWholeRunOverview, type OldFavoriteViewScope } from './OldFavoriteOverviewControls'

type SourceFolderProjection = OldFavoriteInventoryMetricProjection['sourceFolders'][number]

type SourceCountMode = 'planned' | 'protected' | 'unavailable'

const SOURCE_COUNT_MODES: Record<SourceCountMode, {
  label: string
  next: SourceCountMode
  field: 'plannedAidCount' | 'protectedAidCount' | 'unavailableAidCount'
}> = {
  planned: { label: '待整理', next: 'protected', field: 'plannedAidCount' },
  protected: { label: '已保护', next: 'unavailable', field: 'protectedAidCount' },
  unavailable: { label: '失效视频', next: 'planned', field: 'unavailableAidCount' }
}

function sourceProjectionValue(
  folder: SourceFolderProjection,
  mode: SourceCountMode,
  currentSegmentPlannedCounts?: ReadonlyMap<string, number>
): number | '—' | '待确认' {
  if (mode === 'planned' && !folder.selected) return '—'
  if (mode === 'planned' && currentSegmentPlannedCounts) return currentSegmentPlannedCounts.get(folder.id) ?? 0
  const value = folder[SOURCE_COUNT_MODES[mode].field]
  return folder.confirmed && value !== null ? value : '待确认'
}

type OldFavoriteScanOverviewStepProps = {
  snapshot: OldFavoriteWorkspaceView | null
  loading: boolean
  tagControlsLoading?: boolean
  currentScopeLocked?: boolean
  scanStarting: boolean
  scanPaused?: boolean
  onPauseScan?: () => void
  onResumeScan?: () => void
  onFinishScan?: () => void
  scanStartFailure: string | null
  onRetry: () => void
  onRestart?: () => void
  onRetryDirect: () => void
  onRebuild: () => void
  onSelectSourceFolders: (folderIds: string[]) => void
  onPauseTagEnrichment: () => void
  onResumeTagEnrichment: () => void
  onRetryFailedTagEnrichment: () => void
  onAcceptCurrentTags: () => void
  viewScope?: OldFavoriteViewScope
  onViewScopeChange?: (scope: OldFavoriteViewScope) => void
}

function scanFailureGuidance(reason: string | null | undefined) {
  const normalized = reason?.trim() ?? ''
  if (/^(target-unavailable|target-navigated|remote-ambiguous|remote-api-)/.test(normalized)) {
    return '无法确认当前 B站页面，请保持已登录的 B站页面打开后继续扫描。'
  }
  if (normalized === 'page-execution-failed') {
    return '无法读取当前 B站页面，请保持已登录的 B站页面打开并等待页面加载完成后继续扫描。'
  }
  if (normalized === 'network-failure') {
    return 'B 站网络连接中断。请检查网络或使用本次直连后重新扫描。'
  }
  return normalized || '请重新扫描。'
}

export function OldFavoriteScanOverviewStep({
  snapshot,
  loading,
  tagControlsLoading = false,
  currentScopeLocked = false,
  scanStarting,
  scanPaused: controlledScanPaused = false,
  onPauseScan = () => undefined,
  onResumeScan = () => undefined,
  onFinishScan = () => undefined,
  scanStartFailure,
  onRetry,
  onRestart,
  onRetryDirect,
  onRebuild,
  onSelectSourceFolders
  ,onPauseTagEnrichment
  ,onResumeTagEnrichment
  ,onRetryFailedTagEnrichment
  ,onAcceptCurrentTags
  ,viewScope: controlledViewScope
  ,onViewScopeChange
}: OldFavoriteScanOverviewStepProps) {
  const [sourceCountMode, setSourceCountMode] = useState<SourceCountMode>('planned')
  const [localViewScope, setLocalViewScope] = useState<OldFavoriteViewScope>('all')
  const retryAvailableAt = snapshot && !('recovery' in snapshot) ? snapshot.scan.retryAvailableAt : undefined
  const [retryClock, setRetryClock] = useState(() => Date.now())
  const retryRemainingMs = retryAvailableAt ? Math.max(0, Date.parse(retryAvailableAt) - retryClock) : 0
  const retryCoolingDown = retryRemainingMs > 0
  const riskControlRetry = Boolean(retryAvailableAt && snapshot && !('recovery' in snapshot) &&
    /(?:http=|http-status=)412/i.test(snapshot.scan.reason ?? '') &&
    /category=(?:non-json|html)|response-category=html|content-type=text\/html/i.test(snapshot.scan.reason ?? ''))
  const checkingRiskControlRecovery = riskControlRetry && !retryCoolingDown && scanStarting
  useEffect(() => {
    if (!retryAvailableAt || !retryCoolingDown) return
    setRetryClock(Date.now())
    const timer = window.setInterval(() => setRetryClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [retryAvailableAt, retryCoolingDown])
  const retryRemainingSeconds = Math.ceil(retryRemainingMs / 1_000)
  const retryCountdown = `${Math.floor(retryRemainingSeconds / 60)}:${String(retryRemainingSeconds % 60).padStart(2, '0')}`
  const viewScope = controlledViewScope ?? localViewScope
  const setViewScope = onViewScopeChange ?? setLocalViewScope
  if (snapshot && 'recovery' in snapshot) {
    return <section className="favorite-ledger-panel__scan-overview" aria-label="扫描概览">
      <h4>扫描概览</h4>
      <p>工作镜像损坏，已完成的收藏库结果不会丢失。</p>
      <button type="button" disabled={loading} onClick={onRebuild}>重建工作镜像并重新扫描</button>
    </section>
  }

  const activeSnapshot = snapshot && !('recovery' in snapshot) ? snapshot : null
  const overview = activeSnapshot?.overview
  const hasMultipleSegments = Boolean(activeSnapshot?.hasMultipleSegments || (activeSnapshot?.segments.length ?? 0) > 1)
  const isSingleRound = !hasMultipleSegments
  const showSourceSelection = isSingleRound || viewScope === 'all'
  const inventoryMetrics = activeSnapshot?.inventoryMetrics
  const legacyProjectionConfirmed = activeSnapshot?.scan.phase === 'complete'
  const folders: SourceFolderProjection[] = inventoryMetrics?.sourceFolders ?? (activeSnapshot?.sourceFolders ?? []).map((folder) => ({
    id: folder.id,
    title: folder.title,
    relationshipCount: folder.itemCount,
    plannedAidCount: legacyProjectionConfirmed
      ? folder.selected ? folder.itemCount : 0
      : null,
    protectedAidCount: legacyProjectionConfirmed ? 0 : null,
    unavailableAidCount: legacyProjectionConfirmed ? folder.invalidItemCount ?? 0 : null,
    selected: Boolean(folder.selected),
    isBilimiWorkFolder: folder.isBilimiWorkFolder,
    confirmed: legacyProjectionConfirmed
  }))
  // Every entry in this list is a current remote Bilibili fact. Local rules
  // and relationships are deliberately absent from this source-selection UI.
  const userFolders = folders
  const selectableUserFolders = userFolders
  const selectedSourceIds = new Set(userFolders
    .filter((folder) => folder.selected)
    .map((folder) => folder.id))
  const scanFailed = Boolean(scanStartFailure) || snapshot?.scan.phase === 'failed'
  const resumableFailedScan = snapshot?.status === 'scanning' && snapshot.scan.phase === 'failed'
  const scanning = scanStarting || snapshot?.status === 'scanning'
  const scanPaused = controlledScanPaused || Boolean(activeSnapshot?.scan.paused)
  const unstarted = !snapshot && !scanStarting
  const scanningBasicInformation = scanning && activeSnapshot?.scan.phase === 'inventory'
  const hasFinalScanTotal = typeof snapshot?.scan.totalItemCount === 'number'
  const totalItemCount = snapshot?.scan.totalItemCount ?? 0
  const reportedScannedItemCount = snapshot?.scan.scannedItemCount ?? (snapshot?.scan.phase === 'complete' ? totalItemCount : 0)
  const scannedItemCount = hasFinalScanTotal ? Math.min(reportedScannedItemCount, totalItemCount) : reportedScannedItemCount
  const scanTotalMetricCount = snapshot?.scan.phase === 'complete' && hasFinalScanTotal ? totalItemCount : scannedItemCount
  const taggedItemCount = Math.min(snapshot?.scan.taggedItemCount ?? 0, scannedItemCount)
  const untaggedItemCount = Math.max(0, snapshot?.scan.untaggedItemCount ?? scannedItemCount - taggedItemCount)
  const tagEnrichment = snapshot?.tagEnrichment
  const currentSegmentSummary = snapshot?.segments.find((segment) => segment.id === snapshot.currentSegment?.id)
  const currentSegmentCanContinueTagEnrichment = tagEnrichment?.currentSegmentCanContinueTagEnrichment === true
  const currentSegmentHasUnacceptedTagChanges = tagEnrichment?.currentSegmentHasUnacceptedTagChanges === true
  const canContinueTagEnrichment = tagEnrichment?.status !== 'running' &&
    (currentSegmentCanContinueTagEnrichment || Boolean(tagEnrichment?.pendingItemCount) || Boolean(tagEnrichment?.failedItemCount))
  const canAcceptCurrentTags = currentSegmentHasUnacceptedTagChanges ||
    (Boolean(tagEnrichment?.pendingItemCount) && tagEnrichment?.status !== 'accepted')
  const scopedTagEnrichment = tagEnrichment?.scopes?.[viewScope === 'all' ? 'wholeRun' : 'currentSegment']
  const scopedTagProgress = viewScope === 'all'
    ? tagEnrichment?.scopes?.wholeRun ?? (tagEnrichment ? {
      totalItemCount: tagEnrichment.totalItemCount,
      completedItemCount: tagEnrichment.completedItemCount
    } : undefined)
    : tagEnrichment?.scopes?.currentSegment ?? (currentSegmentSummary ? {
      totalItemCount: currentSegmentSummary.itemCount,
      completedItemCount: currentSegmentSummary.completedTagItemCount
    } : undefined)
  const scopedTagProgressLabel = viewScope === 'all' ? '本轮' : '当前批'
  const scopedTagProgressAriaLabel = viewScope === 'all' ? '本轮标签进度' : '当前批次标签进度'
  const scopedTagProgressStatus = viewScope === 'all'
    ? tagEnrichment?.status === 'running' ? '补取中'
      : tagEnrichment?.status === 'paused' ? '已暂停'
      : tagEnrichment?.status === 'accepted' ? '已采用' : '已完成'
    : currentSegmentSummary?.readiness === 'waiting' ? '等待扫描'
      : currentSegmentSummary?.readiness === 'tagging' ? '补取中'
      : currentSegmentSummary?.readiness === 'saved' ? '已保存' : '可整理'
  const failedTagItemCount = scopedTagEnrichment?.failedItemCount ?? Math.min(tagEnrichment?.failedItemCount ?? 0, untaggedItemCount)
  const confirmedUntaggedItemCount = scopedTagEnrichment?.confirmedUntaggedItemCount ?? tagEnrichment?.confirmedUntaggedItemCount ?? 0
  const reusedTagItemCount = scopedTagEnrichment?.reusedTagItemCount ?? tagEnrichment?.reusedTagItemCount ?? 0
  const fetchedTagItemCount = scopedTagEnrichment?.fetchedTagItemCount ?? tagEnrichment?.fetchedTagItemCount ?? taggedItemCount
  const tagTotalItemCount = scopedTagEnrichment?.totalItemCount ?? tagEnrichment?.totalItemCount ?? 0
  const tagCompletedItemCount = scopedTagEnrichment?.completedItemCount ?? tagEnrichment?.completedItemCount ?? 0
  const tagPendingItemCount = tagEnrichment?.pendingItemCount ?? 0
  const tagFailureItemCount = tagEnrichment?.failedItemCount ?? 0
  const tagEnrichmentComplete = !tagEnrichment || (tagEnrichment.status === 'complete' &&
    tagPendingItemCount === 0 && tagFailureItemCount === 0)
  const tagOutstandingSummary = [
    tagPendingItemCount > 0 ? `待补取 ${tagPendingItemCount} 条` : '',
    tagFailureItemCount > 0 ? `读取失败 ${tagFailureItemCount} 条` : ''
  ].filter(Boolean).join('，')
  const selectedAidCount = snapshot?.planReadiness?.selectedAidCount ?? scannedItemCount
  const plannedAidCount = inventoryMetrics?.plannedAidCount ?? selectedAidCount
  const currentSegmentPlannedAidCount = activeSnapshot?.currentSegmentMetrics?.plannedAidCount ?? currentSegmentSummary?.itemCount ?? plannedAidCount
  const protectedAidCount = inventoryMetrics?.protectedAidCount ?? activeSnapshot?.protectedAidCount ?? 0
  const lifecycleCountsConfirmed = inventoryMetrics?.authority !== 'incomplete'
  const allUserSourcesSelected = selectableUserFolders.length > 0 && selectedSourceIds.size === selectableUserFolders.length
  const totalUserSourceItemCount = userFolders.reduce((count, folder) => count + folder.relationshipCount, 0)
  const invalidSourceItemCount = userFolders.reduce((count, folder) => count + (folder.unavailableAidCount ?? 0), 0)
  const unavailableAidCount = inventoryMetrics?.unavailableAidCount ?? invalidSourceItemCount
  const effectiveSourceCountMode: SourceCountMode = showSourceSelection ? sourceCountMode : 'planned'
  const sourceMode = SOURCE_COUNT_MODES[effectiveSourceCountMode]
  const currentSegmentPlannedCounts = !showSourceSelection && activeSnapshot?.currentSegmentMetrics
    ? new Map(activeSnapshot.currentSegmentMetrics.sourceFolders.map((folder) => [folder.id, folder.plannedAidCount]))
    : undefined
  const sourceModeLabel = showSourceSelection ? sourceMode.label : '本批来源关系'
  const sourceModeValues = userFolders.map((folder) => sourceProjectionValue(folder, effectiveSourceCountMode, currentSegmentPlannedCounts))
  const sourceModeSummary = sourceModeValues.some((value) => value === '待确认')
    ? '待确认'
    : sourceModeValues.reduce<number>((count, value) => count + (typeof value === 'number' ? value : 0), 0)
  const sourceDuplicateCount = showSourceSelection && effectiveSourceCountMode === 'planned' &&
    inventoryMetrics?.authority === 'complete' && typeof sourceModeSummary === 'number'
    ? Math.max(0, sourceModeSummary - plannedAidCount)
    : null
  const sourceModeSummaryLabel = sourceDuplicateCount === null
    ? `（${sourceModeSummary}）`
    : `（${sourceModeSummary}·${sourceDuplicateCount}）`
  const sourceModeHeadingLabel = `${sourceModeLabel}${sourceModeSummaryLabel}`
  const sourceModeHeadingTitle = sourceDuplicateCount === null
    ? undefined
    : `${sourceModeSummary}：已选 B 站收藏夹中的待整理来源关系数。${sourceDuplicateCount}：重叠来源产生的重复计数。顶部“本轮待整理”${plannedAidCount}：去重后的实际整理视频数。`
  const guidance = checkingRiskControlRecovery
    ? '正在检查 B 站收藏读取是否已恢复；检测成功后会继续扫描，不会重复读取已保存分页。'
    : retryCoolingDown
    ? 'B站暂时限制了请求，请等待冷却结束后重试。现有收藏库和整理数据不会丢失。'
    : scanStartFailure
    ? `扫描启动失败：${scanFailureGuidance(scanStartFailure)}`
    : snapshot?.scan.phase === 'failed'
      ? `扫描失败：${scanFailureGuidance(snapshot.scan.reason)}`
      : unstarted
        ? '尚未开始扫描，请点击“整理收藏”后扫描。'
        : scanPaused
          ? '扫描已暂停，已保存的进度不会丢失。'
          : scanning
            ? '正在扫描收藏夹基本信息。扫描完成后会补取标签；标签补取完成前，建议先等待，不要提前进入后续整理。'
          : tagEnrichmentComplete
            ? '本轮扫描与标签补取已完成。请在「推荐收藏夹」选择或新建要参与分类的收藏夹；随后到「归档预览」检查并调整结果，最后确认保存或同步。'
            : tagEnrichment?.status === 'paused'
              ? `基础扫描已完成，标签补取已暂停：${tagOutstandingSummary || '等待状态更新'}。`
              : tagEnrichment?.status === 'running'
                ? `基础扫描已完成，标签补取进行中：${tagOutstandingSummary || '正在处理'}。`
                : tagEnrichment?.status === 'accepted'
                  ? `基础扫描已完成，已采用当前标签；${tagOutstandingSummary ? `${tagOutstandingSummary}，可稍后继续补取。` : '当前标签结果已采用。'}`
                  : `基础扫描已完成，标签补取尚未完成：${tagOutstandingSummary || '请检查当前状态'}。`

  const overviewReadOnly = hasMultipleSegments && viewScope === 'all' && !overview
  const showWholeRunMetrics = isSingleRound || viewScope === 'all'
  const wholeRunPlannedMetric = scanningBasicInformation || !lifecycleCountsConfirmed ? '待确认' : plannedAidCount
  const currentSegmentPlannedMetric = scanningBasicInformation || !lifecycleCountsConfirmed ? '待确认' : currentSegmentPlannedAidCount
  const scanTotalMetricTitle = snapshot?.scan.phase === 'complete'
    ? '本轮基本信息扫描完成时记录的最终扫描总数；标签补取、去重和保护判断不会改变它。'
    : '当前基本信息扫描已累计发现的视频数量；扫描完成后会锁定最终扫描总数。'

  return <section className="favorite-ledger-panel__scan-overview" aria-label="扫描概览">
    <div className="favorite-ledger-panel__step-title-row">
      <h4>扫描概览</h4>
      {hasMultipleSegments ? <OldFavoriteViewScopeSwitch label="扫描概览视图" value={viewScope} onChange={setViewScope} disableCurrent={currentScopeLocked} /> : null}
    </div>
    {hasMultipleSegments && viewScope === 'all' ? <OldFavoriteWholeRunOverview snapshot={activeSnapshot!} /> : null}
    <p className="favorite-ledger-panel__scan-guidance" role={scanFailed ? 'alert' : undefined}>{guidance}</p>
    <div className="favorite-ledger-panel__scan-progress" aria-label="收藏扫描进度">
      <div>
        <span>扫描进度</span>
        <progress aria-label="收藏扫描进度" max={Math.max(totalItemCount, 1)} value={scanFailed ? scannedItemCount : scanning ? scannedItemCount : Math.max(totalItemCount, 1)} />
        <span>{(scanning || scanFailed) && totalItemCount ? `${scannedItemCount} / ${totalItemCount} 条` : null}</span>
        <strong>{scanFailed ? '扫描失败' : unstarted ? '尚未开始' : scanning ? '正在扫描' : '基础扫描已完成'}</strong>
      </div>
      {!scanning && !tagEnrichment && scannedItemCount ? <div>
        <span>已获取标签</span>
        <progress aria-label="标签识别进度" max={Math.max(scannedItemCount, 1)} value={taggedItemCount} />
        <span>已获取标签 {taggedItemCount} / {scannedItemCount} 条</span>
        <strong className="favorite-ledger-panel__scan-progress-status">已扫描 {scannedItemCount} 条视频，待获取标签</strong>
      </div> : null}
      {hasMultipleSegments && scopedTagProgress ? <div>
        <span>标签补取</span>
        <progress aria-label={scopedTagProgressAriaLabel} max={Math.max(scopedTagProgress.totalItemCount, 1)}
          value={scopedTagProgress.completedItemCount} />
        <span>{scopedTagProgressLabel} {scopedTagProgress.completedItemCount} / {scopedTagProgress.totalItemCount} 条</span>
        <strong>{scopedTagProgressStatus}</strong>
      </div> : null}
    </div>
    {scanning && !scanFailed ? <div className="favorite-ledger-panel__scan-actions" role="group" aria-label="扫描操作">
      {scanPaused
        ? <button type="button" disabled={loading || scanStarting} onClick={onResumeScan}>继续扫描</button>
        : <button type="button" disabled={loading || scanStarting} onClick={onPauseScan}>暂停扫描</button>}
      <button type="button" disabled={loading || scanStarting} onClick={onFinishScan}>结束整理</button>
    </div> : null}
    {snapshot ? <>
      <div className="favorite-ledger-panel__scan-metrics" aria-label={showWholeRunMetrics ? '本轮整理统计' : '本批整理统计'}>
        {showWholeRunMetrics ? <article aria-label="扫描总数" title={scanTotalMetricTitle}>
          <span>扫描总数</span>
          <strong>{scanTotalMetricCount}</strong>
        </article> : <article aria-label="本轮待整理" title="本轮所有批次中实际进入整理流程的去重视频数量。">
          <span>本轮待整理</span>
          <strong>{wholeRunPlannedMetric}</strong>
        </article>}
        <article aria-label={showWholeRunMetrics ? '本轮待整理' : '本批待整理'} title="已选来源中去重后，扣除失效视频和已保护视频的数量。">
          <span>{showWholeRunMetrics ? '本轮待整理' : '本批待整理'}</span><strong>{showWholeRunMetrics ? wholeRunPlannedMetric : currentSegmentPlannedMetric}</strong>
        </article>
        {showWholeRunMetrics ? <article aria-label="已保护跳过" title="有效视频中已在收藏库完成整理并受保护的去重数量，本轮不会重复整理。">
          <span>已保护跳过</span><strong>{lifecycleCountsConfirmed ? protectedAidCount : '待确认'}</strong>
        </article> : null}
        {showWholeRunMetrics ? <article aria-label="失效视频" title="已确认失效或账号注销视频的去重数量，不参与整理和分类。">
          <span>失效视频</span><strong>{lifecycleCountsConfirmed ? unavailableAidCount : '待确认'}</strong>
        </article> : null}
      </div>
      <p className="favorite-ledger-panel__scan-explanation">先读取各收藏夹中的视频，确定本轮整理范围；只有待整理的视频会继续获取标签。</p>
    </> : null}
    {tagEnrichment && !scanning ? <div className="favorite-ledger-panel__scan-enrichment-status" role="status">
      <p className="favorite-ledger-panel__scan-enrichment-summary">标签补取{currentSegmentHasUnacceptedTagChanges ? '发现新增或变化标签，待采用' : tagEnrichment.status === 'accepted' ? '已采用当前结果，可稍后继续' : tagEnrichment.status === 'paused' ? '已暂停' : tagEnrichment.pendingItemCount > 0 ? '进行中' : tagEnrichment.failedItemCount > 0 ? '读取失败，待继续补取' : '已完成'}：已处理 {tagCompletedItemCount} / {tagTotalItemCount} 条。</p>
      <div className="favorite-ledger-panel__tag-result-metrics" aria-label="标签补取结果">
        <span><small>沿用历史标签</small><strong>{reusedTagItemCount}</strong></span>
        <span><small>本轮获取标签</small><strong>{fetchedTagItemCount}</strong></span>
        <span><small>本轮确认无标签</small><strong>{confirmedUntaggedItemCount}</strong></span>
        <span><small>读取失败</small><strong>{failedTagItemCount}</strong></span>
      </div>
      <div className="favorite-ledger-panel__scan-enrichment-actions" data-testid="tag-enrichment-actions">
        {tagEnrichment.status === 'running' && tagEnrichment.pendingItemCount > 0
          ? <button type="button" disabled={tagControlsLoading} onClick={onPauseTagEnrichment}>暂停补取标签</button>
          : <button type="button" disabled={tagControlsLoading || !canContinueTagEnrichment} onClick={onResumeTagEnrichment}>继续补取标签</button>}
        <button type="button" disabled={tagControlsLoading || !canAcceptCurrentTags} onClick={onAcceptCurrentTags}>采用当前标签</button>
      </div>
      {tagEnrichment.pendingItemCount > 0 || currentSegmentCanContinueTagEnrichment || currentSegmentHasUnacceptedTagChanges ? <p className="favorite-ledger-panel__action-explanation">标签是重要的分类依据，建议耐心等待获取完成。暂停会保留已取得标签；采用当前标签会用当前结果继续本轮整理，未读取项不自动加入。</p> : null}
    </div> : null}
    {tagEnrichment?.status === 'accepted' && !scanning ? <p role="status">已采用当前标签。</p> : null}
    {scanFailed ? <>
      <button type="button" disabled={loading || scanStarting || retryCoolingDown} onClick={onRetry}>
        {checkingRiskControlRecovery
          ? '正在检测收藏读取…'
          : retryCoolingDown
            ? `等待 ${retryCountdown} 后重试`
            : riskControlRetry
              ? '检测并继续扫描'
              : resumableFailedScan ? '继续扫描' : '重新扫描'}
      </button>
      {resumableFailedScan && onRestart
        ? <button type="button" disabled={loading || scanStarting || retryCoolingDown} onClick={onRestart}>从头重新扫描</button>
        : null}
      {snapshot?.scan.reason === 'network-failure'
        ? <button type="button" disabled={loading || scanStarting} onClick={onRetryDirect}>本次直连后{resumableFailedScan ? '继续扫描' : '重新扫描'}</button>
        : null}
    </> : null}
    {showSourceSelection ? <>
      <hr className="favorite-ledger-panel__scan-source-divider" aria-hidden="true" />
      <p className="favorite-ledger-panel__scan-discovery">已发现 {folders.length} 个 B站收藏夹。</p>
      {snapshot?.mode === 'incremental' && lifecycleCountsConfirmed && protectedAidCount
        ? <p role="status" className="favorite-ledger-panel__scan-discovery">增量扫描已跳过 {protectedAidCount} 条已保护视频。</p>
        : null}
      {userFolders.length ? <div className="favorite-ledger-panel__source-table" role="table" aria-label="B站收藏夹">
      <div role="row" className="favorite-ledger-panel__source-header favorite-ledger-panel__source-header--user">
        <span role="columnheader" aria-colspan={2} className="favorite-ledger-panel__source-heading favorite-ledger-panel__source-heading--select-only">
          <label className="favorite-ledger-panel__source-select-all"><input type="checkbox" aria-label="全选来源" checked={allUserSourcesSelected}
            disabled={loading || overviewReadOnly || selectableUserFolders.length === 0}
            onChange={() => onSelectSourceFolders(allUserSourcesSelected ? [] : selectableUserFolders.map((folder) => folder.id))} /><span>全选</span><small>（{userFolders.length}）</small></label>
        </span>
        <span role="columnheader" aria-label={`总数（${totalUserSourceItemCount}）`} className="favorite-ledger-panel__source-metric-heading">
          <span>总数</span><small>（{totalUserSourceItemCount}）</small>
        </span>
        <span role="columnheader" aria-label={sourceModeHeadingLabel} title={sourceModeHeadingTitle}
          className={`favorite-ledger-panel__source-metric-heading${showSourceSelection ? ' favorite-ledger-panel__source-metric-heading--toggle' : ''}`}>
          <span>{sourceModeLabel}</span>
          {showSourceSelection ? <button type="button" className="favorite-ledger-panel__source-count-toggle"
            aria-label={sourceModeHeadingLabel}
            title={`切换为${SOURCE_COUNT_MODES[sourceMode.next].label}`}
            onClick={() => setSourceCountMode(sourceMode.next)}>
            <span aria-hidden="true">⇄</span>
          </button> : null}
          <small>{sourceModeSummaryLabel}</small>
        </span>
      </div>
      <ul role="rowgroup" className="favorite-ledger-panel__source-list">
        {userFolders.map((folder) => <li key={folder.id} role="row" className="favorite-ledger-panel__source-row favorite-ledger-panel__source-row--user">
          <label className="favorite-ledger-panel__source-row-content">
            <span role="cell"><input type="checkbox" aria-label={`选择来源 ${folder.title}`} checked={selectedSourceIds.has(folder.id)}
              disabled={loading || overviewReadOnly} onChange={(event) => {
                const next = new Set(selectedSourceIds)
                if (event.currentTarget.checked) next.add(folder.id); else next.delete(folder.id)
                onSelectSourceFolders([...next])
              }} /></span>
            <span role="cell" className="favorite-ledger-panel__source-name" title={folder.title}>{folder.title}</span>
            <span role="cell" className="favorite-ledger-panel__source-count">{folder.relationshipCount}</span>
            <span role="cell" className="favorite-ledger-panel__source-count">{sourceProjectionValue(folder, effectiveSourceCountMode, currentSegmentPlannedCounts)}</span>
          </label>
        </li>)}
        </ul>
      </div> : null}
    </> : null}
  </section>
}

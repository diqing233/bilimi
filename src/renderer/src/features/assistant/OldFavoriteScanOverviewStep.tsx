import { useState } from 'react'
import type { OldFavoriteWorkspaceView } from '@shared/oldFavoriteWorkspace'
import { OldFavoriteViewScopeSwitch, OldFavoriteWholeRunOverview, type OldFavoriteViewScope } from './OldFavoriteOverviewControls'

type OldFavoriteScanOverviewStepProps = {
  snapshot: OldFavoriteWorkspaceView | null
  loading: boolean
  scanStarting: boolean
  scanStartFailure: string | null
  onRetry: () => void
  onRetryDirect: () => void
  onRebuild: () => void
  onSelectSourceFolders: (folderIds: string[]) => void
  onPauseTagEnrichment: () => void
  onResumeTagEnrichment: () => void
  onRetryFailedTagEnrichment: () => void
  onAcceptCurrentTags: () => void
}

function scanFailureGuidance(reason: string | null | undefined) {
  const normalized = reason?.trim() ?? ''
  if (/^(target-unavailable|target-navigated|remote-ambiguous|remote-api-)/.test(normalized)) {
    return '无法确认当前 B站页面，请保持已登录的 B站页面打开后重新扫描。'
  }
  if (normalized === 'page-execution-failed') {
    return '无法读取当前 B站页面，请保持已登录的 B站页面打开并等待页面加载完成后重新扫描。'
  }
  if (normalized === 'network-failure') {
    return 'B 站网络连接中断。请检查网络或使用本次直连后重新扫描。'
  }
  return normalized || '请重新扫描。'
}

export function OldFavoriteScanOverviewStep({
  snapshot,
  loading,
  scanStarting,
  scanStartFailure,
  onRetry,
  onRetryDirect,
  onRebuild,
  onSelectSourceFolders
  ,onPauseTagEnrichment
  ,onResumeTagEnrichment
  ,onRetryFailedTagEnrichment
  ,onAcceptCurrentTags
}: OldFavoriteScanOverviewStepProps) {
  const [sourceCountMode, setSourceCountMode] = useState<'selected' | 'invalid'>('selected')
  const [viewScope, setViewScope] = useState<OldFavoriteViewScope>('all')
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
  const currentItems = activeSnapshot?.currentSegment?.items ?? []
  const currentItemCounts = new Map<string, { itemCount: number; invalidItemCount: number }>()
  for (const item of currentItems) {
    const unavailable = item.unavailable === true || item.title?.trim() === '已失效视频' || item.author?.trim() === '账号已注销'
    for (const sourceFolderId of new Set(item.sourceFolderIds)) {
      const counts = currentItemCounts.get(sourceFolderId) ?? { itemCount: 0, invalidItemCount: 0 }
      if (unavailable) counts.invalidItemCount += 1
      else counts.itemCount += 1
      currentItemCounts.set(sourceFolderId, counts)
    }
  }
  const overviewFolders = new Map((overview?.sourceFolders ?? []).map((folder) => [folder.id, folder]))
  const folders = (activeSnapshot?.sourceFolders ?? []).map((folder) => {
    if (!hasMultipleSegments) return folder
    const counts = viewScope === 'all' ? overviewFolders.get(folder.id) : currentItemCounts.get(folder.id)
    return { ...folder, itemCount: counts?.itemCount ?? 0, invalidItemCount: counts?.invalidItemCount ?? 0 }
  })
  const userFolders = folders.filter((folder) => !folder.isBilimiWorkFolder)
  const bilimiFolders = folders.filter((folder) => folder.isBilimiWorkFolder)
  const selectedSourceIds = new Set(userFolders
    .filter((folder) => folder.selected && !folder.isBilimiWorkFolder)
    .map((folder) => folder.id))
  const scanFailed = Boolean(scanStartFailure) || snapshot?.scan.phase === 'failed'
  const scanning = scanStarting || snapshot?.status === 'scanning'
  const unstarted = !snapshot && !scanStarting
  const totalItemCount = snapshot?.scan.totalItemCount ?? 0
  const scannedItemCount = Math.min(snapshot?.scan.scannedItemCount ?? 0, totalItemCount)
  const taggedItemCount = Math.min(snapshot?.scan.taggedItemCount ?? 0, scannedItemCount)
  const untaggedItemCount = Math.max(0, snapshot?.scan.untaggedItemCount ?? scannedItemCount - taggedItemCount)
  const tagEnrichment = snapshot?.tagEnrichment
  const currentSegmentSummary = snapshot?.segments.find((segment) => segment.id === snapshot.currentSegment?.id)
  const failedTagItemCount = Math.min(tagEnrichment?.failedItemCount ?? 0, untaggedItemCount)
  const confirmedUntaggedItemCount = tagEnrichment?.confirmedUntaggedItemCount ?? 0
  const reusedTagItemCount = tagEnrichment?.reusedTagItemCount ?? 0
  const fetchedTagItemCount = tagEnrichment?.fetchedTagItemCount ?? taggedItemCount
  const selectedAidCount = snapshot?.planReadiness?.selectedAidCount ?? scannedItemCount
  const allUserSourcesSelected = userFolders.length > 0 && selectedSourceIds.size === userFolders.length
  const totalUserSourceItemCount = userFolders.reduce((count, folder) => count + folder.itemCount, 0)
  const selectedSourceItemCount = userFolders.reduce((count, folder) => count + (selectedSourceIds.has(folder.id) ? folder.itemCount : 0), 0)
  const invalidSourceItemCount = userFolders.reduce((count, folder) => count + (folder.invalidItemCount ?? 0), 0)
  const guidance = scanStartFailure
    ? `扫描启动失败：${scanFailureGuidance(scanStartFailure)}`
    : snapshot?.scan.phase === 'failed'
      ? `扫描失败：${scanFailureGuidance(snapshot.scan.reason)}`
      : unstarted
        ? '尚未开始扫描，请点击“整理收藏”后扫描。'
        : scanning
        ? '扫描概览：扫描中'
        : '扫描概览已完成，请从左向右依次完成本轮整理。'

  const overviewReadOnly = hasMultipleSegments && viewScope === 'all' && !overview?.available

  return <section className="favorite-ledger-panel__scan-overview" aria-label="扫描概览">
    <div className="favorite-ledger-panel__step-title-row">
      <h4>扫描概览</h4>
      {hasMultipleSegments ? <OldFavoriteViewScopeSwitch label="扫描概览视图" value={viewScope} onChange={setViewScope} /> : null}
    </div>
    {hasMultipleSegments && viewScope === 'all' ? <OldFavoriteWholeRunOverview snapshot={activeSnapshot!} /> : null}
    <p className="favorite-ledger-panel__scan-guidance" role={scanFailed ? 'alert' : undefined}>{guidance}</p>
    <div className="favorite-ledger-panel__scan-progress" aria-label="收藏扫描进度">
      <div>
        <span>扫描进度</span>
        <progress aria-label="收藏扫描进度" max={Math.max(totalItemCount, 1)} value={scanFailed ? 0 : scanning ? scannedItemCount : Math.max(totalItemCount, 1)} />
        <span>{scanning && totalItemCount ? `${scannedItemCount} / ${totalItemCount} 条` : null}</span>
        <strong>{scanFailed ? '扫描失败' : unstarted ? '尚未开始' : scanning ? '正在扫描' : '已完成'}</strong>
      </div>
      {!tagEnrichment && scannedItemCount ? <div>
        <span>已获取标签</span>
        <progress aria-label="标签识别进度" max={Math.max(scannedItemCount, 1)} value={taggedItemCount} />
        <span>已获取标签 {taggedItemCount} / {scannedItemCount} 条</span>
        <strong>{untaggedItemCount ? `${untaggedItemCount} 条尚未取得标签` : '已识别'}</strong>
      </div> : null}
      {snapshot?.segments.length && snapshot.segments.length > 1 && currentSegmentSummary ? <div>
        <span>当前批次</span>
        <progress aria-label="当前批次标签进度" max={Math.max(currentSegmentSummary.itemCount, 1)}
          value={currentSegmentSummary.completedTagItemCount} />
        <span>当前批 {currentSegmentSummary.completedTagItemCount} / {currentSegmentSummary.itemCount} 条</span>
        <strong>{currentSegmentSummary.readiness === 'tagging' ? '补取中' : currentSegmentSummary.readiness === 'saved' ? '已保存' : '可整理'}</strong>
      </div> : null}
    </div>
    {snapshot ? <>
      <div className="favorite-ledger-panel__scan-metrics" aria-label="本轮整理统计">
        <article><span>来源总数</span><strong>{totalItemCount}</strong></article>
        <article><span>本轮待整理</span><strong>{selectedAidCount}</strong></article>
        <article><span>已保护跳过</span><strong>{snapshot.protectedAidCount ?? 0}</strong></article>
        <article><span>待续新增</span><strong>{snapshot.continuationCount}</strong></article>
      </div>
      <p className="favorite-ledger-panel__scan-explanation">扫描会读取来源列表用于增量比对；仅本轮待整理的视频会补取标签。</p>
    </> : null}
    {tagEnrichment ? <div className="favorite-ledger-panel__scan-enrichment-status" role="status">
      <p>标签补取{tagEnrichment.status === 'accepted' ? '已采用当前结果，可稍后继续' : tagEnrichment.status === 'paused' ? '已暂停' : tagEnrichment.pendingItemCount > 0 ? '进行中' : '已完成'}：已处理 {tagEnrichment.completedItemCount} / {tagEnrichment.totalItemCount} 条。</p>
      <div className="favorite-ledger-panel__tag-result-metrics" aria-label="标签补取结果">
        <span><small>沿用历史标签</small><strong>{reusedTagItemCount}</strong></span>
        <span><small>本轮获取标签</small><strong>{fetchedTagItemCount}</strong></span>
        <span><small>本轮确认无标签</small><strong>{confirmedUntaggedItemCount}</strong></span>
        <span><small>读取失败</small><strong>{failedTagItemCount}</strong></span>
      </div>
      {tagEnrichment.pendingItemCount > 0 ? <div className="favorite-ledger-panel__scan-enrichment-actions" data-testid="tag-enrichment-actions">
        {tagEnrichment.status === 'running'
          ? <button type="button" disabled={loading} onClick={onPauseTagEnrichment}>暂停补取标签</button>
          : <button type="button" disabled={loading} onClick={onResumeTagEnrichment}>继续补取标签</button>}
        {tagEnrichment.status !== 'accepted' ? <button type="button" disabled={loading} onClick={onAcceptCurrentTags}>采用当前标签</button> : null}
      </div> : null}
      {tagEnrichment.failedItemCount > 0 && tagEnrichment.status !== 'running'
        ? <button type="button" disabled={loading} onClick={onRetryFailedTagEnrichment}>重新补取失败标签</button>
        : null}
      {tagEnrichment.pendingItemCount > 0 ? <p className="favorite-ledger-panel__action-explanation">标签是重要的分类依据，建议耐心等待获取完成。暂停会保留已取得标签；采用当前标签会用当前结果继续本轮整理，未读取项不自动加入。</p> : null}
    </div> : null}
    {tagEnrichment?.status === 'accepted' ? <p role="status">已采用当前标签。</p> : null}
    {scanFailed ? <>
      <button type="button" disabled={loading || scanStarting} onClick={onRetry}>重新扫描</button>
      {snapshot?.scan.reason === 'network-failure'
        ? <button type="button" disabled={loading || scanStarting} onClick={onRetryDirect}>本次直连后重新扫描</button>
        : null}
    </> : null}
    <p>已发现 {folders.length} 个收藏夹，当前扫描 {snapshot?.continuationCount ?? 0} 条待续新增。</p>
    {snapshot?.mode === 'incremental' && snapshot.protectedAidCount
      ? <p role="status">增量扫描已跳过 {snapshot.protectedAidCount} 条已保护视频。</p>
      : null}
    {userFolders.length ? <div className="favorite-ledger-panel__source-table" role="table" aria-label="用户收藏夹">
      <div role="row" className="favorite-ledger-panel__source-header favorite-ledger-panel__source-header--user">
        <span role="columnheader" aria-colspan={2} className="favorite-ledger-panel__source-heading">
          <label className="favorite-ledger-panel__source-select-all"><input type="checkbox" aria-label="全选来源" checked={allUserSourcesSelected}
            disabled={loading || overviewReadOnly} onChange={() => onSelectSourceFolders(allUserSourcesSelected ? [] : userFolders.map((folder) => folder.id))} /><span>全选</span></label>
          <span className="favorite-ledger-panel__source-heading-separator" aria-hidden="true">·</span>
          <span className="favorite-ledger-panel__source-heading-title">用户收藏夹</span>
          <small>（{userFolders.length}）</small>
        </span>
        <span role="columnheader" aria-label={`总数（${totalUserSourceItemCount}）`} className="favorite-ledger-panel__source-metric-heading">
          <span>总数</span><small>（{totalUserSourceItemCount}）</small>
        </span>
        <span role="columnheader" className="favorite-ledger-panel__source-metric-heading favorite-ledger-panel__source-metric-heading--toggle">
          <span>{sourceCountMode === 'selected' ? '已选来源' : '失效视频'}</span>
          <button type="button" className="favorite-ledger-panel__source-count-toggle"
            aria-label={sourceCountMode === 'selected' ? `已选来源（${selectedSourceItemCount}）` : `失效视频（${invalidSourceItemCount}）`}
            title={sourceCountMode === 'selected' ? '切换为失效视频' : '切换为已选来源'}
            onClick={() => setSourceCountMode((current) => current === 'selected' ? 'invalid' : 'selected')}>
            <span aria-hidden="true">⇄</span>
          </button>
          <small>（{sourceCountMode === 'selected' ? selectedSourceItemCount : invalidSourceItemCount}）</small>
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
            <span role="cell" className="favorite-ledger-panel__source-count">{folder.itemCount}</span>
            <span role="cell" className="favorite-ledger-panel__source-count">{sourceCountMode === 'selected'
              ? selectedSourceIds.has(folder.id) ? folder.itemCount : 0
              : folder.invalidItemCount ?? 0}</span>
          </label>
        </li>)}
      </ul>
    </div> : null}
    {bilimiFolders.length ? <div className="favorite-ledger-panel__source-table favorite-ledger-panel__source-table--bilimi" role="table" aria-label="bilimi 工作夹">
      <div role="row" className="favorite-ledger-panel__source-header favorite-ledger-panel__source-header--bilimi">
        <span role="columnheader" aria-label="选择" /><span role="columnheader">bilimi 工作夹</span>
        <span role="columnheader">已有</span><span role="columnheader">本轮待整理</span>
      </div>
      <ul role="rowgroup" className="favorite-ledger-panel__source-list">
        {bilimiFolders.map((folder) => <li key={folder.id} role="row" className="favorite-ledger-panel__source-row favorite-ledger-panel__source-row--bilimi">
          <span role="cell" /><span role="cell" className="favorite-ledger-panel__source-name" title={folder.title}>{folder.title}</span>
          <span role="cell" className="favorite-ledger-panel__source-count">{folder.itemCount}</span>
          <span role="cell" className="favorite-ledger-panel__source-count">0</span>
        </li>)}
      </ul>
    </div> : null}
  </section>
}

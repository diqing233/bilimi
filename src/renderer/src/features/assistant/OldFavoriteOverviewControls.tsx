import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'

export type OldFavoriteViewScope = 'current' | 'all'

type OldFavoriteViewScopeSwitchProps = {
  label: string
  value: OldFavoriteViewScope
  onChange: (scope: OldFavoriteViewScope) => void
  disableCurrent?: boolean
}

export function OldFavoriteViewScopeSwitch({ label, value, onChange, disableCurrent = false }: OldFavoriteViewScopeSwitchProps) {
  return <div className="favorite-ledger-panel__view-scope" role="group" aria-label={label}>
    <button type="button" aria-pressed={value === 'current'} disabled={disableCurrent} onClick={() => onChange('current')}>当前批次</button>
    <button type="button" aria-pressed={value === 'all'} onClick={() => onChange('all')}>本轮总览</button>
  </div>
}

type OldFavoriteWholeRunOverviewProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  ledgerNames?: ReadonlyMap<string, string>
  showArchiveTargets?: boolean
  selectedRecommendationIds?: ReadonlySet<string>
  enabledLedgerIds?: ReadonlySet<string>
  /**
   * A recommendation candidate can be adopted by an existing saved rule.
   * Classification snapshots may still carry the candidate id, while every
   * visible saved-rule control and its enabled state use the saved-rule id.
   */
  candidateLedgerIds?: ReadonlyMap<string, string>
}

const BILIMI_STAGING_TOOLTIP = '未匹配到合适分类会先归类在 bilimi·暂存里，保存到本地收藏库时会存入 bilimi·暂存，点击同步时默认不上传 B 站。'

export function OldFavoriteWholeRunOverview({
  snapshot,
  ledgerNames = new Map(),
  showArchiveTargets = false,
  selectedRecommendationIds,
  enabledLedgerIds,
  candidateLedgerIds
}: OldFavoriteWholeRunOverviewProps) {
  const overview = snapshot.overview
  if (!overview) {
    return <div className="favorite-ledger-panel__whole-run-overview favorite-ledger-panel__whole-run-overview--waiting" role="status">
      <strong>正在准备本轮总览</strong>
      <span>扫描完成后会显示本轮全部批次的整体进度。</span>
    </div>
  }

  const canonicalLedgerId = (ledgerId: string) => candidateLedgerIds?.get(ledgerId) ?? ledgerId
  const recommendationIds = new Set(snapshot.recommendations.candidates.map((candidate) => candidate.id))
  const selectedRecommendations = selectedRecommendationIds ?? new Set(snapshot.recommendations.adoptedCandidateIds)
  const archiveTargetById = new Map<string, typeof overview.archiveTargets[number]>()
  for (const target of overview.archiveTargets) {
    const ledgerId = canonicalLedgerId(target.ledgerId)
    if (ledgerId !== 'inbox' && enabledLedgerIds && !enabledLedgerIds.has(ledgerId)) continue
    if (recommendationIds.has(target.ledgerId) && !selectedRecommendations.has(target.ledgerId)) continue
    const current = archiveTargetById.get(ledgerId)
    if (!current) {
      archiveTargetById.set(ledgerId, ledgerId === target.ledgerId ? target : { ...target, ledgerId })
      continue
    }
    const segmentCounts = new Map(current.segmentCounts.map((segment) => [segment.segmentId, segment.count]))
    for (const segment of target.segmentCounts) {
      segmentCounts.set(segment.segmentId, (segmentCounts.get(segment.segmentId) ?? 0) + segment.count)
    }
    archiveTargetById.set(ledgerId, {
      ...current,
      itemCount: current.itemCount + target.itemCount,
      segmentCounts: [...segmentCounts].map(([segmentId, count]) => ({ segmentId, count }))
    })
  }
  const archiveTargetIds = [...new Set([
    'inbox',
    ...[...ledgerNames.keys()].map(canonicalLedgerId),
    ...archiveTargetById.keys()
  ])].filter((ledgerId) => {
    if (ledgerId === 'inbox') return true
    if (enabledLedgerIds && !enabledLedgerIds.has(ledgerId)) return false
    return true
  })
  const archiveTargets = archiveTargetIds.map((ledgerId) => archiveTargetById.get(ledgerId) ?? {
    ledgerId,
    itemCount: 0,
    segmentCounts: []
  })
  const wholeRunTagEnrichment = snapshot.tagEnrichment?.scopes?.wholeRun
  const segmentTagItemCount = snapshot.segments.reduce((count, segment) => count + segment.itemCount, 0)
  const segmentCompletedTagItemCount = snapshot.segments.reduce((count, segment) =>
    count + Math.min(segment.itemCount, segment.completedTagItemCount ?? 0), 0)
  const segmentPendingTagItemCount = snapshot.segments.reduce((count, segment) =>
    count + Math.min(segment.itemCount, segment.pendingTagItemCount ?? 0), 0)
  const tagItemCount = wholeRunTagEnrichment?.totalItemCount
    ?? snapshot.tagEnrichment?.totalItemCount
    ?? segmentTagItemCount
  const completedTagItemCount = wholeRunTagEnrichment?.completedItemCount
    ?? snapshot.tagEnrichment?.completedItemCount
    ?? segmentCompletedTagItemCount
  const pendingTagItemCount = wholeRunTagEnrichment?.pendingItemCount
    ?? snapshot.tagEnrichment?.pendingItemCount
    ?? segmentPendingTagItemCount
  const showTagProgress = snapshot.status !== 'scanning' && pendingTagItemCount > 0 && Boolean(
    snapshot.tagEnrichment || snapshot.segments.some((segment) =>
      segment.readiness === 'tagging' || segment.readiness === 'waiting')
  )

  return <div className="favorite-ledger-panel__whole-run-overview">
    <p className="favorite-ledger-panel__whole-run-status" role="status">
      已汇总 {overview.completedSegmentCount}/{overview.totalSegmentCount} 批
    </p>
    <p>已处理 {overview.processedItemCount} 条 · 已分类 {overview.classifiedItemCount} 条 · 暂存 {overview.unmatchedItemCount} 条</p>
    {overview.deepSeekPendingItemCount ? <p>其中 DeepSeek 待整理 {overview.deepSeekPendingItemCount} 条</p> : null}
    {showTagProgress ? <p>标签补取中 {tagItemCount} 条 · 已补取 {completedTagItemCount} 条 · 待补取 {pendingTagItemCount} 条</p> : null}
    {overview.savedItemCount ? <p>已保存 {overview.savedItemCount} 条</p> : null}
    {showArchiveTargets ? <div className="favorite-ledger-panel__whole-run-targets" aria-label="本轮归档目标总览">
      {archiveTargets.map((target) => {
        const localOnly = target.ledgerId === 'inbox'
        const targetName = localOnly ? 'bilimi·暂存' : ledgerNames.get(target.ledgerId) ?? target.ledgerId
        return <article key={target.ledgerId} className="favorite-ledger-panel__whole-run-target-row" title={localOnly ? BILIMI_STAGING_TOOLTIP : undefined}>
        <div><span className="favorite-ledger-panel__whole-run-target-title"><strong>{targetName}</strong>{localOnly ? <small className="favorite-ledger-panel__whole-run-target-subtitle">（未分类）</small> : null}</span><span>预计归档 {target.itemCount} 条</span></div>
        <ul>
          {target.segmentCounts.map((segment) => {
            const descriptor = snapshot.segments.find((item) => item.id === segment.segmentId)
            return <li key={segment.segmentId}>第 {(descriptor?.index ?? 0) + 1} 批 · {segment.count} 条</li>
          })}
        </ul>
      </article>})}
    </div> : null}
  </div>
}

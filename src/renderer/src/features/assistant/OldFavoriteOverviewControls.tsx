import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'

export type OldFavoriteViewScope = 'current' | 'all'

type OldFavoriteViewScopeSwitchProps = {
  label: string
  value: OldFavoriteViewScope
  onChange: (scope: OldFavoriteViewScope) => void
}

export function OldFavoriteViewScopeSwitch({ label, value, onChange }: OldFavoriteViewScopeSwitchProps) {
  return <div className="favorite-ledger-panel__view-scope" role="group" aria-label={label}>
    <button type="button" aria-pressed={value === 'current'} onClick={() => onChange('current')}>当前批次</button>
    <button type="button" aria-pressed={value === 'all'} onClick={() => onChange('all')}>本轮总览</button>
  </div>
}

type OldFavoriteWholeRunOverviewProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  ledgerNames?: ReadonlyMap<string, string>
  showArchiveTargets?: boolean
}

export function OldFavoriteWholeRunOverview({
  snapshot,
  ledgerNames = new Map(),
  showArchiveTargets = false
}: OldFavoriteWholeRunOverviewProps) {
  const overview = snapshot.overview
  if (!overview?.available) {
    return <div className="favorite-ledger-panel__whole-run-overview favorite-ledger-panel__whole-run-overview--waiting" role="status">
      <strong>本轮总览将在第一批完成后开放</strong>
      <span>后台仍会继续扫描和补取标签，当前批次可继续查看。</span>
    </div>
  }

  return <div className="favorite-ledger-panel__whole-run-overview">
    <p className="favorite-ledger-panel__whole-run-status" role="status">
      已汇总 {overview.completedSegmentCount}/{overview.totalSegmentCount} 批
    </p>
    <p>已处理 {overview.processedItemCount} 条 · 已分类 {overview.classifiedItemCount} 条 · 未匹配 {overview.unmatchedItemCount} 条</p>
    {overview.waitingItemCount ? <p>等待预处理 {overview.waitingItemCount} 条</p> : null}
    {showArchiveTargets ? <div className="favorite-ledger-panel__whole-run-targets" aria-label="本轮归档目标总览">
      {overview.archiveTargets.map((target) => <article key={target.ledgerId} className="favorite-ledger-panel__whole-run-target-row">
        <div><strong>{ledgerNames.get(target.ledgerId) ?? target.ledgerId}</strong><span>预计归档 {target.itemCount} 条</span></div>
        <ul>
          {target.segmentCounts.map((segment) => {
            const descriptor = snapshot.segments.find((item) => item.id === segment.segmentId)
            return <li key={segment.segmentId}>第 {(descriptor?.index ?? 0) + 1} 批 · {segment.count} 条</li>
          })}
        </ul>
      </article>)}
      {overview.archiveTargets.length === 0 ? <p>已完成批次暂时没有可归档分类。</p> : null}
    </div> : null}
  </div>
}

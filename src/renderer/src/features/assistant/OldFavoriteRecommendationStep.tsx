import type { OldFavoriteWorkspaceRecommendationCandidate, OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { stripBilimiLedgerPrefix } from '@shared/favoriteLedgers'
import { useState } from 'react'
import { OldFavoriteViewScopeSwitch, OldFavoriteWholeRunOverview, type OldFavoriteViewScope } from './OldFavoriteOverviewControls'

type OldFavoriteRecommendationStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  loading: boolean
  adoptedCandidateIds?: string[]
  recommendationSaving?: boolean
  error?: string | null
  previewPreparationRunning?: boolean
  previewPreparationProgress?: { completedItemCount: number; totalItemCount: number } | null
  previewPreparationError?: string | null
  onCancelPreviewPreparation?: () => void
  onSetRecommendedCandidates: (candidateIds: string[]) => void
  onUpdateRecommendedCandidates?: (update: (current: string[]) => string[]) => void
  viewScope?: OldFavoriteViewScope
  onViewScopeChange?: (scope: OldFavoriteViewScope) => void
}

type CandidateGroup = {
  heading: string
  emptyText: string
  allCandidates: OldFavoriteWorkspaceRecommendationCandidate[]
  candidates: OldFavoriteWorkspaceRecommendationCandidate[]
  expanded: boolean
  onToggleExpanded: () => void
  expandLabel: string
  collapseLabel: string
}

function candidateLabel(candidate: OldFavoriteWorkspaceRecommendationCandidate) {
  return stripBilimiLedgerPrefix(candidate.displayName)
}

function candidateDetail(candidate: OldFavoriteWorkspaceRecommendationCandidate, count: number) {
  return `${count} 条适合`
}

export function OldFavoriteRecommendationStep({
  snapshot,
  loading,
  adoptedCandidateIds: controlledAdoptedCandidateIds,
  recommendationSaving = false,
  error,
  previewPreparationRunning = false,
  previewPreparationProgress,
  previewPreparationError,
  onCancelPreviewPreparation = () => undefined,
  onSetRecommendedCandidates,
  onUpdateRecommendedCandidates,
  viewScope: controlledViewScope,
  onViewScopeChange
}: OldFavoriteRecommendationStepProps) {
  const [authorCandidatesExpanded, setAuthorCandidatesExpanded] = useState(false)
  const [tagCandidatesExpanded, setTagCandidatesExpanded] = useState(false)
  const [localViewScope, setLocalViewScope] = useState<OldFavoriteViewScope>('current')
  const viewScope = controlledViewScope ?? localViewScope
  const setViewScope = onViewScopeChange ?? setLocalViewScope
  const adoptedCandidateIds = new Set(controlledAdoptedCandidateIds ?? snapshot.recommendations.adoptedCandidateIds)
  const hasMultipleSegments = snapshot.hasMultipleSegments || snapshot.segments.length > 1
  const overviewCounts = new Map((snapshot.overview?.recommendationCounts ?? []).map((candidate) => [candidate.id, candidate.count]))
  const countForCandidate = (candidate: OldFavoriteWorkspaceRecommendationCandidate) => viewScope === 'all'
    ? overviewCounts.get(candidate.id) ?? 0
    : candidate.currentSegmentCount ?? candidate.count
  const overviewUnavailable = hasMultipleSegments && viewScope === 'all' && !snapshot.overview
  const scopedCandidates = overviewUnavailable ? [] : snapshot.recommendations.candidates.filter((candidate) =>
    countForCandidate(candidate) > 0 || adoptedCandidateIds.has(candidate.id))
  const authorCandidates = scopedCandidates.filter((candidate) => candidate.kind === 'author')
  const tagCandidates = scopedCandidates.filter((candidate) => candidate.kind === 'tag')
  const groups: CandidateGroup[] = [
    {
      heading: '专属 UP 追更',
      emptyText: '暂无专属 UP 追更候选。',
      allCandidates: authorCandidates,
      candidates: authorCandidatesExpanded ? authorCandidates : authorCandidates.slice(0, 6),
      expanded: authorCandidatesExpanded,
      onToggleExpanded: () => setAuthorCandidatesExpanded((expanded) => !expanded),
      expandLabel: '展开更多专属 UP 追更',
      collapseLabel: '收起专属 UP 追更'
    },
    {
      heading: '高频标签收藏夹',
      emptyText: '暂无高频标签收藏夹候选，可直接查看归档预览。',
      allCandidates: tagCandidates,
      candidates: tagCandidatesExpanded ? tagCandidates : tagCandidates.slice(0, 6),
      expanded: tagCandidatesExpanded,
      onToggleExpanded: () => setTagCandidatesExpanded((expanded) => !expanded),
      expandLabel: '展开更多高频标签',
      collapseLabel: '收起高频标签'
    }
  ]

  const setGroupSelected = (candidates: OldFavoriteWorkspaceRecommendationCandidate[], selected: boolean) => {
    if (onUpdateRecommendedCandidates) {
      onUpdateRecommendedCandidates((currentIds) => {
        const next = new Set(currentIds)
        for (const candidate of candidates) {
          if (selected) next.add(candidate.id)
          else next.delete(candidate.id)
        }
        return [...next]
      })
      return
    }
    const next = new Set(adoptedCandidateIds)
    for (const candidate of candidates) {
      if (selected) next.add(candidate.id)
      else next.delete(candidate.id)
    }
    onSetRecommendedCandidates([...next])
  }

  return <section className="favorite-ledger-panel__candidates" aria-label="专属收藏夹候选">
    <div className="favorite-ledger-panel__step-title-row">
      <h4 className="favorite-ledger-panel__step-title">推荐收藏夹</h4>
      {hasMultipleSegments ? <OldFavoriteViewScopeSwitch label="推荐收藏夹视图" value={viewScope} onChange={setViewScope} /> : null}
    </div>
    {hasMultipleSegments && viewScope === 'all' ? <OldFavoriteWholeRunOverview snapshot={snapshot} /> : null}
    <p className="favorite-ledger-panel__step-note">勾选想要的候选收藏夹；确认执行时再按所选方式保存或同步。</p>
    <p className="favorite-ledger-panel__action-explanation">全选只作用于当前候选组；取消勾选不会删除已有的 B 站收藏夹。</p>
    {error ? <p role="alert" className="favorite-ledger-panel__recommendation-error">{error}</p> : null}
    {recommendationSaving ? <p className="favorite-ledger-panel__recommendation-saving" role="status">正在更新归档预览…</p> : null}
    {previewPreparationRunning ? <div className="favorite-ledger-panel__preview-preparation" role="status">
      <p>正在准备归档预览：{previewPreparationProgress?.completedItemCount ?? 0} / {previewPreparationProgress?.totalItemCount ?? 0}</p>
      <button type="button" onClick={onCancelPreviewPreparation}>取消准备</button>
    </div> : null}
    {previewPreparationError ? <p role="alert" className="favorite-ledger-panel__recommendation-error">{previewPreparationError}</p> : null}
    {!overviewUnavailable && scopedCandidates.length === 0 ? <p>{viewScope === 'current'
      ? hasMultipleSegments
        ? '当前批次没有足够重复的 UP 或标签，暂不生成推荐收藏夹。'
        : '本轮没有足够重复的 UP 或标签，暂不生成推荐收藏夹。'
      : '已汇总批次没有足够重复的 UP 或标签，暂不生成推荐收藏夹。'}</p> : null}
    {groups.map((group, index) => {
      const allSelected = group.allCandidates.length > 0 && group.allCandidates.every((candidate) => adoptedCandidateIds.has(candidate.id))
      return <div key={group.heading} className="favorite-ledger-panel__candidate-section">
        {index > 0 ? <hr className="favorite-ledger-panel__step-divider" aria-hidden="true" /> : null}
        <div className="favorite-ledger-panel__candidate-section-heading">
          <h5>{group.heading}</h5>
          <label>
            <input type="checkbox" aria-label={`全选 ${group.heading}`} checked={allSelected}
              disabled={loading || group.allCandidates.length === 0}
              onChange={(event) => setGroupSelected(group.allCandidates, event.currentTarget.checked)} />
            <span>全选</span>
          </label>
        </div>
        <div className="favorite-ledger-panel__candidate-list">
          {group.candidates.map((candidate) => {
            const adopted = adoptedCandidateIds.has(candidate.id)
            return <article key={candidate.id} title={candidate.reason}>
              <label>
                <input type="checkbox" aria-label={candidateLabel(candidate)} checked={adopted} disabled={loading}
                  onChange={(event) => {
                    if (onUpdateRecommendedCandidates) {
                      const selected = event.currentTarget.checked
                      onUpdateRecommendedCandidates((currentIds) => {
                        const next = new Set(currentIds)
                        if (selected) next.add(candidate.id)
                        else next.delete(candidate.id)
                        return [...next]
                      })
                      return
                    }
                    const next = new Set(adoptedCandidateIds)
                    if (event.currentTarget.checked) next.add(candidate.id)
                    else next.delete(candidate.id)
                    onSetRecommendedCandidates([...next])
                  }} />
                <span><strong>{candidateLabel(candidate)}</strong><small>{candidateDetail(candidate, countForCandidate(candidate))}</small></span>
              </label>
            </article>
          })}
          {group.candidates.length === 0 ? <p>{group.emptyText}</p> : null}
          {group.allCandidates.length > 6 ? (
            <button type="button" aria-expanded={group.expanded} onClick={group.onToggleExpanded}>
              {group.expanded ? group.collapseLabel : group.expandLabel}
            </button>
          ) : null}
        </div>
      </div>
    })}
  </section>
}

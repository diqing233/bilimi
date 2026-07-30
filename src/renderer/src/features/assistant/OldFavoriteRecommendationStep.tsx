import type { OldFavoriteWorkspaceRecommendationCandidate, OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { stripBilimiLedgerPrefix } from '@shared/favoriteLedgers'
import { useState } from 'react'

type OldFavoriteRecommendationStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  loading: boolean
  adoptedCandidateIds?: string[]
  saving?: boolean
  error?: string | null
  onSetRecommendedCandidates: (candidateIds: string[]) => void
}

type CandidateGroup = {
  heading: string
  emptyText: string
  candidates: OldFavoriteWorkspaceRecommendationCandidate[]
}

function candidateLabel(candidate: OldFavoriteWorkspaceRecommendationCandidate) {
  return stripBilimiLedgerPrefix(candidate.displayName)
}

function candidateDetail(candidate: OldFavoriteWorkspaceRecommendationCandidate) {
  return `${candidate.count} 条适合`
}

export function OldFavoriteRecommendationStep({
  snapshot,
  loading,
  adoptedCandidateIds: controlledAdoptedCandidateIds,
  saving = false,
  error,
  onSetRecommendedCandidates
}: OldFavoriteRecommendationStepProps) {
  const [tagCandidatesExpanded, setTagCandidatesExpanded] = useState(false)
  const adoptedCandidateIds = new Set(controlledAdoptedCandidateIds ?? snapshot.recommendations.adoptedCandidateIds)
  const tagCandidates = snapshot.recommendations.candidates.filter((candidate) => candidate.kind === 'tag')
  const groups: CandidateGroup[] = [
    {
      heading: '专属 UP 追更',
      emptyText: '暂无专属 UP 追更候选。',
      candidates: snapshot.recommendations.candidates.filter((candidate) => candidate.kind === 'author')
    },
    {
      heading: '高频标签收藏夹',
      emptyText: '暂无高频标签收藏夹候选，可直接查看归档预览。',
      candidates: tagCandidatesExpanded ? tagCandidates : tagCandidates.slice(0, 6)
    }
  ]

  const setGroupSelected = (candidates: OldFavoriteWorkspaceRecommendationCandidate[], selected: boolean) => {
    const next = new Set(adoptedCandidateIds)
    for (const candidate of candidates) {
      if (selected) next.add(candidate.id)
      else next.delete(candidate.id)
    }
    onSetRecommendedCandidates([...next])
  }

  return <section className="favorite-ledger-panel__candidates" aria-label="专属收藏夹候选">
    <h4 className="favorite-ledger-panel__step-title">推荐收藏夹</h4>
    <p className="favorite-ledger-panel__step-note">勾选想要的候选收藏夹；确认执行时再按所选方式保存或同步。</p>
    <p className="favorite-ledger-panel__action-explanation">全选只作用于当前候选组；取消勾选不会删除已有的 B 站收藏夹。</p>
    {saving ? <p role="status" className="favorite-ledger-panel__recommendation-status">正在更新推荐收藏夹，仍可继续调整选择。</p> : null}
    {error ? <p role="alert" className="favorite-ledger-panel__recommendation-error">{error}</p> : null}
    {snapshot.recommendations.candidates.length === 0 ? <p>本轮没有足够重复的 UP 或标签，暂不生成推荐收藏夹。</p> : null}
    {groups.map((group, index) => {
      const allSelected = group.candidates.length > 0 && group.candidates.every((candidate) => adoptedCandidateIds.has(candidate.id))
      return <div key={group.heading} className="favorite-ledger-panel__candidate-section">
        {index > 0 ? <hr className="favorite-ledger-panel__step-divider" aria-hidden="true" /> : null}
        <div className="favorite-ledger-panel__candidate-section-heading">
          <h5>{group.heading}</h5>
          <label>
            <input type="checkbox" aria-label={`全选 ${group.heading}`} checked={allSelected}
              disabled={loading || group.candidates.length === 0}
              onChange={(event) => setGroupSelected(group.candidates, event.currentTarget.checked)} />
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
                    const next = new Set(adoptedCandidateIds)
                    if (event.currentTarget.checked) next.add(candidate.id)
                    else next.delete(candidate.id)
                    onSetRecommendedCandidates([...next])
                  }} />
                <span><strong>{candidateLabel(candidate)}</strong><small>{candidateDetail(candidate)}</small></span>
              </label>
            </article>
          })}
          {group.candidates.length === 0 ? <p>{group.emptyText}</p> : null}
          {group.heading === '高频标签收藏夹' && !tagCandidatesExpanded && tagCandidates.length > group.candidates.length ? (
            <button type="button" onClick={() => setTagCandidatesExpanded(true)}>展开更多高频标签</button>
          ) : null}
        </div>
      </div>
    })}
  </section>
}

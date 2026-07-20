import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'

type OldFavoriteRecommendationStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  loading: boolean
  onSetRecommendedCandidates: (candidateIds: string[]) => void
}

export function OldFavoriteRecommendationStep({
  snapshot,
  loading,
  onSetRecommendedCandidates
}: OldFavoriteRecommendationStepProps) {
  const candidates = snapshot.recommendations.candidates
  const adoptedCandidateIds = new Set(snapshot.recommendations.adoptedCandidateIds)

  return <section className="favorite-ledger-panel__candidates" aria-label="专属收藏夹候选">
    <h4>推荐收藏夹</h4>
    {candidates.length === 0 ? <p>本轮没有足够重复的 UP 或标签，暂不生成推荐收藏夹。</p> :
      <div className="favorite-ledger-panel__candidate-list">
        {candidates.map((candidate) => {
          const kind = candidate.kind === 'author' ? 'UP' : '标签'
          const adopted = adoptedCandidateIds.has(candidate.id)
          return <article key={candidate.id}>
            <label>
              <input
                type="checkbox"
                aria-label={`${kind} ${candidate.displayName}`}
                checked={adopted}
                disabled={loading}
                onChange={(event) => {
                  const next = new Set(adoptedCandidateIds)
                  if (event.currentTarget.checked) next.add(candidate.id); else next.delete(candidate.id)
                  onSetRecommendedCandidates([...next])
                }}
              />
              <span>
                <strong>{kind} · {candidate.displayName}</strong>
                <small>{candidate.reason} · {candidate.count} 条</small>
              </span>
            </label>
          </article>
        })}
      </div>}
  </section>
}

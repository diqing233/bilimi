import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'

type OldFavoriteConfirmationStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  loading: boolean
  onSaveLocally: () => void
  onConfirmAndSync: () => void
  onExecuteFrozenPlan: () => void
  onReconcile: () => void
}

function isReadyToFreeze(snapshot: OldFavoriteWorkspaceSnapshot) {
  return Boolean(snapshot.planReadiness &&
    snapshot.planReadiness.selectedAidCount > 0 && snapshot.planReadiness.unclassifiedAidCount === 0)
}

export function OldFavoriteConfirmationStep({
  snapshot,
  loading,
  onSaveLocally,
  onConfirmAndSync,
  onExecuteFrozenPlan,
  onReconcile
}: OldFavoriteConfirmationStepProps) {
  const canFreeze = isReadyToFreeze(snapshot)
  const readiness = snapshot.planReadiness
  const isMultiSegment = snapshot.hasMultipleSegments

  if (snapshot.status === 'completed') {
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <p role="status">{snapshot.completionMode === 'local'
        ? '本轮已保存到收藏库。'
        : '本轮已完成同步到 B 站。已提交的 B 站操作不会在此撤销。'}</p>
    </section>
  }

  if (snapshot.status === 'executing') {
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <div className="favorite-ledger-panel__old-favorite-progress" role="status">
        <p>正在同步到 B 站，主进程会持续更新执行结果。</p>
        <progress aria-label="正在同步到 B 站" />
      </div>
    </section>
  }

  if (snapshot.status === 'reconciling') {
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <p>远端结果仍在确认中，请先对账 B 站结果；不能直接重复提交。</p>
      <button type="button" disabled={loading} onClick={onReconcile}>对账 B 站结果</button>
    </section>
  }

  if (snapshot.status === 'frozen') {
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <p>分类计划已冻结，可继续同步到 B 站。</p>
      <button type="button" disabled={loading} onClick={onExecuteFrozenPlan}>继续同步到 B 站</button>
    </section>
  }

  const readinessText = readiness && isMultiSegment
    ? `整体准备度：${readiness.classifiedAidCount} / ${readiness.selectedAidCount} 条已分类`
    : null
  const blockedMessage = readiness?.unclassifiedAidCount
    ? isMultiSegment
      ? `还需完成 ${readiness.unclassifiedAidCount} 条（跨所有分段）。`
      : `还需完成 ${readiness.unclassifiedAidCount} 条。`
    : '正在等待主进程确认本轮分类准备度。'

  return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
    <h4>确认执行</h4>
    <p>可直接同步到 B 站，或仅保存到本地收藏库；两种方式都会冻结当前分类结果。</p>
    {readinessText ? <p>{readinessText}</p> : null}
    {!canFreeze ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{blockedMessage}</p> : null}
    <div className="favorite-ledger-panel__confirm-actions">
      <button type="button" disabled={!canFreeze || loading} onClick={onSaveLocally}>仅保存本轮到收藏库</button>
      <button type="button" disabled={!canFreeze || loading} onClick={onConfirmAndSync}>确认并同步到 B 站</button>
    </div>
  </section>
}

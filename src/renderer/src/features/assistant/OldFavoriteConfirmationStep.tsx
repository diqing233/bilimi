import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'

type OldFavoriteConfirmationStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  loading: boolean
  executionError?: string | null
  onSaveLocally: () => void
  onConfirmAndSync: () => void
  onExecuteFrozenPlan: () => void
  onReconcile: () => void
}

function readinessFor(snapshot: OldFavoriteWorkspaceSnapshot) {
  const readiness = snapshot.planReadiness
  const hasSelected = Boolean(readiness && readiness.selectedAidCount > 0)
  return {
    canSaveLocally: hasSelected,
    canSyncToBilibili: Boolean(readiness && readiness.classifiedAidCount > 0),
    unclassifiedCount: readiness?.unclassifiedAidCount ?? 0
  }
}

export function OldFavoriteConfirmationStep({
  snapshot,
  loading,
  executionError,
  onSaveLocally,
  onConfirmAndSync,
  onExecuteFrozenPlan,
  onReconcile
}: OldFavoriteConfirmationStepProps) {
  const { canSaveLocally, canSyncToBilibili, unclassifiedCount } = readinessFor(snapshot)
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
    const completed = snapshot.executionProgress?.completedOperationCount ?? 0
    const total = snapshot.executionProgress?.totalOperationCount ?? 0
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <div className="favorite-ledger-panel__old-favorite-progress" role="status">
        <p>正在同步到 B 站，主进程会持续更新执行结果。</p>
        {total > 0 ? <p>已完成 {completed} / {total} 条</p> : null}
        <progress aria-label="正在同步到 B 站" value={completed} max={Math.max(total, 1)} />
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
  const blockedMessage = unclassifiedCount
    ? `${unclassifiedCount} 条未分类视频会仅本地暂存，不会同步到 B 站。`
    : !canSaveLocally
      ? '正在等待主进程确认本轮分类准备度。'
      : null

  return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
    <h4>确认执行</h4>
    <p>可直接同步到 B 站，或仅保存到本地收藏库；两种方式都会冻结当前分类结果。</p>
    {readinessText ? <p>{readinessText}</p> : null}
    {blockedMessage ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{blockedMessage}</p> : null}
    {executionError ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{executionError}</p> : null}
    <div className="favorite-ledger-panel__confirm-actions">
      <button type="button" disabled={!canSaveLocally || loading} onClick={onSaveLocally}>仅保存本轮到收藏库</button>
      <button type="button" disabled={!canSyncToBilibili || loading} onClick={onConfirmAndSync}>确认并同步到 B 站</button>
    </div>
  </section>
}

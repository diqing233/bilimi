import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'

type OldFavoriteConfirmationStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  loading: boolean
  reconciling?: boolean
  preparationStatus?: string | null
  executionError?: string | null
  onSaveLocally: () => void
  onAbandonCurrentWorkspace?: () => void
  onAcknowledgeCompletion?: () => void
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
  reconciling = false,
  preparationStatus,
  executionError,
  onSaveLocally,
  onAbandonCurrentWorkspace = () => undefined,
  onAcknowledgeCompletion = () => undefined,
  onConfirmAndSync,
  onExecuteFrozenPlan,
  onReconcile
}: OldFavoriteConfirmationStepProps) {
  const { canSaveLocally, canSyncToBilibili, unclassifiedCount } = readinessFor(snapshot)
  const readiness = snapshot.planReadiness
  const isMultiSegment = snapshot.hasMultipleSegments
  const currentSegmentSummary = snapshot.currentSegment
    ? snapshot.segments.find((segment) => segment.id === snapshot.currentSegment?.id)
    : undefined
  const currentSegmentSaved = Boolean(currentSegmentSummary && (
    currentSegmentSummary.status === 'frozen' || currentSegmentSummary.readiness === 'saved'
  ))
  const allSegmentsSaved = !isMultiSegment || snapshot.segments.every((segment) => (
    segment.status === 'frozen' || segment.readiness === 'saved'
  ))
  const localSaveLabel = isMultiSegment
    ? currentSegmentSaved ? '当前批已保存' : '保存当前批到收藏库'
    : '仅保存本轮到收藏库'
  const syncExplanation = snapshot.scope?.kind === 'selection'
    ? '本次确认同步会替换所选视频在 bilimi 管理收藏夹中的归属；不会删除或取消用户自己的收藏夹关系；开始后本轮方案锁定。'
    : '确认同步只会追加到 bilimi 收藏夹，不会删除、移动或取消原收藏；开始后本轮方案锁定。'

  if (snapshot.status === 'completed') {
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <p role="status">{snapshot.completionMode === 'local'
        ? '本轮已保存到收藏库。'
        : '本轮已完成同步到 B 站。已提交的 B 站操作不会在此撤销。'}</p>
      <button type="button" onClick={onAcknowledgeCompletion}>好的</button>
    </section>
  }

  if (reconciling || snapshot.status === 'reconciling') {
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <p>远端结果仍在确认中，请先对账 B 站结果；不能直接重复提交。</p>
      {loading ? <p role="status">正在对账 B 站结果，请保持已登录的 B 站页面打开。</p> : null}
      {executionError ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{executionError}</p> : null}
      <button type="button" disabled={loading} onClick={onReconcile}>对账 B 站结果</button>
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

  if (snapshot.status === 'frozen') {
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <p>分类计划已冻结，可继续同步到 B 站。</p>
      <button type="button" disabled={loading} onClick={onExecuteFrozenPlan}>继续同步到 B 站</button>
      <p>放弃只会丢弃尚未执行的本轮分类草稿，不会撤销已保存到收藏库或已提交到 B 站的内容。</p>
      <button type="button" disabled={loading} onClick={onAbandonCurrentWorkspace}>放弃本轮整理</button>
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
    <p>确认本轮分类结果，并选择保存到收藏库或同步到 B 站。</p>
    <p className="favorite-ledger-panel__action-explanation">{syncExplanation}</p>
    {readinessText ? <p>{readinessText}</p> : null}
    {preparationStatus ? <p role="status">{preparationStatus}</p> : null}
    {blockedMessage ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{blockedMessage}</p> : null}
    {executionError ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{executionError}</p> : null}
    <div className="favorite-ledger-panel__confirm-actions">
      <button type="button" disabled={!canSaveLocally || loading || currentSegmentSaved} onClick={onSaveLocally}>{localSaveLabel}</button>
      <button type="button" disabled={!canSyncToBilibili || loading || !allSegmentsSaved} onClick={onConfirmAndSync}>确认并同步到 B 站</button>
      <button type="button" disabled={loading} onClick={onAbandonCurrentWorkspace}>放弃本轮整理</button>
    </div>
  </section>
}

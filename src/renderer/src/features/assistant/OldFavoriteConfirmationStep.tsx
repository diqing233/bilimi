import type { FavoriteLedger } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { useEffect, useState } from 'react'
import { OldFavoriteViewScopeSwitch, OldFavoriteWholeRunOverview, type OldFavoriteViewScope } from './OldFavoriteOverviewControls'

type OldFavoriteConfirmationStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  ledgers?: FavoriteLedger[]
  loading: boolean
  reconciling?: boolean
  preparationStatus?: string | null
  executionError?: string | null
  onSaveLocally: () => void
  onCancelExecutionIntent?: () => void
  onAbandonCurrentWorkspace?: () => void
  onAcknowledgeCompletion?: () => void
  onConfirmAndSync: () => void
  onUseOriginalClassifications?: () => void
  onExecuteFrozenPlan: () => void
  onReconcile: () => void
  viewScope?: OldFavoriteViewScope
  onViewScopeChange?: (scope: OldFavoriteViewScope) => void
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

function retryWaitLabel(remainingMs: number) {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1_000))
  return seconds < 60 ? `${seconds} 秒` : `${Math.ceil(seconds / 60)} 分钟`
}

export function OldFavoriteConfirmationStep({
  snapshot,
  ledgers = [],
  loading,
  reconciling = false,
  preparationStatus,
  executionError,
  onSaveLocally,
  onCancelExecutionIntent = () => undefined,
  onAbandonCurrentWorkspace = () => undefined,
  onAcknowledgeCompletion = () => undefined,
  onConfirmAndSync,
  onUseOriginalClassifications = () => undefined,
  onExecuteFrozenPlan,
  onReconcile,
  viewScope: controlledViewScope,
  onViewScopeChange
}: OldFavoriteConfirmationStepProps) {
  const failureReason = snapshot.executionProgress?.lastFailureReason ?? ''
  const retryAvailableAt = snapshot.executionProgress?.retryAvailableAt
  const [retryClock, setRetryClock] = useState(() => Date.now())
  const retryRemainingMs = retryAvailableAt ? Math.max(0, Date.parse(retryAvailableAt) - retryClock) : 0
  const retryCoolingDown = retryRemainingMs > 0
  useEffect(() => {
    if (!retryAvailableAt) return
    setRetryClock(Date.now())
    const timer = window.setInterval(() => setRetryClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [retryAvailableAt])
  const frozenFailureMessage = failureReason
    ? /invalid-response/i.test(failureReason)
      ? `B 站返回了无法解析的响应${/http-status=(\d+)/i.exec(failureReason)?.[1] ? `（HTTP ${/http-status=(\d+)/i.exec(failureReason)?.[1]}）` : ''}${/response-category=html|content-type=text\/html/i.test(failureReason) ? '，内容为 HTML' : ''}。这可能是嵌入页面临时验证或限制，系统已停止连续重试；请稍后再继续。`
      : `上次同步已安全停止：${failureReason}`
    : null
  const [localViewScope, setLocalViewScope] = useState<OldFavoriteViewScope>('all')
  const viewScope = controlledViewScope ?? localViewScope
  const setViewScope = onViewScopeChange ?? setLocalViewScope
  const { canSaveLocally, canSyncToBilibili, unclassifiedCount } = readinessFor(snapshot)
  const readiness = snapshot.planReadiness
  const failedDeepSeekCount = snapshot.deepSeekRun?.failedVideoCount ?? 0
  const deepSeekBlocksExecution = Boolean(snapshot.deepSeekRun)
  const isMultiSegment = snapshot.hasMultipleSegments
  const currentSegmentSummary = snapshot.currentSegment
    ? snapshot.segments.find((segment) => segment.id === snapshot.currentSegment?.id)
    : undefined
  const currentSegmentSaved = Boolean(currentSegmentSummary && (
    currentSegmentSummary.status === 'frozen' || currentSegmentSummary.readiness === 'saved'
  ))
  const localSaveLabel = isMultiSegment
    ? '保存本轮到收藏库'
    : '仅保存本轮到收藏库'
  const syncExplanation = snapshot.scope?.kind === 'selection'
    ? '本次确认同步会替换所选视频在 bilimi 管理收藏夹中的归属；不会删除或取消用户自己的收藏夹关系；开始后本轮方案锁定。'
    : '确认同步只会追加到 bilimi 收藏夹，不会删除、移动或取消原收藏；开始后本轮方案锁定。'
  const ledgerNames = new Map<string, string>([['inbox', 'bilimi·暂存'], ...ledgers.map((ledger) => [ledger.id, ledger.displayName] as const)])

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
    const completed = snapshot.executionProgress?.completedOperationCount ?? 0
    const total = snapshot.executionProgress?.totalOperationCount ?? 0
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <p>上次提交结果仍需确认。系统会先重新连接并检查 B 站实际收藏状态，不会直接重复提交。</p>
      {total > 0 ? <div className="favorite-ledger-panel__old-favorite-progress">
        <p>已完成 {completed} / {total} 条</p>
        <progress aria-label="同步到 B 站进度" value={completed} max={Math.max(total, 1)} />
      </div> : null}
      {loading ? <p role="status">正在检查 B 站同步结果，请保持已登录的 B 站页面打开。</p> : null}
      {executionError ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{executionError}</p> : null}
      <button type="button" disabled={loading} onClick={onReconcile}>{loading ? '正在检查…' : '重新连接并检查同步结果'}</button>
    </section>
  }

  if (snapshot.status === 'executing') {
    const completed = snapshot.executionProgress?.completedOperationCount ?? 0
    const total = snapshot.executionProgress?.totalOperationCount ?? 0
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <div className="favorite-ledger-panel__step-title-row">
        <h4>确认执行</h4>
        {isMultiSegment ? <OldFavoriteViewScopeSwitch label="确认执行视图" value={viewScope} onChange={setViewScope} /> : null}
      </div>
      {isMultiSegment && viewScope === 'all' ? <OldFavoriteWholeRunOverview snapshot={snapshot} ledgerNames={ledgerNames} showArchiveTargets /> : null}
      {isMultiSegment && viewScope === 'current' && currentSegmentSummary
        ? <p className="favorite-ledger-panel__current-segment-summary">当前批次：第 {currentSegmentSummary.index + 1}/{snapshot.segments.length} 批 · {currentSegmentSummary.itemCount} 条</p>
        : null}
      <div className="favorite-ledger-panel__old-favorite-progress" role="status">
        <p>正在同步到 B 站，主进程会持续更新执行结果。</p>
        {total > 0 ? <p>已完成 {completed} / {total} 条</p> : null}
        <progress aria-label="正在同步到 B 站" value={completed} max={Math.max(total, 1)} />
      </div>
    </section>
  }

  if (snapshot.status === 'frozen') {
    const completed = snapshot.executionProgress?.completedOperationCount ?? 0
    const total = snapshot.executionProgress?.totalOperationCount ?? 0
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      {failureReason ? <div className="favorite-ledger-panel__old-favorite-progress" role="status">
        <p>B 站同步已暂停。</p>
        {total > 0 ? <p>已完成 {completed} / {total} 条；继续时只处理剩余项目。</p> : null}
        {total > 0 ? <progress aria-label="同步到 B 站进度" value={completed} max={Math.max(total, 1)} /> : null}
      </div> : <p>分类计划已冻结，可继续同步到 B 站。</p>}
      {frozenFailureMessage ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{frozenFailureMessage}</p> : null}
      <button type="button" disabled={loading || retryCoolingDown} onClick={onExecuteFrozenPlan}>{retryCoolingDown
        ? `等待 ${retryWaitLabel(retryRemainingMs)} 后重试`
        : failureReason ? '重新连接并继续同步' : '继续同步到 B 站'}</button>
      <p>放弃只会丢弃尚未执行的本轮分类草稿，不会撤销已保存到收藏库或已提交到 B 站的内容。</p>
      <button type="button" disabled={loading} onClick={onAbandonCurrentWorkspace}>放弃本轮整理</button>
    </section>
  }

  if (snapshot.executionIntent) {
    const waiting = snapshot.executionIntent
    return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
      <h4>确认执行</h4>
      <div className="favorite-ledger-panel__old-favorite-progress" role="status">
        <p>{waiting.status === 'blocked'
          ? '自动执行已停止：DeepSeek 整理被取消或仍有失败结果。'
          : waiting.status === 'running'
            ? '全部条件已满足，正在执行本轮保存计划。'
          : waiting.waitingSegmentCount
            ? `等待 ${waiting.waitingSegmentCount} 个批次完成预处理。`
            : '全部批次已完成预处理，正在等待后续任务。'}</p>
        {waiting.waitingForDeepSeek ? <p>DeepSeek 全轮整理完成后会自动继续。</p> : null}
        <p>{waiting.mode === 'local' ? '完成后会保存本轮到收藏库。' : '完成后会保存暂存内容并开始同步到 B 站。'}</p>
      </div>
      {waiting.status !== 'running'
        ? <button type="button" disabled={loading} onClick={onCancelExecutionIntent}>取消等待执行</button>
        : null}
    </section>
  }

  const readinessText = readiness && isMultiSegment
    ? `整体准备度：${readiness.classifiedAidCount} / ${readiness.selectedAidCount} 条已分类`
    : null
  const unmatchedCount = isMultiSegment ? snapshot.overview?.unmatchedItemCount ?? 0 : unclassifiedCount
  const blockedMessage = unmatchedCount
    ? `bilimi·暂存 ${unmatchedCount} 条：保存到本地收藏库；点击同步时默认不上传 B 站。`
    : !canSaveLocally
      ? '正在等待主进程确认本轮分类准备度。'
      : null

  return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
    <div className="favorite-ledger-panel__step-title-row">
      <h4>确认执行</h4>
      {isMultiSegment ? <OldFavoriteViewScopeSwitch label="确认执行视图" value={viewScope} onChange={setViewScope} /> : null}
    </div>
    {isMultiSegment && viewScope === 'all' ? <OldFavoriteWholeRunOverview snapshot={snapshot} ledgerNames={ledgerNames} showArchiveTargets /> : null}
    {isMultiSegment && viewScope === 'current' && currentSegmentSummary
      ? <p className="favorite-ledger-panel__current-segment-summary">当前批次：第 {currentSegmentSummary.index + 1}/{snapshot.segments.length} 批 · {currentSegmentSummary.itemCount} 条</p>
      : null}
    <p>确认本轮分类结果，并选择保存到收藏库或同步到 B 站。</p>
    <p className="favorite-ledger-panel__action-explanation">{syncExplanation}</p>
    {readinessText ? <p>{readinessText}</p> : null}
    {preparationStatus ? <p role="status">{preparationStatus}</p> : null}
    {blockedMessage ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{blockedMessage}</p> : null}
    {executionError ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{executionError}</p> : null}
    {failedDeepSeekCount ? <div className="favorite-ledger-panel__confirm-warning" role="alert">
      <p>{failedDeepSeekCount} 条视频的 DeepSeek 整理失败，重试或明确沿用原自动分类后才能保存或同步。</p>
      <button type="button" disabled={loading} onClick={() => {
        if (window.confirm(`确认让 ${failedDeepSeekCount} 条 DeepSeek 失败视频沿用整理前的自动分类吗？此选择会写入本轮改动记录。`)) {
          onUseOriginalClassifications()
        }
      }}>沿用 {failedDeepSeekCount} 条视频的原自动分类</button>
    </div> : null}
    <div className="favorite-ledger-panel__confirm-actions">
      <button type="button" disabled={!canSaveLocally || deepSeekBlocksExecution || loading || (!isMultiSegment && currentSegmentSaved)} onClick={onSaveLocally}>{localSaveLabel}</button>
      <button type="button" disabled={!canSyncToBilibili || deepSeekBlocksExecution || loading} onClick={onConfirmAndSync}>确认并同步到 B 站</button>
      <button type="button" disabled={loading} onClick={onAbandonCurrentWorkspace}>放弃本轮整理</button>
    </div>
  </section>
}

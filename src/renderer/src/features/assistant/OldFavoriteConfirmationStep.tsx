import type { FavoriteLedger } from '@shared/types'
import type { OldFavoriteWorkspaceExecutionFailureCode, OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { useEffect, useState } from 'react'
import { BilimiModal } from '../../components/BilimiModal'
import { OldFavoriteModal } from './OldFavoriteModal'
import { OldFavoriteViewScopeSwitch, OldFavoriteWholeRunOverview, type OldFavoriteViewScope } from './OldFavoriteOverviewControls'

type OldFavoriteConfirmationStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  ledgers?: FavoriteLedger[]
  loading: boolean
  reconciling?: boolean
  preparationStatus?: string | null
  executionError?: string | null
  onSaveLocally: () => void
  onSaveCurrentSegment?: () => void
  onSaveWholeRun?: () => void
  onCancelExecutionIntent?: () => void
  onFinishCurrentSegment?: () => void
  onCloseCurrentWorkspace?: () => void
  onAbandonCurrentWorkspace?: () => void
  onAcknowledgeCompletion?: () => void
  onConfirmAndSync: (includeInbox?: boolean) => void
  onUseOriginalClassifications?: () => void
  onExecuteFrozenPlan: () => void
  onPauseBilibiliSync?: () => Promise<boolean> | void
  onStopSyncAndFinish?: () => Promise<boolean> | void
  onReconcile: () => void
  recommendedCandidateIds?: string[]
  enabledLedgerIds?: ReadonlySet<string>
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

function blockedExecutionIntentMessage(
  code: OldFavoriteWorkspaceExecutionFailureCode | undefined,
  waitingForDeepSeek: boolean
) {
  switch (code) {
    case 'deepseek-unresolved':
      return '自动执行已停止：DeepSeek 整理被取消或仍有失败结果。'
    case 'tag-cutoff-changed':
      return '自动执行已停止：标签结果已有新变化，请重新采用当前标签后再保存或同步。'
    case 'remote-inventory-unavailable':
      return '自动执行已停止：暂时无法读取 B 站收藏夹列表，请保持已登录的 B 站页面打开后重试。'
    case 'saved-binding-absent':
      return '自动执行已停止：已保存的 B 站收藏夹不存在或已被删除，请在收藏夹详情中重新备册后重试。'
    case 'saved-binding-title-mismatch':
      return '自动执行已停止：已保存的 B 站收藏夹名称已变化，请在收藏夹详情中确认后重新备册。'
    case 'binding-requires-rebind':
      return '自动执行已停止：发现同名 B 站收藏夹但尚未建立安全绑定，请在收藏夹详情中选择后重新备册。'
    case 'remote-account-mismatch':
      return '自动执行已停止：当前 B 站登录账号与整理草稿不一致，请切换回原账号后重试。'
    case 'remote-folder-limit':
      return '自动执行已停止：B 站收藏夹数量已达上限，请整理现有收藏夹后重试。'
    case 'remote-shard-capacity':
      return '自动执行已停止：目标收藏夹容量不足，请调整归类后重试。'
    case 'bilibili-sync-prepare-failed':
      return '自动执行已停止：无法生成本轮 B 站同步计划，请检查目标收藏夹后重试。'
    default:
      return waitingForDeepSeek
        ? '自动执行已停止：DeepSeek 整理被取消或仍有失败结果。'
        : '自动执行已停止：无法生成本轮 B 站同步计划，请检查目标收藏夹后重试。'
  }
}

const FAVORITE_LIBRARY_HELP = '收藏库用于保存和管理本地整理结果，可继续查看、调整和重新归类；只有点击“同步到 B 站”后才会上传。'

export function OldFavoriteConfirmationStep({
  snapshot,
  ledgers = [],
  loading,
  reconciling = false,
  preparationStatus,
  executionError,
  onSaveLocally,
  onSaveCurrentSegment = onSaveLocally,
  onSaveWholeRun = onSaveLocally,
  onCancelExecutionIntent = () => undefined,
  onCloseCurrentWorkspace = () => undefined,
  onAbandonCurrentWorkspace = () => undefined,
  onAcknowledgeCompletion = () => undefined,
  onConfirmAndSync,
  onUseOriginalClassifications = () => undefined,
  onExecuteFrozenPlan,
  onPauseBilibiliSync = () => undefined,
  onStopSyncAndFinish = () => undefined,
  onReconcile,
  recommendedCandidateIds,
  enabledLedgerIds,
  viewScope: controlledViewScope,
  onViewScopeChange
}: OldFavoriteConfirmationStepProps) {
  const failureReason = snapshot.executionProgress?.lastFailureReason ?? ''
  const retryAvailableAt = snapshot.executionProgress?.retryAvailableAt
  const [retryClock, setRetryClock] = useState(() => Date.now())
  const [endDialogOpen, setEndDialogOpen] = useState(false)
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
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)
  const [includeInbox, setIncludeInbox] = useState(false)
  const [stopSyncDialogOpen, setStopSyncDialogOpen] = useState(false)
  const [pauseRequested, setPauseRequested] = useState(false)
  const [stopRequested, setStopRequested] = useState(false)
  const viewScope = controlledViewScope ?? localViewScope
  const setViewScope = onViewScopeChange ?? setLocalViewScope
  const { canSaveLocally, canSyncToBilibili, unclassifiedCount } = readinessFor(snapshot)
  const readiness = snapshot.planReadiness
  const userPausedBilibiliSync = snapshot.executionProgress?.syncPaused === true
  const failedDeepSeekCount = snapshot.deepSeekRun?.failedVideoCount ?? 0
  const canceledDeepSeekPendingCount = snapshot.deepSeekRun?.status === 'canceled'
    ? snapshot.deepSeekRun.pendingVideoCount ?? 0
    : 0
  const deepSeekFallbackCount = failedDeepSeekCount + canceledDeepSeekPendingCount
  const deepSeekBlocksExecution = Boolean(snapshot.deepSeekRun && snapshot.deepSeekRun.status !== 'completed')
  const confirmOriginalClassifications = () => {
    const statusLabel = canceledDeepSeekPendingCount ? '未完成' : '失败'
    if (window.confirm(`确认让 ${deepSeekFallbackCount} 条 DeepSeek ${statusLabel}视频沿用整理前的自动分类吗？此选择会写入本轮改动记录。`)) {
      onUseOriginalClassifications()
    }
  }
  const requestPauseBilibiliSync = () => {
    setPauseRequested(true)
    void Promise.resolve(onPauseBilibiliSync()).then((paused) => {
      if (paused === false) setPauseRequested(false)
    }).catch(() => setPauseRequested(false))
  }
  const isMultiSegment = snapshot.hasMultipleSegments
  const currentSegmentSummary = snapshot.currentSegment
    ? snapshot.segments.find((segment) => segment.id === snapshot.currentSegment?.id)
    : undefined
  const currentSegmentSaved = Boolean(currentSegmentSummary && (
    currentSegmentSummary.status === 'frozen' || currentSegmentSummary.readiness === 'saved'
  ))
  const currentSegmentReady = Boolean(currentSegmentSummary && ['ready', 'saved'].includes(currentSegmentSummary.readiness))
  const readySegmentCount = snapshot.segments.filter((segment) => ['ready', 'saved'].includes(segment.readiness)).length
  const allSegmentsReadyForWholeSave = snapshot.segments.length > 0 && snapshot.segments
    .every((segment) => ['ready', 'saved'].includes(segment.readiness))
  const wholeRunTagCutoffAccepted = snapshot.tagEnrichment?.wholeRunTagCutoffAccepted === true
  const tagEnrichmentRunning = snapshot.tagEnrichment?.status === 'running'
  const tagPendingItemCount = (snapshot.tagEnrichment?.pendingItemCount ?? 0) + (snapshot.tagEnrichment?.failedItemCount ?? 0)
  const naturallyCompleteTagRun = snapshot.tagEnrichment?.status === 'complete' && tagPendingItemCount === 0
  const tagResultReadyForExecution = !snapshot.tagEnrichment || (
    !tagEnrichmentRunning && (wholeRunTagCutoffAccepted || naturallyCompleteTagRun)
  )
  const wholeRunReadyForExecution = tagResultReadyForExecution && allSegmentsReadyForWholeSave
  const singleRunReadyForExecution = tagResultReadyForExecution && (!currentSegmentSummary || currentSegmentReady)
  const allSegmentsSaved = snapshot.segments.length > 0 && snapshot.segments.every((segment) => segment.readiness === 'saved')
  const syncExplanation = snapshot.scope?.kind === 'selection'
    ? '本次确认同步会替换所选视频在 bilimi 管理收藏夹中的归属；不会删除或取消用户自己的收藏夹关系；开始后本轮方案锁定。'
    : '确认同步只会追加到 bilimi 收藏夹，不会删除、移动或取消原收藏；开始后本轮方案锁定。'
  const ledgerNames = new Map<string, string>([['inbox', 'bilimi·暂存'], ...ledgers
    .filter((ledger) => enabledLedgerIds?.has(ledger.id) ?? ledger.enabled)
    .map((ledger) => [ledger.id, ledger.displayName] as const)])

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
      {isMultiSegment && viewScope === 'all' ? <OldFavoriteWholeRunOverview snapshot={snapshot} ledgerNames={ledgerNames} showArchiveTargets selectedRecommendationIds={new Set(recommendedCandidateIds ?? snapshot.recommendations.adoptedCandidateIds)} enabledLedgerIds={enabledLedgerIds} /> : null}
      {isMultiSegment && viewScope === 'current' && currentSegmentSummary
        ? <p className="favorite-ledger-panel__current-segment-summary">当前批次：第 {currentSegmentSummary.index + 1}/{snapshot.segments.length} 批 · {currentSegmentSummary.itemCount} 条</p>
        : null}
      <div className="favorite-ledger-panel__old-favorite-progress" role="status">
        <p>正在同步到 B 站，主进程会持续更新执行结果。</p>
        {total > 0 ? <p>已完成 {completed} / {total} 条</p> : null}
        <progress aria-label="正在同步到 B 站" value={completed} max={Math.max(total, 1)} />
      </div>
      <div className="favorite-ledger-panel__confirm-actions">
        <button type="button" disabled={loading || pauseRequested || stopRequested} onClick={requestPauseBilibiliSync}>{pauseRequested ? '正在暂停…' : '暂停同步'}</button>
        <button type="button" disabled={loading || stopRequested} onClick={() => setStopSyncDialogOpen(true)}>{stopRequested ? '正在停止…' : '结束本轮整理'}</button>
      </div>
      {stopSyncDialogOpen ? <OldFavoriteModal
        title="结束本轮整理"
        confirmLabel="确认结束本轮"
        confirmDisabled={stopRequested}
        onCancel={() => setStopSyncDialogOpen(false)}
        onConfirm={() => {
          setStopSyncDialogOpen(false)
          setStopRequested(true)
          void Promise.resolve(onStopSyncAndFinish()).then((stopped) => {
            if (stopped === false) setStopRequested(false)
          }).catch(() => setStopRequested(false))
        }}
      >
        <p>正在发送的操作会完成后再停止。已同步到 B 站的内容会保留；未同步的分类结果已保存在收藏库，之后可在收藏库继续同步。停止后本轮整理草稿将关闭，不能再返回修改。</p>
      </OldFavoriteModal> : null}
    </section>
  }

  if (snapshot.status === 'frozen') {
    const completed = snapshot.executionProgress?.completedOperationCount ?? 0
    const total = snapshot.executionProgress?.totalOperationCount ?? 0
    if (userPausedBilibiliSync) {
      return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
        <h4>确认执行</h4>
        <div className="favorite-ledger-panel__old-favorite-progress" role="status">
          <p>B 站同步已暂停。</p>
          {total > 0 ? <p>已完成 {completed} / {total} 条；继续时只处理剩余项目。</p> : null}
          {total > 0 ? <progress aria-label="同步到 B 站进度" value={completed} max={Math.max(total, 1)} /> : null}
        </div>
        <div className="favorite-ledger-panel__confirm-actions">
          <button type="button" disabled={loading} onClick={onExecuteFrozenPlan}>继续同步</button>
          <button type="button" disabled={loading} onClick={() => setStopSyncDialogOpen(true)}>结束本轮整理</button>
        </div>
        {stopSyncDialogOpen ? <OldFavoriteModal
          title="结束本轮整理"
          confirmLabel="确认结束本轮"
          onCancel={() => setStopSyncDialogOpen(false)}
          onConfirm={() => {
            setStopSyncDialogOpen(false)
            onAbandonCurrentWorkspace()
          }}
        >
          <p>同步已暂停，未同步的分类结果已保存在收藏库；确认结束会放弃剩余 B 站同步并关闭本轮草稿，已同步到 B 站的内容会保留。</p>
        </OldFavoriteModal> : null}
      </section>
    }
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
          ? blockedExecutionIntentMessage(waiting.failureCode, waiting.waitingForDeepSeek)
          : waiting.status === 'running'
            ? '全部条件已满足，正在执行本轮保存计划。'
          : waiting.waitingSegmentCount
            ? `等待 ${waiting.waitingSegmentCount} 个批次完成预处理。`
            : '全部批次已完成预处理，正在等待后续任务。'}</p>
        {waiting.waitingForDeepSeek ? <p>DeepSeek 全轮整理完成后会自动继续。</p> : null}
        <p>{waiting.mode === 'local' ? '完成后会保存本轮到收藏库。' : '完成后会保存暂存内容并开始同步到 B 站。'}</p>
      </div>
      {waiting.status === 'blocked' && waiting.failureCode === 'deepseek-unresolved' && deepSeekFallbackCount > 0
        ? <button type="button" disabled={loading} onClick={confirmOriginalClassifications}>沿用 {deepSeekFallbackCount} 条视频的原自动分类</button>
        : null}
      {waiting.status !== 'running'
        ? <button type="button" disabled={loading} onClick={onCancelExecutionIntent}>取消等待执行</button>
        : null}
    </section>
  }

  const readinessText = readiness && isMultiSegment && viewScope === 'all'
    ? `整体准备度：${readiness.classifiedAidCount} / ${readiness.selectedAidCount} 条已分类`
    : null
  const currentSegmentUnmatchedCount = currentSegmentSummary
    ? snapshot.overview?.archiveTargets.find((target) => target.ledgerId === 'inbox')?.segmentCounts
      .find((segment) => segment.segmentId === currentSegmentSummary.id)?.count ?? 0
    : unclassifiedCount
  const wholeRunUnmatchedCount = isMultiSegment ? snapshot.overview?.unmatchedItemCount ?? 0 : unclassifiedCount
  const unmatchedCount = isMultiSegment && viewScope === 'current' ? currentSegmentUnmatchedCount : wholeRunUnmatchedCount
  const pendingBackupTargets = (snapshot.overview?.archiveTargets ?? [])
    .map((target) => {
      const ledger = ledgers.find((candidate) => candidate.id === target.ledgerId)
      const count = isMultiSegment && viewScope === 'current' && currentSegmentSummary
        ? target.segmentCounts.find((segment) => segment.segmentId === currentSegmentSummary.id)?.count ?? 0
        : target.itemCount
      const explicitlyUnbound = ledger?.bindingState === 'unbound' || ledger?.bindingState === 'unbacked'
      const alreadyBacked = Boolean(ledger && !explicitlyUnbound && (ledger.bindingState === 'bound' || ledger.bilibiliFolderId))
      return { ledger, count, alreadyBacked }
    })
    .filter(({ ledger, count, alreadyBacked }) => Boolean(ledger) && ledger?.id !== 'inbox' && count > 0 && !alreadyBacked)
    .map(({ ledger, count }) => ({ name: ledger!.displayName, count }))
  const totalVideosToOrganize = readiness?.selectedAidCount ?? 0
  const unmatchedMessage = unmatchedCount
    ? `${isMultiSegment && viewScope === 'current' ? '本批' : '本轮'}未匹配到合适分类 ${unmatchedCount} 条，将保存到 bilimi·暂存；同步时默认不上传 B 站。`
    : !canSaveLocally
      ? '正在等待主进程确认本轮分类准备度。'
      : null
  const executionBlockedMessage = tagEnrichmentRunning
    ? '标签补取仍在运行，等待本次读取安全收束。'
    : snapshot.tagEnrichment && !tagResultReadyForExecution
      ? `标签结果仍有 ${tagPendingItemCount} 条待补取或读取失败，完成补取或选择当前结果后才能保存或同步。`
      : snapshot.deepSeekRun?.status === 'running' || snapshot.deepSeekRun?.status === 'waiting'
        ? 'DeepSeek 整理仍在运行，完成或取消并收束后才能保存或同步。'
        : null

  return <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
    <div className="favorite-ledger-panel__step-title-row">
      <h4>确认执行</h4>
      {isMultiSegment ? <OldFavoriteViewScopeSwitch label="确认执行视图" value={viewScope} onChange={setViewScope} /> : null}
    </div>
    {isMultiSegment && viewScope === 'current' && currentSegmentSummary
      ? <p className="favorite-ledger-panel__current-segment-summary">当前批次：第 {currentSegmentSummary.index + 1}/{snapshot.segments.length} 批 · {currentSegmentSummary.itemCount} 条</p>
      : null}
    <p>{isMultiSegment && viewScope === 'current'
      ? '确认当前批次的分类结果并保存到收藏库。'
      : '确认本轮分类结果，并选择保存到收藏库、同步到 B 站或结束本轮整理。'}</p>
    <p className="favorite-ledger-panel__action-explanation">{syncExplanation}</p>
    {readinessText ? <p>{readinessText}</p> : null}
    {preparationStatus ? <p role="status">{preparationStatus}</p> : null}
    {unmatchedMessage ? <p className="favorite-ledger-panel__confirm-warning favorite-ledger-panel__confirm-info" role="alert">{unmatchedMessage}</p> : null}
    {executionBlockedMessage ? <p className="favorite-ledger-panel__confirm-warning favorite-ledger-panel__confirm-info" role="alert">{executionBlockedMessage}</p> : null}
    {executionError ? <p className="favorite-ledger-panel__confirm-warning" role="alert">{executionError}</p> : null}
    {deepSeekFallbackCount ? <div className="favorite-ledger-panel__confirm-warning" role="alert">
      <p>{canceledDeepSeekPendingCount
        ? `${deepSeekFallbackCount} 条视频的 DeepSeek 整理未完成，重试或明确沿用原自动分类后才能保存或同步。`
        : `${deepSeekFallbackCount} 条视频的 DeepSeek 整理失败，重试或明确沿用原自动分类后才能保存或同步。`}</p>
      <button type="button" disabled={loading} onClick={confirmOriginalClassifications}>沿用 {deepSeekFallbackCount} 条视频的原自动分类</button>
    </div> : null}
    <div className="favorite-ledger-panel__confirm-action-groups">
      {isMultiSegment && viewScope === 'current' ? <section className="favorite-ledger-panel__confirm-action-group" role="group" aria-label="本批操作">
        <strong>本批操作</strong>
        <div className="favorite-ledger-panel__confirm-actions">
          <button type="button" title={FAVORITE_LIBRARY_HELP} disabled={!canSaveLocally || !currentSegmentReady || deepSeekBlocksExecution || loading} onClick={onSaveCurrentSegment}>{currentSegmentSaved ? '重新保存本批到收藏库' : '保存本批到收藏库'}</button>
          <button type="button" disabled={loading} onClick={() => setEndDialogOpen(true)}>暂不同步，结束本轮整理</button>
        </div>
      </section> : null}
      {(!isMultiSegment || viewScope === 'all') ? <section className="favorite-ledger-panel__confirm-action-group" role="group" aria-label="本轮操作">
        <strong>本轮操作</strong>
        <div className="favorite-ledger-panel__confirm-actions">
          {isMultiSegment ? <button type="button" title={FAVORITE_LIBRARY_HELP} disabled={!canSaveLocally || readySegmentCount === 0 || !wholeRunReadyForExecution || deepSeekBlocksExecution || loading} onClick={onSaveWholeRun}>{allSegmentsSaved ? '重新保存本轮到收藏库' : '保存本轮到收藏库'}</button> : <button type="button" title={FAVORITE_LIBRARY_HELP} disabled={!canSaveLocally || !singleRunReadyForExecution || deepSeekBlocksExecution || loading} onClick={onSaveLocally}>{currentSegmentSaved ? '重新保存本轮到收藏库' : '保存本轮到收藏库'}</button>}
          <button type="button" disabled={!canSyncToBilibili || (isMultiSegment ? !wholeRunReadyForExecution : !singleRunReadyForExecution) || deepSeekBlocksExecution || loading} onClick={() => {
            if (unmatchedCount > 0) setSyncDialogOpen(true)
            else onConfirmAndSync(false)
          }}>确认并同步到 B 站</button>
          <button type="button" disabled={loading} onClick={() => setEndDialogOpen(true)}>暂不同步，结束本轮整理</button>
        </div>
      </section> : null}
    </div>
    {isMultiSegment && viewScope === 'all' ? <OldFavoriteWholeRunOverview snapshot={snapshot} ledgerNames={ledgerNames} showArchiveTargets selectedRecommendationIds={new Set(recommendedCandidateIds ?? snapshot.recommendations.adoptedCandidateIds)} enabledLedgerIds={enabledLedgerIds} /> : null}
    {syncDialogOpen ? <BilimiModal title="同步选项" className="favorite-ledger-panel__sync-dialog" onClose={() => setSyncDialogOpen(false)} actions={<>
      <button type="button" onClick={() => { setSyncDialogOpen(false); onConfirmAndSync(includeInbox) }}>确认同步</button>
    </>}>
      <div className="favorite-ledger-panel__sync-summary">
        <p>本次将整理 {totalVideosToOrganize} 条视频。</p>
        {pendingBackupTargets.length > 0
          ? <p>同步前将备册：{pendingBackupTargets.map(({ name, count }) => `${name}（${count} 条）`).join('、')}</p>
          : null}
        <p>其中 {unmatchedCount} 条未匹配到合适分类，会先保存到收藏库的 bilimi·暂存；如需一并同步到 B 站，请勾选下方选项。</p>
      </div>
      <label>
        <input type="checkbox" checked={includeInbox} onChange={(event) => setIncludeInbox(event.currentTarget.checked)} />
        同步 bilimi·暂存（{unmatchedCount} 条）
      </label>
    </BilimiModal> : null}
    {endDialogOpen ? <OldFavoriteModal title="结束本轮整理?" onCancel={() => setEndDialogOpen(false)} extraActions={<>
      <button type="button" onClick={() => { setEndDialogOpen(false); onCloseCurrentWorkspace() }}>关闭整理</button>
      <button type="button" onClick={() => { setEndDialogOpen(false); onAbandonCurrentWorkspace() }}>确认结束</button>
    </>}>
      <p>关闭整理只会隐藏当前整理界面，当前草稿、扫描和标签补取进度都会保留。下次点击“整理收藏”可继续本轮草稿；继续草稿不会自动加入新增收藏，如需处理新增收藏请重新扫描。</p>
      <p>确认结束会清空本轮草稿和进度，不影响已保存到收藏库的内容或 B 站收藏。下次点击“整理收藏”可重新扫描，并处理新增收藏。</p>
    </OldFavoriteModal> : null}
  </section>
}

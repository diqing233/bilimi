import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  OldFavoriteWorkspaceDeepSeekFailure,
  OldFavoriteWorkspaceDeepSeekResult,
  OldFavoriteWorkspaceRecoveryDecisionResult,
  OldFavoriteWorkspaceRecoverySummary,
  OldFavoriteWorkspaceView
} from '../../../../shared/oldFavoriteWorkspace'
import type { DeepSeekArchiveMode } from '@shared/types'

type WorkspaceView = OldFavoriteWorkspaceView

function normalizeCandidateIds(candidateIds: string[]) {
  return [...new Set(candidateIds.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))].sort()
}

function snapshotCandidateIds(snapshot: WorkspaceView | null, accountMid?: string) {
  return snapshot && !('recovery' in snapshot) && (!accountMid || normalizeAccountMid(snapshot.accountMid) === normalizeAccountMid(accountMid))
    ? normalizeCandidateIds(snapshot.recommendations?.adoptedCandidateIds ?? [])
    : []
}

export type DeepSeekWorkspaceFeedback = {
  status: 'running' | 'completed' | 'failed' | 'canceled'
  message: string
  progress?: OldFavoriteWorkspaceDeepSeekResult['progress']
  failures?: OldFavoriteWorkspaceDeepSeekFailure[]
}

function deepSeekFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  if (/DeepSeekServiceError|DeepSeek returned invalid JSON|Error invoking remote method/i.test(detail)) {
    return 'DeepSeek 整理失败，请检查服务设置后重试。'
  }
  return detail || 'DeepSeek 整理失败，请稍后重试。'
}

function executionFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  if (/remote-timeout|page-execution-timeout/i.test(detail)) {
    return 'B 站结果暂时无法确认，请检查已登录页面和网络后重试；系统不会重复提交未确认的操作。'
  }
  if (/remote folder inventory is unavailable|page bridge is unavailable/i.test(detail)) {
    return '无法读取 B 站收藏夹列表，请保持已登录的 B 站页面打开后重试。'
  }
  if (/remote shard title is ambiguous/i.test(detail)) {
    return 'B 站中存在多个同名目标收藏夹，请整理重名收藏夹后重试。'
  }
  if (/remote-target-unbound/i.test(detail)) {
    return '本轮目标收藏夹尚未同步到 B 站，请确认同步后重试。'
  }
  if (/remote-ambiguous|account-mismatch|remote account mismatch/i.test(detail)) {
    return '无法确认当前 B 站页面，请保持已登录的 B 站页面打开后重试。'
  }
  if (/physical-shard-capacity-exceeded|shard capacity is exceeded/i.test(detail)) {
    return '目标收藏夹容量不足，请调整归类后重新确认。'
  }
  if (/folder limit/i.test(detail)) {
    return 'B 站收藏夹数量已达上限，请整理现有收藏夹后重试。'
  }
  return '无法生成本轮 B 站同步计划，请检查目标收藏夹后重试。'
}

function normalizeAccountMid(value: string) {
  if (!/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) return null
  return BigInt(value.trim()).toString()
}

export function useOldFavoriteWorkspace(accountMid?: string) {
  const [snapshot, setSnapshot] = useState<WorkspaceView | null>(null)
  const [loading, setLoading] = useState(false)
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [recommendedCandidateIds, setRecommendedCandidateIds] = useState<string[]>([])
  const [recommendationSaving, setRecommendationSaving] = useState(false)
  const [recommendationError, setRecommendationError] = useState<string | null>(null)
  const [previewPreparationRunning, setPreviewPreparationRunning] = useState(false)
  const [previewPreparationProgress, setPreviewPreparationProgress] = useState<{ completedItemCount: number; totalItemCount: number } | null>(null)
  const [previewPreparationError, setPreviewPreparationError] = useState<string | null>(null)
  const [deepSeekFeedback, setDeepSeekFeedback] = useState<DeepSeekWorkspaceFeedback | null>(null)
  const [deepSeekCancelRequested, setDeepSeekCancelRequested] = useState(false)
  const activeDeepSeekWorkspaceId = useRef<string | null>(null)
  const requestVersion = useRef(0)
  const backgroundRequestVersion = useRef(0)
  const foregroundRequestCount = useRef(0)
  const accountGeneration = useRef(0)
  const recommendationCommittedRef = useRef<string[]>([])
  const recommendedCandidateIdsRef = useRef<string[]>([])
  const recommendationDesiredRef = useRef<string[] | null>(null)
  const recommendationQueueRunningRef = useRef(false)
  const previewPreparationGenerationRef = useRef(0)
  const activePreviewPreparationWorkspaceIdRef = useRef<string | null>(null)
  const recommendationQueueIdleResolversRef = useRef<Array<() => void>>([])
  const activeAccountMidRef = useRef(accountMid)

  useEffect(() => {
    const previousAccountMid = activeAccountMidRef.current
    if (previousAccountMid && previousAccountMid !== accountMid && activePreviewPreparationWorkspaceIdRef.current) {
      void window.bilimiDesktop?.commandOldFavoriteWorkspaceV1?.(previousAccountMid, {
        type: 'cancel-recommendation-preview-preparation'
      })
    }
    activeAccountMidRef.current = accountMid
    accountGeneration.current += 1
    foregroundRequestCount.current = 0
    setLoading(false)
    setBackgroundRefreshing(false)
    setDeepSeekFeedback(null)
    setDeepSeekCancelRequested(false)
    setReconciling(false)
    recommendationCommittedRef.current = []
    recommendedCandidateIdsRef.current = []
    recommendationDesiredRef.current = null
    recommendationQueueRunningRef.current = false
    setRecommendedCandidateIds([])
    setRecommendationSaving(false)
    setRecommendationError(null)
    setPreviewPreparationRunning(false)
    setPreviewPreparationProgress(null)
    setPreviewPreparationError(null)
    previewPreparationGenerationRef.current += 1
    activePreviewPreparationWorkspaceIdRef.current = null
    recommendationQueueIdleResolversRef.current.splice(0).forEach((resolve) => resolve())
    activeDeepSeekWorkspaceId.current = null
  }, [accountMid])

  useEffect(() => {
    if (recommendationQueueRunningRef.current || recommendationDesiredRef.current) return
    const authoritativeIds = snapshotCandidateIds(snapshot, accountMid)
    recommendationCommittedRef.current = authoritativeIds
    recommendedCandidateIdsRef.current = authoritativeIds
    setRecommendedCandidateIds(authoritativeIds)
  }, [accountMid, snapshot])

  useEffect(() => {
    const subscribe = window.bilimiDesktop?.onOldFavoriteWorkspaceDeepSeekProgress
    if (!accountMid || !subscribe) return
    return subscribe((progress) => {
      if (normalizeAccountMid(progress.accountMid) !== normalizeAccountMid(accountMid) ||
        progress.workspaceId !== activeDeepSeekWorkspaceId.current) return
      setDeepSeekFeedback({
        status: 'running',
        message: 'DeepSeek 正在整理当前分段…',
        progress: {
          totalChunks: progress.totalChunks,
          completedChunks: progress.completedChunks,
          totalVideoCount: progress.totalVideoCount,
          successfulVideoCount: progress.successfulVideoCount,
          failedVideoCount: progress.failedVideoCount
        }
      })
    })
  }, [accountMid])

  const refresh = useCallback(async (preserveSnapshot = false) => {
    if (preserveSnapshot && foregroundRequestCount.current > 0) return null
    const version = preserveSnapshot ? ++backgroundRequestVersion.current : ++requestVersion.current
    const foregroundVersion = requestVersion.current
    const generation = accountGeneration.current
    const open = window.bilimiDesktop?.openOldFavoriteWorkspaceV1
    if (!accountMid || !open) {
      setSnapshot(null)
      setLoading(false)
      setBackgroundRefreshing(false)
      setLastError(null)
      return null
    }

    if (!preserveSnapshot) {
      setSnapshot(null)
      setLoading(true)
      foregroundRequestCount.current += 1
    } else {
      setBackgroundRefreshing(true)
    }
    setLastError(null)
    try {
      const next = await open(accountMid)
      if (!next) {
        const isCurrent = preserveSnapshot
          ? backgroundRequestVersion.current === version && requestVersion.current === foregroundVersion && foregroundRequestCount.current === 0 && accountGeneration.current === generation
          : requestVersion.current === version && accountGeneration.current === generation
        if (isCurrent) setSnapshot(null)
        return null
      }
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      const isCurrent = preserveSnapshot
        ? backgroundRequestVersion.current === version && requestVersion.current === foregroundVersion && foregroundRequestCount.current === 0 && accountGeneration.current === generation
        : requestVersion.current === version && accountGeneration.current === generation
      if (isCurrent) setSnapshot(next)
      return next
    } catch (error) {
      const isCurrent = preserveSnapshot
        ? backgroundRequestVersion.current === version && requestVersion.current === foregroundVersion && foregroundRequestCount.current === 0 && accountGeneration.current === generation
        : requestVersion.current === version && accountGeneration.current === generation
      if (isCurrent) setSnapshot(null)
      if (isCurrent) setLastError(error instanceof Error ? error.message : '读取收藏整理工作区失败。')
      return null
    } finally {
      if (preserveSnapshot) {
        if (backgroundRequestVersion.current === version && accountGeneration.current === generation) setBackgroundRefreshing(false)
      } else if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid])

  const startScan = useCallback(async (mode: 'incremental' | 'full' = 'incremental', options?: { clearBilibiliMirror?: boolean }) => {
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null

    if (mode === 'full') {
      activeDeepSeekWorkspaceId.current = null
      setDeepSeekFeedback(null)
      setDeepSeekCancelRequested(false)
    }
    setLoading(true)
    foregroundRequestCount.current += 1
    setLastError(null)
    try {
      const next = await command(accountMid, options?.clearBilibiliMirror && mode === 'full'
        ? { type: 'start-scan', mode, clearBilibiliMirror: true }
        : { type: 'start-scan', mode })
      if (!next) return null
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      if (requestVersion.current === version && accountGeneration.current === generation) setSnapshot(next)
      return next
    } catch (error) {
      if (requestVersion.current === version && accountGeneration.current === generation) setLastError(error instanceof Error ? error.message : '启动收藏整理扫描失败。')
      throw error
    } finally {
      if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid])

  useEffect(() => {
    const subscribe = window.bilimiDesktop?.onOldFavoriteWorkspacePreviewPreparationProgress
    if (!accountMid || !subscribe) return
    return subscribe((progress) => {
      if (normalizeAccountMid(progress.accountMid) !== normalizeAccountMid(accountMid) ||
        progress.workspaceId !== activePreviewPreparationWorkspaceIdRef.current) return
      setPreviewPreparationProgress({
        completedItemCount: progress.completedItemCount,
        totalItemCount: progress.totalItemCount
      })
    })
  }, [accountMid])

  const selectSourceFolders = useCallback(async (folderIds: string[]) => {
    const version = ++requestVersion.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null
    const normalizedFolderIds = [...new Set(folderIds.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))].sort()
    try {
      const next = await command(accountMid, { type: 'select-source-folders', folderIds: normalizedFolderIds })
      if (!next) return null
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      if (requestVersion.current === version) setSnapshot(next)
      return next
    } catch {
      return null
    }
  }, [accountMid])

  const sendCommand = useCallback(async (commandValue: unknown, reportExecutionFailure = false) => {
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null
    setLoading(true)
    foregroundRequestCount.current += 1
    if (reportExecutionFailure) setExecutionError(null)
    try {
      const next = await command(accountMid, commandValue)
      if (!next) return null
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      if (requestVersion.current === version && accountGeneration.current === generation) setSnapshot(next)
      return next
    } catch (error) {
      if (reportExecutionFailure && requestVersion.current === version && accountGeneration.current === generation) {
        setExecutionError(executionFailureMessage(error))
      }
      return null
    } finally {
      if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid])

  const resumeScan = useCallback(() => sendCommand({ type: 'resume-scan' }), [sendCommand])
  const getRecoverySummary = useCallback(async (): Promise<OldFavoriteWorkspaceRecoverySummary | null> => {
    if (!accountMid) return null
    return window.bilimiDesktop?.getOldFavoriteWorkspaceRecoverySummaryV1?.(accountMid) ?? null
  }, [accountMid])
  const sendRecoveryDecision = useCallback(async (
    summary: OldFavoriteWorkspaceRecoverySummary,
    choice: 'continue-original' | 'merge-latest' | 'rescan'
  ): Promise<OldFavoriteWorkspaceRecoveryDecisionResult | null> => {
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null
    // This command acknowledges a recovery choice; it is not a workspace snapshot.
    return command(accountMid, {
      type: 'select-recovery-decision', workspaceId: summary.workspaceId, choice,
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    }) as Promise<OldFavoriteWorkspaceRecoveryDecisionResult>
  }, [accountMid])

  useEffect(() => {
    // Current preload builds expose the manifest-only recovery endpoint, so
    // mounting a library panel need not deserialize a workspace segment.
    if (window.bilimiDesktop?.getOldFavoriteWorkspaceRecoverySummaryV1) return
    void refresh()
  }, [refresh])

  const selectSegment = useCallback((segmentId: string) => {
    const normalized = segmentId.trim()
    if (!normalized) return Promise.resolve(null)
    return sendCommand({ type: 'select-segment', segmentId: normalized })
  }, [sendCommand])

  const applyManualClassifications = useCallback((assignments: Array<{ aid: number; targetLedgerIds: string[] }>) => {
    const normalized = assignments
      .filter((assignment) => Number.isSafeInteger(assignment.aid) && assignment.aid > 0 && Array.isArray(assignment.targetLedgerIds))
      .map((assignment) => ({
        aid: assignment.aid,
        targetLedgerIds: [...new Set(assignment.targetLedgerIds.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))].sort()
      }))
    return sendCommand({ type: 'apply-classifications', source: 'manual', assignments: normalized })
  }, [sendCommand])

  const organizeCurrentSegmentWithDeepSeek = useCallback(async (mode: DeepSeekArchiveMode) => {
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const organize = window.bilimiDesktop?.organizeOldFavoriteWorkspaceDeepSeekV1
    if (!accountMid || !organize) {
      setDeepSeekFeedback({ status: 'failed', message: 'DeepSeek 整理暂不可用，请稍后重试。' })
      return null
    }
    setLoading(true)
    foregroundRequestCount.current += 1
    setDeepSeekCancelRequested(false)
    activeDeepSeekWorkspaceId.current = snapshot?.workspaceId ?? null
    setDeepSeekFeedback({ status: 'running', message: 'DeepSeek 正在整理当前分段…' })
    try {
      const result = await organize(accountMid, mode)
      const next = result.snapshot
      if (normalizeAccountMid(next.accountMid) !== normalizeAccountMid(accountMid)) return null
      if (requestVersion.current === version && accountGeneration.current === generation) setSnapshot(next)
      if (requestVersion.current === version && accountGeneration.current === generation) {
        const referencedConstraintLedgerNames = result.referencedConstraintLedgerNames ?? []
        const referencedConstraints = referencedConstraintLedgerNames.length
          ? `本次整理参考了 DeepSeek 约束收藏夹：${referencedConstraintLedgerNames.join('、')}。`
          : '本次整理未带入 DeepSeek 约束收藏夹。'
        setDeepSeekFeedback(result.canceled
          ? { status: 'canceled', message: `DeepSeek 已在完成当前批次后停止；已更新 ${result.progress.successfulVideoCount} 条。${referencedConstraints}`, progress: result.progress, failures: result.failures }
          : result.failures.length
            ? { status: 'failed', message: `DeepSeek 已处理 ${result.progress.successfulVideoCount} 条；${result.progress.failedVideoCount} 条未应用。${referencedConstraints}`, progress: result.progress, failures: result.failures }
            : { status: 'completed', message: `DeepSeek 整理完成，已更新当前分段。${referencedConstraints}`, progress: result.progress, failures: [] })
      }
      return next
    } catch (error) {
      if (requestVersion.current === version && accountGeneration.current === generation) {
        setDeepSeekFeedback({
          status: 'failed',
          message: deepSeekFailureMessage(error)
        })
      }
      return null
    } finally {
      if (accountGeneration.current === generation) setDeepSeekCancelRequested(false)
      if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid, snapshot?.workspaceId])

  const cancelCurrentSegmentDeepSeek = useCallback(async () => {
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return false
    try {
      await command(accountMid, { type: 'cancel-deepseek-current-segment' })
      setDeepSeekCancelRequested(true)
      setDeepSeekFeedback((current) => current?.status === 'running'
        ? { ...current, message: '正在结束当前批次，后续批次不会再开始。' }
        : current)
      return true
    } catch {
      return false
    }
  }, [accountMid])

  const retryFailedDeepSeekChunks = useCallback(async () => {
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const retry = window.bilimiDesktop?.retryOldFavoriteWorkspaceDeepSeekV1
    if (!accountMid || !retry) return null
    const retryFailures = deepSeekFeedback?.failures ?? []
    setLoading(true)
    foregroundRequestCount.current += 1
    activeDeepSeekWorkspaceId.current = snapshot?.workspaceId ?? null
    setDeepSeekFeedback({ status: 'running', message: 'DeepSeek 正在重试失败批次…' })
    try {
      const result = await retry(accountMid)
      if (normalizeAccountMid(result.snapshot.accountMid) !== normalizeAccountMid(accountMid)) return null
      if (requestVersion.current === version && accountGeneration.current === generation) {
        setSnapshot(result.snapshot)
        setDeepSeekFeedback(result.failures.length
          ? { status: 'failed', message: `DeepSeek 已处理 ${result.progress.successfulVideoCount} 条；${result.progress.failedVideoCount} 条未应用。`, progress: result.progress, failures: result.failures }
          : { status: 'completed', message: 'DeepSeek 失败批次已重试完成。', progress: result.progress, failures: [] })
      }
      return result.snapshot
    } catch (error) {
      if (requestVersion.current === version && accountGeneration.current === generation) {
        setDeepSeekFeedback({ status: 'failed', message: deepSeekFailureMessage(error), failures: retryFailures })
      }
      return null
    } finally {
      if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid, deepSeekFeedback?.failures, snapshot?.workspaceId])

  const undoClassification = useCallback(() => sendCommand({ type: 'undo-classification' }), [sendCommand])
  const redoClassification = useCallback(() => sendCommand({ type: 'redo-classification' }), [sendCommand])
  const moveHistoryCursor = useCallback((cursor: number) => sendCommand({ type: 'move-history-cursor', cursor }), [sendCommand])
  const autoClassifyCurrentSegment = useCallback(() => sendCommand({ type: 'auto-classify-current-segment' }), [sendCommand])
  const pauseTagEnrichment = useCallback(() => sendCommand({ type: 'pause-tag-enrichment' }), [sendCommand])
  const resumeTagEnrichment = useCallback(() => sendCommand({ type: 'resume-tag-enrichment' }), [sendCommand])
  const retryFailedTagEnrichment = useCallback(() => sendCommand({ type: 'retry-failed-tag-enrichment' }), [sendCommand])
  const acceptCurrentTags = useCallback(() => sendCommand({ type: 'accept-current-tags' }), [sendCommand])
  const runRecommendationQueue = useCallback(async () => {
    if (recommendationQueueRunningRef.current) return
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return
    const generation = accountGeneration.current
    recommendationQueueRunningRef.current = true
    setRecommendationSaving(true)
    try {
      while (recommendationDesiredRef.current && accountGeneration.current === generation) {
        const requestedIds = recommendationDesiredRef.current
        recommendationDesiredRef.current = null
        try {
          const next = await command(accountMid, { type: 'set-recommended-candidates', candidateIds: requestedIds })
          if (!next || accountGeneration.current !== generation || normalizeAccountMid(next.accountMid) !== normalizeAccountMid(accountMid)) continue
          const authoritativeIds = snapshotCandidateIds(next, accountMid)
          recommendationCommittedRef.current = authoritativeIds
          setRecommendationError(null)
          if (!recommendationDesiredRef.current) {
            recommendedCandidateIdsRef.current = authoritativeIds
            setRecommendedCandidateIds(authoritativeIds)
          }
        } catch {
          if (accountGeneration.current !== generation) return
          setRecommendationError('推荐收藏夹未能保存，请重试。')
          if (!recommendationDesiredRef.current) {
            recommendedCandidateIdsRef.current = recommendationCommittedRef.current
            setRecommendedCandidateIds(recommendationCommittedRef.current)
          }
        }
      }
    } finally {
      if (accountGeneration.current === generation) {
        setRecommendationSaving(false)
        recommendationQueueRunningRef.current = false
        recommendationQueueIdleResolversRef.current.splice(0).forEach((resolve) => resolve())
      }
    }
  }, [accountMid])
  const waitForRecommendationQueue = useCallback(() => {
    if (!recommendationQueueRunningRef.current && !recommendationDesiredRef.current) return Promise.resolve()
    return new Promise<void>((resolve) => recommendationQueueIdleResolversRef.current.push(resolve))
  }, [])
  const cancelRecommendationPreviewPreparation = useCallback(async () => {
    previewPreparationGenerationRef.current += 1
    activePreviewPreparationWorkspaceIdRef.current = null
    setPreviewPreparationRunning(false)
    setPreviewPreparationProgress(null)
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return false
    try {
      await command(accountMid, { type: 'cancel-recommendation-preview-preparation' })
      return true
    } catch {
      return false
    }
  }, [accountMid])
  const setRecommendedCandidates = useCallback((candidateIds: string[]) => {
    if (activePreviewPreparationWorkspaceIdRef.current) void cancelRecommendationPreviewPreparation()
    const normalized = normalizeCandidateIds(candidateIds)
    recommendedCandidateIdsRef.current = normalized
    setRecommendedCandidateIds(normalized)
    setRecommendationError(null)
    recommendationDesiredRef.current = normalized
    void runRecommendationQueue()
  }, [cancelRecommendationPreviewPreparation, runRecommendationQueue])
  const updateRecommendedCandidates = useCallback((update: (current: string[]) => string[]) => {
    setRecommendedCandidates(update(recommendedCandidateIdsRef.current))
  }, [setRecommendedCandidates])
  const prepareRecommendationPreview = useCallback(async () => {
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    const workspaceId = snapshot && !('recovery' in snapshot) ? snapshot.workspaceId : null
    if (!accountMid || !command || !workspaceId) return null
    const accountVersion = accountGeneration.current
    await waitForRecommendationQueue()
    if (accountGeneration.current !== accountVersion) return null
    const generation = ++previewPreparationGenerationRef.current
    const candidateIds = [...recommendedCandidateIdsRef.current]
    const fingerprint = JSON.stringify(candidateIds)
    activePreviewPreparationWorkspaceIdRef.current = workspaceId
    setPreviewPreparationRunning(true)
    setPreviewPreparationProgress({ completedItemCount: 0, totalItemCount: 0 })
    setPreviewPreparationError(null)
    try {
      const next = await command(accountMid, { type: 'prepare-recommendation-preview', candidateIds })
      const current = previewPreparationGenerationRef.current === generation &&
        activePreviewPreparationWorkspaceIdRef.current === workspaceId &&
        JSON.stringify(recommendedCandidateIdsRef.current) === fingerprint &&
        next && !('recovery' in next) && next.workspaceId === workspaceId &&
        normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!current) return null
      setSnapshot(next)
      return next
    } catch (error) {
      if (previewPreparationGenerationRef.current === generation && !/preparation canceled/i.test(error instanceof Error ? error.message : '')) {
        setPreviewPreparationError(error instanceof Error ? error.message : '归档预览准备失败，请重试。')
      }
      return null
    } finally {
      if (previewPreparationGenerationRef.current === generation) {
        activePreviewPreparationWorkspaceIdRef.current = null
        setPreviewPreparationRunning(false)
      }
    }
  }, [accountMid, snapshot, waitForRecommendationQueue])
  const createLocalLedgerAndReclassify = useCallback((title: string) => {
    const normalized = title.trim()
    return normalized ? sendCommand({ type: 'create-local-ledger-and-reclassify', title: normalized }) : Promise.resolve(null)
  }, [sendCommand])
  const freezeBilibiliExecution = useCallback(() => sendCommand({ type: 'freeze-bilibili-execution' }), [sendCommand])
  const confirmAndExecuteBilibiliPlan = useCallback(() => sendCommand({ type: 'confirm-and-execute-bilibili-plan' }, true), [sendCommand])
  const saveCurrentSegmentLocally = useCallback(() => sendCommand({ type: 'save-current-segment-locally' }), [sendCommand])
  const abandonCurrentWorkspace = useCallback(async () => {
    const result = await sendCommand({ type: 'abandon-current-workspace' })
    if (!result) setSnapshot(null)
    return result
  }, [sendCommand])
  const executeFrozenBilibiliPlan = useCallback(() => sendCommand({ type: 'execute-frozen-bilibili-plan' }, true), [sendCommand])
  const reconcileFrozenBilibiliPlan = useCallback(async () => {
    setReconciling(true)
    try {
      return await sendCommand({ type: 'reconcile-frozen-bilibili-plan' }, true)
    } finally {
      setReconciling(false)
    }
  }, [sendCommand])
  const resumeReconciledBilibiliPlan = useCallback(() => sendCommand({ type: 'resume-reconciled-bilibili-plan' }), [sendCommand])
  const rebuildCorruptWorkspace = useCallback(() => sendCommand({ type: 'rebuild-corrupt-workspace' }), [sendCommand])

  useEffect(() => {
    if (!snapshot || 'recovery' in snapshot) return
    const hasActiveWork = snapshot && (
      ['scanning', 'executing', 'reconciling'].includes(snapshot.status) ||
      snapshot.tagEnrichment?.status === 'running'
    )
    if (!hasActiveWork) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true)
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [refresh, snapshot && !('recovery' in snapshot) ? snapshot.status : undefined, snapshot && !('recovery' in snapshot) ? snapshot.tagEnrichment?.status : undefined])

  return {
    snapshot, loading, backgroundRefreshing, lastError, executionError, reconciling, deepSeekFeedback, deepSeekCancelRequested, recommendedCandidateIds, recommendationSaving, recommendationError, previewPreparationRunning, previewPreparationProgress, previewPreparationError, refresh, startScan, resumeScan, getRecoverySummary, sendRecoveryDecision, selectSourceFolders, selectSegment, applyManualClassifications, organizeCurrentSegmentWithDeepSeek, cancelCurrentSegmentDeepSeek, retryFailedDeepSeekChunks,
    undoClassification, redoClassification, moveHistoryCursor, autoClassifyCurrentSegment, pauseTagEnrichment, resumeTagEnrichment, retryFailedTagEnrichment, acceptCurrentTags, setRecommendedCandidates, updateRecommendedCandidates, createLocalLedgerAndReclassify, freezeBilibiliExecution, confirmAndExecuteBilibiliPlan, saveCurrentSegmentLocally, abandonCurrentWorkspace, executeFrozenBilibiliPlan,
    reconcileFrozenBilibiliPlan, resumeReconciledBilibiliPlan,
    rebuildCorruptWorkspace, prepareRecommendationPreview, cancelRecommendationPreviewPreparation,
    available: Boolean(accountMid && window.bilimiDesktop?.commandOldFavoriteWorkspaceV1)
  }
}

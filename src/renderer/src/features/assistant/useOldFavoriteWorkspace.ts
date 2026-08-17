import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  OldFavoriteWorkspaceDeepSeekFailure,
  OldFavoriteWorkspaceDeepSeekResult,
  OldFavoriteWorkspaceRecoveryDecisionResult,
  OldFavoriteWorkspaceRecoverySummary,
  OldFavoriteWorkspaceView
} from '../../../../shared/oldFavoriteWorkspace'
import type { DeepSeekArchiveMode, DeepSeekArchiveScope } from '@shared/types'
import type { FavoriteLibraryWorkspaceSelection } from './assistantRuntimeTypes'

type WorkspaceView = OldFavoriteWorkspaceView

function normalizeCandidateIds(candidateIds: string[]) {
  return [...new Set(candidateIds.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))].sort()
}

function normalizeSelectedAids(aids: number[]) {
  return [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))].sort((left, right) => left - right)
}

function snapshotCandidateIds(snapshot: WorkspaceView | null, accountMid?: string) {
  return snapshot && !('recovery' in snapshot) && (!accountMid || normalizeAccountMid(snapshot.accountMid) === normalizeAccountMid(accountMid))
    ? normalizeCandidateIds(snapshot.recommendations?.adoptedCandidateIds ?? [])
    : []
}

function mergeDeepSeekProcessedItems(
  current: NonNullable<OldFavoriteWorkspaceDeepSeekResult['progress']['processedItems']> = [],
  next: NonNullable<OldFavoriteWorkspaceDeepSeekResult['progress']['processedItems']> = []
) {
  const merged = new Map(current.map((item) => [item.aid, item]))
  next.forEach((item) => merged.set(item.aid, item))
  return [...merged.values()]
}

function mergeDeepSeekProgress(
  current: OldFavoriteWorkspaceDeepSeekResult['progress'] | undefined,
  next: OldFavoriteWorkspaceDeepSeekResult['progress']
) {
  const processedItems = mergeDeepSeekProcessedItems(current?.processedItems, next.processedItems)
  return { ...next, ...(processedItems.length ? { processedItems } : {}) }
}

export type DeepSeekWorkspaceFeedback = {
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'canceled'
  message: string
  progress?: OldFavoriteWorkspaceDeepSeekResult['progress']
  failures?: OldFavoriteWorkspaceDeepSeekFailure[]
}

export type DraftLedgerRuleAnalysis = {
  workspaceId: string
  analysisId: string
  ledgerId: string
  status: 'running' | 'canceling'
  completedItemCount: number
  totalItemCount: number
}

type DraftLedgerRuleInput = {
  ledgerId: string
  title: string
  keywords: string[]
  ruleType: 'keyword' | 'author' | 'tag'
  adopt?: boolean
}

type ActiveDraftLedgerRuleAnalysis = DraftLedgerRuleAnalysis & {
  accountMid: string
  cancelRequested: boolean
}

let draftLedgerRuleAnalysisSequence = 0

function createDraftLedgerRuleAnalysisId() {
  draftLedgerRuleAnalysisSequence += 1
  return `rule-analysis-${Date.now().toString(36)}-${draftLedgerRuleAnalysisSequence.toString(36)}`
}

function deepSeekFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  if (/classifications must target selected sources/i.test(detail)) {
    return '整理范围发生了变化，本次结果未覆盖现有改动；请确认已选来源后重试。'
  }
  if (/changed while DeepSeek/i.test(detail)) {
    return '整理期间草稿发生了变化，本次结果未覆盖现有改动；请确认当前批次后重试。'
  }
  if (/requires rebuild|batch selection|workspace.*not ready/i.test(detail)) {
    return '整理草稿状态已变化，请返回扫描概览确认当前批次后重试。'
  }
  if (/DeepSeekServiceError|DeepSeek returned invalid JSON|authentication|model|API/i.test(detail)) {
    return 'DeepSeek 整理失败，请检查服务设置后重试。'
  }
  const wrapped = /^Error invoking remote method '.+':\s*Error:\s*(.+)$/i.exec(detail)?.[1]
  return wrapped || detail || 'DeepSeek 整理失败，请稍后重试。'
}

function draftLedgerRuleAnalysisFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  if (/draft ledger rule is unavailable|recommendations are not ready/i.test(detail)) {
    return '收藏夹规则暂时无法重新计算，请等待当前扫描完成后重试。'
  }
  if (/draft ledger rule is invalid/i.test(detail)) {
    return '收藏夹规则内容无效，请检查名称和关键词后重试。'
  }
  return '收藏夹规则分析失败，请稍后重试。'
}

function executionFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  if (/retry-cooldown/i.test(detail) && /invalid-response/i.test(detail)) {
    const status = /http-status=(\d+)/i.exec(detail)?.[1]
    const html = /response-category=html|content-type=text\/html/i.test(detail)
    return `B 站返回了无法解析的响应${status ? `（HTTP ${status}）` : ''}${html ? '，内容为 HTML' : ''}。这可能是嵌入页面临时验证或限制，系统已暂停连续重试；请稍后再继续。`
  }
  if (/Old favorite workspace command is invalid/i.test(detail)) {
    return '开发版主进程仍是旧版本，请重启开发项目后再试；本轮整理草稿不会丢失。'
  }
  if (/remote-timeout|page-execution-timeout/i.test(detail)) {
    return 'B 站结果暂时无法确认，请检查已登录页面和网络后重试；系统不会重复提交未确认的操作。'
  }
  if (/target-unavailable|page target is unavailable/i.test(detail)) {
    return '无法连接当前 B 站页面，同步已暂停。请保持已登录的 B 站页面打开后重新连接并检查同步结果；系统不会重复提交。'
  }
  if (/remote folder inventory is unavailable|page bridge is unavailable/i.test(detail)) {
    return '无法读取 B 站收藏夹列表，请保持已登录的 B 站页面打开后重试。'
  }
  if (/remote shard title is ambiguous/i.test(detail)) {
    return 'B 站中存在多个同名目标收藏夹，请整理重名收藏夹后重试。'
  }
  if (/remote shard title requires explicit rebinding/i.test(detail)) {
    return 'B 站已发现同名 bilimi 收藏夹，但尚未建立绑定。请先在收藏夹中完成备册并选择要绑定的收藏夹后重试。'
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
  const [tagEnrichmentUpdating, setTagEnrichmentUpdating] = useState(false)
  const [draftRuleAnalysis, setDraftRuleAnalysis] = useState<DraftLedgerRuleAnalysis | null>(null)
  const [draftRuleAnalysisError, setDraftRuleAnalysisError] = useState<string | null>(null)
  const activeDeepSeekWorkspaceId = useRef<string | null>(null)
  const observedDeepSeekCheckpointRef = useRef(false)
  const activeDraftRuleAnalysisRef = useRef<ActiveDraftLedgerRuleAnalysis | null>(null)
  const pendingDraftLedgerRuleRef = useRef(new Map<string, DraftLedgerRuleInput>())
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
  const recommendationQueueIdleResolversRef = useRef<Array<(ids: readonly string[]) => void>>([])
  const activeAccountMidRef = useRef(accountMid)

  useEffect(() => {
    const previousAccountMid = activeAccountMidRef.current
    const activeDraftRuleAnalysis = activeDraftRuleAnalysisRef.current
    if (previousAccountMid && previousAccountMid !== accountMid && activeDraftRuleAnalysis?.accountMid === previousAccountMid) {
      void window.bilimiDesktop?.commandOldFavoriteWorkspaceV1?.(previousAccountMid, {
        type: 'cancel-draft-ledger-rule-analysis', analysisId: activeDraftRuleAnalysis.analysisId
      })
    }
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
    setTagEnrichmentUpdating(false)
    activeDraftRuleAnalysisRef.current = null
    pendingDraftLedgerRuleRef.current.clear()
    setDraftRuleAnalysis(null)
    setDraftRuleAnalysisError(null)
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
    observedDeepSeekCheckpointRef.current = false
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
      setDeepSeekFeedback((current) => ({
        status: 'running',
        message: 'DeepSeek 正在整理当前分段…',
        progress: mergeDeepSeekProgress(current?.progress, {
          totalChunks: progress.totalChunks,
          completedChunks: progress.completedChunks,
          totalVideoCount: progress.totalVideoCount,
          successfulVideoCount: progress.successfulVideoCount,
          failedVideoCount: progress.failedVideoCount,
          processedItems: progress.processedItems
        }),
        failures: current?.failures
      }))
    })
  }, [accountMid])

  useEffect(() => {
    if (!snapshot || 'recovery' in snapshot) return
    if (snapshot.deepSeekRun?.status === 'running' && (
      activeDeepSeekWorkspaceId.current !== snapshot.workspaceId || deepSeekFeedback?.status !== 'running'
    )) {
      activeDeepSeekWorkspaceId.current = snapshot.workspaceId
      observedDeepSeekCheckpointRef.current = true
      setDeepSeekCancelRequested(false)
      setDeepSeekFeedback({ status: 'running', message: 'DeepSeek 正在依次整理本轮所有批次…' })
      return
    }
    if (activeDeepSeekWorkspaceId.current !== snapshot.workspaceId) return
    if (snapshot.deepSeekRun && snapshot.deepSeekRun.status !== 'canceled') observedDeepSeekCheckpointRef.current = true
    if (observedDeepSeekCheckpointRef.current && snapshot.deepSeekRun?.status === 'canceled' &&
      (deepSeekFeedback?.status === 'waiting' || deepSeekFeedback?.status === 'running')) {
      setDeepSeekFeedback((current) => current ? {
        ...current,
        status: 'canceled',
        message: 'DeepSeek 已停止；已完成批次结果会保留，再次开始时将从剩余批次继续。'
      } : current)
      return
    }
    if (!snapshot.deepSeekRun && observedDeepSeekCheckpointRef.current && deepSeekFeedback?.status === 'waiting') {
      setDeepSeekFeedback((current) => current ? {
        ...current,
        status: 'completed',
        message: 'DeepSeek 本轮所有批次已在后台整理完成。'
      } : current)
      activeDeepSeekWorkspaceId.current = null
      observedDeepSeekCheckpointRef.current = false
    }
  }, [deepSeekFeedback?.status, snapshot])

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
        if (isCurrent && !preserveSnapshot) setSnapshot(null)
        return null
      }
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      const isCurrent = preserveSnapshot
        ? backgroundRequestVersion.current === version && requestVersion.current === foregroundVersion && foregroundRequestCount.current === 0 && accountGeneration.current === generation
        : requestVersion.current === version && accountGeneration.current === generation
      if (!isCurrent) return null
      if (preserveSnapshot && 'recovery' in next) return null
      setSnapshot(next)
      return next
    } catch (error) {
      const isCurrent = preserveSnapshot
        ? backgroundRequestVersion.current === version && requestVersion.current === foregroundVersion && foregroundRequestCount.current === 0 && accountGeneration.current === generation
        : requestVersion.current === version && accountGeneration.current === generation
      if (isCurrent && !preserveSnapshot) setSnapshot(null)
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
      observedDeepSeekCheckpointRef.current = false
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

  const startSelectedReorganization = useCallback(async (selection: number[] | FavoriteLibraryWorkspaceSelection) => {
    const normalizedAids = Array.isArray(selection) ? normalizeSelectedAids(selection) : []
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command || (Array.isArray(selection) && (normalizedAids.length === 0 || normalizedAids.length > 2_000))) return null

    activeDeepSeekWorkspaceId.current = null
    setDeepSeekFeedback(null)
    setDeepSeekCancelRequested(false)
    setLoading(true)
    foregroundRequestCount.current += 1
    setLastError(null)
    try {
      const next = await command(accountMid, Array.isArray(selection)
        ? { type: 'start-selected-reorganization', aids: normalizedAids }
        : { type: 'start-selected-reorganization', selection })
      if (!next || normalizeAccountMid(next.accountMid) !== normalizeAccountMid(accountMid)) return null
      if (requestVersion.current === version && accountGeneration.current === generation) setSnapshot(next)
      return next
    } catch (error) {
      if (requestVersion.current === version && accountGeneration.current === generation) {
        setLastError(error instanceof Error ? error.message : '启动所选视频整理失败。')
      }
      throw error
    } finally {
      if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid])

  useEffect(() => {
    const subscribe = window.bilimiDesktop?.onOldFavoriteWorkspaceRuleAnalysisProgress
    if (!accountMid || !subscribe) return
    return subscribe((progress) => {
      const active = activeDraftRuleAnalysisRef.current
      if (!active || normalizeAccountMid(progress.accountMid) !== normalizeAccountMid(accountMid) ||
        progress.workspaceId !== active.workspaceId || progress.analysisId !== active.analysisId) return
      active.completedItemCount = progress.completedItemCount
      active.totalItemCount = progress.totalItemCount
      setDraftRuleAnalysis({
        workspaceId: active.workspaceId,
        analysisId: active.analysisId,
        ledgerId: active.ledgerId,
        status: active.status,
        completedItemCount: active.completedItemCount,
        totalItemCount: active.totalItemCount
      })
    })
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
  const pauseScan = useCallback(() => sendCommand({ type: 'pause-scan' }), [sendCommand])
  const prepareRecovery = useCallback(async (): Promise<OldFavoriteWorkspaceRecoverySummary | null> => {
    if (!accountMid) return null
    return window.bilimiDesktop?.prepareOldFavoriteWorkspaceRecoveryV1?.(accountMid) ?? null
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
    }) as unknown as Promise<OldFavoriteWorkspaceRecoveryDecisionResult>
  }, [accountMid])

  useEffect(() => {
    // Current preload builds expose the manifest-only recovery endpoint, so
    // mounting a library panel need not deserialize a workspace segment.
    if (window.bilimiDesktop?.prepareOldFavoriteWorkspaceRecoveryV1) return
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

  const organizeCurrentSegmentWithDeepSeek = useCallback(async (mode: DeepSeekArchiveMode, scope?: DeepSeekArchiveScope) => {
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
    observedDeepSeekCheckpointRef.current = false
    setDeepSeekFeedback({ status: 'running', message: scope === 'all' ? 'DeepSeek 正在依次整理本轮所有批次…' : 'DeepSeek 正在整理当前批次…' })
    try {
      const result = scope ? await organize(accountMid, mode, scope) : await organize(accountMid, mode)
      const next = result.snapshot
      if (normalizeAccountMid(next.accountMid) !== normalizeAccountMid(accountMid)) return null
      if (scope === 'all' && result.deferredSegmentCount) {
        activeDeepSeekWorkspaceId.current = next.workspaceId
        observedDeepSeekCheckpointRef.current = Boolean(next.deepSeekRun)
      }
      if (requestVersion.current === version && accountGeneration.current === generation) setSnapshot(next)
      if (requestVersion.current === version && accountGeneration.current === generation) {
        const referencedConstraintLedgerNames = result.referencedConstraintLedgerNames ?? []
        const referencedConstraints = referencedConstraintLedgerNames.length
          ? `本次整理参考了 DeepSeek 约束收藏夹：${referencedConstraintLedgerNames.join('、')}。`
          : '本次整理未带入 DeepSeek 约束收藏夹。'
        const deferredSegments = result.deferredSegmentCount
          ? `还有 ${result.deferredSegmentCount} 个批次等待标签补取，标签补取完成后会自动继续。`
          : ''
        setDeepSeekFeedback((current) => {
          const progress = mergeDeepSeekProgress(current?.progress, result.progress)
          return result.canceled
            ? { status: 'canceled', message: `DeepSeek 已在完成当前批次后停止；已更新 ${result.progress.successfulVideoCount} 条。${deferredSegments}${referencedConstraints}`, progress, failures: result.failures }
            : result.failures.length
              ? { status: 'failed', message: `DeepSeek 已处理 ${result.progress.successfulVideoCount} 条；${result.progress.failedVideoCount} 条未应用。${deferredSegments}${referencedConstraints}`, progress, failures: result.failures }
              : result.deferredSegmentCount
                ? { status: 'waiting', message: `DeepSeek 已完成当前可整理批次；${deferredSegments}${referencedConstraints}`, progress, failures: [] }
                : { status: 'completed', message: `DeepSeek 整理完成，已更新${scope === 'all' ? '本轮所有可整理批次' : '当前批次'}。${deferredSegments}${referencedConstraints}`, progress, failures: [] }
        })
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
    const generation = accountGeneration.current
    setDeepSeekCancelRequested(true)
    setDeepSeekFeedback((current) => current?.status === 'running'
      ? { ...current, message: '正在结束当前批次，后续批次不会再开始。' }
      : current)
    try {
      const next = await command(accountMid, { type: 'cancel-deepseek-current-segment' })
      if (accountGeneration.current !== generation) return false
      if (next && normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)) setSnapshot(next)
      setDeepSeekFeedback((current) => current ? {
        ...current,
        status: 'canceled',
        message: 'DeepSeek 已停止；已完成批次结果会保留，再次开始时将从剩余批次继续。'
      } : current)
      return true
    } catch {
      if (accountGeneration.current === generation) {
        setDeepSeekFeedback((current) => current?.status === 'running'
          ? { ...current, message: 'DeepSeek 正在整理当前批次…' }
          : current)
      }
      return false
    } finally {
      if (accountGeneration.current === generation) setDeepSeekCancelRequested(false)
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
        setDeepSeekFeedback((current) => {
          const progress = mergeDeepSeekProgress(current?.progress, result.progress)
          return result.failures.length
            ? { status: 'failed', message: `DeepSeek 已处理 ${result.progress.successfulVideoCount} 条；${result.progress.failedVideoCount} 条未应用。`, progress, failures: result.failures }
            : { status: 'completed', message: 'DeepSeek 失败批次已重试完成。', progress, failures: [] }
        })
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
  const sendTagEnrichmentCommand = useCallback(async (type: 'pause-tag-enrichment' | 'resume-tag-enrichment' | 'retry-failed-tag-enrichment' | 'accept-current-tags') => {
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null
    const generation = accountGeneration.current
    setTagEnrichmentUpdating(true)
    try {
      const next = await command(accountMid, { type })
      if (!next || accountGeneration.current !== generation || normalizeAccountMid(next.accountMid) !== normalizeAccountMid(accountMid)) return null
      setSnapshot(next)
      return next
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Old favorite workspace tag command failed.')
      return null
    } finally {
      if (accountGeneration.current === generation) setTagEnrichmentUpdating(false)
    }
  }, [accountMid])
  const pauseTagEnrichment = useCallback(() => sendTagEnrichmentCommand('pause-tag-enrichment'), [sendTagEnrichmentCommand])
  const resumeTagEnrichment = useCallback(() => sendTagEnrichmentCommand('resume-tag-enrichment'), [sendTagEnrichmentCommand])
  const retryFailedTagEnrichment = useCallback(() => sendTagEnrichmentCommand('retry-failed-tag-enrichment'), [sendTagEnrichmentCommand])
  const acceptCurrentTags = useCallback(() => sendTagEnrichmentCommand('accept-current-tags'), [sendTagEnrichmentCommand])
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
            setSnapshot(next)
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
        recommendationQueueIdleResolversRef.current.splice(0).forEach((resolve) => resolve([...recommendedCandidateIdsRef.current]))
      }
    }
  }, [accountMid])
  const waitForRecommendationQueue = useCallback((): Promise<readonly string[]> => {
    if (!recommendationQueueRunningRef.current && !recommendationDesiredRef.current) return Promise.resolve([...recommendedCandidateIdsRef.current])
    return new Promise<readonly string[]>((resolve) => recommendationQueueIdleResolversRef.current.push(resolve))
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
    const generation = ++previewPreparationGenerationRef.current
    const candidateIds = [...recommendedCandidateIdsRef.current]
    const fingerprint = JSON.stringify(candidateIds)
    activePreviewPreparationWorkspaceIdRef.current = workspaceId
    setPreviewPreparationRunning(true)
    setPreviewPreparationProgress({ completedItemCount: 0, totalItemCount: 0 })
    setPreviewPreparationError(null)
    try {
      await waitForRecommendationQueue()
      if (accountGeneration.current !== accountVersion ||
        previewPreparationGenerationRef.current !== generation ||
        JSON.stringify(recommendedCandidateIdsRef.current) !== fingerprint) return null
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
  const saveDraftLedgerRule = useCallback(async (input: DraftLedgerRuleInput) => {
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    const workspaceId = snapshot && !('recovery' in snapshot) && snapshot.status === 'previewing'
      ? snapshot.workspaceId
      : null
    const ledgerId = input.ledgerId.trim()
    const title = input.title.trim()
    const keywords = [...new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))]
    if (!accountMid || !command || !workspaceId || activeDraftRuleAnalysisRef.current ||
      !ledgerId || !title || !keywords.length) return null
    const analysisId = createDraftLedgerRuleAnalysisId()
    const active: ActiveDraftLedgerRuleAnalysis = {
      accountMid,
      workspaceId,
      analysisId,
      ledgerId,
      status: 'running',
      completedItemCount: 0,
      totalItemCount: 0,
      cancelRequested: false
    }
    activeDraftRuleAnalysisRef.current = active
    setDraftRuleAnalysis({
      workspaceId,
      analysisId,
      ledgerId,
      status: 'running',
      completedItemCount: 0,
      totalItemCount: 0
    })
    setDraftRuleAnalysisError(null)
    try {
      const next = await command(accountMid, {
        type: 'save-draft-ledger-rule',
        analysisId,
        ledgerId,
        title,
        keywords,
        ruleType: input.ruleType,
        ...(input.adopt === false ? { adopt: false } : {})
      })
      if (activeDraftRuleAnalysisRef.current !== active || !next || 'recovery' in next ||
        next.workspaceId !== workspaceId || normalizeAccountMid(next.accountMid) !== normalizeAccountMid(accountMid)) return null
      setSnapshot(next)
      return next
    } catch (error) {
      if (activeDraftRuleAnalysisRef.current === active && !active.cancelRequested) {
        setDraftRuleAnalysisError(draftLedgerRuleAnalysisFailureMessage(error))
      }
      return null
    } finally {
      if (activeDraftRuleAnalysisRef.current === active) {
        activeDraftRuleAnalysisRef.current = null
        setDraftRuleAnalysis(null)
      }
    }
  }, [accountMid, snapshot])
  const flushQueuedDraftLedgerRuleAnalysis = useCallback(async () => {
    const currentSnapshot = snapshot && !('recovery' in snapshot) && snapshot.status === 'previewing'
      ? snapshot
      : null
    if (!currentSnapshot || !pendingDraftLedgerRuleRef.current.size || activeDraftRuleAnalysisRef.current) return null
    const pending = pendingDraftLedgerRuleRef.current.values().next().value
    if (!pending) return null
    pendingDraftLedgerRuleRef.current.delete(pending.ledgerId)
    return saveDraftLedgerRule(pending)
  }, [saveDraftLedgerRule, snapshot])
  const queueDraftLedgerRuleAnalysis = useCallback((input: DraftLedgerRuleInput) => {
    const pending = {
      ...input,
      keywords: [...input.keywords]
    }
    // Keep only each ledger's latest local rule while preserving the order of
    // its last edit relative to other pending ledgers.
    pendingDraftLedgerRuleRef.current.delete(pending.ledgerId)
    pendingDraftLedgerRuleRef.current.set(pending.ledgerId, pending)
    setDraftRuleAnalysisError(null)
    void flushQueuedDraftLedgerRuleAnalysis()
  }, [flushQueuedDraftLedgerRuleAnalysis])
  useEffect(() => {
    void flushQueuedDraftLedgerRuleAnalysis()
  }, [draftRuleAnalysis, flushQueuedDraftLedgerRuleAnalysis])
  const cancelDraftLedgerRuleAnalysis = useCallback(async () => {
    const active = activeDraftRuleAnalysisRef.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!active || !command) return false
    active.cancelRequested = true
    active.status = 'canceling'
    setDraftRuleAnalysis({
      workspaceId: active.workspaceId,
      analysisId: active.analysisId,
      ledgerId: active.ledgerId,
      status: 'canceling',
      completedItemCount: active.completedItemCount,
      totalItemCount: active.totalItemCount
    })
    try {
      await command(active.accountMid, {
        type: 'cancel-draft-ledger-rule-analysis', analysisId: active.analysisId
      })
      return true
    } catch {
      if (activeDraftRuleAnalysisRef.current === active) {
        active.cancelRequested = false
        active.status = 'running'
        setDraftRuleAnalysis({
          workspaceId: active.workspaceId,
          analysisId: active.analysisId,
          ledgerId: active.ledgerId,
          status: 'running',
          completedItemCount: active.completedItemCount,
          totalItemCount: active.totalItemCount
        })
      }
      return false
    }
  }, [])
  const freezeBilibiliExecution = useCallback(() => sendCommand({ type: 'freeze-bilibili-execution' }), [sendCommand])
  const confirmAndExecuteBilibiliPlan = useCallback((includeInbox = false) => sendCommand({
    type: 'confirm-and-execute-bilibili-plan', ...(includeInbox ? { includeInbox: true } : {})
  }, true), [sendCommand])
  const saveCurrentSegmentLocally = useCallback(() => sendCommand({ type: 'save-current-segment-locally' }), [sendCommand])
  const setWholeRunExecutionIntent = useCallback((mode: 'local' | 'bilibili', includeInbox = false) => sendCommand({
    type: 'set-whole-run-execution-intent', mode, ...(includeInbox ? { includeInbox: true } : {})
  }, mode === 'bilibili'), [sendCommand])
  const cancelWholeRunExecutionIntent = useCallback(() => sendCommand({
    type: 'cancel-whole-run-execution-intent'
  }), [sendCommand])
  const useOriginalClassificationsForFailedDeepSeek = useCallback(() => sendCommand({
    type: 'use-original-classifications-for-failed-deepseek'
  }), [sendCommand])
  const abandonCurrentWorkspace = useCallback(async () => {
    const result = await sendCommand({ type: 'abandon-current-workspace' })
    if (!result) setSnapshot(null)
    return result
  }, [sendCommand])
  const viewSegment = useCallback(async (segmentId: string) => {
    const normalized = segmentId.trim()
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!normalized || !accountMid || !command) return null
    const next = await command(accountMid, { type: 'view-segment', segmentId: normalized })
    return next && !('recovery' in next) ? next : null
  }, [accountMid])
  const executeFrozenBilibiliPlan = useCallback(() => sendCommand({ type: 'execute-frozen-bilibili-plan' }, true), [sendCommand])
  const pauseBilibiliSync = useCallback(async () => {
    const result = await sendCommand({ type: 'pause-bilibili-sync' }, true)
    return Boolean(result)
  }, [sendCommand])
  const stopBilibiliSyncAndFinish = useCallback(async () => {
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return false
    setLoading(true)
    foregroundRequestCount.current += 1
    setExecutionError(null)
    try {
      await command(accountMid, { type: 'stop-bilibili-sync-and-finish' })
      if (accountGeneration.current === generation && requestVersion.current === version) setSnapshot(null)
      return true
    } catch (error) {
      if (accountGeneration.current === generation && requestVersion.current === version) {
        setExecutionError(executionFailureMessage(error))
      }
      return false
    } finally {
      if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid])
  const reconcileFrozenBilibiliPlan = useCallback(async () => {
    const generation = accountGeneration.current
    setReconciling(true)
    try {
      const next = await sendCommand({ type: 'reconcile-frozen-bilibili-plan' }, true)
      if (next && !('recovery' in next) && next.status === 'reconciling' && accountGeneration.current === generation) {
        setExecutionError('仍无法确认 B 站中的实际收藏结果，请保持已登录的 B 站页面打开后重新连接并检查；系统不会重复提交。')
      }
      return next
    } finally {
      if (accountGeneration.current === generation) setReconciling(false)
    }
  }, [sendCommand])
  const resumeReconciledBilibiliPlan = useCallback(() => sendCommand({ type: 'resume-reconciled-bilibili-plan' }), [sendCommand])
  const rebuildCorruptWorkspace = useCallback(() => sendCommand({ type: 'rebuild-corrupt-workspace' }), [sendCommand])

  useEffect(() => {
    if (!snapshot || 'recovery' in snapshot) return
    const hasActiveWork = snapshot && (
      ['scanning', 'executing', 'reconciling'].includes(snapshot.status) ||
      snapshot.tagEnrichment?.status === 'running' ||
      Boolean(snapshot.deepSeekRun && snapshot.deepSeekRun.status !== 'canceled')
    )
    if (!hasActiveWork) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true)
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [refresh, snapshot && !('recovery' in snapshot) ? snapshot.status : undefined, snapshot && !('recovery' in snapshot) ? snapshot.tagEnrichment?.status : undefined])

  return {
    snapshot, loading, backgroundRefreshing, lastError, executionError, reconciling, deepSeekFeedback, deepSeekCancelRequested, tagEnrichmentUpdating, draftRuleAnalysis, draftRuleAnalysisError, recommendedCandidateIds, recommendationSaving, recommendationError, previewPreparationRunning, previewPreparationProgress, previewPreparationError, refresh, startScan, startSelectedReorganization, resumeScan, pauseScan, prepareRecovery, sendRecoveryDecision, selectSourceFolders, selectSegment, viewSegment, applyManualClassifications, organizeCurrentSegmentWithDeepSeek, cancelCurrentSegmentDeepSeek, retryFailedDeepSeekChunks,
    undoClassification, redoClassification, moveHistoryCursor, autoClassifyCurrentSegment, pauseTagEnrichment, resumeTagEnrichment, retryFailedTagEnrichment, acceptCurrentTags, setRecommendedCandidates, updateRecommendedCandidates, saveDraftLedgerRule, queueDraftLedgerRuleAnalysis, cancelDraftLedgerRuleAnalysis, freezeBilibiliExecution, confirmAndExecuteBilibiliPlan, saveCurrentSegmentLocally, setWholeRunExecutionIntent, cancelWholeRunExecutionIntent, useOriginalClassificationsForFailedDeepSeek, abandonCurrentWorkspace, executeFrozenBilibiliPlan, pauseBilibiliSync, stopBilibiliSyncAndFinish,
    reconcileFrozenBilibiliPlan, resumeReconciledBilibiliPlan,
    rebuildCorruptWorkspace, prepareRecommendationPreview, cancelRecommendationPreviewPreparation, waitForRecommendationQueue,
    available: Boolean(accountMid && window.bilimiDesktop?.commandOldFavoriteWorkspaceV1)
  }
}

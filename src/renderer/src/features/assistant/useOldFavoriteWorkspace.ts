import { useCallback, useEffect, useRef, useState } from 'react'
import type { OldFavoriteWorkspaceDeepSeekFailure, OldFavoriteWorkspaceDeepSeekResult, OldFavoriteWorkspaceView } from '../../../../shared/oldFavoriteWorkspace'
import type { DeepSeekArchiveMode } from '@shared/types'

type WorkspaceView = OldFavoriteWorkspaceView

export type DeepSeekWorkspaceFeedback = {
  status: 'running' | 'completed' | 'failed'
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
  if (/remote-target-unbound|remote-ambiguous|account-mismatch|remote account mismatch/i.test(detail)) {
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
  const [deepSeekFeedback, setDeepSeekFeedback] = useState<DeepSeekWorkspaceFeedback | null>(null)
  const requestVersion = useRef(0)
  const backgroundRequestVersion = useRef(0)
  const foregroundRequestCount = useRef(0)
  const accountGeneration = useRef(0)

  useEffect(() => {
    accountGeneration.current += 1
    foregroundRequestCount.current = 0
    setLoading(false)
    setBackgroundRefreshing(false)
    setDeepSeekFeedback(null)
  }, [accountMid])

  useEffect(() => {
    const subscribe = window.bilimiDesktop?.onOldFavoriteWorkspaceDeepSeekProgress
    if (!accountMid || !subscribe) return
    return subscribe((progress) => {
      if (normalizeAccountMid(progress.accountMid) !== normalizeAccountMid(accountMid)) return
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
      if (isCurrent) setLastError(error instanceof Error ? error.message : '读取整理旧藏工作区失败。')
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

    setLoading(true)
    foregroundRequestCount.current += 1
    setLastError(null)
    try {
      const next = await command(accountMid, options?.clearBilibiliMirror && mode === 'full'
        ? { type: 'start-scan', mode, clearBilibiliMirror: true }
        : { type: 'start-scan', mode })
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      if (requestVersion.current === version && accountGeneration.current === generation) setSnapshot(next)
      return next
    } catch (error) {
      if (requestVersion.current === version && accountGeneration.current === generation) setLastError(error instanceof Error ? error.message : '启动整理旧藏扫描失败。')
      throw error
    } finally {
      if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid])

  const selectSourceFolders = useCallback(async (folderIds: string[]) => {
    const version = ++requestVersion.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null
    const normalizedFolderIds = [...new Set(folderIds.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))].sort()
    try {
      const next = await command(accountMid, { type: 'select-source-folders', folderIds: normalizedFolderIds })
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
        setDeepSeekFeedback(result.failures.length
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
      if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid])

  const retryFailedDeepSeekChunks = useCallback(async () => {
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const retry = window.bilimiDesktop?.retryOldFavoriteWorkspaceDeepSeekV1
    if (!accountMid || !retry) return null
    setLoading(true)
    foregroundRequestCount.current += 1
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
        setDeepSeekFeedback({ status: 'failed', message: deepSeekFailureMessage(error) })
      }
      return null
    } finally {
      if (accountGeneration.current === generation) {
        foregroundRequestCount.current = Math.max(0, foregroundRequestCount.current - 1)
        if (foregroundRequestCount.current === 0) setLoading(false)
      }
    }
  }, [accountMid])

  const undoClassification = useCallback(() => sendCommand({ type: 'undo-classification' }), [sendCommand])
  const redoClassification = useCallback(() => sendCommand({ type: 'redo-classification' }), [sendCommand])
  const moveHistoryCursor = useCallback((cursor: number) => sendCommand({ type: 'move-history-cursor', cursor }), [sendCommand])
  const autoClassifyCurrentSegment = useCallback(() => sendCommand({ type: 'auto-classify-current-segment' }), [sendCommand])
  const setRecommendedCandidates = useCallback((candidateIds: string[]) => sendCommand({
    type: 'set-recommended-candidates',
    candidateIds: [...new Set(candidateIds.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))].sort()
  }), [sendCommand])
  const createLocalLedgerAndReclassify = useCallback((title: string) => {
    const normalized = title.trim()
    return normalized ? sendCommand({ type: 'create-local-ledger-and-reclassify', title: normalized }) : Promise.resolve(null)
  }, [sendCommand])
  const freezeBilibiliExecution = useCallback(() => sendCommand({ type: 'freeze-bilibili-execution' }), [sendCommand])
  const confirmAndExecuteBilibiliPlan = useCallback(() => sendCommand({ type: 'confirm-and-execute-bilibili-plan' }, true), [sendCommand])
  const saveCurrentSegmentLocally = useCallback(() => sendCommand({ type: 'save-current-segment-locally' }), [sendCommand])
  const executeFrozenBilibiliPlan = useCallback(() => sendCommand({ type: 'execute-frozen-bilibili-plan' }, true), [sendCommand])
  const reconcileFrozenBilibiliPlan = useCallback(() => sendCommand({ type: 'reconcile-frozen-bilibili-plan' }, true), [sendCommand])
  const resumeReconciledBilibiliPlan = useCallback(() => sendCommand({ type: 'resume-reconciled-bilibili-plan' }), [sendCommand])
  const rebuildCorruptWorkspace = useCallback(() => sendCommand({ type: 'rebuild-corrupt-workspace' }), [sendCommand])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!snapshot || !['scanning', 'executing', 'reconciling'].includes(snapshot.status)) return
    const timer = window.setInterval(() => { void refresh(true) }, 400)
    return () => window.clearInterval(timer)
  }, [refresh, snapshot?.status])

  return {
    snapshot, loading, backgroundRefreshing, lastError, executionError, deepSeekFeedback, refresh, startScan, selectSourceFolders, selectSegment, applyManualClassifications, organizeCurrentSegmentWithDeepSeek, retryFailedDeepSeekChunks,
    undoClassification, redoClassification, moveHistoryCursor, autoClassifyCurrentSegment, setRecommendedCandidates, createLocalLedgerAndReclassify, freezeBilibiliExecution, confirmAndExecuteBilibiliPlan, saveCurrentSegmentLocally, executeFrozenBilibiliPlan,
    reconcileFrozenBilibiliPlan, resumeReconciledBilibiliPlan,
    rebuildCorruptWorkspace,
    available: Boolean(accountMid && window.bilimiDesktop?.commandOldFavoriteWorkspaceV1)
  }
}

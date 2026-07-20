import { useCallback, useEffect, useRef, useState } from 'react'
import type { OldFavoriteWorkspaceView } from '../../../../shared/oldFavoriteWorkspace'

type WorkspaceView = OldFavoriteWorkspaceView

function normalizeAccountMid(value: string) {
  if (!/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) return null
  return BigInt(value.trim()).toString()
}

export function useOldFavoriteWorkspace(accountMid?: string) {
  const [snapshot, setSnapshot] = useState<WorkspaceView | null>(null)
  const [loading, setLoading] = useState(false)
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const backgroundRequestVersion = useRef(0)
  const foregroundRequestCount = useRef(0)
  const accountGeneration = useRef(0)

  useEffect(() => {
    accountGeneration.current += 1
    foregroundRequestCount.current = 0
    setLoading(false)
    setBackgroundRefreshing(false)
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

  const startScan = useCallback(async (mode: 'incremental' | 'full' = 'incremental') => {
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null

    setLoading(true)
    foregroundRequestCount.current += 1
    setLastError(null)
    try {
      const next = await command(accountMid, { type: 'start-scan', mode })
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

  const sendCommand = useCallback(async (commandValue: unknown) => {
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null
    setLoading(true)
    foregroundRequestCount.current += 1
    try {
      const next = await command(accountMid, commandValue)
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      if (requestVersion.current === version && accountGeneration.current === generation) setSnapshot(next)
      return next
    } catch {
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

  const organizeCurrentSegmentWithDeepSeek = useCallback(async () => {
    const version = ++requestVersion.current
    const generation = accountGeneration.current
    const organize = window.bilimiDesktop?.organizeOldFavoriteWorkspaceDeepSeekV1
    if (!accountMid || !organize) return null
    setLoading(true)
    foregroundRequestCount.current += 1
    try {
      const next = await organize(accountMid)
      if (normalizeAccountMid(next.accountMid) !== normalizeAccountMid(accountMid)) return null
      if (requestVersion.current === version && accountGeneration.current === generation) setSnapshot(next)
      return next
    } catch {
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
  const confirmAndExecuteBilibiliPlan = useCallback(() => sendCommand({ type: 'confirm-and-execute-bilibili-plan' }), [sendCommand])
  const saveCurrentSegmentLocally = useCallback(() => sendCommand({ type: 'save-current-segment-locally' }), [sendCommand])
  const executeFrozenBilibiliPlan = useCallback(() => sendCommand({ type: 'execute-frozen-bilibili-plan' }), [sendCommand])
  const reconcileFrozenBilibiliPlan = useCallback(() => sendCommand({ type: 'reconcile-frozen-bilibili-plan' }), [sendCommand])
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
    snapshot, loading, backgroundRefreshing, lastError, refresh, startScan, selectSourceFolders, selectSegment, applyManualClassifications, organizeCurrentSegmentWithDeepSeek,
    undoClassification, redoClassification, autoClassifyCurrentSegment, setRecommendedCandidates, createLocalLedgerAndReclassify, freezeBilibiliExecution, confirmAndExecuteBilibiliPlan, saveCurrentSegmentLocally, executeFrozenBilibiliPlan,
    reconcileFrozenBilibiliPlan, resumeReconciledBilibiliPlan,
    rebuildCorruptWorkspace,
    available: Boolean(accountMid && window.bilimiDesktop?.commandOldFavoriteWorkspaceV1)
  }
}

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
  const requestVersion = useRef(0)

  const refresh = useCallback(async (preserveSnapshot = false) => {
    const version = ++requestVersion.current
    const open = window.bilimiDesktop?.openOldFavoriteWorkspaceV1
    if (!accountMid || !open) {
      setSnapshot(null)
      setLoading(false)
      return null
    }

    if (!preserveSnapshot) setSnapshot(null)
    setLoading(true)
    try {
      const next = await open(accountMid)
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      if (requestVersion.current === version) setSnapshot(next)
      return next
    } catch {
      if (requestVersion.current === version) setSnapshot(null)
      return null
    } finally {
      if (requestVersion.current === version) setLoading(false)
    }
  }, [accountMid])

  const startScan = useCallback(async (mode: 'incremental' | 'full' = 'incremental') => {
    const version = ++requestVersion.current
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null

    setLoading(true)
    try {
      const next = await command(accountMid, { type: 'start-scan', mode })
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      if (requestVersion.current === version) setSnapshot(next)
      return next
    } catch {
      return null
    } finally {
      if (requestVersion.current === version) setLoading(false)
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
    const command = window.bilimiDesktop?.commandOldFavoriteWorkspaceV1
    if (!accountMid || !command) return null
    try {
      const next = await command(accountMid, commandValue)
      const matchesRequestedAccount = normalizeAccountMid(next.accountMid) === normalizeAccountMid(accountMid)
      if (!matchesRequestedAccount) return null
      if (requestVersion.current === version) setSnapshot(next)
      return next
    } catch {
      return null
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

  const undoClassification = useCallback(() => sendCommand({ type: 'undo-classification' }), [sendCommand])
  const redoClassification = useCallback(() => sendCommand({ type: 'redo-classification' }), [sendCommand])
  const freezeBilibiliExecution = useCallback(() => sendCommand({ type: 'freeze-bilibili-execution' }), [sendCommand])
  const executeFrozenBilibiliPlan = useCallback(() => sendCommand({ type: 'execute-frozen-bilibili-plan' }), [sendCommand])
  const reconcileFrozenBilibiliPlan = useCallback(() => sendCommand({ type: 'reconcile-frozen-bilibili-plan' }), [sendCommand])
  const resumeReconciledBilibiliPlan = useCallback(() => sendCommand({ type: 'resume-reconciled-bilibili-plan' }), [sendCommand])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (snapshot?.status !== 'scanning') return
    const timer = window.setInterval(() => { void refresh(true) }, 400)
    return () => window.clearInterval(timer)
  }, [refresh, snapshot?.status])

  return {
    snapshot, loading, refresh, startScan, selectSourceFolders, selectSegment, applyManualClassifications,
    undoClassification, redoClassification, freezeBilibiliExecution, executeFrozenBilibiliPlan,
    reconcileFrozenBilibiliPlan, resumeReconciledBilibiliPlan,
    available: Boolean(accountMid && window.bilimiDesktop?.commandOldFavoriteWorkspaceV1)
  }
}

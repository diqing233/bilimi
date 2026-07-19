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

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (snapshot?.status !== 'scanning') return
    const timer = window.setInterval(() => { void refresh(true) }, 400)
    return () => window.clearInterval(timer)
  }, [refresh, snapshot?.status])

  return { snapshot, loading, refresh, startScan, available: Boolean(accountMid && window.bilimiDesktop?.commandOldFavoriteWorkspaceV1) }
}

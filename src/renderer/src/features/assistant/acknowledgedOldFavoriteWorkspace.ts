const STORAGE_KEY = 'bilimi:acknowledged-old-favorite-workspaces'

export type AcknowledgedOldFavoriteWorkspaces = Record<string, string>

export function loadAcknowledgedOldFavoriteWorkspaces(
  storage: Pick<Storage, 'getItem'> = window.localStorage
): AcknowledgedOldFavoriteWorkspaces {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([accountMid, workspaceId]) =>
      /^\d+$/.test(accountMid) && typeof workspaceId === 'string' && workspaceId.trim()
    )) as AcknowledgedOldFavoriteWorkspaces
  } catch {
    return {}
  }
}

export function acknowledgeOldFavoriteWorkspace(
  current: AcknowledgedOldFavoriteWorkspaces,
  accountMid: string,
  workspaceId: string
): AcknowledgedOldFavoriteWorkspaces {
  if (!/^\d+$/.test(accountMid) || !workspaceId.trim()) return current
  return { ...current, [accountMid]: workspaceId.trim() }
}

export function saveAcknowledgedOldFavoriteWorkspaces(
  value: AcknowledgedOldFavoriteWorkspaces,
  storage: Pick<Storage, 'setItem'> = window.localStorage
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // The in-memory acknowledgement still applies when renderer storage is unavailable.
  }
}

import { contextBridge, ipcRenderer } from 'electron'
import type { FavoriteRepositoryLibraryPage, FavoriteRepositoryRevisionChange, FavoriteRepositorySnapshotSummary } from '../main/favoriteRepositoryIpc'
import type { FavoriteLibraryCommandResult, FavoriteLibrarySyncSelection } from '../main/favoriteLibraryCommands'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  readBilibiliAccountMid: () => ipcRenderer.invoke('bilibili:account-mid') as Promise<string>,
  onBilibiliAccountChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('bilibili:account-changed', listener)
    return () => ipcRenderer.removeListener('bilibili:account-changed', listener)
  },
  openFavoriteRepositoryAccount: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:open-account', accountMid) as Promise<FavoriteRepositorySnapshotSummary>,
  getFavoriteRepositoryLibraryPage: (
    accountMid: string,
    scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' },
    options: { limit: number; cursor?: string }
  ) => ipcRenderer.invoke('favorite-repository:get-library-page', accountMid, scope, options) as Promise<FavoriteRepositoryLibraryPage>,
  syncFavoriteLibrarySelection: (accountMid: string, selection: FavoriteLibrarySyncSelection) =>
    ipcRenderer.invoke('favorite-library:sync-selection', accountMid, selection) as Promise<FavoriteLibraryCommandResult>,
  reconcileFavoriteLibrarySync: (accountMid: string, runId: string) =>
    ipcRenderer.invoke('favorite-library:reconcile-sync', accountMid, runId) as Promise<FavoriteLibraryCommandResult>,
  retryFavoriteLibrarySync: (accountMid: string, runId: string) =>
    ipcRenderer.invoke('favorite-library:retry-sync', accountMid, runId) as Promise<FavoriteLibraryCommandResult>,
  bindFavoriteLibrarySyncPage: (accountMid: string, runId: string) =>
    ipcRenderer.invoke('favorite-library:bind-sync-page', accountMid, runId) as Promise<FavoriteLibraryCommandResult>,
  getPendingFavoriteLibrarySyncRuns: (accountMid: string) =>
    ipcRenderer.invoke('favorite-library:get-pending-sync-runs', accountMid) as Promise<FavoriteLibraryCommandResult[]>,
  enqueueFavoriteLibraryTranscription: (accountMid: string, input: { aids: number[]; summarizeWithDeepSeek?: boolean }) =>
    ipcRenderer.invoke('favorite-library:enqueue-transcription', accountMid, input) as Promise<FavoriteLibraryCommandResult>,
  subscribeFavoriteRepository: (
    accountMid: string,
    folderId: string | undefined,
    callback: (change: FavoriteRepositoryRevisionChange) => void
  ) => {
    let subscriptionId: string | undefined
    let disposed = false
    const listener = (_event: Electron.IpcRendererEvent, change: FavoriteRepositoryRevisionChange) => {
      if (change.subscriptionId === subscriptionId) callback(change)
    }
    ipcRenderer.on('favorite-repository:revision-changed', listener)
    void ipcRenderer.invoke('favorite-repository:subscribe', accountMid, folderId)
      .then((id: string) => {
        subscriptionId = id
        if (disposed) void ipcRenderer.invoke('favorite-repository:unsubscribe', accountMid, id).catch(() => undefined)
      })
      .catch(() => ipcRenderer.removeListener('favorite-repository:revision-changed', listener))
    return () => {
      disposed = true
      ipcRenderer.removeListener('favorite-repository:revision-changed', listener)
      if (subscriptionId) void ipcRenderer.invoke('favorite-repository:unsubscribe', accountMid, subscriptionId).catch(() => undefined)
    }
  }
})

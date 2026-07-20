import { contextBridge, ipcRenderer } from 'electron'
import type { FavoriteRepositoryLibraryPage, FavoriteRepositoryRevisionChange, FavoriteRepositorySnapshotSummary } from '../main/favoriteRepositoryIpc'

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

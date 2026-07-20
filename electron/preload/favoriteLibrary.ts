import { contextBridge, ipcRenderer } from 'electron'
import type {
  FavoriteRepositoryLibraryPage,
  FavoriteRepositoryLibraryVideoDetail,
  FavoriteRepositoryRevisionChange,
  FavoriteRepositorySnapshotSummary
} from '../main/favoriteRepositoryIpc'
import type { FavoriteLibraryCommandResult, FavoriteLibrarySyncSelection } from '../main/favoriteLibraryCommands'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  readBilibiliAccountMid: () => ipcRenderer.invoke('bilibili:account-mid') as Promise<string>,
  readBilibiliAccount: () => ipcRenderer.invoke('favorite-library:read-account') as Promise<{ mid: string; nickname?: string }>,
  openFavoriteLibraryVideo: (accountMid: string, aid: number) =>
    ipcRenderer.invoke('favorite-library:open-video', accountMid, aid) as Promise<void>,
  openFavoriteLibrarySource: (accountMid: string, folderId: string) =>
    ipcRenderer.invoke('favorite-library:open-source', accountMid, folderId) as Promise<void>,
  toggleFavoriteLibraryArchiveStar: (accountMid: string, aid: number) =>
    ipcRenderer.invoke('favorite-library:toggle-archive-star', accountMid, aid) as Promise<void>,
  saveFavoriteLibraryArchiveMemo: (accountMid: string, aid: number, memo: string) =>
    ipcRenderer.invoke('favorite-library:save-archive-memo', accountMid, aid, memo) as Promise<void>,
  onBilibiliAccountChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('bilibili:account-changed', listener)
    return () => ipcRenderer.removeListener('bilibili:account-changed', listener)
  },
  onFavoriteLibraryTranscriptionChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('favorite-library:transcription-changed', listener)
    return () => ipcRenderer.removeListener('favorite-library:transcription-changed', listener)
  },
  openFavoriteRepositoryAccount: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:open-account', accountMid) as Promise<FavoriteRepositorySnapshotSummary>,
  getFavoriteRepositoryLibraryPage: (
    accountMid: string,
    scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' },
    options: { limit: number; cursor?: string }
  ) => ipcRenderer.invoke('favorite-repository:get-library-page', accountMid, scope, options) as Promise<FavoriteRepositoryLibraryPage>,
  getFavoriteRepositoryLibraryVideoDetail: (accountMid: string, aid: number) =>
    ipcRenderer.invoke('favorite-repository:get-library-video-detail', accountMid, aid) as Promise<FavoriteRepositoryLibraryVideoDetail>,
  syncFavoriteLibrarySelection: (accountMid: string, selection: FavoriteLibrarySyncSelection) =>
    ipcRenderer.invoke('favorite-library:sync-selection', accountMid, selection) as Promise<FavoriteLibraryCommandResult>,
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

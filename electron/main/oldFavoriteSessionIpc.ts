import type { OldFavoriteSessionsState, OldFavoriteTaskKind } from '../../src/shared/oldFavoriteSessions'
import type { OldFavoriteSessionStore } from './oldFavoriteSessionStore'

type IpcEvent = { sender: { id: number } }

export interface OldFavoriteSessionIpcMain {
  handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void
}

type RegisterOptions = {
  ipcMain: OldFavoriteSessionIpcMain
  store: OldFavoriteSessionStore
  isTrustedSender: (senderId: number) => boolean
  broadcast: (state: OldFavoriteSessionsState) => void
}

function assertTrusted(event: IpcEvent, isTrustedSender: RegisterOptions['isTrustedSender']): void {
  if (!isTrustedSender(event.sender.id)) {
    throw new Error('Old favorite session request came from an untrusted renderer.')
  }
}

export function registerOldFavoriteSessionIpc(options: RegisterOptions): void {
  const { ipcMain, store, isTrustedSender, broadcast } = options

  ipcMain.handle('old-favorite-sessions:load', (event) => {
    assertTrusted(event, isTrustedSender)
    return store.load()
  })
  ipcMain.handle('old-favorite-sessions:save', async (event, state: OldFavoriteSessionsState) => {
    assertTrusted(event, isTrustedSender)
    store.save(state)
    await store.flush()
    const saved = store.load()
    broadcast(saved)
    return saved
  })
  ipcMain.handle(
    'old-favorite-sessions:claim-lease',
    (event, batchId: string, segmentId: string, task: OldFavoriteTaskKind, accountMid: string) => {
      assertTrusted(event, isTrustedSender)
      const claimed = store.claimLease(batchId, segmentId, task, accountMid, event.sender.id)
      if (claimed) broadcast(store.load())
      return claimed
    }
  )
  ipcMain.handle('old-favorite-sessions:release-lease', (event, batchId: string, segmentId: string) => {
    assertTrusted(event, isTrustedSender)
    const released = store.releaseLease(batchId, segmentId, event.sender.id)
    if (released) broadcast(store.load())
    return released
  })
  ipcMain.handle('old-favorite-sessions:reset-account', async (event, accountMid: string) => {
    assertTrusted(event, isTrustedSender)
    const saved = store.resetAccount(accountMid)
    await store.flush()
    broadcast(saved)
    return saved
  })
}

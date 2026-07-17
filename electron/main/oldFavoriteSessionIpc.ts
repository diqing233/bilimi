import type { OldFavoriteSessionsState, OldFavoriteTaskKind } from '../../src/shared/oldFavoriteSessions'
import type { OldFavoriteSessionStore } from './oldFavoriteSessionStore'

type IpcEvent = { sender: { id: number } }

export interface OldFavoriteSessionIpcMain {
  handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void
}

type RegisterOptions = {
  ipcMain: OldFavoriteSessionIpcMain
  store?: OldFavoriteSessionStore
  getStore?: () => Promise<OldFavoriteSessionStore>
  isTrustedSender: (senderId: number) => boolean
  broadcast: (state: OldFavoriteSessionsState) => void
  onMutation?: () => void
}

function assertTrusted(event: IpcEvent, isTrustedSender: RegisterOptions['isTrustedSender']): void {
  if (!isTrustedSender(event.sender.id)) {
    throw new Error('Old favorite session request came from an untrusted renderer.')
  }
}

export function registerOldFavoriteSessionIpc(options: RegisterOptions): void {
  const { ipcMain, isTrustedSender, broadcast } = options
  const getStore = async () => options.store ?? options.getStore?.() ??
    Promise.reject(new Error('Old favorite session store is unavailable.'))

  ipcMain.handle('old-favorite-sessions:load', (event) => {
    assertTrusted(event, isTrustedSender)
    return options.store ? options.store.load() : getStore().then((store) => store.load())
  })
  ipcMain.handle('old-favorite-sessions:save', async (event, state: OldFavoriteSessionsState) => {
    assertTrusted(event, isTrustedSender)
    const store = await getStore()
    store.save(state)
    options.onMutation?.()
    await store.flush()
    const saved = store.load()
    broadcast(saved)
    return saved
  })
  ipcMain.handle(
    'old-favorite-sessions:claim-lease',
    (event, batchId: string, segmentId: string, task: OldFavoriteTaskKind, accountMid: string) => {
      assertTrusted(event, isTrustedSender)
      const claim = (store: OldFavoriteSessionStore) => {
        const claimed = store.claimLease(batchId, segmentId, task, accountMid, event.sender.id)
        if (claimed) {
          options.onMutation?.()
          broadcast(store.load())
        }
        return claimed
      }
      return options.store ? claim(options.store) : getStore().then(claim)
    }
  )
  ipcMain.handle('old-favorite-sessions:release-lease', (event, batchId: string, segmentId: string) => {
    assertTrusted(event, isTrustedSender)
    const release = (store: OldFavoriteSessionStore) => {
      const released = store.releaseLease(batchId, segmentId, event.sender.id)
      if (released) {
        options.onMutation?.()
        broadcast(store.load())
      }
      return released
    }
    return options.store ? release(options.store) : getStore().then(release)
  })
  ipcMain.handle('old-favorite-sessions:reset-account', async (event, accountMid: string) => {
    assertTrusted(event, isTrustedSender)
    const store = await getStore()
    const saved = store.resetAccount(accountMid)
    options.onMutation?.()
    await store.flush()
    broadcast(saved)
    return saved
  })
}

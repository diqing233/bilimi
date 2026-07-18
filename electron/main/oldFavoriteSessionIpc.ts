import type { OldFavoriteBatchSnapshot, OldFavoriteSessionsState, OldFavoriteTaskKind } from '../../src/shared/oldFavoriteSessions'
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
  onMutation?: (dirty: boolean, mutation?: unknown) => unknown
}

function assertTrusted(event: IpcEvent, isTrustedSender: RegisterOptions['isTrustedSender']): void {
  if (!isTrustedSender(event.sender.id)) {
    throw new Error('Old favorite session request came from an untrusted renderer.')
  }
}

function finishMutation(options: RegisterOptions, mutation: unknown): void {
  if (mutation === undefined) options.onMutation?.(false)
  else options.onMutation?.(false, mutation)
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
    const mutation = options.onMutation?.(true)
    await store.flush()
    finishMutation(options, mutation)
    const saved = store.load()
    broadcast(saved)
    return saved
  })
  ipcMain.handle(
    'old-favorite-sessions:begin-full-scan',
    async (event, accountMid: string, now: string, snapshot?: OldFavoriteBatchSnapshot) => {
      assertTrusted(event, isTrustedSender)
      const store = await getStore()
      const result = store.beginFullScan(accountMid, now, snapshot, event.sender.id)
      if (result.acquired) {
        const mutation = options.onMutation?.(true)
        try {
          await store.flush()
        } catch (error) {
          store.rollbackFullScan(result.batch.id, event.sender.id)
          throw error
        }
        finishMutation(options, mutation)
        broadcast(store.load())
      }
      return result
    }
  )
  ipcMain.handle(
    'old-favorite-sessions:claim-lease',
    async (event, batchId: string, segmentId: string, task: OldFavoriteTaskKind, accountMid: string) => {
      assertTrusted(event, isTrustedSender)
      const claim = async (store: OldFavoriteSessionStore) => {
        const claimed = store.claimLease(batchId, segmentId, task, accountMid, event.sender.id)
        if (claimed) {
          const mutation = options.onMutation?.(true)
          await store.flush()
          finishMutation(options, mutation)
          broadcast(store.load())
        }
        return claimed
      }
      return claim(await getStore())
    }
  )
  ipcMain.handle('old-favorite-sessions:release-lease', async (event, batchId: string, segmentId: string) => {
    assertTrusted(event, isTrustedSender)
    const release = async (store: OldFavoriteSessionStore) => {
      const released = store.releaseLease(batchId, segmentId, event.sender.id)
      if (released) {
        const mutation = options.onMutation?.(true)
        await store.flush()
        finishMutation(options, mutation)
        broadcast(store.load())
      }
      return released
    }
    return release(await getStore())
  })
  ipcMain.handle('old-favorite-sessions:reset-account', async (event, accountMid: string) => {
    assertTrusted(event, isTrustedSender)
    const store = await getStore()
    const previous = store.load()
    const saved = store.resetAccount(accountMid)
    const mutation = options.onMutation?.(true)
    try {
      await store.flush()
    } catch (error) {
      store.restore(previous)
      await store.flush().catch(() => undefined)
      throw error
    }
    finishMutation(options, mutation)
    broadcast(saved)
    return saved
  })
}

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
  getWorkspaceBatchSummary?: (
    accountMid: string,
    batchId: string
  ) => Promise<{ status: 'active' | 'archived'; finalizedAt?: string } | null>
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
  let mutationTail = Promise.resolve()
  const queueMutation = <T>(work: () => Promise<T>): Promise<T> => {
    const next = mutationTail.then(work, work)
    mutationTail = next.then(() => undefined, () => undefined)
    return next
  }
  const getStore = async () => options.store ?? options.getStore?.() ??
    Promise.reject(new Error('Old favorite session store is unavailable.'))

  ipcMain.handle('old-favorite-sessions:load', (event) => {
    assertTrusted(event, isTrustedSender)
    return options.store ? options.store.load() : getStore().then((store) => store.load())
  })
  ipcMain.handle('old-favorite-sessions:save', async (event, state: OldFavoriteSessionsState) => {
    assertTrusted(event, isTrustedSender)
    return queueMutation(async () => {
      const store = await getStore()
      store.save(state)
      const mutation = options.onMutation?.(true)
      await store.flush()
      finishMutation(options, mutation)
      const saved = store.load()
      broadcast(saved)
      return saved
    })
  })
  ipcMain.handle(
    'old-favorite-sessions:begin-full-scan',
    async (event, accountMid: string, now: string, snapshot?: OldFavoriteBatchSnapshot) => {
      assertTrusted(event, isTrustedSender)
      return queueMutation(async () => {
        const store = await getStore()
        const previous = store.load()
        const result = store.beginFullScan(accountMid, now, snapshot, event.sender.id)
        if (result.acquired) {
          const mutation = options.onMutation?.(true)
          try {
            await store.flush()
          } catch (error) {
            store.restore(previous)
            await store.flush().catch(() => undefined)
            throw error
          }
          finishMutation(options, mutation)
          broadcast(store.load())
        }
        return result
      })
    }
  )
  ipcMain.handle(
    'old-favorite-sessions:begin-incremental-scan',
    async (event, accountMid: string, now: string, snapshot?: OldFavoriteBatchSnapshot) => {
      assertTrusted(event, isTrustedSender)
      return queueMutation(async () => {
        const store = await getStore()
        const previous = store.load()
        const result = store.beginIncrementalScan(accountMid, now, snapshot, event.sender.id)
        if (result.acquired) {
          const mutation = options.onMutation?.(true)
          try {
            await store.flush()
          } catch (error) {
            store.restore(previous)
            await store.flush().catch(() => undefined)
            throw error
          }
          finishMutation(options, mutation)
          broadcast(store.load())
        }
        return result
      })
    }
  )
  ipcMain.handle(
    'old-favorite-sessions:end-batch',
    async (event, batchId: string, endedAt: string) => {
      assertTrusted(event, isTrustedSender)
      return queueMutation(async () => {
        const store = await getStore()
        const previous = store.load()
        const before = previous.batches.find((batch) => batch.id === batchId)
        if (!before) throw new Error('Old favorite batch does not exist.')
        if (before.status === 'ended') return store.toLifecycleSnapshot(before)
        const workspaceSummary = await options.getWorkspaceBatchSummary?.(before.accountMid, batchId)
        const authoritativeEndedAt = workspaceSummary?.status === 'archived'
          ? workspaceSummary.finalizedAt ?? endedAt
          : endedAt
        const ended = store.endBatch(batchId, authoritativeEndedAt)
        const mutation = options.onMutation?.(true)
        try {
          await store.flush()
        } catch (error) {
          store.restore(previous)
          await store.flush().catch(() => undefined)
          throw error
        }
        finishMutation(options, mutation)
        broadcast(store.load())
        return store.toLifecycleSnapshot(ended)
      })
    }
  )
  ipcMain.handle(
    'old-favorite-sessions:discard-empty-incremental',
    async (event, batchId: string, accountMid: string) => {
      assertTrusted(event, isTrustedSender)
      return queueMutation(async () => {
        const store = await getStore()
        const previous = store.load()
        const result = store.discardEmptyIncrementalBatch(batchId, accountMid, event.sender.id)
        const changed = previous.batches.some((batch) => batch.id === batchId)
        if (!changed) return result
        const mutation = options.onMutation?.(true)
        try {
          await store.flush()
        } catch (error) {
          store.restore(previous)
          await store.flush().catch(() => undefined)
          throw error
        }
        finishMutation(options, mutation)
        broadcast(store.load())
        return result
      })
    }
  )
  ipcMain.handle(
    'old-favorite-sessions:claim-lease',
    async (event, batchId: string, segmentId: string, task: OldFavoriteTaskKind, accountMid: string) => {
      assertTrusted(event, isTrustedSender)
      return queueMutation(async () => {
        const store = await getStore()
        const claimed = store.claimLease(batchId, segmentId, task, accountMid, event.sender.id)
        if (claimed) {
          const mutation = options.onMutation?.(true)
          await store.flush()
          finishMutation(options, mutation)
          broadcast(store.load())
        }
        return claimed
      })
    }
  )
  ipcMain.handle('old-favorite-sessions:release-lease', async (event, batchId: string, segmentId: string) => {
    assertTrusted(event, isTrustedSender)
    return queueMutation(async () => {
      const store = await getStore()
      const released = store.releaseLease(batchId, segmentId, event.sender.id)
      if (released) {
        const mutation = options.onMutation?.(true)
        await store.flush()
        finishMutation(options, mutation)
        broadcast(store.load())
      }
      return released
    })
  })
  ipcMain.handle('old-favorite-sessions:reset-account', async (event, accountMid: string) => {
    assertTrusted(event, isTrustedSender)
    return queueMutation(async () => {
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
  })
}

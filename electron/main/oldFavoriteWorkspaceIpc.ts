import type { OldFavoriteWorkspaceService } from './oldFavoriteWorkspaceService'

type IpcEvent = { sender: { id: number } }
type IpcMain = {
  handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void
}

export function registerOldFavoriteWorkspaceIpc(options: {
  ipcMain: IpcMain
  service: OldFavoriteWorkspaceService
  isTrustedSender: (senderId: number) => boolean
  send?: (senderId: number, channel: string, payload: unknown) => void
  onMutation?: () => void
}) {
  const subscriptions = new Map<number, Set<string>>()
  const assertTrusted = (event: IpcEvent) => {
    if (!options.isTrustedSender(event.sender.id)) {
      throw new Error('Old favorite workspace request came from an untrusted renderer.')
    }
  }

  options.ipcMain.handle('old-favorite-workspace:open-account', (event, accountMid: string) => {
    assertTrusted(event)
    return options.service.openAccount(accountMid)
  })
  options.ipcMain.handle('old-favorite-workspace:load-batch', (event, accountMid: string, batchId: string) => {
    assertTrusted(event)
    return options.service.loadBatch(accountMid, batchId)
  })
  options.ipcMain.handle('old-favorite-workspace:create-batch', (event, input: Parameters<OldFavoriteWorkspaceService['createBatch']>[0]) => {
    assertTrusted(event)
    options.onMutation?.()
    return options.service.createBatch(input)
  })
  options.ipcMain.handle('old-favorite-workspace:append-chunk', (
    event,
    accountMid: string,
    batchId: string,
    kind: Parameters<OldFavoriteWorkspaceService['appendChunk']>[2],
    items: unknown[]
  ) => {
    assertTrusted(event)
    options.onMutation?.()
    return options.service.appendChunk(accountMid, batchId, kind, items)
  })
  options.ipcMain.handle('old-favorite-workspace:patch-overlay', (
    event,
    accountMid: string,
    batchId: string,
    kind: Parameters<OldFavoriteWorkspaceService['patchOverlay']>[2],
    patch: Parameters<OldFavoriteWorkspaceService['patchOverlay']>[3]
  ) => {
    assertTrusted(event)
    options.onMutation?.()
    return options.service.patchOverlay(accountMid, batchId, kind, patch)
  })
  options.ipcMain.handle('old-favorite-workspace:finalize-batch', (event, accountMid: string, batchId: string) => {
    assertTrusted(event)
    options.onMutation?.()
    return options.service.finalizeBatch(accountMid, batchId)
  })
  options.ipcMain.handle('old-favorite-workspace:reset-account', (event, accountMid: string) => {
    assertTrusted(event)
    options.onMutation?.()
    return options.service.resetAccount(accountMid)
  })
  options.ipcMain.handle('old-favorite-workspace:subscribe', (event, accountMid: string, batchId: string) => {
    assertTrusted(event)
    const keys = subscriptions.get(event.sender.id) ?? new Set<string>()
    keys.add(`${accountMid.trim()}:${batchId}`)
    subscriptions.set(event.sender.id, keys)
    return true
  })

  return {
    publishProgress(accountMid: string, batchId: string, progress: unknown) {
      const key = `${accountMid.trim()}:${batchId}`
      for (const [senderId, keys] of subscriptions) {
        if (!keys.has(key)) continue
        options.send?.(senderId, 'old-favorite-workspace:progress', { accountMid, batchId, progress })
      }
    }
  }
}

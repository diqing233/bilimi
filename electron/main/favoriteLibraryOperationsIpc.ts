import type { FavoriteOperationSourceScope, FavoriteRepositoryBatchOperationService } from './favoriteRepositoryBatchOperationService'
import type { FavoriteRepositoryManagedFolderService } from './favoriteRepositoryManagedFolderService'

type IpcEvent = { sender: { id: number } }
type IpcMain = { handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void }

function account(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim()) || BigInt(value.trim()) === 0n) throw new Error('Favorite operation account is invalid.')
  return BigInt(value.trim()).toString()
}

function aids(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 100 || new Set(value).size !== value.length || value.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
    throw new Error('Favorite operation aids are invalid.')
  }
  return (value as number[]).slice().sort((left, right) => left - right)
}

function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Favorite operation baseline is invalid.')
  return value
}

function targets(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.some((folderId) => typeof folderId !== 'string' || !/^bilimi-logical:\S+$/u.test(folderId))) {
    throw new Error('Favorite operation target is invalid.')
  }
  return [...new Set(value)].sort()
}

function sourceFolder(value: unknown) {
  if (typeof value !== 'string' || !/^bilimi-logical:\S+$/u.test(value)) throw new Error('Favorite move source is invalid.')
  return value
}

function token(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Favorite operation token is invalid.')
  return value
}

type RendererSource = { kind: 'folder'; folderId: string } | { kind: 'virtual'; eligibleAids: number[]; skippedAids: number[] }

function rendererSource(value: unknown): RendererSource {
  if (!value || typeof value !== 'object') throw new Error('Favorite operation source is invalid.')
  const source = value as Record<string, unknown>
  if (source.kind === 'folder' && typeof source.folderId === 'string' && source.folderId.trim()) return { kind: 'folder', folderId: source.folderId.trim() }
  if (source.kind === 'virtual' && Array.isArray(source.eligibleAids) && Array.isArray(source.skippedAids)) {
    return { kind: 'virtual', eligibleAids: aids(source.eligibleAids), skippedAids: source.skippedAids.length ? aids(source.skippedAids) : [] }
  }
  throw new Error('Favorite operation source is invalid.')
}

/** Registers only account-bound preview, confirmation, execution and reconciliation actions. */
export function registerFavoriteLibraryOperationsIpc(options: {
  ipcMain: IpcMain
  batch: Pick<FavoriteRepositoryBatchOperationService, 'copy' | 'move' | 'deleteLocal' | 'previewRemoteUnfavorite' | 'confirmRemoteUnfavorite' | 'executeRemoteUnfavorite' | 'reconcileRemoteUnfavorite'>
  managed: Pick<FavoriteRepositoryManagedFolderService, 'preview' | 'deleteLocal' | 'confirm' | 'executeRemote' | 'reconcile'>
  isTrustedSender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  /** Resolves folder provenance from the current repository snapshot, never renderer labels. */
  resolveSourceScope: (accountMid: string, source: RendererSource, requestedAids: number[]) => Promise<FavoriteOperationSourceScope>
}) {
  const trusted = (event: IpcEvent) => {
    if (!options.isTrustedSender(event.sender.id)) throw new Error('Favorite operation came from an untrusted renderer.')
  }
  const current = async (requested: unknown) => {
    const normalized = account(requested)
    if (normalized !== account(await options.getCurrentAccountMid())) throw new Error('Favorite operation account changed.')
    return normalized
  }
  const sourceScope = async (requestedAccount: unknown, requestedAids: unknown, requestedSource: unknown, action: 'copy' | 'move' | 'delete' | 'unfavorite') => {
    const normalized = await current(requestedAccount)
    const selected = aids(requestedAids)
    const scope = await options.resolveSourceScope(normalized, rendererSource(requestedSource), selected)
    if ((scope.kind === 'bilibili-default' || scope.kind === 'bilibili-user') && action !== 'copy') {
      throw new Error('This action is not permitted from a Bilibili source folder.')
    }
    return { normalized, selected, scope }
  }
  options.ipcMain.handle('favorite-library-operations:copy', async (event, requestedAccount, requestedAids, requestedTargets, expectedRevision, requestedSource) => {
    trusted(event); const operation = await sourceScope(requestedAccount, requestedAids, requestedSource, 'copy'); return options.batch.copy(operation.normalized, operation.selected, targets(requestedTargets), revision(expectedRevision), operation.scope)
  })
  options.ipcMain.handle('favorite-library-operations:move', async (event, requestedAccount, requestedAids, requestedSourceFolder, requestedTargets, expectedRevision, requestedSource) => {
    trusted(event); const operation = await sourceScope(requestedAccount, requestedAids, requestedSource, 'move'); return options.batch.move(operation.normalized, operation.selected, sourceFolder(requestedSourceFolder), targets(requestedTargets), revision(expectedRevision), operation.scope)
  })
  options.ipcMain.handle('favorite-library-operations:delete-local', async (event, requestedAccount, requestedAids, expectedRevision, requestedSource) => {
    trusted(event); const operation = await sourceScope(requestedAccount, requestedAids, requestedSource, 'delete'); return options.batch.deleteLocal(operation.normalized, operation.selected, revision(expectedRevision), operation.scope)
  })
  options.ipcMain.handle('favorite-library-operations:preview-unfavorite', async (event, requestedAccount, requestedAids, expectedRevision, requestedSource) => {
    trusted(event); const operation = await sourceScope(requestedAccount, requestedAids, requestedSource, 'unfavorite'); return options.batch.previewRemoteUnfavorite(operation.normalized, operation.selected, revision(expectedRevision), operation.scope)
  })
  options.ipcMain.handle('favorite-library-operations:confirm-unfavorite', async (event, requestedAccount, executionToken) => {
    trusted(event); await current(requestedAccount); return { confirmationToken: options.batch.confirmRemoteUnfavorite(token(executionToken)) }
  })
  options.ipcMain.handle('favorite-library-operations:execute-unfavorite', async (event, requestedAccount, executionToken, confirmationToken) => {
    trusted(event); return options.batch.executeRemoteUnfavorite(await current(requestedAccount), token(executionToken), token(confirmationToken))
  })
  options.ipcMain.handle('favorite-library-operations:reconcile-unfavorite', async (event, requestedAccount, operationId) => {
    trusted(event); return options.batch.reconcileRemoteUnfavorite(await current(requestedAccount), token(operationId))
  })
  options.ipcMain.handle('favorite-library-operations:preview-managed-folder-delete', async (event, requestedAccount, folderId) => {
    trusted(event); if (typeof folderId !== 'string') throw new Error('Managed folder is invalid.'); return options.managed.preview(await current(requestedAccount), folderId)
  })
  options.ipcMain.handle('favorite-library-operations:delete-managed-folder-local', async (event, requestedAccount, executionToken) => {
    trusted(event); return options.managed.deleteLocal(await current(requestedAccount), token(executionToken))
  })
  options.ipcMain.handle('favorite-library-operations:confirm-managed-folder-remote-delete', async (event, requestedAccount, executionToken) => {
    trusted(event); await current(requestedAccount); return { confirmationToken: options.managed.confirm(token(executionToken)) }
  })
  options.ipcMain.handle('favorite-library-operations:execute-managed-folder-remote-delete', async (event, requestedAccount, executionToken, confirmationToken) => {
    trusted(event); return options.managed.executeRemote(await current(requestedAccount), token(executionToken), token(confirmationToken))
  })
  options.ipcMain.handle('favorite-library-operations:reconcile-managed-folder-delete', async (event, requestedAccount, operationId) => {
    trusted(event); return options.managed.reconcile(await current(requestedAccount), token(operationId))
  })
}

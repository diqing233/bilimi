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
  if (typeof value !== 'string' || value !== 'local:inbox' && !/^bilimi-logical:\S+$/u.test(value)) throw new Error('Favorite move source is invalid.')
  return value
}

function token(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Favorite operation token is invalid.')
  return value
}

type RendererSource = { kind: 'folder'; folderId: string } | { kind: 'virtual'; eligibleAids: number[]; skippedAids: number[] }
type RendererScopeSelection = {
  kind: 'scope'
  scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' } | { kind: 'protected' } | { kind: 'unsynced' }
  options: { query?: string; filter?: 'all' | 'pending' | 'protected' | 'unsynced'; sort?: 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc'; transcriptionFilters?: Array<'completed' | 'none' | 'pending' | 'running' | 'failed'> }
  excludedAids: number[]
}
type RendererSelection = { kind: 'aids'; aids: number[] } | RendererScopeSelection

function rendererSource(value: unknown): RendererSource {
  if (!value || typeof value !== 'object') throw new Error('Favorite operation source is invalid.')
  const source = value as Record<string, unknown>
  if (source.kind === 'folder' && typeof source.folderId === 'string' && source.folderId.trim()) return { kind: 'folder', folderId: source.folderId.trim() }
  if (source.kind === 'virtual' && Array.isArray(source.eligibleAids) && Array.isArray(source.skippedAids)) {
    return { kind: 'virtual', eligibleAids: aids(source.eligibleAids), skippedAids: source.skippedAids.length ? aids(source.skippedAids) : [] }
  }
  throw new Error('Favorite operation source is invalid.')
}

function rendererSelection(value: unknown): RendererSelection {
  if (Array.isArray(value)) return { kind: 'aids', aids: aids(value) }
  if (!value || typeof value !== 'object') throw new Error('Favorite operation selection is invalid.')
  const selection = value as Record<string, unknown>
  if (selection.kind !== 'scope' || !selection.scope || typeof selection.scope !== 'object' || !selection.options || typeof selection.options !== 'object') {
    throw new Error('Favorite operation selection is invalid.')
  }
  const scope = selection.scope as Record<string, unknown>
  const validScope = scope.kind === 'all' || scope.kind === 'pending' || scope.kind === 'protected' || scope.kind === 'unsynced' ||
    scope.kind === 'folder' && typeof scope.folderId === 'string' && !!scope.folderId.trim()
  if (!validScope || !Array.isArray(selection.excludedAids) || selection.excludedAids.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
    throw new Error('Favorite operation selection is invalid.')
  }
  const options = selection.options as Record<string, unknown>
  const transcriptionFilters = options.transcriptionFilters
  if (transcriptionFilters !== undefined && (!Array.isArray(transcriptionFilters) || transcriptionFilters.length > 5 || transcriptionFilters.some((filter) =>
    !['completed', 'none', 'pending', 'running', 'failed'].includes(String(filter))))) {
    throw new Error('Favorite operation selection is invalid.')
  }
  if ((options.query !== undefined && typeof options.query !== 'string') ||
    (options.filter !== undefined && !['all', 'pending', 'protected', 'unsynced'].includes(String(options.filter))) ||
    (options.sort !== undefined && !['updated-desc', 'updated-asc', 'title-asc', 'title-desc'].includes(String(options.sort)))) {
    throw new Error('Favorite operation selection is invalid.')
  }
  return {
    kind: 'scope', scope: scope.kind === 'folder' ? { kind: 'folder', folderId: scope.folderId as string } : { kind: scope.kind as Exclude<RendererScopeSelection['scope']['kind'], 'folder'> },
    options: { ...(typeof options.query === 'string' ? { query: options.query } : {}), ...(typeof options.filter === 'string' ? { filter: options.filter as RendererScopeSelection['options']['filter'] } : {}), ...(typeof options.sort === 'string' ? { sort: options.sort as RendererScopeSelection['options']['sort'] } : {}), ...(Array.isArray(transcriptionFilters) && transcriptionFilters.length ? { transcriptionFilters: [...new Set(transcriptionFilters as Array<'completed' | 'none' | 'pending' | 'running' | 'failed'>)].sort() } : {}) },
    excludedAids: [...new Set(selection.excludedAids as number[])].sort((left, right) => left - right)
  }
}

/** Registers only account-bound preview, confirmation, execution and reconciliation actions. */
export function registerFavoriteLibraryOperationsIpc(options: {
  ipcMain: IpcMain
  batch: Pick<FavoriteRepositoryBatchOperationService, 'copy' | 'move' | 'deleteLocal' | 'previewRemoteUnfavorite' | 'confirmRemoteUnfavorite' | 'executeRemoteUnfavorite' | 'reconcileRemoteUnfavorite'>
  managed: Pick<FavoriteRepositoryManagedFolderService, 'preview' | 'previewAll' | 'deleteLocal' | 'confirm' | 'executeRemote' | 'reconcile'>
  isTrustedSender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  /** Resolves folder provenance from the current repository snapshot, never renderer labels. */
  resolveSourceScope: (accountMid: string, source: RendererSource, requestedAids: number[]) => Promise<FavoriteOperationSourceScope>
  /** Resolves an all-results selection beside the repository index. */
  resolveSelection?: (accountMid: string, selection: Extract<RendererSelection, { kind: 'scope' }>) => Promise<number[]>
}) {
  const trusted = (event: IpcEvent) => {
    if (!options.isTrustedSender(event.sender.id)) throw new Error('Favorite operation came from an untrusted renderer.')
  }
  const current = async (requested: unknown) => {
    const normalized = account(requested)
    if (normalized !== account(await options.getCurrentAccountMid())) throw new Error('Favorite operation account changed.')
    return normalized
  }
  const sourceScope = async (requestedAccount: unknown, requestedSelection: unknown, requestedSource: unknown, action: 'copy' | 'move' | 'delete' | 'unfavorite') => {
    const normalized = await current(requestedAccount)
    const selection = rendererSelection(requestedSelection)
    const selected = selection.kind === 'aids'
      ? selection.aids
      : await options.resolveSelection?.(normalized, selection) ?? (() => { throw new Error('Favorite scope selection is unavailable.') })()
    await current(normalized)
    if (!Array.isArray(selected) || !selected.length || selected.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) throw new Error('Favorite operation selection is invalid.')
    const scope = await options.resolveSourceScope(normalized, rendererSource(requestedSource), selected)
    await current(normalized)
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
    trusted(event); const normalized = await current(requestedAccount); return { confirmationToken: options.batch.confirmRemoteUnfavorite(normalized, token(executionToken)) }
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
  options.ipcMain.handle('favorite-library-operations:preview-managed-folder-group-delete', async (event, requestedAccount) => {
    trusted(event); return options.managed.previewAll(await current(requestedAccount))
  })
  options.ipcMain.handle('favorite-library-operations:delete-managed-folder-local', async (event, requestedAccount, executionToken) => {
    trusted(event); return options.managed.deleteLocal(await current(requestedAccount), token(executionToken))
  })
  options.ipcMain.handle('favorite-library-operations:confirm-managed-folder-remote-delete', async (event, requestedAccount, executionToken) => {
    trusted(event); const normalized = await current(requestedAccount); return { confirmationToken: options.managed.confirm(normalized, token(executionToken)) }
  })
  options.ipcMain.handle('favorite-library-operations:execute-managed-folder-remote-delete', async (event, requestedAccount, executionToken, confirmationToken) => {
    trusted(event); return options.managed.executeRemote(await current(requestedAccount), token(executionToken), token(confirmationToken))
  })
  options.ipcMain.handle('favorite-library-operations:reconcile-managed-folder-delete', async (event, requestedAccount, operationId) => {
    trusted(event); return options.managed.reconcile(await current(requestedAccount), token(operationId))
  })
}

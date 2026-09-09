import type {
  FavoriteRepositoryPageOperationResult,
  FavoriteRepositoryPageTarget
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'
import { FavoriteRepositoryRemoteRejectedError, type FavoriteRepositoryPageBridge } from './favoriteRepositorySyncService'

export type FavoriteRepositoryRuntimePageBridgeInput = {
  accountMid: string
  operationKey: string
  aid?: number
  folderIds?: string[]
  title?: string
  folderId?: string
}

export type FavoriteRepositoryRuntimePageBridgeOperation = 'append' | 'remove' | 'unfavorite' | 'read-members' | 'read-folder-inventory' | 'read-folder' | 'create-folder' | 'delete-folder' | 'rename-folder'

function normalizedAccountMid(value: string) {
  const raw = value.trim()
  return /^\d+$/.test(raw) && BigInt(raw) > 0n ? BigInt(raw).toString() : ''
}

function bindingKey(accountMid: string, runId: string) {
  return `${normalizedAccountMid(accountMid)}:${runId}`
}

function errorMessage(result: FavoriteRepositoryPageOperationResult) {
  const reason = result.reason?.trim() || 'Favorite repository page bridge did not complete the operation.'
  const diagnostics = [
    Number.isSafeInteger(result.httpStatus) ? `http-status=${result.httpStatus}` : '',
    result.contentType?.trim() ? `content-type=${result.contentType.trim()}` : '',
    result.responseCategory ? `response-category=${result.responseCategory}` : '',
    Number.isSafeInteger(result.bilibiliCode) ? `bilibili-code=${result.bilibiliCode}` : ''
  ].filter(Boolean)
  return diagnostics.length ? `${reason}; ${diagnostics.join('; ')}` : reason
}

function assertResult(result: FavoriteRepositoryPageOperationResult, expectedAccountMid: string) {
  if (result.status === 'unknown') throw new Error(errorMessage(result))
  if (normalizedAccountMid(result.observedAccountMid) !== normalizedAccountMid(expectedAccountMid)) {
    throw new Error('Favorite sync page bridge account changed during execution.')
  }
  if (result.status === 'ok') return
  // This label is reserved for a future Bilibili response proven not to mutate state.
  if (result.reason === 'known-unapplied-remote-rejection') {
    throw new FavoriteRepositoryRemoteRejectedError(errorMessage(result))
  }
  throw new Error(errorMessage(result))
}

export class FavoriteRepositoryRuntimePageBridgeManager {
  private readonly bindings = new Map<string, FavoriteRepositoryPageTarget>()

  constructor(private readonly request: <T>(request: {
    type: 'favorite-repository-bind-page-target' | 'favorite-repository-page-operation' | 'begin-managed-folder-deletion-refresh-deferral' | 'end-managed-folder-deletion-refresh-deferral'
    accountMid: string
    runId: string
    target?: FavoriteRepositoryPageTarget
    action?: FavoriteRepositoryRuntimePageBridgeOperation
    input?: FavoriteRepositoryRuntimePageBridgeInput
  }) => Promise<T>) {}

  async bind(accountMid: string, runId: string) {
    const account = normalizedAccountMid(accountMid)
    if (this.bindings.has(bindingKey(account, runId))) return
    const result = await this.request<FavoriteRepositoryPageOperationResult>({
      type: 'favorite-repository-bind-page-target', accountMid: account, runId
    })
    assertResult(result, account)
    if (!result.target) throw new Error('Favorite sync page target is unavailable.')
    this.bindings.set(bindingKey(account, runId), result.target)
  }

  async beginManagedFolderDeletionRefreshDeferral(accountMid: string, runId: string) {
    const account = normalizedAccountMid(accountMid)
    const target = this.bindings.get(bindingKey(account, runId))
    if (!target) throw new Error('Favorite sync page target is unavailable.')
    const result = await this.request<FavoriteRepositoryPageOperationResult>({
      type: 'begin-managed-folder-deletion-refresh-deferral', accountMid: account, runId, target
    })
    assertResult(result, account)
  }

  async endManagedFolderDeletionRefreshDeferral(accountMid: string, runId: string) {
    const account = normalizedAccountMid(accountMid)
    const result = await this.request<{ observedAccountMid?: string; refreshDeferred?: boolean }>({
      type: 'end-managed-folder-deletion-refresh-deferral', accountMid: account, runId
    })
    if (result.observedAccountMid !== undefined && normalizedAccountMid(result.observedAccountMid) !== account) {
      throw new Error('Favorite sync page bridge account changed during execution.')
    }
    return { refreshDeferred: result.refreshDeferred === true }
  }

  pageBridge(accountMid: string, runId: string): FavoriteRepositoryPageBridge & {
    unfavorite(input: { accountMid: string; operationKey: string; aid: number }): Promise<{ observedAccountMid: string }>
  } {
    const account = normalizedAccountMid(accountMid)
    const target = this.bindings.get(bindingKey(account, runId))
    const request = this.request
    const execute = async (action: FavoriteRepositoryRuntimePageBridgeOperation, input: FavoriteRepositoryRuntimePageBridgeInput) => {
      if (!target) throw new Error('Favorite sync page target is unavailable.')
      if (normalizedAccountMid(input.accountMid) !== account) throw new Error('Favorite sync page bridge account mismatch.')
      const result = await request<FavoriteRepositoryPageOperationResult>({
        type: 'favorite-repository-page-operation', accountMid: account, runId, target, action, input
      })
      assertResult(result, account)
      return result
    }
    return {
      async append(input) {
        const result = await execute('append', input)
        return { observedAccountMid: result.observedAccountMid }
      },
      async remove(input) {
        const result = await execute('remove', input)
        return { observedAccountMid: result.observedAccountMid }
      },
      async unfavorite(input) {
        const result = await execute('unfavorite', input)
        return { observedAccountMid: result.observedAccountMid }
      },
      async readMembers(input) {
        const result = await execute('read-members', input)
        if (!result.members) throw new Error('Favorite repository page bridge returned incomplete members.')
        return { observedAccountMid: result.observedAccountMid, members: result.members }
      },
      async readFolderInventory(input) {
        const result = await execute('read-folder-inventory', input)
        if (!result.folders) throw new Error('Favorite repository page bridge returned incomplete folder inventory.')
        return { observedAccountMid: result.observedAccountMid, folders: result.folders }
      },
      async readFolder(input) {
        const result = await execute('read-folder', input)
        if (!result.folder) throw new Error('Favorite repository page bridge returned incomplete remote folder.')
        return { observedAccountMid: result.observedAccountMid, folder: result.folder }
      },
      async createFolder(input) {
        const result = await execute('create-folder', input)
        if (!result.folder) throw new Error('Favorite repository page bridge returned incomplete created folder.')
        return { observedAccountMid: result.observedAccountMid, folder: result.folder }
      },
      async deleteFolder(input) {
        if (!target) throw new Error('Favorite sync page target is unavailable.')
        if (normalizedAccountMid(input.accountMid) !== account) throw new Error('Favorite sync page bridge account mismatch.')
        const result = await request<FavoriteRepositoryPageOperationResult>({
          type: 'favorite-repository-page-operation', accountMid: account, runId, target,
          action: 'delete-folder', input
        })
        if (normalizedAccountMid(result.observedAccountMid) !== account) {
          throw new Error('Favorite sync page bridge account changed during execution.')
        }
        if (result.status === 'ok') return { observedAccountMid: result.observedAccountMid }
        return {
          observedAccountMid: result.observedAccountMid,
          status: result.status,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(Number.isSafeInteger(result.httpStatus) ? { httpStatus: result.httpStatus } : {}),
          ...(result.contentType ? { contentType: result.contentType } : {}),
          ...(result.responseCategory ? { responseCategory: result.responseCategory } : {}),
          ...(Number.isSafeInteger(result.bilibiliCode) ? { bilibiliCode: result.bilibiliCode } : {})
        }
      },
      async renameFolder(input) {
        // Rename is the only mutation whose caller must distinguish a known
        // rejection from an ambiguous remote result before deciding whether
        // to commit a formal repository binding. Preserve that result instead
        // of letting the generic operation assertion erase its stage fields.
        if (!target) throw new Error('Favorite sync page target is unavailable.')
        if (normalizedAccountMid(input.accountMid) !== account) throw new Error('Favorite sync page bridge account mismatch.')
        const result = await request<FavoriteRepositoryPageOperationResult>({
          type: 'favorite-repository-page-operation', accountMid: account, runId, target,
          action: 'rename-folder', input
        })
        if (normalizedAccountMid(result.observedAccountMid) !== account) {
          throw new Error('Favorite sync page bridge account changed during execution.')
        }
        if (result.status === 'ok') return { observedAccountMid: result.observedAccountMid }
        return {
          observedAccountMid: result.observedAccountMid,
          status: result.status,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(Number.isSafeInteger(result.httpStatus) ? { httpStatus: result.httpStatus } : {}),
          ...(result.contentType ? { contentType: result.contentType } : {}),
          ...(result.responseCategory ? { responseCategory: result.responseCategory } : {}),
          ...(Number.isSafeInteger(result.bilibiliCode) ? { bilibiliCode: result.bilibiliCode } : {})
        }
      }
    }
  }

  release(accountMid: string, runId: string) {
    this.bindings.delete(bindingKey(accountMid, runId))
  }
}

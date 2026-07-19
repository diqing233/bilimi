import type {
  FavoriteRepositoryPageOperationResult,
  FavoriteRepositoryPageTarget
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'
import { FavoriteRepositoryRemoteRejectedError, type FavoriteRepositoryPageBridge } from './favoriteRepositorySyncService'

export type FavoriteRepositoryRuntimePageBridgeInput = {
  accountMid: string
  operationKey: string
  aid: number
  folderIds: string[]
}

export type FavoriteRepositoryRuntimePageBridgeOperation = 'append' | 'remove' | 'read-members'

function normalizedAccountMid(value: string) {
  const raw = value.trim()
  return /^\d+$/.test(raw) && BigInt(raw) > 0n ? BigInt(raw).toString() : ''
}

function bindingKey(accountMid: string, runId: string) {
  return `${normalizedAccountMid(accountMid)}:${runId}`
}

function errorMessage(result: FavoriteRepositoryPageOperationResult) {
  return result.reason?.trim() || 'Favorite repository page bridge did not complete the operation.'
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
    type: 'favorite-repository-bind-page-target' | 'favorite-repository-page-operation'
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

  pageBridge(accountMid: string, runId: string): FavoriteRepositoryPageBridge {
    const account = normalizedAccountMid(accountMid)
    const target = this.bindings.get(bindingKey(account, runId))
    const execute = async (action: FavoriteRepositoryRuntimePageBridgeOperation, input: FavoriteRepositoryRuntimePageBridgeInput) => {
      if (!target) throw new Error('Favorite sync page target is unavailable.')
      if (normalizedAccountMid(input.accountMid) !== account) throw new Error('Favorite sync page bridge account mismatch.')
      const result = await this.request<FavoriteRepositoryPageOperationResult>({
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
      async readMembers(input) {
        const result = await execute('read-members', input)
        if (!result.members) throw new Error('Favorite repository page bridge returned incomplete members.')
        return { observedAccountMid: result.observedAccountMid, members: result.members }
      }
    }
  }

  release(accountMid: string, runId: string) {
    this.bindings.delete(bindingKey(accountMid, runId))
  }
}

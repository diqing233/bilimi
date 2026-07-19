import type { ApplyWorkspaceClassificationBatchOptions } from '../../src/shared/oldFavoriteWorkspace'
import {
  OldFavoriteWorkspaceCoordinator,
  type OldFavoriteWorkspaceRecoveryRequired
} from './oldFavoriteWorkspaceCoordinator'

type IpcEvent = { sender: { id: number } }
type IpcMain = { handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void }

type WorkspaceCommand =
  | { type: 'select-segment'; segmentId: string }
  | { type: 'apply-classifications'; source: 'manual'; assignments: Array<{ aid: number; targetLedgerIds: string[] }> }
  | { type: 'freeze-segment'; segmentId: string }

function normalizeAccountMid(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) {
    throw new Error('Old favorite workspace account is invalid.')
  }
  return BigInt(value.trim()).toString()
}

function validAssignments(value: unknown): value is ApplyWorkspaceClassificationBatchOptions['assignments'] {
  return Array.isArray(value) && value.every((assignment) => {
    if (!assignment || typeof assignment !== 'object') return false
    const candidate = assignment as { aid?: unknown; targetLedgerIds?: unknown }
    return Number.isSafeInteger(candidate.aid) && Number(candidate.aid) > 0 &&
      Array.isArray(candidate.targetLedgerIds) && candidate.targetLedgerIds.every((id) => typeof id === 'string' && !!id.trim())
  })
}

function command(value: unknown): WorkspaceCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Old favorite workspace command is invalid.')
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'select-segment' && typeof candidate.segmentId === 'string' && candidate.segmentId.trim()) {
    return { type: 'select-segment', segmentId: candidate.segmentId.trim() }
  }
  if (candidate.type === 'freeze-segment' && typeof candidate.segmentId === 'string' && candidate.segmentId.trim()) {
    return { type: 'freeze-segment', segmentId: candidate.segmentId.trim() }
  }
  if (candidate.type === 'apply-classifications' && candidate.source === 'manual' && validAssignments(candidate.assignments)) {
    return { type: 'apply-classifications', source: 'manual', assignments: candidate.assignments }
  }
  throw new Error('Old favorite workspace command is invalid.')
}

export function registerOldFavoriteWorkspaceCoordinatorIpc(options: {
  ipcMain: IpcMain
  coordinator: OldFavoriteWorkspaceCoordinator
  isTrustedSender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
}) {
  const assertAccount = async (event: IpcEvent, requestedAccountMid: unknown) => {
    if (!options.isTrustedSender(event.sender.id)) throw new Error('Old favorite workspace request came from an untrusted renderer.')
    const accountMid = normalizeAccountMid(requestedAccountMid)
    if (normalizeAccountMid(await options.getCurrentAccountMid()) !== accountMid) {
      throw new Error('Old favorite workspace request does not match the current Bilibili account.')
    }
    return accountMid
  }
  const snapshot = async (value: Awaited<ReturnType<OldFavoriteWorkspaceCoordinator['getSnapshot']>>) => value
  options.ipcMain.handle('old-favorite-workspace-v1:open', async (event, requestedAccountMid: string) => {
    return snapshot(await options.coordinator.getSnapshot(await assertAccount(event, requestedAccountMid)))
  })
  options.ipcMain.handle('old-favorite-workspace-v1:command', async (event, requestedAccountMid: string, value: unknown) => {
    const accountMid = await assertAccount(event, requestedAccountMid)
    const requested = command(value)
    if (requested.type === 'select-segment') await options.coordinator.selectSegment(accountMid, requested.segmentId)
    if (requested.type === 'freeze-segment') await options.coordinator.freezeSegment(accountMid, requested.segmentId)
    if (requested.type === 'apply-classifications') await options.coordinator.applyClassificationBatch(accountMid, {
      source: requested.source,
      assignments: requested.assignments
    })
    return options.coordinator.getSnapshot(accountMid)
  })
}

export type { OldFavoriteWorkspaceRecoveryRequired }

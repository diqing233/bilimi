import type {
  ApplyWorkspaceClassificationBatchOptions,
  OldFavoriteWorkspaceRecoveryRequired
} from '../../src/shared/oldFavoriteWorkspace'
import {
  OldFavoriteWorkspaceCoordinator
} from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceDeepSeekService } from './oldFavoriteWorkspaceDeepSeekService'

type IpcEvent = { sender: { id: number } }
type IpcMain = { handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void }

type WorkspaceCommand =
  | { type: 'start-scan'; mode: 'incremental' | 'full' }
  | { type: 'select-source-folders'; folderIds: string[] }
  | { type: 'select-segment'; segmentId: string }
  | { type: 'undo-classification' }
  | { type: 'redo-classification' }
  | { type: 'auto-classify-current-segment' }
  | { type: 'apply-classifications'; source: 'manual'; assignments: Array<{ aid: number; targetLedgerIds: string[] }> }
  | { type: 'freeze-segment'; segmentId: string }
  | { type: 'save-current-segment-locally' }
  | { type: 'freeze-bilibili-execution' }
  | { type: 'execute-frozen-bilibili-plan' }
  | { type: 'reconcile-frozen-bilibili-plan' }
  | { type: 'resume-reconciled-bilibili-plan' }

function normalizeAccountMid(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) {
    throw new Error('Old favorite workspace account is invalid.')
  }
  return BigInt(value.trim()).toString()
}

function validAssignments(value: unknown): value is ApplyWorkspaceClassificationBatchOptions['assignments'] {
  return Array.isArray(value) && value.length <= 2_000 && value.every((assignment) => {
    if (!assignment || typeof assignment !== 'object') return false
    const candidate = assignment as { aid?: unknown; targetLedgerIds?: unknown }
    return Number.isSafeInteger(candidate.aid) && Number(candidate.aid) > 0 &&
      Array.isArray(candidate.targetLedgerIds) && candidate.targetLedgerIds.length <= 3 &&
      candidate.targetLedgerIds.every((id) => typeof id === 'string' && !!id.trim() && id.trim().length <= 128)
  })
}

function command(value: unknown): WorkspaceCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Old favorite workspace command is invalid.')
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'start-scan' && (candidate.mode === 'incremental' || candidate.mode === 'full') &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'mode')) {
    return { type: 'start-scan', mode: candidate.mode }
  }
  if (candidate.type === 'select-source-folders' && Array.isArray(candidate.folderIds) &&
    candidate.folderIds.length <= 500 && candidate.folderIds.every((id) => typeof id === 'string' && id.trim().length > 0 && id.trim().length <= 128) &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'folderIds')) {
    return { type: 'select-source-folders', folderIds: [...new Set(candidate.folderIds.map((id) => id.trim()))].sort() }
  }
  if (candidate.type === 'select-segment' && typeof candidate.segmentId === 'string' && candidate.segmentId.trim()) {
    return { type: 'select-segment', segmentId: candidate.segmentId.trim() }
  }
  if ((candidate.type === 'undo-classification' || candidate.type === 'redo-classification') &&
    Object.keys(candidate).length === 1) {
    return { type: candidate.type }
  }
  if (candidate.type === 'auto-classify-current-segment' && Object.keys(candidate).length === 1) {
    return { type: 'auto-classify-current-segment' }
  }
  if (candidate.type === 'freeze-segment' && typeof candidate.segmentId === 'string' && candidate.segmentId.trim()) {
    return { type: 'freeze-segment', segmentId: candidate.segmentId.trim() }
  }
  if (candidate.type === 'freeze-bilibili-execution' && Object.keys(candidate).length === 1) {
    return { type: 'freeze-bilibili-execution' }
  }
  if (candidate.type === 'save-current-segment-locally' && Object.keys(candidate).length === 1) {
    return { type: 'save-current-segment-locally' }
  }
  if (candidate.type === 'execute-frozen-bilibili-plan' && Object.keys(candidate).length === 1) {
    return { type: 'execute-frozen-bilibili-plan' }
  }
  if (candidate.type === 'reconcile-frozen-bilibili-plan' && Object.keys(candidate).length === 1) {
    return { type: 'reconcile-frozen-bilibili-plan' }
  }
  if (candidate.type === 'resume-reconciled-bilibili-plan' && Object.keys(candidate).length === 1) {
    return { type: 'resume-reconciled-bilibili-plan' }
  }
  if (candidate.type === 'apply-classifications' && candidate.source === 'manual' && validAssignments(candidate.assignments) &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'source' || key === 'assignments')) {
    return { type: 'apply-classifications', source: 'manual', assignments: candidate.assignments }
  }
  throw new Error('Old favorite workspace command is invalid.')
}

export function registerOldFavoriteWorkspaceCoordinatorIpc(options: {
  ipcMain: IpcMain
  coordinator: OldFavoriteWorkspaceCoordinator
  deepSeekService?: Pick<OldFavoriteWorkspaceDeepSeekService, 'organizeCurrentSegment'>
  isTrustedSender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  startScan?: (accountMid: string, mode: 'incremental' | 'full') => Promise<Awaited<ReturnType<OldFavoriteWorkspaceCoordinator['getSnapshot']>>>
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
  options.ipcMain.handle('old-favorite-workspace-v1:deepseek-current-segment', async (event, requestedAccountMid: string, ...args: unknown[]) => {
    if (args.length !== 0) throw new Error('Old favorite workspace DeepSeek arguments are invalid.')
    if (!options.deepSeekService) throw new Error('Old favorite workspace DeepSeek service is unavailable.')
    return snapshot(await options.deepSeekService.organizeCurrentSegment(await assertAccount(event, requestedAccountMid)))
  })
  options.ipcMain.handle('old-favorite-workspace-v1:command', async (event, requestedAccountMid: string, value: unknown) => {
    const accountMid = await assertAccount(event, requestedAccountMid)
    const requested = command(value)
    if (requested.type === 'start-scan') return options.startScan
      ? options.startScan(accountMid, requested.mode)
      : options.coordinator.beginScan(accountMid, requested.mode)
    if (requested.type === 'select-source-folders') await options.coordinator.selectSourceFolders(accountMid, requested.folderIds)
    if (requested.type === 'select-segment') await options.coordinator.selectSegment(accountMid, requested.segmentId)
    if (requested.type === 'undo-classification') await options.coordinator.undoClassificationChange(accountMid)
    if (requested.type === 'redo-classification') await options.coordinator.redoClassificationChange(accountMid)
    if (requested.type === 'auto-classify-current-segment') await options.coordinator.autoClassifyCurrentSegment(accountMid)
    if (requested.type === 'freeze-segment') await options.coordinator.freezeSegment(accountMid, requested.segmentId)
    if (requested.type === 'save-current-segment-locally') await options.coordinator.saveCurrentSegmentToLocalLibrary(accountMid)
    if (requested.type === 'freeze-bilibili-execution') await options.coordinator.freezeForBilibiliExecution(accountMid)
    if (requested.type === 'execute-frozen-bilibili-plan') await options.coordinator.executeFrozenBilibiliPlan(accountMid)
    if (requested.type === 'reconcile-frozen-bilibili-plan') await options.coordinator.bindAndReconcileFrozenBilibiliPlan(accountMid)
    if (requested.type === 'resume-reconciled-bilibili-plan') await options.coordinator.resumeReconciledBilibiliPlan(accountMid)
    if (requested.type === 'apply-classifications') await options.coordinator.applyClassificationBatch(accountMid, {
      source: requested.source,
      assignments: requested.assignments
    })
    return options.coordinator.getSnapshot(accountMid)
  })
}

export type { OldFavoriteWorkspaceRecoveryRequired }

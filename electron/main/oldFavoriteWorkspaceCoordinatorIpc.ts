import type {
  ApplyWorkspaceClassificationBatchOptions,
  OldFavoriteWorkspaceRecoveryRequired
} from '../../src/shared/oldFavoriteWorkspace'
import type { DeepSeekArchiveMode } from '../../src/shared/types'
import {
  OldFavoriteWorkspaceCoordinator
} from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceDeepSeekService } from './oldFavoriteWorkspaceDeepSeekService'

type IpcEvent = {
  sender: {
    id: number
    send: (channel: 'old-favorite-workspace-v1:deepseek-progress', progress: {
      accountMid: string
      workspaceId: string
      totalChunks: number
      completedChunks: number
      totalVideoCount: number
      successfulVideoCount: number
      failedVideoCount: number
    }) => void
  }
}
type IpcMain = { handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void }

type WorkspaceCommand =
  | { type: 'start-scan'; mode: 'incremental' | 'full'; clearBilibiliMirror?: boolean }
  | { type: 'rebuild-corrupt-workspace' }
  | { type: 'select-source-folders'; folderIds: string[] }
  | { type: 'select-segment'; segmentId: string }
  | { type: 'undo-classification' }
  | { type: 'redo-classification' }
  | { type: 'pause-tag-enrichment' }
  | { type: 'resume-tag-enrichment' }
  | { type: 'retry-failed-tag-enrichment' }
  | { type: 'accept-current-tags' }
  | { type: 'cancel-deepseek-current-segment' }
  | { type: 'move-history-cursor'; cursor: number }
  | { type: 'auto-classify-current-segment' }
  | { type: 'reclassify-favorite-configuration' }
  | { type: 'set-recommended-candidates'; candidateIds: string[] }
  | { type: 'create-local-ledger-and-reclassify'; title: string }
  | { type: 'apply-classifications'; source: 'manual'; assignments: Array<{ aid: number; targetLedgerIds: string[] }> }
  | { type: 'freeze-segment'; segmentId: string }
  | { type: 'save-current-segment-locally' }
  | { type: 'abandon-current-workspace' }
  | { type: 'freeze-bilibili-execution' }
  | { type: 'confirm-and-execute-bilibili-plan' }
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
    Object.keys(candidate).every((key) => key === 'type' || key === 'mode' || key === 'clearBilibiliMirror') &&
    (candidate.clearBilibiliMirror === undefined || (candidate.mode === 'full' && candidate.clearBilibiliMirror === true))) {
    return candidate.clearBilibiliMirror ? { type: 'start-scan', mode: candidate.mode, clearBilibiliMirror: true } : { type: 'start-scan', mode: candidate.mode }
  }
  if (candidate.type === 'rebuild-corrupt-workspace' && Object.keys(candidate).length === 1) {
    return { type: 'rebuild-corrupt-workspace' }
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
  if ((candidate.type === 'pause-tag-enrichment' || candidate.type === 'resume-tag-enrichment' || candidate.type === 'retry-failed-tag-enrichment' || candidate.type === 'accept-current-tags') &&
    Object.keys(candidate).length === 1) {
    return { type: candidate.type }
  }
  if (candidate.type === 'cancel-deepseek-current-segment' && Object.keys(candidate).length === 1) {
    return { type: 'cancel-deepseek-current-segment' }
  }
  if (candidate.type === 'move-history-cursor' && Number.isSafeInteger(candidate.cursor) && candidate.cursor >= 0 &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'cursor')) {
    return { type: 'move-history-cursor', cursor: candidate.cursor }
  }
  if (candidate.type === 'auto-classify-current-segment' && Object.keys(candidate).length === 1) {
    return { type: 'auto-classify-current-segment' }
  }
  if (candidate.type === 'reclassify-favorite-configuration' && Object.keys(candidate).length === 1) {
    return { type: 'reclassify-favorite-configuration' }
  }
  if (candidate.type === 'set-recommended-candidates' && Array.isArray(candidate.candidateIds) &&
    candidate.candidateIds.length <= 32 && candidate.candidateIds.every((id) => typeof id === 'string' && id.trim().length > 0 && id.trim().length <= 128) &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'candidateIds')) {
    return { type: 'set-recommended-candidates', candidateIds: [...new Set(candidate.candidateIds.map((id) => id.trim()))].sort() }
  }
  if (candidate.type === 'create-local-ledger-and-reclassify' && typeof candidate.title === 'string' &&
    candidate.title.trim().length > 0 && candidate.title.trim().length <= 128 && Object.keys(candidate).every((key) => key === 'type' || key === 'title')) {
    return { type: 'create-local-ledger-and-reclassify', title: candidate.title.trim() }
  }
  if (candidate.type === 'freeze-segment' && typeof candidate.segmentId === 'string' && candidate.segmentId.trim()) {
    return { type: 'freeze-segment', segmentId: candidate.segmentId.trim() }
  }
  if (candidate.type === 'freeze-bilibili-execution' && Object.keys(candidate).length === 1) {
    return { type: 'freeze-bilibili-execution' }
  }
  if (candidate.type === 'confirm-and-execute-bilibili-plan' && Object.keys(candidate).length === 1) {
    return { type: 'confirm-and-execute-bilibili-plan' }
  }
  if (candidate.type === 'save-current-segment-locally' && Object.keys(candidate).length === 1) {
    return { type: 'save-current-segment-locally' }
  }
  if (candidate.type === 'abandon-current-workspace' && Object.keys(candidate).length === 1) {
    return { type: 'abandon-current-workspace' }
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
  deepSeekService?: Pick<OldFavoriteWorkspaceDeepSeekService, 'organizeCurrentSegment' | 'retryFailedChunks' | 'cancelCurrentSegment'>
  isTrustedSender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  startScan?: (accountMid: string, mode: 'incremental' | 'full', options?: { clearBilibiliMirror?: boolean }) => Promise<Awaited<ReturnType<OldFavoriteWorkspaceCoordinator['getSnapshot']>>>
  resumeTagEnrichment?: (accountMid: string) => Promise<void>
  retryFailedTagEnrichment?: (accountMid: string) => Promise<void>
  rebuildAndStartScan?: (accountMid: string) => Promise<Awaited<ReturnType<OldFavoriteWorkspaceCoordinator['getSnapshot']>>>
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
  options.ipcMain.handle('old-favorite-workspace-v1:managed-folder-deletion-preview', async (event, requestedAccountMid: string, ledgerIds: string[]) => {
    const accountMid = await assertAccount(event, requestedAccountMid)
    if (!Array.isArray(ledgerIds) || ledgerIds.some((id) => typeof id !== 'string' || !id.trim())) throw new Error('Old favorite workspace deletion preview is invalid.')
    return options.coordinator.previewManagedFolderDeletion(accountMid, ledgerIds)
  })
  options.ipcMain.handle('old-favorite-workspace-v1:delete-managed-folders', async (event, requestedAccountMid: string, ledgerIds: string[]) => {
    const accountMid = await assertAccount(event, requestedAccountMid)
    if (!Array.isArray(ledgerIds) || ledgerIds.some((id) => typeof id !== 'string' || !id.trim())) throw new Error('Old favorite workspace deletion request is invalid.')
    return options.coordinator.deleteManagedFolderCandidates(accountMid, ledgerIds)
  })
  options.ipcMain.handle('old-favorite-workspace-v1:deepseek-current-segment', async (event, requestedAccountMid: string, mode?: DeepSeekArchiveMode, ...args: unknown[]) => {
    if (args.length !== 0 || (mode !== undefined && !['all', 'classified-only', 'unclassified-only', 'low-confidence-and-unclassified'].includes(mode))) throw new Error('Old favorite workspace DeepSeek arguments are invalid.')
    if (!options.deepSeekService) throw new Error('Old favorite workspace DeepSeek service is unavailable.')
    const accountMid = await assertAccount(event, requestedAccountMid)
    const workspace = await options.coordinator.getSnapshot(accountMid)
    if (!workspace || 'recovery' in workspace) throw new Error('Old favorite workspace is not ready for DeepSeek classification.')
    const workspaceId = workspace.workspaceId
    return snapshot(await options.deepSeekService.organizeCurrentSegment(accountMid, mode ?? 'all', (progress) => {
      event.sender.send('old-favorite-workspace-v1:deepseek-progress', { accountMid, workspaceId, ...progress })
    }))
  })
  options.ipcMain.handle('old-favorite-workspace-v1:retry-failed-deepseek', async (event, requestedAccountMid: string, ...args: unknown[]) => {
    if (args.length !== 0) throw new Error('Old favorite workspace DeepSeek arguments are invalid.')
    if (!options.deepSeekService) throw new Error('Old favorite workspace DeepSeek service is unavailable.')
    const accountMid = await assertAccount(event, requestedAccountMid)
    const workspace = await options.coordinator.getSnapshot(accountMid)
    if (!workspace || 'recovery' in workspace) throw new Error('Old favorite workspace is not ready for DeepSeek classification.')
    const workspaceId = workspace.workspaceId
    return snapshot(await options.deepSeekService.retryFailedChunks(accountMid, (progress) => {
      event.sender.send('old-favorite-workspace-v1:deepseek-progress', { accountMid, workspaceId, ...progress })
    }))
  })
  options.ipcMain.handle('old-favorite-workspace-v1:command', async (event, requestedAccountMid: string, value: unknown) => {
    const accountMid = await assertAccount(event, requestedAccountMid)
    const requested = command(value)
    if (requested.type === 'start-scan') return options.startScan
      ? requested.clearBilibiliMirror
        ? options.startScan(accountMid, requested.mode, { clearBilibiliMirror: true })
        : options.startScan(accountMid, requested.mode)
      : requested.clearBilibiliMirror
        ? options.coordinator.beginScan(accountMid, requested.mode, { clearBilibiliMirror: true })
        : options.coordinator.beginScan(accountMid, requested.mode)
    if (requested.type === 'rebuild-corrupt-workspace') return options.rebuildAndStartScan
      ? options.rebuildAndStartScan(accountMid)
      : options.coordinator.rebuildAfterRecovery(accountMid)
    if (requested.type === 'select-source-folders') await options.coordinator.selectSourceFolders(accountMid, requested.folderIds)
    if (requested.type === 'select-segment') await options.coordinator.selectSegment(accountMid, requested.segmentId)
    if (requested.type === 'undo-classification') await options.coordinator.undoClassificationChange(accountMid)
    if (requested.type === 'redo-classification') await options.coordinator.redoClassificationChange(accountMid)
    if (requested.type === 'pause-tag-enrichment') await options.coordinator.pauseTagEnrichment(accountMid)
    if (requested.type === 'resume-tag-enrichment') {
      if (options.resumeTagEnrichment) await options.resumeTagEnrichment(accountMid)
      else await options.coordinator.resumeTagEnrichment(accountMid)
    }
    if (requested.type === 'retry-failed-tag-enrichment') {
      if (options.retryFailedTagEnrichment) await options.retryFailedTagEnrichment(accountMid)
      else await options.coordinator.retryFailedTagEnrichment(accountMid)
    }
    if (requested.type === 'accept-current-tags') await options.coordinator.acceptCurrentTags(accountMid)
    if (requested.type === 'cancel-deepseek-current-segment') {
      if (!options.deepSeekService) throw new Error('Old favorite workspace DeepSeek service is unavailable.')
      options.deepSeekService.cancelCurrentSegment(accountMid)
    }
    if (requested.type === 'move-history-cursor') await options.coordinator.moveHistoryCursor(accountMid, requested.cursor)
    if (requested.type === 'auto-classify-current-segment') await options.coordinator.autoClassifyCurrentSegment(accountMid)
    if (requested.type === 'reclassify-favorite-configuration') await options.coordinator.reclassifyForFavoriteConfiguration(accountMid)
    if (requested.type === 'set-recommended-candidates') await options.coordinator.setRecommendedCandidates(accountMid, requested.candidateIds)
    if (requested.type === 'create-local-ledger-and-reclassify') await options.coordinator.createLocalLedgerAndReclassify(accountMid, requested.title)
    if (requested.type === 'freeze-segment') await options.coordinator.freezeSegment(accountMid, requested.segmentId)
    if (requested.type === 'save-current-segment-locally') await options.coordinator.saveCurrentSegmentToLocalLibrary(accountMid)
    if (requested.type === 'abandon-current-workspace') await options.coordinator.abandonCurrentWorkspace(accountMid)
    if (requested.type === 'freeze-bilibili-execution') await options.coordinator.freezeForBilibiliExecution(accountMid)
    if (requested.type === 'confirm-and-execute-bilibili-plan') return options.coordinator.beginBilibiliExecution(accountMid)
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

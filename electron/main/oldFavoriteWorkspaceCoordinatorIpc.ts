import {
  MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE,
  type ApplyWorkspaceClassificationBatchOptions,
  type OldFavoriteWorkspaceRecoveryRequired,
  type OldFavoriteWorkspaceRecoverySummary
} from '../../src/shared/oldFavoriteWorkspace'
import type { DeepSeekArchiveMode, DeepSeekArchiveScope } from '../../src/shared/types'
import {
  OLD_FAVORITE_WORKSPACE_TAG_ADOPTION_FAILURE_PERSISTED,
  OldFavoriteWorkspaceCoordinator,
  isOldFavoriteWorkspaceRecoveryDecisionStaleError
} from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceDeepSeekService } from './oldFavoriteWorkspaceDeepSeekService'
import type { FavoriteLibraryScopeSelection } from './favoriteLibraryCommands'

type IpcEvent = {
  sender: {
    id: number
    send: (channel: 'old-favorite-workspace-v1:deepseek-progress' | 'old-favorite-workspace-v1:preview-preparation-progress' | 'old-favorite-workspace-v1:rule-analysis-progress', progress: {
      accountMid: string
      workspaceId: string
      analysisId?: string
      totalChunks?: number
      completedChunks?: number
      totalVideoCount?: number
      successfulVideoCount?: number
      failedVideoCount?: number
      completedItemCount?: number
      totalItemCount?: number
    }) => void
  }
}
type IpcMain = { handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void }

type WorkspaceRecoverySummary = OldFavoriteWorkspaceRecoverySummary

type WorkspaceCommand =
  | { type: 'start-scan'; mode: 'incremental' | 'full'; clearBilibiliMirror?: boolean }
  | { type: 'start-selected-reorganization'; aids: number[] }
  | { type: 'start-selected-reorganization'; selection: FavoriteLibraryScopeSelection }
  | { type: 'resume-scan' }
  | { type: 'pause-scan' }
  | { type: 'rebuild-corrupt-workspace' }
  | { type: 'select-source-folders'; folderIds: string[] }
  | { type: 'select-segment'; segmentId: string }
  | { type: 'view-segment'; segmentId: string }
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
  | { type: 'refresh-relationship-projection' }
  | { type: 'set-recommended-candidates'; candidateIds: string[] }
  | { type: 'set-round-excluded-ledger-ids'; ledgerIds: string[] }
  | { type: 'prepare-recommendation-preview'; candidateIds: string[] }
  | { type: 'cancel-recommendation-preview-preparation' }
  | { type: 'create-local-ledger-and-reclassify'; title: string }
  | {
      type: 'save-draft-ledger-rule'
      analysisId: string
      ledgerId?: string
      title: string
      keywords: string[]
      ruleType: 'keyword' | 'author' | 'tag'
      adopt?: boolean
    }
  | { type: 'cancel-draft-ledger-rule-analysis'; analysisId: string }
  | { type: 'apply-classifications'; source: 'manual'; assignments: Array<{ aid: number; targetLedgerIds: string[] }> }
  | { type: 'freeze-segment'; segmentId: string }
  | { type: 'save-current-segment-locally' }
  | { type: 'set-whole-run-execution-intent'; mode: 'local' | 'bilibili'; includeInbox?: boolean }
  | { type: 'cancel-whole-run-execution-intent' }
  | { type: 'use-original-classifications-for-failed-deepseek' }
  | {
      type: 'select-recovery-decision'
      workspaceId: string
      choice: 'continue-original' | 'merge-latest' | 'rescan'
      expectedBaselineRevision: number
      expectedRepositoryRevision: number
    }
  | { type: 'abandon-current-workspace' }
  | { type: 'freeze-bilibili-execution' }
  | { type: 'confirm-and-execute-bilibili-plan'; includeInbox?: boolean }
  | { type: 'execute-frozen-bilibili-plan' }
  | { type: 'pause-bilibili-sync' }
  | { type: 'stop-bilibili-sync-and-finish' }
  | { type: 'reconcile-frozen-bilibili-plan' }
  | { type: 'resume-reconciled-bilibili-plan' }

function normalizeAccountMid(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) {
    throw new Error('Old favorite workspace account is invalid.')
  }
  return BigInt(value.trim()).toString()
}

function validRemoteDraftDeletionTargets(value: unknown): value is Record<string, { remoteFolderId: string; title: string }> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.entries(value as Record<string, unknown>).length <= 500 &&
    Object.entries(value as Record<string, unknown>).every(([ledgerId, target]) =>
      ledgerId.trim().length > 0 && ledgerId.trim().length <= 128 &&
      Boolean(target) && typeof target === 'object' && !Array.isArray(target) &&
      Object.keys(target as Record<string, unknown>).length === 2 &&
      typeof (target as { remoteFolderId?: unknown }).remoteFolderId === 'string' &&
      Boolean((target as { remoteFolderId: string }).remoteFolderId.trim()) &&
      typeof (target as { title?: unknown }).title === 'string' &&
      Boolean((target as { title: string }).title.trim()))
}

function validHistoricalBindingDeletionTargets(value: unknown): value is Record<string, Array<{ remoteFolderId: string; title: string }>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.entries(value as Record<string, unknown>).length <= 500 &&
    Object.entries(value as Record<string, unknown>).every(([ledgerId, targets]) =>
      ledgerId.trim().length > 0 && ledgerId.trim().length <= 128 &&
      Array.isArray(targets) && targets.length <= 32 && targets.every((target) =>
        Boolean(target) && typeof target === 'object' && !Array.isArray(target) &&
        Object.keys(target as Record<string, unknown>).length === 2 &&
        typeof (target as { remoteFolderId?: unknown }).remoteFolderId === 'string' &&
        Boolean((target as { remoteFolderId: string }).remoteFolderId.trim()) &&
        typeof (target as { title?: unknown }).title === 'string' &&
        Boolean((target as { title: string }).title.trim())))
}

function validAssignments(value: unknown): value is ApplyWorkspaceClassificationBatchOptions['assignments'] {
  return Array.isArray(value) && value.length <= MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE && value.every((assignment) => {
    if (!assignment || typeof assignment !== 'object') return false
    const candidate = assignment as { aid?: unknown; targetLedgerIds?: unknown }
    return Number.isSafeInteger(candidate.aid) && Number(candidate.aid) > 0 &&
      Array.isArray(candidate.targetLedgerIds) && candidate.targetLedgerIds.length <= 3 &&
      candidate.targetLedgerIds.every((id) => typeof id === 'string' && !!id.trim() && id.trim().length <= 128)
  })
}

function favoriteLibraryScopeSelection(value: unknown): FavoriteLibraryScopeSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'scope' || Object.keys(candidate).length !== 4 ||
    !candidate.scope || typeof candidate.scope !== 'object' || Array.isArray(candidate.scope) ||
    !candidate.options || typeof candidate.options !== 'object' || Array.isArray(candidate.options) ||
    !Array.isArray(candidate.excludedAids)) return null
  const scope = candidate.scope as { kind?: unknown; folderId?: unknown }
  const options = candidate.options as { query?: unknown; filter?: unknown; sort?: unknown; transcriptionFilters?: unknown }
  const validScope = scope.kind === 'all' || scope.kind === 'pending' || scope.kind === 'protected' || scope.kind === 'unsynced' ||
    scope.kind === 'folder' && typeof scope.folderId === 'string' && !!scope.folderId.trim()
  const transcriptionFilters = options.transcriptionFilters
  if (!validScope || candidate.excludedAids.some((aid) => !Number.isSafeInteger(aid) || Number(aid) <= 0) ||
    (options.query !== undefined && typeof options.query !== 'string') ||
    (options.filter !== undefined && !['all', 'pending', 'protected', 'unsynced'].includes(String(options.filter))) ||
    (options.sort !== undefined && !['updated-desc', 'updated-asc', 'title-asc', 'title-desc'].includes(String(options.sort))) ||
    (transcriptionFilters !== undefined && (!Array.isArray(transcriptionFilters) || transcriptionFilters.length > 5 ||
      transcriptionFilters.some((filter) => !['completed', 'none', 'pending', 'running', 'failed'].includes(String(filter)))))) return null
  return {
    kind: 'scope',
    scope: scope.kind === 'folder'
      ? { kind: 'folder', folderId: (scope.folderId as string).trim() }
      : { kind: scope.kind as Exclude<FavoriteLibraryScopeSelection['scope']['kind'], 'folder'> },
    options: {
      ...(typeof options.query === 'string' ? { query: options.query } : {}),
      ...(typeof options.filter === 'string' ? { filter: options.filter as FavoriteLibraryScopeSelection['options']['filter'] } : {}),
      ...(typeof options.sort === 'string' ? { sort: options.sort as FavoriteLibraryScopeSelection['options']['sort'] } : {}),
      ...(Array.isArray(transcriptionFilters) && transcriptionFilters.length
        ? { transcriptionFilters: [...new Set(transcriptionFilters as NonNullable<FavoriteLibraryScopeSelection['options']['transcriptionFilters']>)].sort() }
        : {})
    },
    excludedAids: [...new Set(candidate.excludedAids as number[])].sort((left, right) => left - right)
  }
}

function command(value: unknown): WorkspaceCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Old favorite workspace command is invalid.')
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'start-scan' && (candidate.mode === 'incremental' || candidate.mode === 'full') &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'mode' || key === 'clearBilibiliMirror') &&
    (candidate.clearBilibiliMirror === undefined || (candidate.mode === 'full' && candidate.clearBilibiliMirror === true))) {
    return candidate.clearBilibiliMirror ? { type: 'start-scan', mode: candidate.mode, clearBilibiliMirror: true } : { type: 'start-scan', mode: candidate.mode }
  }
  if (candidate.type === 'start-selected-reorganization' && Array.isArray(candidate.aids) &&
    candidate.aids.length > 0 && candidate.aids.length <= 2_000 &&
    candidate.aids.every((aid) => Number.isSafeInteger(aid) && Number(aid) > 0) &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'aids')) {
    return { type: 'start-selected-reorganization', aids: [...new Set(candidate.aids as number[])].sort((left, right) => left - right) }
  }
  if (candidate.type === 'start-selected-reorganization' && Object.keys(candidate).length === 2) {
    const selection = favoriteLibraryScopeSelection(candidate.selection)
    if (selection) return { type: 'start-selected-reorganization', selection }
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
  if (candidate.type === 'view-segment' && typeof candidate.segmentId === 'string' && candidate.segmentId.trim()) {
    return { type: 'view-segment', segmentId: candidate.segmentId.trim() }
  }
  if ((candidate.type === 'undo-classification' || candidate.type === 'redo-classification') &&
    Object.keys(candidate).length === 1) {
    return { type: candidate.type }
  }
  if ((candidate.type === 'pause-tag-enrichment' || candidate.type === 'resume-tag-enrichment' || candidate.type === 'retry-failed-tag-enrichment' || candidate.type === 'accept-current-tags') &&
    Object.keys(candidate).length === 1) {
    return { type: candidate.type }
  }
  if (candidate.type === 'resume-scan' && Object.keys(candidate).length === 1) {
    return { type: 'resume-scan' }
  }
  if (candidate.type === 'pause-scan' && Object.keys(candidate).length === 1) {
    return { type: 'pause-scan' }
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
  if (candidate.type === 'refresh-relationship-projection' && Object.keys(candidate).length === 1) {
    return { type: 'refresh-relationship-projection' }
  }
  if (candidate.type === 'set-recommended-candidates' && Array.isArray(candidate.candidateIds) &&
    candidate.candidateIds.length <= 32 && candidate.candidateIds.every((id) => typeof id === 'string' && id.trim().length > 0 && id.trim().length <= 128) &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'candidateIds')) {
    return { type: 'set-recommended-candidates', candidateIds: [...new Set(candidate.candidateIds.map((id) => id.trim()))].sort() }
  }
  if (candidate.type === 'set-round-excluded-ledger-ids' && Array.isArray(candidate.ledgerIds) &&
    candidate.ledgerIds.length <= 128 && candidate.ledgerIds.every((id) => typeof id === 'string' && id.trim().length > 0 && id.trim().length <= 128) &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'ledgerIds')) {
    return { type: 'set-round-excluded-ledger-ids', ledgerIds: [...new Set(candidate.ledgerIds.map((id) => id.trim()))].sort() }
  }
  if (candidate.type === 'prepare-recommendation-preview' && Array.isArray(candidate.candidateIds) &&
    candidate.candidateIds.length <= 32 && candidate.candidateIds.every((id) => typeof id === 'string' && id.trim().length > 0 && id.trim().length <= 128) &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'candidateIds')) {
    return { type: 'prepare-recommendation-preview', candidateIds: [...new Set(candidate.candidateIds.map((id) => id.trim()))].sort() }
  }
  if (candidate.type === 'cancel-recommendation-preview-preparation' && Object.keys(candidate).length === 1) {
    return { type: 'cancel-recommendation-preview-preparation' }
  }
  if (candidate.type === 'create-local-ledger-and-reclassify' && typeof candidate.title === 'string' &&
    candidate.title.trim().length > 0 && candidate.title.trim().length <= 128 && Object.keys(candidate).every((key) => key === 'type' || key === 'title')) {
    return { type: 'create-local-ledger-and-reclassify', title: candidate.title.trim() }
  }
  if (candidate.type === 'save-draft-ledger-rule' &&
    typeof candidate.analysisId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(candidate.analysisId) &&
    (candidate.ledgerId === undefined || (typeof candidate.ledgerId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(candidate.ledgerId.trim()))) &&
    typeof candidate.title === 'string' && candidate.title.trim().length > 0 && candidate.title.trim().length <= 128 &&
    Array.isArray(candidate.keywords) && candidate.keywords.length > 0 && candidate.keywords.length <= 64 &&
    candidate.keywords.every((keyword) => typeof keyword === 'string' && keyword.trim().length > 0 && keyword.trim().length <= 128) &&
    (candidate.ruleType === 'keyword' || candidate.ruleType === 'author' || candidate.ruleType === 'tag') &&
    (typeof candidate.adopt === 'undefined' || typeof candidate.adopt === 'boolean') &&
    Object.keys(candidate).every((key) => ['type', 'analysisId', 'ledgerId', 'title', 'keywords', 'ruleType', 'adopt'].includes(key))) {
    return {
      type: 'save-draft-ledger-rule',
      analysisId: candidate.analysisId,
      ...(candidate.ledgerId ? { ledgerId: candidate.ledgerId.trim() } : {}),
      title: candidate.title.trim(),
      keywords: [...new Set(candidate.keywords.map((keyword) => keyword.trim()))],
      ruleType: candidate.ruleType,
      ...(typeof candidate.adopt === 'boolean' ? { adopt: candidate.adopt } : {})
    }
  }
  if (candidate.type === 'cancel-draft-ledger-rule-analysis' && typeof candidate.analysisId === 'string' &&
    /^[a-zA-Z0-9_-]{8,128}$/.test(candidate.analysisId) && Object.keys(candidate).length === 2) {
    return { type: 'cancel-draft-ledger-rule-analysis', analysisId: candidate.analysisId }
  }
  if (candidate.type === 'freeze-segment' && typeof candidate.segmentId === 'string' && candidate.segmentId.trim()) {
    return { type: 'freeze-segment', segmentId: candidate.segmentId.trim() }
  }
  if (candidate.type === 'freeze-bilibili-execution' && Object.keys(candidate).length === 1) {
    return { type: 'freeze-bilibili-execution' }
  }
  if (candidate.type === 'stop-bilibili-sync-and-finish' && Object.keys(candidate).length === 1) {
    return { type: 'stop-bilibili-sync-and-finish' }
  }
  if (candidate.type === 'pause-bilibili-sync' && Object.keys(candidate).length === 1) {
    return { type: 'pause-bilibili-sync' }
  }
  if (candidate.type === 'confirm-and-execute-bilibili-plan' &&
    (Object.keys(candidate).length === 1 || (Object.keys(candidate).length === 2 && typeof candidate.includeInbox === 'boolean'))) {
    return { type: 'confirm-and-execute-bilibili-plan', ...(candidate.includeInbox === true ? { includeInbox: true } : {}) }
  }
  if (candidate.type === 'save-current-segment-locally' && Object.keys(candidate).length === 1) {
    return { type: 'save-current-segment-locally' }
  }
  if (candidate.type === 'set-whole-run-execution-intent' &&
    (candidate.mode === 'local' || candidate.mode === 'bilibili') &&
    (Object.keys(candidate).length === 2 || (Object.keys(candidate).length === 3 && typeof candidate.includeInbox === 'boolean'))) {
    return { type: 'set-whole-run-execution-intent', mode: candidate.mode, ...(candidate.includeInbox === true ? { includeInbox: true } : {}) }
  }
  if (candidate.type === 'cancel-whole-run-execution-intent' && Object.keys(candidate).length === 1) {
    return { type: 'cancel-whole-run-execution-intent' }
  }
  if (candidate.type === 'use-original-classifications-for-failed-deepseek' && Object.keys(candidate).length === 1) {
    return { type: 'use-original-classifications-for-failed-deepseek' }
  }
  if (candidate.type === 'select-recovery-decision' && typeof candidate.workspaceId === 'string' && candidate.workspaceId.trim().length > 0 &&
    candidate.workspaceId.trim().length <= 256 &&
    (candidate.choice === 'continue-original' || candidate.choice === 'merge-latest' || candidate.choice === 'rescan') &&
    Number.isSafeInteger(candidate.expectedBaselineRevision) && Number(candidate.expectedBaselineRevision) >= 0 &&
    Number.isSafeInteger(candidate.expectedRepositoryRevision) && Number(candidate.expectedRepositoryRevision) >= 0 &&
    Object.keys(candidate).every((key) => key === 'type' || key === 'workspaceId' || key === 'choice' || key === 'expectedBaselineRevision' || key === 'expectedRepositoryRevision')) {
    return {
      type: 'select-recovery-decision', workspaceId: candidate.workspaceId.trim(), choice: candidate.choice,
      expectedBaselineRevision: candidate.expectedBaselineRevision, expectedRepositoryRevision: candidate.expectedRepositoryRevision
    }
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
  deepSeekService?: Pick<OldFavoriteWorkspaceDeepSeekService, 'organizeCurrentSegment' | 'retryFailedChunks' | 'cancelCurrentSegment'> &
    Partial<Pick<OldFavoriteWorkspaceDeepSeekService, 'cancelPendingAllSegments'>> &
    Partial<Pick<OldFavoriteWorkspaceDeepSeekService, 'organizeAllSegments' | 'resumePendingAllSegments'>>
  isTrustedSender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  startScan?: (accountMid: string, mode: 'incremental' | 'full', options?: { clearBilibiliMirror?: boolean }) => Promise<Awaited<ReturnType<OldFavoriteWorkspaceCoordinator['getSnapshot']>>>
  resumeScan?: (accountMid: string) => Promise<Awaited<ReturnType<OldFavoriteWorkspaceCoordinator['getSnapshot']>>>
  pauseScan?: (accountMid: string) => Promise<Awaited<ReturnType<OldFavoriteWorkspaceCoordinator['getSnapshot']>>>
  resumeTagEnrichment?: (accountMid: string) => Promise<void>
  retryFailedTagEnrichment?: (accountMid: string) => Promise<void>
  resolveSelection?: (accountMid: string, selection: FavoriteLibraryScopeSelection) => Promise<number[]>
  rebuildAndStartScan?: (accountMid: string) => Promise<Awaited<ReturnType<OldFavoriteWorkspaceCoordinator['getSnapshot']>>>
  prepareRecovery?: (accountMid: string) => Promise<WorkspaceRecoverySummary | null>
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
    const accountMid = await assertAccount(event, requestedAccountMid)
    const opened = await options.coordinator.getSnapshot(accountMid)
    return snapshot(opened)
  })
  // This is deliberately separate from the mutable command channel. The
  // renderer may only ask main for its current read-only backup gaps; it may
  // never supply a claimed target set, capacity result, or remote folder id.
  options.ipcMain.handle('old-favorite-workspace-v1:bilibili-execution-preflight', async (event, requestedAccountMid: string, ...args: unknown[]) => {
    if (args.length !== 0) throw new Error('Old favorite workspace Bilibili backup preflight arguments are invalid.')
    return options.coordinator.getBilibiliExecutionPreflight(await assertAccount(event, requestedAccountMid))
  })
  options.ipcMain.handle('old-favorite-workspace-v1:provision-bilibili-execution-preflight-shards', async (event, requestedAccountMid: string, ...args: unknown[]) => {
    if (args.length !== 0) throw new Error('Old favorite workspace Bilibili backup provision arguments are invalid.')
    return options.coordinator.provisionBilibiliExecutionPreflightShards(await assertAccount(event, requestedAccountMid))
  })
  // Reading a recovery summary never resumes scanning, reconciliation, or remote writes.
  options.ipcMain.handle('old-favorite-workspace-v1:recovery-summary', async (event, requestedAccountMid: string, ...args: unknown[]) => {
    if (args.length !== 0) throw new Error('Old favorite workspace recovery summary arguments are invalid.')
    return options.coordinator.getRecoverySummary(await assertAccount(event, requestedAccountMid)) as Promise<WorkspaceRecoverySummary | null>
  })
  options.ipcMain.handle('old-favorite-workspace-v1:prepare-recovery', async (event, requestedAccountMid: string, ...args: unknown[]) => {
    if (args.length !== 0) throw new Error('Old favorite workspace recovery preparation arguments are invalid.')
    const accountMid = await assertAccount(event, requestedAccountMid)
    if (!options.prepareRecovery) return options.coordinator.getRecoverySummary(accountMid) as Promise<WorkspaceRecoverySummary | null>
    try {
      return await options.prepareRecovery(accountMid)
    } catch (error) {
      if (!isOldFavoriteWorkspaceRecoveryDecisionStaleError(error)) throw error
      return options.coordinator.getRecoverySummary(accountMid) as Promise<WorkspaceRecoverySummary | null>
    }
  })
  options.ipcMain.handle('old-favorite-workspace-v1:managed-folder-deletion-preview', async (event, requestedAccountMid: string, ledgerIds: string[], ledgerTitleHints?: Record<string, string>, remoteDraftTargets?: Record<string, { remoteFolderId: string; title: string }>, historicalBindingTargets?: Record<string, Array<{ remoteFolderId: string; title: string }>>) => {
    const accountMid = await assertAccount(event, requestedAccountMid)
    if (!Array.isArray(ledgerIds) || ledgerIds.some((id) => typeof id !== 'string' || !id.trim()) || (!ledgerIds.length && !remoteDraftTargets && !historicalBindingTargets)) throw new Error('Old favorite workspace deletion preview selection is empty or invalid.')
    if (ledgerTitleHints !== undefined && (!ledgerTitleHints || typeof ledgerTitleHints !== 'object' || Array.isArray(ledgerTitleHints) || Object.entries(ledgerTitleHints).some(([id, title]) => !id.trim() || typeof title !== 'string'))) throw new Error('Old favorite workspace deletion preview is invalid.')
    if (remoteDraftTargets !== undefined && !validRemoteDraftDeletionTargets(remoteDraftTargets)) throw new Error('Old favorite workspace remote draft deletion preview is invalid.')
    if (historicalBindingTargets !== undefined && !validHistoricalBindingDeletionTargets(historicalBindingTargets)) throw new Error('Old favorite workspace historical binding deletion preview is invalid.')
    return remoteDraftTargets || historicalBindingTargets
      ? options.coordinator.previewManagedFolderDeletion(accountMid, ledgerIds, ledgerTitleHints, remoteDraftTargets, historicalBindingTargets)
      : options.coordinator.previewManagedFolderDeletion(accountMid, ledgerIds, ledgerTitleHints)
  })
  options.ipcMain.handle('old-favorite-workspace-v1:delete-managed-folders', async (
    event,
    requestedAccountMid: string,
    ledgerIds: string[],
    acknowledgeUnboundRemoteDeletion = false,
    ledgerTitleHints?: Record<string, string>,
    expectedRemoteFolderIds?: Record<string, string[]>
  ) => {
    const accountMid = await assertAccount(event, requestedAccountMid)
    if (!Array.isArray(ledgerIds) || !ledgerIds.length || ledgerIds.some((id) => typeof id !== 'string' || !id.trim()) || typeof acknowledgeUnboundRemoteDeletion !== 'boolean' || (ledgerTitleHints !== undefined && (!ledgerTitleHints || typeof ledgerTitleHints !== 'object' || Array.isArray(ledgerTitleHints) || Object.entries(ledgerTitleHints).some(([id, title]) => !id.trim() || typeof title !== 'string'))) || (expectedRemoteFolderIds !== undefined && (!expectedRemoteFolderIds || typeof expectedRemoteFolderIds !== 'object' || Array.isArray(expectedRemoteFolderIds) || Object.entries(expectedRemoteFolderIds).some(([id, values]) => !id.trim() || !Array.isArray(values) || values.some((value) => typeof value !== 'string'))))) throw new Error('Old favorite workspace deletion request selection is empty or invalid.')
    return options.coordinator.deleteManagedFolderCandidates(accountMid, ledgerIds, acknowledgeUnboundRemoteDeletion, ledgerTitleHints, expectedRemoteFolderIds)
  })
  options.ipcMain.handle('old-favorite-workspace-v1:delete-managed-remote-folders', async (
    event,
    requestedAccountMid: string,
    ledgerIds: string[],
    acknowledgeUnboundRemoteDeletion = false,
    ledgerTitleHints?: Record<string, string>,
    expectedRemoteFolderIds?: Record<string, string[]>,
    remoteDraftTargets?: Record<string, { remoteFolderId: string; title: string }>,
    historicalBindingTargets?: Record<string, Array<{ remoteFolderId: string; title: string }>>
  ) => {
    const accountMid = await assertAccount(event, requestedAccountMid)
    if (!Array.isArray(ledgerIds) || ledgerIds.some((id) => typeof id !== 'string' || !id.trim()) || (!ledgerIds.length && !remoteDraftTargets && !historicalBindingTargets) || typeof acknowledgeUnboundRemoteDeletion !== 'boolean' || (ledgerTitleHints !== undefined && (!ledgerTitleHints || typeof ledgerTitleHints !== 'object' || Array.isArray(ledgerTitleHints) || Object.entries(ledgerTitleHints).some(([id, title]) => !id.trim() || typeof title !== 'string'))) || (expectedRemoteFolderIds !== undefined && (!expectedRemoteFolderIds || typeof expectedRemoteFolderIds !== 'object' || Array.isArray(expectedRemoteFolderIds) || Object.entries(expectedRemoteFolderIds).some(([id, values]) => !id.trim() || !Array.isArray(values) || values.some((value) => typeof value !== 'string')))) || (remoteDraftTargets !== undefined && !validRemoteDraftDeletionTargets(remoteDraftTargets)) || (historicalBindingTargets !== undefined && !validHistoricalBindingDeletionTargets(historicalBindingTargets))) throw new Error('Old favorite workspace deletion request selection is empty or invalid.')
    return remoteDraftTargets || historicalBindingTargets
      ? options.coordinator.deleteManagedRemoteFolderCandidates(accountMid, ledgerIds, acknowledgeUnboundRemoteDeletion, ledgerTitleHints, expectedRemoteFolderIds, remoteDraftTargets, historicalBindingTargets)
      : options.coordinator.deleteManagedRemoteFolderCandidates(accountMid, ledgerIds, acknowledgeUnboundRemoteDeletion, ledgerTitleHints, expectedRemoteFolderIds)
  })
  options.ipcMain.handle('old-favorite-workspace-v1:deepseek-current-segment', async (event, requestedAccountMid: string, mode?: DeepSeekArchiveMode, scope?: DeepSeekArchiveScope, ...args: unknown[]) => {
    if (args.length !== 0 || (mode !== undefined && !['all', 'classified-only', 'unclassified-only', 'low-confidence-and-unclassified'].includes(mode)) || (scope !== undefined && !['current', 'all'].includes(scope))) throw new Error('Old favorite workspace DeepSeek arguments are invalid.')
    if (!options.deepSeekService) throw new Error('Old favorite workspace DeepSeek service is unavailable.')
    const accountMid = await assertAccount(event, requestedAccountMid)
    const workspace = await options.coordinator.getSnapshot(accountMid)
    if (!workspace || 'recovery' in workspace) throw new Error('Old favorite workspace is not ready for DeepSeek classification.')
    const workspaceId = workspace.workspaceId
    const organize = scope === 'all' && workspace.hasMultipleSegments
      ? options.deepSeekService.organizeAllSegments
      : options.deepSeekService.organizeCurrentSegment
    if (!organize) throw new Error('Old favorite workspace DeepSeek batch organization is unavailable.')
    const result = await organize.call(options.deepSeekService, accountMid, mode ?? 'all', (progress) => {
      event.sender.send('old-favorite-workspace-v1:deepseek-progress', { accountMid, workspaceId, ...progress })
    })
    await (options.coordinator.continueExecutionIntent?.(accountMid) ?? Promise.resolve(false))
    return result
  })
  options.ipcMain.handle('old-favorite-workspace-v1:retry-failed-deepseek', async (event, requestedAccountMid: string, ...args: unknown[]) => {
    if (args.length !== 0) throw new Error('Old favorite workspace DeepSeek arguments are invalid.')
    if (!options.deepSeekService) throw new Error('Old favorite workspace DeepSeek service is unavailable.')
    const accountMid = await assertAccount(event, requestedAccountMid)
    const workspace = await options.coordinator.getSnapshot(accountMid)
    if (!workspace || 'recovery' in workspace) throw new Error('Old favorite workspace is not ready for DeepSeek classification.')
    const workspaceId = workspace.workspaceId
    const result = await options.deepSeekService.retryFailedChunks(accountMid, (progress) => {
      event.sender.send('old-favorite-workspace-v1:deepseek-progress', { accountMid, workspaceId, ...progress })
    })
    await (options.coordinator.continueExecutionIntent?.(accountMid) ?? Promise.resolve(false))
    return result
  })
  options.ipcMain.handle('old-favorite-workspace-v1:command', async (event, requestedAccountMid: string, value: unknown) => {
    const accountMid = await assertAccount(event, requestedAccountMid)
    const requested = command(value)
    const commandsLockedByExecutionIntent = new Set<WorkspaceCommand['type']>([
      'select-source-folders', 'select-segment', 'undo-classification', 'redo-classification',
      'pause-tag-enrichment', 'resume-tag-enrichment', 'retry-failed-tag-enrichment', 'accept-current-tags',
      'move-history-cursor', 'auto-classify-current-segment', 'reclassify-favorite-configuration',
      'set-recommended-candidates', 'set-round-excluded-ledger-ids', 'prepare-recommendation-preview', 'create-local-ledger-and-reclassify',
      'freeze-segment', 'save-current-segment-locally', 'freeze-bilibili-execution', 'apply-classifications'
    ])
    let commandPreflightSnapshot: Awaited<ReturnType<typeof options.coordinator.getSnapshot>> | undefined
    if (commandsLockedByExecutionIntent.has(requested.type)) {
      const active = await options.coordinator.getSnapshot(accountMid)
      commandPreflightSnapshot = active
      if (active && !('recovery' in active) && active.executionIntent) {
        throw new Error('Old favorite workspace is waiting for whole-run execution.')
      }
    }
    if (requested.type === 'start-scan') return options.startScan
      ? requested.clearBilibiliMirror
        ? options.startScan(accountMid, requested.mode, { clearBilibiliMirror: true })
        : options.startScan(accountMid, requested.mode)
      : requested.clearBilibiliMirror
        ? options.coordinator.beginScan(accountMid, requested.mode, { clearBilibiliMirror: true })
        : options.coordinator.beginScan(accountMid, requested.mode)
    if (requested.type === 'start-selected-reorganization') {
      if ('selection' in requested) {
        const aids = await options.resolveSelection?.(accountMid, requested.selection) ?? (() => { throw new Error('所选视频无效。') })()
        await assertAccount(event, accountMid)
        return options.coordinator.beginSelectedReorganization(accountMid, aids, {
          refreshIncompleteMetadata: false
        })
      }
      return options.coordinator.beginSelectedReorganization(accountMid, requested.aids)
    }
    if (requested.type === 'resume-scan') return options.resumeScan
      ? options.resumeScan(accountMid)
      : snapshot(await options.coordinator.resumeScan(accountMid))
    if (requested.type === 'pause-scan') return options.pauseScan
      ? options.pauseScan(accountMid)
      : snapshot(await options.coordinator.pauseScan(accountMid))
    if (requested.type === 'rebuild-corrupt-workspace') return options.rebuildAndStartScan
      ? options.rebuildAndStartScan(accountMid)
      : options.coordinator.rebuildAfterRecovery(accountMid)
    if (requested.type === 'refresh-relationship-projection') return options.coordinator.refreshRelationshipProjection(accountMid)
    if (requested.type === 'select-source-folders') await options.coordinator.selectSourceFolders(accountMid, requested.folderIds)
    if (requested.type === 'select-segment') await options.coordinator.selectSegment(accountMid, requested.segmentId)
    if (requested.type === 'view-segment') return options.coordinator.getSegmentSnapshot(accountMid, requested.segmentId)
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
    if (requested.type === 'accept-current-tags') {
      try {
        await options.coordinator.acceptCurrentTags(accountMid)
      } catch (error) {
        if (error && typeof error === 'object' &&
          (error as { [OLD_FAVORITE_WORKSPACE_TAG_ADOPTION_FAILURE_PERSISTED]?: unknown })[
            OLD_FAVORITE_WORKSPACE_TAG_ADOPTION_FAILURE_PERSISTED
          ] === true) {
          const hadPriorPersistedFailure = commandPreflightSnapshot &&
            !('recovery' in commandPreflightSnapshot) &&
            commandPreflightSnapshot.tagAdoption?.status === 'failed'
          if (!hadPriorPersistedFailure) {
            try {
              const latest = await options.coordinator.getSnapshot(accountMid)
              if (latest && !('recovery' in latest) && latest.tagAdoption?.status === 'failed') return latest
            } catch {
              // Preserve the original adoption error when its durable state cannot be read.
            }
          }
        }
        throw error
      }
    }
    if (requested.type === 'cancel-deepseek-current-segment') {
      if (!options.deepSeekService) throw new Error('Old favorite workspace DeepSeek service is unavailable.')
      if (options.deepSeekService.cancelPendingAllSegments) await options.deepSeekService.cancelPendingAllSegments(accountMid)
      else options.deepSeekService.cancelCurrentSegment(accountMid)
    }
    if (requested.type === 'move-history-cursor') await options.coordinator.moveHistoryCursor(accountMid, requested.cursor)
    if (requested.type === 'auto-classify-current-segment') await options.coordinator.autoClassifyCurrentSegment(accountMid)
    if (requested.type === 'reclassify-favorite-configuration') await options.coordinator.reclassifyForFavoriteConfiguration(accountMid)
    if (requested.type === 'set-recommended-candidates') {
      await options.coordinator.setRecommendedCandidates(accountMid, requested.candidateIds)
      return options.coordinator.getSnapshot(accountMid)
    }
    if (requested.type === 'set-round-excluded-ledger-ids') {
      await options.coordinator.setRoundExcludedLedgerIds(accountMid, requested.ledgerIds)
      return options.coordinator.getSnapshot(accountMid)
    }
    if (requested.type === 'prepare-recommendation-preview') {
      const workspace = await options.coordinator.getSnapshot(accountMid)
      if (!workspace || 'recovery' in workspace) throw new Error('Old favorite workspace recommendations are not ready.')
      return snapshot(await options.coordinator.prepareRecommendationPreview(accountMid, requested.candidateIds, (progress) => {
        event.sender.send('old-favorite-workspace-v1:preview-preparation-progress', {
          accountMid, workspaceId: workspace.workspaceId, ...progress
        })
      }))
    }
    if (requested.type === 'cancel-recommendation-preview-preparation') {
      options.coordinator.cancelRecommendationPreviewPreparation(accountMid)
    }
    if (requested.type === 'create-local-ledger-and-reclassify') await options.coordinator.createLocalLedgerAndReclassify(accountMid, requested.title)
    if (requested.type === 'save-draft-ledger-rule') {
      await options.coordinator.saveDraftLedgerRule(accountMid, {
        analysisId: requested.analysisId,
        ...(requested.ledgerId ? { ledgerId: requested.ledgerId } : {}),
        title: requested.title,
        keywords: requested.keywords,
        ruleType: requested.ruleType,
        ...(typeof requested.adopt === 'boolean' ? { adopt: requested.adopt } : {})
      }, (progress) => {
        event.sender.send('old-favorite-workspace-v1:rule-analysis-progress', {
          accountMid,
          ...progress
        })
      })
    }
    if (requested.type === 'cancel-draft-ledger-rule-analysis') {
      options.coordinator.cancelDraftLedgerRuleAnalysis(accountMid, requested.analysisId)
    }
    if (requested.type === 'freeze-segment') await options.coordinator.freezeSegment(accountMid, requested.segmentId)
    if (requested.type === 'save-current-segment-locally') await options.coordinator.saveCurrentSegmentToLocalLibrary(accountMid)
    if (requested.type === 'set-whole-run-execution-intent') {
      if (requested.includeInbox === true) await options.coordinator.setExecutionIntent(accountMid, requested.mode, true)
      else await options.coordinator.setExecutionIntent(accountMid, requested.mode)
      try {
        await options.coordinator.continueExecutionIntent(accountMid)
      } catch {
        // The coordinator has atomically recorded a blocked execution intent.
        // Return it so the renderer can show the safe, specific failure state.
        return options.coordinator.getSnapshot(accountMid)
      }
    }
    if (requested.type === 'cancel-whole-run-execution-intent') await options.coordinator.setExecutionIntent(accountMid, null)
    if (requested.type === 'use-original-classifications-for-failed-deepseek') {
      await options.coordinator.useOriginalClassificationsForFailedDeepSeekAids(accountMid)
      await options.coordinator.continueExecutionIntent(accountMid)
    }
    if (requested.type === 'select-recovery-decision') {
      return options.coordinator.selectRecoveryDecision(accountMid, {
        workspaceId: requested.workspaceId,
        choice: requested.choice,
        expectedBaselineRevision: requested.expectedBaselineRevision,
        expectedRepositoryRevision: requested.expectedRepositoryRevision
      })
    }
    if (requested.type === 'abandon-current-workspace') await options.coordinator.abandonCurrentWorkspace(accountMid)
    if (requested.type === 'freeze-bilibili-execution') await options.coordinator.freezeForBilibiliExecution(accountMid)
    if (requested.type === 'confirm-and-execute-bilibili-plan') {
      return requested.includeInbox === true
        ? options.coordinator.beginBilibiliExecution(accountMid, { includeInbox: true })
        : options.coordinator.beginBilibiliExecution(accountMid)
    }
    if (requested.type === 'execute-frozen-bilibili-plan') return options.coordinator.beginFrozenBilibiliPlanExecution(accountMid)
    if (requested.type === 'pause-bilibili-sync') return options.coordinator.pauseBilibiliSync(accountMid)
    if (requested.type === 'stop-bilibili-sync-and-finish') await options.coordinator.stopBilibiliSyncAndFinish(accountMid)
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

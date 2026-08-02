import { describe, expect, it, vi } from 'vitest'
import { registerOldFavoriteWorkspaceCoordinatorIpc } from './oldFavoriteWorkspaceCoordinatorIpc'

class FakeIpcMain {
  handlers = new Map<string, (event: { sender: { id: number; send: ReturnType<typeof vi.fn> } }, ...args: never[]) => unknown>()
  send = vi.fn()
  handle(channel: string, handler: (event: { sender: { id: number; send: ReturnType<typeof vi.fn> } }, ...args: never[]) => unknown) {
    this.handlers.set(channel, handler)
  }
  invoke(channel: string, senderId: number, ...args: unknown[]) {
    return this.handlers.get(channel)?.({ sender: { id: senderId, send: this.send } }, ...args as never[])
  }
}

const snapshot = {
  version: 1 as const, accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
  mode: 'incremental' as const, segmentSize: 2_000, hasMultipleSegments: false, continuationCount: 0,
  segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1 }],
  currentSegment: { id: 'segment-1', aids: [1] }, classifications: {}, history: { cursor: 0, length: 0 },
  scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: []
}

describe('old favorite workspace coordinator IPC', () => {
  it('opens only the current account and returns a compact current-segment snapshot', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = { getSnapshot: vi.fn().mockResolvedValue(snapshot) }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: (id) => id === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:open', 7, '00100')).resolves.toEqual(snapshot)
    expect(coordinator.getSnapshot).toHaveBeenCalledWith('100')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:open', 7, '200')).rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:open', 8, '100')).rejects.toThrow('untrusted')
  })

  it('returns an account-validated recovery summary without starting scan or remote execution', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      getRecoverySummary: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-1', status: 'executing' as const,
        currentSegmentId: 'segment-1', currentStep: 'result-unknown' as const,
        plannedCount: 26, classifiedCount: 3, unclassifiedCount: 23,
        manifestChecksum: 'a'.repeat(64), lastCommittedId: 'commit-1',
        recoveryChoices: ['view', 'reconcile-result-unknown'] as const,
        resultUnknownEvidence: { operationCount: 2 }
      }),
      getSnapshot: vi.fn().mockResolvedValue({
        ...snapshot,
        status: 'executing' as const,
        planReadiness: { selectedAidCount: 26, classifiedAidCount: 3, unclassifiedAidCount: 23 },
        executionProgress: { completedOperationCount: 8, totalOperationCount: 26 }
      }),
      beginScan: vi.fn(),
      executeFrozenBilibiliPlan: vi.fn()
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: (id) => id === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:recovery-summary', 7, '00100')).resolves.toEqual({
      accountMid: '100', workspaceId: 'workspace-1', status: 'executing', currentSegmentId: 'segment-1',
      currentStep: 'result-unknown', plannedCount: 26, classifiedCount: 3, unclassifiedCount: 23,
      manifestChecksum: 'a'.repeat(64), lastCommittedId: 'commit-1',
      recoveryChoices: ['view', 'reconcile-result-unknown'], resultUnknownEvidence: { operationCount: 2 }
    })
    expect(coordinator.getRecoverySummary).toHaveBeenCalledWith('100')
    expect(coordinator.getSnapshot).not.toHaveBeenCalled()
    expect(coordinator.beginScan).not.toHaveBeenCalled()
    expect(coordinator.executeFrozenBilibiliPlan).not.toHaveBeenCalled()
    await expect(ipcMain.invoke('old-favorite-workspace-v1:recovery-summary', 8, '100')).rejects.toThrow('untrusted')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:recovery-summary', 7, '200')).rejects.toThrow('current Bilibili account')
  })

  it('accepts only an explicit, revision-guarded recovery decision from the current trusted account', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      selectRecoveryDecision: vi.fn().mockResolvedValue({
        choice: 'merge-latest', requiresFullWorkspaceLoad: true, manualClassificationsRemainAuthoritative: true
      })
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: (id) => id === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '00100', {
      type: 'select-recovery-decision', workspaceId: 'workspace-1', choice: 'merge-latest',
      expectedBaselineRevision: 4, expectedRepositoryRevision: 9
    })).resolves.toMatchObject({ choice: 'merge-latest', requiresFullWorkspaceLoad: true })
    expect(coordinator.selectRecoveryDecision).toHaveBeenCalledWith('100', {
      workspaceId: 'workspace-1', choice: 'merge-latest', expectedBaselineRevision: 4, expectedRepositoryRevision: 9
    })
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'select-recovery-decision', workspaceId: 'workspace-1', choice: 'merge-latest',
      expectedBaselineRevision: 4, expectedRepositoryRevision: 9, unexpected: true
    })).rejects.toThrow('command is invalid')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 8, '100', {
      type: 'select-recovery-decision', workspaceId: 'workspace-1', choice: 'merge-latest',
      expectedBaselineRevision: 4, expectedRepositoryRevision: 9
    })).rejects.toThrow('untrusted')
  })

  it('runs DeepSeek only through a main-process current-segment service with no renderer result payload', async () => {
    const ipcMain = new FakeIpcMain()
    const deepSeekService = { organizeCurrentSegment: vi.fn().mockResolvedValue(snapshot) }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: { getSnapshot: vi.fn().mockResolvedValue(snapshot) } as never, deepSeekService: deepSeekService as never,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:deepseek-current-segment', 7, '100')).resolves.toEqual(snapshot)
    expect(deepSeekService.organizeCurrentSegment).toHaveBeenCalledWith('100', 'all', expect.any(Function))
    await expect(ipcMain.invoke('old-favorite-workspace-v1:deepseek-current-segment', 7, '100', 'unclassified-only')).resolves.toEqual(snapshot)
    expect(deepSeekService.organizeCurrentSegment).toHaveBeenLastCalledWith('100', 'unclassified-only', expect.any(Function))
    await expect(ipcMain.invoke('old-favorite-workspace-v1:deepseek-current-segment', 7, '100', { results: [] }))
      .rejects.toThrow('arguments are invalid')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:deepseek-current-segment', 7, '100', 'renderer-claimed-mode'))
      .rejects.toThrow('arguments are invalid')
  })

  it('cancels only the active main-process DeepSeek run through an exact payload-free command', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = { getSnapshot: vi.fn().mockResolvedValue(snapshot) }
    const deepSeekService = { cancelCurrentSegment: vi.fn().mockReturnValue(true) }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, deepSeekService: deepSeekService as never,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'cancel-deepseek-current-segment'
    })).resolves.toEqual(snapshot)
    expect(deepSeekService.cancelCurrentSegment).toHaveBeenCalledWith('100')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'cancel-deepseek-current-segment', results: []
    })).rejects.toThrow('command is invalid')
  })

  it('allows manual classifications without accepting a renderer-claimed DeepSeek source', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      selectSegment: vi.fn().mockResolvedValue({}),
      applyClassificationBatch: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'select-segment', segmentId: 'segment-1'
    })).resolves.toEqual(snapshot)
    expect(coordinator.selectSegment).toHaveBeenCalledWith('100', 'segment-1')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'apply-classifications', source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })).resolves.toEqual(snapshot)
    expect(coordinator.applyClassificationBatch).toHaveBeenCalledWith('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'apply-classifications', source: 'deepseek', assignments: [
        { aid: 1, targetLedgerIds: ['knowledge'] }, { aid: 2, targetLedgerIds: ['technology'] }
      ]
    })).rejects.toThrow('command is invalid')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'apply-classifications', source: 'manual', assignments: Array.from({ length: 2_001 }, (_, index) => ({
        aid: index + 1, targetLedgerIds: ['music']
      }))
    })).rejects.toThrow('command is invalid')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'apply-classifications', source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }],
      sourceOverride: 'deepseek'
    })).rejects.toThrow('command is invalid')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'complete-scan', aids: [1]
    })).rejects.toThrow('command is invalid')
  })

  it('routes explicit saved favorite configuration reclassification through the trusted coordinator', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      reclassifyForFavoriteConfiguration: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'reclassify-favorite-configuration' })
    expect(coordinator.reclassifyForFavoriteConfiguration).toHaveBeenCalledWith('100')
  })

  it('accepts only a small start-scan command and returns its immediate scanning snapshot', async () => {
    const ipcMain = new FakeIpcMain()
    const scanning = { ...snapshot, status: 'scanning' as const, scan: { phase: 'inventory' as const, failureCount: 0 } }
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue(scanning),
      getSnapshot: vi.fn().mockResolvedValue(scanning)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'start-scan', mode: 'incremental'
    })).resolves.toEqual(scanning)
    expect(coordinator.beginScan).toHaveBeenCalledWith('100', 'incremental')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'start-scan', mode: 'incremental', aids: [1]
    })).rejects.toThrow('command is invalid')
  })

  it('routes only a bounded explicit AID selection into the scoped organization entry', async () => {
    const ipcMain = new FakeIpcMain()
    const selected = { ...snapshot, mode: 'full' as const, scope: { kind: 'selection' as const, aids: [1, 3] } }
    const coordinator = {
      beginSelectedReorganization: vi.fn().mockResolvedValue(selected),
      getSnapshot: vi.fn().mockResolvedValue(selected)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'start-selected-reorganization', aids: [3, 1, 3]
    })).resolves.toEqual(selected)
    expect(coordinator.beginSelectedReorganization).toHaveBeenCalledWith('100', [1, 3])
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'start-selected-reorganization', aids: Array.from({ length: 2_001 }, (_, index) => index + 1)
    })).rejects.toThrow('command is invalid')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'start-selected-reorganization', aids: [1], mode: 'full'
    })).rejects.toThrow('command is invalid')
  })

  it('resolves a full library scope in main before creating 2000-item workspace segments', async () => {
    const ipcMain = new FakeIpcMain()
    const aids = Array.from({ length: 30_000 }, (_, index) => index + 1)
    const selected = {
      ...snapshot,
      mode: 'full' as const,
      hasMultipleSegments: true,
      segments: Array.from({ length: 15 }, (_, index) => ({
        id: `segment-${index + 1}`, index, status: 'previewing' as const, itemCount: 2_000
      }))
    }
    const coordinator = {
      beginSelectedReorganization: vi.fn().mockResolvedValue(selected),
      getSnapshot: vi.fn().mockResolvedValue(selected)
    }
    const resolveSelection = vi.fn().mockResolvedValue(aids)
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, resolveSelection,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    const selection = {
      kind: 'scope' as const,
      scope: { kind: 'folder' as const, folderId: 'bilimi-logical:games' },
      options: { query: 'boss', filter: 'pending' as const },
      excludedAids: [3, 5]
    }
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'start-selected-reorganization', selection
    })).resolves.toEqual(selected)
    expect(resolveSelection).toHaveBeenCalledWith('100', selection)
    expect(coordinator.beginSelectedReorganization).toHaveBeenCalledWith('100', aids, {
      refreshIncompleteMetadata: false
    })
  })

  it('rejects a resolved scope when the active account changes during selection resolution', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      beginSelectedReorganization: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    const getCurrentAccountMid = vi.fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce('200')
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never,
      resolveSelection: vi.fn().mockResolvedValue([1, 2]),
      isTrustedSender: () => true, getCurrentAccountMid
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'start-selected-reorganization',
      selection: { kind: 'scope', scope: { kind: 'all' }, options: {}, excludedAids: [] }
    })).rejects.toThrow('does not match the current Bilibili account')
    expect(coordinator.beginSelectedReorganization).not.toHaveBeenCalled()
  })

  it('routes an explicit scan-resume command through the scan service', async () => {
    const ipcMain = new FakeIpcMain()
    const scanning = { ...snapshot, status: 'scanning' as const, scan: { phase: 'inventory' as const, failureCount: 0 } }
    const coordinator = { resumeScan: vi.fn(), getSnapshot: vi.fn().mockResolvedValue(scanning) }
    const resumeScan = vi.fn().mockResolvedValue(scanning)
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, resumeScan,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'resume-scan' })).resolves.toEqual(scanning)
    expect(resumeScan).toHaveBeenCalledWith('100')
    expect(coordinator.resumeScan).not.toHaveBeenCalled()
  })

  it('routes tag-enrichment controls through main-process workspace commands only', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      pauseTagEnrichment: vi.fn(),
      resumeTagEnrichment: vi.fn(),
      retryFailedTagEnrichment: vi.fn(),
      acceptCurrentTags: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'pause-tag-enrichment' })
    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'resume-tag-enrichment' })
    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'retry-failed-tag-enrichment' })
    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'accept-current-tags' })

    expect(coordinator.pauseTagEnrichment).toHaveBeenCalledWith('100')
    expect(coordinator.resumeTagEnrichment).toHaveBeenCalledWith('100')
    expect(coordinator.retryFailedTagEnrichment).toHaveBeenCalledWith('100')
    expect(coordinator.acceptCurrentTags).toHaveBeenCalledWith('100')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'accept-current-tags', aids: [1]
    })).rejects.toThrow('command is invalid')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'retry-failed-tag-enrichment', aids: [1]
    })).rejects.toThrow('command is invalid')
  })

  it('uses the scan service to resume tag enrichment against a newly verified page target', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = { pauseTagEnrichment: vi.fn(), acceptCurrentTags: vi.fn(), getSnapshot: vi.fn().mockResolvedValue(snapshot) }
    const resumeTagEnrichment = vi.fn().mockResolvedValue(undefined)
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, resumeTagEnrichment,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'resume-tag-enrichment' })
    expect(resumeTagEnrichment).toHaveBeenCalledWith('100')
  })

  it('allows mirror clearing only as an explicit full reorganization option', async () => {
    const ipcMain = new FakeIpcMain()
    const scanning = { ...snapshot, status: 'scanning' as const, scan: { phase: 'inventory' as const, failureCount: 0 } }
    const coordinator = { beginScan: vi.fn().mockResolvedValue(scanning), getSnapshot: vi.fn().mockResolvedValue(scanning) }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'start-scan', mode: 'full', clearBilibiliMirror: true
    })
    expect(coordinator.beginScan).toHaveBeenCalledWith('100', 'full', { clearBilibiliMirror: true })
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'start-scan', mode: 'incremental', clearBilibiliMirror: true
    })).rejects.toThrow('command is invalid')
  })

  it('rebuilds a corrupt workspace only through an exact account-validated command', async () => {
    const ipcMain = new FakeIpcMain()
    const scanning = { ...snapshot, status: 'scanning' as const, scan: { phase: 'inventory' as const, failureCount: 0 } }
    const rebuildAndStartScan = vi.fn().mockResolvedValue(scanning)
    const coordinator = { rebuildAfterRecovery: vi.fn().mockResolvedValue(scanning) }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, rebuildAndStartScan,
      isTrustedSender: (id) => id === 7, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '00100', {
      type: 'rebuild-corrupt-workspace'
    })).resolves.toEqual(scanning)
    expect(rebuildAndStartScan).toHaveBeenCalledWith('100')
    expect(coordinator.rebuildAfterRecovery).not.toHaveBeenCalled()
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'rebuild-corrupt-workspace', mode: 'full'
    })).rejects.toThrow('command is invalid')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 8, '100', {
      type: 'rebuild-corrupt-workspace'
    })).rejects.toThrow('untrusted')
  })

  it('falls back to the coordinator rebuild command when no scan callback is registered', async () => {
    const ipcMain = new FakeIpcMain()
    const scanning = { ...snapshot, status: 'scanning' as const, scan: { phase: 'inventory' as const, failureCount: 0 } }
    const coordinator = { rebuildAfterRecovery: vi.fn().mockResolvedValue(scanning) }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'rebuild-corrupt-workspace'
    })).resolves.toEqual(scanning)
    expect(coordinator.rebuildAfterRecovery).toHaveBeenCalledWith('100')
  })

  it('accepts only bounded source folder ids for a controlled source selection', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      selectSourceFolders: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'select-source-folders', folderIds: ['source-a', 'source-b']
    })).resolves.toEqual(snapshot)
    expect(coordinator.selectSourceFolders).toHaveBeenCalledWith('100', ['source-a', 'source-b'])
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'select-source-folders', folderIds: ['source-a', { id: 'source-b' }]
    })).rejects.toThrow('command is invalid')
  })

  it('routes a bounded local-ledger creation command only to the workspace coordinator', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      createLocalLedgerAndReclassify: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'create-local-ledger-and-reclassify', title: 'Music'
    })).resolves.toEqual(snapshot)
    expect(coordinator.createLocalLedgerAndReclassify).toHaveBeenCalledWith('100', 'Music')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'create-local-ledger-and-reclassify', title: 'Music', remoteFolderId: '999'
    })).rejects.toThrow('command is invalid')
  })

  it('routes strict draft-rule save and out-of-band cancel commands with scoped progress', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      saveDraftLedgerRule: vi.fn(async (_accountMid, _input, onProgress) => {
        onProgress({ workspaceId: 'workspace-1', analysisId: 'analysis-local-music', completedItemCount: 128, totalItemCount: 2_000 })
        return {}
      }),
      cancelDraftLedgerRuleAnalysis: vi.fn().mockReturnValue(true),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'save-draft-ledger-rule',
      analysisId: 'analysis-local-music',
      title: ' Music ',
      keywords: [' 音乐 ', 'Music'],
      ruleType: 'keyword'
    })).resolves.toEqual(snapshot)
    expect(coordinator.saveDraftLedgerRule).toHaveBeenCalledWith('100', {
      analysisId: 'analysis-local-music',
      title: 'Music',
      keywords: ['音乐', 'Music'],
      ruleType: 'keyword'
    }, expect.any(Function))
    expect(ipcMain.send).toHaveBeenCalledWith('old-favorite-workspace-v1:rule-analysis-progress', {
      accountMid: '100',
      workspaceId: 'workspace-1',
      analysisId: 'analysis-local-music',
      completedItemCount: 128,
      totalItemCount: 2_000
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'cancel-draft-ledger-rule-analysis', analysisId: 'analysis-local-music'
    })).resolves.toEqual(snapshot)
    expect(coordinator.cancelDraftLedgerRuleAnalysis).toHaveBeenCalledWith('100', 'analysis-local-music')

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'save-draft-ledger-rule',
      analysisId: 'analysis-local-music',
      title: 'Music',
      keywords: ['Music'],
      ruleType: 'keyword',
      matchedAidsBySegment: { 'segment-1': [1] }
    })).rejects.toThrow('command is invalid')
  })

  it('hands a draft-rule save to the coordinator before awaiting any snapshot so immediate cancel can observe it', async () => {
    const ipcMain = new FakeIpcMain()
    let resolveSnapshot!: (value: typeof snapshot) => void
    let resolveSave!: (value: object) => void
    const pendingSnapshot = new Promise<typeof snapshot>((resolve) => { resolveSnapshot = resolve })
    const pendingSave = new Promise<object>((resolve) => { resolveSave = resolve })
    const coordinator = {
      saveDraftLedgerRule: vi.fn(() => pendingSave),
      cancelDraftLedgerRuleAnalysis: vi.fn().mockReturnValue(true),
      getSnapshot: vi.fn(() => pendingSnapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    const saving = ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'save-draft-ledger-rule',
      analysisId: 'analysis-immediate-ipc',
      title: 'Immediate',
      keywords: ['Immediate'],
      ruleType: 'keyword'
    }) as Promise<unknown>
    await vi.waitFor(() => expect(
      coordinator.saveDraftLedgerRule.mock.calls.length + coordinator.getSnapshot.mock.calls.length
    ).toBeGreaterThan(0))
    const saveWasHandedOffBeforeSnapshot = coordinator.saveDraftLedgerRule.mock.calls.length === 1 &&
      coordinator.getSnapshot.mock.calls.length === 0

    resolveSnapshot(snapshot)
    resolveSave({})
    await saving
    expect(saveWasHandedOffBeforeSnapshot).toBe(true)
  })

  it('routes only explicit undo and redo commands to the controlled coordinator', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      undoClassificationChange: vi.fn().mockResolvedValue({}),
      redoClassificationChange: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'undo-classification' }))
      .resolves.toEqual(snapshot)
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'redo-classification' }))
      .resolves.toEqual(snapshot)
    expect(coordinator.undoClassificationChange).toHaveBeenCalledWith('100')
    expect(coordinator.redoClassificationChange).toHaveBeenCalledWith('100')
  })

  it('forwards only main-process DeepSeek chunk progress to the requesting renderer', async () => {
    const ipcMain = new FakeIpcMain()
    const deepSeekService = {
      organizeCurrentSegment: vi.fn(async (_accountMid: string, _mode: string, progress: (value: unknown) => void) => {
        progress({ totalChunks: 2, completedChunks: 1, successfulVideoCount: 20, failedVideoCount: 0 })
        return snapshot
      })
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: { getSnapshot: vi.fn().mockResolvedValue(snapshot) } as never, deepSeekService: deepSeekService as never,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:deepseek-current-segment', 7, '100', 'all')).resolves.toEqual(snapshot)
    expect(ipcMain.send).toHaveBeenCalledWith('old-favorite-workspace-v1:deepseek-progress', {
      accountMid: '100', workspaceId: 'workspace-1', totalChunks: 2, completedChunks: 1, successfulVideoCount: 20, failedVideoCount: 0
    })
  })

  it('retries failed DeepSeek chunks through a payload-free main-process endpoint', async () => {
    const ipcMain = new FakeIpcMain()
    const deepSeekService = {
      retryFailedChunks: vi.fn(async (_accountMid: string, progress: (value: unknown) => void) => {
        progress({ totalChunks: 1, completedChunks: 1, totalVideoCount: 1, successfulVideoCount: 1, failedVideoCount: 0 })
        return snapshot
      })
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: { getSnapshot: vi.fn().mockResolvedValue(snapshot) } as never, deepSeekService: deepSeekService as never,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:retry-failed-deepseek', 7, '100')).resolves.toEqual(snapshot)
    expect(deepSeekService.retryFailedChunks).toHaveBeenCalledWith('100', expect.any(Function))
    expect(ipcMain.send).toHaveBeenCalledWith('old-favorite-workspace-v1:deepseek-progress', {
      accountMid: '100', workspaceId: 'workspace-1', totalChunks: 1, completedChunks: 1, totalVideoCount: 1, successfulVideoCount: 1, failedVideoCount: 0
    })
    await expect(ipcMain.invoke('old-favorite-workspace-v1:retry-failed-deepseek', 7, '100', { aids: [1] }))
      .rejects.toThrow('arguments are invalid')
  })

  it('routes a bounded history cursor jump without accepting renderer classifications', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      moveHistoryCursor: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'move-history-cursor', cursor: 3
    })).resolves.toEqual(snapshot)
    expect(coordinator.moveHistoryCursor).toHaveBeenCalledWith('100', 3)
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'move-history-cursor', cursor: 3, assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })).rejects.toThrow('command is invalid')
  })

  it('runs automatic classification only through a payload-free main-process command', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      autoClassifyCurrentSegment: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'auto-classify-current-segment' }))
      .resolves.toEqual(snapshot)
    expect(coordinator.autoClassifyCurrentSegment).toHaveBeenCalledWith('100')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'auto-classify-current-segment', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })).rejects.toThrow('command is invalid')
  })

  it('accepts only candidate ids when changing main-process recommendation adoption', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      setRecommendedCandidates: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'set-recommended-candidates', candidateIds: ['custom-author-up-alpha']
    })).resolves.toEqual(snapshot)
    expect(coordinator.setRecommendedCandidates).toHaveBeenCalledWith('100', ['custom-author-up-alpha'])
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'set-recommended-candidates', candidates: [{ id: 'custom-author-up-alpha', keywords: ['forged'] }]
    })).rejects.toThrow('command is invalid')
  })

  it('allows a controlled Bilibili freeze command without accepting renderer operations', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      freezeForBilibiliExecution: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'freeze-bilibili-execution'
    })).resolves.toEqual(snapshot)
    expect(coordinator.freezeForBilibiliExecution).toHaveBeenCalledWith('100')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'freeze-bilibili-execution', operations: [{ aid: 1 }]
    })).rejects.toThrow('command is invalid')
  })

  it('saves a local-only current segment without accepting renderer memberships', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      saveCurrentSegmentToLocalLibrary: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue({ ...snapshot, status: 'completed' })
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'save-current-segment-locally' }))
      .resolves.toMatchObject({ status: 'completed' })
    expect(coordinator.saveCurrentSegmentToLocalLibrary).toHaveBeenCalledWith('100')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'save-current-segment-locally', memberAidsByFolderId: { 'local:music': [1] }
    })).rejects.toThrow('command is invalid')
  })

  it('abandons a pending workspace only through an exact payload-free command', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      abandonCurrentWorkspace: vi.fn().mockResolvedValue(undefined),
      getSnapshot: vi.fn().mockResolvedValue(null)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'abandon-current-workspace' }))
      .resolves.toBeNull()
    expect(coordinator.abandonCurrentWorkspace).toHaveBeenCalledWith('100')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'abandon-current-workspace', workspaceId: 'renderer-forged'
    })).rejects.toThrow('command is invalid')
  })

  it('queues and cancels an exact whole-run execution intent in the main process', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      setExecutionIntent: vi.fn().mockResolvedValue(undefined),
      continueExecutionIntent: vi.fn().mockResolvedValue(false),
      getSnapshot: vi.fn().mockResolvedValue({
        ...snapshot, executionIntent: { mode: 'local', status: 'waiting', waitingSegmentCount: 1, waitingForDeepSeek: false }
      })
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'set-whole-run-execution-intent', mode: 'local'
    })).resolves.toMatchObject({ executionIntent: { mode: 'local', status: 'waiting' } })
    expect(coordinator.setExecutionIntent).toHaveBeenNthCalledWith(1, '100', 'local')
    expect(coordinator.continueExecutionIntent).toHaveBeenCalledWith('100')

    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'cancel-whole-run-execution-intent'
    })
    expect(coordinator.setExecutionIntent).toHaveBeenNthCalledWith(2, '100', null)
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'set-whole-run-execution-intent', mode: 'local', operations: []
    })).rejects.toThrow('command is invalid')
  })

  it('resumes a persisted whole-run execution intent when the workspace is reopened', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue({
        ...snapshot, executionIntent: { mode: 'local', status: 'waiting', waitingSegmentCount: 0, waitingForDeepSeek: false }
      }),
      continueExecutionIntent: vi.fn().mockResolvedValue(true)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:open', 7, '100')).resolves.toMatchObject({
      executionIntent: { mode: 'local', status: 'waiting' }
    })
    expect(coordinator.continueExecutionIntent).toHaveBeenCalledWith('100')
  })

  it('prepares recommendation preview with progress and cancels it through an out-of-band command', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      prepareRecommendationPreview: vi.fn(async (_accountMid, _candidateIds, onProgress) => {
        onProgress({ completedItemCount: 128, totalItemCount: 2_000 })
        return snapshot
      }),
      cancelRecommendationPreviewPreparation: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(snapshot)
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'prepare-recommendation-preview', candidateIds: ['custom-author-up-alpha']
    })).resolves.toEqual(snapshot)
    expect(coordinator.prepareRecommendationPreview).toHaveBeenCalledWith(
      '100', ['custom-author-up-alpha'], expect.any(Function)
    )
    expect(ipcMain.send).toHaveBeenCalledWith('old-favorite-workspace-v1:preview-preparation-progress', {
      accountMid: '100', workspaceId: 'workspace-1', completedItemCount: 128, totalItemCount: 2_000
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'cancel-recommendation-preview-preparation'
    })).resolves.toEqual(snapshot)
    expect(coordinator.cancelRecommendationPreviewPreparation).toHaveBeenCalledWith('100')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'prepare-recommendation-preview', candidateIds: ['custom-author-up-alpha'], classifications: []
    })).rejects.toThrow('command is invalid')
  })

  it('routes execution only after the main-process frozen plan exists', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      executeFrozenBilibiliPlan: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue({ ...snapshot, status: 'executing' })
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'execute-frozen-bilibili-plan'
    })).resolves.toMatchObject({ status: 'executing' })
    expect(coordinator.executeFrozenBilibiliPlan).toHaveBeenCalledWith('100')
  })

  it('returns the persisted execution snapshot without waiting for remote Bilibili work', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      beginBilibiliExecution: vi.fn().mockResolvedValue({ ...snapshot, status: 'executing' })
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', {
      type: 'confirm-and-execute-bilibili-plan'
    })).resolves.toMatchObject({ status: 'executing' })
    expect(coordinator.beginBilibiliExecution).toHaveBeenCalledOnce()
    expect(coordinator.beginBilibiliExecution).toHaveBeenCalledWith('100')
  })

  it('requires explicit reconciliation and only then allows a no-rebind resume command', async () => {
    const ipcMain = new FakeIpcMain()
    const coordinator = {
      bindAndReconcileFrozenBilibiliPlan: vi.fn().mockResolvedValue({}),
      resumeReconciledBilibiliPlan: vi.fn().mockResolvedValue({}),
      getSnapshot: vi.fn().mockResolvedValue({ ...snapshot, status: 'reconciling' })
    }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: coordinator as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'reconcile-frozen-bilibili-plan' })
    await ipcMain.invoke('old-favorite-workspace-v1:command', 7, '100', { type: 'resume-reconciled-bilibili-plan' })
    expect(coordinator.bindAndReconcileFrozenBilibiliPlan).toHaveBeenCalledWith('100')
    expect(coordinator.resumeReconciledBilibiliPlan).toHaveBeenCalledWith('100')
  })
})

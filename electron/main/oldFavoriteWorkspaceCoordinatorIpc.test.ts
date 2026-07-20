import { describe, expect, it, vi } from 'vitest'
import { registerOldFavoriteWorkspaceCoordinatorIpc } from './oldFavoriteWorkspaceCoordinatorIpc'

class FakeIpcMain {
  handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
  handle(channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) {
    this.handlers.set(channel, handler)
  }
  invoke(channel: string, senderId: number, ...args: unknown[]) {
    return this.handlers.get(channel)?.({ sender: { id: senderId } }, ...args as never[])
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

  it('runs DeepSeek only through a main-process current-segment service with no renderer result payload', async () => {
    const ipcMain = new FakeIpcMain()
    const deepSeekService = { organizeCurrentSegment: vi.fn().mockResolvedValue(snapshot) }
    registerOldFavoriteWorkspaceCoordinatorIpc({
      ipcMain, coordinator: {} as never, deepSeekService: deepSeekService as never,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('old-favorite-workspace-v1:deepseek-current-segment', 7, '100')).resolves.toEqual(snapshot)
    expect(deepSeekService.organizeCurrentSegment).toHaveBeenCalledWith('100')
    await expect(ipcMain.invoke('old-favorite-workspace-v1:deepseek-current-segment', 7, '100', { results: [] }))
      .rejects.toThrow('arguments are invalid')
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

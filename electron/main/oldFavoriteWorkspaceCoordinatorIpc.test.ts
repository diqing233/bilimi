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

  it('allows only validated selection and manual-classification commands', async () => {
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
})

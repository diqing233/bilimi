import { describe, expect, it, vi } from 'vitest'
import { registerOldFavoriteWorkspaceIpc } from './oldFavoriteWorkspaceIpc'

class FakeIpcMain {
  handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
  handle(channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) {
    this.handlers.set(channel, handler)
  }
  invoke(channel: string, senderId: number, ...args: unknown[]) {
    return this.handlers.get(channel)?.({ sender: { id: senderId } }, ...args as never[])
  }
}

describe('registerOldFavoriteWorkspaceIpc', () => {
  it('opens the account index and loads batch details only through trusted explicit calls', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      openAccount: vi.fn().mockResolvedValue({ version: 2, accountMid: '42', batches: [] }),
      recoverBatch: vi.fn().mockResolvedValue({ discardedTail: null }),
      loadBatch: vi.fn().mockResolvedValue({ summary: { id: 'b1' }, base: [] })
    }
    registerOldFavoriteWorkspaceIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: (id) => id === 7
    })

    expect(service.openAccount).not.toHaveBeenCalled()
    await expect(ipcMain.invoke('old-favorite-workspace:open-account', 7, '42')).resolves.toMatchObject({ accountMid: '42' })
    expect(service.loadBatch).not.toHaveBeenCalled()
    await expect(ipcMain.invoke('old-favorite-workspace:recover-batch', 7, '42', 'b1')).resolves.toEqual({ discardedTail: null })
    expect(service.recoverBatch).toHaveBeenCalledWith('42', 'b1')
    await expect(ipcMain.invoke('old-favorite-workspace:load-batch', 7, '42', 'b1')).resolves.toMatchObject({ summary: { id: 'b1' } })
    expect(() => ipcMain.invoke('old-favorite-workspace:open-account', 99, '42')).toThrow('untrusted renderer')
  })

  it('publishes only lightweight keyed progress to matching subscribers', () => {
    const ipcMain = new FakeIpcMain()
    const send = vi.fn()
    const service = { openAccount: vi.fn() }
    const registration = registerOldFavoriteWorkspaceIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: () => true,
      send
    })
    ipcMain.invoke('old-favorite-workspace:subscribe', 7, '42', 'b1')
    ipcMain.invoke('old-favorite-workspace:subscribe', 8, '42', 'b2')

    registration.publishProgress('42', 'b1', { completed: 26, total: 100 })

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(7, 'old-favorite-workspace:progress', {
      accountMid: '42', batchId: 'b1', progress: { completed: 26, total: 100 }
    })
  })

  it('forwards batch lifecycle writes without exposing a Bilibili mutation path', async () => {
    const ipcMain = new FakeIpcMain()
    const onMutation = vi.fn()
    const service = {
      createBatch: vi.fn().mockResolvedValue({ id: 'b1' }),
      appendChunk: vi.fn().mockResolvedValue({ file: 'base-000001.jsonl' }),
      appendChunkGroup: vi.fn().mockResolvedValue([
        { file: 'base-000002.jsonl' },
        { file: 'tags-000001.jsonl' },
        { file: 'sources-000001.jsonl' }
      ]),
      patchOverlay: vi.fn().mockResolvedValue(undefined),
      finalizeBatch: vi.fn().mockResolvedValue({ id: 'b1', status: 'archived' }),
      resetAccount: vi.fn().mockResolvedValue(undefined)
    }
    registerOldFavoriteWorkspaceIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: () => true,
      onMutation
    })

    await ipcMain.invoke('old-favorite-workspace:create-batch', 7, { accountMid: '42', kind: 'full', id: 'b1' })
    await ipcMain.invoke('old-favorite-workspace:append-chunk', 7, '42', 'b1', 'base', [{ aid: 1 }])
    const group = {
      base: [{ aid: 2 }],
      tags: [{ aid: 2, tags: ['tag'] }],
      sources: [{ aid: 2, sourceFolderIds: ['source'] }]
    }
    await ipcMain.invoke('old-favorite-workspace:append-chunk-group', 7, '42', 'b1', group)
    await ipcMain.invoke('old-favorite-workspace:patch-overlay', 7, '42', 'b1', 'user', { aid: 1, targets: ['game'] })
    await ipcMain.invoke('old-favorite-workspace:finalize-batch', 7, '42', 'b1')
    await ipcMain.invoke('old-favorite-workspace:reset-account', 7, '42')

    expect(service.createBatch).toHaveBeenCalledWith({ accountMid: '42', kind: 'full', id: 'b1' })
    expect(service.appendChunk).toHaveBeenCalledWith('42', 'b1', 'base', [{ aid: 1 }])
    expect(service.appendChunkGroup).toHaveBeenCalledWith('42', 'b1', group)
    expect(service.patchOverlay).toHaveBeenCalledWith('42', 'b1', 'user', { aid: 1, targets: ['game'] })
    expect(service.finalizeBatch).toHaveBeenCalledWith('42', 'b1')
    expect(service.resetAccount).toHaveBeenCalledWith('42')
    expect(onMutation.mock.calls).toEqual([
      [true], [false], [true], [false], [true], [false],
      [true], [false], [true], [false], [true], [false]
    ])
    expect(ipcMain.handlers.has('old-favorite-workspace:mutate-bilibili')).toBe(false)
  })

  it('does not mark persistence dirty when a workspace write fails before completing work', async () => {
    const ipcMain = new FakeIpcMain()
    const onMutation = vi.fn()
    registerOldFavoriteWorkspaceIpc({
      ipcMain,
      service: { createBatch: vi.fn().mockRejectedValue(new Error('disk full')) } as never,
      isTrustedSender: () => true,
      onMutation
    })

    await expect(ipcMain.invoke('old-favorite-workspace:create-batch', 7, {
      accountMid: '42', kind: 'full', id: 'b1'
    })).rejects.toThrow('disk full')
    expect(onMutation.mock.calls).toEqual([[true]])
  })

  it('marks a workspace write dirty before awaiting the filesystem mutation', async () => {
    const ipcMain = new FakeIpcMain()
    let resolveWrite!: (value: { id: string }) => void
    const onMutation = vi.fn((dirty: boolean) => dirty ? Symbol('pending-write') : undefined)
    registerOldFavoriteWorkspaceIpc({
      ipcMain,
      service: { createBatch: vi.fn(() => new Promise((resolve) => { resolveWrite = resolve })) } as never,
      isTrustedSender: () => true,
      onMutation
    })

    const writing = ipcMain.invoke('old-favorite-workspace:create-batch', 7, {
      accountMid: '42', kind: 'full', id: 'b1'
    })

    expect(onMutation).toHaveBeenCalledWith(true)
    resolveWrite({ id: 'b1' })
    await writing
  })

  it('finishes only the mutation token returned for a successful workspace write', async () => {
    const ipcMain = new FakeIpcMain()
    const mutation = Symbol('workspace-mutation')
    const onMutation = vi.fn((dirty: boolean) => dirty ? mutation : undefined)
    registerOldFavoriteWorkspaceIpc({
      ipcMain,
      service: { createBatch: vi.fn().mockResolvedValue({ id: 'b1' }) } as never,
      isTrustedSender: () => true,
      onMutation
    })

    await ipcMain.invoke('old-favorite-workspace:create-batch', 7, {
      accountMid: '42', kind: 'full', id: 'b1'
    })

    expect(onMutation.mock.calls).toEqual([[true], [false, mutation]])
  })

  it('tracks recovery writes as a bounded persistence mutation', async () => {
    const ipcMain = new FakeIpcMain()
    const mutation = Symbol('recovery-mutation')
    const onMutation = vi.fn((dirty: boolean) => dirty ? mutation : undefined)
    const service = { recoverBatch: vi.fn().mockResolvedValue({ discardedTail: 'base-000001.jsonl' }) }
    registerOldFavoriteWorkspaceIpc({
      ipcMain, service: service as never, isTrustedSender: () => true, onMutation
    })

    await expect(ipcMain.invoke(
      'old-favorite-workspace:recover-batch', 7, '42', 'b1'
    )).resolves.toEqual({ discardedTail: 'base-000001.jsonl' })
    expect(onMutation.mock.calls).toEqual([[true], [false, mutation]])
  })

  it('keeps recovery persistence dirty when repair fails', async () => {
    const ipcMain = new FakeIpcMain()
    const onMutation = vi.fn()
    registerOldFavoriteWorkspaceIpc({
      ipcMain,
      service: { recoverBatch: vi.fn().mockRejectedValue(new Error('disk full')) } as never,
      isTrustedSender: () => true,
      onMutation
    })

    await expect(ipcMain.invoke(
      'old-favorite-workspace:recover-batch', 7, '42', 'b1'
    )).rejects.toThrow('disk full')
    expect(onMutation.mock.calls).toEqual([[true]])
  })
})

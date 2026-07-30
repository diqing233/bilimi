import { describe, expect, it, vi } from 'vitest'
import { registerVideoNoteBatchExportIpc } from './videoNoteExportIpc'

class FakeIpcMain {
  handlers = new Map<string, (event: { sender: { id: number; once?: (event: 'destroyed', listener: () => void) => void } }, ...args: never[]) => unknown>()
  destroyed = new Map<number, () => void>()
  handle(channel: string, handler: (event: { sender: { id: number; once?: (event: 'destroyed', listener: () => void) => void } }, ...args: never[]) => unknown) { this.handlers.set(channel, handler) }
  invoke(channel: string, ...args: unknown[]) { return this.invokeFor(7, channel, ...args) }
  invokeFor(senderId: number, channel: string, ...args: unknown[]) {
    return this.handlers.get(channel)?.({ sender: { id: senderId, once: (_event, listener) => this.destroyed.set(senderId, listener) } }, ...args as never[])
  }
  destroy(senderId: number) { this.destroyed.get(senderId)?.() }
}

describe('video note batch export IPC', () => {
  it('accepts a full-result archive selection beyond one visible page', async () => {
    const ipcMain = new FakeIpcMain()
    const selections = Array.from({ length: 501 }, (_, index) => ({ archiveId: `a${index}`, versionId: `v${index}` }))
    const archives = selections.map(({ archiveId, versionId }) => ({ id: archiveId, source: { accountMid: '100' }, versions: [{ id: versionId }] }))
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', archives: () => archives,
      chooseParentDirectory: vi.fn(), start: vi.fn(), openFolder: vi.fn()
    })

    await expect(ipcMain.invoke('video-note-archives:batch-preview', {
      accountMid: '100', selections, formats: ['markdown']
    })).resolves.toMatchObject({ selectedCount: 501, exportableCount: 501 })
  })

  it('accepts every supported single-item DeepSeek export section', async () => {
    const ipcMain = new FakeIpcMain()
    const start = vi.fn(async () => ({ folderPath: 'C:\\chosen', succeededCount: 1, skippedCount: 0, failedCount: 0 }))
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100',
      archives: () => [{ id: 'a1', source: { accountMid: '100' }, versions: [{ id: 'v1' }] }],
      chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), start, openFolder: vi.fn()
    })

    for (const currentContent of ['summary-precise', 'summary-outline', 'summary-polished'] as const) {
      await ipcMain.invoke('video-note-archives:batch-start', {
        batchId: currentContent, accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }],
        formats: ['markdown'], scope: 'current', currentContent
      })
    }

    expect(start).toHaveBeenCalledTimes(3)
  })

  it('binds stable batch IDs, progress, cancellation and completed-folder opening to the originating renderer', async () => {
    const ipcMain = new FakeIpcMain()
    let progress: ((value: unknown) => void) | undefined
    const start = vi.fn().mockImplementation(async (request) => { request.onProgress({ completedCount: 1 }); progress = request.onProgress; return { folderPath: 'C:\\chosen\\bilimi文稿', succeededCount: 1, skippedCount: 0, failedCount: 0 } })
    const openFolder = vi.fn()
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder,
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }], start
    })
    await expect(ipcMain.invoke('video-note-archives:batch-preview', { accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown', 'word'] })).resolves.toMatchObject({ selectedCount: 1, exportableCount: 1 })
    await expect(ipcMain.invoke('video-note-archives:batch-start', { accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: [] })).rejects.toThrow('format')
    const result = await ipcMain.invoke('video-note-archives:batch-start', { batchId: 'batch-1', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown', 'word'] })
    expect(result).toMatchObject({ succeededCount: 1, batchId: 'batch-1' })
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ parentDirectory: 'C:\\chosen', selections: [{ archiveId: 'a1', versionId: 'v1' }] }))
    expect(ipcMain.handlers.has('video-note-archives:batch-cancel')).toBe(true)
    await ipcMain.invoke('video-note-archives:batch-open-folder', { accountMid: '100', batchId: (result as { batchId: string }).batchId })
    expect(openFolder).toHaveBeenCalledWith('C:\\chosen\\bilimi文稿')
    await expect(ipcMain.invoke('video-note-archives:batch-open-folder', { accountMid: '100', batchId: 'another-renderer-batch' })).rejects.toThrow('invalid')
    progress?.({ completedCount: 2 })
  })

  it('refuses overlapping starts from one renderer and only cancels the active stable batch', async () => {
    const ipcMain = new FakeIpcMain()
    let release: (() => void) | undefined
    let receivedSignal: AbortSignal | undefined
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder: vi.fn(),
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }],
      start: vi.fn((request) => new Promise((resolve) => { receivedSignal = request.signal; release = () => resolve({ folderPath: 'C:\\chosen\\bilimi文稿', succeededCount: 0, skippedCount: 0, failedCount: 0 }) }))
    })
    const request = { accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] }
    const first = ipcMain.invoke('video-note-archives:batch-start', { ...request, batchId: 'batch-1' })
    await vi.waitFor(() => expect(receivedSignal).toBeDefined())
    await expect(ipcMain.invoke('video-note-archives:batch-start', { ...request, batchId: 'batch-2' })).rejects.toThrow('already active')
    await expect(ipcMain.invoke('video-note-archives:batch-cancel', { batchId: 'batch-2', accountMid: '100' })).resolves.toBe(false)
    await expect(ipcMain.invoke('video-note-archives:batch-cancel', { batchId: 'batch-1', accountMid: '100' })).resolves.toBe(true)
    expect(receivedSignal?.aborted).toBe(true)
    release?.()
    await first
  })

  it('requires a stable batch ID to cancel and keeps the output folder available after user cancellation', async () => {
    const ipcMain = new FakeIpcMain()
    let release: (() => void) | undefined
    const openFolder = vi.fn()
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder,
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }],
      start: vi.fn(() => new Promise((resolve) => { release = () => resolve({ folderPath: 'C:\\chosen\\partial', succeededCount: 1, skippedCount: 0, failedCount: 0, canceled: true }) }))
    })
    const running = ipcMain.invoke('video-note-archives:batch-start', { batchId: 'partial', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] })
    await vi.waitFor(() => expect(release).toBeDefined())
    expect(await ipcMain.invoke('video-note-archives:batch-cancel', { accountMid: '100' })).toBe(false)
    expect(await ipcMain.invoke('video-note-archives:batch-cancel', { batchId: 'partial', accountMid: '100' })).toBe(true)
    release?.()
    await running
    await ipcMain.invoke('video-note-archives:batch-open-folder', { batchId: 'partial', accountMid: '100' })
    expect(openFolder).toHaveBeenCalledWith('C:\\chosen\\partial')
  })

  it('reserves a renderer before directory choice, rejects batch ID replay, and aborts work when that renderer is destroyed', async () => {
    const ipcMain = new FakeIpcMain()
    let choose: ((path: string) => void) | undefined
    let signal: AbortSignal | undefined
    const chooseParentDirectory = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { choose = resolve }))
      .mockResolvedValue('C:\\chosen')
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', openFolder: vi.fn(),
      chooseParentDirectory,
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }],
      start: vi.fn(async (request) => { signal = request.signal; return { folderPath: 'C:\\chosen\\bilimi文稿', succeededCount: 1, skippedCount: 0, failedCount: 0 } })
    })
    const request = { batchId: 'reserved', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] }
    const first = ipcMain.invokeFor(7, 'video-note-archives:batch-start', request)
    await vi.waitFor(() => expect(choose).toBeDefined())
    await expect(ipcMain.invokeFor(7, 'video-note-archives:batch-start', { ...request, batchId: 'another' })).rejects.toThrow('already active')
    ipcMain.destroy(7)
    choose?.('C:\\chosen')
    await expect(first).resolves.toBeUndefined()
    expect(signal).toBeUndefined()

    const completed = await ipcMain.invokeFor(7, 'video-note-archives:batch-start', request)
    expect(completed).toMatchObject({ batchId: 'reserved' })
    await expect(ipcMain.invokeFor(7, 'video-note-archives:batch-start', request)).rejects.toThrow('cannot be reused')
  })

  it('bounds completed folder grants and keeps them within the originating window account and session', async () => {
    const ipcMain = new FakeIpcMain()
    const openFolder = vi.fn()
    const registry = registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder,
      completedFolderLimit: 2,
      archives: () => [
        { id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] },
        { id: 'a2', source: { accountMid: '200', title: 'Other account', tags: [], url: '' }, versions: [{ id: 'v2' }] }
      ],
      start: vi.fn(async (request) => ({ folderPath: `C:\\chosen\\${request.selections[0].archiveId}`, succeededCount: 1, skippedCount: 0, failedCount: 0 }))
    })
    const request = (accountMid: string, archiveId: string, versionId: string, batchId: string) => ({ accountMid, batchId, selections: [{ archiveId, versionId }], formats: ['markdown'] })

    await ipcMain.invokeFor(7, 'video-note-archives:batch-start', request('100', 'a1', 'v1', 'first'))
    await ipcMain.invokeFor(7, 'video-note-archives:batch-start', request('100', 'a1', 'v1', 'second'))
    await ipcMain.invokeFor(7, 'video-note-archives:batch-start', request('100', 'a1', 'v1', 'third'))

    await expect(ipcMain.invokeFor(7, 'video-note-archives:batch-open-folder', { accountMid: '100', batchId: 'first' })).rejects.toThrow('invalid')
    await expect(ipcMain.invokeFor(8, 'video-note-archives:batch-open-folder', { accountMid: '100', batchId: 'third' })).rejects.toThrow('invalid')
    await expect(ipcMain.invokeFor(7, 'video-note-archives:batch-open-folder', { accountMid: '200', batchId: 'third' })).rejects.toThrow('current account')
    await ipcMain.invokeFor(7, 'video-note-archives:batch-open-folder', { accountMid: '100', batchId: 'third' })
    expect(openFolder).toHaveBeenCalledWith('C:\\chosen\\a1')

    registry.clearCompletedFoldersForAccount('100')
    await expect(ipcMain.invokeFor(7, 'video-note-archives:batch-open-folder', { accountMid: '100', batchId: 'third' })).rejects.toThrow('invalid')
    expect(openFolder).toHaveBeenCalledTimes(1)

    ipcMain.destroy(7)
    await expect(ipcMain.invokeFor(7, 'video-note-archives:batch-open-folder', { accountMid: '100', batchId: 'third' })).rejects.toThrow('invalid')
  })

  it('normalizes a positive fractional completed-folder limit to one grant', async () => {
    const ipcMain = new FakeIpcMain()
    const openFolder = vi.fn()
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', completedFolderLimit: 0.5,
      chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder,
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }],
      start: vi.fn(async () => ({ folderPath: 'C:\\chosen\\single', succeededCount: 1, skippedCount: 0, failedCount: 0 }))
    })
    await ipcMain.invoke('video-note-archives:batch-start', { batchId: 'fractional', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] })
    await ipcMain.invoke('video-note-archives:batch-open-folder', { batchId: 'fractional', accountMid: '100' })
    expect(openFolder).toHaveBeenCalledWith('C:\\chosen\\single')
  })

  it('rejects a stale account before preview, start, cancel, and opening its completed folder', async () => {
    const ipcMain = new FakeIpcMain()
    let currentAccountMid = '100'
    const openFolder = vi.fn()
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => currentAccountMid,
      chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder,
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }],
      start: vi.fn(async () => ({ folderPath: 'C:\\chosen\\bilimi文稿', succeededCount: 1, skippedCount: 0, failedCount: 0 }))
    })
    const request = { batchId: 'account-bound', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] }
    await ipcMain.invoke('video-note-archives:batch-start', request)
    currentAccountMid = '200'
    await expect(ipcMain.invoke('video-note-archives:batch-preview', request)).rejects.toThrow('current account')
    await expect(ipcMain.invoke('video-note-archives:batch-start', { ...request, batchId: 'new-batch' })).rejects.toThrow('current account')
    await expect(ipcMain.invoke('video-note-archives:batch-open-folder', { accountMid: '100', batchId: 'account-bound' })).rejects.toThrow('current account')
    await expect(ipcMain.invoke('video-note-archives:batch-cancel', { batchId: 'account-bound', accountMid: '100' })).rejects.toThrow('current account')
    expect(openFolder).not.toHaveBeenCalled()
  })

  it('rejects a preview when the Bilibili account changes while archive identities are being resolved', async () => {
    const ipcMain = new FakeIpcMain()
    let currentAccountMid = '100'
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => currentAccountMid,
      chooseParentDirectory: vi.fn(), openFolder: vi.fn(), start: vi.fn(),
      archives: () => {
        currentAccountMid = '200'
        return [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }]
      }
    })

    await expect(ipcMain.invoke('video-note-archives:batch-preview', {
      accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown']
    })).rejects.toThrow('current account')
  })

  it('aborts an active account export during account cleanup and never restores its folder grant', async () => {
    const ipcMain = new FakeIpcMain()
    let resolveStart: ((value: { folderPath: string; succeededCount: number; skippedCount: number; failedCount: number }) => void) | undefined
    let signal: AbortSignal | undefined
    const registry = registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100',
      chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder: vi.fn(),
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }],
      start: vi.fn((request) => new Promise((resolve) => { signal = request.signal; resolveStart = resolve }))
    })
    const request = { batchId: 'cleaned', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] }
    const running = ipcMain.invoke('video-note-archives:batch-start', request)
    await vi.waitFor(() => expect(signal).toBeDefined())
    registry.clearCompletedFoldersForAccount('100')
    expect(signal?.aborted).toBe(true)
    resolveStart?.({ folderPath: 'C:\\chosen\\bilimi文稿', succeededCount: 1, skippedCount: 0, failedCount: 0 })
    await running
    await expect(ipcMain.invoke('video-note-archives:batch-open-folder', { accountMid: '100', batchId: 'cleaned' })).rejects.toThrow('invalid')
  })

  it('rechecks the current account after directory selection before starting an export', async () => {
    const ipcMain = new FakeIpcMain()
    let currentAccountMid = '100'
    let choose: ((path: string) => void) | undefined
    const start = vi.fn()
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => currentAccountMid,
      chooseParentDirectory: vi.fn(() => new Promise<string>((resolve) => { choose = resolve })), openFolder: vi.fn(), start,
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }]
    })
    const running = ipcMain.invoke('video-note-archives:batch-start', { batchId: 'picker-race', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] })
    await vi.waitFor(() => expect(choose).toBeDefined())
    currentAccountMid = '200'
    choose?.('C:\\chosen')
    await expect(running).rejects.toThrow('current account')
    expect(start).not.toHaveBeenCalled()
  })

  it('re-resolves archive identities after directory selection and leaves a vanished version for the batch to skip', async () => {
    const ipcMain = new FakeIpcMain()
    let resolveDirectory: ((path: string) => void) | undefined
    let archives = [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }]
    const start = vi.fn(async () => ({ folderPath: 'C:\\chosen\\bilimi文稿', succeededCount: 0, skippedCount: 1, failedCount: 0 }))
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', openFolder: vi.fn(), start,
      chooseParentDirectory: vi.fn(() => new Promise<string>((resolve) => { resolveDirectory = resolve })), archives: () => archives
    })

    const running = ipcMain.invoke('video-note-archives:batch-start', { batchId: 'stale-picker', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] })
    await vi.waitFor(() => expect(resolveDirectory).toBeDefined())
    archives = []
    resolveDirectory?.('C:\\chosen')

    await expect(running).resolves.toMatchObject({ skippedCount: 1 })
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ archives: [], selections: [{ archiveId: 'a1', versionId: 'v1' }] }))
  })

  it('rejects a selected archive that becomes owned by another account while choosing a directory', async () => {
    const ipcMain = new FakeIpcMain()
    let resolveDirectory: ((path: string) => void) | undefined
    let archives = [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }]
    const start = vi.fn()
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', openFolder: vi.fn(), start,
      chooseParentDirectory: vi.fn(() => new Promise<string>((resolve) => { resolveDirectory = resolve })), archives: () => archives
    })

    const running = ipcMain.invoke('video-note-archives:batch-start', { batchId: 'foreign-replacement', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] })
    await vi.waitFor(() => expect(resolveDirectory).toBeDefined())
    archives = [{ id: 'a1', source: { accountMid: '200', title: 'Other account', tags: [], url: '' }, versions: [{ id: 'v1' }] }]
    resolveDirectory?.('C:\\chosen')

    await expect(running).rejects.toThrow('stale')
    expect(start).not.toHaveBeenCalled()
  })

  it('keeps valid selections when a same-account archive version is already unavailable', async () => {
    const ipcMain = new FakeIpcMain()
    const start = vi.fn(async (request) => ({ folderPath: 'C:\\chosen\\bilimi文稿', succeededCount: 1, skippedCount: 1, failedCount: 0, selections: request.selections }))
    registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100', chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder: vi.fn(), start,
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }]
    })
    const request = { batchId: 'mixed-stale', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }, { archiveId: 'a1', versionId: 'gone' }], formats: ['markdown'] }

    await expect(ipcMain.invoke('video-note-archives:batch-preview', request)).resolves.toMatchObject({ selectedCount: 2, exportableCount: 1, skippedCount: 1 })
    await expect(ipcMain.invoke('video-note-archives:batch-start', request)).resolves.toMatchObject({ succeededCount: 1, skippedCount: 1 })
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ selections: request.selections }))
  })

  it('does not let an invalidated export remove a newer account reservation', async () => {
    const ipcMain = new FakeIpcMain()
    let currentAccountMid = '100'
    let resolveOld: ((value: { folderPath: string; succeededCount: number; skippedCount: number; failedCount: number }) => void) | undefined
    let resolveNew: ((value: { folderPath: string; succeededCount: number; skippedCount: number; failedCount: number }) => void) | undefined
    let newSignal: AbortSignal | undefined
    const registry = registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => currentAccountMid,
      chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder: vi.fn(),
      archives: () => [
        { id: 'a1', source: { accountMid: '100', title: 'Old', tags: [], url: '' }, versions: [{ id: 'v1' }] },
        { id: 'a2', source: { accountMid: '200', title: 'New', tags: [], url: '' }, versions: [{ id: 'v2' }] }
      ],
      start: vi.fn((request) => request.selections[0].archiveId === 'a1'
        ? new Promise((resolve) => { resolveOld = resolve })
        : new Promise((resolve) => { newSignal = request.signal; resolveNew = resolve }))
    })
    const oldBatch = ipcMain.invoke('video-note-archives:batch-start', { batchId: 'old', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] })
    await vi.waitFor(() => expect(resolveOld).toBeDefined())
    registry.clearCompletedFoldersForAccount('100')
    currentAccountMid = '200'
    const newBatch = ipcMain.invoke('video-note-archives:batch-start', { batchId: 'new', accountMid: '200', selections: [{ archiveId: 'a2', versionId: 'v2' }], formats: ['markdown'] })
    await vi.waitFor(() => expect(newSignal).toBeDefined())
    resolveOld?.({ folderPath: 'C:\\chosen\\old', succeededCount: 1, skippedCount: 0, failedCount: 0 })
    await expect(oldBatch).rejects.toThrow('current account')
    expect(await ipcMain.invoke('video-note-archives:batch-cancel', { batchId: 'new', accountMid: '200' })).toBe(true)
    expect(newSignal?.aborted).toBe(true)
    resolveNew?.({ folderPath: 'C:\\chosen\\new', succeededCount: 1, skippedCount: 0, failedCount: 0 })
    await newBatch
  })

  it('clears every sender grant and active export when the Bilibili session account changes', async () => {
    const ipcMain = new FakeIpcMain()
    let resolveStart: ((value: { folderPath: string; succeededCount: number; skippedCount: number; failedCount: number }) => void) | undefined
    let signal: AbortSignal | undefined
    const registry = registerVideoNoteBatchExportIpc({
      ipcMain, isTrustedSender: () => true, getCurrentAccountMid: async () => '100',
      chooseParentDirectory: vi.fn().mockResolvedValue('C:\\chosen'), openFolder: vi.fn(),
      archives: () => [{ id: 'a1', source: { accountMid: '100', title: 'Saved', tags: [], url: '' }, versions: [{ id: 'v1' }] }],
      start: vi.fn((request) => new Promise((resolve) => { signal = request.signal; resolveStart = resolve }))
    })
    const running = ipcMain.invoke('video-note-archives:batch-start', { batchId: 'session-change', accountMid: '100', selections: [{ archiveId: 'a1', versionId: 'v1' }], formats: ['markdown'] })
    await vi.waitFor(() => expect(signal).toBeDefined())
    registry.clearAll()
    expect(signal?.aborted).toBe(true)
    resolveStart?.({ folderPath: 'C:\\chosen\\bilimi文稿', succeededCount: 1, skippedCount: 0, failedCount: 0 })
    await running
    await expect(ipcMain.invoke('video-note-archives:batch-open-folder', { accountMid: '100', batchId: 'session-change' })).rejects.toThrow('invalid')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { registerLocalDataIpc } from './localDataIpc'

class FakeIpcMain {
  handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
  handle(channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) { this.handlers.set(channel, handler) }
  invoke(channel: string, ...args: unknown[]) { return this.handlers.get(channel)?.({ sender: { id: 7 } }, ...args as never[]) }
}

describe('registerLocalDataIpc', () => {
  it('exposes only trusted, dialog-mediated migration and cleanup actions', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      listAccounts: vi.fn().mockResolvedValue([{ uid: '100', retained: true }]), calculateUsage: vi.fn().mockResolvedValue({ totalBytes: 1 }),
      exportArchive: vi.fn().mockResolvedValue({ schemaVersion: 1 }), previewImport: vi.fn().mockResolvedValue({ token: 'preview-1', accounts: [] }),
      applyImport: vi.fn(), previewCleanup: vi.fn().mockResolvedValue({ affectsBilibiliServerData: false }), applyCleanup: vi.fn()
    }
    registerLocalDataIpc({ ipcMain, service: service as never, isTrustedSender: (id) => id === 7, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), getCurrentAccount: vi.fn().mockResolvedValue({ mid: '100', nickname: '小咪' }), userDataPath: 'C:/data', chooseExportPath: vi.fn().mockResolvedValue('C:/export.json'), chooseImportPath: vi.fn().mockResolvedValue('C:/import.json'), openUserDataPath: vi.fn() })

    await expect(ipcMain.invoke('local-data:get-info')).resolves.toEqual({ path: 'C:/data', accounts: [{ uid: '100', nickname: '小咪', retained: true }] })
    await ipcMain.invoke('local-data:export', { scope: 'current' })
    expect(service.exportArchive).toHaveBeenCalledWith(expect.objectContaining({ uids: ['100'], outputPath: 'C:/export.json' }))
    await ipcMain.invoke('local-data:apply-import', 'preview-1', 'merge')
    expect(service.applyImport).toHaveBeenCalledWith({ token: 'preview-1' }, { mode: 'merge' })
    await expect(ipcMain.invoke('local-data:apply-import', { archive: {} }, 'merge')).rejects.toThrow('invalid')
    await ipcMain.invoke('local-data:preview-cleanup', 'all-user-data', undefined, '全部清除')
    expect(service.previewCleanup).toHaveBeenCalledWith({ level: 'all-user-data', confirmation: '全部清除' })
  })

  it('keeps local account inventory available when the current Bilibili account cannot be read', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { listAccounts: vi.fn().mockResolvedValue([{ uid: '100', retained: true }]) }
    registerLocalDataIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue(''),
      getCurrentAccount: vi.fn().mockRejectedValue(new Error('Bilibili session unavailable')),
      userDataPath: 'C:/data', chooseExportPath: vi.fn(), chooseImportPath: vi.fn(), openUserDataPath: vi.fn()
    })

    await expect(ipcMain.invoke('local-data:get-info')).resolves.toEqual({
      path: 'C:/data', accounts: [{ uid: '100', retained: true }]
    })
  })

  it('runs the signed-in account cleanup lifecycle only for the current Bilibili account', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { applyCleanup: vi.fn().mockResolvedValue(undefined) }
    const onCurrentAccountDataClear = vi.fn(async (_uid: string, clearLocalData: () => Promise<void>) => { await clearLocalData() })
    const onAccountDataCleared = vi.fn()
    registerLocalDataIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), getCurrentAccount: vi.fn().mockResolvedValue({ mid: '100' }),
      userDataPath: 'C:/data', chooseExportPath: vi.fn(), chooseImportPath: vi.fn(), openUserDataPath: vi.fn(),
      onCurrentAccountDataClear, onAccountDataCleared
    })

    await ipcMain.invoke('local-data:apply-cleanup', 'current-account-data', '100')
    expect(onCurrentAccountDataClear).toHaveBeenCalledTimes(1)
    expect(service.applyCleanup).toHaveBeenCalledWith({ level: 'current-account-data', uid: '100' })
    expect(onAccountDataCleared).toHaveBeenCalledWith('100')

    await ipcMain.invoke('local-data:apply-cleanup', 'current-account-data', '200')
    expect(onCurrentAccountDataClear).toHaveBeenCalledTimes(1)
    expect(service.applyCleanup).toHaveBeenLastCalledWith({ level: 'current-account-data', uid: '200' })
  })

  it('does not publish account deletion when the current-account lifecycle fails', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { applyCleanup: vi.fn() }
    const onAccountDataCleared = vi.fn()
    registerLocalDataIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), getCurrentAccount: vi.fn().mockResolvedValue({ mid: '100' }),
      userDataPath: 'C:/data', chooseExportPath: vi.fn(), chooseImportPath: vi.fn(), openUserDataPath: vi.fn(),
      onCurrentAccountDataClear: vi.fn().mockRejectedValue(new Error('session clear failed')), onAccountDataCleared
    })

    await expect(ipcMain.invoke('local-data:apply-cleanup', 'current-account-data', '100')).rejects.toThrow('session clear failed')
    expect(service.applyCleanup).not.toHaveBeenCalled()
    expect(onAccountDataCleared).not.toHaveBeenCalled()
  })
})

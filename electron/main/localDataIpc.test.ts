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
      exportArchive: vi.fn().mockResolvedValue({ schemaVersion: 1 }), previewImport: vi.fn().mockResolvedValue({ accounts: [] }),
      applyImport: vi.fn(), previewCleanup: vi.fn().mockResolvedValue({ affectsBilibiliServerData: false }), applyCleanup: vi.fn()
    }
    registerLocalDataIpc({ ipcMain, service: service as never, isTrustedSender: (id) => id === 7, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), userDataPath: 'C:/data', chooseExportPath: vi.fn().mockResolvedValue('C:/export.json'), chooseImportPath: vi.fn().mockResolvedValue('C:/import.json'), openUserDataPath: vi.fn() })

    await expect(ipcMain.invoke('local-data:get-info')).resolves.toEqual({ path: 'C:/data', accounts: [{ uid: '100', retained: true }] })
    await ipcMain.invoke('local-data:export', { scope: 'current', includeSharedSettings: false })
    expect(service.exportArchive).toHaveBeenCalledWith(expect.objectContaining({ uids: ['100'], outputPath: 'C:/export.json' }))
    await ipcMain.invoke('local-data:preview-cleanup', 'all-user-data', undefined, '全部清除')
    expect(service.previewCleanup).toHaveBeenCalledWith({ level: 'all-user-data', confirmation: '全部清除' })
  })
})

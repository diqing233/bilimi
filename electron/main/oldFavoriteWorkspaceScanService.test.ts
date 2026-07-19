import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteWorkspaceScanService } from './oldFavoriteWorkspaceScanService'

describe('OldFavoriteWorkspaceScanService', () => {
  it('returns the durable scanning snapshot before its controlled inventory finishes', async () => {
    let resolveInventory: ((value: unknown) => void) | undefined
    const inventory = new Promise((resolve) => { resolveInventory = resolve })
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning', scan: { phase: 'inventory' } }),
      recordScanInventory: vi.fn()
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target: { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 } })
      .mockReturnValueOnce(inventory)
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await expect(service.start('100', 'incremental')).resolves.toMatchObject({
      accountMid: '100', status: 'scanning', scan: { phase: 'inventory' }
    })

    expect(runtime).toHaveBeenCalledTimes(2)
    expect(runtime).toHaveBeenLastCalledWith({
      type: 'old-favorite-workspace-inventory', accountMid: '100',
      target: { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    })
    expect(coordinator.recordScanInventory).not.toHaveBeenCalled()
    resolveInventory?.({
      status: 'ok', observedAccountMid: '100', folders: [
        { id: 'source', title: 'Source', mediaCount: 2 },
        { id: 'bilimi', title: 'Bilimi·Inbox', mediaCount: 0 },
        { id: 'not-managed', title: 'My bilimi ideas', mediaCount: 1 }
      ]
    })
    await vi.waitFor(() => expect(coordinator.recordScanInventory).toHaveBeenCalledWith('100', expect.objectContaining({
      sourceFolders: expect.arrayContaining([
        expect.objectContaining({ id: 'source', isBilimiWorkFolder: false }),
        expect.objectContaining({ id: 'bilimi', itemCount: 0, isBilimiWorkFolder: true }),
        expect.objectContaining({ id: 'not-managed', isBilimiWorkFolder: false })
      ])
    })))
  })

  it('records an inventory failure instead of rebinding a different page target', async () => {
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning' }),
      recordScanFailure: vi.fn()
    }
    const runtime = vi.fn().mockResolvedValue({ status: 'unknown', observedAccountMid: '', reason: 'target-unavailable' })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith('100', 'target-unavailable'))
    expect(runtime).toHaveBeenCalledTimes(1)
  })

  it('coalesces repeated starts for the same account while inventory is running', async () => {
    let resolveInventory!: (value: unknown) => void
    const inventory = new Promise((resolve) => { resolveInventory = resolve })
    const snapshot = { accountMid: '100', status: 'scanning' as const, scan: { phase: 'inventory' as const } }
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue(snapshot),
      recordScanInventory: vi.fn(),
      recordScanFailure: vi.fn()
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target: { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 } })
      .mockReturnValueOnce(inventory)
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await Promise.all([service.start('00100', 'incremental'), service.start('100', 'incremental')])

    expect(coordinator.beginScan).toHaveBeenCalledOnce()
    expect(runtime).toHaveBeenCalledTimes(2)
    resolveInventory({ status: 'ok', observedAccountMid: '100', folders: [] })
    await vi.waitFor(() => expect(coordinator.recordScanInventory).toHaveBeenCalledOnce())
  })

  it('does not persist inventory reported for a different account', async () => {
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning' }),
      recordScanInventory: vi.fn(),
      recordScanFailure: vi.fn()
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target: { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 } })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '200', folders: [] })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith('100', 'inventory-account-mismatch'))
    expect(coordinator.recordScanInventory).not.toHaveBeenCalled()
  })
})

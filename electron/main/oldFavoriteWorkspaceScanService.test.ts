import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteWorkspaceScanService } from './oldFavoriteWorkspaceScanService'

describe('OldFavoriteWorkspaceScanService', () => {
  it('passes an explicit Bilibili mirror clear only to a full organization scan', async () => {
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning', scan: { phase: 'inventory' } }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      recordScanFailure: vi.fn()
    }
    const runtime = vi.fn().mockResolvedValue({ status: 'unknown', observedAccountMid: '', reason: 'target-unavailable' })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'full', { clearBilibiliMirror: true })

    expect(coordinator.beginScan).toHaveBeenCalledWith('100', 'full', { clearBilibiliMirror: true })
  })

  it('returns the durable scanning snapshot before its controlled inventory finishes', async () => {
    let resolveInventory: ((value: unknown) => void) | undefined
    const inventory = new Promise((resolve) => { resolveInventory = resolve })
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning', scan: { phase: 'inventory' } }),
      recordScanInventory: vi.fn(),
      recordScanFailure: vi.fn()
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
    }), 'scan-run-1'))
  })

  it('records an inventory failure instead of rebinding a different page target', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanFailure: vi.fn()
    }
    const runtime = vi.fn().mockResolvedValue({ status: 'unknown', observedAccountMid: '', reason: 'target-unavailable' })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith('100', 'target-unavailable', 'scan-run-1'))
    expect(runtime).toHaveBeenCalledTimes(1)
  })

  it('coalesces repeated starts for the same account while inventory is running', async () => {
    let resolveInventory!: (value: unknown) => void
    const inventory = new Promise((resolve) => { resolveInventory = resolve })
    const snapshot = { accountMid: '100', status: 'scanning' as const, scan: { phase: 'inventory' as const } }
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue(snapshot),
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

  it('does not let an incremental scan swallow an explicit full reorganization request', async () => {
    let resolveIncrementalInventory!: (value: unknown) => void
    const incrementalInventory = new Promise((resolve) => { resolveIncrementalInventory = resolve })
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn()
        .mockResolvedValueOnce({ accountMid: '100', status: 'scanning', mode: 'incremental' })
        .mockResolvedValueOnce({ accountMid: '100', status: 'scanning', mode: 'full' }),
      recordScanInventory: vi.fn(), recordScanFailure: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockReturnValueOnce(incrementalInventory)
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [] })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')
    await expect(service.start('100', 'full')).resolves.toMatchObject({ mode: 'full' })

    expect(coordinator.beginScan).toHaveBeenNthCalledWith(1, '100', 'incremental')
    expect(coordinator.beginScan).toHaveBeenNthCalledWith(2, '100', 'full')
    resolveIncrementalInventory({ status: 'ok', observedAccountMid: '100', folders: [] })
  })

  it('does not let an earlier full scan swallow a later full reorganization request', async () => {
    let resolveFirstInventory!: (value: unknown) => void
    const firstInventory = new Promise((resolve) => { resolveFirstInventory = resolve })
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-2'), beginScan: vi.fn()
        .mockResolvedValueOnce({ accountMid: '100', status: 'scanning', mode: 'full' })
        .mockResolvedValueOnce({ accountMid: '100', status: 'scanning', mode: 'full' }),
      recordScanInventory: vi.fn(), recordScanFailure: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockReturnValueOnce(firstInventory)
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [] })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'full')
    await expect(service.start('100', 'full')).resolves.toMatchObject({ mode: 'full' })

    expect(coordinator.beginScan).toHaveBeenCalledTimes(2)
    resolveFirstInventory({ status: 'ok', observedAccountMid: '100', folders: [] })
  })

  it('does not persist inventory reported for a different account', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(),
      recordScanFailure: vi.fn()
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target: { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 } })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '200', folders: [] })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith('100', 'inventory-account-mismatch', 'scan-run-1'))
    expect(coordinator.recordScanInventory).not.toHaveBeenCalled()
  })

  it('streams bounded source pages to the main-process coordinator without returning them to the caller', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning', scan: { phase: 'inventory' } }),
      recordScanInventory: vi.fn(),
      recordScanPage: vi.fn(),
      recordScanFailure: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 60 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: Array.from({ length: 50 }, (_, index) => ({ aid: index + 1, title: `V${index + 1}`, upperName: 'UP', cover: '', addedAt: 0 })), hasMore: true })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 51, title: 'V51', upperName: 'UP', cover: '', addedAt: 0, tags: ['科技'], category: '数码' }], hasMore: false })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanPage).toHaveBeenCalledTimes(2))
    expect(coordinator.recordScanPage).toHaveBeenNthCalledWith(1, '100', expect.objectContaining({ folderId: 'source-1', page: 1, items: expect.any(Array) }), 'scan-run-1')
    expect(coordinator.recordScanPage).toHaveBeenNthCalledWith(2, '100', expect.objectContaining({ folderId: 'source-1', page: 2, items: [{ aid: 51, title: 'V51', author: 'UP', cover: '', addedAt: 0, tags: ['科技'], category: '数码', sourceFolderIds: ['source-1'] }] }), 'scan-run-1')
    expect(runtime).toHaveBeenLastCalledWith({
      type: 'old-favorite-workspace-read-source-page', accountMid: '100', target, folderId: 'source-1', page: 2, pageSize: 20
    })
  })

  it('reads Bilimi work-folder members in batches before ordinary source pages', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordManagedMembers: vi.fn(), recordScanPage: vi.fn(), recordScanFailure: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [
        { id: 'managed-1', title: 'Bilimi Inbox', mediaCount: 0 }, { id: 'source-1', title: 'Source', mediaCount: 0 }
      ] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', members: { 'managed-1': [9, 1] } })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [], hasMore: false })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordManagedMembers).toHaveBeenCalledWith('100', { 'managed-1': [9, 1] }, 'scan-run-1'))
    expect(runtime).toHaveBeenNthCalledWith(3, {
      type: 'old-favorite-workspace-read-managed-members', accountMid: '100', target, folderIds: ['managed-1']
    })
  })

  it('finalizes the main-process workspace after the last bounded source page', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordManagedMembers: vi.fn(), recordScanPage: vi.fn(),
      finishScan: vi.fn(), recordScanFailure: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'scan-run-1'))
    expect(coordinator.recordScanFailure).not.toHaveBeenCalled()
  })

  it('continues a completed scan with persisted one-video tag enrichment', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([]),
      recordTagEnrichment: vi.fn().mockResolvedValue(true)
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', aid: 1, tags: ['Technology'] })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordTagEnrichment).toHaveBeenCalledWith('100', 1, ['Technology'], 'workspace-1'))
    expect(runtime).toHaveBeenLastCalledWith({
      type: 'old-favorite-workspace-read-video-tags', accountMid: '100', target, aid: 1
    })
  })

  it('pauses tag enrichment when its bound Bilibili page navigates instead of leaving a false running state', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([1]),
      recordTagEnrichment: vi.fn(),
      pauseTagEnrichment: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce({ status: 'unknown', observedAccountMid: '100', reason: 'target-navigated' })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.pauseTagEnrichment).toHaveBeenCalledWith('100'))
    expect(coordinator.recordTagEnrichment).not.toHaveBeenCalled()
  })

  it('rebinds the current Bilibili page before resuming a paused tag enrichment run', async () => {
    const coordinator = {
      resumeTagEnrichment: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1' }),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([])
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100', target })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.resumeTagEnrichment('100')

    expect(coordinator.resumeTagEnrichment).toHaveBeenCalledWith('100')
    expect(runtime).toHaveBeenCalledWith({ type: 'old-favorite-workspace-bind-scan-target', accountMid: '100' })
  })

  it('fails closed instead of endlessly paging an empty source result that claims more pages', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), recordScanFailure: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [], hasMore: true })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith('100', 'source-page-empty-with-more', 'scan-run-1'))
    expect(runtime).toHaveBeenCalledTimes(3)
    expect(coordinator.recordScanPage).not.toHaveBeenCalled()
  })
})

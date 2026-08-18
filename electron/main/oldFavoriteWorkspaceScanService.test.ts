import { describe, expect, it, vi } from 'vitest'
import { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'
import { OldFavoriteWorkspaceScanService } from './oldFavoriteWorkspaceScanService'

describe('OldFavoriteWorkspaceScanService', () => {
  it('probes favorite inventory after an expired 412 cooldown and resumes the persisted scan lease', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const events: string[] = []
    const failed = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', mode: 'incremental',
      scan: {
        phase: 'failed', failureCount: 1,
        reason: 'invalid-response [category=non-json http=412 content-type=text/html]',
        retryAvailableAt: '2026-07-19T00:10:00.000Z'
      }
    }
    const coordinator = {
      getScanRetryState: vi.fn().mockResolvedValue({
        reason: failed.scan.reason, retryAvailableAt: failed.scan.retryAvailableAt
      }),
      beginScan: vi.fn(),
      resumeFailedScan: vi.fn().mockImplementation(async () => {
        events.push('resume-failed-scan')
        return { ...failed, scan: { phase: 'inventory', failureCount: 0 } }
      }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      getScanResumeState: vi.fn().mockResolvedValue({
        runId: 'scan-run-1',
        completedPages: [{ folderId: 'source-1', page: 1, hasMore: true }],
        taggedAids: [1]
      }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(),
      finishScan: vi.fn(), recordScanFailure: vi.fn(), getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([])
    }
    const runtime = vi.fn((request: { type: string }) => {
      events.push(request.type)
      if (request.type === 'old-favorite-workspace-bind-scan-target') {
        return Promise.resolve({ status: 'ok' as const, observedAccountMid: '100', target })
      }
      if (request.type === 'old-favorite-workspace-inventory') {
        return Promise.resolve({
          status: 'ok' as const, observedAccountMid: '100',
          folders: [{ id: 'source-1', title: 'Source', mediaCount: 40 }]
        })
      }
      return Promise.resolve({
        status: 'ok' as const, observedAccountMid: '100', hasMore: false,
        items: [{ aid: 2, title: 'V2', upperName: 'UP', cover: '', addedAt: 0 }]
      })
    })
    const wait = vi.fn().mockResolvedValue(undefined)
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime as never,
      now: () => '2026-07-19T00:10:00.000Z', wait,
      recoveryStabilizationDelayMs: 3_000,
      sourcePageDelayMinMs: 800,
      sourcePageDelayMaxMs: 1_500,
      random: () => 0
    })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'scan-run-1'))

    expect(events).toEqual([
      'old-favorite-workspace-bind-scan-target',
      'old-favorite-workspace-inventory',
      'resume-failed-scan',
      'old-favorite-workspace-read-source-page'
    ])
    expect(coordinator.beginScan).not.toHaveBeenCalled()
    expect(runtime).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenNthCalledWith(1, 3_000)
    expect(wait).toHaveBeenNthCalledWith(2, 800)
    expect(coordinator.recordScanInventory).toHaveBeenCalledWith('100', {
      sourceFolders: [{
        id: 'source-1', title: 'Source', itemCount: 40, isBilimiWorkFolder: false,
        remoteRelationship: 'none', scanEligible: true
      }]
    }, 'scan-run-1')
    expect(runtime).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-source-page', page: 1
    }))
    expect(runtime).toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-source-page', page: 2
    }))
  })

  it('keeps the failed workspace intact when the recovery probe still receives HTML 412', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const failed = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', mode: 'incremental',
      scan: {
        phase: 'failed', failureCount: 1,
        reason: 'invalid-response [category=non-json http=412 content-type=text/html]',
        retryAvailableAt: '2026-07-19T00:10:00.000Z'
      }
    }
    const refreshed = {
      ...failed,
      scan: { ...failed.scan, failureCount: 2, retryAvailableAt: '2026-07-19T00:20:00.000Z' }
    }
    const coordinator = {
      getScanRetryState: vi.fn().mockResolvedValue({
        reason: failed.scan.reason, retryAvailableAt: failed.scan.retryAvailableAt
      }),
      getSnapshot: vi.fn().mockResolvedValue(refreshed),
      beginScan: vi.fn(), recordScanFailure: vi.fn()
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({
        status: 'unknown', observedAccountMid: '100', reason: 'invalid-response',
        httpStatus: 412, contentType: 'text/html', responseCategory: 'non-json'
      })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime,
      now: () => '2026-07-19T00:10:00.000Z'
    })

    await expect(service.start('100', 'incremental')).resolves.toEqual(refreshed)

    expect(coordinator.beginScan).not.toHaveBeenCalled()
    expect(coordinator.recordScanFailure).toHaveBeenCalledWith(
      '100',
      'invalid-response [category=non-json http=412 content-type=text/html]'
    )
  })

  it('passes unavailable source items to the coordinator without requesting their tags', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), recordScanInventory: vi.fn(),
      recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([]),
      getFormallyBoundRemoteFolderIds: vi.fn().mockResolvedValue(new Set())
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({
        status: 'ok', observedAccountMid: '100', hasMore: false,
        items: [{ aid: 42, title: '已失效视频', upperName: '账号已注销', cover: '', addedAt: 0, tags: [], category: '', unavailable: true }]
      })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'scan-run-1'))

    expect(coordinator.recordScanPage).toHaveBeenCalledWith('100', expect.objectContaining({
      items: [expect.objectContaining({ aid: 42, unavailable: true })]
    }), 'scan-run-1')
    expect(runtime).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'old-favorite-workspace-read-video-tags' }))
  })

  it('treats an unbound bilimi-named folder as a scan source instead of a protected work folder', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), recordScanInventory: vi.fn(),
      recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([]),
      getFormallyBoundRemoteFolderIds: vi.fn().mockResolvedValue(new Set())
    }
    const runtime = vi.fn((request: { type: string }) => {
      if (request.type === 'old-favorite-workspace-bind-scan-target') {
        return Promise.resolve({ status: 'ok' as const, observedAccountMid: '100', target })
      }
      if (request.type === 'old-favorite-workspace-inventory') {
        return Promise.resolve({
          status: 'ok' as const, observedAccountMid: '100',
          folders: [{ id: 'ordinary-same-name', title: 'bilimi·游戏专区', mediaCount: 1 }]
        })
      }
      return Promise.resolve({
        status: 'ok' as const, observedAccountMid: '100', hasMore: false,
        items: [{ aid: 7, title: 'Video', upperName: 'UP', cover: '', addedAt: 0 }]
      })
    })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime as never, wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'scan-run-1'))

    expect(coordinator.recordScanInventory).toHaveBeenCalledWith('100', {
      sourceFolders: [{
        id: 'ordinary-same-name', title: 'bilimi·游戏专区', itemCount: 1,
        isBilimiWorkFolder: false, isBilimiWorkFolderCandidate: true,
        remoteRelationship: 'none', scanEligible: true
      }]
    }, 'scan-run-1')
    expect(runtime).toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-source-page', folderId: 'ordinary-same-name'
    }))
    expect(runtime).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-managed-members'
    }))
  })

  it('quiesces an active inventory request before destructive maintenance and rejects new scans', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    let resolveBinding: ((result: { status: 'ok'; observedAccountMid: string; target: typeof target }) => void) | undefined
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      recordScanInventory: vi.fn(), recordScanFailure: vi.fn()
    }
    const runtime = vi.fn(() => new Promise<{ status: 'ok'; observedAccountMid: string; target: typeof target }>((resolve) => {
      resolveBinding = resolve
    }))
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledOnce())
    const quiesced = service.quiesceForDestructiveMaintenance()
    let settled = false
    void quiesced.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveBinding?.({ status: 'ok', observedAccountMid: '100', target })
    await quiesced

    expect(coordinator.recordScanInventory).not.toHaveBeenCalled()
    await expect(service.start('100', 'incremental')).rejects.toThrow('destructive maintenance')
  })

  it('quiesces an active tag read before destructive maintenance without recording its result', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    let resolveTags: ((result: { status: 'ok'; observedAccountMid: string; aid: number; tags: string[] }) => void) | undefined
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([1]),
      getSnapshot: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', tagEnrichment: { status: 'running' } }),
      recordTagEnrichment: vi.fn()
    }
    const runtime = vi.fn((request: { type: string }) => {
      if (request.type === 'old-favorite-workspace-bind-scan-target') return Promise.resolve({ status: 'ok' as const, observedAccountMid: '100', target })
      if (request.type === 'old-favorite-workspace-inventory') return Promise.resolve({ status: 'ok' as const, observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 0 }] })
      if (request.type === 'old-favorite-workspace-read-source-page') return Promise.resolve({ status: 'ok' as const, observedAccountMid: '100', items: [], hasMore: false })
      return new Promise<{ status: 'ok'; observedAccountMid: string; aid: number; tags: string[] }>((resolve) => { resolveTags = resolve })
    })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledWith(expect.objectContaining({ type: 'old-favorite-workspace-read-video-tags' })))
    const quiesced = service.quiesceForDestructiveMaintenance()
    resolveTags?.({ status: 'ok', observedAccountMid: '100', aid: 1, tags: ['Technology'] })
    await quiesced

    expect(coordinator.recordTagEnrichment).not.toHaveBeenCalled()
  })

  it('resumes a persisted scan lease without rereading completed source pages', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const coordinator = {
      beginScan: vi.fn(),
      resumeScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      getActiveScanRunId: vi.fn().mockResolvedValue('persisted-run-7'),
      getScanResumeState: vi.fn().mockResolvedValue({
        runId: 'persisted-run-7',
        completedPages: [{ folderId: 'source-1', page: 1, hasMore: true }],
        taggedAids: [1]
      }),
      recordScanInventory: vi.fn(),
      recordScanPage: vi.fn(),
      finishScan: vi.fn(),
      recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([1])
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 40 }] })
      .mockResolvedValueOnce({
        status: 'ok', observedAccountMid: '100', items: [
          { aid: 2, title: 'V2', upperName: 'UP', cover: '', addedAt: 0 }
        ], hasMore: false
      })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, wait: vi.fn().mockResolvedValue(undefined)
    })

    await expect(service.resume('100')).resolves.toMatchObject({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning'
    })

    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'persisted-run-7'))
    expect(coordinator.beginScan).not.toHaveBeenCalled()
    expect(coordinator.getActiveScanRunId).toHaveBeenCalledExactlyOnceWith('100')
    expect(coordinator.getScanResumeState).toHaveBeenCalledExactlyOnceWith('100')
    expect(runtime).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-source-page', folderId: 'source-1', page: 1
    }))
    expect(runtime).toHaveBeenCalledWith({
      type: 'old-favorite-workspace-read-source-page', accountMid: '100', target, folderId: 'source-1', page: 2, pageSize: 20
    })
    expect(runtime).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'old-favorite-workspace-read-video-tags' }))
    expect(coordinator.recordScanPage).toHaveBeenCalledWith('100', expect.objectContaining({
      folderId: 'source-1', page: 2
    }), 'persisted-run-7')
  })

  it('records the managed-member persistence stage when it throws during scanning', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      recordScanInventory: vi.fn(),
      recordManagedMembers: vi.fn().mockRejectedValue(new Error('managed member storage interrupted')),
      recordScanFailure: vi.fn(),
      getFormallyBoundRemoteFolderIds: vi.fn().mockResolvedValue(new Set(['managed-1']))
    }
    const runtime = vi.fn((request: { type: string }) => {
      if (request.type === 'old-favorite-workspace-bind-scan-target') {
        return Promise.resolve({ status: 'ok' as const, observedAccountMid: '100', target })
      }
      if (request.type === 'old-favorite-workspace-inventory') {
        return Promise.resolve({
          status: 'ok' as const, observedAccountMid: '100',
          folders: [{ id: 'managed-1', title: 'Bilimi Inbox', mediaCount: 1 }]
        })
      }
      return Promise.resolve({
        status: 'ok' as const, observedAccountMid: '100', members: { 'managed-1': [1] }
      })
    })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith(
      '100', 'inventory-runtime-failed:record-managed-members', 'scan-run-1'
    ))
  })

  it('does not resume a durable scan lease merely by constructing the service', () => {
    const coordinator = {
      resumeScan: vi.fn(), getActiveScanRunId: vi.fn(), getScanResumeState: vi.fn()
    }

    new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: vi.fn() })

    expect(coordinator.resumeScan).not.toHaveBeenCalled()
    expect(coordinator.getActiveScanRunId).not.toHaveBeenCalled()
    expect(coordinator.getScanResumeState).not.toHaveBeenCalled()
  })

  it('stops at a persisted terminal page instead of incrementing an unbounded cursor', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const coordinator = {
      resumeScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      getActiveScanRunId: vi.fn().mockResolvedValue('persisted-run-8'),
      getScanResumeState: vi.fn().mockResolvedValue({
        runId: 'persisted-run-8', completedPages: [{ folderId: 'source-1', page: 1, hasMore: false }], taggedAids: []
      }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([])
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 20 }] })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.resume('100')
    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'persisted-run-8'))
    expect(runtime).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'old-favorite-workspace-read-source-page' }))
  })

  it('records an inventory-confirmed empty source folder without requesting its resource page', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning' }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn()
    }
    const runtime = vi.fn((request: { type: string; folderId?: string }) => {
      if (request.type === 'old-favorite-workspace-bind-scan-target') {
        return Promise.resolve({ status: 'ok' as const, observedAccountMid: '100', target })
      }
      if (request.type === 'old-favorite-workspace-inventory') {
        return Promise.resolve({
          status: 'ok' as const,
          observedAccountMid: '100',
          folders: [
            { id: 'empty-source', title: 'bilimi·暂存', mediaCount: 0 },
            { id: 'source-1', title: 'Source', mediaCount: 1 }
          ]
        })
      }
      if (request.type === 'old-favorite-workspace-read-source-page' && request.folderId === 'source-1') {
        return Promise.resolve({
          status: 'ok' as const,
          observedAccountMid: '100',
          items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }],
          hasMore: false
        })
      }
      return Promise.resolve({ status: 'unknown' as const, observedAccountMid: '100', reason: 'unexpected-request' })
    })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'scan-run-1'))
    expect(runtime).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-source-page', folderId: 'empty-source'
    }))
    expect(coordinator.recordScanPage).toHaveBeenCalledWith('100', {
      folderId: 'empty-source', page: 1, hasMore: false, items: []
    }, 'scan-run-1')
    expect(runtime).toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-source-page', folderId: 'source-1', page: 1
    }))
    expect(coordinator.recordScanFailure).not.toHaveBeenCalled()
  })

  it('cancels an active DeepSeek organization before a full reorganization replaces its workspace', async () => {
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning', scan: { phase: 'inventory' } }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      recordScanFailure: vi.fn()
    }
    const cancelDeepSeek = vi.fn()
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never,
      requestRuntime: vi.fn().mockResolvedValue({ status: 'unknown', observedAccountMid: '', reason: 'target-unavailable' }),
      cancelDeepSeek
    })

    await service.start('100', 'full')

    expect(cancelDeepSeek).toHaveBeenCalledExactlyOnceWith('100')
    expect(cancelDeepSeek).toHaveBeenCalledBefore(coordinator.beginScan as never)
  })

  it('passes an explicit Bilibili mirror clear only to a full organization scan', async () => {
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning', scan: { phase: 'inventory' } }),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      recordScanFailure: vi.fn()
    }
    const runtime = vi.fn().mockResolvedValue({ status: 'unknown', observedAccountMid: '', reason: 'target-unavailable' })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'full', { clearBilibiliMirror: true })

    expect(coordinator.beginScan).toHaveBeenCalledWith('100', 'full', { clearBilibiliMirror: true })
  })

  it('returns the durable scanning snapshot before its controlled inventory finishes', async () => {
    let resolveInventory: ((value: unknown) => void) | undefined
    const inventory = new Promise((resolve) => { resolveInventory = resolve })
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning', scan: { phase: 'inventory' } }),
      recordScanInventory: vi.fn(),
      recordScanFailure: vi.fn(),
      getFormallyBoundRemoteFolderIds: vi.fn().mockResolvedValue(new Set(['bilimi']))
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

  it('records sanitized non-JSON inventory diagnostics without replacing local scan data', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordManagedMembers: vi.fn(), recordScanPage: vi.fn(),
      finishScan: vi.fn(), recordScanFailure: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({
        status: 'unknown', observedAccountMid: '100', reason: 'invalid-response',
        httpStatus: 200, contentType: 'text/html; charset=utf-8', responseCategory: 'non-json'
      })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith(
      '100',
      'invalid-response [category=non-json http=200 content-type=text/html; charset=utf-8]',
      'scan-run-1'
    ))
    expect(coordinator.recordScanInventory).not.toHaveBeenCalled()
    expect(coordinator.recordManagedMembers).not.toHaveBeenCalled()
    expect(coordinator.recordScanPage).not.toHaveBeenCalled()
    expect(coordinator.finishScan).not.toHaveBeenCalled()
  })

  it('rebinds once and retries inventory when the bound page target navigates', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn()
    }
    const staleTarget = { webContentsId: 7, instanceId: 'tab-a', navigationEpoch: 2 }
    const reboundTarget = { webContentsId: 9, instanceId: 'tab-b', navigationEpoch: 5 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target: staleTarget })
      .mockResolvedValueOnce({ status: 'unknown', observedAccountMid: '100', reason: 'target-navigated' })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target: reboundTarget })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [] })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'scan-run-1'))
    expect(runtime.mock.calls).toEqual([
      [{ type: 'old-favorite-workspace-bind-scan-target', accountMid: '100' }],
      [{ type: 'old-favorite-workspace-inventory', accountMid: '100', target: staleTarget }],
      [{ type: 'old-favorite-workspace-bind-scan-target', accountMid: '100' }],
      [{ type: 'old-favorite-workspace-inventory', accountMid: '100', target: reboundTarget }]
    ])
    expect(coordinator.recordScanFailure).not.toHaveBeenCalled()
  })

  it('stops after one rebind retry when the replacement target is also stale', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanFailure: vi.fn()
    }
    const staleTarget = { webContentsId: 7, instanceId: 'tab-a', navigationEpoch: 2 }
    const reboundTarget = { webContentsId: 9, instanceId: 'tab-b', navigationEpoch: 5 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target: staleTarget })
      .mockResolvedValueOnce({ status: 'unknown', observedAccountMid: '100', reason: 'target-navigated' })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target: reboundTarget })
      .mockResolvedValueOnce({ status: 'unknown', observedAccountMid: '100', reason: 'target-unavailable' })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith('100', 'target-unavailable', 'scan-run-1'))
    expect(runtime).toHaveBeenCalledTimes(4)
    expect(coordinator.recordScanInventory).not.toHaveBeenCalled()
  })

  it('rejects a bound target observed under another account before inventory starts', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanFailure: vi.fn()
    }
    const runtime = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '200', target: { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith('100', 'scan-target-account-mismatch', 'scan-run-1'))
    expect(runtime).toHaveBeenCalledOnce()
    expect(coordinator.recordScanInventory).not.toHaveBeenCalled()
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

  it('does not persist an in-flight source page after pausing the scan', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    let resolvePage!: (value: unknown) => void
    const sourcePage = new Promise((resolve) => { resolvePage = resolve })
    const pausedSnapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' as const,
      scan: { phase: 'inventory' as const, paused: true }
    }
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue({ ...pausedSnapshot, scan: { phase: 'inventory' as const } }),
      pauseScan: vi.fn().mockResolvedValue(pausedSnapshot),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn()
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockReturnValueOnce(sourcePage)
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-source-page'
    })))
    await expect(service.pause('100')).resolves.toEqual(pausedSnapshot)
    resolvePage({
      status: 'ok', observedAccountMid: '100', hasMore: false,
      items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }]
    })
    await vi.waitFor(() => expect(coordinator.pauseScan).toHaveBeenCalledWith('100'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(coordinator.recordScanPage).not.toHaveBeenCalled()
    expect(coordinator.finishScan).not.toHaveBeenCalled()
  })

  it('waits for the in-flight scan read before recovery preparation reports a durable pause', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    let resolvePage!: (value: unknown) => void
    const sourcePage = new Promise((resolve) => { resolvePage = resolve })
    const runningSnapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' as const,
      scan: { phase: 'inventory' as const }
    }
    const pausedSnapshot = {
      ...runningSnapshot, scan: { phase: 'inventory' as const, paused: true }
    }
    const coordinator = {
      beginScan: vi.fn().mockResolvedValue(runningSnapshot),
      getSnapshot: vi.fn().mockResolvedValue(runningSnapshot),
      pauseScan: vi.fn().mockResolvedValue(pausedSnapshot),
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn()
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockReturnValueOnce(sourcePage)
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-source-page'
    })))
    const preparing = service.pauseForRecovery('100')
    let settled = false
    void preparing.then(() => { settled = true })
    await Promise.resolve()

    expect(coordinator.pauseScan).toHaveBeenCalledWith('100')
    expect(settled).toBe(false)
    resolvePage({ status: 'ok', observedAccountMid: '100', hasMore: false, items: [] })
    await expect(preparing).resolves.toEqual(pausedSnapshot)
    expect(coordinator.recordScanPage).not.toHaveBeenCalled()
  })

  it('does not republish an already paused scan during recovery', async () => {
    const pausedSnapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' as const,
      scan: { phase: 'inventory' as const, paused: true }
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(pausedSnapshot),
      pauseScan: vi.fn()
    }
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: vi.fn() })

    await expect(service.pauseForRecovery('100')).resolves.toEqual(pausedSnapshot)
    expect(coordinator.pauseScan).not.toHaveBeenCalled()
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

  it('waits for the full scan to finish before starting tags for a sealed batch', async () => {
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    let resolveLaterPage!: (value: {
      status: 'ok'; observedAccountMid: string; items: never[]; hasMore: false
    }) => void
    const laterPage = new Promise<{
      status: 'ok'; observedAccountMid: string; items: never[]; hasMore: false
    }>((resolve) => { resolveLaterPage = resolve })
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(),
      recordScanPage: vi.fn()
        .mockResolvedValueOnce({ sealedSegmentIds: ['segment-1'] })
        .mockResolvedValueOnce(true),
      finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValue([]),
      getSnapshot: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', tagEnrichment: { status: 'running' }
      }),
      recordTagEnrichment: vi.fn().mockResolvedValue(true), pauseTagEnrichment: vi.fn()
    }
    const runtime = vi.fn((request: { type: string }) => {
      if (request.type === 'old-favorite-workspace-bind-scan-target') {
        return Promise.resolve({ status: 'ok' as const, observedAccountMid: '100', target })
      }
      if (request.type === 'old-favorite-workspace-inventory') {
        return Promise.resolve({
          status: 'ok' as const, observedAccountMid: '100',
          folders: [{ id: 'source-1', title: 'Source', mediaCount: 51 }]
        })
      }
      if (request.type === 'old-favorite-workspace-read-video-tags') {
        return Promise.resolve({ status: 'ok' as const, observedAccountMid: '100', aid: 1, tags: ['Technology'] })
      }
      if (runtime.mock.calls.filter(([candidate]) => candidate.type === 'old-favorite-workspace-read-source-page').length === 1) {
        return Promise.resolve({
          status: 'ok' as const, observedAccountMid: '100',
          items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: true
        })
      }
      return laterPage
    })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime as never,
      wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanPage).toHaveBeenCalledTimes(1))
    expect(coordinator.recordTagEnrichment).not.toHaveBeenCalled()
    expect(coordinator.finishScan).not.toHaveBeenCalled()
    resolveLaterPage({ status: 'ok', observedAccountMid: '100', items: [], hasMore: false })
    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'scan-run-1'))
    await vi.waitFor(() => expect(coordinator.recordTagEnrichment).toHaveBeenCalledWith(
      '100', 1, ['Technology'], 'workspace-1'
    ))
  })

  it('reads Bilimi work-folder members in batches before ordinary source pages', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'), beginScan: vi.fn().mockResolvedValue({ accountMid: '100', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordManagedMembers: vi.fn(), recordScanPage: vi.fn(), recordScanFailure: vi.fn(),
      getFormallyBoundRemoteFolderIds: vi.fn().mockResolvedValue(new Set(['managed-1']))
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

  it('paces source page reads with jitter and a longer periodic pause', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([])
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 60 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: true })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 2, title: 'V2', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: true })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 3, title: 'V3', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
    const wait = vi.fn().mockResolvedValue(undefined)
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(1)
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, wait, random,
      sourcePageDelayMinMs: 800, sourcePageDelayMaxMs: 1_500,
      sourcePageBatchSize: 2, sourcePageBatchPauseMs: 4_000
    })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(coordinator.finishScan).toHaveBeenCalledWith('100', 'scan-run-1'))

    expect(wait.mock.calls).toEqual([[800], [1_150], [4_000], [1_500]])
  })

  it('backs off once and preserves managed membership when a nonempty folder temporarily returns an empty list', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordManagedMembers: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getFormallyBoundRemoteFolderIds: vi.fn().mockResolvedValue(new Set(['managed-1']))
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [
        { id: 'managed-1', title: 'Bilimi Inbox', mediaCount: 2 }
      ] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', members: { 'managed-1': [] } })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', members: { 'managed-1': [] } })
    const wait = vi.fn().mockResolvedValue(undefined)
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, inventoryRetryDelayMs: 25, wait
    })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith(
      '100', 'managed-members-anomalous-empty', 'scan-run-1'
    ))
    expect(wait).toHaveBeenCalledExactlyOnceWith(25)
    expect(runtime).toHaveBeenCalledTimes(4)
    expect(coordinator.recordManagedMembers).not.toHaveBeenCalled()
    expect(coordinator.finishScan).not.toHaveBeenCalled()
  })

  it('records sanitized managed-members diagnostics without replacing persisted membership', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordManagedMembers: vi.fn(), recordScanFailure: vi.fn(),
      getFormallyBoundRemoteFolderIds: vi.fn().mockResolvedValue(new Set(['managed-1']))
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [
        { id: 'managed-1', title: 'Bilimi Inbox', mediaCount: 2 }
      ] })
      .mockResolvedValueOnce({
        status: 'unknown', observedAccountMid: '100', reason: 'remote-api-403--101',
        httpStatus: 403, contentType: 'application/json', bilibiliCode: -101,
        responseCategory: 'forbidden'
      })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith(
      '100',
      'remote-api-403--101 [category=forbidden http=403 bilibili=-101 content-type=application/json]',
      'scan-run-1'
    ))
    expect(coordinator.recordManagedMembers).not.toHaveBeenCalled()
  })

  it('rejects a different account observed after the anomalous membership retry', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordManagedMembers: vi.fn(), recordScanFailure: vi.fn(),
      getFormallyBoundRemoteFolderIds: vi.fn().mockResolvedValue(new Set(['managed-1']))
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [
        { id: 'managed-1', title: 'Bilimi Inbox', mediaCount: 2 }
      ] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', members: { 'managed-1': [] } })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '200', members: { 'managed-1': [9] } })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, inventoryRetryDelayMs: 0,
      wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith(
      '100', 'managed-members-account-mismatch', 'scan-run-1'
    ))
    expect(coordinator.recordManagedMembers).not.toHaveBeenCalled()
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
      getSnapshot: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', tagEnrichment: { status: 'running' } }),
      recordTagEnrichment: vi.fn().mockResolvedValue(true)
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', aid: 1, tags: ['Technology'] })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordTagEnrichment).toHaveBeenCalledWith('100', 1, ['Technology'], 'workspace-1'))
    expect(runtime).toHaveBeenLastCalledWith({
      type: 'old-favorite-workspace-read-video-tags', accountMid: '100', target, aid: 1
    })
  })

  it('waits for an existing same-account remote operation before scanning', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([]),
      getSnapshot: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', tagEnrichment: { status: 'running' } }),
      recordTagEnrichment: vi.fn().mockResolvedValue(true)
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', aid: 1, tags: ['Technology'] })
    const remoteOperations = new FavoriteRepositoryRemoteOperationArbiter()
    let releaseRemoteOperation: (() => void) | undefined
    const heldRemoteOperation = remoteOperations.run('100', () => new Promise<void>((resolve) => { releaseRemoteOperation = resolve }))
    const wait = vi.fn().mockResolvedValue(undefined)
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, remoteOperations, wait, random: () => 0
    })

    await service.start('100', 'incremental')

    expect(runtime).not.toHaveBeenCalled()
    releaseRemoteOperation?.()
    await heldRemoteOperation
    await vi.waitFor(() => expect(coordinator.recordTagEnrichment).toHaveBeenCalledWith('100', 1, ['Technology'], 'workspace-1'))
    expect(wait).toHaveBeenCalledWith(650)
  })

  it('does not send a tag request after its workspace is paused during the pacing delay', async () => {
    let releaseWait: (() => void) | undefined
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([]),
      getSnapshot: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', tagEnrichment: { status: 'paused' } }),
      recordTagEnrichment: vi.fn(), pauseTagEnrichment: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', aid: 1, tags: [] })
    const wait = vi.fn(() => new Promise<void>((resolve) => { releaseWait = resolve }))
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime, wait })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce())
    releaseWait?.()

    await vi.waitFor(() => expect(coordinator.getSnapshot).toHaveBeenCalledWith('100'))
    expect(runtime).not.toHaveBeenCalledWith({ type: 'old-favorite-workspace-read-video-tags', accountMid: '100', target, aid: 1 })
  })

  it('does not send a queued tag request after its workspace is paused', async () => {
    let releaseRemoteOperation: (() => void) | undefined
    let tagStatus: 'running' | 'paused' = 'running'
    const observedTagStatuses: string[] = []
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([]),
      getSnapshot: vi.fn().mockImplementation(async () => {
        observedTagStatuses.push(tagStatus)
        return { workspaceId: 'workspace-1', tagEnrichment: { status: tagStatus } }
      }),
      recordTagEnrichment: vi.fn(), pauseTagEnrichment: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', aid: 1, tags: [] })
    const remoteOperations = new FavoriteRepositoryRemoteOperationArbiter()
    let signalRemoteOperationStarted: (() => void) | undefined
    const remoteOperationStarted = new Promise<void>((resolve) => { signalRemoteOperationStarted = resolve })
    const wait = vi.fn(async () => {
      void remoteOperations.run('100', () => new Promise<void>((resolve) => {
        signalRemoteOperationStarted?.()
        releaseRemoteOperation = resolve
      }))
      await remoteOperationStarted
    })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime, remoteOperations, wait })

    await service.start('100', 'incremental')
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce())
    tagStatus = 'paused'
    releaseRemoteOperation?.()

    await vi.waitFor(() => expect(observedTagStatuses).toEqual(['paused']))
    expect(runtime).not.toHaveBeenCalledWith({ type: 'old-favorite-workspace-read-video-tags', accountMid: '100', target, aid: 1 })
  })

  it('finishes an in-flight tag request after adoption pauses the queue without starting another', async () => {
    let releaseFirstResponse: ((value: unknown) => void) | undefined
    let tagStatus: 'running' | 'paused' = 'running'
    const claims = [1, 2]
    const coordinator = {
      claimNextPendingTagEnrichmentAid: vi.fn().mockImplementation(async () =>
        tagStatus === 'running' ? claims.shift() : undefined),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([]),
      getSnapshot: vi.fn().mockImplementation(async () => ({
        workspaceId: 'workspace-1', tagEnrichment: { status: tagStatus }
      })),
      releaseClaimedTagEnrichmentAid: vi.fn(),
      recordTagEnrichment: vi.fn().mockResolvedValue(true)
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn((request: { type: string; aid?: number }) => {
      if (request.type === 'old-favorite-workspace-read-video-tags' && request.aid === 1) {
        return new Promise((resolve) => { releaseFirstResponse = resolve })
      }
      throw new Error(`Unexpected runtime request: ${request.type}:${request.aid ?? ''}`)
    })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime as never, wait: vi.fn().mockResolvedValue(undefined)
    })

    void (service as never as { runTagEnrichment: (accountMid: string, target: typeof target, workspaceId: string) => Promise<void> })
      .runTagEnrichment('100', target, 'workspace-1')
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'old-favorite-workspace-read-video-tags', aid: 1 })
    ))

    tagStatus = 'paused'
    releaseFirstResponse?.({ status: 'ok', observedAccountMid: '100', aid: 1, tags: ['Technology'] })

    await vi.waitFor(() => expect(coordinator.recordTagEnrichment).toHaveBeenCalledWith(
      '100', 1, ['Technology'], 'workspace-1'
    ))
    await vi.waitFor(() => expect(coordinator.claimNextPendingTagEnrichmentAid).toHaveBeenCalledTimes(2))
    expect(runtime).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'old-favorite-workspace-read-video-tags', aid: 2
    }))
  })

  it('hands tag enrichment to a newer workspace after the older queued run exits', async () => {
    let releaseFirstWait: (() => void) | undefined
    let activeWorkspaceId = 'workspace-1'
    const coordinator = {
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([2]).mockResolvedValueOnce([]),
      getSnapshot: vi.fn().mockImplementation(async () => ({ workspaceId: activeWorkspaceId, tagEnrichment: { status: 'running' } })),
      recordTagEnrichment: vi.fn().mockResolvedValue(true)
    }
    const runtime = vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100', aid: 2, tags: ['Technology'] })
    const wait = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirstWait = resolve }))
      .mockResolvedValue(undefined)
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime, wait })
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }

    void (service as never as { runTagEnrichment: (accountMid: string, target: typeof target, workspaceId: string) => Promise<void> })
      .runTagEnrichment('100', target, 'workspace-1')
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce())
    activeWorkspaceId = 'workspace-2'
    void (service as never as { runTagEnrichment: (accountMid: string, target: typeof target, workspaceId: string) => Promise<void> })
      .runTagEnrichment('100', target, 'workspace-2')
    releaseFirstWait?.()

    await vi.waitFor(() => expect(coordinator.recordTagEnrichment).toHaveBeenCalledWith('100', 2, ['Technology'], 'workspace-2'))
  })

  it('rebinds once and retries tag enrichment when its bound Bilibili page navigates', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([]),
      getSnapshot: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', tagEnrichment: { status: 'running' } }),
      recordTagEnrichment: vi.fn(),
      pauseTagEnrichment: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const reboundTarget = { webContentsId: 9, instanceId: 'tab-new', navigationEpoch: 4 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce({ status: 'unknown', observedAccountMid: '100', reason: 'target-navigated' })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target: reboundTarget })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', aid: 1, tags: ['Technology'] })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordTagEnrichment).toHaveBeenCalledWith('100', 1, ['Technology'], 'workspace-1'))
    expect(runtime).toHaveBeenCalledWith({ type: 'old-favorite-workspace-bind-scan-target', accountMid: '100' })
    expect(runtime).toHaveBeenCalledWith({
      type: 'old-favorite-workspace-read-video-tags', accountMid: '100', target: reboundTarget, aid: 1
    })
    expect(coordinator.pauseTagEnrichment).not.toHaveBeenCalled()
  })

  it('records a tag retrieval failure instead of treating a rejected request as an empty tag set', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([]),
      getSnapshot: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', tagEnrichment: { status: 'running' } }),
      recordTagEnrichment: vi.fn().mockResolvedValue(true), recordTagEnrichmentFailure: vi.fn().mockResolvedValue(true), pauseTagEnrichment: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce({ status: 'unknown', observedAccountMid: '100', reason: 'remote-api-200--404' })
      .mockResolvedValueOnce({ status: 'unknown', observedAccountMid: '100', reason: 'remote-api-200--404' })
      .mockResolvedValueOnce({ status: 'unknown', observedAccountMid: '100', reason: 'remote-api-200--404' })
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, tagRetryDelayMs: 0, wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordTagEnrichmentFailure).toHaveBeenCalledWith('100', 1, 'remote-api-200--404', 'workspace-1'))
    expect(coordinator.recordTagEnrichment).not.toHaveBeenCalledWith('100', 1, [], 'workspace-1')
    expect(coordinator.pauseTagEnrichment).not.toHaveBeenCalled()
  })

  it('records sanitized tag response diagnostics after bounded retries', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([]),
      getSnapshot: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', tagEnrichment: { status: 'running' } }),
      recordTagEnrichment: vi.fn(), recordTagEnrichmentFailure: vi.fn().mockResolvedValue(true), pauseTagEnrichment: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const diagnosticFailure = {
      status: 'unknown', observedAccountMid: '100', reason: 'remote-api-429--509',
      httpStatus: 429, contentType: 'application/json', bilibiliCode: -509,
      responseCategory: 'rate-limited'
    }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce(diagnosticFailure)
      .mockResolvedValueOnce(diagnosticFailure)
      .mockResolvedValueOnce(diagnosticFailure)
    const service = new OldFavoriteWorkspaceScanService({
      coordinator: coordinator as never, requestRuntime: runtime, tagRetryDelayMs: 0,
      wait: vi.fn().mockResolvedValue(undefined)
    })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordTagEnrichmentFailure).toHaveBeenCalledWith(
      '100', 1,
      'remote-api-429--509 [category=rate-limited http=429 bilibili=-509 content-type=application/json]',
      'workspace-1'
    ))
    expect(coordinator.recordTagEnrichment).not.toHaveBeenCalled()
  })

  it('retries a transient tag request before recording the video result', async () => {
    vi.useFakeTimers()
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), finishScan: vi.fn(), recordScanFailure: vi.fn(),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([]),
      getSnapshot: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', tagEnrichment: { status: 'running' } }),
      recordTagEnrichment: vi.fn().mockResolvedValue(true), pauseTagEnrichment: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', items: [{ aid: 1, title: 'V1', upperName: 'UP', cover: '', addedAt: 0 }], hasMore: false })
      .mockResolvedValueOnce({ status: 'unknown', observedAccountMid: '100', reason: 'network-failure' })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', aid: 1, tags: ['Technology'] })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime, tagRetryDelayMs: 0 })

    await service.start('100', 'incremental')
    await vi.runAllTimersAsync()

    await vi.waitFor(() => expect(coordinator.recordTagEnrichment).toHaveBeenCalledWith('100', 1, ['Technology'], 'workspace-1'))
    expect(coordinator.recordTagEnrichment).not.toHaveBeenCalledWith('100', 1, [], 'workspace-1')
    expect(coordinator.pauseTagEnrichment).not.toHaveBeenCalled()
    vi.useRealTimers()
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
    expect(runtime.mock.invocationCallOrder[0]).toBeLessThan(coordinator.resumeTagEnrichment.mock.invocationCallOrder[0])
  })

  it('keeps a recovered tag enrichment paused when no usable Bilibili target can be bound', async () => {
    const coordinator = {
      resumeTagEnrichment: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue({
        workspaceId: 'workspace-1',
        tagEnrichment: { status: 'paused' }
      }),
      getPendingTagEnrichmentAids: vi.fn().mockResolvedValue([1])
    }
    const runtime = vi.fn().mockResolvedValue({
      status: 'unknown', observedAccountMid: '100', reason: 'scan-target-unavailable'
    })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.resumeTagEnrichment('100')

    expect(coordinator.resumeTagEnrichment).not.toHaveBeenCalled()
    expect(coordinator.getSnapshot).not.toHaveBeenCalled()
    expect(coordinator.getPendingTagEnrichmentAids).not.toHaveBeenCalled()
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

  it('records sanitized source-page response diagnostics without persisting a temporary empty page', async () => {
    const coordinator = {
      getActiveScanRunId: vi.fn().mockResolvedValue('scan-run-1'),
      beginScan: vi.fn().mockResolvedValue({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning' }),
      recordScanInventory: vi.fn(), recordScanPage: vi.fn(), recordScanFailure: vi.fn()
    }
    const target = { webContentsId: 7, instanceId: 'tab', navigationEpoch: 2 }
    const runtime = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', folders: [{ id: 'source-1', title: 'Source', mediaCount: 1 }] })
      .mockResolvedValueOnce({
        status: 'unknown', observedAccountMid: '100', reason: 'remote-api-503--503',
        httpStatus: 503, contentType: 'application/json', bilibiliCode: -503,
        responseCategory: 'server-error'
      })
    const service = new OldFavoriteWorkspaceScanService({ coordinator: coordinator as never, requestRuntime: runtime })

    await service.start('100', 'incremental')

    await vi.waitFor(() => expect(coordinator.recordScanFailure).toHaveBeenCalledWith(
      '100',
      'remote-api-503--503 [category=server-error http=503 bilibili=-503 content-type=application/json]',
      'scan-run-1'
    ))
    expect(coordinator.recordScanPage).not.toHaveBeenCalled()
  })
})

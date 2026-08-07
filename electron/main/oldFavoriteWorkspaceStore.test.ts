import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'

const roots: string[] = []

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-store-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('OldFavoriteWorkspaceStore', () => {
  it('restores and clears a whole-run execution intent across process restarts', async () => {
    const root = await createRoot()
    const first = new OldFavoriteWorkspaceStore({ root })
    await first.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1,
      currentSegmentId: 'segment-1', segments: [{ id: 'segment-1', aids: [1] }, { id: 'segment-2', aids: [2] }]
    })
    await first.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      executionIntent: { workspaceId: 'workspace-1', mode: 'bilibili', status: 'waiting' }
    })

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      executionIntent: { workspaceId: 'workspace-1', mode: 'bilibili', status: 'waiting' }
    })

    await first.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [], executionIntent: null
    })
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      executionIntent: undefined
    })
  })

  it('restores and clears a compact DeepSeek all-batch checkpoint across process restarts', async () => {
    const root = await createRoot()
    const first = new OldFavoriteWorkspaceStore({ root })
    await first.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1,
      currentSegmentId: 'segment-1', segments: [{ id: 'segment-1', aids: [1] }, { id: 'segment-2', aids: [2] }]
    })
    await first.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      deepSeekRunCheckpoint: {
        workspaceId: 'workspace-1', mode: 'all', scope: 'all',
        completedSegmentIds: ['segment-1'], waitingSegmentIds: ['segment-2'], canceled: false
      }
    })

    const restarted = new OldFavoriteWorkspaceStore({ root })
    await expect(restarted.recover('100', 'workspace-1')).resolves.toMatchObject({
      deepSeekRunCheckpoint: {
        completedSegmentIds: ['segment-1'], waitingSegmentIds: ['segment-2'], canceled: false
      }
    })

    await restarted.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [], deepSeekRunCheckpoint: null
    })
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      deepSeekRunCheckpoint: undefined
    })
  })

  it('restores the manifest, baseline, classifications, history, and current segment after restart', async () => {
    const root = await createRoot()
    const first = new OldFavoriteWorkspaceStore({ root })
    await first.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 7, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1, 2] }, { id: 'segment-2', aids: [3] }]
    })
    await first.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-2',
      classifications: [{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }],
      history: [{ kind: 'move-items', aids: [1] }]
    })

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      workspaceId: 'workspace-1', baselineRevision: 7, currentSegmentId: 'segment-2',
      manifestChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      classifications: { '1': { targetLedgerIds: ['music'], source: 'manual' } },
      history: [{ kind: 'move-items', aids: [1] }]
    })
  })

  it('appends one manual adjustment without rewriting repository videos or memberships', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }], history: []
    })

    await expect(store.readWorkspaceWrites('100', 'workspace-1')).resolves.toEqual([
      'manifest.json', 'overlay.journal.jsonl'
    ])
  })

  it('persists one bounded scan page in a separate staging chunk without rewriting baseline chunks', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0, currentSegmentId: '',
      segments: []
    })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')

    await store.appendScanPage('100', 'workspace-1', {
      runId: 'scan-run-1',
      folderId: 'source-1',
      page: 1,
      items: [{ aid: 1, title: 'Video', author: 'UP', cover: 'https://example.com/1.jpg', addedAt: 10, sourceFolderIds: ['source-1'] }]
    })

    await expect(store.readWorkspaceWrites('100', 'workspace-1')).resolves.toEqual([
      'manifest.json', expect.stringMatching(/^scan\/pages\/[a-f0-9]{64}\.json$/)
    ])
    await expect(store.readScanPages('100', 'workspace-1')).resolves.toEqual([
      {
        folderId: 'source-1', page: 1,
        items: [{ aid: 1, title: 'Video', author: 'UP', cover: 'https://example.com/1.jpg', addedAt: 10, sourceFolderIds: ['source-1'] }]
      }
    ])
  })

  it('does not load 30000 staged scan items during lightweight workspace recovery', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0, currentSegmentId: '',
      segments: []
    })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')
    for (let page = 1; page <= 600; page += 1) {
      await store.appendScanPage('100', 'workspace-1', {
        runId: 'scan-run-1',
        folderId: 'source-1', page,
        items: Array.from({ length: 50 }, (_, index) => ({ aid: (page - 1) * 50 + index + 1, sourceFolderIds: ['source-1'] }))
      })
    }

    const recoveredStore = new OldFavoriteWorkspaceStore({ root })
    const recovered = await recoveredStore.recover('100', 'workspace-1')

    expect(recovered).toMatchObject({ workspaceId: 'workspace-1', loadedSegmentAids: [] })
    await expect(recoveredStore.readWorkspaceReads('100', 'workspace-1')).resolves.toEqual(['manifest.json'])
  }, 20_000)

  it('restores compact streaming batch descriptors without loading staged scan item files', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0,
      currentSegmentId: '', segments: []
    })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')
    await store.appendScanPage('100', 'workspace-1', {
      runId: 'scan-run-1', folderId: 'source-1', page: 1,
      items: [{ aid: 1, title: 'One', sourceFolderIds: ['source-1'] }, { aid: 2, title: 'Two', sourceFolderIds: ['source-1'] }]
    })
    await store.checkpointStreamingScan('100', 'workspace-1', {
      runId: 'scan-run-1',
      sealedSegments: [{ id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'One', sourceFolderIds: ['source-1'] }] }],
      openAids: [2]
    })

    const reader = new OldFavoriteWorkspaceStore({ root })
    await expect(reader.recover('100', 'workspace-1')).resolves.toMatchObject({
      workspaceId: 'workspace-1',
      loadedSegmentAids: [1],
      streamingScan: {
        segmentSize: 500,
        sealedSegments: [{ id: 'segment-1', index: 0, itemCount: 1, aids: [1] }],
        openAids: [2],
        observedAids: [1, 2]
      }
    })
    await expect(reader.readWorkspaceReads('100', 'workspace-1')).resolves.toEqual([
      'manifest.json', 'baseline/segment-1.json'
    ])
  })

  it('accepts the experimental unlimited batch size when checkpointing a paused scan', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0,
      currentSegmentId: '', segments: []
    })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')

    await store.checkpointStreamingScan('100', 'workspace-1', {
      runId: 'scan-run-1',
      segmentSize: Number.MAX_SAFE_INTEGER,
      sealedSegments: [],
      openAids: [1]
    })

    await expect(store.recover('100', 'workspace-1')).resolves.toMatchObject({
      streamingScan: { segmentSize: Number.MAX_SAFE_INTEGER, openAids: [1] }
    })
  })

  it('publishes the staged page cursor and streaming checkpoint through one manifest boundary', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0,
      currentSegmentId: '', segments: []
    })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')

    await store.checkpointStreamingScan('100', 'workspace-1', {
      runId: 'scan-run-1',
      page: {
        runId: 'scan-run-1', folderId: 'source-1', page: 1, hasMore: true,
        items: [{ aid: 1, title: 'One', sourceFolderIds: ['source-1'] }]
      },
      sealedSegments: [],
      openAids: [1],
      openItems: [{ aid: 1, title: 'One', sourceFolderIds: ['source-1'] }],
      observedAids: [1]
    })

    await expect(store.readScanPageCursors('100', 'workspace-1')).resolves.toEqual([
      { folderId: 'source-1', page: 1, hasMore: true }
    ])
    await expect(store.readScanPages('100', 'workspace-1')).resolves.toEqual([
      {
        folderId: 'source-1', page: 1, hasMore: true,
        items: [{ aid: 1, title: 'One', sourceFolderIds: ['source-1'] }]
      }
    ])
    await expect(store.recover('100', 'workspace-1')).resolves.toMatchObject({
      streamingScan: { openAids: [1], observedAids: [1] }
    })
  })

  it('reuses an unchanged managed-member chunk after a scan restart', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0,
      currentSegmentId: '', segments: []
    })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')
    await store.appendManagedMembers('100', 'workspace-1', {
      runId: 'scan-run-1', members: { 'managed-1': [1, 2] }
    })
    const writableStore = store as unknown as {
      atomicWrite(path: string, content: string): Promise<void>
    }
    const atomicWrite = vi.spyOn(writableStore, 'atomicWrite')

    await store.appendManagedMembers('100', 'workspace-1', {
      runId: 'scan-run-1', members: { 'managed-1': [1, 2] }
    })

    expect(atomicWrite).not.toHaveBeenCalled()
    await expect(store.readManagedMembers('100', 'workspace-1')).resolves.toEqual({ 'managed-1': [1, 2] })
  })

  it('keeps the prior sealed segment recoverable when a changed-segment manifest switch fails', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0,
      currentSegmentId: '', segments: []
    })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')
    await store.checkpointStreamingScan('100', 'workspace-1', {
      runId: 'scan-run-1',
      sealedSegments: [{
        id: 'segment-1', aids: [1],
        items: [{ aid: 1, title: 'First', sourceFolderIds: ['source-a'] }]
      }],
      openAids: [],
      observedAids: [1]
    })
    const writableStore = store as unknown as {
      atomicWrite(path: string, content: string): Promise<void>
    }
    const atomicWrite = writableStore.atomicWrite.bind(store)
    vi.spyOn(writableStore, 'atomicWrite').mockImplementation(async (path, content) => {
      if (path.endsWith('manifest.json')) throw new Error('manifest-switch-failed')
      await atomicWrite(path, content)
    })

    await expect(store.checkpointStreamingScan('100', 'workspace-1', {
      runId: 'scan-run-1',
      sealedSegments: [{
        id: 'segment-1', aids: [1],
        items: [{ aid: 1, title: 'First', sourceFolderIds: ['source-a', 'source-b'] }]
      }],
      openAids: [],
      observedAids: [1],
      changedSegmentIds: ['segment-1']
    })).rejects.toThrow('manifest-switch-failed')

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      workspaceId: 'workspace-1',
      loadedSegmentItems: [{ aid: 1, title: 'First', sourceFolderIds: ['source-a'] }]
    })
  })

  it('keeps the scanning baseline recoverable when the completed manifest switch fails', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0,
      currentSegmentId: '', segments: []
    })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')
    await store.checkpointStreamingScan('100', 'workspace-1', {
      runId: 'scan-run-1',
      sealedSegments: [{
        id: 'segment-1', aids: [1],
        items: [{ aid: 1, title: 'First', sourceFolderIds: ['source-a'] }]
      }],
      openAids: [],
      observedAids: [1]
    })
    const writableStore = store as unknown as {
      atomicWrite(path: string, content: string): Promise<void>
    }
    const atomicWrite = writableStore.atomicWrite.bind(store)
    vi.spyOn(writableStore, 'atomicWrite').mockImplementation(async (path, content) => {
      if (path.endsWith('manifest.json')) throw new Error('completed-manifest-switch-failed')
      await atomicWrite(path, content)
    })

    await expect(store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1,
      currentSegmentId: 'segment-1',
      segments: [{
        id: 'segment-1', aids: [1],
        items: [{ aid: 1, title: 'First', tags: ['enriched'], sourceFolderIds: ['source-a'] }]
      }]
    })).rejects.toThrow('completed-manifest-switch-failed')

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      status: 'scanning',
      loadedSegmentItems: [{ aid: 1, title: 'First', sourceFolderIds: ['source-a'] }]
    })
  })

  it('reads resume cursors from the manifest without loading staged page payloads', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0,
      currentSegmentId: '', segments: []
    })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')
    await store.appendScanPage('100', 'workspace-1', {
      runId: 'scan-run-1', folderId: 'source-1', page: 1, hasMore: false,
      items: [{ aid: 1, sourceFolderIds: ['source-1'] }]
    })
    const reader = new OldFavoriteWorkspaceStore({ root })

    await expect(reader.readScanPageCursors('100', 'workspace-1')).resolves.toEqual([
      { folderId: 'source-1', page: 1, hasMore: false }
    ])
    await expect(reader.readWorkspaceReads('100', 'workspace-1')).resolves.toEqual(['manifest.json'])
  })

  it('reads a verified recovery summary without loading the active baseline segment or scan pages', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 7, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1] }]
    })

    const reader = new OldFavoriteWorkspaceStore({ root })
    await expect(reader.readRecoverySummary('100', 'workspace-1')).resolves.toMatchObject({
      workspaceId: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 7,
      currentSegmentId: 'segment-1', segmentCount: 1, manifestChecksum: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    await expect(reader.readWorkspaceReads('100', 'workspace-1')).resolves.toEqual(['manifest.json'])
  })

  it('recovers recommendation matched AID indexes from the workspace overlay', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1, 2] }, { id: 'segment-2', aids: [3] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [], recommendations: {
        initialized: true,
        candidates: [{
          id: 'custom-author-up', displayName: 'bilimi·UP', kind: 'author', sourceName: 'UP', keywords: ['UP'],
          count: 3, matchedAidsBySegment: { 'segment-1': [1, 2], 'segment-2': [3] }, reason: 'UP appeared 3 times.'
        }],
        adoptedCandidateIds: []
      }
    })

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      recommendations: {
        candidates: [{
          id: 'custom-author-up', matchedAidsBySegment: { 'segment-1': [1, 2], 'segment-2': [3] }
        }]
      }
    })
  })

  it('keeps recovery readiness and the durable local-commit marker in the manifest-only summary', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 7, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      planReadiness: { selectedAidCount: 26, classifiedAidCount: 3 }
    })
    await store.markCommitted('100', 'workspace-1', 'workspace-commit-1')

    const reader = new OldFavoriteWorkspaceStore({ root })
    await expect(reader.readRecoverySummary('100', 'workspace-1')).resolves.toMatchObject({
      status: 'completed', plannedCount: 26, classifiedCount: 3, unclassifiedCount: 23,
      lastCommittedId: 'workspace-commit-1', manifestChecksum: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    await expect(reader.readWorkspaceReads('100', 'workspace-1')).resolves.toEqual(['manifest.json'])
  })

  it('flushes queued workspace writes before shutdown', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1, 2] }]
    })
    const pending = store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }], history: []
    })

    await store.flush()
    await pending
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'] } }
    })
  })

  it('keeps an older v1 manifest recoverable when it has no scan staging fields', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0, currentSegmentId: '', segments: []
    })
    const manifestPath = join(root, 'accounts', '100', 'workspaces', 'workspace-1', 'manifest.json')
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8')) as Record<string, unknown>
    delete manifest.scanPages
    delete manifest.scanRunId
    delete manifest.managedMemberChunks
    const { checksum: _checksum, ...withoutChecksum } = manifest
    const { createHash } = await import('node:crypto')
    manifest.checksum = createHash('sha256').update(JSON.stringify(withoutChecksum)).digest('hex')
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      workspaceId: 'workspace-1', status: 'scanning'
    })
  })

  it('treats a newer workspace manifest as recovery-only and never rewrites it', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0, currentSegmentId: '', segments: [] })
    const manifestPath = join(root, 'accounts', '100', 'workspaces', 'workspace-1', 'manifest.json')
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.version = 2
    const { checksum: _checksum, ...withoutChecksum } = manifest
    const { createHash } = await import('node:crypto')
    manifest.checksum = createHash('sha256').update(JSON.stringify(withoutChecksum)).digest('hex')
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')
    const before = await (await import('node:fs/promises')).readFile(manifestPath, 'utf8')

    await expect(store.readRecoverySummary('100', 'workspace-1')).resolves.toMatchObject({ recovery: 'rebuild-required' })
    await expect(store.appendOverlay('100', 'workspace-1', { currentSegmentId: '', classifications: [], history: [] })).rejects.toThrow('not found')
    await expect((await import('node:fs/promises')).readFile(manifestPath, 'utf8')).resolves.toBe(before)
  })

  it('isolates a restarted scan run from previously committed staged pages', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({ accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0, currentSegmentId: '', segments: [] })
    await store.startScanRun('100', 'workspace-1', 'scan-run-1')
    await store.appendScanPage('100', 'workspace-1', { runId: 'scan-run-1', folderId: 'source-1', page: 1, items: [{ aid: 1, sourceFolderIds: ['source-1'] }] })
    await store.startScanRun('100', 'workspace-1', 'scan-run-2')

    await expect(store.readScanPages('100', 'workspace-1')).resolves.toEqual([])
    await expect(store.appendScanPage('100', 'workspace-1', { runId: 'scan-run-1', folderId: 'source-1', page: 2, items: [] }))
      .rejects.toThrow('scan run is stale')
  })

  it('recovers a 30000-item workspace from its manifest and loads only the requested 2000-item segment', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      segments: Array.from({ length: 15 }, (_, index) => ({
        id: `segment-${index + 1}`,
        aids: Array.from({ length: 2_000 }, (_unused, aid) => index * 2_000 + aid + 1)
      }))
    })

    const summary = await store.recover('100', 'workspace-1')

    expect(summary.loadedSegmentAids).toEqual(Array.from({ length: 2_000 }, (_unused, index) => index + 1))
    expect(summary.loadedSegmentItems).toHaveLength(2_000)
    await expect(store.readWorkspaceReads('100', 'workspace-1')).resolves.toEqual([
      'manifest.json', 'baseline/segment-1.json'
    ])
    await expect(store.loadSegment('100', 'workspace-1', 'segment-8')).resolves.toMatchObject({
      id: 'segment-8', aids: expect.arrayContaining([14_001, 16_000])
    })
  })

  it('reads committed multi-segment history for freeze planning without loading baseline chunks', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1] }, { id: 'segment-2', aids: [2] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [],
      history: [{ kind: 'bilimi-old-favorite-workspace:v1:{"type":"classification","entry":{"source":"manual","changes":[]},"historyCursor":1}', aids: [] }]
    })

    const reader = new OldFavoriteWorkspaceStore({ root })
    await expect(reader.readOverlayHistory('100', 'workspace-1')).resolves.toMatchObject([
      { currentSegmentId: 'segment-1', history: [expect.objectContaining({ aids: [] })] }
    ])
    await expect(reader.readWorkspaceReads('100', 'workspace-1')).resolves.toEqual([
      'manifest.json', 'overlay.journal.jsonl'
    ])
  })

  it('recovers compact scan folders including an empty Bilimi work folder', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      sourceFolders: [
        { id: 'source-1', title: '默认收藏夹', itemCount: 1, isBilimiWorkFolder: false },
        { id: 'bilimi-empty', title: 'Bilimi · 稍后归档', itemCount: 0, isBilimiWorkFolder: true }
      ],
      segments: [{
        id: 'segment-1',
        aids: [1],
        items: [{ aid: 1, title: '视频 1', author: 'UP 主', sourceFolderIds: ['source-1'] }]
      }]
    })

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      sourceFolders: [
        { id: 'source-1', itemCount: 1, isBilimiWorkFolder: false },
        { id: 'bilimi-empty', itemCount: 0, isBilimiWorkFolder: true }
      ],
      loadedSegmentItems: [{ aid: 1, title: '视频 1', author: 'UP 主', sourceFolderIds: ['source-1'] }]
    })
  })

  it('starts a fresh overlay journal when a scanning workspace becomes an immutable baseline', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', baselineRevision: 0, currentSegmentId: '',
      sourceFolders: [], segments: []
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: '', classifications: [], history: [], scanMetadata: { sourceFolders: [] }
    })

    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      sourceFolders: [{ id: 'source-1', title: '默认收藏夹', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: ['source-1'] }] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: []
    })

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      baselineRevision: 1,
      sourceFolders: [{ id: 'source-1', selected: true }]
    })
  })

  it('appends scan metadata without rewriting immutable baseline chunks', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      sourceFolders: [{ id: 'source-1', title: '默认收藏夹', itemCount: 1, isBilimiWorkFolder: false }],
      segments: [{ id: 'segment-1', aids: [1], items: [{ aid: 1, title: '旧标题', sourceFolderIds: ['source-1'] }] }]
    })

    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      scanMetadata: { sourceFolders: [{ id: 'source-1', title: '已重命名', itemCount: 1, isBilimiWorkFolder: false }] }
    })

    await expect(store.readWorkspaceWrites('100', 'workspace-1')).resolves.toEqual([
      'manifest.json', 'overlay.journal.jsonl'
    ])
    await expect(store.loadSegment('100', 'workspace-1', 'segment-1')).resolves.toMatchObject({
      items: [{ aid: 1, title: '旧标题' }]
    })
  })

  it('defers validation of an inactive baseline segment until that segment is requested', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1] }, { id: 'segment-2', aids: [2] }]
    })
    await writeFile(join(root, 'accounts', '100', 'workspaces', 'workspace-1', 'baseline', 'segment-2.json'), '{corrupt', 'utf8')

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      workspaceId: 'workspace-1', currentSegmentId: 'segment-1'
    })
    await expect(store.loadSegment('100', 'workspace-1', 'segment-2')).rejects.toThrow('Old favorite workspace segment is corrupt.')
  })

  it('marks a corrupted overlay journal for workspace rebuild without deleting completed local records', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }], history: []
    })
    await store.corruptOverlayForTest('100', 'workspace-1')

    await expect(store.recover('100', 'workspace-1')).resolves.toMatchObject({
      recovery: 'rebuild-required', preserveCompletedLocalResults: true
    })
  })

  it('rejects a missing committed overlay journal instead of treating it as an empty freeze history', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }], history: []
    })
    await unlink(join(root, 'accounts', '100', 'workspaces', 'workspace-1', 'overlay.journal.jsonl'))

    await expect(store.readOverlayHistory('100', 'workspace-1')).rejects.toThrow('Old favorite workspace journal is corrupt.')
  })

  it('discards a valid uncommitted journal tail before the next append', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1',
      segments: [{ id: 'segment-1', aids: [1] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }], history: []
    })
    await store.appendUncommittedOverlayForTest('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [{ aid: 2, targetLedgerIds: ['game'], source: 'manual' }], history: []
    })

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'] } }
    })

    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [{ aid: 1, targetLedgerIds: ['knowledge'], source: 'manual' }], history: []
    })
    const recovered = await new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')
    expect('recovery' in recovered ? recovered : recovered.classifications).toEqual({
      '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'manual' }
    })
  })

  it('reconstructs tag enrichment from compact per-aid deltas instead of repeating pending arrays', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1,
      currentSegmentId: 'segment-1', segments: [{ id: 'segment-1', aids: [1, 2] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      tagEnrichment: {
        status: 'running', totalItemCount: 2, completedItemCount: 0,
        pendingAids: [1, 2], failedAids: [], reusedTagItemCount: 0, taggedAids: []
      }
    })

    await store.appendTagEnrichmentDelta('100', 'workspace-1', {
      currentSegmentId: 'segment-1', kind: 'tagged', aid: 1, tags: ['游戏']
    })
    await store.appendTagEnrichmentDelta('100', 'workspace-1', {
      currentSegmentId: 'segment-1', kind: 'failed', aid: 2
    })

    const recovered = await new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')
    expect(recovered).toMatchObject({
      tagEnrichment: {
        status: 'complete', totalItemCount: 2, completedItemCount: 2,
        pendingAids: [], failedAids: [2], taggedAids: [1]
      },
      tagUpdates: [{ aid: 1, tags: ['游戏'] }]
    })
    const journal = await readFile(join(root, 'accounts', '100', 'workspaces', 'workspace-1', 'overlay.journal.jsonl'), 'utf8')
    const lines = journal.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).not.toContain('pendingAids')
    expect(lines[1]).not.toContain('taggedAids')
    expect(lines[2]).not.toContain('pendingAids')
  })

  it('persists compact retry and pause checkpoints without losing failed aids', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1,
      currentSegmentId: 'segment-1', segments: [{ id: 'segment-1', aids: [1] }]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      tagEnrichment: {
        status: 'running', totalItemCount: 1, completedItemCount: 0,
        pendingAids: [1], failedAids: [], reusedTagItemCount: 0, taggedAids: []
      }
    })
    await store.appendTagEnrichmentDelta('100', 'workspace-1', {
      currentSegmentId: 'segment-1', kind: 'failed', aid: 1
    })
    await store.appendTagEnrichmentDelta('100', 'workspace-1', {
      currentSegmentId: 'segment-1', kind: 'retry-failed'
    })
    await store.appendTagEnrichmentDelta('100', 'workspace-1', {
      currentSegmentId: 'segment-1', kind: 'status', status: 'paused'
    })

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'paused', totalItemCount: 1, completedItemCount: 0,
        pendingAids: [1], failedAids: [], taggedAids: []
      }
    })
  })

  it('persists accepted tag segments without discarding their resumable pending aids', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1,
      currentSegmentId: 'segment-1', segments: [
        { id: 'segment-1', aids: [1] }, { id: 'segment-2', aids: [2] }
      ]
    })
    await store.appendOverlay('100', 'workspace-1', {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      tagEnrichment: {
        status: 'running', totalItemCount: 2, completedItemCount: 0,
        pendingAids: [1, 2], failedAids: [], reusedTagItemCount: 0, taggedAids: []
      }
    })

    await store.appendTagEnrichmentDelta('100', 'workspace-1', {
      currentSegmentId: 'segment-1', kind: 'accept-segment', segmentId: 'segment-1'
    })
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingAids: [1, 2], acceptedSegmentIds: ['segment-1'] }
    })

    await store.appendTagEnrichmentDelta('100', 'workspace-1', {
      currentSegmentId: 'segment-1', kind: 'resume-segment', segmentId: 'segment-1'
    })
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingAids: [1, 2], acceptedSegmentIds: [] }
    })
  })

  it('atomically compacts a large legacy tag journal before committing the next delta', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    const pendingAids = Array.from({ length: 2_000 }, (_unused, index) => index + 1)
    await store.create({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing', baselineRevision: 1,
      currentSegmentId: 'segment-1', segments: [{ id: 'segment-1', aids: pendingAids }]
    })
    const directory = join(root, 'accounts', '100', 'workspaces', 'workspace-1')
    const journalPath = join(directory, 'overlay.journal.jsonl')
    const legacyLine = `${JSON.stringify({
      currentSegmentId: 'segment-1', classifications: [], history: [],
      tagEnrichment: {
        status: 'running', totalItemCount: 2_000, completedItemCount: 0,
        pendingAids, failedAids: [], reusedTagItemCount: 0, taggedAids: []
      }
    })}\n`
    const legacyJournal = legacyLine.repeat(140)
    await writeFile(journalPath, legacyJournal, 'utf8')
    const manifestPath = join(directory, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    delete manifest.journalChecksumMode
    delete manifest.journalFile
    const { createHash } = await import('node:crypto')
    manifest.journalCursor = Buffer.byteLength(legacyJournal, 'utf8')
    manifest.journalChecksum = createHash('sha256').update(legacyJournal).digest('hex')
    const { checksum: _checksum, ...withoutChecksum } = manifest
    manifest.checksum = createHash('sha256').update(JSON.stringify(withoutChecksum)).digest('hex')
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')

    await new OldFavoriteWorkspaceStore({ root }).appendTagEnrichmentDelta('100', 'workspace-1', {
      currentSegmentId: 'segment-1', kind: 'tagged', aid: 1, tags: ['游戏']
    })

    const compactManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      journalFile: string; journalChecksumMode: string
    }
    expect(compactManifest.journalChecksumMode).toBe('chain-sha256-v1')
    expect(compactManifest.journalFile).toMatch(/^overlay\.compact\..+\.jsonl$/)
    const compactJournal = await readFile(join(directory, compactManifest.journalFile), 'utf8')
    expect(Buffer.byteLength(compactJournal, 'utf8')).toBeLessThan(Buffer.byteLength(legacyJournal, 'utf8') / 10)
    await expect(readFile(journalPath, 'utf8')).rejects.toThrow()
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      tagEnrichment: { completedItemCount: 1, pendingAids: expect.not.arrayContaining([1]), taggedAids: [1] },
      tagUpdates: [{ aid: 1, tags: ['游戏'] }]
    })
  })
})

import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
      segments: [{ id: 'segment-1', aids: [1] }]
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

  it('ignores a valid journal tail that was appended before its manifest pointer committed', async () => {
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
      currentSegmentId: 'segment-1', classifications: [{ aid: 1, targetLedgerIds: ['game'], source: 'manual' }], history: []
    })

    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', 'workspace-1')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'] } }
    })
  })
})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

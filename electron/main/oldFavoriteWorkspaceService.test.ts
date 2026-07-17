import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OldFavoriteWorkspaceService } from './oldFavoriteWorkspaceService'

const roots: string[] = []

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('OldFavoriteWorkspaceService', () => {
  it('does no filesystem work until an account is explicitly opened', async () => {
    const root = await createRoot()
    const access = vi.fn()
    const service = new OldFavoriteWorkspaceService({ root, onFileAccess: access })

    expect(service.isOpen()).toBe(false)
    expect(access).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('opens only the tiny account index and loads batch details on demand', async () => {
    const root = await createRoot()
    const first = new OldFavoriteWorkspaceService({ root })
    await first.openAccount('100')
    const batch = await first.createBatch({ accountMid: '100', kind: 'full', createdAt: '2026-07-17T09:45:00.000Z' })
    await first.appendChunk('100', batch.id, 'base', [{ aid: 1, title: 'one' }])
    await first.finalizeBatch('100', batch.id)

    const access = vi.fn()
    const reopened = new OldFavoriteWorkspaceService({ root, onFileAccess: access })
    const index = await reopened.openAccount('100')

    expect(index.batches).toHaveLength(1)
    expect(access.mock.calls.map(([operation, path]) => `${operation}:${path}`)).toEqual([
      expect.stringMatching(/^read:.*index\.json$/)
    ])

    access.mockClear()
    const detail = await reopened.loadBatch('100', batch.id)
    expect(detail.base).toEqual([{ aid: 1, title: 'one' }])
    expect(access).toHaveBeenCalledWith('read', expect.stringMatching(/manifest\.json$/))
    expect(access).toHaveBeenCalledWith('read', expect.stringMatching(/base-000001\.jsonl$/))
  })

  it('keeps a Windows-safe storage key separate from a colon-containing business batch id', async () => {
    const root = await createRoot()
    const batchId = 'old-favorite:100:full:20260717141313966:0'
    const first = new OldFavoriteWorkspaceService({ root })
    await first.openAccount('100')

    const batch = await first.createBatch({
      accountMid: '100', kind: 'full', id: batchId, createdAt: '2026-07-17T14:13:13.966Z'
    })
    await first.appendChunk('100', batch.id, 'base', [{ aid: 1 }])

    expect(batch.id).toBe(batchId)
    const batchDirectories = await readdir(join(root, 'accounts', '100', 'batches'))
    expect(batchDirectories).toHaveLength(1)
    expect(batchDirectories[0]).not.toContain(':')

    const index = JSON.parse(await readFile(join(root, 'accounts', '100', 'index.json'), 'utf8'))
    expect(index.batches[0]).toMatchObject({ id: batchId, storageKey: batchDirectories[0] })

    const reopened = new OldFavoriteWorkspaceService({ root })
    expect((await reopened.openAccount('100')).batches[0].id).toBe(batchId)
    expect((await reopened.loadBatch('100', batchId)).base).toEqual([{ aid: 1 }])
  })

  it('appends verified chunks without reading or rewriting earlier chunks and finalizes idempotently', async () => {
    const root = await createRoot()
    const access = vi.fn()
    const service = new OldFavoriteWorkspaceService({ root, onFileAccess: access })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })

    await service.appendChunk('100', batch.id, 'base', [{ aid: 1 }])
    access.mockClear()
    await service.appendChunk('100', batch.id, 'base', [{ aid: 2 }])

    const paths = access.mock.calls.map(([, path]) => String(path))
    expect(paths.some((path) => path.endsWith('base-000001.jsonl'))).toBe(false)
    expect(paths.filter((path) => path.endsWith('base-000002.jsonl'))).toHaveLength(1)

    access.mockClear()
    const finalized = await service.finalizeBatch('100', batch.id)
    expect(finalized.status).toBe('archived')
    expect(access.mock.calls.some(([, path]) => String(path).endsWith('.jsonl'))).toBe(false)
    access.mockClear()
    await expect(service.finalizeBatch('100', batch.id)).resolves.toEqual(finalized)
    expect(access.mock.calls.some(([operation]) => operation === 'write')).toBe(false)
    await expect(service.appendChunk('100', batch.id, 'base', [{ aid: 3 }])).rejects.toThrow('finalized')
  })

  it('commits base tags and sources as one logical manifest update', async () => {
    const root = await createRoot()
    const access = vi.fn()
    const service = new OldFavoriteWorkspaceService({ root, onFileAccess: access })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })
    access.mockClear()

    const records = await service.appendChunkGroup('100', batch.id, {
      base: [{ aid: 1, title: 'one' }],
      tags: [{ aid: 1, tags: ['tag'] }],
      sources: [{ aid: 1, sourceFolderIds: ['source'] }]
    })

    expect(records.map((record) => record.kind)).toEqual(['base', 'tags', 'sources'])
    expect(access.mock.calls.filter(([, path]) => String(path).endsWith('manifest.json.tmp'))).toHaveLength(1)
    const detail = await service.loadBatch('100', batch.id)
    expect(detail.base).toHaveLength(1)
    expect(detail.tags).toHaveLength(1)
    expect(detail.sources).toHaveLength(1)
  })

  it('assigns distinct sequences when logical chunk groups append concurrently', async () => {
    const root = await createRoot()
    const service = new OldFavoriteWorkspaceService({ root })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })

    const [first, second] = await Promise.all([
      service.appendChunkGroup('100', batch.id, {
        base: [{ aid: 1 }],
        tags: [{ aid: 1, tags: ['first'] }],
        sources: [{ aid: 1, sourceFolderIds: ['first'] }]
      }),
      service.appendChunkGroup('100', batch.id, {
        base: [{ aid: 2 }],
        tags: [{ aid: 2, tags: ['second'] }],
        sources: [{ aid: 2, sourceFolderIds: ['second'] }]
      })
    ])

    expect(first.map((record) => record.sequence)).toEqual([1, 1, 1])
    expect(second.map((record) => record.sequence)).toEqual([2, 2, 2])
    const detail = await service.loadBatch('100', batch.id)
    expect(detail.base).toEqual([{ aid: 1 }, { aid: 2 }])
    expect(detail.tags).toEqual([
      { aid: 1, tags: ['first'] },
      { aid: 2, tags: ['second'] }
    ])
    expect(detail.sources).toEqual([
      { aid: 1, sourceFolderIds: ['first'] },
      { aid: 2, sourceFolderIds: ['second'] }
    ])
  })

  it('assigns distinct sequences when individual chunks append concurrently', async () => {
    const root = await createRoot()
    const service = new OldFavoriteWorkspaceService({ root })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })

    const [first, second] = await Promise.all([
      service.appendChunk('100', batch.id, 'sources', [{ aid: 1 }]),
      service.appendChunk('100', batch.id, 'sources', [{ aid: 2 }])
    ])

    expect([first.sequence, second.sequence]).toEqual([1, 2])
    expect((await service.loadBatch('100', batch.id)).sources).toEqual([{ aid: 1 }, { aid: 2 }])
  })

  it('does not expose a partial logical chunk and can retry after a middle file write fails', async () => {
    const root = await createRoot()
    let failTagsOnce = true
    const service = new OldFavoriteWorkspaceService({
      root,
      onFileAccess(operation, path) {
        if (operation === 'write' && failTagsOnce && path.endsWith('tags-000001.jsonl')) {
          failTagsOnce = false
          throw new Error('injected tags write failure')
        }
      }
    })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })
    const chunks = {
      base: [{ aid: 1 }],
      tags: [{ aid: 1, tags: ['tag'] }],
      sources: [{ aid: 1, sourceFolderIds: ['source'] }]
    }

    await expect(service.appendChunkGroup('100', batch.id, chunks)).rejects.toThrow('injected tags write failure')
    expect((await service.loadBatch('100', batch.id)).base).toEqual([])

    await expect(service.appendChunkGroup('100', batch.id, chunks)).resolves.toHaveLength(3)
    const detail = await service.loadBatch('100', batch.id)
    expect(detail.base).toEqual(chunks.base)
    expect(detail.tags).toEqual(chunks.tags)
    expect(detail.sources).toEqual(chunks.sources)
  })

  it('recovers an entire corrupt logical group instead of exposing its remaining files', async () => {
    const root = await createRoot()
    const service = new OldFavoriteWorkspaceService({ root })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })
    await service.appendChunkGroup('100', batch.id, {
      base: [{ aid: 1 }],
      tags: [{ aid: 1, tags: ['tag'] }],
      sources: [{ aid: 1, sourceFolderIds: ['source'] }]
    })
    await writeFile(
      join(root, 'accounts', '100', 'batches', batch.storageKey, 'tags-000001.jsonl'),
      '{"aid":1}\n#broken',
      'utf8'
    )

    const reopened = new OldFavoriteWorkspaceService({ root })
    await reopened.openAccount('100')
    const recovered = await reopened.recoverBatch('100', batch.id)

    expect(recovered.discardedTail).toEqual([
      'base-000001.jsonl', 'tags-000001.jsonl', 'sources-000001.jsonl'
    ])
    const detail = await reopened.loadBatch('100', batch.id)
    expect(detail.base).toEqual([])
    expect(detail.tags).toEqual([])
    expect(detail.sources).toEqual([])
  })

  it('repairs the index when finalize wrote the manifest but the index write failed', async () => {
    const root = await createRoot()
    let failIndexOnce = false
    const service = new OldFavoriteWorkspaceService({
      root,
      onFileAccess(operation, path) {
        if (operation === 'write' && failIndexOnce && path.endsWith('index.json.tmp')) {
          failIndexOnce = false
          throw new Error('injected index write failure')
        }
      }
    })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })
    failIndexOnce = true

    await expect(service.finalizeBatch('100', batch.id)).rejects.toThrow('injected index write failure')
    await expect(service.finalizeBatch('100', batch.id)).resolves.toMatchObject({ id: batch.id, status: 'archived' })
    expect((await service.openAccount('100')).batches[0].status).toBe('archived')
  })

  it('repairs an active index from an archived manifest after service restart', async () => {
    const root = await createRoot()
    let failIndexOnce = false
    const first = new OldFavoriteWorkspaceService({
      root,
      onFileAccess(operation, path) {
        if (operation === 'write' && failIndexOnce && path.endsWith('index.json.tmp')) {
          failIndexOnce = false
          throw new Error('injected index write failure')
        }
      }
    })
    await first.openAccount('100')
    const batch = await first.createBatch({ accountMid: '100', kind: 'full' })
    failIndexOnce = true
    await expect(first.finalizeBatch('100', batch.id)).rejects.toThrow('injected index write failure')

    const restarted = new OldFavoriteWorkspaceService({ root })
    expect((await restarted.openAccount('100')).batches[0].status).toBe('active')
    await expect(restarted.finalizeBatch('100', batch.id)).resolves.toMatchObject({
      id: batch.id,
      status: 'archived'
    })
    expect((await restarted.openAccount('100')).batches[0].status).toBe('archived')

    const reopenedAgain = new OldFavoriteWorkspaceService({ root })
    expect((await reopenedAgain.openAccount('100')).batches[0].status).toBe('archived')
    await expect(reopenedAgain.finalizeBatch('100', batch.id)).resolves.toMatchObject({
      id: batch.id,
      status: 'archived'
    })
  })

  it('returns the existing batch when creation is retried with the same id', async () => {
    const root = await createRoot()
    const service = new OldFavoriteWorkspaceService({ root })
    await service.openAccount('100')

    const first = await service.createBatch({
      accountMid: '100', kind: 'full', id: 'stable-batch', createdAt: '2026-07-17T10:00:00.000Z'
    })
    const retried = await service.createBatch({
      accountMid: '100', kind: 'full', id: 'stable-batch', createdAt: '2026-07-17T10:00:00.000Z'
    })

    expect(retried).toEqual(first)
    expect((await service.openAccount('100')).batches).toEqual([first])
  })

  it('recovers all verified chunks and drops only a corrupt tail chunk', async () => {
    const root = await createRoot()
    const service = new OldFavoriteWorkspaceService({ root })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })
    await service.appendChunk('100', batch.id, 'base', [{ aid: 1 }])
    await service.appendChunk('100', batch.id, 'base', [{ aid: 2 }])

    const corruptPath = join(root, 'accounts', '100', 'batches', batch.storageKey, 'base-000002.jsonl')
    await writeFile(corruptPath, '{"aid":999}\n#broken', 'utf8')

    const reopened = new OldFavoriteWorkspaceService({ root })
    await reopened.openAccount('100')
    const recovered = await reopened.recoverBatch('100', batch.id)
    expect(recovered.discardedTail).toBe('base-000002.jsonl')
    expect((await reopened.loadBatch('100', batch.id)).base).toEqual([{ aid: 1 }])
    expect(await readFile(corruptPath, 'utf8').catch(() => '')).toBe('')
  })

  it('coalesces overlay changes by aid and keeps later scan data from replacing them', async () => {
    const root = await createRoot()
    const service = new OldFavoriteWorkspaceService({ root })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })
    await service.appendChunk('100', batch.id, 'base', [{ aid: 1, title: 'base' }])
    await service.patchOverlay('100', batch.id, 'user', { aid: 1, targets: ['manual'] })
    await service.patchOverlay('100', batch.id, 'user', { aid: 1, targets: ['manual-final'] })
    await service.appendChunk('100', batch.id, 'tags', [{ aid: 1, tags: ['later'] }])
    await service.flush()

    const detail = await service.loadBatch('100', batch.id)
    expect(detail.overlays.user).toEqual({ '1': { aid: 1, targets: ['manual-final'] } })
    expect(detail.base).toEqual([{ aid: 1, title: 'base' }])
    expect(detail.tags).toEqual([{ aid: 1, tags: ['later'] }])
  })

  it('removes every local layer for one account without invoking external mutations', async () => {
    const root = await createRoot()
    const mutateBilibili = vi.fn()
    const service = new OldFavoriteWorkspaceService({ root, mutateBilibili })
    await service.openAccount('100')
    const batch = await service.createBatch({ accountMid: '100', kind: 'full' })
    await service.appendChunk('100', batch.id, 'base', [{ aid: 1 }])
    await service.patchOverlay('100', batch.id, 'execution', { aid: 1, status: 'done' })
    await service.resetAccount('100')

    expect(mutateBilibili).not.toHaveBeenCalled()
    expect((await service.openAccount('100')).batches).toEqual([])
  })
})

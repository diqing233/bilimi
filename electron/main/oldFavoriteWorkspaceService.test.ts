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

  it('appends verified chunks without reading or rewriting earlier chunks and finalizes once', async () => {
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
    await expect(service.finalizeBatch('100', batch.id)).rejects.toThrow('already finalized')
    await expect(service.appendChunk('100', batch.id, 'base', [{ aid: 3 }])).rejects.toThrow('finalized')
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

    const corruptPath = join(root, 'accounts', '100', 'batches', batch.id, 'base-000002.jsonl')
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

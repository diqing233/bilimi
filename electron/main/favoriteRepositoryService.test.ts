import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FavoriteRepositoryService } from './favoriteRepositoryService'

const roots: string[] = []

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-favorite-repository-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FavoriteRepositoryService', () => {
  it('loads only the requested account and stores folder membership as aid indexes', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })

    await service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'A', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'members-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-folder-members',
      payload: { folderId: 'local:inbox', aids: [1] }
    })

    expect((await service.getFolderPage('100', 'local:inbox', { limit: 10 })).items.map((item) => item.aid)).toEqual([1])
    await expect(service.getSnapshot('200')).resolves.toMatchObject({ accountMid: '200', videos: {} })
    const manifest = JSON.parse(await readFile(join(root, 'accounts', '100', 'repository.manifest.json'), 'utf8')) as { generation: string }
    expect(await readFile(join(root, 'accounts', '100', 'generations', manifest.generation, 'memberships.jsonl'), 'utf8'))
      .toContain('{"folderId":"local:inbox","aids":[1]}')
  })

  it('recovers a valid atomic temporary snapshot after an interrupted commit', async () => {
    const root = await createRoot()
    const first = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    await first.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Recovered', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    const manifestPath = join(root, 'accounts', '100', 'repository.manifest.json')
    const persisted = await readFile(manifestPath, 'utf8')
    await writeFile(`${manifestPath}.tmp`, persisted, 'utf8')
    await writeFile(manifestPath, '{not-json', 'utf8')

    await expect(new FavoriteRepositoryService({ root }).getSnapshot('100')).resolves.toMatchObject({
      accountMid: '100', revision: 1, videos: { '1': { title: 'Recovered' } }
    })
  })

  it('rejects a generation when its JSONL content no longer matches the committed manifest checksum', async () => {
    const root = await createRoot()
    const first = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    await first.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Verified', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    const accountDirectory = join(root, 'accounts', '100')
    const manifest = JSON.parse(await readFile(join(accountDirectory, 'repository.manifest.json'), 'utf8')) as { generation: string }
    await writeFile(join(accountDirectory, 'generations', manifest.generation, 'videos.jsonl'), '{"aid":999}\n', 'utf8')

    await expect(new FavoriteRepositoryService({ root }).getSnapshot('100')).resolves.toMatchObject({
      accountMid: '100', revision: 0, videos: {}
    })
  })

  it('rolls back only to the previous complete generation when the active generation is corrupt', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    await service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'First', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'video-2', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 2, title: 'Second', tags: [], updatedAt: '2026-07-19T00:00:01.000Z' }
    })

    const accountDirectory = join(root, 'accounts', '100')
    const manifest = JSON.parse(await readFile(join(accountDirectory, 'repository.manifest.json'), 'utf8')) as { generation: string }
    await writeFile(join(accountDirectory, 'generations', manifest.generation, 'memberships.jsonl'), '{"folderId":"broken","aids":[2]}\n', 'utf8')

    await expect(new FavoriteRepositoryService({ root }).getSnapshot('100')).resolves.toMatchObject({
      accountMid: '100', revision: 1, videos: { '1': { title: 'First' } }
    })
  })

  it('returns the original result when the same command id is replayed', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const command = {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video' as const,
      payload: { aid: 1, title: 'Original', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    }

    const first = await service.commit('100', command)
    const replay = await service.commit('100', { ...command, payload: { ...command.payload, title: 'Ignored' } })

    expect(replay).toEqual(first)
    expect((await service.getSnapshot('100')).videos['1'].title).toBe('Original')
  })

  it('rejects a cross-account command even when its id was already committed', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const command = {
      id: 'shared-command-id', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video' as const,
      payload: { aid: 1, title: 'Original', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    }

    await service.commit('100', command)

    await expect(service.commit('100', { ...command, accountMid: '200' }))
      .rejects.toThrow('Favorite repository account mismatch.')
    expect((await service.getSnapshot('100')).videos['1'].title).toBe('Original')
  })

  it('reports a pending durable commit so the quit barrier can wait even when old favorite state is clean', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const pending = service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Pending', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    expect((service as unknown as { hasPendingWrites(): boolean }).hasPendingWrites()).toBe(true)
    await service.flush()
    await pending
    expect((service as unknown as { hasPendingWrites(): boolean }).hasPendingWrites()).toBe(false)
  })

  it('journals sync checkpoints and recovers them without rewriting every repository generation', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    await service.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { id: 'workspace-1', accountMid: '100', status: 'executing', baselineRevision: 1, continuationAids: [] }
    })
    const generationDirectory = join(root, 'accounts', '100', 'generations')
    const before = await readdir(generationDirectory)

    await service.recordSyncCheckpoint('100', 'checkpoint-pending', {
      id: 'run-1:append-1', commandId: 'append-1', status: 'pending', affectedAids: [1], updatedAt: '2026-07-19T00:00:00.000Z', runId: 'run-1', operationKey: 'append-1', attempt: 1
    })
    await service.recordSyncCheckpoint('100', 'checkpoint-result', {
      id: 'run-1:append-1', commandId: 'append-1', status: 'succeeded', affectedAids: [1], updatedAt: '2026-07-19T00:00:00.000Z', runId: 'run-1', operationKey: 'append-1', attempt: 1
    })

    expect(await readdir(generationDirectory)).toEqual(before)
    const restarted = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    expect(await restarted.getSyncCheckpoints('100', 'run-1')).toEqual([
      expect.objectContaining({ id: 'run-1:append-1', status: 'succeeded' })
    ])

    await restarted.commit('100', {
      id: 'compact-sync-journal', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { id: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1, continuationAids: [] }
    })
    const manifest = JSON.parse(await readFile(join(root, 'accounts', '100', 'repository.manifest.json'), 'utf8')) as { generation: string }
    const persisted = JSON.parse(await readFile(join(root, 'accounts', '100', 'generations', manifest.generation, 'repository.json'), 'utf8')) as {
      commandResults: Record<string, unknown>
      snapshot: { syncRecords: Array<{ id: string; status: string }> }
    }
    expect(persisted.commandResults).not.toHaveProperty('checkpoint-pending')
    expect(persisted.commandResults).not.toHaveProperty('checkpoint-result')
    expect(persisted.snapshot.syncRecords).toEqual([
      expect.objectContaining({ id: 'run-1:append-1', status: 'succeeded' })
    ])
  })
})

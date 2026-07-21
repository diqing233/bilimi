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

  it('returns only the requested library page without reading unselected repository videos', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    const videos: Record<string, { aid: number; title: string; tags: string[]; updatedAt: string }> = {
      '1': { aid: 1, title: 'First', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    }
    Object.defineProperty(videos, '2', {
      enumerable: true,
      get: () => { throw new Error('unselected video must not be read') }
    })
    ;(service as unknown as { cache: Map<string, unknown> }).cache.set('100', {
      repository: {
        version: 1,
        accountMid: '100',
        snapshot: {
          version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z',
          videos, folders: [], memberships: {}, physicalShards: [], syncRecords: [],
          organizationRecords: [], organizationMigrationInitialized: false
        },
        commandResults: {}
      }
    })

    await expect(service.getLibraryPage('100', { kind: 'all' }, { limit: 1 })).resolves.toEqual({
      version: 1, accountMid: '100', revision: 1,
      items: [{
        video: { aid: 1, title: 'First', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
          folderIds: [], pendingStates: ['unsynced']
      }],
      nextCursor: '1'
    })
  })

  it('does not use an old remote checkpoint as a local mirror confirmation', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await service.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Local', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'members', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'local-save', memberAidsByFolderId: { 'local:music': [1] },
        folders: [{ id: 'local:music', title: 'Music', kind: 'local', syncState: 'local-only' }] }
    })
    await service.commit('100', {
      id: 'binding', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: 'remote-music' }
    })

    await expect(service.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({
      items: [{ video: { aid: 1 }, pendingStates: ['unsynced'] }]
    })
    await service.recordSyncCheckpoint('100', 'succeeded', {
      id: 'run:append', commandId: 'run:append', runId: 'run', operationKey: 'append:1', status: 'succeeded',
      affectedAids: [1], targetFolderIds: ['remote-music'], updatedAt: '2026-07-20T00:00:00.000Z', attempt: 1
    })
    await expect(service.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({
      items: [{ video: { aid: 1 }, pendingStates: ['unsynced'] }]
    })
  })

  it('marks trusted source-scan metadata synced and keeps only actionable work pending after organization', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-21T00:00:00.000Z' })
    await service.commit('100', {
      id: 'source', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'scan-1', folders: [{ id: 'bilibili:source', title: 'Source', remoteFolderId: 'source' }],
        memberAidsByFolderId: { 'bilibili:source': Array.from({ length: 243 }, (_, index) => index + 1) },
        videos: Array.from({ length: 243 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, tags: [], updatedAt: '2026-07-21T00:00:00.000Z' })) }
    })
    for (const aid of Array.from({ length: 15 }, (_, index) => index + 221)) {
      await service.commit('100', { id: `local-${aid}`, accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-library-mirror', payload: { aid, status: 'never', metadataRevision: 1 } })
    }
    await service.recordSyncCheckpoint('100', 'failed', { id: 'failed', commandId: 'failed', status: 'failed', affectedAids: [236, 237, 238, 239, 240], updatedAt: '2026-07-21T00:00:00.000Z' })
    await service.recordSyncCheckpoint('100', 'unknown', { id: 'unknown', commandId: 'unknown', status: 'result-unknown', affectedAids: [241, 242, 243], updatedAt: '2026-07-21T00:00:00.000Z' })

    await expect(service.getLibrarySummary('100')).resolves.toMatchObject({ pendingAidCount: 23 })
  })

  it('marks only formal organization records as protected library rows', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-21T00:00:00.000Z' })
    await service.commit('100', {
      id: 'source', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'scan-1', folders: [], memberAidsByFolderId: {}, videos: [
        { aid: 1, title: 'Protected', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' },
        { aid: 2, title: 'Staged', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' }
      ] }
    })
    await service.commit('100', {
      id: 'protection', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-music'], completedAt: '2026-07-21T00:00:00.000Z' }] }
    })

    await expect(service.getLibraryPage('100', { kind: 'all' }, { limit: 10 })).resolves.toMatchObject({
      items: [
        { video: { aid: 1 }, pendingStates: ['protected'] },
        { video: { aid: 2 }, pendingStates: ['unsynced'] }
      ]
    })
  })

  it('persists account-isolated organization recovery records across a repository restart', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-21T00:00:00.000Z' })
    await service.commit('100', {
      id: 'change', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-organization-change',
      payload: { change: {
        id: 'run-1:append-1:succeeded', runId: 'run-1', workspaceId: 'workspace-1', accountMid: '100', aid: 1,
        beforeFolderIds: ['source'], afterFolderIds: ['remote-music'], addedFolderIds: ['remote-music'], removedFolderIds: ['source'],
        status: 'succeeded', recordedAt: '2026-07-21T00:00:00.000Z'
      } }
    })

    await expect(new FavoriteRepositoryService({ root }).getOrganizationChanges('100')).resolves.toEqual([
      expect.objectContaining({ runId: 'run-1', aid: 1, beforeFolderIds: ['source'], afterFolderIds: ['remote-music'] })
    ])
    await expect(new FavoriteRepositoryService({ root }).getOrganizationChanges('200')).resolves.toEqual([])
  })

  it('clears only Bilibili mirror folders and mirror-only videos while preserving local repository data', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-21T00:00:00.000Z' })
    await service.commit('100', {
      id: 'source-mirror', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1',
        folders: [{ id: 'bilibili:source', title: 'Source', remoteFolderId: 'source' }],
        memberAidsByFolderId: { 'bilibili:source': [1, 2] },
        videos: [
          { aid: 1, title: 'Mirror only', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' },
          { aid: 2, title: 'Also local', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' }
        ]
      }
    })
    await service.commit('100', {
      id: 'local-keep', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: { 'local:inbox': [2, 3] },
        folders: [{ id: 'local:inbox', title: '暂存', kind: 'local', syncState: 'local-only' }],
        videos: [{ aid: 3, title: 'Local only', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' }] }
    })
    await service.commit('100', {
      id: 'library-mirror', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 1, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-21T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'retained-library-mirror', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 2, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-21T00:00:00.000Z' }
    })

    await service.commit('100', {
      id: 'clear-bilibili-mirror', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'clear-bilibili-mirror', payload: {}
    })

    await expect(service.getSnapshot('100')).resolves.toMatchObject({
      folders: [{ id: 'local:inbox', kind: 'local' }],
      memberships: { 'local:inbox': [2, 3] },
      videos: { '2': { aid: 2 }, '3': { aid: 3 } },
      libraryMirrors: {}
    })
  })

  it('keeps the last successful mirror timestamp when a later local refresh fails', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    await service.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Mirror', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'mirror-ok', accountMid: '100', issuedAt: '2026-07-20T01:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 1, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'mirror-failed', accountMid: '100', issuedAt: '2026-07-20T02:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 1, status: 'failed', metadataRevision: 1, lastSyncedAt: '2026-07-20T01:00:00.000Z', errorCode: 'network' }
    })

    await expect(service.getLibraryDetail('100', 1)).resolves.toMatchObject({
      mirror: { status: '同步失败', lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })
  })

  it('reports the local metadata mirror without reusing remote favorite sync records', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    await service.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 7, title: '镜像视频', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'mirror', accountMid: '100', issuedAt: '2026-07-20T01:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 7, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })

    await expect(service.getLibraryDetail('100', 7)).resolves.toMatchObject({
      mirror: { status: '已同步', lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })
  })

  it('uses the local mirror record, rather than old remote checkpoints, for the pending library page', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    await service.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 8, title: '已镜像', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'mirror', accountMid: '100', issuedAt: '2026-07-20T01:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 8, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })

    await expect(service.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({ items: [] })
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
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'executing', baselineRevision: 1, continuationAids: [],
        workspaceRef: {
          workspaceId: 'workspace-1', accountMid: '100', status: 'executing', baselineRevision: 1,
          currentSegmentId: 'segment-1', overlayRevision: 1, journalCursor: 1, checksum: 'a'.repeat(64)
        }
      }
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
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1, continuationAids: [],
        workspaceRef: {
          workspaceId: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1,
          currentSegmentId: 'segment-1', overlayRevision: 1, journalCursor: 1, checksum: 'a'.repeat(64)
        }
      }
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

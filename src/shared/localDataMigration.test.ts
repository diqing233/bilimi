import { describe, expect, it } from 'vitest'
import {
  createMigrationArchiveV1,
  mergeMigrationAccounts,
  parseMigrationArchiveV1,
  restorePortableAccountState
} from './localDataMigration'
import { createAccountFavoriteRepositorySnapshot, createFavoriteRepositoryArchiveExport, createFavoriteRepositoryArchiveExportChecksum, validateFavoriteRepositoryArchiveExport } from './favoriteRepository'
import {
  LOCAL_DATA_MIGRATION_ACCOUNT_SOURCES,
  LOCAL_DATA_MIGRATION_EXCLUDED_SOURCES,
  LOCAL_DATA_MIGRATION_SHARED_SETTINGS
} from './localDataMigrationRegistry'

const account = (updatedAt = '2026-07-24T00:00:00.000Z') => ({
  repository: createFavoriteRepositoryArchiveExport({
    ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: updatedAt }),
    videos: { '1': { aid: 1, cid: 11, title: 'video', tags: [], updatedAt } }
  }, { generatedAt: updatedAt }),
  archives: [{ id: 'archive-1', source: { accountMid: '100', title: 'video', url: 'https://www.bilibili.com/video/av1?p=1', tags: [] }, versions: [{ id: 'version-1', createdAt: updatedAt, plainTranscript: '', summaryText: '', note: { id: 'account:100:aid:1:cid:11', source: { accountMid: '100', title: 'video', url: 'https://www.bilibili.com/video/av1?p=1', tags: [] }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: 'memo', starred: true, createdAt: updatedAt, updatedAt } }], createdAt: updatedAt, updatedAt }],
  auditEvents: [],
  settings: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] as unknown[], transcriptionModelId: 'faster-whisper-large-v3-turbo', updatedAt },
  workspaces: [{ id: 'work-1', accountMid: '100', status: 'running', updatedAt }],
  transcription: [{ id: 'transcription-1', accountMid: '100', aid: 1, cid: 11, status: 'running', createdAt: updatedAt, updatedAt }],
  remoteOperations: [{ id: 'remote-1', accountMid: '100', status: 'result-unknown', updatedAt }]
})

describe('local data migration v1', () => {
  it('creates a UID-keyed, credential-free archive with an integrity manifest', () => {
    const archive = createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z',
      accounts: { '100': account() }, sharedSettings: { theme: 'light' }
    })

    expect(archive.selectedUids).toEqual(['100'])
    expect(archive.manifest).toHaveLength(2)
    expect(parseMigrationArchiveV1(JSON.stringify(archive))).toEqual(archive)
  })

  it('round-trips checked and provisioned ledger settings without treating the binding as remote authority', () => {
    const source = account()
    source.settings.favoriteLedgers = [{
      id: 'custom-author-up-alpha',
      displayName: 'bilimi·UP Alpha',
      keywords: ['UP Alpha'],
      enabled: true,
      priority: 1,
      isDefault: false,
      ruleType: 'author',
      bilibiliFolderId: '91000001',
      syncState: 'bound'
    }]

    const archive = createMigrationArchiveV1({
      appVersion: '1.1.0',
      generatedAt: '2026-07-24T00:00:00.000Z',
      accounts: { '100': source }
    })

    expect(parseMigrationArchiveV1(JSON.stringify(archive)).accounts['100'].settings).toEqual(source.settings)
  })

  it('keeps formal repository recovery bindings portable during export', () => {
    const source = account()
    source.repository = createFavoriteRepositoryArchiveExport({
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }),
      folders: [
        { id: 'bilimi-logical:music', title: 'bilimi·音乐', kind: 'bilimi-logical' as const, logicalLedgerId: 'music', remoteFolderId: '900', syncState: 'bound' as const },
        { id: 'bilimi:music:001', title: 'bilimi·音乐', kind: 'bilibili' as const, logicalLedgerId: 'music', remoteFolderId: '900', syncState: 'bound' as const }
      ],
      physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId: '900', remoteTitle: 'bilimi·音乐', bindingState: 'bound' as const }]
    }, { generatedAt: '2026-07-24T00:00:00.000Z' })

    expect(() => createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': source }
    })).not.toThrow()
  })

  it('rejects conflicting remote identities for the same logical shard during migration merge', () => {
    const withBinding = (remoteFolderId: string) => createFavoriteRepositoryArchiveExport({
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }),
      folders: [
        { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical' as const, logicalLedgerId: 'music', syncState: 'bound' as const },
        { id: 'bilimi:music:001', title: '音乐', kind: 'bilibili' as const, logicalLedgerId: 'music', remoteFolderId, syncState: 'bound' as const }
      ],
      physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId, remoteTitle: '音乐', bindingState: 'bound' as const }]
    }, { generatedAt: '2026-07-24T00:00:00.000Z' })
    const local = account()
    const imported = account()
    local.repository = withBinding('remote-a')
    imported.repository = withBinding('remote-b')
    expect(() => mergeMigrationAccounts({ '100': local }, { '100': imported })).toThrow('binding conflict requires rebinding')
  })

  it('uses an explicit persistent-source registry and rejects unregistered sources for every UID', () => {
    expect(LOCAL_DATA_MIGRATION_ACCOUNT_SOURCES).toEqual([
      'repository', 'settings', 'archives', 'transcription', 'auditEvents', 'workspaces', 'remoteOperations'
    ])
    expect(LOCAL_DATA_MIGRATION_SHARED_SETTINGS).toEqual([
      'theme', 'language', 'windowBounds', 'closeBehavior', 'favoritesFolderName'
    ])
    expect(LOCAL_DATA_MIGRATION_EXCLUDED_SOURCES).toContain('cookies/login sessions')

    for (const uid of ['100', '200']) {
      expect(() => createMigrationArchiveV1({
        appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z',
        accounts: { [uid]: { ...account(), browserCache: { path: 'Cache' } } }
      })).toThrow('unregistered')
    }

    expect(() => createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': account() },
      sharedSettings: { theme: 'light', deepseekApiKey: 'must-never-export' }
    })).toThrow('unregistered')
  })

  it('accepts only typed portable shared presentation settings', () => {
    expect(() => createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': account() },
      sharedSettings: { theme: 'dark', language: 'en-US', windowBounds: { x: 1, y: 2, width: 1200, height: 800 }, closeBehavior: 'exit-launcher', favoritesFolderName: 'Library' }
    })).not.toThrow()
    expect(() => createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': account() }, sharedSettings: { theme: { unsafe: true } }
    })).toThrow('shared')
  })

  it('requires every registered account source with its v1 data shape', () => {
    const incomplete = account() as Record<string, unknown>
    delete incomplete.auditEvents
    expect(() => createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': incomplete }
    })).toThrow('source')

    const malformed = account() as Record<string, unknown>
    malformed.archives = {}
    expect(() => createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': malformed }
    })).toThrow('source')
  })

  it('applies the source registry before checksum validation during import', () => {
    const archive = createMigrationArchiveV1({ appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': account() } })
    const injected = structuredClone(archive)
    injected.accounts['100'].browserCache = { path: 'Cache' }

    expect(() => parseMigrationArchiveV1(JSON.stringify(injected))).toThrow('unregistered')
  })

  it('requires canonical archive metadata before producing an archive', () => {
    expect(() => createMigrationArchiveV1({
      appVersion: '1', generatedAt: '2026-07-24', accounts: { '100': account() }
    })).toThrow('metadata')
  })

  it('rejects non-ISO metadata and archive manifests whose aggregate claim is oversized', () => {
    const valid = createMigrationArchiveV1({ appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': account() } })
    const invalidTime = { ...valid, generatedAt: 'not-a-date' }
    const oversizedTotal = structuredClone(valid)
    oversizedTotal.manifest = Array.from({ length: 11 }, (_, index) => ({ path: `accounts/${index + 100}.json`, byteLength: 50 * 1024 * 1024, sha256: 'a'.repeat(64) }))

    expect(() => parseMigrationArchiveV1(JSON.stringify(invalidTime))).toThrow('incomplete')
    expect(() => parseMigrationArchiveV1(JSON.stringify(oversizedTotal))).toThrow('total')
  })

  it.each([
    ['malformed JSON', '{broken'],
    ['path traversal', JSON.stringify({ schemaVersion: 1, appVersion: '1', generatedAt: '2026-01-01T00:00:00.000Z', selectedUids: ['100'], accounts: { '100': {} }, manifest: [{ path: '../secret', sha256: 'a'.repeat(64), byteLength: 0 }], checksum: 'a'.repeat(64) })],
    ['invalid UID', JSON.stringify({ schemaVersion: 1, appVersion: '1', generatedAt: '2026-01-01T00:00:00.000Z', selectedUids: ['x'], accounts: { x: {} }, manifest: [], checksum: 'a'.repeat(64) })]
  ])('rejects %s', (_label, input) => {
    expect(() => parseMigrationArchiveV1(input)).toThrow()
  })

  it('rejects duplicate UID sections, secret injection, bad checksums, oversized claims, and newer schemas', () => {
    const valid = createMigrationArchiveV1({ appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': account() } })
    const duplicate = structuredClone(valid)
    duplicate.manifest.push(structuredClone(duplicate.manifest[0]))
    const secret = structuredClone(valid)
    secret.accounts['100'].apiKey = 'not portable'
    const oversized = structuredClone(valid)
    oversized.manifest[0].byteLength = 60 * 1024 * 1024
    const future = structuredClone(valid)
    future.schemaVersion = 2 as 1
    const badChecksum = { ...valid, checksum: '0'.repeat(64) }

    for (const candidate of [duplicate, secret, oversized, future, badChecksum]) {
      expect(() => parseMigrationArchiveV1(JSON.stringify(candidate))).toThrow()
    }
  })

  it('merges newer same-UID records, preserves newer local records, adds new UIDs, and keeps multipart archives distinct', () => {
    const local = { '100': account('2026-07-25T00:00:00.000Z') }
    const imported = {
      '100': {
        ...account('2026-07-24T00:00:00.000Z'),
        archives: [{ ...account('2026-07-24T00:00:00.000Z').archives[0], versions: [{
          ...account('2026-07-24T00:00:00.000Z').archives[0].versions[0], id: 'version-2', createdAt: '2026-07-26T00:00:00.000Z',
          note: { ...account('2026-07-24T00:00:00.000Z').archives[0].versions[0].note, id: 'account:100:aid:1:cid:12', updatedAt: '2026-07-26T00:00:00.000Z' }
        }], updatedAt: '2026-07-26T00:00:00.000Z' }]
      },
      '200': account()
    }
    const importedRepository = imported['100'].repository as Record<string, unknown>
    importedRepository.videos = [
      { aid: 1, title: 'old', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' },
      { aid: 2, title: 'new', tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }
    ]
    importedRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(importedRepository as never)
    const merged = mergeMigrationAccounts(local, imported)
    expect((merged['100'].repository as { videos: unknown[] }).videos).toEqual(expect.arrayContaining([
      expect.objectContaining({ aid: 1, title: 'video' }),
      expect.objectContaining({ aid: 2, title: 'new' })
    ]))
    expect((merged['100'].archives as Array<{ versions: unknown[] }>)[0]?.versions).toHaveLength(2)
    expect(merged['200']).toEqual(account())
  })

  it('recomputes a valid repository archive checksum after deterministic recovery and tombstone merging', () => {
    const local = account('2026-07-25T00:00:00.000Z')
    const imported = account('2026-07-24T00:00:00.000Z')
    const localRepository = local.repository as Record<string, unknown>
    const importedRepository = imported.repository as Record<string, unknown>
    const localRecovery = localRepository.recovery as Record<string, unknown>
    const importedRecovery = importedRepository.recovery as Record<string, unknown>
    for (const recovery of [localRecovery, importedRecovery]) {
      recovery.folders = [{ id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'pending-reconcile' }]
      recovery.memberships = { 'bilimi-logical:music': [] }
    }
    localRecovery.tombstones = [{ accountMid: '100', aid: 1, deletedAt: '2026-07-25T00:00:00.000Z', allowRediscovery: false }]
    importedRecovery.tombstones = [{ accountMid: '100', aid: 1, deletedAt: '2026-07-24T00:00:00.000Z', allowRediscovery: true }, { accountMid: '100', aid: 2, deletedAt: '2026-07-24T00:00:00.000Z', allowRediscovery: false }]
    localRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(localRepository as never)
    importedRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(importedRepository as never)
    const merged = mergeMigrationAccounts({ '100': local }, { '100': imported })
    const repository = merged['100'].repository as Record<string, unknown>

    expect(() => createMigrationArchiveV1({ appVersion: '1.1.0', generatedAt: '2026-07-26T00:00:00.000Z', accounts: merged })).not.toThrow()
    expect((repository.recovery as Record<string, unknown>).tombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ aid: 1, deletedAt: '2026-07-25T00:00:00.000Z' }),
      expect.objectContaining({ aid: 2 })
    ]))
  })

  it('keeps a newer local workspace and never resurrects memberships covered by tombstones', () => {
    const local = account('2026-07-25T00:00:00.000Z')
    const imported = account('2026-07-24T00:00:00.000Z')
    const localRepository = local.repository as Record<string, unknown>
    const importedRepository = imported.repository as Record<string, unknown>
    const localRecovery = localRepository.recovery as Record<string, unknown>
    const importedRecovery = importedRepository.recovery as Record<string, unknown>
    for (const recovery of [localRecovery, importedRecovery]) {
      recovery.folders = [{ id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'pending-reconcile' }]
      recovery.memberships = { 'bilimi-logical:music': [] }
    }
    localRecovery.workspace = {
      id: 'workspace-local', accountMid: '100', status: 'scanning', baselineRevision: 2, continuationAids: [],
      workspaceRef: { workspaceId: 'workspace-local', accountMid: '100', status: 'scanning', baselineRevision: 2, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt: '2026-07-25T00:00:00.000Z' }
    }
    importedRecovery.workspace = {
      id: 'workspace-imported', accountMid: '100', status: 'scanning', baselineRevision: 1, continuationAids: [],
      workspaceRef: { workspaceId: 'workspace-imported', accountMid: '100', status: 'scanning', baselineRevision: 1, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'b'.repeat(64), updatedAt: '2026-07-24T00:00:00.000Z' }
    }
    importedRecovery.memberships = { 'bilimi-logical:music': [1] }
    importedRecovery.tombstones = [{ accountMid: '100', aid: 1, deletedAt: '2026-07-26T00:00:00.000Z', allowRediscovery: false }]
    localRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(localRepository as never)
    importedRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(importedRepository as never)

    const merged = mergeMigrationAccounts({ '100': local }, { '100': imported })
    const recovery = (merged['100'].repository as { recovery: Record<string, unknown> }).recovery
    expect((recovery.workspace as { id: string }).id).toBe('workspace-local')
    expect(recovery.memberships).toEqual({ 'bilimi-logical:music': [] })
  })

  it('uses workspace revision after an equal durable timestamp and removes only hard-tombstoned rows', () => {
    const local = account('2026-07-24T00:00:00.000Z')
    const imported = account('2026-07-24T00:00:00.000Z')
    const localRepository = local.repository as Record<string, unknown>
    const importedRepository = imported.repository as Record<string, unknown>
    const localRecovery = localRepository.recovery as Record<string, unknown>
    const importedRecovery = importedRepository.recovery as Record<string, unknown>
    const at = '2026-07-24T01:00:00.000Z'
    localRecovery.workspace = {
      id: 'older-workspace', accountMid: '100', status: 'scanning', baselineRevision: 1, continuationAids: [],
      workspaceRef: { workspaceId: 'older-workspace', accountMid: '100', status: 'scanning', baselineRevision: 1, currentSegmentId: 'segment', overlayRevision: 1, journalCursor: 1, checksum: 'a'.repeat(64), updatedAt: at }
    }
    importedRecovery.workspace = {
      id: 'newer-workspace', accountMid: '100', status: 'scanning', baselineRevision: 2, continuationAids: [],
      workspaceRef: { workspaceId: 'newer-workspace', accountMid: '100', status: 'scanning', baselineRevision: 2, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'b'.repeat(64), updatedAt: at }
    }
    importedRepository.videos = [{ aid: 2, title: 'hard deleted', tags: [], updatedAt: at }, { aid: 3, title: 'rediscoverable', tags: [], updatedAt: at }]
    importedRepository.positions = [
      { aid: 2, localDesiredFolderIds: [], positionState: 'local-only-change', updatedAt: at },
      { aid: 3, localDesiredFolderIds: [], positionState: 'local-only-change', updatedAt: at }
    ]
    importedRecovery.tombstones = [
      { accountMid: '100', aid: 2, deletedAt: at, allowRediscovery: false },
      { accountMid: '100', aid: 3, deletedAt: at, allowRediscovery: true }
    ]
    localRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(localRepository as never)
    importedRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(importedRepository as never)

    const repository = mergeMigrationAccounts({ '100': local }, { '100': imported })['100'].repository as Record<string, unknown>
    expect((repository.recovery as { workspace: { id: string } }).workspace.id).toBe('newer-workspace')
    expect(repository.videos).toEqual(expect.arrayContaining([expect.objectContaining({ aid: 3 })]))
    expect(repository.videos).not.toEqual(expect.arrayContaining([expect.objectContaining({ aid: 2 })]))
    expect(repository.positions).toEqual(expect.arrayContaining([expect.objectContaining({ aid: 3 })]))
    expect(repository.positions).not.toEqual(expect.arrayContaining([expect.objectContaining({ aid: 2 })]))
  })

  it('exports canonical logical organization history without allowing remote bindings elsewhere', () => {
    const source = account()
    const recovery = (source.repository as { recovery: Record<string, unknown> }).recovery
    recovery.organizationBatches = [{
      id: 'change-1', runId: 'run-1', workspaceId: 'work-1', accountMid: '100', aid: 1,
      beforeFolderIds: ['bilimi-logical:music'], afterFolderIds: ['bilimi-logical:watch-later'],
      addedFolderIds: ['bilimi-logical:watch-later'], removedFolderIds: ['bilimi-logical:music'],
      status: 'succeeded', recordedAt: '2026-07-24T00:00:00.000Z'
    }]
    const repository = source.repository as Record<string, unknown>
    repository.checksum = createFavoriteRepositoryArchiveExportChecksum(repository as never)

    expect(() => createMigrationArchiveV1({ appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': source } })).not.toThrow()
  })

  it('prefers complete lifecycle authority when equal-timestamp position records are merged', () => {
    const at = '2026-07-24T00:00:00.000Z'
    const local = account(at)
    const imported = account(at)
    const localRepository = local.repository as Record<string, unknown>
    const importedRepository = imported.repository as Record<string, unknown>
    localRepository.positions = [{ aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], positionState: 'aligned', updatedAt: at }]
    importedRepository.positions = [{
      aid: 1,
      localDesiredFolderIds: ['bilimi-logical:music'],
      positionState: 'aligned',
      observedAt: at,
      lifecycleState: 'active',
      sourceAuthority: 'complete',
      observationEpoch: 'scan-epoch-1',
      updatedAt: at
    }]
    localRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(localRepository as never)
    importedRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(importedRepository as never)

    const repository = mergeMigrationAccounts({ '100': local }, { '100': imported })['100'].repository as Record<string, unknown>
    expect(repository.positions).toEqual([expect.objectContaining({
      aid: 1,
      lifecycleState: 'active',
      sourceAuthority: 'complete',
      observationEpoch: 'scan-epoch-1'
    })])

    const leaky = account(at)
    const leakyRepository = leaky.repository as Record<string, unknown>
    leakyRepository.positions = [{
      aid: 1,
      localDesiredFolderIds: [],
      remoteObservedPhysicalFolderIds: ['physical-900'],
      positionState: 'aligned',
      updatedAt: at
    }]
    leakyRepository.checksum = createFavoriteRepositoryArchiveExportChecksum(leakyRepository as never)
    expect(() => mergeMigrationAccounts({ '100': local }, { '100': leaky })).toThrow('archive')
  })

  it('rejects recovery folders and shards that do not form one canonical logical ledger', () => {
    const malformed = account()
    const repository = malformed.repository as Record<string, unknown>
    const recovery = repository.recovery as Record<string, unknown>
    recovery.folders = [
      { id: 'bilibili-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'wrong', syncState: 'pending-reconcile' },
      { id: 'bilimi:music:001', title: 'shard', kind: 'local', syncState: 'local-only' }
    ]
    recovery.memberships = { 'bilibili-logical:music': [], 'bilimi:music:001': [] }
    recovery.physicalShards = [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteTitle: 'Music', bindingState: 'pending-reconcile' }]
    repository.checksum = createFavoriteRepositoryArchiveExportChecksum(repository as never)

    expect(() => createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': malformed }
    })).toThrow('repository')
  })

  it('preserves distinct archive version IDs for one note identity', () => {
    const local = account('2026-07-24T00:00:00.000Z')
    const imported = account('2026-07-24T00:00:00.000Z')
    const version = imported.archives[0].versions[0]
    imported.archives[0].versions = [{
      ...version, id: 'version-2', createdAt: '2026-07-25T00:00:00.000Z',
      note: { ...version.note, updatedAt: '2026-07-25T00:00:00.000Z' }
    }]

    const merged = mergeMigrationAccounts({ '100': local }, { '100': imported })
    expect((merged['100'].archives as Array<{ versions: Array<{ id: string }> }>)[0].versions.map((entry) => entry.id).sort())
      .toEqual(['version-1', 'version-2'])
  })

  it('restores all active organization states as valid resumable drafts without retrying unknown remote operations', () => {
    const source = account() as Record<string, unknown>
    const updatedAt = '2026-07-24T00:00:00.000Z'
    source.workspaces = ['running', 'scanning', 'previewing', 'frozen', 'executing', 'reconciling'].map((status, index) => ({
      id: `work-${index}`, accountMid: '100', status, updatedAt
    }))
    const repository = source.repository as Record<string, unknown>
    const recovery = repository.recovery as Record<string, unknown>
    recovery.workspace = {
      id: 'work-4', accountMid: '100', status: 'executing', baselineRevision: 2, continuationAids: [1],
      workspaceRef: { workspaceId: 'work-4', accountMid: '100', status: 'executing', baselineRevision: 2, currentSegmentId: 'segment', overlayRevision: 3, journalCursor: 4, checksum: 'a'.repeat(64), currentStep: 'executing', updatedAt },
      frozenSyncPlan: { id: 'plan-1', accountMid: '100', workspaceId: 'work-4', baselineRevision: 2, createdAt: updatedAt, operations: [{ operationKey: 'append-1', aid: 1, kind: 'append', folderIds: ['bilimi-logical:music'] }] }
    }
    recovery.syncRecords = [{ id: 'remote-1', commandId: 'command-1', status: 'result-unknown', affectedAids: [1], updatedAt }]
    repository.checksum = createFavoriteRepositoryArchiveExportChecksum(repository as never)

    const restored = restorePortableAccountState(source)

    expect(restored.workspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'draft', resumable: true })
    ]))
    expect((restored.workspaces as unknown[])).toHaveLength(6)
    expect((restored.workspaces as Array<Record<string, unknown>>).every((workspace) => workspace.status === 'draft' && workspace.resumable === true)).toBe(true)
    expect((restored.transcription as unknown[])[0]).toMatchObject({ status: 'waiting-restart', transcriptionModelId: 'whisper-small' })
    expect((restored.remoteOperations as unknown[])[0]).toMatchObject({ status: 'reconciliation-required', autoRetry: false })
    const restoredRepository = validateFavoriteRepositoryArchiveExport(restored.repository)
    expect(restoredRepository.recovery).toMatchObject({
      workspace: { status: 'draft', resumable: true, continuationAids: [], workspaceRef: { status: 'draft', currentStep: 'executing' } },
      syncRecords: [{ status: 'reconciliation-required', autoRetry: false }]
    })
    expect(restoredRepository.recovery?.workspace).not.toHaveProperty('frozenSyncPlan')
  })

  it('rejects unknown recovery states and malformed multipart archives before archive creation', () => {
    const unknownWorkspace = account() as Record<string, unknown>
    unknownWorkspace.workspaces = [{ id: 'work-1', accountMid: '100', status: 'mystery', updatedAt: '2026-07-24T00:00:00.000Z' }]
    const unknownTranscription = account() as Record<string, unknown>
    unknownTranscription.transcription = [{ id: 'transcription-1', accountMid: '100', aid: 1, cid: 11, status: 'mystery', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' }]
    const malformedArchive = account() as Record<string, unknown>
    malformedArchive.archives = [{ id: 'archive-1', source: { accountMid: '100', title: 'missing part', url: 'https://example.test', tags: [] }, versions: [], createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' }]

    for (const candidate of [unknownWorkspace, unknownTranscription, malformedArchive]) {
      expect(() => createMigrationArchiveV1({ appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': candidate } })).toThrow('invalid')
    }
  })

  it('rejects archive timings that are not finite numbers before creating a portable archive', () => {
    const malformed = account()
    ;(malformed.archives as any[])[0].versions[0].note.transcript = [{ start: Number.POSITIVE_INFINITY, end: 12, text: 'invalid timing' }]

    expect(() => createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': malformed }
    })).toThrow('archives')
  })

  it('rejects portable source records that try to carry physical remote identifiers', () => {
    const auditLeak = account() as Record<string, unknown>
    auditLeak.auditEvents = [{ id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-24T00:00:00.000Z', remoteFolderId: 'physical-900' }]
    const operationLeak = account() as Record<string, unknown>
    operationLeak.remoteOperations = [{ id: 'sync-1', commandId: 'command-1', accountMid: '100', status: 'result-unknown', affectedAids: [1], targetFolderIds: ['physical-900'], updatedAt: '2026-07-24T00:00:00.000Z' }]

    for (const candidate of [auditLeak, operationLeak]) {
      expect(() => createMigrationArchiveV1({ appVersion: '1.1.0', generatedAt: '2026-07-24T00:00:00.000Z', accounts: { '100': candidate } })).toThrow('device-bound')
    }
  })
})

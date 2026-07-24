import { describe, expect, it } from 'vitest'
import {
  createMigrationArchiveV1,
  mergeMigrationAccounts,
  parseMigrationArchiveV1,
  restorePortableAccountState
} from './localDataMigration'
import { createAccountFavoriteRepositorySnapshot, createFavoriteRepositoryArchiveExport, createFavoriteRepositoryArchiveExportChecksum } from './favoriteRepository'
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
  settings: { pageSize: 50, updatedAt },
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
        archives: [{ aid: 1, cid: 11, version: 2, updatedAt: '2026-07-26T00:00:00.000Z' }]
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
    expect(merged['100'].archives as unknown[]).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'archive-1' }), expect.objectContaining({ version: 2 })]))
    expect(merged['200']).toEqual(account())
  })

  it('recomputes a valid repository archive checksum after deterministic recovery and tombstone merging', () => {
    const local = account('2026-07-25T00:00:00.000Z')
    const imported = account('2026-07-24T00:00:00.000Z')
    const localRepository = local.repository as Record<string, unknown>
    const importedRepository = imported.repository as Record<string, unknown>
    const localRecovery = localRepository.recovery as Record<string, unknown>
    const importedRecovery = importedRepository.recovery as Record<string, unknown>
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

  it('restores interrupted work without retrying unknown remote operations', () => {
    const restored = restorePortableAccountState(account())
    expect((restored.workspaces as unknown[])[0]).toMatchObject({ status: 'draft', resumable: true })
    expect((restored.transcription as unknown[])[0]).toMatchObject({ status: 'waiting-restart' })
    expect((restored.remoteOperations as unknown[])[0]).toMatchObject({ status: 'reconciliation-required', autoRetry: false })
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
})

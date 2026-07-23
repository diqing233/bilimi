import { describe, expect, it } from 'vitest'
import {
  createMigrationArchiveV1,
  mergeMigrationAccounts,
  parseMigrationArchiveV1,
  restorePortableAccountState
} from './localDataMigration'

const account = (updatedAt = '2026-07-24T00:00:00.000Z') => ({
  repository: { videos: [{ aid: 1, cid: 11, title: 'video', updatedAt }] },
  archives: [{ aid: 1, cid: 11, version: 1, updatedAt }],
  settings: { pageSize: 50, updatedAt },
  workspaces: [{ id: 'work-1', status: 'running', updatedAt }],
  transcription: [{ aid: 1, cid: 11, status: 'running', updatedAt }],
  remoteOperations: [{ id: 'remote-1', status: 'result-unknown', updatedAt }]
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
        repository: { videos: [{ aid: 1, cid: 11, title: 'old', updatedAt: '2026-07-24T00:00:00.000Z' }, { aid: 2, cid: 22, deletedAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z' }] },
        archives: [{ aid: 1, cid: 11, version: 2, updatedAt: '2026-07-26T00:00:00.000Z' }]
      },
      '200': account()
    }
    const merged = mergeMigrationAccounts(local, imported)
    expect((merged['100'].repository as { videos: unknown[] }).videos).toEqual(expect.arrayContaining([
      expect.objectContaining({ aid: 1, title: 'video' }),
      expect.objectContaining({ aid: 2, deletedAt: '2026-07-26T00:00:00.000Z' })
    ]))
    expect(merged['100'].archives as unknown[]).toEqual(expect.arrayContaining([expect.objectContaining({ version: 1 }), expect.objectContaining({ version: 2 })]))
    expect(merged['200']).toEqual(account())
  })

  it('restores interrupted work without retrying unknown remote operations', () => {
    const restored = restorePortableAccountState(account())
    expect((restored.workspaces as unknown[])[0]).toMatchObject({ status: 'draft', resumable: true })
    expect((restored.transcription as unknown[])[0]).toMatchObject({ status: 'waiting-restart' })
    expect((restored.remoteOperations as unknown[])[0]).toMatchObject({ status: 'reconciliation-required', autoRetry: false })
  })
})

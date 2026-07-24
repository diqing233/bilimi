import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalDataService, type LocalDataPersistence } from './localDataService'
import { createAccountFavoriteRepositorySnapshot, createFavoriteRepositoryArchiveExport } from '../../src/shared/favoriteRepository'
import { createMigrationArchiveV1 } from '../../src/shared/localDataMigration'

const roots: string[] = []
const portableAccount = (id: string, updatedAt = '2026-07-24T00:00:00.000Z', accountMid = '100') => ({
  repository: createFavoriteRepositoryArchiveExport({
    ...createAccountFavoriteRepositorySnapshot({ accountMid, now: updatedAt }),
    videos: { '1': { aid: 1, title: id, tags: [], updatedAt } }
  }, { generatedAt: updatedAt }),
  settings: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [], updatedAt }, archives: [], transcription: [], auditEvents: [], workspaces: [], remoteOperations: []
})
const makeService = async () => {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-local-data-test-'))
  roots.push(root)
  const accounts: Record<string, Record<string, unknown>> = { '100': portableAccount('a'), '200': portableAccount('b') }
  let sharedSettings: Record<string, unknown> = { theme: 'light', deepseekApiKey: 'must-never-export', cookies: 'session', encryptionKey: 'machine-only', proxyState: 'runtime-only' }
  const persistence: LocalDataPersistence = {
    listAccountUids: () => Object.keys(accounts), readAccount: (uid) => structuredClone(accounts[uid] ?? {}),
    writeAccounts: (next) => { for (const uid of Object.keys(accounts)) delete accounts[uid]; Object.assign(accounts, structuredClone(next)) },
    readSharedSettings: () => structuredClone(sharedSettings), writeSharedSettings: vi.fn(),
    writePortableState: (next) => {
      for (const uid of Object.keys(accounts)) delete accounts[uid]
      Object.assign(accounts, structuredClone(next.accounts))
      sharedSettings = structuredClone(next.sharedSettings)
    }
  }
  return { root, accounts, persistence, service: new LocalDataService({ root, appVersion: '1.1.0', persistence }) }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })))) })

describe('LocalDataService', () => {
  it('accepts an import only through a fresh, unchanged, one-shot preview token', async () => {
    const { root, service } = await makeService()
    const archive = join(root, 'portable.json')
    await service.exportArchive({ uids: ['100'], outputPath: archive })

    const preview = await service.previewImport(archive)
    await expect(service.applyImport({ ...preview, token: 'forged' }, { mode: 'merge' })).rejects.toThrow('preview')

    await writeFile(archive, '{}')
    await expect(service.applyImport(preview, { mode: 'merge' })).rejects.toThrow('changed')

    await service.exportArchive({ uids: ['100'], outputPath: archive })
    const fresh = await service.previewImport(archive)
    await service.applyImport(fresh, { mode: 'merge' })
    await expect(service.applyImport(fresh, { mode: 'merge' })).rejects.toThrow('preview')
  })

  it('requires the persistence transaction to preserve both accounts and shared settings on failure', async () => {
    const { root, accounts, persistence, service } = await makeService()
    const archive = join(root, 'portable.json')
    await service.exportArchive({ uids: ['100'], includeSharedSettings: true, outputPath: archive })
    const preview = await service.previewImport(archive)
    const beforeAccounts = structuredClone(accounts)
    const beforeShared = await persistence.readSharedSettings()
    persistence.writePortableState = vi.fn().mockRejectedValue(new Error('transaction failed'))

    await expect(service.applyImport(preview, { mode: 'overwrite' })).rejects.toThrow('transaction failed')
    expect(accounts).toEqual(beforeAccounts)
    expect(await persistence.readSharedSettings()).toEqual(beforeShared)
  })

  it('compensates a partially applied import with the complete account and shared-settings snapshot', async () => {
    const { root, accounts, persistence, service } = await makeService()
    const archive = join(root, 'portable.json')
    await service.exportArchive({ uids: ['100'], includeSharedSettings: true, outputPath: archive })
    const preview = await service.previewImport(archive)
    const beforeAccounts = structuredClone(accounts)
    const beforeShared = await persistence.readSharedSettings()
    let calls = 0
    persistence.writePortableState = vi.fn((next) => {
      calls++
      for (const uid of Object.keys(accounts)) delete accounts[uid]
      Object.assign(accounts, structuredClone(next.accounts))
      if (calls === 1) throw new Error('repository publish failed after store mutation')
    })

    await expect(service.applyImport(preview, { mode: 'overwrite' })).rejects.toThrow('repository publish failed')
    expect(calls).toBe(2)
    expect(accounts).toEqual(beforeAccounts)
    expect(await persistence.readSharedSettings()).toEqual(beforeShared)
    expect(vi.mocked(persistence.writePortableState).mock.calls[1]?.[0].sharedSettings).toEqual(beforeShared)
  })

  it('removes a newly selected account and restores all durable projections after a partial import fails', async () => {
    const { root, accounts, persistence, service } = await makeService()
    const archive = join(root, 'new-account-portable.json')
    await writeFile(archive, JSON.stringify(createMigrationArchiveV1({
      appVersion: '1.1.0', generatedAt: '2026-07-24T01:00:00.000Z', accounts: { '300': portableAccount('new', '2026-07-24T01:00:00.000Z', '300') }
    })))
    const preview = await service.previewImport(archive)
    const beforeAccounts = structuredClone(accounts)
    const repositories = Object.fromEntries(Object.entries(accounts).map(([uid, value]) => [uid, structuredClone(value.repository)]))
    const accountStore = Object.fromEntries(Object.entries(accounts).map(([uid, value]) => [uid, structuredClone(value.settings)]))
    let calls = 0
    persistence.writePortableState = vi.fn((next, options) => {
      calls++
      for (const uid of options.selectedUids) {
        const replacement = next.accounts[uid]
        if (replacement) {
          accounts[uid] = structuredClone(replacement)
          repositories[uid] = structuredClone(replacement.repository)
          accountStore[uid] = structuredClone(replacement.settings)
        } else {
          delete accounts[uid]
          delete repositories[uid]
          delete accountStore[uid]
        }
      }
      if (calls === 1) throw new Error('repository publish failed after new-account projections')
    })

    await expect(service.applyImport(preview, { mode: 'overwrite' })).rejects.toThrow('repository publish failed')
    expect(calls).toBe(2)
    expect(accounts).toEqual(beforeAccounts)
    expect(repositories).toEqual(Object.fromEntries(Object.entries(beforeAccounts).map(([uid, value]) => [uid, value.repository])))
    expect(accountStore).toEqual(Object.fromEntries(Object.entries(beforeAccounts).map(([uid, value]) => [uid, value.settings])))
    expect(vi.mocked(persistence.writePortableState).mock.calls[1]?.[1]).toEqual({ mode: 'overwrite', selectedUids: ['100', '200', '300'] })
  })

  it('passes the selected UIDs and overwrite mode to the durable persistence boundary', async () => {
    const { root, persistence, service } = await makeService()
    const archive = join(root, 'portable.json')
    await service.exportArchive({ uids: ['100'], outputPath: archive })
    const preview = await service.previewImport(archive)
    const publish = vi.spyOn(persistence, 'writePortableState')

    await service.applyImport(preview, { mode: 'overwrite' })

    expect(publish).toHaveBeenCalledWith(expect.any(Object), { mode: 'overwrite', selectedUids: ['100'] })
  })

  it('stages an explicit false account setting for overwrite instead of retaining true', async () => {
    const { root, accounts, service } = await makeService()
    const archive = join(root, 'portable.json')
    ;(accounts['100'].settings as Record<string, unknown>).defaultFavoriteSystemEnabled = false
    await service.exportArchive({ uids: ['100'], outputPath: archive })
    ;(accounts['100'].settings as Record<string, unknown>).defaultFavoriteSystemEnabled = true

    const preview = await service.previewImport(archive)
    await service.applyImport(preview, { mode: 'overwrite' })

    expect((accounts['100'].settings as Record<string, unknown>).defaultFavoriteSystemEnabled).toBe(false)
  })

  it('validates account UIDs at the service boundary before export or account cleanup', async () => {
    const { root, service } = await makeService()
    await expect(service.exportArchive({ uids: ['../../200'], outputPath: join(root, 'portable.json') })).rejects.toThrow('account')
    await expect(service.previewCleanup({ level: 'current-account-data', uid: '../../200' })).rejects.toThrow('account')
  })

  it('documents inventory inclusions and exclusions and scans usage without following symlinks', async () => {
    const { root, service } = await makeService()
    // Included: account repository/workspace data, shared preferences. Excluded: cookies/sessions,
    // DeepSeek keys, encryption keys, proxy/runtime state, caches, logs, temporary audio and locks.
    await writeFile(join(root, 'favorites.json'), 'persistent')
    await writeFile(join(root, 'repository.json'), 'persistent')
    await writeFile(join(root, 'Cookies'), 'session')
    await writeFile(join(root, 'app.log'), 'log')
    const usage = await service.calculateUsage()
    expect(usage.categories.accountPersistent.bytes).toBeGreaterThan(0)
    expect(usage.categories.logs.bytes).toBeGreaterThan(0)
    expect(usage.categories).toHaveProperty('temporaryAudio')
  })

  it('exports atomically, rejects secret data, previews imports before mutation, and rolls back injected failures', async () => {
    const { root, accounts, service } = await makeService()
    const archive = join(root, 'portable.json')
    await service.exportArchive({ uids: ['100'], includeSharedSettings: true, outputPath: archive })
    const content = await readFile(archive, 'utf8')
    expect(content).not.toContain('deepseekApiKey')
    expect(content).not.toContain('cookies')
    expect(content).not.toContain('encryptionKey')
    expect(content).not.toContain('proxyState')
    const preview = await service.previewImport(archive)
    expect(preview.accounts).toEqual([{ uid: '100', action: 'merge' }])
    await expect(service.applyImport(preview, { mode: 'merge', injectFailureAfterStage: true })).rejects.toThrow('injected')
    expect((accounts['100'].repository as { videos: unknown[] }).videos).toHaveLength(1)
  })

  it('rejects an archive produced by a newer unsupported app version before any preview mutation', async () => {
    const { root, service } = await makeService()
    const archive = join(root, 'future-portable.json')
    const exported = await service.exportArchive({ uids: ['100'], outputPath: archive })
    await writeFile(archive, JSON.stringify({ ...exported, appVersion: '9.0.0' }))
    const future = { ...exported, appVersion: '9.0.0' }
    const { checksum: _checksum, ...withoutChecksum } = future
    const { createHash } = await import('node:crypto')
    const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value)
    await writeFile(archive, JSON.stringify({ ...withoutChecksum, checksum: createHash('sha256').update(stable(withoutChecksum)).digest('hex') }))
    await expect(service.previewImport(archive)).rejects.toThrow('newer')
  })

  it('keeps cleanup UID-scoped and coordinates shutdown plus login removal for a full clear', async () => {
    const { root, accounts, service } = await makeService()
    const stopActiveWork = vi.fn()
    const clearLoginSessions = vi.fn()
    const exitApp = vi.fn()
    service.setDestructiveHooks({ stopActiveWork, clearLoginSessions, exitApp })
    await writeFile(join(root, 'local-repository.json'), 'local-only')
    await service.applyCleanup({ level: 'current-account-data', uid: '100' })
    expect(accounts['100']).toBeUndefined()
    expect(accounts['200']).toBeDefined()
    await service.applyCleanup({ level: 'all-user-data', confirmation: '全部清除' })
    expect(stopActiveWork).toHaveBeenCalledOnce()
    expect(clearLoginSessions).toHaveBeenCalledOnce()
    expect(exitApp).toHaveBeenCalledOnce()
    await expect(access(join(root, 'local-repository.json'))).rejects.toThrow()
  })

  it('waits for active work to settle before removing durable state during a full clear', async () => {
    const { accounts, persistence, service } = await makeService()
    let allowShutdownToFinish: (() => void) | undefined
    const stopActiveWork = vi.fn(() => new Promise<void>((resolve) => { allowShutdownToFinish = resolve }))
    const writeAccounts = vi.spyOn(persistence, 'writeAccounts')
    service.setDestructiveHooks({ stopActiveWork })

    const cleanup = service.applyCleanup({ level: 'all-user-data', confirmation: '全部清除' })
    await Promise.resolve()

    expect(stopActiveWork).toHaveBeenCalledOnce()
    expect(writeAccounts).not.toHaveBeenCalled()
    expect(accounts['100']).toBeDefined()

    allowShutdownToFinish?.()
    await cleanup
    expect(accounts).toEqual({})
  })

  it('removes only the selected UID when account records have overlapping shapes', async () => {
    const { accounts, persistence, service } = await makeService()
    accounts['100'] = { repository: { videos: [{ aid: 7, cid: 70 }] } }
    accounts['200'] = { repository: { videos: [{ aid: 7, cid: 70 }] } }
    const writePortableState = vi.spyOn(persistence, 'writePortableState')

    await service.applyCleanup({ level: 'current-account-data', uid: '100' })

    expect(accounts).toEqual({ '200': { repository: { videos: [{ aid: 7, cid: 70 }] } } })
    expect(writePortableState).toHaveBeenCalledWith(
      expect.objectContaining({ accounts: { '200': { repository: { videos: [{ aid: 7, cid: 70 }] } } } }),
      { mode: 'overwrite', selectedUids: ['100'] }
    )
  })

  it('removes retained signed-out account data through the portable persistence transaction', async () => {
    const { accounts, persistence, service } = await makeService()
    let retained = ['100', '200', '300']
    persistence.listAccountUids = () => retained
    const writePortableState = vi.fn(async (_state, options) => {
      for (const uid of options.selectedUids) delete accounts[uid]
      retained = retained.filter((uid) => !options.selectedUids.includes(uid))
    })
    persistence.writePortableState = writePortableState

    await service.applyCleanup({ level: 'current-account-data', uid: '300' })

    expect(writePortableState).toHaveBeenCalledWith(expect.objectContaining({ accounts: expect.not.objectContaining({ '300': expect.anything() }) }), { mode: 'overwrite', selectedUids: ['300'] })
    expect(retained).toEqual(['100', '200'])
  })

  it('previews destructive cleanup, permits usage cancellation, and never presents server data as a target', async () => {
    const { service } = await makeService()
    await expect(service.previewCleanup({ level: 'all-user-data' })).rejects.toThrow('confirmation')
    await expect(service.previewCleanup({ level: 'current-account-data' })).rejects.toThrow('UID')
    await expect(service.previewCleanup({ level: 'all-user-data', confirmation: '全部清除' })).resolves.toMatchObject({ requiresExit: true, affectsBilibiliServerData: false })
    service.cancelUsageCalculation()
  })
})

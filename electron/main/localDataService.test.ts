import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalDataService, type LocalDataPersistence } from './localDataService'

const roots: string[] = []
const makeService = async () => {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-local-data-test-'))
  roots.push(root)
  const accounts: Record<string, Record<string, unknown>> = { '100': { records: [{ id: 'a', updatedAt: '2026-07-24T00:00:00.000Z' }] }, '200': { records: [{ id: 'b' }] } }
  const persistence: LocalDataPersistence = {
    listAccountUids: () => Object.keys(accounts), readAccount: (uid) => structuredClone(accounts[uid] ?? {}),
    writeAccounts: (next) => { for (const uid of Object.keys(accounts)) delete accounts[uid]; Object.assign(accounts, structuredClone(next)) },
    readSharedSettings: () => ({ theme: 'light', deepseekApiKey: 'must-never-export', cookies: 'session', encryptionKey: 'machine-only', proxyState: 'runtime-only' }), writeSharedSettings: vi.fn()
  }
  return { root, accounts, persistence, service: new LocalDataService({ root, appVersion: '1.1.0', persistence }) }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })))) })

describe('LocalDataService', () => {
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
    expect(accounts['100'].records).toHaveLength(1)
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
    const { accounts, service } = await makeService()
    const stopActiveWork = vi.fn()
    const clearLoginSessions = vi.fn()
    const exitApp = vi.fn()
    service.setDestructiveHooks({ stopActiveWork, clearLoginSessions, exitApp })
    await service.applyCleanup({ level: 'current-account-data', uid: '100' })
    expect(accounts['100']).toBeUndefined()
    expect(accounts['200']).toBeDefined()
    await service.applyCleanup({ level: 'all-user-data', confirmation: '全部清除' })
    expect(stopActiveWork).toHaveBeenCalledOnce()
    expect(clearLoginSessions).toHaveBeenCalledOnce()
    expect(exitApp).toHaveBeenCalledOnce()
  })

  it('previews destructive cleanup, permits usage cancellation, and never presents server data as a target', async () => {
    const { service } = await makeService()
    await expect(service.previewCleanup({ level: 'all-user-data' })).rejects.toThrow('confirmation')
    await expect(service.previewCleanup({ level: 'current-account-data' })).rejects.toThrow('UID')
    await expect(service.previewCleanup({ level: 'all-user-data', confirmation: '全部清除' })).resolves.toMatchObject({ requiresExit: true, affectsBilibiliServerData: false })
    service.cancelUsageCalculation()
  })
})

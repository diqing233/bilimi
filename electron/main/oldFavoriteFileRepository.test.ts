import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AtomicJsonFileRepository, migrateLegacyJsonFile } from './oldFavoriteFileRepository'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function repositoryPath() {
  const directory = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-'))
  directories.push(directory)
  return join(directory, 'old-favorite', 'v1', 'sessions.json')
}

describe('AtomicJsonFileRepository', () => {
  const isCount = (value: unknown): value is { count: number } =>
    Boolean(value && typeof value === 'object' && typeof (value as { count?: unknown }).count === 'number')

  it('serializes replacements and reopens the last complete value', async () => {
    const path = await repositoryPath()
    const repository = await AtomicJsonFileRepository.open(path, { count: 0 }, isCount)

    const first = repository.replace({ count: 1 })
    const second = repository.replace({ count: 2 })
    await Promise.all([first, second])

    const reopened = await AtomicJsonFileRepository.open(path, { count: 0 }, isCount)
    expect(reopened.read()).toEqual({ count: 2 })
  })

  it('recovers the backup when the primary file is corrupt', async () => {
    const path = await repositoryPath()
    const repository = await AtomicJsonFileRepository.open(path, { count: 0 }, isCount)
    await repository.replace({ count: 1 })
    await repository.replace({ count: 2 })
    await writeFile(path, '{broken', 'utf8')

    const reopened = await AtomicJsonFileRepository.open(path, { count: 0 }, isCount)
    expect(reopened.read()).toEqual({ count: 1 })
  })
})

describe('migrateLegacyJsonFile', () => {
  const isCount = (value: unknown): value is { count: number } =>
    Boolean(value && typeof value === 'object' && typeof (value as { count?: unknown }).count === 'number')

  it('prefers an existing file and leaves legacy config untouched', async () => {
    const path = await repositoryPath()
    const existing = await AtomicJsonFileRepository.open(path, { count: 0 }, isCount)
    await existing.replace({ count: 7 })
    let cleared = false

    const migrated = await migrateLegacyJsonFile({
      path,
      fallback: { count: 0 },
      validate: isCount,
      readLegacy: () => ({ count: 9 }),
      clearLegacy: () => { cleared = true }
    })

    expect(migrated.read()).toEqual({ count: 7 })
    expect(cleared).toBe(false)
  })

  it('clears valid legacy config only after the migrated file can be reopened', async () => {
    const path = await repositoryPath()
    let cleared = false
    const migrated = await migrateLegacyJsonFile({
      path,
      fallback: { count: 0 },
      validate: (value): value is { count: number } =>
        Boolean(value && typeof value === 'object' && typeof (value as { count?: unknown }).count === 'number'),
      readLegacy: () => ({ count: 9 }),
      clearLegacy: () => { cleared = true }
    })

    expect(migrated.read()).toEqual({ count: 9 })
    expect(cleared).toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ schemaVersion: 1, data: { count: 9 } })
  })

  it('recovers valid legacy data when the existing primary and backup are corrupt', async () => {
    const path = await repositoryPath()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, '{broken', 'utf8')
    await writeFile(`${path}.bak`, '{also-broken', 'utf8')
    let cleared = false

    const migrated = await migrateLegacyJsonFile({
      path,
      fallback: { count: 0 },
      validate: (value): value is { count: number } =>
        Boolean(value && typeof value === 'object' && typeof (value as { count?: unknown }).count === 'number'),
      readLegacy: () => ({ count: 11 }),
      clearLegacy: () => { cleared = true }
    })

    expect(migrated.read()).toEqual({ count: 11 })
    expect(cleared).toBe(true)
  })
})

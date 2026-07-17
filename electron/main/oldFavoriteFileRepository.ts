import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

type Envelope<T> = { schemaVersion: 1; data: T }

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readEnvelope<T>(path: string, validate: (value: unknown) => value is T): Promise<T | null> {
  try {
    const envelope = JSON.parse(await readFile(path, 'utf8')) as Partial<Envelope<unknown>>
    return envelope.schemaVersion === 1 && validate(envelope.data) ? envelope.data : null
  } catch {
    return null
  }
}

async function hasValidEnvelope<T>(path: string, validate: (value: unknown) => value is T): Promise<boolean> {
  return (await readEnvelope(path, validate)) !== null ||
    (await readEnvelope(`${path}.bak`, validate)) !== null
}

export class AtomicJsonFileRepository<T> {
  private writeTail = Promise.resolve()

  private constructor(
    private readonly path: string,
    private value: T
  ) {}

  static async open<T>(
    path: string,
    fallback: T,
    validate: (value: unknown) => value is T
  ): Promise<AtomicJsonFileRepository<T>> {
    const primary = await readEnvelope(path, validate)
    if (primary !== null) return new AtomicJsonFileRepository(path, structuredClone(primary))
    const backup = await readEnvelope(`${path}.bak`, validate)
    return new AtomicJsonFileRepository(path, structuredClone(backup ?? fallback))
  }

  read(): T {
    return structuredClone(this.value)
  }

  replace(value: T): Promise<void> {
    const snapshot = structuredClone(value)
    this.value = snapshot
    const write = async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporaryPath = `${this.path}.tmp`
      if (await exists(this.path)) await copyFile(this.path, `${this.path}.bak`)
      await writeFile(temporaryPath, JSON.stringify({ schemaVersion: 1, data: snapshot }), 'utf8')
      await rename(temporaryPath, this.path)
    }
    this.writeTail = this.writeTail.then(write, write)
    return this.writeTail
  }

  flush(): Promise<void> {
    return this.writeTail
  }
}

export async function migrateLegacyJsonFile<T>(options: {
  path: string
  fallback: T
  validate: (value: unknown) => value is T
  readLegacy: () => unknown
  clearLegacy: () => void
}): Promise<AtomicJsonFileRepository<T>> {
  if (await exists(options.path) && await hasValidEnvelope(options.path, options.validate)) {
    return AtomicJsonFileRepository.open(options.path, options.fallback, options.validate)
  }
  const legacy = options.readLegacy()
  const repository = await AtomicJsonFileRepository.open(options.path, options.fallback, options.validate)
  if (!options.validate(legacy)) return repository
  await repository.replace(legacy)
  const verified = await AtomicJsonFileRepository.open(options.path, options.fallback, options.validate)
  if (JSON.stringify(verified.read()) === JSON.stringify(legacy)) options.clearLegacy()
  return verified
}

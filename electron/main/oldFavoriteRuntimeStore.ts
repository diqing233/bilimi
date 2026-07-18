import type { OldFavoriteRuntimeSetResult, OldFavoriteRuntimeSnapshot } from '../../src/shared/types'

type VersionedValue = {
  revision: number
  value: unknown
}

export type OldFavoriteRuntimeAccountSnapshot = Record<string, VersionedValue>

type PersistedRuntimeState = {
  accounts: Record<string, Record<string, VersionedValue>>
  global: Record<string, VersionedValue>
}

export interface OldFavoriteRuntimeStoreBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

const STORE_KEY = 'oldFavoriteRuntime'
const SET_MARKER = '__bilimiSet__'

function encodeRuntimeValue(value: unknown): unknown {
  if (value instanceof Set) return { [SET_MARKER]: [...value].map(encodeRuntimeValue) }
  if (Array.isArray(value)) return value.map(encodeRuntimeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, encodeRuntimeValue(nested)])
    )
  }
  return value
}

function decodeRuntimeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeRuntimeValue)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record[SET_MARKER])) {
      return new Set(record[SET_MARKER].map(decodeRuntimeValue))
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, nested]) => [key, decodeRuntimeValue(nested)])
    )
  }
  return value
}

const ACCOUNT_INDEPENDENT_KEYS = new Set(['deepSeekConnectionStatus'])
const LEGACY_WORKSPACE_KEYS = new Set([
  'archiveEditorState',
  'archiveRedoChanges',
  'archiveRedoStack',
  'archiveUndoChanges',
  'archiveUndoStack',
  'baseScanPreview',
  'deepSeekArchiveRunSnapshot',
  'oldFavoriteUserBatches',
  'preview'
])

export function compactOldFavoriteRuntimeState(state: PersistedRuntimeState): PersistedRuntimeState {
  return {
    accounts: Object.fromEntries(Object.entries(state.accounts).map(([accountMid, values]) => [
      accountMid,
      Object.fromEntries(Object.entries(values).filter(([key]) => !LEGACY_WORKSPACE_KEYS.has(key)))
    ])),
    global: Object.fromEntries(
      Object.entries(state.global).filter(([key]) => !LEGACY_WORKSPACE_KEYS.has(key))
    )
  }
}

export class TransientCheckpointScheduler {
  private readonly dirtyKeys = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly checkpoint: (keys: string[]) => void,
    private readonly delayMs: number
  ) {}

  markDirty(key: string): void {
    this.dirtyKeys.add(key)
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const keys = [...this.dirtyKeys]
      this.dirtyKeys.clear()
      this.checkpoint(keys)
    }, this.delayMs)
  }
}

export function isOldFavoriteRuntimeState(value: unknown): value is PersistedRuntimeState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedRuntimeState>
  return Boolean(candidate.accounts && typeof candidate.accounts === 'object' &&
    candidate.global && typeof candidate.global === 'object')
}

export class OldFavoriteRuntimeStore {
  private readonly values = new Map<string, VersionedValue>()
  private readonly transientKeys = new Set<string>()
  private accountMid = ''

  constructor(private readonly backend?: OldFavoriteRuntimeStoreBackend) {}

  get(key: string, initialValue: unknown): OldFavoriteRuntimeSnapshot {
    if (!this.values.has(key)) {
      this.values.set(key, { revision: 0, value: initialValue })
    }

    return this.snapshot(key)
  }

  set(key: string, value: unknown, expectedRevision: number): OldFavoriteRuntimeSetResult {
    const current = this.values.get(key) ?? { revision: 0, value: undefined }
    if (current.revision !== expectedRevision) {
      return { ...this.snapshotFrom(key, current), accepted: false }
    }

    const next = { revision: current.revision + 1, value }
    this.values.set(key, next)
    this.transientKeys.delete(key)
    this.persist()
    return { ...this.snapshotFrom(key, next), accepted: true }
  }

  setTransient(key: string, value: unknown, expectedRevision: number): OldFavoriteRuntimeSetResult {
    const current = this.values.get(key) ?? { revision: 0, value: undefined }
    if (current.revision !== expectedRevision) {
      return { ...this.snapshotFrom(key, current), accepted: false }
    }
    const next = { revision: current.revision + 1, value }
    this.values.set(key, next)
    this.transientKeys.add(key)
    return { ...this.snapshotFrom(key, next), accepted: true }
  }

  checkpoint(keys: string[]): boolean {
    let changed = false
    for (const key of keys) changed = this.transientKeys.delete(key) || changed
    if (changed) this.persist()
    return changed
  }

  bindAccount(accountMid: string): boolean {
    const normalized = accountMid.trim()
    if (!normalized) {
      if (!this.accountMid) return false
      this.persist()
      this.accountMid = ''
      this.loadBoundAccount()
      return true
    }
    if (!this.accountMid || this.accountMid === normalized) {
      this.accountMid = normalized
      this.loadBoundAccount()
      return false
    }
    this.accountMid = normalized
    this.loadBoundAccount()
    return true
  }

  reset(): void {
    this.values.clear()
    this.transientKeys.clear()
    this.accountMid = ''
    this.backend?.set(STORE_KEY, { accounts: {}, global: {} } satisfies PersistedRuntimeState)
  }

  resetAccount(accountMid: string): boolean {
    const normalized = accountMid.trim()
    if (!normalized || !this.backend) return false
    const persisted = this.readPersisted()
    if (!(normalized in persisted.accounts)) return false
    const previous = structuredClone(persisted)
    delete persisted.accounts[normalized]
    try {
      this.backend.set(STORE_KEY, encodeRuntimeValue(persisted))
    } catch (error) {
      try { this.backend.set(STORE_KEY, encodeRuntimeValue(previous)) } catch { /* preserve the original failure */ }
      throw error
    }
    if (this.accountMid === normalized) this.loadBoundAccount()
    return true
  }

  captureAccount(accountMid: string): OldFavoriteRuntimeAccountSnapshot | null {
    const normalized = accountMid.trim()
    if (!normalized || !this.backend) return null
    const persisted = this.readPersisted()
    const account = persisted.accounts[normalized]
    return account ? structuredClone(account) : null
  }

  restoreAccount(accountMid: string, snapshot: OldFavoriteRuntimeAccountSnapshot | null): void {
    const normalized = accountMid.trim()
    if (!normalized || !this.backend) return
    const persisted = this.readPersisted()
    if (snapshot) persisted.accounts[normalized] = structuredClone(snapshot)
    else delete persisted.accounts[normalized]
    this.backend.set(STORE_KEY, encodeRuntimeValue(persisted))
    if (this.accountMid === normalized) this.loadBoundAccount()
  }

  prepareForShutdown(): void {
    const phase = this.values.get('oldFavoriteExecutionPhase')
    if (phase && ['running', 'pausing'].includes(String(phase.value))) {
      this.values.set('oldFavoriteExecutionPhase', {
        revision: phase.revision + 1,
        value: 'paused'
      })
      const reconciliation = this.values.get('oldFavoriteRecoveryRequiresReconciliation')
      this.values.set('oldFavoriteRecoveryRequiresReconciliation', {
        revision: (reconciliation?.revision ?? 0) + 1,
        value: true
      })
    }
    for (const key of ['deepSeekArchiveRunning', 'basicScanRunning', 'tagEnrichmentRunning']) {
      const entry = this.values.get(key)
      if (entry?.value === true) this.values.set(key, { revision: entry.revision + 1, value: false })
    }
    this.persist()
  }

  private readPersisted(): PersistedRuntimeState {
    const stored = this.backend?.get(STORE_KEY)
    if (!stored || typeof stored !== 'object') return { accounts: {}, global: {} }
    const candidate = stored as Partial<PersistedRuntimeState>
    return {
      accounts: candidate.accounts && typeof candidate.accounts === 'object'
        ? decodeRuntimeValue(candidate.accounts) as PersistedRuntimeState['accounts']
        : {},
      global: candidate.global && typeof candidate.global === 'object'
        ? decodeRuntimeValue(candidate.global) as PersistedRuntimeState['global']
        : {}
    }
  }

  private loadBoundAccount(): void {
    this.transientKeys.clear()
    if (!this.backend) {
      for (const key of this.values.keys()) {
        if (!ACCOUNT_INDEPENDENT_KEYS.has(key)) this.values.delete(key)
      }
      return
    }
    const persisted = this.readPersisted()
    this.values.clear()
    for (const [key, entry] of Object.entries(persisted.global)) this.values.set(key, entry)
    if (!this.accountMid) return
    for (const [key, entry] of Object.entries(persisted.accounts[this.accountMid] ?? {})) {
      this.values.set(key, entry)
    }
  }

  private persist(): void {
    if (!this.backend) return
    const persisted = this.readPersisted()
    const accountValues: Record<string, VersionedValue> = {
      ...(this.accountMid ? persisted.accounts[this.accountMid] : {})
    }
    const globalValues: Record<string, VersionedValue> = { ...persisted.global }
    for (const [key, entry] of this.values) {
      if (this.transientKeys.has(key)) continue
      if (ACCOUNT_INDEPENDENT_KEYS.has(key)) globalValues[key] = entry
      else if (this.accountMid) accountValues[key] = entry
    }
    if (this.accountMid) persisted.accounts[this.accountMid] = accountValues
    persisted.global = globalValues
    this.backend.set(STORE_KEY, encodeRuntimeValue(persisted))
  }

  private snapshot(key: string): OldFavoriteRuntimeSnapshot {
    return this.snapshotFrom(key, this.values.get(key) ?? { revision: 0, value: undefined })
  }

  private snapshotFrom(key: string, entry: VersionedValue): OldFavoriteRuntimeSnapshot {
    return {
      key,
      revision: entry.revision,
      value: entry.value,
      accountMid: this.accountMid
    }
  }
}

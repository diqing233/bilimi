import type { OldFavoriteRuntimeSetResult, OldFavoriteRuntimeSnapshot } from '../../src/shared/types'

type VersionedValue = {
  revision: number
  value: unknown
}

const ACCOUNT_INDEPENDENT_KEYS = new Set(['deepSeekConnectionStatus'])

export class OldFavoriteRuntimeStore {
  private readonly values = new Map<string, VersionedValue>()
  private accountMid = ''

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
    return { ...this.snapshotFrom(key, next), accepted: true }
  }

  bindAccount(accountMid: string): boolean {
    const normalized = accountMid.trim()
    if (!normalized) {
      return false
    }
    if (!this.accountMid || this.accountMid === normalized) {
      this.accountMid = normalized
      return false
    }

    for (const key of this.values.keys()) {
      if (!ACCOUNT_INDEPENDENT_KEYS.has(key)) {
        this.values.delete(key)
      }
    }
    this.accountMid = normalized
    return true
  }

  reset(): void {
    this.values.clear()
    this.accountMid = ''
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

export type OldFavoriteOverlayKind = 'user' | 'deepseek'
export type OldFavoriteOverlayPatch = { aid: number } & Record<string, unknown>

type PendingPatch = {
  accountMid: string
  batchId: string
  kind: OldFavoriteOverlayKind
  patch: OldFavoriteOverlayPatch
}

export class OldFavoriteOverlayQueue {
  private readonly pending = new Map<string, PendingPatch>()

  constructor(private readonly write: (
    accountMid: string,
    batchId: string,
    kind: OldFavoriteOverlayKind,
    patches: OldFavoriteOverlayPatch[]
  ) => Promise<void>) {}

  enqueue(accountMid: string, batchId: string, kind: OldFavoriteOverlayKind, patch: OldFavoriteOverlayPatch) {
    this.pending.set(`${accountMid}:${batchId}:${kind}:${patch.aid}`, {
      accountMid, batchId, kind, patch: structuredClone(patch)
    })
  }

  hasPending(accountMid?: string, batchId?: string) {
    return [...this.pending.values()].some((value) =>
      (!accountMid || value.accountMid === accountMid) && (!batchId || value.batchId === batchId)
    )
  }

  async flush(accountMid?: string, batchId?: string) {
    const selected = [...this.pending.entries()].filter(([, value]) =>
      (!accountMid || value.accountMid === accountMid) && (!batchId || value.batchId === batchId)
    )
    const groups = new Map<string, PendingPatch[]>()
    for (const [, value] of selected) {
      const key = `${value.accountMid}:${value.batchId}:${value.kind}`
      groups.set(key, [...(groups.get(key) ?? []), value])
    }
    for (const group of groups.values()) {
      const first = group[0]
      await this.write(first.accountMid, first.batchId, first.kind, group.map((item) => item.patch))
      for (const [key, value] of selected) {
        if (
          value.accountMid === first.accountMid &&
          value.batchId === first.batchId &&
          value.kind === first.kind
        ) {
          if (this.pending.get(key) === value) this.pending.delete(key)
        }
      }
    }
  }
}

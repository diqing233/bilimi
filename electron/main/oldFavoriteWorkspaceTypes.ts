export type OldFavoriteBatchKind = 'full' | 'incremental'
export type OldFavoriteBatchStatus = 'active' | 'archived'
export type OldFavoriteChunkKind = 'base' | 'tags' | 'sources'
export type OldFavoriteOverlayKind = 'user' | 'deepseek' | 'execution'
export type OldFavoriteOverlayPatch = { aid: number } & Record<string, unknown>

export type OldFavoriteBatchSummary = {
  id: string
  storageKey: string
  kind: OldFavoriteBatchKind
  createdAt: string
  status: OldFavoriteBatchStatus
  finalizedAt?: string
}

export type OldFavoriteAccountIndex = {
  version: 2
  accountMid: string
  batches: OldFavoriteBatchSummary[]
}

export type OldFavoriteChunkRecord = {
  file: string
  kind: OldFavoriteChunkKind
  sequence: number
  count: number
  checksum: string
  groupId?: string
}

export type OldFavoriteBatchManifest = OldFavoriteBatchSummary & {
  version: 2
  accountMid: string
  chunks: OldFavoriteChunkRecord[]
}

export type OldFavoriteBatchDetail = {
  summary: OldFavoriteBatchSummary
  base: unknown[]
  tags: unknown[]
  sources: unknown[]
  overlays: Record<OldFavoriteOverlayKind, Record<string, unknown>>
}

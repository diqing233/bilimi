import type { FavoriteRepositoryFolder } from './favoriteRepository'

export type FavoriteOperationAction =
  | 'copy'
  | 'move'
  | 'delete-local'
  | 'unfavorite-remote'
  | 'delete-managed-folder-local'
  | 'delete-managed-folder-remote'

export type FavoriteOperationSource =
  | { kind: 'folder'; folderId: string }
  | { kind: 'virtual'; label: string }

export type FavoriteOperationSourceScopeKind =
  | 'bilimi-work-folder'
  | 'unmatched'
  | 'bilibili-default'
  | 'bilibili-user-folder'
  | 'mixed-virtual'

export type FavoriteOperationEligibility = {
  sourceScopeKind: FavoriteOperationSourceScopeKind
  eligibleAids: number[]
  skipped: Array<{ aid: number; reason: 'invalid-aid' }>
  allowedActions: FavoriteOperationAction[]
}

const BASE_ACTIONS: FavoriteOperationAction[] = ['copy', 'move', 'delete-local', 'unfavorite-remote']

/** Derives a stable, renderer-safe operation contract without relying on folder titles. */
export function determineFavoriteOperationEligibility(input: {
  source: FavoriteOperationSource
  aids: number[]
  folders: FavoriteRepositoryFolder[]
}): FavoriteOperationEligibility {
  const skipped = input.aids.filter((aid) => !Number.isSafeInteger(aid) || aid <= 0)
    .map((aid) => ({ aid, reason: 'invalid-aid' as const }))
    .sort((left, right) => left.aid - right.aid)
  const eligibleAids = [...new Set(input.aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))].sort((left, right) => left - right)
  let sourceScopeKind: FavoriteOperationSourceScopeKind = 'mixed-virtual'
  const source = input.source
  if (source.kind === 'folder') {
    const folder = input.folders.find((candidate) => candidate.id === source.folderId)
    if (folder?.kind === 'bilimi-logical') sourceScopeKind = 'bilimi-work-folder'
    else if (folder?.id === 'local:inbox') sourceScopeKind = 'unmatched'
    else if (folder?.kind === 'bilibili') sourceScopeKind = folder.remoteFolderId === '1' ? 'bilibili-default' : 'bilibili-user-folder'
  }
  return {
    sourceScopeKind,
    eligibleAids,
    skipped,
    allowedActions: sourceScopeKind === 'bilimi-work-folder'
      ? [...BASE_ACTIONS, 'delete-managed-folder-local', 'delete-managed-folder-remote']
      : [...BASE_ACTIONS]
  }
}

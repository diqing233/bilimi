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
  skipped: Array<{ aid: number; reason: 'invalid-aid' | 'bilibili-folder-copy-only' | 'action-not-allowed' }>
  allowedActions: FavoriteOperationAction[]
}

const BASE_ACTIONS: FavoriteOperationAction[] = ['copy', 'move', 'delete-local', 'unfavorite-remote']

/** Derives a stable, renderer-safe operation contract without relying on folder titles. */
export function determineFavoriteOperationEligibility(input: {
  source: FavoriteOperationSource
  aids: number[]
  folders: FavoriteRepositoryFolder[]
  /** Virtual pages can carry source provenance per row without exposing remote IDs. */
  aidScopeKinds?: Record<number, FavoriteOperationSourceScopeKind>
}): FavoriteOperationEligibility {
  const skipped: FavoriteOperationEligibility['skipped'] = input.aids.filter((aid) => !Number.isSafeInteger(aid) || aid <= 0)
    .map((aid) => ({ aid, reason: 'invalid-aid' as const }))
    .sort((left, right) => left.aid - right.aid)
  let sourceScopeKind: FavoriteOperationSourceScopeKind = 'mixed-virtual'
  const source = input.source
  if (source.kind === 'folder') {
    const folder = input.folders.find((candidate) => candidate.id === source.folderId)
    if (folder?.kind === 'bilimi-logical') sourceScopeKind = 'bilimi-work-folder'
    else if (folder?.id === 'local:inbox') sourceScopeKind = 'unmatched'
    else if (folder?.kind === 'bilibili') sourceScopeKind = folder.remoteFolderId === '1' ? 'bilibili-default' : 'bilibili-user-folder'
  }
  const eligibleAids = [...new Set(input.aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
    .filter((aid) => {
      if (sourceScopeKind !== 'mixed-virtual') return true
      const perAidScope = input.aidScopeKinds?.[aid]
      if (perAidScope !== 'bilibili-default' && perAidScope !== 'bilibili-user-folder') return true
      skipped.push({ aid, reason: 'bilibili-folder-copy-only' })
      return false
    }).sort((left, right) => left - right)
  skipped.sort((left, right) => left.aid - right.aid || left.reason.localeCompare(right.reason))
  return {
    sourceScopeKind,
    eligibleAids,
    skipped,
    allowedActions: sourceScopeKind === 'bilimi-work-folder'
      ? [...BASE_ACTIONS, 'delete-managed-folder-local', 'delete-managed-folder-remote']
      : sourceScopeKind === 'bilibili-default' || sourceScopeKind === 'bilibili-user-folder'
        ? ['copy']
      : [...BASE_ACTIONS]
  }
}

/**
 * Computes eligibility for one requested action.  A mixed virtual result can
 * include Bilibili-source rows: those rows may be copied, but never moved or
 * destructively changed from this library.
 */
export function determineFavoriteOperationActionEligibility(input: {
  source: FavoriteOperationSource
  action: FavoriteOperationAction
  aids: number[]
  folders: FavoriteRepositoryFolder[]
  aidScopeKinds?: Record<number, FavoriteOperationSourceScopeKind>
}): FavoriteOperationEligibility {
  const sourceEligibility = determineFavoriteOperationEligibility({
    source: input.source,
    aids: [],
    folders: input.folders,
    aidScopeKinds: input.aidScopeKinds
  })
  const invalid = input.aids.filter((aid) => !Number.isSafeInteger(aid) || aid <= 0)
    .map((aid) => ({ aid, reason: 'invalid-aid' as const }))
  const validAids = [...new Set(input.aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
    .sort((left, right) => left - right)
  const skipped: FavoriteOperationEligibility['skipped'] = [...invalid]
  if (!sourceEligibility.allowedActions.includes(input.action)) {
    skipped.push(...validAids.map((aid) => ({
      aid,
      reason: sourceEligibility.sourceScopeKind === 'bilibili-default' || sourceEligibility.sourceScopeKind === 'bilibili-user-folder'
        ? 'bilibili-folder-copy-only' as const
        : 'action-not-allowed' as const
    })))
    return { ...sourceEligibility, eligibleAids: [], skipped: skipped.sort((left, right) => left.aid - right.aid || left.reason.localeCompare(right.reason)) }
  }
  const eligibleAids = validAids.filter((aid) => {
    if (sourceEligibility.sourceScopeKind !== 'mixed-virtual' || input.action === 'copy') return true
    const scope = input.aidScopeKinds?.[aid]
    if (scope === 'bilibili-default' || scope === 'bilibili-user-folder') {
      skipped.push({ aid, reason: 'bilibili-folder-copy-only' })
      return false
    }
    return true
  })
  return {
    ...sourceEligibility,
    eligibleAids,
    skipped: skipped.sort((left, right) => left.aid - right.aid || left.reason.localeCompare(right.reason))
  }
}

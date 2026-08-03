import type { FavoriteRepositoryFolder } from '../../src/shared/favoriteRepository'
import type { FavoriteOperationSourceScope } from './favoriteRepositoryBatchOperationService'

type RendererSource =
  | { kind: 'folder'; folderId: string }
  | { kind: 'virtual'; eligibleAids: number[]; skippedAids: number[] }

export function resolveFavoriteLibraryOperationSource(
  snapshot: { folders: readonly FavoriteRepositoryFolder[]; memberships: Record<string, number[]> },
  source: RendererSource,
  requestedAids: number[]
): FavoriteOperationSourceScope {
  if (source.kind === 'folder') {
    const folder = snapshot.folders.find((candidate) => candidate.id === source.folderId)
    if (!folder) throw new Error('Favorite operation source was not found.')
    if (folder.kind === 'bilimi-logical') return { kind: 'bilimi-logical', folderId: folder.id }
    if (folder.id === 'local:inbox') {
      const members = new Set(snapshot.memberships[folder.id] ?? [])
      if (requestedAids.some((aid) => !members.has(aid))) throw new Error('Favorite unmatched source selection is invalid.')
      return { kind: 'virtual', eligibleAids: [...requestedAids].sort((left, right) => left - right), skippedAids: [] }
    }
    if (folder.kind === 'bilibili') return {
      kind: folder.remoteFolderId === '1' ? 'bilibili-default' : 'bilibili-user', folderId: folder.id
    }
    throw new Error('Favorite operation source does not support batch actions.')
  }
  const eligible = new Set(source.eligibleAids)
  const skipped = new Set(source.skippedAids)
  if (eligible.size !== source.eligibleAids.length || skipped.size !== source.skippedAids.length ||
    [...eligible].some((aid) => skipped.has(aid)) || requestedAids.some((aid) => !eligible.has(aid))) {
    throw new Error('Favorite virtual source eligibility evidence is invalid.')
  }
  return {
    kind: 'virtual',
    eligibleAids: [...eligible].sort((left, right) => left - right),
    skippedAids: [...skipped].sort((left, right) => left - right)
  }
}

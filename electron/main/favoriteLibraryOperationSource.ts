import type { FavoriteRepositoryFolder } from '../../src/shared/favoriteRepository'
import type { FavoriteOperationSourceScope } from './favoriteRepositoryBatchOperationService'

type RendererSource =
  | { kind: 'folder'; folderId: string; folderIds?: string[] }
  | { kind: 'virtual'; eligibleAids: number[]; skippedAids: number[]; bilimiMembershipSelection?: 'primary' | 'all' }

export function resolveFavoriteLibraryOperationSource(
  snapshot: { folders: readonly FavoriteRepositoryFolder[]; memberships: Record<string, number[]> },
  source: RendererSource,
  requestedAids: number[]
): FavoriteOperationSourceScope {
  if (source.kind === 'folder') {
    const folder = snapshot.folders.find((candidate) => candidate.id === source.folderId)
    if (!folder) throw new Error('Favorite operation source was not found.')
    if (folder.kind === 'bilimi-logical') {
      const requestedFolderIds = source.folderIds === undefined ? [folder.id] : source.folderIds
      if (!requestedFolderIds.length || requestedFolderIds.some((folderId) => typeof folderId !== 'string' || !/^bilimi-logical:\S+$/u.test(folderId.trim()))) {
        throw new Error('Favorite operation Bilimi work-folder scope is invalid.')
      }
      const folderIds = [...new Set(requestedFolderIds.map((folderId) => folderId.trim()))].sort()
      if (!folderIds.includes(folder.id)) throw new Error('Favorite operation Bilimi work-folder scope must include the current folder.')
      if (folderIds.some((folderId) => !snapshot.folders.some((candidate) => candidate.id === folderId && candidate.kind === 'bilimi-logical'))) {
        throw new Error('Favorite operation Bilimi work-folder scope was not found.')
      }
      return { kind: 'bilimi-logical', folderId: folder.id, ...(source.folderIds === undefined ? {} : { folderIds }) }
    }
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
    skippedAids: [...skipped].sort((left, right) => left - right),
    ...(source.bilimiMembershipSelection ? { bilimiMembershipSelection: source.bilimiMembershipSelection } : {})
  }
}

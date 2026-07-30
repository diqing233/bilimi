import type { FavoriteRepositoryFolder } from '@shared/favoriteRepository'
import type { FavoriteOperationSourceScopeKind } from '@shared/favoriteLibraryOperations'
import type { FavoriteRepositoryLibraryRow } from '../../../../../electron/main/favoriteRepositoryIpc'

export function buildFavoriteLibraryEligibilityIndex(
  folders: FavoriteRepositoryFolder[],
  rows: FavoriteRepositoryLibraryRow[]
) {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const aidScopeKinds: Record<number, FavoriteOperationSourceScopeKind> = {}
  rows.forEach((row) => {
    const sourceFolder = row.folderIds.map((folderId) => folderById.get(folderId))
      .find((folder) => folder?.kind === 'bilibili')
    if (sourceFolder?.kind === 'bilibili') {
      aidScopeKinds[row.video.aid] = sourceFolder.remoteFolderId === '1' ? 'bilibili-default' : 'bilibili-user-folder'
    }
  })
  return { folderById, aidScopeKinds }
}

export function resolveFavoriteLibrarySource(
  folderId: string | undefined,
  folderById: Map<string, FavoriteRepositoryFolder>,
  virtualLabel: string
) {
  if (!folderId) return { source: { kind: 'virtual' as const, label: virtualLabel }, sourceScopeKind: 'mixed-virtual' as const }
  const folder = folderById.get(folderId)
  const sourceScopeKind = folder?.kind === 'bilimi-logical'
    ? 'bilimi-work-folder' as const
    : folder?.id === 'local:inbox'
      ? 'unmatched' as const
      : folder?.kind === 'bilibili'
        ? folder.remoteFolderId === '1' ? 'bilibili-default' as const : 'bilibili-user-folder' as const
        : 'mixed-virtual' as const
  return { source: { kind: 'folder' as const, folderId }, sourceScopeKind }
}

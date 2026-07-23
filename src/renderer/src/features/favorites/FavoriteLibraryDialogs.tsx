type ManagedFolderDialog = {
  title: string
  canDeleteRemotely: boolean
}

type FavoriteLibraryDialogsProps = {
  managedFolder?: ManagedFolderDialog
  onManagedFolderChoice?: (choice: 'local' | 'remote') => void
}

/** Renders only explicit choices; callers own preview and confirmation state. */
export function FavoriteLibraryDialogs({ managedFolder, onManagedFolderChoice }: FavoriteLibraryDialogsProps) {
  if (!managedFolder) return null
  return <section className="favorite-library__dialog" role="dialog" aria-label={`删除 ${managedFolder.title}`}>
    <p>默认只从收藏库删除；不会修改 B 站收藏。</p>
    <button type="button" onClick={() => onManagedFolderChoice?.('local')}>仅从收藏库删除</button>
    {managedFolder.canDeleteRemotely ? <button type="button" className="favorite-library__danger-action" onClick={() => onManagedFolderChoice?.('remote')}>删除并同步到B站</button> : null}
  </section>
}

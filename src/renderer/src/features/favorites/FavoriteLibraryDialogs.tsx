type ManagedFolderDialog = {
  title: string
  canDeleteRemotely: boolean
  preview?: {
    currentRevision: number
    localMemberCount: number
    unmatchedFallbackCount: number
    extraRemoteMemberCount: number
    remoteOnlyMemberCount: number
  }
}

type FavoriteLibraryDialogsProps = {
  managedFolder?: ManagedFolderDialog
  onManagedFolderChoice?: (choice: 'local' | 'remote') => void
}

/** Renders only explicit choices; callers own preview and confirmation state. */
export function FavoriteLibraryDialogs({ managedFolder, onManagedFolderChoice }: FavoriteLibraryDialogsProps) {
  const [remoteConfirmationOpen, setRemoteConfirmationOpen] = useState(false)
  if (!managedFolder) return null
  return <section className="favorite-library__dialog" role="dialog" aria-label={`删除 ${managedFolder.title}`}>
    <p>默认只从收藏库删除；不会修改 B 站收藏。</p>
    {managedFolder.preview ? <div className="favorite-library__managed-folder-preview" role="status">
      <p>当前基线版本 {managedFolder.preview.currentRevision}；执行时会再次核对，版本变化将拒绝执行。</p>
      <p>受影响本地视频 {managedFolder.preview.localMemberCount}；未匹配回退 {managedFolder.preview.unmatchedFallbackCount}。</p>
      <p>额外远端成员 {managedFolder.preview.extraRemoteMemberCount}；仅远端成员 {managedFolder.preview.remoteOnlyMemberCount}。</p>
    </div> : null}
    <button type="button" onClick={() => onManagedFolderChoice?.('local')}>仅从收藏库删除</button>
    {managedFolder.canDeleteRemotely ? <><button type="button" className="favorite-library__danger-action" onClick={() => setRemoteConfirmationOpen(true)}>删除并同步到B站</button>
      {remoteConfirmationOpen ? <div role="alertdialog" aria-label="再次确认删除B站文件夹"><p>将删除当前 B 站受管文件夹。请确认已核对受影响视频、未匹配回退和额外远程成员。</p><button type="button" className="favorite-library__danger-action" onClick={() => onManagedFolderChoice?.('remote')}>确认删除并同步到B站</button><button type="button" onClick={() => setRemoteConfirmationOpen(false)}>取消</button></div> : null}
    </> : null}
  </section>
}
import { useState } from 'react'

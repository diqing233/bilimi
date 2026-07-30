import { type ReactNode, useState } from 'react'
import { BilimiModal } from '../../components/BilimiModal'

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
  onManagedFolderChoice?: (choice: 'local' | 'remote') => void | Promise<void>
  onClose?: () => void
}

type ConfirmationDialogProps = {
  label: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
}

export function FavoriteLibraryConfirmationDialog({ label, children, onClose, busy = false }: ConfirmationDialogProps) {
  return <BilimiModal
    title={label}
    role="alertdialog"
    busy={busy}
    onClose={onClose}
    className="favorite-library__dialog favorite-library__dialog-overlay"
  >
    {children}
  </BilimiModal>
}

export function FavoriteLibraryDialogs({ managedFolder, onManagedFolderChoice, onClose }: FavoriteLibraryDialogsProps) {
  const [remoteConfirmationOpen, setRemoteConfirmationOpen] = useState(false)
  const [executing, setExecuting] = useState(false)
  const requestClose = () => {
    if (!executing) onClose?.()
  }
  const executeChoice = async (choice: 'local' | 'remote') => {
    setExecuting(true)
    try {
      await onManagedFolderChoice?.(choice)
    } finally {
      setExecuting(false)
    }
  }

  if (!managedFolder) return null
  return <BilimiModal
    title={`删除 ${managedFolder.title}`}
    busy={executing}
    onClose={requestClose}
    className="favorite-library__dialog favorite-library__dialog-overlay"
    actions={<>
      <button type="button" disabled={executing} onClick={requestClose}>取消</button>
      <button type="button" className="favorite-library__danger-action" data-variant="danger" disabled={executing} onClick={() => void executeChoice('local')}>仅从收藏库删除</button>
      {managedFolder.canDeleteRemotely ? <button type="button" className="favorite-library__dialog-remote-action" data-variant="danger" disabled={executing} onClick={() => setRemoteConfirmationOpen(true)}>删除并同步到B站</button> : null}
    </>}
  >
    <p>默认只从收藏库删除；不会修改 B 站收藏。</p>
    {managedFolder.preview ? <div className="favorite-library__managed-folder-preview" role="status">
      <p>当前基线版本 {managedFolder.preview.currentRevision}；执行时会再次核对，版本变化将拒绝执行。</p>
      <p>受影响本地视频 {managedFolder.preview.localMemberCount}；未匹配回退 {managedFolder.preview.unmatchedFallbackCount}。</p>
      <p>额外远端成员 {managedFolder.preview.extraRemoteMemberCount}；仅远端成员 {managedFolder.preview.remoteOnlyMemberCount}。</p>
    </div> : null}
    {managedFolder.canDeleteRemotely && remoteConfirmationOpen ? <div className="favorite-library__dialog-secondary-confirmation" role="alertdialog" aria-label="再次确认删除B站文件夹"><p>将删除当前 B 站受管文件夹。请确认已核对受影响视频、未匹配回退和额外远程成员。</p><div className="favorite-library__dialog-actions"><button type="button" disabled={executing} onClick={() => setRemoteConfirmationOpen(false)}>取消</button><button type="button" className="favorite-library__dialog-remote-action" disabled={executing} onClick={() => void executeChoice('remote')}>确认删除并同步到B站</button></div></div> : null}
  </BilimiModal>
}

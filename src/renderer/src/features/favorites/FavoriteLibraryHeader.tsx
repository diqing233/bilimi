import type { ReactNode } from 'react'

type FavoriteLibraryHeaderProps = {
  title: string
  account?: string
  remoteWarning?: boolean
  onGoToPending?: () => void
  maximized?: boolean
  onMinimize?: () => void
  onToggleMaximize?: () => void
  onClose?: () => void
  children?: ReactNode
}

/** Compact host-independent top bar; host window actions remain optional. */
export function FavoriteLibraryHeader({
  title, account, remoteWarning = false, onGoToPending, maximized = false, onMinimize, onToggleMaximize, onClose, children
}: FavoriteLibraryHeaderProps) {
  const minimizeLabel = '最小化'
  const maximizeLabel = maximized ? '还原' : '最大化'
  return <header className="favorite-library__topbar" data-testid="favorite-library-topbar">
    <span className="favorite-library__brand-mark" aria-label="XiaoMi">米</span>
    <strong>{title}</strong>
    {account ? <span className="favorite-library__topbar-account">{account}</span> : null}
    {children}
    {remoteWarning ? <span className="favorite-library__remote-warning" role="status">远程状态待确认：操作失败或结果未知 <button type="button" aria-label="go-pending-scope" onClick={onGoToPending}>去待处理</button></span> : null}
    <span className="favorite-library__window-actions">
      <button type="button" aria-label={minimizeLabel} onClick={onMinimize}>{minimizeLabel}</button>
      <button type="button" aria-label={maximizeLabel} onClick={onToggleMaximize}>{maximizeLabel}</button>
      <button type="button" aria-label="关闭" onClick={onClose}>关闭</button>
    </span>
  </header>
}

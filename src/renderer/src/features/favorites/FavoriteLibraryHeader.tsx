import type { ReactNode } from 'react'
import xiaomiAvatarUrl from '../../../../../electron/assets/bilimi-avatar.png'

type FavoriteLibraryHeaderProps = {
  title: string
  account?: string
  remoteWarning?: boolean
  onGoToPending?: () => void
  onMinimize?: () => void
  onExpandAndMaximize?: () => void
  onClose?: () => void
  children?: ReactNode
}

/** Compact host-independent top bar; host window actions remain optional. */
export function FavoriteLibraryHeader({
  title, account, remoteWarning = false, onGoToPending, onMinimize, onExpandAndMaximize, onClose, children
}: FavoriteLibraryHeaderProps) {
  const minimizeLabel = '最小化'
  const maximizeLabel = '最大化'
  const maximizeTooltip = '展开并拉到最高'
  const accountLabel = account && (/[（(].*[）)]/.test(account) ? account : `（${account}）`)
  return <header className="favorite-library__topbar" data-testid="favorite-library-topbar">
    <span className="favorite-library__brand-mark" aria-label="XiaoMi"><img src={xiaomiAvatarUrl} alt="" /></span>
    <strong>小咪{title}</strong>
    {accountLabel ? <span className="favorite-library__topbar-account">{accountLabel}</span> : null}
    {children ? <span className="favorite-library__topbar-status">{children}</span> : null}
    {remoteWarning ? <span className="favorite-library__remote-warning" role="status">远程状态待确认：操作失败或结果未知 <button type="button" aria-label="go-pending-scope" onClick={onGoToPending}>去待处理</button></span> : null}
    <span className="favorite-library__window-actions">
      <button type="button" aria-label={minimizeLabel} onClick={onMinimize}>{minimizeLabel}</button>
      <button type="button" aria-label={maximizeLabel} title={maximizeTooltip} onClick={onExpandAndMaximize}><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14M12 19V8m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      <button type="button" aria-label="关闭" onClick={onClose}>关闭</button>
    </span>
  </header>
}

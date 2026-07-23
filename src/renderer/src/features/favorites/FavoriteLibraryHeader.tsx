import type { ReactNode } from 'react'

type FavoriteLibraryHeaderProps = {
  title: string
  remoteWarning?: boolean
  maximized?: boolean
  onMinimize?: () => void
  onToggleMaximize?: () => void
  children?: ReactNode
}

/** Compact host-independent top bar; host window actions remain optional. */
export function FavoriteLibraryHeader({
  title,
  remoteWarning = false,
  maximized = false,
  onMinimize,
  onToggleMaximize,
  children
}: FavoriteLibraryHeaderProps) {
  const minimizeLabel = '\u6700\u5c0f\u5316'
  const maximizeLabel = maximized ? '\u8fd8\u539f' : '\u6700\u5927\u5316'
  return <header className="favorite-library__topbar" data-testid="favorite-library-topbar">
    <strong>{title}</strong>
    {children}
    {remoteWarning ? <span className="favorite-library__remote-warning" role="status">\u8fdc\u7a0b\u72b6\u6001\u5f85\u786e\u8ba4</span> : null}
    <span className="favorite-library__window-actions">
      <button type="button" aria-label={minimizeLabel} onClick={onMinimize}>{minimizeLabel}</button>
      <button type="button" aria-label={maximizeLabel} onClick={onToggleMaximize}>{maximizeLabel}</button>
    </span>
  </header>
}

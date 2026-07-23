import { useState, type ReactNode } from 'react'

type FavoriteLibraryToolbarProps = {
  pageCount: number
  selectedCount: number
  allCurrentPageSelected: boolean
  onTogglePage: () => void
  children?: ReactNode
}

export function FavoriteLibraryToolbar({
  pageCount, selectedCount, allCurrentPageSelected, onTogglePage, children
}: FavoriteLibraryToolbarProps) {
  const selectLabel = '\u5168\u9009\u5f53\u524d\u9875'
  const selectText = `\u5168\u9009\u5f53\u524d\u9875\uff08${pageCount}\uff09`
  return <div className="favorite-library__toolbar" data-testid="favorite-library-toolbar">
    <label className="favorite-library__select-page"><input type="checkbox" aria-label={selectLabel} checked={allCurrentPageSelected} disabled={!pageCount} onChange={onTogglePage} />{selectText}</label>
    <small>{`\u5df2\u9009 ${selectedCount} \u9879`}</small>
    <BatchActions />
    {children}
  </div>
}

function BatchActions() {
  const [open, setOpen] = useState(false)
  return <div className="favorite-library__batch-actions">
    <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>批量操作</button>
    {open ? <div><button type="button">复制至</button><button type="button">移动至</button></div> : null}
  </div>
}

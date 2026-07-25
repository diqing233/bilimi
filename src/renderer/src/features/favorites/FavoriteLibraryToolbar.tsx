import { useState, type ReactNode } from 'react'

export type FavoriteLibraryBatchAction = 'copy' | 'move' | 'refresh' | 'transcribe' | 'sync' | 'delete-local' | 'unfavorite-remote'
export type FavoriteLibraryFilter = 'all' | 'pending' | 'protected' | 'unsynced'
export type FavoriteLibrarySort = 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc'

type FavoriteLibraryToolbarProps = {
  pageCount: number
  selectedCount: number
  allCurrentPageSelected: boolean
  onTogglePage: () => void
  onBatchAction?: (action: FavoriteLibraryBatchAction) => void
  batchDisabled?: boolean
  allowedActions?: FavoriteLibraryBatchAction[]
  searchQuery?: string
  onSearchChange?: (query: string) => void
  children?: ReactNode
}

export function FavoriteLibraryToolbar({
  pageCount, selectedCount, allCurrentPageSelected, onTogglePage, onBatchAction, batchDisabled = false, allowedActions,
  searchQuery = '', onSearchChange, children
}: FavoriteLibraryToolbarProps) {
  const selectLabel = '\u5168\u9009\u5f53\u524d\u9875'
  const selectText = `\u5168\u9009\u5f53\u524d\u9875\uff08${pageCount}\uff09`
  return <div className="favorite-library__toolbar" data-testid="favorite-library-toolbar">
    <div className="favorite-library__toolbar-primary">
    <label className="favorite-library__select-page"><input type="checkbox" aria-label={selectLabel} checked={allCurrentPageSelected} disabled={!pageCount} onChange={onTogglePage} />{selectText}</label>
    <small>{`已选 ${selectedCount} 项`}</small>
    <input type="search" aria-label="搜索收藏库" placeholder="搜索标题、UP主或标签" value={searchQuery} onChange={(event) => onSearchChange?.(event.currentTarget.value)} />
    <BatchActions disabled={batchDisabled} allowedActions={allowedActions} onAction={onBatchAction} />
    </div>
    {children}
  </div>
}

export function FavoriteLibraryColumnMenu<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value)?.label ?? label
  return <span className="favorite-library__column-menu">
    <button type="button" className="favorite-library__column-menu-trigger" aria-label={label} aria-expanded={open} onClick={() => setOpen((currentOpen) => !currentOpen)}>{current}<Chevron /></button>
    {open ? <span role="menu" className="favorite-library__column-menu-options">{options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} onClick={() => { onChange(option.value); setOpen(false) }}>{option.label}</button>)}</span> : null}
  </span>
}

function Chevron() {
  return <svg className="favorite-library__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function BatchActions({ disabled, allowedActions, onAction }: { disabled: boolean; allowedActions?: FavoriteLibraryBatchAction[]; onAction?: (action: FavoriteLibraryBatchAction) => void }) {
  const [open, setOpen] = useState(false)
  const [dangerOpen, setDangerOpen] = useState(false)
  const allowed = (action: FavoriteLibraryBatchAction) => !allowedActions || allowedActions.includes(action)
  const run = (action: FavoriteLibraryBatchAction) => {
    if (!allowed(action)) return
    setOpen(false)
    onAction?.(action)
  }
  const commonActions: Array<[FavoriteLibraryBatchAction, string]> = [['copy', '复制至'], ['move', '移动至'], ['refresh', '刷新所选信息'], ['transcribe', '加入转写队列'], ['sync', '同步到B站']]
  const dangerActions: Array<[FavoriteLibraryBatchAction, string]> = [['delete-local', '从收藏库删除'], ['unfavorite-remote', '取消B站收藏']]
  return <div className="favorite-library__batch-actions">
    <button type="button" className="favorite-library__disclosure-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>批量操作<Chevron /></button>
    {open ? <div className="favorite-library__batch-action-menu">
      <div>{commonActions.filter(([action]) => allowed(action)).map(([action, label]) => <button key={action} type="button" disabled={disabled} onClick={() => run(action)}>{label}</button>)}</div>
      {dangerActions.some(([action]) => allowed(action)) ? <div className="favorite-library__batch-action-danger"><button type="button" className="favorite-library__disclosure-button" aria-expanded={dangerOpen} onClick={() => setDangerOpen((current) => !current)}>危险操作<Chevron /></button>{dangerOpen ? <div>{dangerActions.filter(([action]) => allowed(action)).map(([action, label]) => <button key={action} type="button" disabled={disabled} onClick={() => run(action)}>{label}</button>)}</div> : null}</div> : null}
    </div> : null}
  </div>
}

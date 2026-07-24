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
  filter?: FavoriteLibraryFilter
  sort?: FavoriteLibrarySort
  onSearchChange?: (query: string) => void
  onFilterChange?: (filter: FavoriteLibraryFilter) => void
  onSortChange?: (sort: FavoriteLibrarySort) => void
  children?: ReactNode
}

export function FavoriteLibraryToolbar({
  pageCount, selectedCount, allCurrentPageSelected, onTogglePage, onBatchAction, batchDisabled = false, allowedActions,
  searchQuery = '', filter = 'all', sort = 'updated-desc', onSearchChange, onFilterChange, onSortChange, children
}: FavoriteLibraryToolbarProps) {
  const selectLabel = '\u5168\u9009\u5f53\u524d\u9875'
  const selectText = `\u5168\u9009\u5f53\u524d\u9875\uff08${pageCount}\uff09`
  return <div className="favorite-library__toolbar" data-testid="favorite-library-toolbar">
    <input type="search" aria-label="搜索收藏库" placeholder="搜索标题、UP主或标签" value={searchQuery} onChange={(event) => onSearchChange?.(event.currentTarget.value)} />
    <select aria-label="筛选状态" value={filter} onChange={(event) => onFilterChange?.(event.currentTarget.value as FavoriteLibraryFilter)}><option value="all">全部状态</option><option value="pending">待处理</option><option value="protected">已保护</option><option value="unsynced">未同步</option></select>
    <select aria-label="排序方式" value={sort} onChange={(event) => onSortChange?.(event.currentTarget.value as FavoriteLibrarySort)}><option value="updated-desc">最近更新</option><option value="updated-asc">最早更新</option><option value="title-asc">标题 A-Z</option><option value="title-desc">标题 Z-A</option></select>
    <label className="favorite-library__select-page"><input type="checkbox" aria-label={selectLabel} checked={allCurrentPageSelected} disabled={!pageCount} onChange={onTogglePage} />{selectText}</label>
    <small>{`\u5df2\u9009 ${selectedCount} \u9879`}</small>
    <BatchActions disabled={batchDisabled} allowedActions={allowedActions} onAction={onBatchAction} />
    {children}
  </div>
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
  return <div className="favorite-library__batch-actions">
    <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>批量操作</button>
    {open ? <div className="favorite-library__batch-action-menu">
      <div><button type="button" disabled={disabled || !allowed('copy')} onClick={() => run('copy')}>复制至</button><button type="button" disabled={disabled || !allowed('move')} onClick={() => run('move')}>移动至</button><button type="button" disabled={disabled || !allowed('refresh')} onClick={() => run('refresh')}>刷新所选信息</button><button type="button" disabled={disabled || !allowed('transcribe')} onClick={() => run('transcribe')}>加入转写队列</button><button type="button" disabled={disabled || !allowed('sync')} onClick={() => run('sync')}>同步到B站</button></div>
      <div className="favorite-library__batch-action-danger"><button type="button" aria-expanded={dangerOpen} onClick={() => setDangerOpen((current) => !current)}>危险操作</button>{dangerOpen ? <div><button type="button" disabled={disabled || !allowed('delete-local')} onClick={() => run('delete-local')}>从收藏库删除</button><button type="button" disabled={disabled || !allowed('unfavorite-remote')} onClick={() => run('unfavorite-remote')}>取消B站收藏</button></div> : null}</div>
    </div> : null}
  </div>
}

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
  pageSize?: 25 | 50 | 100
  onPageSizeChange?: (pageSize: 25 | 50 | 100) => void
  children?: ReactNode
}

export function FavoriteLibraryToolbar({
  pageCount, selectedCount, allCurrentPageSelected, onTogglePage, onBatchAction, batchDisabled = false, allowedActions,
  searchQuery = '', filter = 'all', sort = 'updated-desc', onSearchChange, onFilterChange, onSortChange,
  pageSize = 50, onPageSizeChange, children
}: FavoriteLibraryToolbarProps) {
  const selectLabel = '\u5168\u9009\u5f53\u524d\u9875'
  const selectText = `\u5168\u9009\u5f53\u524d\u9875\uff08${pageCount}\uff09`
  return <div className="favorite-library__toolbar" data-testid="favorite-library-toolbar">
    <div className="favorite-library__toolbar-primary">
    <label className="favorite-library__select-page"><input type="checkbox" aria-label={selectLabel} checked={allCurrentPageSelected} disabled={!pageCount} onChange={onTogglePage} />{selectText}</label>
    <input type="search" aria-label="搜索收藏库" placeholder="搜索标题、UP主或标签" value={searchQuery} onChange={(event) => onSearchChange?.(event.currentTarget.value)} />
    <select aria-label="筛选状态" value={filter} onChange={(event) => onFilterChange?.(event.currentTarget.value as FavoriteLibraryFilter)}><option value="all">全部状态</option><option value="pending">待处理</option><option value="protected">已保护</option><option value="unsynced">未同步</option></select>
    <select aria-label="排序方式" value={sort} onChange={(event) => onSortChange?.(event.currentTarget.value as FavoriteLibrarySort)}><option value="updated-desc">最近更新</option><option value="updated-asc">最早更新</option><option value="title-asc">标题 A-Z</option><option value="title-desc">标题 Z-A</option></select>
    <BatchActions disabled={batchDisabled} allowedActions={allowedActions} onAction={onBatchAction} />
    </div>
    <div className="favorite-library__toolbar-secondary">
    <small>{`\u5df2\u9009 ${selectedCount} \u9879`}</small><span />
    <label className="favorite-library__page-size">每页<select aria-label="每页数量" value={pageSize} onChange={(event) => onPageSizeChange?.(Number(event.currentTarget.value) as 25 | 50 | 100)}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
    {children}
    </div>
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
  const commonActions: Array<[FavoriteLibraryBatchAction, string]> = [['copy', '复制至'], ['move', '移动至'], ['refresh', '刷新所选信息'], ['transcribe', '加入转写队列'], ['sync', '同步到B站']]
  const dangerActions: Array<[FavoriteLibraryBatchAction, string]> = [['delete-local', '从收藏库删除'], ['unfavorite-remote', '取消B站收藏']]
  return <div className="favorite-library__batch-actions">
    <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>批量操作</button>
    {open ? <div className="favorite-library__batch-action-menu">
      <div>{commonActions.filter(([action]) => allowed(action)).map(([action, label]) => <button key={action} type="button" disabled={disabled} onClick={() => run(action)}>{label}</button>)}</div>
      {dangerActions.some(([action]) => allowed(action)) ? <div className="favorite-library__batch-action-danger"><button type="button" aria-expanded={dangerOpen} onClick={() => setDangerOpen((current) => !current)}>危险操作</button>{dangerOpen ? <div>{dangerActions.filter(([action]) => allowed(action)).map(([action, label]) => <button key={action} type="button" disabled={disabled} onClick={() => run(action)}>{label}</button>)}</div> : null}</div> : null}
    </div> : null}
  </div>
}

import { useState, type ReactNode } from 'react'

export type FavoriteLibraryBatchAction = 'copy' | 'move' | 'refresh' | 'transcribe' | 'sync' | 'delete-local' | 'unfavorite-remote'

type FavoriteLibraryToolbarProps = {
  pageCount: number
  selectedCount: number
  allCurrentPageSelected: boolean
  onTogglePage: () => void
  onBatchAction?: (action: FavoriteLibraryBatchAction) => void
  batchDisabled?: boolean
  allowedActions?: FavoriteLibraryBatchAction[]
  children?: ReactNode
}

export function FavoriteLibraryToolbar({
  pageCount, selectedCount, allCurrentPageSelected, onTogglePage, onBatchAction, batchDisabled = false, allowedActions, children
}: FavoriteLibraryToolbarProps) {
  const selectLabel = '\u5168\u9009\u5f53\u524d\u9875'
  const selectText = `\u5168\u9009\u5f53\u524d\u9875\uff08${pageCount}\uff09`
  return <div className="favorite-library__toolbar" data-testid="favorite-library-toolbar">
    <label className="favorite-library__select-page"><input type="checkbox" aria-label={selectLabel} checked={allCurrentPageSelected} disabled={!pageCount} onChange={onTogglePage} />{selectText}</label>
    <small>{`\u5df2\u9009 ${selectedCount} \u9879`}</small>
    <BatchActions disabled={batchDisabled} allowedActions={allowedActions} onAction={onBatchAction} />
    {children}
  </div>
}

function BatchActions({ disabled, allowedActions, onAction }: { disabled: boolean; allowedActions?: FavoriteLibraryBatchAction[]; onAction?: (action: FavoriteLibraryBatchAction) => void }) {
  const [open, setOpen] = useState(false)
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
      <div className="favorite-library__batch-action-danger"><button type="button" disabled={disabled || !allowed('delete-local')} onClick={() => run('delete-local')}>从收藏库删除</button><button type="button" disabled={disabled || !allowed('unfavorite-remote')} onClick={() => run('unfavorite-remote')}>取消B站收藏</button></div>
    </div> : null}
  </div>
}

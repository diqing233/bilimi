import type { ReactNode } from 'react'

type FavoriteLibraryDetailProps = {
  title?: string
  onCollapse: (collapsed: boolean) => void
  collapsed?: boolean
  onRestore?: () => void
  children?: ReactNode
}

export function FavoriteLibraryDetail({ title, onCollapse, collapsed = false, onRestore, children }: FavoriteLibraryDetailProps) {
  if (collapsed) return <aside className="favorite-library__detail-restore" aria-label="视频详情已收起">
    <button type="button" onClick={onRestore}>恢复视频详情</button>
  </aside>
  if (!title) return <aside className="favorite-library__detail favorite-library__detail-empty" aria-label={'\u89c6\u9891\u8be6\u60c5'}>
    <p>选择一个视频查看详情</p>
  </aside>
  return <aside className="favorite-library__detail" aria-label={'\u89c6\u9891\u8be6\u60c5'} data-detail-visible="true">
    <button type="button" onClick={() => onCollapse(true)}>收起详情</button>
    <div className="favorite-library__detail-heading"><h2>{title}</h2></div>
    {children}
  </aside>
}

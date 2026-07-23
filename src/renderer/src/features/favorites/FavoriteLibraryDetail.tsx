import type { ReactNode } from 'react'

type FavoriteLibraryDetailProps = {
  title: string
  onCollapse: (collapsed: boolean) => void
  children?: ReactNode
}

export function FavoriteLibraryDetail({ title, onCollapse, children }: FavoriteLibraryDetailProps) {
  return <aside className="favorite-library__detail" aria-label="\u89c6\u9891\u8be6\u60c5" data-detail-visible="true">
    <button type="button" onClick={() => onCollapse(true)}>\u6536\u8d77\u8be6\u60c5</button>
    <div className="favorite-library__detail-heading"><h2>{title}</h2></div>
    {children}
  </aside>
}

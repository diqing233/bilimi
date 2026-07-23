import { useState } from 'react'

export type FavoriteLibraryNavigationItem = {
  id: string
  label: string
  count: number
  managed?: boolean
  protected?: boolean
}

export type FavoriteLibraryNavigationGroup = {
  id: string
  label: string
  items: FavoriteLibraryNavigationItem[]
}

type FavoriteLibraryNavigationProps = {
  uid?: string
  groups: FavoriteLibraryNavigationGroup[]
  collapsedGroups: Record<string, boolean>
  selectedId: string
  onCollapseChange: (uid: string, groupId: string, collapsed: boolean) => void
  onSelect: (id: string) => void
  onManagedFolderMenu?: (id: string) => void
  onManagedFolderAction?: (id: string, action: 'edit' | 'delete') => void
}

export function FavoriteLibraryNavigation({
  uid = '', groups, collapsedGroups, selectedId, onCollapseChange, onSelect, onManagedFolderMenu, onManagedFolderAction
}: FavoriteLibraryNavigationProps) {
  return <nav className="favorite-library__navigation-groups" aria-label="\u6536\u85cf\u5939\u5bfc\u822a">
    {groups.map((group) => {
      const collapsed = Boolean(collapsedGroups[group.id])
      return <section className="favorite-library__navigation-group" key={group.id} data-group-id={group.id}>
        <button
          type="button"
          className="favorite-library__navigation-group-toggle"
          aria-expanded={!collapsed}
          onClick={() => onCollapseChange(uid, group.id, !collapsed)}
        >{group.label}</button>
        {!collapsed ? group.items.map((item) => <div className="favorite-library__navigation-row" key={item.id}>
          <button type="button" aria-label={item.id === 'all' || item.id.startsWith('folder:') ? item.label : undefined} aria-current={selectedId === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)}>
            {`${item.label} ${item.count}`}
          </button>
          {item.managed && !item.protected ? <ManagedFolderMenu item={item} onOpen={onManagedFolderMenu} onAction={onManagedFolderAction} /> : null}
        </div>) : null}
      </section>
    })}
  </nav>
}

function ManagedFolderMenu({
  item,
  onOpen,
  onAction
}: {
  item: FavoriteLibraryNavigationItem
  onOpen?: (id: string) => void
  onAction?: (id: string, action: 'edit' | 'delete') => void
}) {
  const [open, setOpen] = useState(false)
  return <span className="favorite-library__folder-menu-wrap">
    <button type="button" className="favorite-library__folder-menu" aria-label={`${item.label} 菜单`} aria-expanded={open} onClick={() => {
      setOpen((current) => !current)
      onOpen?.(item.id)
    }}>...</button>
    {open ? <span className="favorite-library__folder-menu-items">
      <button type="button" onClick={() => onAction?.(item.id, 'edit')}>编辑信息</button>
      <button type="button" onClick={() => onAction?.(item.id, 'delete')}>删除</button>
    </span> : null}
  </span>
}

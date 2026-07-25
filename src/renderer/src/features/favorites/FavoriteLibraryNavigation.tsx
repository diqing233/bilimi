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
    {groups.map((group, index) => {
      const fixed = group.id === 'range'
      const collapsed = Boolean(collapsedGroups[group.id])
      return <section className={`favorite-library__navigation-group${index ? ' favorite-library__navigation-group--separated' : ''}${fixed ? ' favorite-library__navigation-group--fixed' : ''}`} key={group.id} data-group-id={group.id}>
        {fixed ? null : <div className="favorite-library__navigation-group-heading">
          <button
            type="button"
            className="favorite-library__navigation-group-toggle"
            aria-label={`${collapsed ? '展开' : '收起'}${group.label}`}
            aria-expanded={!collapsed}
            onClick={() => onCollapseChange(uid, group.id, !collapsed)}
          ><span className="favorite-library__navigation-group-label">{group.label}</span><Chevron /></button>
        </div>}
        {(fixed || !collapsed) ? group.items.map((item) => <div className={`favorite-library__navigation-row${item.managed && !item.protected ? ' favorite-library__navigation-row--managed' : ''}`} key={item.id}>
          <button type="button" aria-label={item.id === 'all' || item.id.startsWith('folder:') ? item.label : undefined} aria-current={selectedId === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)}>
            <span>{item.label}</span>{' '}<span className="favorite-library__navigation-count">{item.count}</span>
          </button>
          {item.managed && !item.protected ? <ManagedFolderMenu item={item} onOpen={onManagedFolderMenu} onAction={onManagedFolderAction} /> : null}
        </div>) : null}
      </section>
    })}
  </nav>
}

function Chevron() {
  return <svg className="favorite-library__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
  const show = () => {
    setOpen(true)
    onOpen?.(item.id)
  }
  return <span className="favorite-library__folder-menu-wrap" onPointerEnter={show} onPointerLeave={() => setOpen(false)} onFocus={show} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button type="button" className="favorite-library__folder-menu" aria-label={`${item.label} 菜单`} aria-expanded={open} onClick={show}>{String.fromCodePoint(0x22ee)}</button>
    {open ? <span className="favorite-library__folder-menu-items" role="menu" aria-label={`${item.label} 操作`}>
      <button type="button" onClick={() => onAction?.(item.id, 'edit')}>编辑信息</button>
      <button type="button" onClick={() => onAction?.(item.id, 'delete')}>删除</button>
    </span> : null}
  </span>
}

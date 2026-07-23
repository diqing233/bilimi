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
}

export function FavoriteLibraryNavigation({
  uid = '', groups, collapsedGroups, selectedId, onCollapseChange, onSelect, onManagedFolderMenu
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
          {item.managed && !item.protected ? <button
            type="button"
            className="favorite-library__folder-menu"
            aria-label={`${item.label} \u83dc\u5355`}
            onClick={() => onManagedFolderMenu?.(item.id)}
          >...</button> : null}
        </div>) : null}
      </section>
    })}
  </nav>
}

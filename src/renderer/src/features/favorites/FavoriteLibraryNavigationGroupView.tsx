import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FavoriteLibraryNavigationGroup } from './FavoriteLibraryNavigation'

type FavoriteLibraryNavigationGroupViewProps = {
  group: FavoriteLibraryNavigationGroup
  separated: boolean
  collapsed: boolean
  selectedId: string
  onToggle: (groupId: string, collapsed: boolean) => void
  workspaceMenuResetKey: string
  renderWorkspaceMenu: (resetKey: string) => ReactNode
  renderOrdinaryGroupMenu: ReactNode
  renderManagedMenu: (item: FavoriteLibraryNavigationGroup['items'][number], active: boolean) => ReactNode
  onSelect: (id: string) => void | boolean | Promise<void | boolean>
}

export const FavoriteLibraryNavigationGroupView = memo(function FavoriteLibraryNavigationGroupView({
  group, separated, collapsed, selectedId, onToggle, workspaceMenuResetKey, renderWorkspaceMenu, renderOrdinaryGroupMenu, renderManagedMenu, onSelect
}: FavoriteLibraryNavigationGroupViewProps) {
  const fixed = group.id === 'range'
  const aggregate = useMemo(() => {
    const titleItems = group.items
    return {
      folderCount: titleItems.length,
      groupVideoCount: group.videoCount ?? new Set(titleItems.flatMap((item) => item.aids ?? [])).size,
      placementCount: titleItems.reduce((total, item) => total + (item.aids?.length ?? item.count), 0)
    }
  }, [group])
  const folderKind = group.id === 'workspace' ? '\u5de5\u4f5c\u5939' : '\u6536\u85cf\u5939'
  const itemsRef = useRef<HTMLDivElement>(null)
  const rowHeight = 30
  const windowSize = 48
  const [windowStart, setWindowStart] = useState(0)
  useEffect(() => {
    if (collapsed || group.items.length <= windowSize) return
    const root = itemsRef.current?.closest('.favorite-library__navigation-groups') as HTMLElement | null
    const items = itemsRef.current
    if (!root || !items) return
    const update = () => {
      const rootRect = root.getBoundingClientRect()
      const itemsRect = items.getBoundingClientRect()
      const offset = Math.max(0, rootRect.top - itemsRect.top)
      const next = Math.max(0, Math.min(group.items.length - windowSize, Math.floor(offset / rowHeight) - 8))
      setWindowStart((current) => current === next ? current : next)
    }
    update()
    root.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      root.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [collapsed, group.items.length])
  const visibleItems = useMemo(() => group.items.length <= windowSize
    ? group.items
    : group.items.slice(windowStart, windowStart + windowSize), [group.items, windowStart])
  return <section className={`favorite-library__navigation-group${separated ? ' favorite-library__navigation-group--separated' : ''}${fixed ? ' favorite-library__navigation-group--fixed' : ''}`} data-group-id={group.id}>
    {fixed ? null : <div className={`favorite-library__navigation-group-heading${group.id === 'workspace' ? ' favorite-library__navigation-group-heading--workspace' : ''}`}>
      <button type="button" className="favorite-library__navigation-group-toggle" aria-label={`${collapsed ? '\u5c55\u5f00' : '\u6536\u8d77'}${group.label}`} aria-expanded={!collapsed}
        title={`\u5171 ${aggregate.folderCount} \u4e2a${folderKind}\n\u5171 ${aggregate.placementCount} \u6761\u6536\u85cf\u5f52\u5c5e\n\u53bb\u91cd\u540e ${aggregate.groupVideoCount} \u4e2a\u89c6\u9891`} onClick={() => onToggle(group.id, !collapsed)}>
        <span className="favorite-library__navigation-group-label">{group.label}</span><Chevron />
      </button>
      <span className="favorite-library__navigation-trailing-slot">{group.id === 'workspace' ? renderWorkspaceMenu(workspaceMenuResetKey) : renderOrdinaryGroupMenu}</span>
    </div>}
    {(fixed || !collapsed) ? <div ref={itemsRef} className={`favorite-library__navigation-items${group.items.length > windowSize ? ' favorite-library__navigation-items--virtual' : ''}`} style={group.items.length > windowSize ? { height: `${group.items.length * rowHeight}px`, position: 'relative' } : undefined}>
      {visibleItems.map((item, index) => <div className={`favorite-library__navigation-row${group.id === 'workspace' ? ' favorite-library__navigation-row--managed favorite-library__navigation-row--menu' : ''}`} style={group.items.length > windowSize ? { position: 'absolute', top: `${(windowStart + index) * rowHeight}px`, left: 0, right: 0, height: `${rowHeight}px` } : undefined} key={item.id}>
        <button type="button" aria-label={item.id === 'all' || item.id.startsWith('folder:') ? item.label : undefined} aria-current={selectedId === item.id ? 'page' : undefined} title={item.id === 'all' ? `\u5171 ${item.count} \u4e2a\u53bb\u91cd\u89c6\u9891` : item.label} onClick={() => onSelect(item.id)}><span>{item.label}</span></button>
        <span className="favorite-library__navigation-trailing-slot"><span className="favorite-library__navigation-count">{item.count}</span>
          {group.id === 'workspace' ? renderManagedMenu(item, !collapsed) : null}
        </span>
      </div>)}
    </div> : null}
  </section>
}, (previous, next) =>
  previous.group === next.group &&
  previous.separated === next.separated &&
  previous.collapsed === next.collapsed &&
  previous.selectedId === next.selectedId &&
  previous.workspaceMenuResetKey === next.workspaceMenuResetKey &&
  previous.onToggle === next.onToggle &&
  previous.onSelect === next.onSelect &&
  previous.renderWorkspaceMenu === next.renderWorkspaceMenu &&
  previous.renderManagedMenu === next.renderManagedMenu)

function Chevron() {
  return <svg className="favorite-library__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

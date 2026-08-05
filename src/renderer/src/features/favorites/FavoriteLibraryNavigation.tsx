import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { startTransition } from 'react'
import { useSyncExternalStore } from 'react'
import { FavoriteLibraryNavigationGroupView } from './FavoriteLibraryNavigationGroupView'

export type FavoriteLibraryNavigationItem = {
  id: string
  label: string
  count: number
  /** Optional per-folder membership used only to calculate a de-duplicated workspace total. */
  aids?: readonly number[]
  managed?: boolean
  protected?: boolean
  removable?: boolean
}

export type FavoriteLibraryNavigationGroup = {
  id: string
  label: string
  items: FavoriteLibraryNavigationItem[]
  count?: number
  videoCount?: number
}

type FavoriteLibraryNavigationProps = {
  uid?: string
  groups: FavoriteLibraryNavigationGroup[]
  collapsedGroups: Record<string, boolean>
  selectedId: string
  onCollapseChange: (uid: string, groupId: string, collapsed: boolean) => void
  onSelect: (id: string) => void | boolean | Promise<void | boolean>
  onManagedFolderMenu?: (id: string) => void
  onManagedFolderAction?: (id: string, action: 'edit' | 'delete') => void
  onOrdinaryFolderRemove?: (id: string) => void
  onOrdinaryGroupAction?: (action: 'delete-all') => void
  onWorkspaceAction?: (action: 'create' | 'sync-all' | 'delete-all') => void
}

export function FavoriteLibraryNavigation({
  uid = '', groups, collapsedGroups, selectedId, onCollapseChange, onSelect, onManagedFolderMenu, onManagedFolderAction, onOrdinaryFolderRemove, onOrdinaryGroupAction, onWorkspaceAction
}: FavoriteLibraryNavigationProps) {
  const managedFolderMenuRef = useRef(onManagedFolderMenu)
  const managedFolderActionRef = useRef(onManagedFolderAction)
  const workspaceActionRef = useRef(onWorkspaceAction)
  const ordinaryFolderRemoveRef = useRef(onOrdinaryFolderRemove)
  const ordinaryGroupActionRef = useRef(onOrdinaryGroupAction)
  const onSelectRef = useRef(onSelect)
  managedFolderMenuRef.current = onManagedFolderMenu
  managedFolderActionRef.current = onManagedFolderAction
  workspaceActionRef.current = onWorkspaceAction
  ordinaryFolderRemoveRef.current = onOrdinaryFolderRemove
  ordinaryGroupActionRef.current = onOrdinaryGroupAction
  onSelectRef.current = onSelect
  const handleManagedFolderMenu = useCallback((id: string) => managedFolderMenuRef.current?.(id), [])
  const handleManagedFolderAction = useCallback((id: string, action: 'edit' | 'delete') => managedFolderActionRef.current?.(id, action), [])
  const handleWorkspaceAction = useCallback((action: 'create' | 'sync-all' | 'delete-all') => workspaceActionRef.current?.(action), [])
  const handleOrdinaryFolderRemove = useCallback((id: string) => ordinaryFolderRemoveRef.current?.(id), [])
  const handleOrdinaryGroupAction = useCallback((action: 'delete-all') => ordinaryGroupActionRef.current?.(action), [])
  const renderWorkspaceMenu = useCallback((resetKey: string) => <WorkspaceFloatingMenu onAction={handleWorkspaceAction} resetKey={resetKey} />, [handleWorkspaceAction])
  const managedMenuIdStoreRef = useRef<{
    value?: string
    listeners: Map<string, Set<() => void>>
    set: (value?: string) => void
  } | null>(null)
  if (!managedMenuIdStoreRef.current) {
    const store = {
      value: undefined as string | undefined,
      listeners: new Map<string, Set<() => void>>(),
      set(value?: string) {
        if (store.value === value) return
        const previous = store.value
        store.value = value
        if (previous) store.listeners.get(previous)?.forEach((listener) => listener())
        if (value) store.listeners.get(value)?.forEach((listener) => listener())
      }
    }
    managedMenuIdStoreRef.current = store
  }
  const managedMenuIdStore = managedMenuIdStoreRef.current
  const [managedMenu, setManagedMenu] = useState<{ item: FavoriteLibraryNavigationItem; trigger: HTMLButtonElement }>()
  const managedMenuRef = useRef(managedMenu)
  managedMenuRef.current = managedMenu
  const closeManagedMenu = useCallback(() => {
    managedMenuIdStore.set(undefined)
    setManagedMenu(undefined)
  }, [managedMenuIdStore])
  const renderManagedMenu = useCallback((item: FavoriteLibraryNavigationItem) => <ManagedFolderMenuTrigger
    activeIdStore={managedMenuIdStore}
    item={item}
    onToggle={(trigger) => {
      if (managedMenuRef.current?.item.id === item.id) closeManagedMenu()
      else {
        managedMenuIdStore.set(item.id)
        setManagedMenu({ item, trigger })
        handleManagedFolderMenu(item.id)
      }
    }}
  />, [closeManagedMenu, handleManagedFolderMenu, managedMenuIdStore])
  const [localCollapsedGroups, setLocalCollapsedGroups] = useState(collapsedGroups)
  const [localSelectedId, setLocalSelectedId] = useState(selectedId)
  const selectionAttemptRef = useRef(0)
  useEffect(() => setLocalCollapsedGroups(collapsedGroups), [collapsedGroups, uid])
  useEffect(() => setLocalSelectedId(selectedId), [selectedId, uid])
  useEffect(() => closeManagedMenu(), [closeManagedMenu, uid])
  const toggleGroup = useCallback((groupId: string, collapsed: boolean) => {
    setLocalCollapsedGroups((current) => ({ ...current, [groupId]: collapsed }))
    if (collapsed && groupId === 'workspace') closeManagedMenu()
    onCollapseChange(uid, groupId, collapsed)
  }, [closeManagedMenu, onCollapseChange, uid])
  const select = useCallback((id: string) => {
    const attempt = ++selectionAttemptRef.current
    const confirmedId = selectedId
    setLocalSelectedId(id)
    startTransition(() => {
      void Promise.resolve(onSelectRef.current(id)).then((accepted) => {
        if (attempt === selectionAttemptRef.current && accepted === false) setLocalSelectedId(confirmedId)
      }).catch(() => {
        if (attempt === selectionAttemptRef.current) setLocalSelectedId(confirmedId)
      })
    })
  }, [selectedId])
  return <><nav className="favorite-library__navigation-groups" aria-label="\u6536\u85cf\u5939\u5bfc\u822a">
    {groups.map((group, index) => <FavoriteLibraryNavigationGroupView
      key={group.id}
      group={group}
      separated={index > 0}
      collapsed={Boolean(localCollapsedGroups[group.id])}
      selectedId={localSelectedId}
      onToggle={toggleGroup}
      onSelect={select}
      workspaceMenuResetKey={`${uid}:${Boolean(localCollapsedGroups[group.id])}`}
      renderWorkspaceMenu={renderWorkspaceMenu}
      renderOrdinaryGroupMenu={group.id === 'bilibili' ? <OrdinaryGroupFloatingMenu onAction={handleOrdinaryGroupAction} /> : null}
      renderManagedMenu={renderManagedMenu}
      onOrdinaryFolderRemove={handleOrdinaryFolderRemove}
    />)}
  </nav>{managedMenu && typeof document !== 'undefined' ? createPortal(<SharedManagedFolderMenu
    item={managedMenu.item}
    trigger={managedMenu.trigger}
    onClose={closeManagedMenu}
    onAction={handleManagedFolderAction}
  />, document.body) : null}</>
}
function OrdinaryGroupFloatingMenu({ onAction }: { onAction: (action: 'delete-all') => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties>()
  const close = useCallback(() => { triggerRef.current?.focus(); setOpen(false) }, [])
  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ top: `${rect.bottom + 6}px`, left: `${Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 180 - 8))}px` })
  }, [])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    reposition(); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [close, open, reposition])
  return <span className="favorite-library__folder-menu-wrap">
    <button ref={triggerRef} type="button" className="favorite-library__folder-menu favorite-library__ordinary-group-menu" aria-label="其他收藏夹管理菜单" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{String.fromCodePoint(0x22ee)}</button>
    {open && typeof document !== 'undefined' ? createPortal(<div ref={menuRef} role="menu" aria-label="其他收藏夹操作" className="favorite-library__workspace-floating-menu" style={position}><button role="menuitem" type="button" className="favorite-library__danger-action" onClick={() => { close(); onAction('delete-all') }}>全部从收藏库删除</button></div>, document.body) : null}
  </span>
}
function WorkspaceFloatingMenu({ onAction, resetKey }: { onAction?: (action: 'create' | 'sync-all' | 'delete-all') => void; resetKey: string }) {
  const [open, setOpen] = useState(false)
  const previousResetKey = useRef(resetKey)
  const [position, setPosition] = useState<CSSProperties>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const menuLabel = `bilimi ${String.fromCodePoint(0x5de5, 0x4f5c, 0x5939, 0x64cd, 0x4f5c)}`
  useEffect(() => {
    const [previousUid, previousCollapsed] = previousResetKey.current.split(':')
    const [nextUid, nextCollapsed] = resetKey.split(':')
    const accountChanged = Boolean(previousUid && nextUid && previousUid !== nextUid)
    const groupCollapsed = previousUid === nextUid && previousCollapsed !== nextCollapsed
    if (accountChanged || groupCollapsed) setOpen(false)
    previousResetKey.current = resetKey
  }, [resetKey])
  const reposition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const triggerRect = trigger.getBoundingClientRect()
    const width = 180
    const maxLeft = Math.max(8, window.innerWidth - width - 8)
    const left = Math.min(Math.max(8, triggerRect.left + triggerRect.width / 2 - width / 2), maxLeft)
    setPosition({ top: `${triggerRect.bottom + 6}px`, left: `${left}px` })
  }, [])

  useEffect(() => {
    if (!open) return
    const closeAndRestoreFocus = () => {
      triggerRef.current?.focus()
      setOpen(false)
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) closeAndRestoreFocus()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAndRestoreFocus() }
    reposition()
    firstActionRef.current?.focus()
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reposition)
    if (triggerRef.current) observer?.observe(triggerRef.current)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      observer?.disconnect()
    }
  }, [open, reposition])

  const run = (action: 'create' | 'sync-all' | 'delete-all') => {
    triggerRef.current?.focus()
    setOpen(false)
    onAction?.(action)
  }
  const floatingMenu = open ? <div ref={menuRef} role="menu" aria-label={menuLabel} className="favorite-library__workspace-floating-menu" style={position}>
    <button ref={firstActionRef} role="menuitem" type="button" onClick={() => run('create')}>{'\u65b0\u5efa\u5de5\u4f5c\u5939'}</button>
    <button role="menuitem" type="button" onClick={() => run('sync-all')}>{'\u540c\u6b65\u5168\u90e8\u5de5\u4f5c\u5939'}</button>
    <hr />
    <button role="menuitem" type="button" className="favorite-library__danger-action" onClick={() => run('delete-all')}>{'\u5220\u9664\u5168\u90e8\u5de5\u4f5c\u5939'}</button>
  </div> : null
  return <span className="favorite-library__folder-menu-wrap">
    <button ref={triggerRef} type="button" className="favorite-library__folder-menu favorite-library__workspace-menu" aria-label={'bilimi \u5de5\u4f5c\u5939\u7ba1\u7406\u83dc\u5355'} aria-expanded={open} onClick={() => setOpen((current) => !current)}>{String.fromCodePoint(0x22ee)}</button>
    {typeof document === 'undefined' ? null : createPortal(floatingMenu, document.body)}
  </span>
}

function ManagedFolderMenuTrigger({
  activeIdStore,
  item,
  onToggle
}: {
  activeIdStore: { value?: string; listeners: Map<string, Set<() => void>> }
  item: FavoriteLibraryNavigationItem
  onToggle: (trigger: HTMLButtonElement) => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const active = useSyncExternalStore(
    (listener) => {
      const listeners = activeIdStore.listeners.get(item.id) ?? new Set<() => void>()
      listeners.add(listener)
      activeIdStore.listeners.set(item.id, listeners)
      return () => {
        listeners.delete(listener)
        if (!listeners.size) activeIdStore.listeners.delete(item.id)
      }
    },
    () => activeIdStore.value === item.id,
    () => false
  )
  return <span className="favorite-library__folder-menu-wrap">
    <button ref={triggerRef} type="button" className="favorite-library__folder-menu" aria-label={`${item.label} \u83dc\u5355`} aria-expanded={active} onClick={() => {
      if (triggerRef.current) onToggle(triggerRef.current)
    }}>{String.fromCodePoint(0x22ee)}</button>
  </span>
}

function SharedManagedFolderMenu({ item, trigger, onClose, onAction }: {
  item: FavoriteLibraryNavigationItem
  trigger: HTMLButtonElement
  onClose: () => void
  onAction?: (id: string, action: 'edit' | 'delete') => void
}) {
  const [position, setPosition] = useState<CSSProperties>()
  const menuRef = useRef<HTMLDivElement>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const reposition = useCallback(() => {
    if (!trigger.isConnected) {
      onClose()
      return
    }
    const triggerRect = trigger.getBoundingClientRect()
    const width = 132
    const maxLeft = Math.max(8, window.innerWidth - width - 8)
    const left = Math.min(Math.max(8, triggerRect.left + triggerRect.width / 2 - width / 2), maxLeft)
    setPosition({ top: `${triggerRect.bottom + 6}px`, left: `${left}px` })
  }, [trigger])
  const closeAndRestoreFocus = useCallback(() => {
    trigger.focus()
    onClose()
  }, [onClose, trigger])
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!trigger.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) closeAndRestoreFocus()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAndRestoreFocus() }
    reposition()
    firstActionRef.current?.focus()
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reposition)
    observer?.observe(trigger)
    const removalObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => {
      if (!trigger.isConnected) onClose()
    })
    removalObserver?.observe(document.body, { childList: true, subtree: true })
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      observer?.disconnect()
      removalObserver?.disconnect()
    }
  }, [closeAndRestoreFocus, reposition, trigger])
  const run = (action: 'edit' | 'delete') => {
    closeAndRestoreFocus()
    onAction?.(item.id, action)
  }
  return <div ref={menuRef} className="favorite-library__folder-floating-menu" role="menu" aria-label={`${item.label} \u64cd\u4f5c`} style={position}>
    <button ref={firstActionRef} role="menuitem" type="button" onClick={() => run('edit')}>{'\u7f16\u8f91\u4fe1\u606f'}</button>
    <button role="menuitem" type="button" className="favorite-library__danger-action" onClick={() => run('delete')}>{item.removable ? '\u4ece\u6536\u85cf\u5e93\u5220\u9664' : '\u5220\u9664'}</button>
  </div>
}

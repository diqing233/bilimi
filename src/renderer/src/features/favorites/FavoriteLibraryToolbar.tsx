import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { VideoSummaryMenu } from '../notes/VideoSummaryMenu'

export type FavoriteLibraryBatchAction = 'copy' | 'move' | 'refresh' | 'reorganize' | 'transcribe' | 'cancel-transcribe' | 'download-documents' | 'sync' | 'delete-local' | 'remove-managed-placement'
export type FavoriteLibraryFilter = 'all' | 'pending' | 'protected' | 'unsynced'
export type FavoriteLibrarySort = 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc'
export type FavoriteLibraryTranscriptionFilter = 'completed' | 'none' | 'pending' | 'running' | 'failed'

const TRANSCRIPTION_MENU_WIDTH = 164
const DESTINATION_ROW_HEIGHT = 30
const DESTINATION_WINDOW_SIZE = 40

function FavoriteLibraryDestinationList({ logicalFolders, destinationIds, onToggle, focusFirst }: {
  logicalFolders: Array<{ id: string; title: string }>
  destinationIds: string[]
  onToggle: (folderId: string) => void
  focusFirst?: boolean
}) {
  const [start, setStart] = useState(0)
  const pendingFocusIndexRef = useRef<number | undefined>(undefined)
  const focusTargetsRef = useRef(new Map<number, HTMLLabelElement>())
  const virtual = logicalFolders.length > DESTINATION_WINDOW_SIZE
  const visible = virtual ? logicalFolders.slice(start, start + DESTINATION_WINDOW_SIZE) : logicalFolders
  useEffect(() => {
    const pending = pendingFocusIndexRef.current
    if (pending === undefined) return
    const target = focusTargetsRef.current.get(pending)
    if (!target) return
    pendingFocusIndexRef.current = undefined
    target.focus()
  }, [start])
  useEffect(() => {
    if (focusFirst) focusTargetsRef.current.get(0)?.focus()
  }, [focusFirst])
  return <div className="favorite-library__batch-destination-scroll" onScroll={virtual ? (event) => {
    const next = Math.max(0, Math.min(logicalFolders.length - DESTINATION_WINDOW_SIZE, Math.floor(event.currentTarget.scrollTop / DESTINATION_ROW_HEIGHT) - 5))
    setStart((current) => current === next ? current : next)
  } : undefined}>
    <div style={virtual ? { height: `${logicalFolders.length * DESTINATION_ROW_HEIGHT}px`, position: 'relative' } : undefined}>
      {visible.map((folder, index) => {
        const absoluteIndex = start + index
        return <label ref={(element) => { if (element) focusTargetsRef.current.set(absoluteIndex, element); else focusTargetsRef.current.delete(absoluteIndex) }} role="menuitemcheckbox" aria-label={folder.title} aria-checked={destinationIds.includes(folder.id)} tabIndex={0} key={folder.id} style={virtual ? { position: 'absolute', top: `${absoluteIndex * DESTINATION_ROW_HEIGHT}px`, left: 0, right: 0, height: `${DESTINATION_ROW_HEIGHT}px` } : undefined} onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault()
            onToggle(folder.id)
            return
          }
          const nextIndex = event.key === 'End' ? logicalFolders.length - 1 : event.key === 'Home' ? 0 : event.key === 'ArrowDown' ? Math.min(logicalFolders.length - 1, absoluteIndex + 1) : event.key === 'ArrowUp' ? Math.max(0, absoluteIndex - 1) : undefined
          if (nextIndex === undefined) return
          event.preventDefault()
          pendingFocusIndexRef.current = nextIndex
          const nextStart = Math.max(0, Math.min(logicalFolders.length - DESTINATION_WINDOW_SIZE, nextIndex - Math.floor(DESTINATION_WINDOW_SIZE / 2)))
          if (nextStart === start) {
            pendingFocusIndexRef.current = undefined
            focusTargetsRef.current.get(nextIndex)?.focus()
          } else setStart(nextStart)
        }}><input type="checkbox" tabIndex={-1} aria-hidden="true" checked={destinationIds.includes(folder.id)} onChange={() => onToggle(folder.id)} />{folder.title}</label>
      })}
    </div>
  </div>
}

type FavoriteLibraryToolbarProps = {
  pageCount: number
  selectedCount: number
  allCurrentPageSelected: boolean
  onTogglePage: () => void
  onBatchAction?: (action: FavoriteLibraryBatchAction) => void
  onBatchDownload?: () => void
  batchDisabled?: boolean
  disabledActions?: FavoriteLibraryBatchAction[]
  allowedActions?: FavoriteLibraryBatchAction[]
  logicalFolders?: Array<{ id: string; title: string }>
  onBatchPlacement?: (action: 'copy' | 'move', folderIds: string[]) => void
  searchQuery?: string
  onSearchChange?: (query: string) => void
  deferSearchChange?: boolean
  browsingOnly?: boolean
  children?: ReactNode
}

export function FavoriteLibraryToolbar({
  pageCount, selectedCount, allCurrentPageSelected, onTogglePage, onBatchAction, onBatchDownload, batchDisabled = false, disabledActions, allowedActions, logicalFolders, onBatchPlacement,
  searchQuery = '', onSearchChange, deferSearchChange = false, browsingOnly = false, children
}: FavoriteLibraryToolbarProps) {
  const [searchDraft, setSearchDraft] = useState(searchQuery)
  const searchCommitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => setSearchDraft(searchQuery), [searchQuery])
  useEffect(() => () => {
    if (searchCommitTimerRef.current) clearTimeout(searchCommitTimerRef.current)
  }, [])
  const updateSearch = (query: string) => {
    setSearchDraft(query)
    if (!deferSearchChange) {
      onSearchChange?.(query)
      return
    }
    if (searchCommitTimerRef.current) clearTimeout(searchCommitTimerRef.current)
    searchCommitTimerRef.current = setTimeout(() => onSearchChange?.(query), 200)
  }
  return <div className="favorite-library__toolbar" data-testid="favorite-library-toolbar">
    <div className="favorite-library__toolbar-primary">
      {!browsingOnly ? <span className="favorite-library__selection-controls"><label className="favorite-library__select-page"><input type="checkbox" aria-label="全选" checked={allCurrentPageSelected} disabled={!pageCount} onChange={onTogglePage} />全选</label>
      <small className="favorite-library__selection-summary">{`已选 ${selectedCount} 项`}</small></span> : null}
      <input type="search" aria-label="搜索收藏库" placeholder="搜索标题、UP主或标签" value={searchDraft} onChange={(event) => updateSearch(event.currentTarget.value)} />
    </div>
    {!browsingOnly ? <BatchActions disabled={batchDisabled} disabledActions={disabledActions} allowedActions={allowedActions} onAction={onBatchAction} onDownload={onBatchDownload} logicalFolders={logicalFolders} onBatchPlacement={onBatchPlacement} /> : null}
    {children}
  </div>
}

export function FavoriteLibraryColumnMenu<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  return <span className="favorite-library__column-menu">
    <button type="button" className="favorite-library__column-menu-trigger" aria-label={label} aria-expanded={open} onClick={() => setOpen((currentOpen) => !currentOpen)}><Chevron /></button>
    {open ? <span role="menu" className="favorite-library__column-menu-options">{options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} onClick={() => { onChange(option.value); setOpen(false) }}>{option.label}</button>)}</span> : null}
  </span>
}

export type FavoriteLibraryStateFilterValue = {
  sync: 'all' | 'synced' | 'unsynced'
  protection: 'all' | 'protected' | 'unprotected'
  organization: 'all' | 'organized' | 'unorganized'
}

const favoriteLibraryStateFilterGroups = [
  { key: 'sync', label: '同步状态', options: [{ value: 'all', label: '同步：全部' }, { value: 'synced', label: '已同步' }, { value: 'unsynced', label: '未同步' }] },
  { key: 'protection', label: '保护状态', options: [{ value: 'all', label: '保护：全部' }, { value: 'protected', label: '已保护' }, { value: 'unprotected', label: '未保护' }] },
  { key: 'organization', label: '整理状态', options: [{ value: 'all', label: '整理：全部' }, { value: 'organized', label: '已整理' }, { value: 'unorganized', label: '未整理' }] }
] as const

export function FavoriteLibraryStateFilterMenu({
  value,
  onChange
}: {
  value: FavoriteLibraryStateFilterValue
  onChange: <K extends keyof FavoriteLibraryStateFilterValue>(key: K, nextValue: FavoriteLibraryStateFilterValue[K]) => void
}) {
  const [open, setOpen] = useState(false)
  return <span className="favorite-library__column-menu favorite-library__state-filter-menu">
    <button type="button" className="favorite-library__column-menu-trigger" aria-label="状态筛选" aria-expanded={open} onClick={() => setOpen((current) => !current)}><Chevron /></button>
    {open ? <span role="menu" aria-label="状态筛选" className="favorite-library__column-menu-options favorite-library__state-filter-options">
      {favoriteLibraryStateFilterGroups.map((group) => <span className="favorite-library__state-filter-group" key={group.key}>
        <strong>{group.label}</strong>
        {group.options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={value[group.key] === option.value} onClick={() => onChange(group.key, option.value)}>{option.label}</button>)}
      </span>)}
    </span> : null}
  </span>
}

export function FavoriteLibraryMultiSelectColumnMenu({
  label, values, options, onChange
}: {
  label: string
  values: FavoriteLibraryTranscriptionFilter[]
  options: Array<{ value: FavoriteLibraryTranscriptionFilter; label: string }>
  onChange: (values: FavoriteLibraryTranscriptionFilter[]) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties>()
  const close = useCallback(() => { setOpen(false); triggerRef.current?.focus() }, [])
  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const maxLeft = Math.max(8, window.innerWidth - TRANSCRIPTION_MENU_WIDTH - 8)
    setPosition({ top: `${rect.bottom + 6}px`, left: `${Math.max(8, Math.min(rect.left + rect.width / 2 - TRANSCRIPTION_MENU_WIDTH / 2, maxLeft))}px` })
  }, [])
  useEffect(() => {
    if (!open) return
    reposition()
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close()
    }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keydown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [close, open, reposition])
  const toggle = (value: FavoriteLibraryTranscriptionFilter) => onChange(values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value].sort())
  const menu = open ? <div ref={menuRef} role="menu" aria-label={label} className="favorite-library__column-menu-options favorite-library__column-menu-options--portal" style={position}>
    {options.map((option) => <button key={option.value} type="button" role="menuitemcheckbox" aria-checked={values.includes(option.value)} onClick={() => toggle(option.value)}>{option.label}</button>)}
  </div> : null
  return <span ref={rootRef} className="favorite-library__column-menu">
    <button ref={triggerRef} type="button" className="favorite-library__column-menu-trigger" aria-label={label} aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}><Chevron /></button>
    {typeof document === 'undefined' ? null : createPortal(menu, document.body)}
  </span>
}

function Chevron() {
  return <svg className="favorite-library__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function FavoriteLibraryDestinationButton({
  action,
  logicalFolders,
  onConfirm,
  disabled = false
}: {
  action: 'copy' | 'move'
  logicalFolders: Array<{ id: string; title: string }>
  onConfirm: (folderIds: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [destinationIds, setDestinationIds] = useState<string[]>([])
  const rootRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>()
  const label = action === 'copy' ? '复制至' : '移动至'
  const close = useCallback(() => setOpen(false), [])
  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPosition({ top: `${rect.bottom + 4}px`, left: `${rect.left}px` })
  }, [])
  useEffect(() => {
    if (!open) return
    reposition()
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close()
    }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keydown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [close, open, reposition])
  const toggleDestination = (folderId: string) => setDestinationIds((current) => current.includes(folderId)
    ? current.filter((id) => id !== folderId)
    : [...current, folderId].sort())
  const toggle = () => {
    setDestinationIds([])
    setOpen((current) => !current)
  }
  const menu = open ? <div ref={menuRef} role="menu" aria-label={`${label}收藏夹`} className="favorite-library__batch-floating-menu favorite-library__batch-destination-menu" style={menuPosition}>
    <FavoriteLibraryDestinationList logicalFolders={logicalFolders} destinationIds={destinationIds} onToggle={toggleDestination} />
    <span className="favorite-library__batch-destination-actions"><button type="button" disabled={disabled || !destinationIds.length} onClick={() => { onConfirm(destinationIds); close() }}>{`确认${action === 'copy' ? '复制' : '移动'}`}</button><button type="button" onClick={close}>取消</button></span>
  </div> : null
  return <span ref={rootRef} className="favorite-library__batch-split"><button ref={triggerRef} type="button" className="favorite-library__batch-destination-trigger" aria-expanded={open} disabled={disabled} onClick={toggle}>{label}<Chevron /></button>{typeof document === 'undefined' ? null : createPortal(menu, document.body)}</span>
}

function BatchActions({
  disabled, disabledActions = [], allowedActions, onAction, onDownload, logicalFolders = [], onBatchPlacement
}: {
  disabled: boolean
  disabledActions?: FavoriteLibraryBatchAction[]
  allowedActions?: FavoriteLibraryBatchAction[]
  onAction?: (action: FavoriteLibraryBatchAction) => void
  onDownload?: () => void
  logicalFolders?: Array<{ id: string; title: string }>
  onBatchPlacement?: (action: 'copy' | 'move', folderIds: string[]) => void
}) {
  const disabledTitle = disabled ? '请先勾选视频' : undefined
  const [openMenu, setOpenMenu] = useState<'copy' | 'move' | 'more' | undefined>()
  const [destinationIds, setDestinationIds] = useState<string[]>([])
  const [focusDestinationFirst, setFocusDestinationFirst] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Partial<Record<'copy' | 'move' | 'more', HTMLButtonElement>>>({})
  const [menuPosition, setMenuPosition] = useState<CSSProperties>()
  const closeMenu = useCallback(() => setOpenMenu(undefined), [])
  const repositionMenu = useCallback(() => {
    const trigger = openMenu ? triggerRefs.current[openMenu] : undefined
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setMenuPosition({ top: `${rect.bottom + 4}px`, left: `${rect.left}px` })
  }, [openMenu])

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) closeMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu() }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [closeMenu])
  useEffect(() => {
    if (!openMenu) return
    repositionMenu()
    window.addEventListener('resize', repositionMenu)
    window.addEventListener('scroll', repositionMenu, true)
    return () => {
      window.removeEventListener('resize', repositionMenu)
      window.removeEventListener('scroll', repositionMenu, true)
    }
  }, [openMenu, repositionMenu])

  const allowed = (action: FavoriteLibraryBatchAction) => !allowedActions || allowedActions.includes(action)
  const run = (action: FavoriteLibraryBatchAction) => {
    if (!allowed(action)) return
    closeMenu()
    onAction?.(action)
  }
  const toggleDestinationMenu = (action: 'copy' | 'move') => {
    setFocusDestinationFirst(false)
    setDestinationIds([])
    setOpenMenu((current) => current === action ? undefined : action)
  }
  const toggleDestination = (folderId: string) => setDestinationIds((current) => current.includes(folderId)
    ? current.filter((id) => id !== folderId)
    : [...current, folderId].sort())
  const confirmDestination = () => {
    if (!openMenu || openMenu === 'more' || !destinationIds.length) return
    onBatchPlacement?.(openMenu, destinationIds)
    closeMenu()
  }
  const directActions: Array<[Exclude<FavoriteLibraryBatchAction, 'copy' | 'move'>, string]> = [['refresh', '刷新信息'], ['reorganize', '重新整理']]
  const dangerActions: Array<[FavoriteLibraryBatchAction, string]> = [['delete-local', '从收藏库删除'], ['remove-managed-placement', '移出 bilimi 工作夹']]
  const hasMoreActions = allowed('sync') || dangerActions.some(([action]) => allowed(action))
  const destinationMenu = openMenu === 'copy' || openMenu === 'move' ? openMenu : undefined
  const floatingMenu = destinationMenu ? <div ref={menuRef} role="menu" aria-label={`${destinationMenu === 'copy' ? '复制至' : '移动至'}收藏夹`} className="favorite-library__batch-floating-menu favorite-library__batch-destination-menu" style={menuPosition}>
    <FavoriteLibraryDestinationList logicalFolders={logicalFolders} destinationIds={destinationIds} onToggle={toggleDestination} focusFirst={focusDestinationFirst} />
    <span className="favorite-library__batch-destination-actions"><button type="button" disabled={disabled || !destinationIds.length} onClick={confirmDestination}>{`确认${destinationMenu === 'copy' ? '复制' : '移动'}`}</button><button type="button" onClick={closeMenu}>取消</button></span>
  </div> : openMenu === 'more' ? <div ref={menuRef} role="menu" aria-label="更多批量操作菜单" className="favorite-library__batch-floating-menu favorite-library__batch-more-menu" style={menuPosition}>
    {allowed('sync') ? <button type="button" disabled={disabled} onClick={() => run('sync')}>同步到B站</button> : null}
    <hr />
    {dangerActions.filter(([action]) => allowed(action)).map(([action, label]) => <button key={action} type="button" className="favorite-library__danger-action" disabled={disabled} onClick={() => run(action)}>{label}</button>)}
  </div> : null
  return <div ref={rootRef} className="favorite-library__batch-actions">
    {(['copy', 'move'] as const).filter((action) => allowed(action)).map((action) => {
      const label = action === 'copy' ? '复制至' : '移动至'
      return <span key={action} className="favorite-library__batch-split"><button ref={(element) => { triggerRefs.current[action] = element ?? undefined }} type="button" className="favorite-library__batch-destination-trigger" aria-expanded={destinationMenu === action} disabled={disabled} title={disabledTitle} onClick={() => toggleDestinationMenu(action)} onKeyDown={(event) => {
        if (event.key !== 'ArrowDown') return
        event.preventDefault()
        setDestinationIds([])
        setFocusDestinationFirst(true)
        setOpenMenu(action)
      }}>{label}<Chevron /></button></span>
    })}
    {directActions.filter(([action]) => allowed(action)).map(([action, label]) => <button key={action} type="button" disabled={disabled || disabledActions.includes(action)} title={disabledTitle} onClick={() => run(action)}>{label}</button>)}
    {(allowed('transcribe') || allowed('cancel-transcribe') || allowed('download-documents')) ? <VideoSummaryMenu actions={[
      { id: 'transcribe', label: '转写音频', disabled: disabled || !allowed('transcribe') || disabledActions.includes('transcribe'), onSelect: () => run('transcribe') },
      { id: 'cancel-transcribe', label: '取消转写', disabled: disabled || !allowed('cancel-transcribe') || disabledActions.includes('cancel-transcribe'), onSelect: () => run('cancel-transcribe') }
    ]} download={{ disabled: disabled || !allowed('download-documents'), onSelect: () => onDownload ? onDownload() : run('download-documents') }} disabled={disabled} disabledTitle={disabledTitle} /> : null}
    {hasMoreActions ? <button ref={(element) => { triggerRefs.current.more = element ?? undefined }} type="button" className="favorite-library__disclosure-button" aria-expanded={openMenu === 'more'} disabled={disabled} title={disabledTitle} onClick={() => setOpenMenu((current) => current === 'more' ? undefined : 'more')}>更多批量操作<Chevron /></button> : null}
    {typeof document === 'undefined' ? null : createPortal(floatingMenu, document.body)}
  </div>
}

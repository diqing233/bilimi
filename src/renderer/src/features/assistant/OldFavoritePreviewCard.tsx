import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FavoriteLedger } from '@shared/types'
import type { OldFavoriteWorkspaceClassification, OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'

type PreviewItem = NonNullable<OldFavoriteWorkspaceSnapshot['currentSegment']>['items'][number]

type OldFavoritePreviewCardProps = {
  item: PreviewItem
  sourceFolderTitles: string[]
  classification?: OldFavoriteWorkspaceClassification
  currentLedgerId?: string
  originalTargetLedgerIds?: string[]
  ledgers: FavoriteLedger[]
  loading: boolean
  onApplyManualClassification: (aid: number, targetLedgerIds: string[]) => void
}

export function OldFavoritePreviewCard({
  item,
  sourceFolderTitles,
  classification,
  currentLedgerId,
  originalTargetLedgerIds = [],
  ledgers,
  loading,
  onApplyManualClassification
}: OldFavoritePreviewCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [multiSelectOpen, setMultiSelectOpen] = useState(false)
  const [draftTargetLedgerIds, setDraftTargetLedgerIds] = useState<string[]>([])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const title = item.title?.trim() || `视频 ${item.aid}`
  const targetLedgerIds = classification?.targetLedgerIds ?? []
  const selected = targetLedgerIds.length > 0
  const originalLedgerNames = originalTargetLedgerIds
    .map((ledgerId) => ledgerId === 'inbox' ? '暂存' : ledgers.find((ledger) => ledger.id === ledgerId)?.displayName ?? ledgerId)

  useLayoutEffect(() => {
    if (!menuOpen) return
    const updatePosition = () => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (!trigger || !menu) return
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const gutter = 8
      const below = triggerRect.bottom + gutter
      const above = triggerRect.top - menuRect.height - gutter
      const top = below + menuRect.height <= window.innerHeight || above < gutter ? below : above
      const left = Math.max(gutter, Math.min(triggerRect.left, window.innerWidth - menuRect.width - gutter))
      setMenuPosition({ top, left })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [menuOpen, multiSelectOpen])

  useEffect(() => {
    if (!menuOpen) return
    const closeFromOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && !menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) closeMenu()
    }
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', closeFromOutside)
    document.addEventListener('keydown', closeFromEscape)
    return () => {
      document.removeEventListener('mousedown', closeFromOutside)
      document.removeEventListener('keydown', closeFromEscape)
    }
  }, [menuOpen])

  function closeMenu() {
    setMenuOpen(false)
    setMultiSelectOpen(false)
  }

  function applySingleTarget(targetLedgerId?: string) {
    const preservedTargetLedgerIds = currentLedgerId
      ? targetLedgerIds.filter((ledgerId) => ledgerId !== currentLedgerId)
      : []
    const nextTargetLedgerIds = targetLedgerId
      ? [...new Set([...preservedTargetLedgerIds, targetLedgerId])].slice(0, 3)
      : preservedTargetLedgerIds
    onApplyManualClassification(item.aid, nextTargetLedgerIds)
    closeMenu()
  }

  function removeAllTargets() {
    onApplyManualClassification(item.aid, [])
    closeMenu()
  }

  function openMultiSelect() {
    setDraftTargetLedgerIds(targetLedgerIds)
    setMultiSelectOpen(true)
  }

  function toggleDraftTarget(ledgerId: string, checked: boolean) {
    setDraftTargetLedgerIds((current) => checked
      ? [...new Set([...current, ledgerId])].slice(0, 3)
      : current.filter((id) => id !== ledgerId))
  }

  return <article className="favorite-ledger-panel__preview-card">
    <div className="favorite-ledger-panel__preview-video favorite-ledger-panel__preview-video--pending" data-selected={selected}>
      <a href={`https://www.bilibili.com/video/av${item.aid}`} target="_blank" rel="noreferrer"><strong>{title}</strong></a>
      <p>UP：{item.author?.trim() || '未知 UP'}</p>
      <p>来源：{sourceFolderTitles.join('、') || '未记录'}</p>
      {item.tags?.length ? <p>标签：{item.tags.join('、')}</p> : null}
      <p>分类把握：{classification?.source === 'system-low' ? '不太稳' : '比较稳'}</p>
      {originalLedgerNames.length ? <p>原分类：{originalLedgerNames.join('、')}</p> : null}
    </div>
    <div className="favorite-ledger-panel__preview-controls">
      <button ref={triggerRef} type="button" className="favorite-ledger-panel__target-toggle" data-selected={selected}
        aria-label={`转移 ${title}`} aria-expanded={menuOpen} disabled={loading}
        onClick={() => {
          if (menuOpen) closeMenu()
          else setMenuOpen(true)
        }}>
        转移 <span className="disclosure-arrow" aria-hidden="true">▾</span>
      </button>
      {menuOpen ? createPortal(<div ref={menuRef} className="favorite-ledger-panel__target-menu favorite-ledger-panel__target-menu--floating"
        style={{ top: menuPosition.top, left: menuPosition.left }} role="menu" aria-label={`转移 ${title}`}>
        {multiSelectOpen ? <div className="favorite-ledger-panel__target-multi" role="group" aria-label={`附加目标 ${title}`}>
          {ledgers.map((ledger) => {
            const checked = draftTargetLedgerIds.includes(ledger.id)
            return <label key={ledger.id}><input type="checkbox" aria-label={`归类 ${title} ${ledger.displayName}`}
              checked={checked} disabled={loading || (!checked && draftTargetLedgerIds.length >= 3)}
              onChange={(event) => toggleDraftTarget(ledger.id, event.currentTarget.checked)} />{ledger.displayName}</label>
          })}
          <div className="favorite-ledger-panel__target-menu-actions">
            <button type="button" disabled={loading} onClick={() => {
              onApplyManualClassification(item.aid, draftTargetLedgerIds)
              closeMenu()
            }}>确认多选</button>
            <button type="button" disabled={loading} onClick={closeMenu}>取消</button>
          </div>
        </div> : <>
          {currentLedgerId && targetLedgerIds.length > 1 ? <>
            <button type="button" role="menuitem" disabled={loading} onClick={() => applySingleTarget()}>移出当前分类</button>
            <button type="button" role="menuitem" disabled={loading} onClick={removeAllTargets}>移出全部分类</button>
          </> : <button type="button" role="menuitem" disabled={loading} onClick={() => applySingleTarget()}>未分类</button>}
          {ledgers.map((ledger) => <button key={ledger.id} type="button" role="menuitem" disabled={loading}
            onClick={() => applySingleTarget(ledger.id)}>{ledger.displayName}</button>)}
          <button type="button" role="menuitem" disabled={loading} onClick={openMultiSelect}>多选…</button>
        </>}
      </div>, document.body) : null}
    </div>
  </article>
}

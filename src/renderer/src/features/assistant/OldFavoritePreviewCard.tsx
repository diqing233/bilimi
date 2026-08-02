import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
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
  batchSelectable?: boolean
  batchSelected?: boolean
  onToggleBatchSelection?: (aid: number) => void
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
  batchSelectable = false,
  batchSelected = false,
  onToggleBatchSelection = () => undefined,
  onApplyManualClassification
}: OldFavoritePreviewCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [multiSelectOpen, setMultiSelectOpen] = useState(false)
  const [draftTargetLedgerIds, setDraftTargetLedgerIds] = useState<string[]>([])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const tooltipId = useId()
  const tooltipAnchorRef = useRef<HTMLElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ key: 'title' | 'source' | 'tags' | 'original'; text: string; top: number; left: number } | null>(null)
  const title = item.title?.trim() || `视频 ${item.aid}`
  const sourceText = `来源：${sourceFolderTitles.join('、') || '未记录'}`
  const tagsText = item.tags?.length ? `标签：${item.tags.join('、')}` : null
  const targetLedgerIds = classification?.targetLedgerIds ?? []
  const hasTargets = targetLedgerIds.length > 0
  const originalLedgerNames = originalTargetLedgerIds
    .map((ledgerId) => ledgerId === 'inbox' ? '暂存' : ledgers.find((ledger) => ledger.id === ledgerId)?.displayName ?? ledgerId)
  const originalLedgerText = originalLedgerNames.length ? `原分类：${originalLedgerNames.join('、')}` : null

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

  useLayoutEffect(() => {
    if (!tooltip) return
    const updatePosition = () => {
      const anchor = tooltipAnchorRef.current
      if (!anchor) return
      const anchorRect = anchor.getBoundingClientRect()
      const tooltipRect = tooltipRef.current?.getBoundingClientRect()
      const gutter = 8
      const tooltipWidth = tooltipRect?.width || 320
      const tooltipHeight = tooltipRect?.height || 48
      const below = anchorRect.bottom + 6
      const above = anchorRect.top - tooltipHeight - 6
      const top = below + tooltipHeight <= window.innerHeight || above < gutter ? below : above
      const left = Math.max(gutter, Math.min(anchorRect.left, window.innerWidth - tooltipWidth - gutter))
      setTooltip((current) => current && current.top === top && current.left === left
        ? current
        : current ? { ...current, top, left } : null)
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [tooltip?.key, tooltip?.text])

  const tooltipOpen = Boolean(tooltip)
  useEffect(() => {
    if (!tooltipOpen) return
    const closeTooltipFromEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTooltip(null)
    }
    document.addEventListener('keydown', closeTooltipFromEscape)
    return () => document.removeEventListener('keydown', closeTooltipFromEscape)
  }, [tooltipOpen])

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

  function showTooltip(key: 'title' | 'source' | 'tags' | 'original', text: string, anchor: HTMLElement) {
    tooltipAnchorRef.current = anchor
    setTooltip({ key, text, top: 0, left: 0 })
  }

  return <article className="favorite-ledger-panel__preview-card" data-selected={batchSelected || undefined}>
    <div className="favorite-ledger-panel__preview-information favorite-ledger-panel__preview-video favorite-ledger-panel__preview-video--pending"
      role={batchSelectable ? 'button' : undefined} tabIndex={batchSelectable ? 0 : undefined}
      aria-label={batchSelectable ? `${batchSelected ? '取消选择' : '选择'} ${title}` : undefined}
      onClick={batchSelectable ? () => onToggleBatchSelection(item.aid) : undefined}
      onKeyDown={batchSelectable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggleBatchSelection(item.aid)
        }
      } : undefined}>
      <a href={`https://www.bilibili.com/video/av${item.aid}`} target="_blank" rel="noreferrer" className="favorite-ledger-panel__preview-tooltip-trigger"
        aria-describedby={tooltip?.key === 'title' ? tooltipId : undefined}
        onClick={(event) => event.stopPropagation()}
        onMouseEnter={(event) => showTooltip('title', title, event.currentTarget)} onMouseLeave={() => setTooltip(null)}
        onFocus={(event) => showTooltip('title', title, event.currentTarget)} onBlur={() => setTooltip(null)}><strong>{title}</strong></a>
      <p>UP：{item.author?.trim() || '未知 UP'}</p>
      <p tabIndex={0} className="favorite-ledger-panel__preview-tooltip-trigger" aria-describedby={tooltip?.key === 'source' ? tooltipId : undefined}
        onMouseEnter={(event) => showTooltip('source', sourceText, event.currentTarget)} onMouseLeave={() => setTooltip(null)}
        onFocus={(event) => showTooltip('source', sourceText, event.currentTarget)} onBlur={() => setTooltip(null)}>{sourceText}</p>
      <p tabIndex={tagsText ? 0 : undefined} className={tagsText ? 'favorite-ledger-panel__preview-tooltip-trigger' : undefined} aria-describedby={tooltip?.key === 'tags' ? tooltipId : undefined}
        onMouseEnter={(event) => tagsText && showTooltip('tags', tagsText, event.currentTarget)} onMouseLeave={() => setTooltip(null)}
        onFocus={(event) => tagsText && showTooltip('tags', tagsText, event.currentTarget)} onBlur={() => setTooltip(null)}>{tagsText ?? '标签：未记录'}</p>
      <p>分类把握：{classification?.source === 'system-low' ? '不太稳' : '比较稳'}</p>
    </div>
    <div className="favorite-ledger-panel__preview-controls">
      <button ref={triggerRef} type="button" className="favorite-ledger-panel__target-toggle" data-selected={hasTargets}
        aria-label={`转移 ${title}`} aria-expanded={menuOpen} disabled={loading}
        onClick={() => {
          if (menuOpen) closeMenu()
          else setMenuOpen(true)
        }}>
        转移 <span className="disclosure-arrow" aria-hidden="true">▾</span>
      </button>
      {originalLedgerText ? <span tabIndex={0} className="favorite-ledger-panel__preview-original-category" title={originalLedgerText}
        aria-describedby={tooltip?.key === 'original' ? tooltipId : undefined}
        onMouseEnter={(event) => showTooltip('original', originalLedgerText, event.currentTarget)} onMouseLeave={() => setTooltip(null)}
        onFocus={(event) => showTooltip('original', originalLedgerText, event.currentTarget)} onBlur={() => setTooltip(null)}>{originalLedgerText}</span> : null}
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
    {tooltip ? createPortal(<div ref={tooltipRef} id={tooltipId} role="tooltip" className="favorite-ledger-panel__preview-tooltip"
      style={{ top: tooltip.top, left: tooltip.left }}>{tooltip.text}</div>, document.body) : null}
  </article>
}

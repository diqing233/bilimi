import {
  BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH,
  BILIMI_LEDGER_PREFIX,
  createDefaultFavoriteLedgers,
  favoriteLedgerNameValidation,
  stripBilimiLedgerPrefix
} from '@shared/favoriteLedgers'
import { DEEPSEEK_CONSTRAINT_MARKER, parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
import type { FavoriteLedger, FavoriteLedgerRuleType, FavoriteLedgerSaveOptions } from '@shared/types'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { OldFavoriteModal } from './OldFavoriteModal'

type FavoriteLedgerOverviewProps = {
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  organizationActive?: boolean
  hasExpandedOrganizationGuide?: boolean
  defaultFavoriteSystemEnabled?: boolean
  openLedgerId?: string
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onSyncLedgers?: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
}

const LEDGER_SYNC_HINT = '自定义你的 bilimi 收藏夹，点击收藏名字可以编辑，添加好后点击【同步】即可更新到 B 站。取消勾选只会停止同步，不会删除已有收藏夹。'
const TYPES: Array<{ value: FavoriteLedgerRuleType; label: string }> = [
  { value: 'keyword', label: '关键词收藏夹' },
  { value: 'author', label: '专属 UP 追更收藏夹' },
  { value: 'tag', label: '标签收藏夹' },
  { value: 'deepseek', label: 'DeepSeek约束收藏夹' }
]
const COLLAPSED_LEDGER_COUNT = 15

function ruleLabel(type: FavoriteLedgerRuleType | undefined) {
  return type === 'author' ? 'UP 名字' : type === 'tag' ? '标签' : type === 'deepseek' ? 'DeepSeek约束' : '关键词'
}
function ruleHint(type: FavoriteLedgerRuleType | undefined) {
  if (type === 'author') return '填写一个或多个 UP 名，命中作者时会优先存入这个收藏夹。'
  if (type === 'tag') return '填写一个或多个 B 站标签，命中标签时会优先存入这个收藏夹。'
  if (type === 'deepseek') return '填写自然语言判断规则。此类型不参与本地自动分类，必须开启 DeepSeek 后才会用于辅助判断。'
  return '建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。'
}
function displayTitle(name: string) {
  return stripBilimiLedgerPrefix(name).replace(/^[:：·\s]+/, '').trim()
}
function idFor(title: string) {
  return `custom-${title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-').replace(/^-|-$/g, '') || 'ledger'}-${Date.now()}`
}

function composeKeywords(ruleText: string, deepSeekConstraint: string, ruleType: FavoriteLedgerRuleType) {
  const rules = ruleType === 'deepseek'
    ? (ruleText.trim() ? [ruleText.trim()] : [])
    : ruleText.split(/[\s,，、/]+/).filter(Boolean)
  const constraint = deepSeekConstraint.replace(/\s+/g, ' ').trim()
  return constraint && ruleType !== 'deepseek'
    ? [...rules, DEEPSEEK_CONSTRAINT_MARKER, constraint]
    : rules
}

function ledgerEditorSnapshot(ledger: FavoriteLedger) {
  const { priority: _priority, ...snapshot } = ledger
  return snapshot
}

/** Local rule drafts stay in this panel until the owner chooses save or sync. */
export function FavoriteLedgerOverview({ ledgers, missingLedgerIds, organizationActive = false, hasExpandedOrganizationGuide = false, defaultFavoriteSystemEnabled = true, openLedgerId, onSaveLedgers, onSyncLedgers = onSaveLedgers }: FavoriteLedgerOverviewProps) {
  const externalLedgerSignature = JSON.stringify(ledgers)
  const [ledgerHintExpanded, setLedgerHintExpanded] = useState(() => window.localStorage.getItem('bilimi:ledger-hint-open') === 'true')
  const [draftLedgers, setDraftLedgers] = useState(ledgers)
  const [savedLedgerSnapshots, setSavedLedgerSnapshots] = useState<Record<string, ReturnType<typeof ledgerEditorSnapshot>>>(() =>
    Object.fromEntries(ledgers.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)]))
  )
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null)
  const [newLedger, setNewLedger] = useState(false)
  const [deletionCandidates, setDeletionCandidates] = useState<Array<{ logicalLedgerId: string; remoteFolderId: string; title: string; memberCount: number }> | null>(null)
  const [deletionConfirmed, setDeletionConfirmed] = useState(false)
  const [deletionReviewOpen, setDeletionReviewOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [ledgerListExpanded, setLedgerListExpanded] = useState(false)
  const [draggedLedgerId, setDraggedLedgerId] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<string | null>(null)
  const editorRef = useRef<HTMLElement | null>(null)
  const positionedLedgerIdRef = useRef<string | null>(null)
  useEffect(() => {
    setDraftLedgers(ledgers)
    setSavedLedgerSnapshots(Object.fromEntries(ledgers.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    setActiveLedgerId(null)
    setNewLedger(false)
    setLedgerListExpanded(false)
  }, [externalLedgerSignature])
  useEffect(() => {
    if (!openLedgerId || !ledgers.some((ledger) => ledger.id === openLedgerId)) return
    setActiveLedgerId(openLedgerId)
    setNewLedger(false)
  }, [ledgers, openLedgerId])
  useEffect(() => {
    if (!openLedgerId || activeLedgerId !== openLedgerId || positionedLedgerIdRef.current === openLedgerId) return
    const frame = window.requestAnimationFrame(() => {
      positionedLedgerIdRef.current = openLedgerId
      const editor = editorRef.current
      if (!editor || typeof editor.scrollIntoView !== 'function') return
      editor.scrollIntoView({
        block: hasExpandedOrganizationGuide ? 'center' : 'start',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeLedgerId, hasExpandedOrganizationGuide, openLedgerId])
  useEffect(() => { window.localStorage.setItem('bilimi:ledger-hint-open', String(ledgerHintExpanded)) }, [ledgerHintExpanded])
  const active = draftLedgers.find((ledger) => ledger.id === activeLedgerId)
  const ledgerHasUnsavedChanges = (ledger: FavoriteLedger) =>
    !savedLedgerSnapshots[ledger.id] || JSON.stringify(ledgerEditorSnapshot(ledger)) !== JSON.stringify(savedLedgerSnapshots[ledger.id])
  const activeHasUnsavedChanges = Boolean(active && ledgerHasUnsavedChanges(active))
  const activeRules = active ? parseFavoriteLedgerRules(active) : { localKeywords: [] }
  const title = active ? displayTitle(active.displayName) : ''
  const validation = favoriteLedgerNameValidation(active?.displayName ?? '')
  const duplicate = active && draftLedgers.some((ledger) => ledger.id !== active.id &&
    displayTitle(ledger.displayName).toLocaleLowerCase() === title.trim().toLocaleLowerCase())
  const valid = Boolean(active && title.trim() && validation.valid && !duplicate)
  const isSystemDisabled = (ledger: FavoriteLedger) => !defaultFavoriteSystemEnabled && ledger.isDefault && ledger.id !== 'inbox'
  const isRoundLocked = (ledger: FavoriteLedger) => organizationActive && ledger.isDefault
  const isOperable = (ledger: FavoriteLedger) => !isSystemDisabled(ledger) && !isRoundLocked(ledger)
  const operableLedgers = draftLedgers.filter(isOperable)
  const allOperableLedgersEnabled = operableLedgers.length > 0 && operableLedgers.every((ledger) => ledger.enabled)
  const canToggleLedgerList = draftLedgers.length > COLLAPSED_LEDGER_COUNT
  const ledgersToDisplay = ledgerListExpanded ? draftLedgers : draftLedgers.slice(0, COLLAPSED_LEDGER_COUNT)
  const update = (patch: Partial<FavoriteLedger>) => setDraftLedgers((current) => current.map((ledger) => ledger.id === activeLedgerId ? { ...ledger, ...patch } : ledger))
  const persist = (next: FavoriteLedger[]) => {
    setDraftLedgers(next)
    setSavedLedgerSnapshots(Object.fromEntries(next.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    void onSaveLedgers(next, { deleteDisabled: false })
  }
  const toggle = (id: string) => {
    const target = draftLedgers.find((ledger) => ledger.id === id)
    if (!target || !isOperable(target)) return
    persist(draftLedgers.map((ledger) => ledger.id === id ? { ...ledger, enabled: !ledger.enabled } : ledger))
  }
  const toggleAll = () => persist(draftLedgers.map((ledger) => {
    if (isRoundLocked(ledger)) return { ...ledger, enabled: true }
    return isOperable(ledger) ? { ...ledger, enabled: !allOperableLedgersEnabled } : ledger
  }))
  const beginDrag = (id: string, event: DragEvent<HTMLDivElement>) => {
    setDraggedLedgerId(id)
    setDragTarget(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
  const dragOver = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!draggedLedgerId || draggedLedgerId === targetId) return setDragTarget(null)
    setDragTarget(targetId)
  }
  const dropOn = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/plain') || draggedLedgerId
    setDraggedLedgerId(null)
    setDragTarget(null)
    if (!sourceId || sourceId === targetId) return
    const sourceIndex = draftLedgers.findIndex((ledger) => ledger.id === sourceId)
    const targetIndex = draftLedgers.findIndex((ledger) => ledger.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const reordered = [...draftLedgers]
    const [source] = reordered.splice(sourceIndex, 1)
    const target = draftLedgers[targetIndex]
    const nextTargetIndex = reordered.findIndex((ledger) => ledger === target)
    const insertionIndex = sourceIndex < targetIndex ? nextTargetIndex + 1 : nextTargetIndex
    reordered.splice(insertionIndex, 0, source!)
    persist(reordered.map((ledger, index) => ({ ...ledger, priority: (index + 1) * 10 })))
  }
  const add = () => {
    const ledger: FavoriteLedger = { id: idFor('new-ledger'), displayName: BILIMI_LEDGER_PREFIX, keywords: [], ruleType: 'keyword', enabled: false, priority: (draftLedgers.length + 1) * 10, isDefault: false }
    setDraftLedgers((current) => [...current, ledger]); setActiveLedgerId(ledger.id); setNewLedger(true)
  }
  const close = () => {
    if (newLedger && activeLedgerId) setDraftLedgers((current) => current.filter((ledger) => ledger.id !== activeLedgerId))
    setActiveLedgerId(null); setNewLedger(false)
  }
  const save = () => {
    if (!valid) return
    setSavedLedgerSnapshots(Object.fromEntries(draftLedgers.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    void onSaveLedgers(draftLedgers, { deleteDisabled: false })
    setActiveLedgerId(null)
    setNewLedger(false)
  }
  const requestSync = async () => {
    const accountMid = window.bilimiDesktop?.readBilibiliAccountMid ? await window.bilimiDesktop.readBilibiliAccountMid() : ''
    const disabledIds = draftLedgers.filter((ledger) => !ledger.enabled).map((ledger) => ledger.id)
    const candidates = accountMid && disabledIds.length
      ? await window.bilimiDesktop?.previewManagedFavoriteFolderDeletion?.(accountMid, disabledIds)
      : []
    if (candidates?.length) {
      setDeletionCandidates(candidates)
      return
    }
    await onSyncLedgers(draftLedgers, { deleteDisabled: false })
  }
  const confirmManagedDeletion = async () => {
    const accountMid = window.bilimiDesktop?.readBilibiliAccountMid ? await window.bilimiDesktop.readBilibiliAccountMid() : ''
    if (!accountMid || !deletionCandidates || !deletionConfirmed) return
    await window.bilimiDesktop?.deleteManagedFavoriteFolders?.(accountMid, deletionCandidates.map((candidate) => candidate.logicalLedgerId))
    await onSyncLedgers(draftLedgers, { deleteDisabled: false })
    setDeletionCandidates(null); setDeletionConfirmed(false); setDeletionReviewOpen(false)
  }
  return <section className="favorite-ledger-panel__ledger-list" aria-label="收藏夹">
    <div className="favorite-ledger-panel__workspace">
      <section className="favorite-ledger-panel__checklist" aria-label="收藏夹规则">
        <div className="favorite-ledger-panel__category-header"><button type="button" className="favorite-ledger-panel__help-toggle favorite-ledger-panel__section-title" aria-label={`${ledgerHintExpanded ? '收起' : '展开'}收藏夹`} aria-expanded={ledgerHintExpanded} title={LEDGER_SYNC_HINT} onClick={() => setLedgerHintExpanded((open) => !open)}><h3>收藏夹</h3><Chevron /></button><div className="favorite-ledger-panel__category-actions"><button type="button" onClick={() => setResetConfirmOpen(true)}>重置</button><button type="button" data-testid="favorite-ledger-cancel-all" onClick={toggleAll}>{allOperableLedgersEnabled ? '取消全选' : '全选'}</button><button type="button" onClick={() => void requestSync()}>同步</button></div></div>
        {ledgerHintExpanded ? <div className="favorite-ledger-panel__sync-hint"><p>{LEDGER_SYNC_HINT}</p><p>关键词、UP 名字和标签用于本地识别；DeepSeek 约束只在开启 DeepSeek 后作为辅助判断参考，可以输入一段自然语言。</p></div> : null}
        <div className="favorite-ledger-panel__chips">{ledgersToDisplay.map((ledger) => {
          const disabledBySystem = isSystemDisabled(ledger)
          const unsaved = ledgerHasUnsavedChanges(ledger)
          const ledgerLabel = `${disabledBySystem ? '（已停用）' : unsaved ? '（未保存）' : ''}${displayTitle(ledger.displayName) || ledger.displayName}`
          const dropPosition = dragTarget === ledger.id ? 'before' : undefined
          return <div key={ledger.id} data-testid={`favorite-ledger-chip-${ledger.id}`} className="favorite-ledger-panel__chip-item" draggable
            data-dragging={draggedLedgerId === ledger.id ? 'true' : undefined} data-drop-position={dropPosition}
            data-default-system-disabled={disabledBySystem ? 'true' : undefined} aria-label={dropPosition ? `插入到${displayTitle(ledger.displayName)}上方` : undefined}
            onDragStart={(event) => beginDrag(ledger.id, event)} onDragOver={(event) => dragOver(ledger.id, event)} onDrop={(event) => dropOn(ledger.id, event)} onDragEnd={() => { setDraggedLedgerId(null); setDragTarget(null) }}>
            <button type="button" aria-label={ledgerLabel} title={ledger.displayName} aria-pressed={ledger.enabled && !disabledBySystem} onClick={() => {
              if (activeLedgerId === ledger.id) {
                setActiveLedgerId(null)
                setNewLedger(false)
                return
              }
              setActiveLedgerId(ledger.id)
              setNewLedger(false)
            }}>{ledgerLabel}</button>
            <button type="button" className="favorite-ledger-panel__chip-action" aria-label={`${ledger.enabled ? '移出同步' : '加入同步'} ${ledger.displayName}`} data-enabled={ledger.enabled && !disabledBySystem} disabled={!isOperable(ledger)} onClick={() => toggle(ledger.id)}>{ledger.enabled && !disabledBySystem ? '✓' : '+'}</button>
          </div>
        })}</div>
        <div className="favorite-ledger-panel__list-toggle"><button type="button" onClick={add}>新建收藏夹</button>{canToggleLedgerList ? <button type="button" aria-expanded={ledgerListExpanded} onClick={() => setLedgerListExpanded((expanded) => !expanded)}>{ledgerListExpanded ? '折叠' : '展开'}</button> : null}</div>
      </section>
      {missingLedgerIds.length ? <p className="favorite-ledger-panel__notice" role="alert">部分 Bilimi 收藏夹尚未备册。</p> : null}
      {active ? <section ref={editorRef} className="favorite-ledger-panel__editor" aria-label="当前收藏夹" data-ledger-id={active.id}><div className="favorite-ledger-panel__editor-title"><strong>{activeHasUnsavedChanges ? '（未保存）' : ''}{newLedger ? '新建收藏夹' : '正在编辑：'}{active.displayName}</strong><div className="favorite-ledger-panel__editor-actions"><button type="button" disabled={!valid} onClick={save}>保存</button><button type="button" onClick={close}>取消</button>{!active.isDefault ? <button type="button" onClick={() => { const next = draftLedgers.filter((ledger) => ledger.id !== active.id); setDraftLedgers(next); void onSaveLedgers(next, { deleteDisabled: false }); setActiveLedgerId(null); setNewLedger(false) }}>删除</button> : null}</div></div>
        <label><span>册名 <small data-invalid={!valid}>{validation.length}/{BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH}</small></span><span className="favorite-ledger-panel__prefixed-input"><span className="favorite-ledger-panel__fixed-prefix" aria-hidden="true">{BILIMI_LEDGER_PREFIX}</span><input aria-label="册名" value={title} onChange={(event) => update({ displayName: `${BILIMI_LEDGER_PREFIX}${event.currentTarget.value}` })} /></span>{!validation.valid ? <small role="alert">B站收藏夹名称最多20个字，当前{validation.length}个字</small> : duplicate ? <small role="alert">收藏夹名称不能重复</small> : null}</label>
        <label>收藏夹种类<select aria-label="收藏夹种类" disabled={active.isDefault} value={active.ruleType ?? 'keyword'} onChange={(event) => update({ ruleType: event.currentTarget.value as FavoriteLedgerRuleType, keywords: [] })}>{TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label>{ruleLabel(active.ruleType)}<textarea aria-label={ruleLabel(active.ruleType)}
          value={(active.ruleType ?? 'keyword') === 'deepseek' ? active.keywords.join('\n') : activeRules.localKeywords.join('、')}
          onChange={(event) => update({ keywords: composeKeywords(event.currentTarget.value, activeRules.deepSeekConstraint ?? '', active.ruleType ?? 'keyword') })} /></label>
        {(active.ruleType ?? 'keyword') !== 'deepseek' ? <label className="favorite-ledger-panel__deepseek-constraint-line">
          <span>DeepSeek约束：</span>
          <input aria-label="DeepSeek约束" value={activeRules.deepSeekConstraint ?? ''}
            onChange={(event) => update({ keywords: composeKeywords(activeRules.localKeywords.join('、'), event.currentTarget.value, active.ruleType ?? 'keyword') })} />
        </label> : null}
        <p className="favorite-ledger-panel__keyword-hint">{ruleHint(active.ruleType)}</p>
      </section> : null}
      {deletionCandidates && !deletionReviewOpen ? <OldFavoriteModal title="同步变更说明" confirmLabel="继续" onCancel={() => { setDeletionCandidates(null); setDeletionConfirmed(false) }} onConfirm={() => setDeletionReviewOpen(true)}>
        <p>本次同步有 {deletionCandidates.length} 个 bilimi 管理的收藏夹需要删除。</p>
        <p>请先确认变更内容；继续后需要进行危险操作确认。</p>
      </OldFavoriteModal> : null}
      {deletionCandidates && deletionReviewOpen ? <OldFavoriteModal danger title="删除 bilimi 收藏夹" confirmLabel="删除并同步" confirmDisabled={!deletionConfirmed} onCancel={() => { setDeletionCandidates(null); setDeletionConfirmed(false); setDeletionReviewOpen(false) }} onConfirm={() => void confirmManagedDeletion()}>
        <p>以下 {deletionCandidates.length} 个 bilimi 管理的收藏夹将在同步时删除：</p>
        <ul>{deletionCandidates.map((candidate) => <li key={candidate.remoteFolderId}>{candidate.title}（当前 {candidate.memberCount} 个视频）</li>)}</ul>
        <p>请确认这些 bilimi 收藏夹中没有需要保留的重要视频。删除收藏夹不会删除 B 站视频，但会移除这些收藏关系。</p>
        <label><input type="checkbox" checked={deletionConfirmed} onChange={(event) => setDeletionConfirmed(event.currentTarget.checked)} />我已确认</label>
      </OldFavoriteModal> : null}
    </div>
    {resetConfirmOpen ? <OldFavoriteModal title="重置收藏夹规则？" confirmLabel="确认重置" onCancel={() => setResetConfirmOpen(false)} onConfirm={() => { setDraftLedgers(createDefaultFavoriteLedgers()); setActiveLedgerId(null); setNewLedger(false); setResetConfirmOpen(false) }}><p>仅恢复默认收藏夹名称和分类规则，不会删除已有收藏夹。</p></OldFavoriteModal> : null}
  </section>
}

function Chevron() {
  return <svg className="favorite-ledger-panel__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

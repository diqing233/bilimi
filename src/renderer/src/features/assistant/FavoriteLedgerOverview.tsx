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
import {
  FavoriteLedgerEnableButton,
  FavoriteLedgerEnableStore,
  FavoriteLedgerEnableSummary,
  type FavoriteLedgerEnableEntry
} from './favoriteLedgerEnableStore'

type FavoriteLedgerOverviewProps = {
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  organizationActive?: boolean
  hasExpandedOrganizationGuide?: boolean
  defaultFavoriteSystemEnabled?: boolean
  openLedgerId?: string
  openLedgerRequestVersion?: number
  createLedger?: boolean
  createLedgerRequestVersion?: number
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onSaveLedgerEnabled?: (ledgerId: string, enabled: boolean) => Promise<unknown> | void
  onSyncLedgers?: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  draftRuleAnalysis?: {
    ledgerId: string
    status: 'running' | 'canceling'
    completedItemCount: number
    totalItemCount: number
  } | null
  draftRuleAnalysisError?: string | null
  onAnalyzeLedgerRule?: (ledger: FavoriteLedger) => Promise<boolean>
  onCancelDraftRuleAnalysis?: () => void
}

const LEDGER_SYNC_HINTS = [
  '自定义收藏夹：点击收藏夹名称可以编辑。',
  '同步到 B 站：修改完成后点击“同步”。',
  '停止同步：取消勾选不会删除已有收藏夹。',
  '分类依据：关键词、UP 名称和标签用于本地识别；DeepSeek 仅作辅助判断。'
]
const LEDGER_SYNC_HINT = LEDGER_SYNC_HINTS.join('\n')
const TYPES: Array<{ value: FavoriteLedgerRuleType; label: string }> = [
  { value: 'keyword', label: '关键词收藏夹' },
  { value: 'author', label: '专属 UP 追更收藏夹' },
  { value: 'tag', label: '标签收藏夹' },
  { value: 'deepseek', label: 'DeepSeek约束收藏夹' }
]
const COLLAPSED_LEDGER_COUNT = 15
const LEDGER_TOGGLE_SAVE_DELAY_MS = 250

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

function isRecoveredRemoteDraft(ledger: FavoriteLedger) {
  return ledger.syncState === 'local-draft' && Boolean(ledger.bilibiliFolderId)
}

/** Local rule drafts stay in this panel until the owner chooses save or sync. */
export function FavoriteLedgerOverview({ ledgers, missingLedgerIds, organizationActive = false, hasExpandedOrganizationGuide = false, defaultFavoriteSystemEnabled: defaultFavoriteSystemEnabledProp, openLedgerId, openLedgerRequestVersion = 0, createLedger = false, createLedgerRequestVersion = 0, onSaveLedgers, onSaveLedgerEnabled, onSyncLedgers = onSaveLedgers, draftRuleAnalysis = null, draftRuleAnalysisError = null, onAnalyzeLedgerRule, onCancelDraftRuleAnalysis }: FavoriteLedgerOverviewProps) {
  const defaultFavoriteSystemEnabled = defaultFavoriteSystemEnabledProp ?? true
  const defaultSystemPreferenceExplicit = defaultFavoriteSystemEnabledProp !== undefined
  const externalLedgerSignature = JSON.stringify(ledgers)
  const isSystemDisabled = (ledger: FavoriteLedger) => !defaultFavoriteSystemEnabled && ledger.isDefault && ledger.id !== 'inbox'
  const isRoundLocked = (ledger: FavoriteLedger) => organizationActive && ledger.isDefault
  const isDefaultSystemLocked = (ledger: FavoriteLedger) => defaultSystemPreferenceExplicit && defaultFavoriteSystemEnabled && ledger.isDefault
  const isOperable = (ledger: FavoriteLedger) => !isRecoveredRemoteDraft(ledger) && !isSystemDisabled(ledger) && !isRoundLocked(ledger) && !isDefaultSystemLocked(ledger)
  const enableEntries = (items: FavoriteLedger[]): FavoriteLedgerEnableEntry[] => items.map((ledger) => ({
    id: ledger.id,
    enabled: isDefaultSystemLocked(ledger) ? true : ledger.enabled,
    operable: isOperable(ledger),
    forceEnabledOnBulk: isRoundLocked(ledger)
  }))
  const [ledgerHintExpanded, setLedgerHintExpanded] = useState(() => window.localStorage.getItem('bilimi:ledger-hint-open') === 'true')
  const [draftLedgers, setDraftLedgers] = useState(ledgers)
  const [enableStore] = useState(() => new FavoriteLedgerEnableStore(enableEntries(ledgers)))
  const [savedLedgerSnapshots, setSavedLedgerSnapshots] = useState<Record<string, ReturnType<typeof ledgerEditorSnapshot>>>(() =>
    Object.fromEntries(ledgers.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)]))
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
  const draftMutationLocked = Boolean(draftRuleAnalysis)
  const recoveredRemoteDrafts = draftLedgers.filter((ledger) =>
    ledger.syncState === 'local-draft' && Boolean(ledger.bilibiliFolderId) && !ledger.enabled)
  const persistVersionRef = useRef(0)
  const toggleSaveTimerRef = useRef<number | null>(null)
  const pendingToggleSaveRef = useRef(new Map<string, { previous: boolean; enabled: boolean; version: number }>())
  const pendingBulkSaveRef = useRef<{ previousEnabled: Map<string, boolean> } | null>(null)
  const toggleVersionsRef = useRef(new Map<string, number>())
  const toggleSaveInFlightRef = useRef(false)
  const onSaveLedgersRef = useRef(onSaveLedgers)
  const onSaveLedgerEnabledRef = useRef(onSaveLedgerEnabled)
  const editorRef = useRef<HTMLElement | null>(null)
  const openedLedgerRequestRef = useRef<string | null>(null)
  const positionedLedgerRequestRef = useRef<string | null>(null)
  const openLedgerRequest = openLedgerId ? `${openLedgerId}:${openLedgerRequestVersion}` : null
  const createLedgerRequest = createLedger ? `new:${createLedgerRequestVersion}` : null
  onSaveLedgersRef.current = onSaveLedgers
  onSaveLedgerEnabledRef.current = onSaveLedgerEnabled
  useEffect(() => {
    if (toggleSaveTimerRef.current !== null) window.clearTimeout(toggleSaveTimerRef.current)
    toggleSaveTimerRef.current = null
    pendingToggleSaveRef.current.clear()
    pendingBulkSaveRef.current = null
    enableStore.reset(enableEntries(ledgers))
    setDraftLedgers(ledgers)
    setSavedLedgerSnapshots(Object.fromEntries(ledgers.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    setActiveLedgerId(null)
    setNewLedger(false)
  }, [externalLedgerSignature])
  useEffect(() => () => {
    if (toggleSaveTimerRef.current !== null) window.clearTimeout(toggleSaveTimerRef.current)
    toggleSaveTimerRef.current = null
    const pending = pendingToggleSaveRef.current
    pendingToggleSaveRef.current = new Map()
    const pendingBulk = pendingBulkSaveRef.current
    pendingBulkSaveRef.current = null
    if (pendingBulk) {
      void Promise.resolve(onSaveLedgersRef.current(projectEnabled(draftLedgers), { deleteDisabled: false })).catch(() => undefined)
    } else {
      for (const [id, mutation] of pending) {
        void Promise.resolve(onSaveLedgerEnabledRef.current?.(id, mutation.enabled)).catch(() => undefined)
      }
    }
  }, [])
  useEffect(() => {
    if (!openLedgerId || !openLedgerRequest || !ledgers.some((ledger) => ledger.id === openLedgerId)) {
      if (!openLedgerId) openedLedgerRequestRef.current = null
      return
    }
    if (openedLedgerRequestRef.current === openLedgerRequest) return
    openedLedgerRequestRef.current = openLedgerRequest
    setActiveLedgerId(openLedgerId)
    setNewLedger(false)
  }, [ledgers, openLedgerId, openLedgerRequest])
  useEffect(() => {
    if (!openLedgerId || !openLedgerRequest || activeLedgerId !== openLedgerId) {
      if (!openLedgerId) positionedLedgerRequestRef.current = null
      return
    }
    if (positionedLedgerRequestRef.current === openLedgerRequest) return
    const frame = window.requestAnimationFrame(() => {
      positionedLedgerRequestRef.current = openLedgerRequest
      const editor = editorRef.current
      if (!editor || typeof editor.scrollIntoView !== 'function') return
      editor.scrollIntoView({
        block: hasExpandedOrganizationGuide ? 'center' : 'start',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeLedgerId, hasExpandedOrganizationGuide, openLedgerId, openLedgerRequest])
  useEffect(() => {
    if (!createLedgerRequest || openedLedgerRequestRef.current === createLedgerRequest) return
    openedLedgerRequestRef.current = createLedgerRequest
    add()
  }, [createLedgerRequest])
  useEffect(() => {
    if (!createLedgerRequest || !newLedger || positionedLedgerRequestRef.current === createLedgerRequest) return
    const frame = window.requestAnimationFrame(() => {
      positionedLedgerRequestRef.current = createLedgerRequest
      editorRef.current?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [createLedgerRequest, newLedger])
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
  const canToggleLedgerList = draftLedgers.length > COLLAPSED_LEDGER_COUNT
  const ledgersToDisplay = ledgerListExpanded ? draftLedgers : draftLedgers.slice(0, COLLAPSED_LEDGER_COUNT)
  const projectEnabled = (items: FavoriteLedger[]) => items.map((ledger) => ({
    ...ledger,
    enabled: isDefaultSystemLocked(ledger) ? true : enableStore.isEnabled(ledger.id)
  }))
  const update = (patch: Partial<FavoriteLedger>) => setDraftLedgers((current) => current.map((ledger) => ledger.id === activeLedgerId ? { ...ledger, ...patch } : ledger))
  const persist = (next: FavoriteLedger[]) => {
    const previous = draftLedgers
    const persistVersion = ++persistVersionRef.current
    setDraftLedgers(next)
    setSavedLedgerSnapshots(Object.fromEntries(next.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    void Promise.resolve(onSaveLedgers(next, { deleteDisabled: false })).catch(() => {
      if (persistVersionRef.current !== persistVersion) return
      setDraftLedgers(previous)
      setSavedLedgerSnapshots(Object.fromEntries(previous.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    })
  }
  const flushTogglePersist = () => {
    if (toggleSaveInFlightRef.current) return
    const scheduled = pendingToggleSaveRef.current
    pendingToggleSaveRef.current = new Map()
    const scheduledBulk = pendingBulkSaveRef.current
    pendingBulkSaveRef.current = null
    if (!scheduledBulk && scheduled.size === 0) return
    const persistVersion = ++persistVersionRef.current
    toggleSaveInFlightRef.current = true
    const save = scheduledBulk
      ? Promise.resolve(onSaveLedgersRef.current(projectEnabled(draftLedgers), { deleteDisabled: false })).catch(() => {
          if (persistVersionRef.current !== persistVersion || pendingToggleSaveRef.current.size || pendingBulkSaveRef.current) return
          enableStore.replaceEnabled(scheduledBulk.previousEnabled)
        })
      : Promise.all([...scheduled].map(async ([id, mutation]) => {
          try {
            await onSaveLedgerEnabledRef.current?.(id, mutation.enabled)
          } catch {
            if (toggleVersionsRef.current.get(id) !== mutation.version) return
            enableStore.setEnabled(id, mutation.previous)
          }
        }))
    void save.finally(() => {
      toggleSaveInFlightRef.current = false
      if (pendingToggleSaveRef.current.size || pendingBulkSaveRef.current) flushTogglePersist()
    })
  }
  const scheduleTogglePersist = () => {
    if (toggleSaveTimerRef.current !== null) window.clearTimeout(toggleSaveTimerRef.current)
    toggleSaveTimerRef.current = window.setTimeout(() => {
      toggleSaveTimerRef.current = null
      flushTogglePersist()
    }, LEDGER_TOGGLE_SAVE_DELAY_MS)
  }
  const toggle = (id: string) => {
    if (draftMutationLocked) return
    const previousEnabled = enableStore.isEnabled(id)
    if (!enableStore.toggle(id)) return
    const version = (toggleVersionsRef.current.get(id) ?? 0) + 1
    toggleVersionsRef.current.set(id, version)
    const previousMutation = pendingToggleSaveRef.current.get(id)
    pendingToggleSaveRef.current.set(id, {
      previous: previousMutation?.previous ?? previousEnabled,
      enabled: enableStore.isEnabled(id),
      version
    })
    scheduleTogglePersist()
  }
  const toggleAll = () => {
    if (draftMutationLocked) return
    const previousEnabled = enableStore.getEnabledById()
    if (!enableStore.toggleAll()) return
    pendingToggleSaveRef.current.clear()
    pendingBulkSaveRef.current ??= { previousEnabled }
    scheduleTogglePersist()
  }
  const beginDrag = (id: string, event: DragEvent<HTMLButtonElement>) => {
    if (draftMutationLocked) return
    setDraggedLedgerId(id)
    setDragTarget(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
  const dragOver = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    if (draftMutationLocked) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!draggedLedgerId || draggedLedgerId === targetId) return setDragTarget(null)
    setDragTarget(targetId)
  }
  const dropOn = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    if (draftMutationLocked) return
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
    // The blue indicator marks the position above the target; keep the drop
    // result consistent with that visual cue in both drag directions.
    const insertionIndex = nextTargetIndex
    reordered.splice(insertionIndex, 0, source!)
    persist(reordered.map((ledger, index) => ({ ...ledger, priority: (index + 1) * 10 })))
  }
  const add = () => {
    if (draftMutationLocked) return
    const ledger: FavoriteLedger = { id: idFor('new-ledger'), displayName: BILIMI_LEDGER_PREFIX, keywords: [], ruleType: 'keyword', enabled: false, priority: (draftLedgers.length + 1) * 10, isDefault: false }
    enableStore.reconcile(enableEntries([...draftLedgers, ledger]))
    setDraftLedgers((current) => [...current, ledger]); setActiveLedgerId(ledger.id); setNewLedger(true)
  }
  const close = () => {
    if (draftMutationLocked) return
    if (newLedger && activeLedgerId) setDraftLedgers((current) => current.filter((ledger) => ledger.id !== activeLedgerId))
    setActiveLedgerId(null); setNewLedger(false)
  }
  const save = async () => {
    if (!valid || draftMutationLocked || !active || !activeLedgerId) return
    const savingLedgerId = activeLedgerId
    const ledgerToSave = projectEnabled(draftLedgers).find((ledger) => ledger.id === savingLedgerId)
    if (organizationActive && ledgerToSave && ledgerToSave.ruleType !== 'deepseek' && onAnalyzeLedgerRule) {
      const analyzed = await onAnalyzeLedgerRule(ledgerToSave)
      if (!analyzed) return
    }
    const previous = ledgers
    const persistVersion = ++persistVersionRef.current
    const next = projectEnabled(draftLedgers).map((ledger) => {
      if (ledger.id !== activeLedgerId || !isRecoveredRemoteDraft(ledger)) return ledger
      const { syncState: _syncState, ...savedLedger } = ledger
      return savedLedger
    })
    setDraftLedgers(next)
    enableStore.reconcile(enableEntries(next))
    setSavedLedgerSnapshots(Object.fromEntries(next.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    void Promise.resolve(onSaveLedgers(next, { deleteDisabled: false })).catch(() => {
      if (persistVersionRef.current !== persistVersion) return
      setDraftLedgers(previous)
      setSavedLedgerSnapshots(Object.fromEntries(previous.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    })
    setActiveLedgerId((current) => current === savingLedgerId ? null : current)
    setNewLedger(false)
  }
  const requestSync = async () => {
    if (draftMutationLocked) return
    const accountMid = window.bilimiDesktop?.readBilibiliAccountMid ? await window.bilimiDesktop.readBilibiliAccountMid() : ''
    const currentLedgers = projectEnabled(draftLedgers)
    const disabledIds = currentLedgers.filter((ledger) => !ledger.enabled).map((ledger) => ledger.id)
    const candidates = accountMid && disabledIds.length
      ? await window.bilimiDesktop?.previewManagedFavoriteFolderDeletion?.(accountMid, disabledIds)
      : []
    if (candidates?.length) {
      setDeletionCandidates(candidates)
      return
    }
    await onSyncLedgers(currentLedgers, { deleteDisabled: false })
  }
  const confirmManagedDeletion = async () => {
    if (draftMutationLocked) return
    const accountMid = window.bilimiDesktop?.readBilibiliAccountMid ? await window.bilimiDesktop.readBilibiliAccountMid() : ''
    if (!accountMid || !deletionCandidates || !deletionConfirmed) return
    await window.bilimiDesktop?.deleteManagedFavoriteFolders?.(accountMid, deletionCandidates.map((candidate) => candidate.logicalLedgerId))
    await onSyncLedgers(draftLedgers, { deleteDisabled: false })
    setDeletionCandidates(null); setDeletionConfirmed(false); setDeletionReviewOpen(false)
  }
  return <section className="favorite-ledger-panel__ledger-list" aria-label="收藏夹">
    <div className="favorite-ledger-panel__workspace">
      <section className="favorite-ledger-panel__checklist" aria-label="收藏夹规则">
        <div className="favorite-ledger-panel__category-header"><button type="button" className="favorite-ledger-panel__help-toggle favorite-ledger-panel__section-title" aria-label={`${ledgerHintExpanded ? '收起' : '展开'}收藏夹`} aria-expanded={ledgerHintExpanded} title={LEDGER_SYNC_HINT} onClick={() => setLedgerHintExpanded((open) => !open)}><h3>收藏夹</h3><Chevron /></button><div className="favorite-ledger-panel__category-actions"><button type="button" disabled={draftMutationLocked} onClick={() => setResetConfirmOpen(true)}>重置</button><FavoriteLedgerEnableSummary store={enableStore}>{({ allOperableEnabled }) => <button type="button" data-testid="favorite-ledger-cancel-all" disabled={draftMutationLocked} onClick={toggleAll}>{allOperableEnabled ? '取消全选' : '全选'}</button>}</FavoriteLedgerEnableSummary><button type="button" disabled={draftMutationLocked} onClick={() => void requestSync()}>同步</button></div></div>
        {ledgerHintExpanded ? <div className="favorite-ledger-panel__sync-hint">{LEDGER_SYNC_HINTS.map((hint) => <p key={hint}>{hint}</p>)}</div> : null}
        <div className="favorite-ledger-panel__chips">{ledgersToDisplay.map((ledger) => {
          const disabledBySystem = isSystemDisabled(ledger)
          const unsaved = ledgerHasUnsavedChanges(ledger)
          const ledgerLabel = `${disabledBySystem ? '（已停用）' : unsaved ? '（未保存）' : ''}${displayTitle(ledger.displayName) || ledger.displayName}`
          const dropPosition = dragTarget === ledger.id ? 'before' : undefined
          return <div key={ledger.id} data-testid={`favorite-ledger-chip-${ledger.id}`} className="favorite-ledger-panel__chip-item"
            data-dragging={draggedLedgerId === ledger.id ? 'true' : undefined} data-drop-position={dropPosition}
            data-default-system-disabled={disabledBySystem ? 'true' : undefined} aria-label={dropPosition ? `插入到${displayTitle(ledger.displayName)}上方` : undefined}
            onDragOver={(event) => dragOver(ledger.id, event)} onDrop={(event) => dropOn(ledger.id, event)}>
            <FavoriteLedgerEnableButton store={enableStore} id={ledger.id} onToggle={() => toggle(ledger.id)}>{({ enabled, toggle: toggleEnabled }) => {
              const ledgerDisplayName = ledger.displayName
              return <>
              <button type="button" draggable={!draftMutationLocked} aria-label={ledgerLabel} title={ledgerDisplayName} aria-pressed={enabled && !disabledBySystem}
                onDragStart={(event) => beginDrag(ledger.id, event)} onDragEnd={() => { setDraggedLedgerId(null); setDragTarget(null) }} onClick={() => {
                if (activeLedgerId === ledger.id) {
                  if (draftMutationLocked) return
                  setActiveLedgerId(null)
                  setNewLedger(false)
                  return
                }
                setActiveLedgerId(ledger.id)
                setNewLedger(false)
              }}>{ledgerLabel}</button>
              <button type="button" draggable={false} className="favorite-ledger-panel__chip-action" aria-label={`${enabled ? '移出同步' : '加入同步'} ${ledgerDisplayName}`} data-enabled={enabled && !disabledBySystem} disabled={draftMutationLocked || !isOperable(ledger)} onDragStart={(event) => event.preventDefault()} onClick={toggleEnabled}>{enabled && !disabledBySystem ? '✓' : '+'}</button>
            </>
            }}</FavoriteLedgerEnableButton>
          </div>
        })}</div>
        {recoveredRemoteDrafts.length ? <p className="favorite-ledger-panel__notice">识别到一个可启用的 bilimi 工作夹。设置、保存并启用后才参与分类；更换设备整理时，建议先完成本地数据迁移。</p> : null}
        <div className="favorite-ledger-panel__list-toggle"><button type="button" disabled={draftMutationLocked} onClick={add}>新建收藏夹</button>{canToggleLedgerList ? <button type="button" aria-expanded={ledgerListExpanded} onClick={() => setLedgerListExpanded((expanded) => !expanded)}>{ledgerListExpanded ? '折叠' : '展开'}</button> : null}</div>
      </section>
      {missingLedgerIds.length ? <p className="favorite-ledger-panel__notice" role="alert">部分 Bilimi 收藏夹尚未备册。</p> : null}
      {active ? <section ref={editorRef} className="favorite-ledger-panel__editor" aria-label="当前收藏夹" data-ledger-id={active.id}><div className="favorite-ledger-panel__editor-title"><strong>{activeHasUnsavedChanges ? '（未保存）' : ''}{newLedger ? '新建收藏夹' : '正在编辑：'}{active.displayName}</strong><div className="favorite-ledger-panel__editor-actions"><button type="button" disabled={!valid || draftMutationLocked} onClick={() => void save()}>保存</button><button type="button" disabled={draftMutationLocked} onClick={close}>取消</button>{!active.isDefault ? <button type="button" disabled={draftMutationLocked} onClick={() => { const next = draftLedgers.filter((ledger) => ledger.id !== active.id); setDraftLedgers(next); void onSaveLedgers(next, { deleteDisabled: false }); setActiveLedgerId(null); setNewLedger(false) }}>删除</button> : null}</div></div>
        {draftRuleAnalysis ? <div className="favorite-ledger-panel__rule-analysis" role="status">
          <span>{draftRuleAnalysis.status === 'canceling' ? '正在取消分析…' : `正在分析 ${draftRuleAnalysis.completedItemCount} / ${draftRuleAnalysis.totalItemCount} 条`}</span>
          <progress aria-label="收藏夹规则分析进度" value={draftRuleAnalysis.completedItemCount} max={Math.max(1, draftRuleAnalysis.totalItemCount)}
            aria-valuemin={0} aria-valuenow={draftRuleAnalysis.completedItemCount} aria-valuemax={Math.max(1, draftRuleAnalysis.totalItemCount)} />
          <button type="button" disabled={draftRuleAnalysis.status === 'canceling'} onClick={onCancelDraftRuleAnalysis}>取消分析</button>
        </div> : draftRuleAnalysisError ? <p className="favorite-ledger-panel__notice" role="alert">{draftRuleAnalysisError}</p> : null}
        <label><span>册名 <small data-invalid={!valid}>{validation.length}/{BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH}</small></span><span className="favorite-ledger-panel__prefixed-input"><span className="favorite-ledger-panel__fixed-prefix" aria-hidden="true">{BILIMI_LEDGER_PREFIX}</span><input aria-label="册名" disabled={draftMutationLocked} value={title} onChange={(event) => update({ displayName: `${BILIMI_LEDGER_PREFIX}${event.currentTarget.value}` })} /></span>{!validation.valid ? <small role="alert">B站收藏夹名称最多20个字，当前{validation.length}个字</small> : duplicate ? <small role="alert">收藏夹名称不能重复</small> : null}</label>
        <label>收藏夹种类<select aria-label="收藏夹种类" disabled={draftMutationLocked || active.isDefault} value={active.ruleType ?? 'keyword'} onChange={(event) => update({ ruleType: event.currentTarget.value as FavoriteLedgerRuleType, keywords: [] })}>{TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label>{ruleLabel(active.ruleType)}<textarea aria-label={ruleLabel(active.ruleType)}
          disabled={draftMutationLocked}
          value={(active.ruleType ?? 'keyword') === 'deepseek' ? active.keywords.join('\n') : activeRules.localKeywords.join('、')}
          onChange={(event) => update({ keywords: composeKeywords(event.currentTarget.value, activeRules.deepSeekConstraint ?? '', active.ruleType ?? 'keyword') })} /></label>
        {(active.ruleType ?? 'keyword') !== 'deepseek' ? <label className="favorite-ledger-panel__deepseek-constraint-line">
          <span>DeepSeek约束：</span>
          <input aria-label="DeepSeek约束" disabled={draftMutationLocked} value={activeRules.deepSeekConstraint ?? ''}
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

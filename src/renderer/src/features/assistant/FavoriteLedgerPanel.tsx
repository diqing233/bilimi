import { BILIMI_LEDGER_PREFIX, createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type { AssistantAutomationResult, FavoriteLedger } from '@shared/types'
import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import type { FavoriteLedgerCandidate } from '../favorites/favoriteLedgerInsights'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'
import { AssistantActionButton } from './AssistantActionButton'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'

type FavoriteLedgerPanelProps = {
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  onEnsureLedgers: () => Promise<AssistantAutomationResult>
  onSaveLedgers: (ledgers: FavoriteLedger[]) => Promise<AssistantAutomationResult> | void
  onScanOldFavorites: () => Promise<FavoriteLedgerPreview>
  onExecuteOldFavoritePlan: (items: FavoriteLedgerPreviewItem[]) => Promise<AssistantAutomationResult>
}

function splitKeywords(value: string) {
  return value
    .split(/[\s,，、/]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
}

function customLedgerId(name: string) {
  const base = name.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'ledger'
  return `custom-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function canDeleteLedger(ledger: FavoriteLedger) {
  return !ledger.isDefault && ledger.displayName.startsWith(BILIMI_LEDGER_PREFIX)
}

function alreadyHasLedger(ledgers: FavoriteLedger[], displayName: string) {
  return ledgers.some((ledger) => ledger.displayName === displayName)
}

function candidateLedgerId(candidate: FavoriteLedgerCandidate) {
  return `custom-${candidate.kind}-${candidate.sourceName
    .replace(/\W+/g, '-')
    .replace(/^-|-$/g, '')}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '未知错误')
}

function stripBilimiLedgerPrefix(displayName: string) {
  return displayName.replace(/^Bilimi[·\s-]*/, '').trim()
}

function isBilimiLedger(ledger: FavoriteLedger) {
  return ledger.displayName.startsWith(BILIMI_LEDGER_PREFIX)
}

function prefixedBilimiLedgerName(name: string) {
  return `${BILIMI_LEDGER_PREFIX}${stripBilimiLedgerPrefix(name)}`
}

function reorderLedgers(ledgers: FavoriteLedger[], draggedLedgerId: string, targetLedgerId: string) {
  if (draggedLedgerId === targetLedgerId) {
    return ledgers
  }

  const draggedIndex = ledgers.findIndex((ledger) => ledger.id === draggedLedgerId)
  const targetIndex = ledgers.findIndex((ledger) => ledger.id === targetLedgerId)
  if (draggedIndex < 0 || targetIndex < 0) {
    return ledgers
  }

  const nextLedgers = [...ledgers]
  const [draggedLedger] = nextLedgers.splice(draggedIndex, 1)
  const nextTargetIndex = nextLedgers.findIndex((ledger) => ledger.id === targetLedgerId)
  const insertionIndex = draggedIndex < targetIndex ? nextTargetIndex + 1 : nextTargetIndex
  nextLedgers.splice(insertionIndex, 0, draggedLedger)
  return nextLedgers
}

function withSequentialPriorities(ledgers: FavoriteLedger[]) {
  return ledgers.map((ledger, index) => ({
    ...ledger,
    priority: (index + 1) * 10
  }))
}

function saveStatusMessage(result: AssistantAutomationResult | void) {
  const message = result?.message === 'favorite ledgers saved' ? '掌库已同步。' : result?.message
  return message ? `保存成功：${message}` : '保存成功：掌库已同步。'
}

const COLLAPSED_LEDGER_COUNT = 15
type OldFavoriteGuideStep = 'scan' | 'generated' | 'preview' | 'confirm'
const OLD_FAVORITE_GUIDE_STEPS: Array<{ id: OldFavoriteGuideStep; label: string }> = [
  { id: 'scan', label: '扫描概览' },
  { id: 'generated', label: '生成收藏夹' },
  { id: 'preview', label: '归档预览' },
  { id: 'confirm', label: '确认执行' }
]

function visibleLedgers(ledgers: FavoriteLedger[], expanded: boolean) {
  if (expanded) {
    return ledgers
  }

  return ledgers.slice(0, COLLAPSED_LEDGER_COUNT)
}

export function FavoriteLedgerPanel({
  ledgers,
  missingLedgerIds,
  onEnsureLedgers,
  onSaveLedgers,
  onScanOldFavorites,
  onExecuteOldFavoritePlan
}: FavoriteLedgerPanelProps) {
  const [draftLedgers, setDraftLedgers] = useState<FavoriteLedger[]>(ledgers)
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null)
  const [activeLedgerIndex, setActiveLedgerIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<FavoriteLedgerPreview | null>(null)
  const [setupPromptVisible, setSetupPromptVisible] = useState(false)
  const [selectedDefaultLedgerIds, setSelectedDefaultLedgerIds] = useState<Set<string>>(
    () => new Set(ledgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
  )
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set())
  const [selectedOldFavoriteAids, setSelectedOldFavoriteAids] = useState<Set<number>>(new Set())
  const [status, setStatus] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draggedLedgerId, setDraggedLedgerId] = useState<string | null>(null)
  const [dragTargetLedgerId, setDragTargetLedgerId] = useState<string | null>(null)
  const [ledgerListExpanded, setLedgerListExpanded] = useState(false)
  const [oldFavoriteStep, setOldFavoriteStep] = useState<OldFavoriteGuideStep>('scan')
  const ledgerNamesById = useMemo(
    () => Object.fromEntries(draftLedgers.map((ledger) => [ledger.id, ledger.displayName])),
    [draftLedgers]
  )
  const activeLedger = useMemo(
    () =>
      activeLedgerIndex === null
        ? null
        : (draftLedgers[activeLedgerIndex] ?? null),
    [activeLedgerIndex, draftLedgers]
  )
  const activeLedgerHasUnsavedChanges = useMemo(() => {
    if (!activeLedger) {
      return false
    }

    const originalLedger = ledgers.find((ledger) => ledger.id === activeLedger.id)
    return JSON.stringify(activeLedger) !== JSON.stringify(originalLedger ?? null)
  }, [activeLedger, ledgers])
  useEffect(() => {
    setDraftLedgers(ledgers)
    setSelectedDefaultLedgerIds(
      new Set(ledgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
    )
    setActiveLedgerId(null)
    setActiveLedgerIndex(null)
    finishLedgerDrag()
  }, [ledgers])

  function showSetupPrompt() {
    setSetupPromptVisible(true)
    setStatus(null)
    setSaveStatus(null)
  }

  async function scanPersonalizedSetup() {
    setSetupPromptVisible(false)
    try {
      await syncCheckedLedgersForSetupScan()
    } catch {
      return
    }
    await scanOldFavorites('setup')
  }

  function addBlankLedger() {
    const nextLedger = {
      id: customLedgerId('new-ledger'),
      displayName: BILIMI_LEDGER_PREFIX,
      keywords: [],
      enabled: true,
      priority: (draftLedgers.length + 1) * 10,
      isDefault: false
    }
    const nextLedgers = [...draftLedgers, nextLedger]

    setDraftLedgers(nextLedgers)
    setActiveLedgerId(nextLedger.id)
    setActiveLedgerIndex(nextLedgers.length - 1)
    setLedgerListExpanded(true)
    setSaveStatus(null)
  }

  function resetLedgers() {
    const defaultLedgers = createDefaultFavoriteLedgers()
    setDraftLedgers(defaultLedgers)
    setSelectedDefaultLedgerIds(
      new Set(defaultLedgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
    )
    setActiveLedgerId(null)
    setActiveLedgerIndex(null)
    setSelectedCandidateKeys(new Set())
    setLedgerListExpanded(false)
    setStatus(null)
    setSaveStatus(null)
  }

  function deleteLedger(ledgerId: string) {
    setDraftLedgers((currentLedgers) => {
      const ledgerIndex =
        activeLedgerIndex !== null && currentLedgers[activeLedgerIndex]?.id === ledgerId
          ? activeLedgerIndex
          : currentLedgers.findIndex((ledger) => ledger.id === ledgerId)
      const nextLedgers = currentLedgers.filter(
        (ledger, index) => index !== ledgerIndex || !canDeleteLedger(ledger)
      )
      if (ledgerId === activeLedgerId) {
        setActiveLedgerId(null)
        setActiveLedgerIndex(null)
      }
      setSaveStatus(null)
      return nextLedgers
    })
  }

  function toggleLedger(ledgerId: string) {
    const ledger = draftLedgers.find((item) => item.id === ledgerId)
    if (ledger?.isDefault) {
      toggleDefaultLedger(ledgerId)
    }

    setDraftLedgers(
      draftLedgers.map((ledger) =>
        ledger.id === ledgerId
          ? {
              ...ledger,
              enabled: !ledger.enabled
            }
          : ledger
      )
    )
  }

  function selectLedger(ledger: FavoriteLedger, ledgerIndex: number) {
    if (activeLedgerId && activeLedgerId !== ledger.id) {
      if (activeLedgerHasUnsavedChanges) {
        setSaveStatus('当前收藏夹有未保存修改，请先保存。')
        return
      }

      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
      return
    }

    if (activeLedgerId === ledger.id && activeLedgerIndex !== ledgerIndex) {
      if (activeLedgerHasUnsavedChanges) {
        setSaveStatus('当前收藏夹有未保存修改，请先保存。')
        return
      }

      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
      return
    }

    setActiveLedgerId(ledger.id)
    setActiveLedgerIndex(ledgerIndex)
    setSaveStatus(null)
  }

  function closeActiveLedgerEditor() {
    if (!activeLedger) {
      return
    }

    if (activeLedgerHasUnsavedChanges) {
      setSaveStatus('当前收藏夹有未保存修改，请先保存。')
      return
    }

    setActiveLedgerId(null)
    setActiveLedgerIndex(null)
  }

  function handlePanelClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null
    if (
      !target ||
      target.closest(
        '.favorite-ledger-panel__editor, .favorite-ledger-panel__chips, .favorite-ledger-panel__list-toggle, .favorite-ledger-panel__category-actions, .favorite-ledger-panel__toolbar, .favorite-ledger-panel__preview, .favorite-ledger-panel__old-favorites-guide, .favorite-ledger-panel__setup-prompt'
      )
    ) {
      return
    }

    closeActiveLedgerEditor()
  }

  function updateActiveLedger(patch: Partial<Pick<FavoriteLedger, 'displayName' | 'keywords'>>) {
    if (!activeLedger) {
      return
    }

    setDraftLedgers((currentLedgers) => {
      setSaveStatus(null)
      return currentLedgers.map((ledger) =>
        ledger.id === activeLedger.id
          ? {
              ...ledger,
              ...patch
            }
          : ledger
      )
    })
  }

  function updateActiveLedgerName(name: string) {
    if (!activeLedger) {
      return
    }

    updateActiveLedger({
      displayName: isBilimiLedger(activeLedger) ? prefixedBilimiLedgerName(name) : name
    })
  }

  function candidateKey(candidate: FavoriteLedgerCandidate) {
    return `${candidate.kind}:${candidate.sourceName}`
  }

  function toggleDefaultLedger(ledgerId: string) {
    setSaveStatus(null)
    setSelectedDefaultLedgerIds((current) => {
      const next = new Set(current)
      if (next.has(ledgerId)) {
        next.delete(ledgerId)
      } else {
        next.add(ledgerId)
      }
      return next
    })
  }

  function toggleCandidate(candidate: FavoriteLedgerCandidate) {
    const key = candidateKey(candidate)
    setSelectedCandidateKeys((current) => {
      setSaveStatus(null)
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  function candidateToLedger(candidate: FavoriteLedgerCandidate, priority: number): FavoriteLedger {
    return {
      id: candidateLedgerId(candidate),
      displayName: candidate.displayName,
      keywords: candidate.keywords,
      enabled: true,
      priority,
      isDefault: false
    }
  }

  function adoptCandidate(candidate: FavoriteLedgerCandidate) {
    if (alreadyHasLedger(draftLedgers, candidate.displayName)) {
      setStatus('此册目已在掌库。')
      return
    }

    setDraftLedgers([
      ...draftLedgers,
      {
        id: customLedgerId(candidate.displayName),
        displayName: candidate.displayName,
        keywords: candidate.keywords,
        enabled: true,
        priority: draftLedgers.length + 100,
        isDefault: false
      }
    ])
    setStatus(`已采纳 ${candidate.displayName}，保存后生效。`)
    setSaveStatus(null)
  }

  function handleLedgerDragStart(event: DragEvent<HTMLDivElement>, ledgerId: string) {
    setDraggedLedgerId(ledgerId)
    setDragTargetLedgerId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', ledgerId)
  }

  function handleLedgerDragOver(event: DragEvent<HTMLDivElement>, targetLedgerId: string) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!draggedLedgerId || draggedLedgerId === targetLedgerId) {
      setDragTargetLedgerId(null)
      return
    }

    if (dragTargetLedgerId === targetLedgerId) {
      return
    }

    setDragTargetLedgerId(targetLedgerId)
  }

  function handleLedgerDrop(event: DragEvent<HTMLDivElement>, targetLedgerId: string) {
    event.preventDefault()
    const sourceLedgerId = event.dataTransfer?.getData('text/plain') || draggedLedgerId
    setDraggedLedgerId(null)
    setDragTargetLedgerId(null)
    if (!sourceLedgerId) {
      return
    }

    setDraftLedgers((currentLedgers) => withSequentialPriorities(reorderLedgers(currentLedgers, sourceLedgerId, targetLedgerId)))
    setSaveStatus(null)
  }

  function finishLedgerDrag() {
    setDraggedLedgerId(null)
    setDragTargetLedgerId(null)
  }

  function buildLedgersToSave(includeSelectedCandidates = true) {
    const candidates = preview?.insights?.candidateLedgers ?? []
    const selectedCandidates = candidates.filter((candidate) =>
      selectedCandidateKeys.has(candidateKey(candidate))
    )
    const nextLedgers = withSequentialPriorities(
      draftLedgers.map((ledger) =>
        ledger.isDefault
          ? {
              ...ledger,
              enabled: selectedDefaultLedgerIds.has(ledger.id)
            }
          : ledger
      )
    )

    for (const candidate of includeSelectedCandidates ? selectedCandidates : []) {
      if (alreadyHasLedger(nextLedgers, candidate.displayName)) {
        continue
      }

      nextLedgers.push(candidateToLedger(candidate, (nextLedgers.length + 1) * 10))
    }

    return nextLedgers
  }

  async function saveLedgers() {
    const nextLedgers = buildLedgersToSave()

    setBusy(true)
    setStatus(null)
    setSaveStatus('正在保存...')
    try {
      const result = await onSaveLedgers(nextLedgers)
      setSaveStatus(saveStatusMessage(result))
      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
    } catch (error) {
      setSaveStatus(`同步未完成：${errorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function syncCheckedLedgersForSetupScan() {
    const nextLedgers = buildLedgersToSave(false)

    setBusy(true)
    setStatus(null)
    setSaveStatus('正在同步已勾选收藏夹...')
    try {
      const result = await onSaveLedgers(nextLedgers)
      setSaveStatus(saveStatusMessage(result))
      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
    } catch (error) {
      setSaveStatus(`同步未完成：${errorMessage(error)}`)
      throw error
    } finally {
      setBusy(false)
    }
  }

  async function scanOldFavorites(mode: 'setup' | 'organize' = 'organize') {
    setBusy(true)
    setSaveStatus(null)
    try {
      const nextPreview = await onScanOldFavorites()
      if (nextPreview.ok === false) {
        setPreview(null)
        setStatus(`整理旧藏未完成：${nextPreview.message || '请稍后重试。'}`)
        return
      }

      setPreview(nextPreview)
      setOldFavoriteStep('scan')
      setSelectedOldFavoriteAids(
        new Set(
          nextPreview.items
            .filter((item) => item.selected && !item.alreadyInTarget && !item.reviewRequired)
            .map((item) => item.aid)
        )
      )
      setStatus(
        mode === 'setup'
          ? `已扫描 ${nextPreview.insights?.totalVideos ?? nextPreview.items.length} 条旧藏，可勾选库房后同步。`
          : `已扫描 ${nextPreview.items.length} 条旧藏，可勾选后整理。`
      )
    } catch (error) {
      setPreview(null)
      setStatus(`整理旧藏未完成：${errorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  function toggleOldFavorite(aid: number) {
    setSelectedOldFavoriteAids((current) => {
      const next = new Set(current)
      if (next.has(aid)) {
        next.delete(aid)
      } else {
        next.add(aid)
      }
      return next
    })
  }

  async function executeOldFavoritePlan() {
    if (!preview) {
      return
    }

    setBusy(true)
    setSaveStatus(null)
    try {
      const selectedItems = preview.items.filter((item) => selectedOldFavoriteAids.has(item.aid))
      const result = await onExecuteOldFavoritePlan(selectedItems)
      setStatus(result.message)
    } finally {
      setBusy(false)
    }
  }

  const ledgersToDisplay = visibleLedgers(draftLedgers, ledgerListExpanded)
  const canToggleLedgerList = draftLedgers.length > ledgersToDisplay.length || ledgerListExpanded
  const selectedOldFavoriteItems = preview?.items.filter((item) => selectedOldFavoriteAids.has(item.aid)) ?? []
  const missingOldFavoriteTargetNames = Array.from(
    new Set(
      selectedOldFavoriteItems
        .filter((item) => !item.targetFolderId)
        .map((item) => item.targetDisplayName || ledgerNamesById[item.targetLedgerId] || item.targetLedgerId)
    )
  )
  const oldFavoriteTargetWarning =
    missingOldFavoriteTargetNames.length > 0
      ? `掌库和 B 站收藏夹不一致，${missingOldFavoriteTargetNames.join('、')} 收藏夹缺失，建议同步之后再确认整理。`
      : null
  const autoSelectedOldFavoriteCount =
    preview?.items.filter((item) => item.selected && !item.alreadyInTarget && !item.reviewRequired).length ?? 0
  const reviewRequiredOldFavoriteCount = preview?.items.filter((item) => item.reviewRequired).length ?? 0
  const alreadyInTargetOldFavoriteCount = preview?.items.filter((item) => item.alreadyInTarget).length ?? 0
  const skippedSourceFolderCount = preview?.skippedSourceFolderTitles.length ?? 0

  return (
    <section
      role="dialog"
      aria-label="掌库"
      className="favorite-ledger-panel"
      onClick={handlePanelClick}
    >
      <div className="favorite-ledger-panel__topbar">
        <div className="favorite-ledger-panel__header">
          <h2 className="sr-only">掌库</h2>
        </div>

        <div className="favorite-ledger-panel__toolbar">
          <AssistantActionButton
            type="button"
            aria-label="备册"
            disabled={busy}
            onClick={showSetupPrompt}
            icon={clickedPetUrl}
            iconAlt="小咪备册"
            badge="备"
            label="备册"
            description="生成专属 Bilimi 收藏夹，以便批阅和归类"
          />
          <AssistantActionButton
            type="button"
            aria-label="整理旧藏"
            disabled={busy}
            onClick={() => void scanOldFavorites()}
            icon={hintPetUrl}
            iconAlt="小咪整理旧藏"
            badge="整"
            label="整理旧藏"
            description="扫描并整理旧收藏，放进 Bilimi 收藏里"
          />
        </div>
        <p className="favorite-ledger-panel__safety-note">
          同一个视频可以同时保存在不同的收藏夹里，小咪不会删除主人的旧收藏哦，安心使用吧
        </p>
      </div>

      {missingLedgerIds.length > 0 ? (
        <p className="favorite-ledger-panel__notice">
          尚缺 {missingLedgerIds.map((id) => ledgerNamesById[id] ?? id).join('、')}。
        </p>
      ) : null}

      {setupPromptVisible ? (
        <section className="favorite-ledger-panel__setup-prompt" aria-label="备册确认">
          <strong>是否根据旧藏生成你的专属库房？</strong>
          <div>
            <button type="button" disabled={busy} onClick={() => void scanPersonalizedSetup()}>
              扫描旧藏生成
            </button>
            <button type="button" disabled={busy} onClick={() => setSetupPromptVisible(false)}>
              先手动勾选
            </button>
          </div>
        </section>
      ) : null}

      {status ? (
        <p className="favorite-ledger-panel__status" role="status">
          {status}
        </p>
      ) : null}
      {saveStatus ? (
        <p className="favorite-ledger-panel__save-status" role="status">
          {saveStatus}
        </p>
      ) : null}

      <div className="favorite-ledger-panel__workspace">
        <section className="favorite-ledger-panel__checklist" aria-label="收藏夹">
        <div className="favorite-ledger-panel__category-header">
          <h3>收藏夹</h3>
          <div className="favorite-ledger-panel__category-actions">
            <button type="button" disabled={busy} onClick={resetLedgers}>
              重置
            </button>
            <button type="button" disabled={busy} onClick={() => void saveLedgers()}>
              同步
            </button>
          </div>
        </div>
        <div className="favorite-ledger-panel__chips">
          {ledgersToDisplay.map((ledger, ledgerIndex) => {
            const ledgerEnabled = ledger.isDefault
              ? selectedDefaultLedgerIds.has(ledger.id)
              : ledger.enabled
            const ledgerLabel = ledger.displayName.replace(/^Bilimi[·\s-]*/, '')
            const selectLedgerLabel = ledgerLabel || '新建收藏夹'
            return (
              <div
                key={`${ledger.id}-${ledgerIndex}`}
                className="favorite-ledger-panel__chip-item"
                draggable
                data-dragging={draggedLedgerId === ledger.id}
                data-drop-target={dragTargetLedgerId === ledger.id}
                onDragStart={(event) => handleLedgerDragStart(event, ledger.id)}
                onDragOver={(event) => handleLedgerDragOver(event, ledger.id)}
                onDrop={(event) => handleLedgerDrop(event, ledger.id)}
                onDragEnd={finishLedgerDrag}
              >
                <button
                  type="button"
                  aria-label={ledgerLabel ? undefined : `选择${selectLedgerLabel}`}
                  aria-pressed={ledgerEnabled}
                  data-active={activeLedger?.id === ledger.id && activeLedgerIndex === ledgerIndex}
                  onClick={() => selectLedger(ledger, ledgerIndex)}
                >
                  {ledgerLabel}
                </button>
                <button
                  type="button"
                  className="favorite-ledger-panel__chip-action"
                  aria-label={`${ledgerEnabled ? '移出同步' : '加入同步'} ${ledger.displayName}`}
                  data-enabled={ledgerEnabled}
                  onClick={() => toggleLedger(ledger.id)}
                >
                  {ledgerEnabled ? '✓' : '+'}
                </button>
              </div>
            )
          })}
        </div>
        <div className="favorite-ledger-panel__list-toggle">
          <button type="button" disabled={busy} onClick={addBlankLedger}>
            新建收藏夹
          </button>
          {canToggleLedgerList ? (
            <button
              type="button"
              aria-expanded={ledgerListExpanded}
              disabled={busy}
              onClick={() => setLedgerListExpanded((current) => !current)}
            >
              {ledgerListExpanded ? '折叠' : '展开'}
            </button>
          ) : null}
        </div>
        </section>

      {activeLedger ? (
        <section className="favorite-ledger-panel__editor" aria-label="当前收藏夹">
          <div className="favorite-ledger-panel__editor-title">
            <strong>正在编辑：{activeLedger.displayName}</strong>
            <div className="favorite-ledger-panel__editor-actions">
              <button type="button" disabled={busy} onClick={() => void saveLedgers()}>
                保存
              </button>
              {!activeLedger.isDefault ? (
                <button
                  type="button"
                  aria-label={`删除 ${activeLedger.displayName}`}
                  onClick={() => deleteLedger(activeLedger.id)}
                  disabled={!canDeleteLedger(activeLedger)}
                >
                  删除
                </button>
              ) : null}
            </div>
          </div>
        <label>
          册名
          {isBilimiLedger(activeLedger) ? (
            <span className="favorite-ledger-panel__prefixed-input">
              <span className="favorite-ledger-panel__fixed-prefix" aria-hidden="true">
                {BILIMI_LEDGER_PREFIX}
              </span>
              <input
                aria-label="册名"
                value={stripBilimiLedgerPrefix(activeLedger.displayName)}
                onChange={(event) => updateActiveLedgerName(event.currentTarget.value)}
              />
            </span>
          ) : (
            <input
              aria-label="册名"
              value={activeLedger.displayName}
              onChange={(event) => updateActiveLedgerName(event.currentTarget.value)}
            />
          )}
        </label>
          <label>
            关键词
            <textarea
              value={activeLedger.keywords.join('、')}
              onChange={(event) =>
                updateActiveLedger({ keywords: splitKeywords(event.currentTarget.value) })
              }
            />
          </label>
          <p className="favorite-ledger-panel__keyword-hint">
            建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。
          </p>
          <p className="favorite-ledger-panel__keyword-hint">
            不同关键词用顿号或空格隔开，逗号、斜杠也能识别。
          </p>
          <div className="favorite-ledger-panel__keyword-actions">
          </div>
        </section>
      ) : (
        <div className="favorite-ledger-panel__editor-placeholder" aria-hidden="true" />
      )}

      </div>

      {preview ? (
        <section className="favorite-ledger-panel__old-favorites-guide" aria-label="整理旧藏向导">
          <div className="favorite-ledger-panel__guide-header">
            <h3>整理旧藏</h3>
            <nav className="favorite-ledger-panel__guide-steps" aria-label="整理旧藏步骤">
              {OLD_FAVORITE_GUIDE_STEPS.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  aria-current={oldFavoriteStep === step.id ? 'step' : undefined}
                  onClick={() => setOldFavoriteStep(step.id)}
                >
                  {step.label}
                </button>
              ))}
            </nav>
          </div>

          {oldFavoriteStep === 'scan' ? (
            <section className="favorite-ledger-panel__insights" aria-label="基础数据">
              <h4>基础数据</h4>
              <div className="favorite-ledger-panel__guide-metrics">
                <article>
                  <span>共扫描</span>
                  <strong>{preview.insights?.totalVideos ?? preview.items.length}</strong>
                </article>
                <article>
                  <span>可自动归档</span>
                  <strong>{autoSelectedOldFavoriteCount}</strong>
                </article>
                <article>
                  <span>需复核</span>
                  <strong>{reviewRequiredOldFavoriteCount}</strong>
                </article>
                <article>
                  <span>已存在</span>
                  <strong>{alreadyInTargetOldFavoriteCount}</strong>
                </article>
                <article>
                  <span>跳过来源</span>
                  <strong>{skippedSourceFolderCount}</strong>
                </article>
              </div>
              {preview.insights ? (
                <>
                  <p>共扫描 {preview.insights.totalVideos} 条旧藏</p>
                  <div className="favorite-ledger-panel__insight-columns">
                    <div>
                      <strong>常追 UP</strong>
                      <ul>
                        {preview.insights.topAuthors.slice(0, 3).map((author) => (
                          <li key={author.name}>
                            {author.name} {author.count}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>高频标签</strong>
                      <ul>
                        {preview.insights.topTags.slice(0, 5).map((tag) => (
                          <li key={tag.name}>
                            {tag.name} {tag.count}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>分区</strong>
                      <ul>
                        {preview.insights.topCategories.slice(0, 3).map((category) => (
                          <li key={category.name}>
                            {category.name} {category.count}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>来源收藏夹</strong>
                      <ul>
                        {(preview.insights.sourceFolders ?? []).slice(0, 5).map((folder) => (
                          <li key={folder.name}>
                            {folder.name} {folder.count}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {oldFavoriteStep === 'generated' ? (
            <section className="favorite-ledger-panel__candidates" aria-label="专属收藏夹候选">
              <h4>专属收藏夹候选</h4>
              <p>已先同步当前勾选的收藏夹；若勾选下方候选，请再点“同步”创建。</p>
              {preview.insights?.candidateLedgers.length ? (
                preview.insights.candidateLedgers.map((candidate) => (
                  <article key={`${candidate.kind}-${candidate.sourceName}`}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={candidate.displayName}
                        checked={selectedCandidateKeys.has(candidateKey(candidate))}
                        disabled={alreadyHasLedger(draftLedgers, candidate.displayName)}
                        onChange={() => toggleCandidate(candidate)}
                      />
                      <span>
                        <strong>{candidate.displayName}</strong>
                        <small>
                          {candidate.aiEnhanced ? 'DeepSeek 增强' : '本地统计'} · {candidate.reason}
                        </small>
                        <small>{candidate.keywords.join('、')}</small>
                      </span>
                    </label>
                  </article>
                ))
              ) : (
                <p>暂无新收藏夹候选，可直接查看归档预览。</p>
              )}
            </section>
          ) : null}

          {oldFavoriteStep === 'preview' ? (
            <div className="favorite-ledger-panel__preview">
              <h4>归档预览</h4>
              {preview.items.length > 0 ? (
                preview.items.map((item) => (
                  <article key={`${item.sourceFolderTitle}-${item.aid}`}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`整理 ${item.title}`}
                        checked={selectedOldFavoriteAids.has(item.aid)}
                        disabled={item.alreadyInTarget}
                        onChange={() => toggleOldFavorite(item.aid)}
                      />
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.sourceFolderTitle} → {item.targetDisplayName}
                          {item.alreadyInTarget ? ' · 已在目标' : ''}
                          {item.reviewRequired ? ' · 需要复核' : ''}
                        </small>
                      </span>
                    </label>
                  </article>
                ))
              ) : (
                <p>暂无可归册旧藏。</p>
              )}
            </div>
          ) : null}

          {oldFavoriteStep === 'confirm' ? (
            <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
              <h4>确认执行</h4>
              <p>已选择 {selectedOldFavoriteItems.length} 条旧藏</p>
              {oldFavoriteTargetWarning ? (
                <p className="favorite-ledger-panel__confirm-warning" role="alert">
                  {oldFavoriteTargetWarning}
                </p>
              ) : null}
              <p>只会追加到 Bilimi 收藏夹，不会删除、移动或取消原收藏。</p>
              <button
                type="button"
                disabled={busy || selectedOldFavoriteItems.length === 0 || Boolean(oldFavoriteTargetWarning)}
                onClick={() => void executeOldFavoritePlan()}
              >
                确认整理
              </button>
            </section>
          ) : null}
        </section>
      ) : null}

    </section>
  )
}

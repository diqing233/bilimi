import { BILIMI_LEDGER_PREFIX, createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type { AssistantAutomationResult, FavoriteLedger } from '@shared/types'
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import type { FavoriteLedgerCandidate } from '../favorites/favoriteLedgerInsights'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'

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
  return `custom-${name.replace(/\W+/g, '-').replace(/^-|-$/g, '') || Date.now()}`
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
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(ledgers[0]?.id ?? null)
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
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draftLedgers) !== JSON.stringify(ledgers),
    [draftLedgers, ledgers]
  )
  const ledgerNamesById = useMemo(
    () => Object.fromEntries(draftLedgers.map((ledger) => [ledger.id, ledger.displayName])),
    [draftLedgers]
  )
  const activeLedger = useMemo(
    () =>
      draftLedgers.find((ledger) => ledger.id === activeLedgerId) ??
      draftLedgers[0] ??
      null,
    [activeLedgerId, draftLedgers]
  )
  useEffect(() => {
    setDraftLedgers(ledgers)
    setSelectedDefaultLedgerIds(
      new Set(ledgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
    )
    setActiveLedgerId((currentId) =>
      currentId && ledgers.some((ledger) => ledger.id === currentId) ? currentId : (ledgers[0]?.id ?? null)
    )
    finishLedgerDrag()
  }, [ledgers])

  function showSetupPrompt() {
    setSetupPromptVisible(true)
    setStatus(null)
    setSaveStatus(null)
  }

  async function scanPersonalizedSetup() {
    setSetupPromptVisible(false)
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
    setLedgerListExpanded(true)
    setSaveStatus(null)
  }

  function resetLedgers() {
    const defaultLedgers = createDefaultFavoriteLedgers()
    setDraftLedgers(defaultLedgers)
    setSelectedDefaultLedgerIds(
      new Set(defaultLedgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
    )
    setActiveLedgerId(defaultLedgers[0]?.id ?? null)
    setSelectedCandidateKeys(new Set())
    setLedgerListExpanded(false)
    setStatus(null)
    setSaveStatus(null)
  }

  function deleteLedger(ledgerId: string) {
    setDraftLedgers((currentLedgers) => {
      const nextLedgers = currentLedgers.filter((ledger) => ledger.id !== ledgerId || !canDeleteLedger(ledger))
      if (ledgerId === activeLedgerId) {
        setActiveLedgerId(nextLedgers[0]?.id ?? null)
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

  function selectLedger(ledger: FavoriteLedger) {
    setActiveLedgerId(ledger.id)
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

  async function saveLedgers() {
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

    for (const candidate of selectedCandidates) {
      if (alreadyHasLedger(nextLedgers, candidate.displayName)) {
        continue
      }

      nextLedgers.push(candidateToLedger(candidate, (nextLedgers.length + 1) * 10))
    }

    setBusy(true)
    setStatus(null)
    setSaveStatus('正在保存...')
    try {
      const result = await onSaveLedgers(nextLedgers)
      setSaveStatus(saveStatusMessage(result))
    } catch (error) {
      setSaveStatus(`同步未完成：${errorMessage(error)}`)
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

  return (
    <section role="dialog" aria-label="掌库" className="favorite-ledger-panel">
      <div className="favorite-ledger-panel__topbar">
        <div className="favorite-ledger-panel__header">
          <h2>掌库</h2>
        </div>

        <div className="favorite-ledger-panel__toolbar">
          <button type="button" disabled={busy} onClick={showSetupPrompt}>
            备册
          </button>
          <button type="button" disabled={busy} onClick={() => void scanOldFavorites()}>
            整理旧藏
          </button>
        </div>
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

      <div className="favorite-ledger-panel__workspace">
        <section className="favorite-ledger-panel__checklist" aria-label="收藏夹">
        <div className="favorite-ledger-panel__category-header">
          <h3>收藏夹</h3>
          <div className="favorite-ledger-panel__category-actions">
            <button type="button" disabled={busy} onClick={resetLedgers}>
              重置
            </button>
            <button type="button" disabled={busy} onClick={addBlankLedger}>
              新建收藏夹
            </button>
            <button type="button" disabled={busy} onClick={() => void saveLedgers()}>
              同步
            </button>
          </div>
        </div>
        <div className="favorite-ledger-panel__chips">
          {ledgersToDisplay.map((ledger) => {
            const ledgerEnabled = ledger.isDefault
              ? selectedDefaultLedgerIds.has(ledger.id)
              : ledger.enabled
            const ledgerLabel = ledger.displayName.replace(/^Bilimi[·\s-]*/, '')
            const selectLedgerLabel = ledgerLabel || '新建收藏夹'
            return (
              <div
                key={ledger.id}
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
                  data-active={activeLedger?.id === ledger.id}
                  onClick={() => selectLedger(ledger)}
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
        {canToggleLedgerList ? (
          <div className="favorite-ledger-panel__list-toggle">
            <button
              type="button"
              aria-expanded={ledgerListExpanded}
              disabled={busy}
              onClick={() => setLedgerListExpanded((current) => !current)}
            >
              {ledgerListExpanded ? '折叠' : '展开'}
            </button>
          </div>
        ) : null}
        </section>

      {activeLedger ? (
        <section className="favorite-ledger-panel__editor" aria-label="当前收藏夹">
          <div className="favorite-ledger-panel__editor-title">
            <strong>正在编辑：{activeLedger.displayName}</strong>
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
            关键词是这个册目的匹配规则：Bilimi 会用它们判断当前视频或旧藏应归到哪一册。
          </p>
          <p className="favorite-ledger-panel__keyword-hint">
            不同关键词用顿号或空格隔开，逗号、斜杠也能识别。
          </p>
          <div className="favorite-ledger-panel__keyword-actions">
            <button type="button" disabled={busy} onClick={() => void saveLedgers()}>
              保存
            </button>
            {saveStatus ? (
              <span className="favorite-ledger-panel__save-status" role="status">
                {saveStatus}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      </div>

      {preview ? (
        <div className="favorite-ledger-panel__preview">
          <h3>旧藏预览</h3>
          {preview.insights ? (
            <section className="favorite-ledger-panel__insights" aria-label="基础数据">
              <h4>基础数据</h4>
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
              {preview.insights.candidateLedgers.length > 0 ? (
                <div className="favorite-ledger-panel__candidates">
                  <strong>专属收藏夹候选</strong>
                  {preview.insights.candidateLedgers.map((candidate) => (
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
                            {candidate.aiEnhanced ? 'AI 增强' : '本地统计'} · {candidate.reason}
                          </small>
                        </span>
                      </label>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
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
                      {item.alreadyInTarget ? ' · 已在册' : ''}
                      {item.reviewRequired ? ' · 谨慎观望' : ''}
                    </small>
                  </span>
                </label>
              </article>
            ))
          ) : (
            <p>暂无可归册旧藏。</p>
          )}
          <button type="button" disabled={busy || selectedOldFavoriteAids.size === 0} onClick={() => void executeOldFavoritePlan()}>
            确认整理
          </button>
        </div>
      ) : null}

    </section>
  )
}

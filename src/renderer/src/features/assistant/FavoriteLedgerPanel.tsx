import { suggestFavoriteLedgerNames } from '@shared/favoriteLedgers'
import type { AssistantAutomationResult, FavoriteLedger } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'

type FavoriteLedgerPanelProps = {
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  onClose: () => void
  onEnsureLedgers: () => Promise<AssistantAutomationResult>
  onSaveLedgers: (ledgers: FavoriteLedger[]) => Promise<AssistantAutomationResult> | void
  onScanOldFavorites: () => Promise<FavoriteLedgerPreview>
  onExecuteOldFavoritePlan: (items: FavoriteLedgerPreviewItem[]) => Promise<AssistantAutomationResult>
}

function splitKeywords(value: string) {
  return value
    .split(/[,，]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
}

function customLedgerId(name: string) {
  return `custom-${name.replace(/\W+/g, '-').replace(/^-|-$/g, '') || Date.now()}`
}

function canDeleteLedger(ledger: FavoriteLedger) {
  return !ledger.isDefault && ledger.displayName.startsWith('Bilimi')
}

export function FavoriteLedgerPanel({
  ledgers,
  missingLedgerIds,
  onClose,
  onEnsureLedgers,
  onSaveLedgers,
  onScanOldFavorites,
  onExecuteOldFavoritePlan
}: FavoriteLedgerPanelProps) {
  const [topic, setTopic] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [keywordText, setKeywordText] = useState('')
  const [suggestedNames, setSuggestedNames] = useState<string[]>([])
  const [draftLedgers, setDraftLedgers] = useState<FavoriteLedger[]>(ledgers)
  const [preview, setPreview] = useState<FavoriteLedgerPreview | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draftLedgers) !== JSON.stringify(ledgers),
    [draftLedgers, ledgers]
  )
  const ledgerNamesById = useMemo(
    () => Object.fromEntries(draftLedgers.map((ledger) => [ledger.id, ledger.displayName])),
    [draftLedgers]
  )

  useEffect(() => {
    setDraftLedgers(ledgers)
  }, [ledgers])

  async function ensureLedgers() {
    setBusy(true)
    try {
      const result = await onEnsureLedgers()
      setStatus(result.message)
    } finally {
      setBusy(false)
    }
  }

  function recommendNames() {
    const names = suggestFavoriteLedgerNames(topic)
    setSuggestedNames(names)
    setDisplayName(names[0] ?? '')
  }

  function addLedger() {
    const name = displayName.trim()
    if (!name) {
      return
    }

    setDraftLedgers([
      ...draftLedgers,
      {
        id: customLedgerId(name),
        displayName: name,
        keywords: splitKeywords(keywordText || topic),
        enabled: true,
        priority: draftLedgers.length + 100,
        isDefault: false
      }
    ])
    setTopic('')
    setDisplayName('')
    setKeywordText('')
    setSuggestedNames([])
  }

  function deleteLedger(ledgerId: string) {
    setDraftLedgers((currentLedgers) =>
      currentLedgers.filter((ledger) => ledger.id !== ledgerId || !canDeleteLedger(ledger))
    )
  }

  function toggleLedger(ledgerId: string) {
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

  async function saveLedgers() {
    setBusy(true)
    try {
      const result = await onSaveLedgers(draftLedgers)
      if (result?.message) {
        setStatus(result.message)
      } else {
        setStatus('掌库已保存。')
      }
    } finally {
      setBusy(false)
    }
  }

  async function requestClose() {
    if (hasUnsavedChanges && window.confirm('掌库尚有未保存调整。是否保存并同步到账号收藏夹？')) {
      await saveLedgers()
    }

    onClose()
  }

  async function scanOldFavorites() {
    setBusy(true)
    try {
      const nextPreview = await onScanOldFavorites()
      setPreview(nextPreview)
      setStatus(`已呈上 ${nextPreview.items.length} 条旧藏候选。`)
    } finally {
      setBusy(false)
    }
  }

  async function executeOldFavoritePlan() {
    if (!preview) {
      return
    }

    setBusy(true)
    try {
      const result = await onExecuteOldFavoritePlan(preview.items)
      setStatus(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section role="dialog" aria-label="掌库" className="favorite-ledger-panel">
      <div className="favorite-ledger-panel__header">
        <h2>掌库</h2>
        <button type="button" onClick={() => void requestClose()}>
          合卷
        </button>
      </div>

      {missingLedgerIds.length > 0 ? (
        <p className="favorite-ledger-panel__notice">
          尚缺 {missingLedgerIds.map((id) => ledgerNamesById[id] ?? id).join('、')}。
        </p>
      ) : null}

      <div className="favorite-ledger-panel__toolbar">
        <button type="button" disabled={busy} onClick={() => void ensureLedgers()}>
          备册
        </button>
        <button type="button" disabled={busy || !hasUnsavedChanges} onClick={() => void saveLedgers()}>
          保存
        </button>
        <button type="button" disabled={busy} onClick={() => void scanOldFavorites()}>
          整理旧藏
        </button>
      </div>

      <div className="favorite-ledger-panel__list">
        {draftLedgers.map((ledger) => (
          <article key={ledger.id} className="favorite-ledger-panel__item">
            <div>
              <strong>{ledger.displayName}</strong>
              <small>{ledger.enabled ? '听差' : '暂歇'} · {ledger.keywords.join('、') || '未设关键词'}</small>
            </div>
            <div className="favorite-ledger-panel__item-actions">
              <button type="button" onClick={() => toggleLedger(ledger.id)}>
                {ledger.enabled ? '暂歇' : '复启'}
              </button>
              {canDeleteLedger(ledger) ? (
                <button
                  type="button"
                  aria-label={`删除 ${ledger.displayName}`}
                  onClick={() => deleteLedger(ledger.id)}
                >
                  删除
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      <fieldset className="favorite-ledger-panel__form">
        <legend>新立册目</legend>
        <label>
          新增主题
          <input value={topic} onChange={(event) => setTopic(event.currentTarget.value)} />
        </label>
        <button type="button" onClick={recommendNames}>
          荐名
        </button>
        {suggestedNames.length > 0 ? (
          <div className="favorite-ledger-panel__suggestions">
            {suggestedNames.map((name) => (
              <button key={name} type="button" onClick={() => setDisplayName(name)}>
                {name}
              </button>
            ))}
          </div>
        ) : null}
        <label>
          册名
          <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} />
        </label>
        <label>
          关键词
          <input
            value={keywordText}
            onChange={(event) => setKeywordText(event.currentTarget.value)}
          />
        </label>
        <button type="button" onClick={addLedger}>
          新增册目
        </button>
      </fieldset>

      {preview ? (
        <div className="favorite-ledger-panel__preview">
          <h3>旧藏预览</h3>
          {preview.items.length > 0 ? (
            preview.items.map((item) => (
              <article key={`${item.sourceFolderTitle}-${item.aid}`}>
                <strong>{item.title}</strong>
                <small>
                  {item.sourceFolderTitle} → {item.targetDisplayName}
                  {item.alreadyInTarget ? ' · 已在册' : ''}
                  {item.reviewRequired ? ' · 谨慎观望' : ''}
                </small>
              </article>
            ))
          ) : (
            <p>暂无可归册旧藏。</p>
          )}
          <button type="button" disabled={busy || preview.items.length === 0} onClick={() => void executeOldFavoritePlan()}>
            确认归册
          </button>
        </div>
      ) : null}

      {status ? (
        <p className="favorite-ledger-panel__status" role="status">
          {status}
        </p>
      ) : null}
    </section>
  )
}

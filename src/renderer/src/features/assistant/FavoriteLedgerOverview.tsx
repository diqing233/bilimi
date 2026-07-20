import { createDefaultFavoriteLedgers, stripBilimiLedgerPrefix } from '@shared/favoriteLedgers'
import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'
import { useEffect, useState } from 'react'
import { OldFavoriteModal } from './OldFavoriteModal'

type FavoriteLedgerOverviewProps = {
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  onEnsureLedgers: () => Promise<unknown>
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onOpenFavoritePage?: () => Promise<unknown> | void
  onCreateLocalLedger: (title: string) => Promise<unknown> | void
  canCreateLocalLedger?: boolean
}

const LEDGER_SYNC_HINT = '自定义你的 bilimi 收藏夹，点击收藏名字可以编辑，添加好后点击【同步】即可更新到 B 站。取消勾选只会停止同步，不会删除已有收藏夹。'

export function FavoriteLedgerOverview({
  ledgers,
  missingLedgerIds,
  onSaveLedgers,
  onCreateLocalLedger,
  canCreateLocalLedger = false
}: FavoriteLedgerOverviewProps) {
  const [ledgerHintExpanded, setLedgerHintExpanded] = useState(false)
  const [draftLedgers, setDraftLedgers] = useState(ledgers)
  const [newLedgerName, setNewLedgerName] = useState('')
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  useEffect(() => setDraftLedgers(ledgers), [ledgers])

  const updateDraftLedgers = (nextLedgers: FavoriteLedger[]) => setDraftLedgers(nextLedgers)
  const toggleLedger = (ledgerId: string) => updateDraftLedgers(draftLedgers.map((ledger) =>
    ledger.id === ledgerId ? { ...ledger, enabled: !ledger.enabled } : ledger
  ))
  const toggleAllLedgers = () => {
    const enableAll = draftLedgers.some((ledger) => !ledger.enabled)
    updateDraftLedgers(draftLedgers.map((ledger) => ({ ...ledger, enabled: enableAll })))
  }
  const resetLedgers = () => setResetConfirmOpen(true)
  const applyDefaultLedgerRules = () => {
    const defaults = createDefaultFavoriteLedgers().map((ledger) => ({ ...ledger, enabled: false }))
    const defaultIds = new Set(defaults.map((ledger) => ledger.id))
    const customLedgers = draftLedgers.filter((ledger) => !ledger.isDefault && !defaultIds.has(ledger.id))
      .map((ledger) => ({ ...ledger, enabled: false }))
    updateDraftLedgers([...defaults, ...customLedgers])
    setActiveLedgerId(null)
  }
  const addLocalLedger = async () => {
    const title = newLedgerName.trim()
    if (!title) return
    if (canCreateLocalLedger) {
      await onCreateLocalLedger(title)
    } else {
      const id = `custom-${title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-').replace(/^-|-$/g, '') || 'ledger'}-${Date.now()}`
      const nextLedger: FavoriteLedger = {
        id,
        displayName: `bilimi·${title}`,
        keywords: [],
        ruleType: 'keyword',
        enabled: false,
        priority: (draftLedgers.length + 1) * 10,
        isDefault: false
      }
      updateDraftLedgers([...draftLedgers, nextLedger])
      setActiveLedgerId(id)
    }
    setNewLedgerName('')
  }
  const addBlankLedger = () => {
    const id = `custom-new-ledger-${Date.now()}`
    const nextLedger: FavoriteLedger = {
      id, displayName: 'bilimi·', keywords: [], ruleType: 'keyword', enabled: false,
      priority: (draftLedgers.length + 1) * 10, isDefault: false
    }
    updateDraftLedgers([...draftLedgers, nextLedger])
    setActiveLedgerId(id)
  }
  const updateActiveLedger = (patch: Partial<FavoriteLedger>) => updateDraftLedgers(draftLedgers.map((ledger) =>
    ledger.id === activeLedgerId ? { ...ledger, ...patch } : ledger
  ))

  const bulkToggleLabel = draftLedgers.some((ledger) => !ledger.enabled) ? '全选' : '取消全选'

  return <section className="favorite-ledger-panel__ledger-list" aria-label="收藏夹">
    <div className="favorite-ledger-panel__workspace">
      <section className="favorite-ledger-panel__checklist" aria-label="收藏夹规则">
        <div className="favorite-ledger-panel__category-header">
          <span className="favorite-ledger-panel__section-title">
            <h3 title={LEDGER_SYNC_HINT}>收藏夹</h3>
            <button type="button" className="favorite-ledger-panel__help-toggle"
              aria-label={`${ledgerHintExpanded ? '收起' : '展开'}收藏夹说明`}
              aria-expanded={ledgerHintExpanded} title={LEDGER_SYNC_HINT}
              onClick={() => setLedgerHintExpanded((expanded) => !expanded)}>
              <span className="favorite-ledger-panel__help-arrows" aria-hidden="true">
                <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--up" />
                <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--down" />
              </span>
            </button>
          </span>
          <div className="favorite-ledger-panel__category-actions">
            <button type="button" onClick={resetLedgers}>重置</button>
            <button type="button" onClick={toggleAllLedgers}>{bulkToggleLabel}</button>
            <button type="button" onClick={() => void onSaveLedgers(draftLedgers, { deleteDisabled: false })}>同步</button>
          </div>
        </div>
        {ledgerHintExpanded ? <div className="favorite-ledger-panel__sync-hint">
          <p>{LEDGER_SYNC_HINT}</p>
          <p>关键词、UP 名字和标签用于本地识别；DeepSeek 约束只在开启 DeepSeek 后作为辅助判断参考，可以输入一段自然语言。</p>
        </div> : null}
        <div className="favorite-ledger-panel__chips">
          {draftLedgers.map((ledger) => {
            const label = stripBilimiLedgerPrefix(ledger.displayName) || ledger.displayName
            return <div key={ledger.id} className="favorite-ledger-panel__chip-item">
              <button type="button" aria-label={label} title={ledger.displayName} aria-pressed={ledger.enabled}
                onClick={() => setActiveLedgerId(ledger.id)}>{label}</button>
              <button type="button" className="favorite-ledger-panel__chip-action"
                aria-label={`${ledger.enabled ? '移出同步' : '加入同步'} ${ledger.displayName}`}
                data-enabled={ledger.enabled} onClick={() => toggleLedger(ledger.id)}>{ledger.enabled ? '✓' : '+'}</button>
            </div>
          })}
        </div>
        <div className="favorite-ledger-panel__list-toggle">
          <button type="button" onClick={addBlankLedger}>新建收藏夹</button>
        </div>
      </section>

      {missingLedgerIds.length > 0 ? <p className="favorite-ledger-panel__notice" role="alert">部分 Bilimi 收藏夹尚未备册。</p> : null}
      {activeLedgerId ? <div className="favorite-ledger-panel__editor" aria-label="当前收藏夹">
        {draftLedgers.filter((ledger) => ledger.id === activeLedgerId).map((ledger) => <div key={ledger.id}>
          <div className="favorite-ledger-panel__editor-title"><strong>正在编辑：{ledger.displayName}</strong></div>
          <label>册名<input aria-label="册名" maxLength={20} value={stripBilimiLedgerPrefix(ledger.displayName)}
            onChange={(event) => updateActiveLedger({ displayName: `bilimi·${event.currentTarget.value}` })} /></label>
          <label>收藏夹种类<select aria-label="收藏夹种类" value={ledger.ruleType ?? 'keyword'}
            onChange={(event) => updateActiveLedger({ ruleType: event.currentTarget.value as FavoriteLedger['ruleType'], keywords: [] })}>
            <option value="keyword">关键词</option><option value="author">UP 名字</option><option value="tag">标签</option><option value="deepseek">DeepSeek</option>
          </select></label>
          <label>{ledger.ruleType === 'author' ? 'UP 名字' : ledger.ruleType === 'tag' ? '标签' : ledger.ruleType === 'deepseek' ? 'DeepSeek约束' : '关键词'}
            <input aria-label={ledger.ruleType === 'author' ? 'UP 名字' : ledger.ruleType === 'tag' ? '标签' : ledger.ruleType === 'deepseek' ? 'DeepSeek约束' : '关键词'} value={ledger.keywords.join(' ')}
            onChange={(event) => updateActiveLedger({ keywords: event.currentTarget.value.split(/[\s,，]+/).filter(Boolean) })} /></label>
        </div>)}
      </div> : null}
      <div className="favorite-ledger-panel__editor">
        <p className="favorite-ledger-panel__editor-empty">管理本地收藏夹规则，并在整理完成后保存。</p>
        <p className="favorite-ledger-panel__editor-empty">当前有 {draftLedgers.length} 个收藏夹规则。</p>
        <label>新增收藏夹
          <input id="new-ledger-name" aria-label="新增收藏夹名称" value={newLedgerName}
            onChange={(event) => setNewLedgerName(event.currentTarget.value)} />
        </label>
        <div className="favorite-ledger-panel__editor-actions">
          <button type="button" disabled={!newLedgerName.trim()} onClick={() => void addLocalLedger()}>新增并重新归类</button>
        </div>
      </div>
    </div>
    {resetConfirmOpen ? <OldFavoriteModal title="重置收藏夹规则？" confirmLabel="确认重置"
      onCancel={() => setResetConfirmOpen(false)}
      onConfirm={() => { setResetConfirmOpen(false); applyDefaultLedgerRules() }}>
      <p>仅恢复默认收藏夹名称和分类规则，不会清除旧藏扫描结果，也不会删除已有收藏夹。</p>
    </OldFavoriteModal> : null}
  </section>
}

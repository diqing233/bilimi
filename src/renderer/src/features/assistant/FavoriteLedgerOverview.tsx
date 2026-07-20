import {
  BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH,
  BILIMI_LEDGER_PREFIX,
  createDefaultFavoriteLedgers,
  favoriteLedgerNameValidation,
  stripBilimiLedgerPrefix
} from '@shared/favoriteLedgers'
import { DEEPSEEK_CONSTRAINT_MARKER, parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
import type { FavoriteLedger, FavoriteLedgerRuleType, FavoriteLedgerSaveOptions } from '@shared/types'
import { useEffect, useState } from 'react'
import { OldFavoriteModal } from './OldFavoriteModal'

type FavoriteLedgerOverviewProps = {
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
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

/** Local rule drafts stay in this panel until the owner chooses save or sync. */
export function FavoriteLedgerOverview({ ledgers, missingLedgerIds, onSaveLedgers }: FavoriteLedgerOverviewProps) {
  const [ledgerHintExpanded, setLedgerHintExpanded] = useState(false)
  const [draftLedgers, setDraftLedgers] = useState(ledgers)
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null)
  const [newLedger, setNewLedger] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [ledgerListExpanded, setLedgerListExpanded] = useState(false)
  useEffect(() => { setDraftLedgers(ledgers); setActiveLedgerId(null); setNewLedger(false); setLedgerListExpanded(false) }, [ledgers])
  const active = draftLedgers.find((ledger) => ledger.id === activeLedgerId)
  const activeHasUnsavedChanges = Boolean(active && (newLedger ||
    JSON.stringify(active) !== JSON.stringify(ledgers.find((ledger) => ledger.id === active.id))))
  const activeRules = active ? parseFavoriteLedgerRules(active) : { localKeywords: [] }
  const title = active ? displayTitle(active.displayName) : ''
  const validation = favoriteLedgerNameValidation(active?.displayName ?? '')
  const duplicate = active && draftLedgers.some((ledger) => ledger.id !== active.id &&
    displayTitle(ledger.displayName).toLocaleLowerCase() === title.trim().toLocaleLowerCase())
  const valid = Boolean(active && title.trim() && validation.valid && !duplicate)
  const allLedgersEnabled = draftLedgers.length > 0 && draftLedgers.every((ledger) => ledger.enabled)
  const canToggleLedgerList = draftLedgers.length > COLLAPSED_LEDGER_COUNT
  const ledgersToDisplay = ledgerListExpanded ? draftLedgers : draftLedgers.slice(0, COLLAPSED_LEDGER_COUNT)
  const update = (patch: Partial<FavoriteLedger>) => setDraftLedgers((current) => current.map((ledger) => ledger.id === activeLedgerId ? { ...ledger, ...patch } : ledger))
  const toggle = (id: string) => setDraftLedgers((current) => current.map((ledger) => ledger.id === id ? { ...ledger, enabled: !ledger.enabled } : ledger))
  const add = () => {
    const ledger: FavoriteLedger = { id: idFor('new-ledger'), displayName: BILIMI_LEDGER_PREFIX, keywords: [], ruleType: 'keyword', enabled: false, priority: (draftLedgers.length + 1) * 10, isDefault: false }
    setDraftLedgers((current) => [...current, ledger]); setActiveLedgerId(ledger.id); setNewLedger(true)
  }
  const close = () => {
    if (newLedger && activeLedgerId) setDraftLedgers((current) => current.filter((ledger) => ledger.id !== activeLedgerId))
    setActiveLedgerId(null); setNewLedger(false)
  }
  const save = () => { if (!valid) return; void onSaveLedgers(draftLedgers, { deleteDisabled: false }); setActiveLedgerId(null); setNewLedger(false) }
  return <section className="favorite-ledger-panel__ledger-list" aria-label="收藏夹">
    <div className="favorite-ledger-panel__workspace">
      <section className="favorite-ledger-panel__checklist" aria-label="收藏夹规则">
        <div className="favorite-ledger-panel__category-header"><span className="favorite-ledger-panel__section-title"><h3 title={LEDGER_SYNC_HINT}>收藏夹</h3>
          <button type="button" className="favorite-ledger-panel__help-toggle" aria-label={`${ledgerHintExpanded ? '收起' : '展开'}收藏夹说明`} aria-expanded={ledgerHintExpanded} title={LEDGER_SYNC_HINT} onClick={() => setLedgerHintExpanded((open) => !open)}>
            <span className="favorite-ledger-panel__help-arrows" aria-hidden="true">
              <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--up" />
              <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--down" />
            </span>
          </button>
        </span><div className="favorite-ledger-panel__category-actions"><button type="button" onClick={() => setResetConfirmOpen(true)}>重置</button><button type="button" onClick={() => setDraftLedgers((current) => current.map((ledger) => ({ ...ledger, enabled: !allLedgersEnabled })))}>{allLedgersEnabled ? '全不选' : '全选'}</button><button type="button" onClick={() => void onSaveLedgers(draftLedgers, { deleteDisabled: false })}>同步</button></div></div>
        {ledgerHintExpanded ? <div className="favorite-ledger-panel__sync-hint"><p>{LEDGER_SYNC_HINT}</p><p>关键词、UP 名字和标签用于本地识别；DeepSeek 约束只在开启 DeepSeek 后作为辅助判断参考，可以输入一段自然语言。</p></div> : null}
        <div className="favorite-ledger-panel__chips">{ledgersToDisplay.map((ledger) => <div key={ledger.id} className="favorite-ledger-panel__chip-item"><button type="button" aria-label={displayTitle(ledger.displayName) || ledger.displayName} title={ledger.displayName} aria-pressed={ledger.enabled} onClick={() => { setActiveLedgerId(ledger.id); setNewLedger(false) }}>{displayTitle(ledger.displayName) || ledger.displayName}</button><button type="button" className="favorite-ledger-panel__chip-action" aria-label={`${ledger.enabled ? '移出同步' : '加入同步'} ${ledger.displayName}`} data-enabled={ledger.enabled} onClick={() => toggle(ledger.id)}>{ledger.enabled ? '✓' : '+'}</button></div>)}</div>
        <div className="favorite-ledger-panel__list-toggle"><button type="button" onClick={add}>新建收藏夹</button>{canToggleLedgerList ? <button type="button" aria-expanded={ledgerListExpanded} onClick={() => setLedgerListExpanded((expanded) => !expanded)}>{ledgerListExpanded ? '折叠' : '展开'}</button> : null}</div>
      </section>
      {missingLedgerIds.length ? <p className="favorite-ledger-panel__notice" role="alert">部分 Bilimi 收藏夹尚未备册。</p> : null}
      {active ? <section className="favorite-ledger-panel__editor" aria-label="当前收藏夹"><div className="favorite-ledger-panel__editor-title"><strong>{activeHasUnsavedChanges ? '（未保存）' : ''}{newLedger ? '新建收藏夹' : '正在编辑：'}{active.displayName}</strong><div className="favorite-ledger-panel__editor-actions"><button type="button" disabled={!valid} onClick={save}>保存</button><button type="button" onClick={close}>取消</button>{!active.isDefault ? <button type="button" onClick={() => { const next = draftLedgers.filter((ledger) => ledger.id !== active.id); setDraftLedgers(next); void onSaveLedgers(next, { deleteDisabled: false }); setActiveLedgerId(null); setNewLedger(false) }}>删除</button> : null}</div></div>
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
    </div>
    {resetConfirmOpen ? <OldFavoriteModal title="重置收藏夹规则？" confirmLabel="确认重置" onCancel={() => setResetConfirmOpen(false)} onConfirm={() => { setDraftLedgers(createDefaultFavoriteLedgers()); setActiveLedgerId(null); setNewLedger(false); setResetConfirmOpen(false) }}><p>仅恢复默认收藏夹名称和分类规则，不会删除已有收藏夹。</p></OldFavoriteModal> : null}
  </section>
}

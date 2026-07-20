import type { FavoriteLedger } from '@shared/types'
import type { DeepSeekArchiveMode } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { useState } from 'react'
import { VirtualOldFavoriteTrack } from '../favorites/VirtualOldFavoriteTrack'
import { OldFavoritePreviewCard } from './OldFavoritePreviewCard'
import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'

const VIRTUAL_TRACK_THRESHOLD = 50

const DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS: Array<{ value: DeepSeekArchiveMode; label: string }> = [
  { value: 'low-confidence-and-unclassified', label: '整理不确定和【未分类】（推荐）' },
  { value: 'unclassified-only', label: '只整理【未匹配到合适分类】' },
  { value: 'all', label: 'DeepSeek重新检查全部' }
]

type OldFavoriteArchivePreviewStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  ledgers: FavoriteLedger[]
  loading: boolean
  deepSeekAvailable: boolean
  deepSeekFeedback: DeepSeekWorkspaceFeedback | null
  onSelectSegment: (segmentId: string) => void
  onAutoClassify: () => void
  onOrganizeWithDeepSeek: (mode: DeepSeekArchiveMode) => void
  onUndo: () => void
  onRedo: () => void
  onApplyManualClassification: (aid: number, targetLedgerIds: string[]) => void
  onCreateLocalLedgerAndReclassify: (title: string) => void
}

export function OldFavoriteArchivePreviewStep({
  snapshot,
  ledgers,
  loading,
  deepSeekAvailable,
  deepSeekFeedback,
  onSelectSegment,
  onAutoClassify,
  onOrganizeWithDeepSeek,
  onUndo,
  onRedo,
  onApplyManualClassification,
  onCreateLocalLedgerAndReclassify
}: OldFavoriteArchivePreviewStepProps) {
  const [newLedgerName, setNewLedgerName] = useState('')
  const [deepSeekMode, setDeepSeekMode] = useState<DeepSeekArchiveMode>('low-confidence-and-unclassified')
  const [deepSeekScopeOpen, setDeepSeekScopeOpen] = useState(false)
  const sourceFolderTitles = new Map(snapshot.sourceFolders
    .filter((folder) => folder.selected && !folder.isBilimiWorkFolder)
    .map((folder) => [folder.id, folder.title]))
  const selectedSourceIds = new Set(snapshot.sourceFolders
    .filter((folder) => folder.selected && !folder.isBilimiWorkFolder)
    .map((folder) => folder.id))
  const items = (snapshot.currentSegment?.items ?? []).filter((item) =>
    item.sourceFolderIds.some((folderId) => selectedSourceIds.has(folderId)))
  const renderItem = (item: typeof items[number]) => <OldFavoritePreviewCard
    item={item}
    sourceFolderTitles={item.sourceFolderIds.map((id) => sourceFolderTitles.get(id)).filter((title): title is string => Boolean(title))}
    classification={snapshot.classifications[String(item.aid)]}
    ledgers={ledgers}
    loading={loading}
    onApplyManualClassification={onApplyManualClassification}
  />

  return <section className="favorite-ledger-panel__preview favorite-ledger-panel__archive-preview" aria-label="归档预览">
    <div className="favorite-ledger-panel__preview-topbar">
      <div>
        <h4>归档预览</h4>
    <p>当前分段 {items.length} 条；只加载并显示这一段。</p>
      </div>
    </div>
    {snapshot.segments.length > 1 ? <div role="group" aria-label="整理分段">
      {snapshot.segments.map((segment) => <button key={segment.id} type="button" aria-pressed={snapshot.currentSegment?.id === segment.id}
        disabled={snapshot.currentSegment?.id === segment.id || loading}
        onClick={() => onSelectSegment(segment.id)}>第 {segment.index + 1} 组</button>)}
    </div> : null}
    <div className="favorite-ledger-panel__preview-toolbar" role="group" aria-label="归档工具">
      <button type="button" disabled={loading || items.length === 0} onClick={onAutoClassify}>自动分类</button>
      <div className="favorite-ledger-panel__deepseek-archive-scope" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDeepSeekScopeOpen(false)
      }}>
        <button type="button" aria-haspopup="menu" aria-expanded={deepSeekScopeOpen} aria-label="整理范围"
          title={`当前选择：${DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS.find((option) => option.value === deepSeekMode)?.label ?? ''}`}
          disabled={loading} onClick={() => setDeepSeekScopeOpen((open) => !open)}>
          <span>整理范围</span><span className="favorite-ledger-panel__deepseek-archive-scope-arrow" aria-hidden="true" />
        </button>
        {deepSeekScopeOpen ? <div className="favorite-ledger-panel__deepseek-archive-scope-menu" role="menu" aria-label="DeepSeek 处理对象">
          {DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS.map((option) => <button key={option.value} type="button" role="menuitemradio"
            aria-checked={deepSeekMode === option.value} onClick={() => { setDeepSeekMode(option.value); setDeepSeekScopeOpen(false) }}>
            {option.label}
          </button>)}
        </div> : null}
      </div>
      <button type="button" disabled={!deepSeekAvailable || loading || items.length === 0} onClick={() => onOrganizeWithDeepSeek(deepSeekMode)}>
        {loading ? 'DeepSeek 整理中…' : 'DeepSeek 整理'}
      </button>
      <button type="button" disabled={loading || snapshot.history.cursor === 0} onClick={onUndo}>撤销本次改动</button>
      <button type="button" disabled={loading || snapshot.history.cursor >= snapshot.history.length} onClick={onRedo}>恢复本次改动</button>
    </div>
    {!deepSeekAvailable ? <small className="favorite-ledger-panel__deepseek-archive-disabled">请先到设置开启 DeepSeek 后再使用辅助整理。</small> : null}
    {deepSeekFeedback ? <p className="favorite-ledger-panel__deepseek-archive-status"
      role={deepSeekFeedback.status === 'failed' ? 'alert' : 'status'}>{deepSeekFeedback.message}</p> : null}
    <p className="favorite-ledger-panel__deepseek-archive-hint">将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息给 DeepSeek。</p>
    <div className="favorite-ledger-panel__preview-new-ledger">
      <label>新建收藏夹后重新归类<input aria-label="新增收藏夹名称" value={newLedgerName} onChange={(event) => setNewLedgerName(event.currentTarget.value)} /></label>
      <button type="button" disabled={loading || !newLedgerName.trim()} onClick={() => { onCreateLocalLedgerAndReclassify(newLedgerName); setNewLedgerName('') }}>新增并重新归类</button>
    </div>
    <div className="favorite-ledger-panel__preview-groups">
      {items.length > VIRTUAL_TRACK_THRESHOLD ? <VirtualOldFavoriteTrack className="favorite-ledger-panel__preview-videos--virtual" ariaLabel="当前分段归档预览"
        items={items} itemKey={(item) => String(item.aid)} itemWidth={320} renderItem={renderItem} /> :
        <ul aria-label="当前分段归档预览">{items.map((item) => <li key={item.aid}>{renderItem(item)}</li>)}</ul>}
    </div>
  </section>
}

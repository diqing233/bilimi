import type { FavoriteLedger } from '@shared/types'
import type { DeepSeekArchiveMode } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { useState } from 'react'
import { VirtualOldFavoriteTrack } from '../favorites/VirtualOldFavoriteTrack'
import { OldFavoritePreviewCard } from './OldFavoritePreviewCard'
import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'
import { OldFavoriteModal } from './OldFavoriteModal'

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
  const [newLedgerDialogOpen, setNewLedgerDialogOpen] = useState(false)
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
  const previewGroups = (() => {
    const unmatched = items.filter((item) => !snapshot.classifications[String(item.aid)]?.targetLedgerIds.length)
    const classified = new Map<string, typeof items>()
    for (const item of items) {
      const targetLedgerId = snapshot.classifications[String(item.aid)]?.targetLedgerIds[0]
      if (!targetLedgerId) continue
      const groupId = ledgers.some((ledger) => ledger.id === targetLedgerId) ? targetLedgerId : 'other'
      classified.set(groupId, [...(classified.get(groupId) ?? []), item])
    }
    return [
      ...(unmatched.length ? [{ id: 'unclassified', title: '未匹配到合适分类', items: unmatched }] : []),
      ...[...classified.entries()].map(([id, groupedItems]) => ({
        id,
        title: id === 'other' ? '其它收藏' : ledgers.find((ledger) => ledger.id === id)?.displayName ?? '其它收藏',
        items: groupedItems
      }))
    ]
  })()
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
        <h4 className="favorite-ledger-panel__step-title">归档预览</h4>
      </div>
    </div>
    <p className="favorite-ledger-panel__step-note">当前分段 {items.length} 条；只加载并显示这一段。</p>
    {snapshot.segments.length > 1 ? <div role="group" aria-label="整理分段">
      {snapshot.segments.map((segment) => <button key={segment.id} type="button" aria-pressed={snapshot.currentSegment?.id === segment.id}
        disabled={snapshot.currentSegment?.id === segment.id || loading}
        onClick={() => onSelectSegment(segment.id)}>第 {segment.index + 1} 组</button>)}
    </div> : null}
    <div className="favorite-ledger-panel__preview-tools">
      <div className="favorite-ledger-panel__archive-tool-card" role="group" aria-label="归档预览辅助工具">
        <div className="favorite-ledger-panel__deepseek-archive-section" role="group" aria-label="DeepSeek 辅助整理">
          <div className="favorite-ledger-panel__deepseek-archive-heading">
            <strong>DeepSeek 辅助整理</strong>
            <div className="favorite-ledger-panel__deepseek-archive-actions">
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
              <button type="button" className="favorite-ledger-panel__deepseek-archive-run-button"
                disabled={!deepSeekAvailable || loading || items.length === 0} onClick={() => onOrganizeWithDeepSeek(deepSeekMode)}>
                {loading ? 'DeepSeek 整理中…' : 'DeepSeek 整理'}
              </button>
            </div>
          </div>
          {!deepSeekAvailable ? <small className="favorite-ledger-panel__deepseek-archive-disabled">请先到设置开启 DeepSeek 后再使用辅助整理。</small> : null}
          <p className="favorite-ledger-panel__deepseek-archive-hint">将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息给 DeepSeek。</p>
          {deepSeekFeedback ? <p className="favorite-ledger-panel__deepseek-archive-status"
            role={deepSeekFeedback.status === 'failed' ? 'alert' : 'status'}>{deepSeekFeedback.message}</p> : null}
        </div>
        <div className="favorite-ledger-panel__archive-tool-divider" aria-hidden="true" />
        <div className="favorite-ledger-panel__archive-history-section" role="group" aria-label="归档预览改动操作">
          <div className="favorite-ledger-panel__archive-history-actions">
            <label className="favorite-ledger-panel__archive-history-select">
              <span>改动记录</span>
              <select aria-label="改动记录" value="current" disabled={loading || snapshot.history.length === 0}
                onChange={(event) => {
                  if (event.currentTarget.value === 'undo') onUndo()
                  if (event.currentTarget.value === 'redo') onRedo()
                }}>
                <option value="current">当前：第 {snapshot.history.cursor} / {snapshot.history.length} 次</option>
                {snapshot.history.cursor > 0 ? <option value="undo">撤销至上一步</option> : null}
                {snapshot.history.cursor < snapshot.history.length ? <option value="redo">恢复下一步</option> : null}
              </select>
            </label>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading || items.length === 0} onClick={onAutoClassify}>自动分类当前分段</button>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading || snapshot.history.cursor === 0} onClick={onUndo}>撤销本次改动</button>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading || snapshot.history.cursor >= snapshot.history.length} onClick={onRedo}>恢复本次改动</button>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading} onClick={() => setNewLedgerDialogOpen(true)}>新建收藏夹后重新归类</button>
          </div>
          <p>Ctrl+Z 撤销，Ctrl+Shift+Z 恢复；会按最近改动逐步回退或重做。</p>
        </div>
      </div>
    </div>
    <div className="favorite-ledger-panel__preview-groups">
      {previewGroups.map((group) => <section key={group.id} className={`favorite-ledger-panel__preview-row${group.id === 'unclassified' ? ' favorite-ledger-panel__preview-row--pending' : ''}`}
        data-archive-ledger-id={group.id} role="group" aria-label={`${group.title} ${group.items.length} 条`}>
        <header><span className="favorite-ledger-panel__preview-heading"><strong>{group.title}</strong><small>{group.items.length} 条{group.id === 'unclassified' ? '需要处理' : '适合'}</small></span></header>
        {group.items.length > VIRTUAL_TRACK_THRESHOLD ? <VirtualOldFavoriteTrack className="favorite-ledger-panel__preview-videos favorite-ledger-panel__preview-videos--virtual"
          ariaLabel={`${group.title} 视频`} items={group.items} itemKey={(item) => `${group.id}-${item.aid}`} itemWidth={320} renderItem={renderItem} /> :
          <div className="favorite-ledger-panel__preview-videos" aria-label={`${group.title} 视频`}>{group.items.map((item) => <div key={`${group.id}-${item.aid}`}>{renderItem(item)}</div>)}</div>}
      </section>)}
    </div>
    {newLedgerDialogOpen ? <OldFavoriteModal title="新建收藏夹后重新归类"
      confirmLabel="新增并重新归类"
      confirmDisabled={loading || !newLedgerName.trim()}
      onCancel={() => { setNewLedgerDialogOpen(false); setNewLedgerName('') }}
      onConfirm={() => { onCreateLocalLedgerAndReclassify(newLedgerName); setNewLedgerName(''); setNewLedgerDialogOpen(false) }}>
      <label>收藏夹名称<input aria-label="新增收藏夹名称" value={newLedgerName} onChange={(event) => setNewLedgerName(event.currentTarget.value)} /></label>
    </OldFavoriteModal> : null}
  </section>
}

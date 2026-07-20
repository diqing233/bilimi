import type { FavoriteLedger } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { useState } from 'react'
import { VirtualOldFavoriteTrack } from '../favorites/VirtualOldFavoriteTrack'
import { OldFavoritePreviewCard } from './OldFavoritePreviewCard'

const VIRTUAL_TRACK_THRESHOLD = 50

type OldFavoriteArchivePreviewStepProps = {
  snapshot: OldFavoriteWorkspaceSnapshot
  ledgers: FavoriteLedger[]
  loading: boolean
  deepSeekAvailable: boolean
  onSelectSegment: (segmentId: string) => void
  onAutoClassify: () => void
  onOrganizeWithDeepSeek: () => void
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
  onSelectSegment,
  onAutoClassify,
  onOrganizeWithDeepSeek,
  onUndo,
  onRedo,
  onApplyManualClassification,
  onCreateLocalLedgerAndReclassify
}: OldFavoriteArchivePreviewStepProps) {
  const [newLedgerName, setNewLedgerName] = useState('')
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

  return <section className="favorite-ledger-panel__archive-preview" aria-label="归档预览">
    <h4>归档预览</h4>
    <p>当前分段 {items.length} 条；只加载并显示这一段。</p>
    {snapshot.segments.length > 1 ? <div role="group" aria-label="整理分段">
      {snapshot.segments.map((segment) => <button key={segment.id} type="button" aria-pressed={snapshot.currentSegment?.id === segment.id}
        disabled={snapshot.currentSegment?.id === segment.id || loading}
        onClick={() => onSelectSegment(segment.id)}>第 {segment.index + 1} 组</button>)}
    </div> : null}
    <div className="favorite-ledger-panel__confirm-actions">
      <button type="button" disabled={loading || items.length === 0} onClick={onAutoClassify}>自动分类</button>
      <button type="button" disabled={!deepSeekAvailable || loading || items.length === 0} onClick={onOrganizeWithDeepSeek}>
        {loading ? 'DeepSeek 整理中…' : 'DeepSeek 整理'}
      </button>
      <button type="button" disabled={loading || snapshot.history.cursor === 0} onClick={onUndo}>撤销本次改动</button>
      <button type="button" disabled={loading || snapshot.history.cursor >= snapshot.history.length} onClick={onRedo}>恢复本次改动</button>
    </div>
    <div className="favorite-ledger-panel__preview-new-ledger">
      <label>新建收藏夹后重新归类<input aria-label="新增收藏夹名称" value={newLedgerName} onChange={(event) => setNewLedgerName(event.currentTarget.value)} /></label>
      <button type="button" disabled={loading || !newLedgerName.trim()} onClick={() => { onCreateLocalLedgerAndReclassify(newLedgerName); setNewLedgerName('') }}>新增并重新归类</button>
    </div>
    {items.length > VIRTUAL_TRACK_THRESHOLD ? <VirtualOldFavoriteTrack className="favorite-ledger-panel__preview-videos--virtual" ariaLabel="当前分段归档预览"
      items={items} itemKey={(item) => String(item.aid)} itemWidth={320} renderItem={renderItem} /> :
      <ul aria-label="当前分段归档预览">{items.map((item) => <li key={item.aid}>{renderItem(item)}</li>)}</ul>}
  </section>
}

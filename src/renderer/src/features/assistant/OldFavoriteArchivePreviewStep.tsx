import type { FavoriteLedger } from '@shared/types'
import type { DeepSeekArchiveMode } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { useState } from 'react'
import { VirtualOldFavoriteTrack } from '../favorites/VirtualOldFavoriteTrack'
import { OldFavoritePreviewCard } from './OldFavoritePreviewCard'
import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'

const VIRTUAL_TRACK_THRESHOLD = 50
const INITIAL_GROUP_ITEM_LIMIT = 6

function deepSeekFailureMessage(message: string, affectedVideoCount: number) {
  if (/incomplete current-segment/i.test(message)) {
    return `返回结果不完整，${affectedVideoCount} 条未应用，可重试。`
  }
  if (/unavailable favorite targets/i.test(message)) {
    return `返回了已不可用的收藏夹目标，${affectedVideoCount} 条未应用，可重试。`
  }
  return message
}

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
  onOrganizeWithDeepSeek: (mode: DeepSeekArchiveMode) => void
  onRetryFailedDeepSeekChunks: () => void
  onCancelDeepSeek?: () => void
  deepSeekCancelRequested?: boolean
  onUndo: () => void
  onRedo: () => void
  onMoveHistoryCursor: (cursor: number) => void
  onApplyManualClassification: (aid: number, targetLedgerIds: string[]) => void
  onApplyManualClassifications: (assignments: Array<{ aid: number; targetLedgerIds: string[] }>) => void
}

export function OldFavoriteArchivePreviewStep({
  snapshot,
  ledgers,
  loading,
  deepSeekAvailable,
  deepSeekFeedback,
  onSelectSegment,
  onOrganizeWithDeepSeek,
  onRetryFailedDeepSeekChunks,
  onCancelDeepSeek = () => undefined,
  deepSeekCancelRequested = false,
  onUndo,
  onRedo,
  onMoveHistoryCursor,
  onApplyManualClassification,
  onApplyManualClassifications,
}: OldFavoriteArchivePreviewStepProps) {
  const [deepSeekMode, setDeepSeekMode] = useState<DeepSeekArchiveMode>('low-confidence-and-unclassified')
  const [deepSeekScopeOpen, setDeepSeekScopeOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const deepSeekRunning = deepSeekFeedback?.status === 'running'
  const historySourceLabels = {
    manual: '人工调整',
    deepseek: 'DeepSeek',
    'system-high': '高置信度自动分类',
    'system-low': '低置信度自动分类'
  } as const
  const ledgerNames = new Map(ledgers.map((ledger) => [ledger.id, ledger.displayName]))
  const historyLabel = (entry: OldFavoriteWorkspaceSnapshot['history']['entries'][number]) =>
    `${historySourceLabels[entry.source]}：${entry.changeCount} 条 → ${entry.targetLedgerIds.map((id) => ledgerNames.get(id) ?? id).join('、') || '未分类'}`
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
      const groupId = targetLedgerId === 'inbox' || ledgers.some((ledger) => ledger.id === targetLedgerId)
        ? targetLedgerId
        : 'other'
      classified.set(groupId, [...(classified.get(groupId) ?? []), item])
    }
    return [
      ...(unmatched.length ? [{ id: 'unclassified', title: '未匹配到合适分类', items: unmatched }] : []),
      ...[...classified.entries()].map(([id, groupedItems]) => ({
        id,
        title: id === 'inbox' ? '暂存' : id === 'other' ? '其它收藏' : ledgers.find((ledger) => ledger.id === id)?.displayName ?? '其它收藏',
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
        <div className="favorite-ledger-panel__deepseek-archive-section favorite-ledger-panel__deepseek-archive-section--full" role="group" aria-label="DeepSeek 辅助整理">
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
              {deepSeekRunning ? <button type="button" className="favorite-ledger-panel__deepseek-archive-run-button" data-action="cancel"
                disabled={deepSeekCancelRequested} onClick={onCancelDeepSeek}>
                {deepSeekCancelRequested ? '正在取消' : '取消 DeepSeek 整理'}
              </button> : <button type="button" className="favorite-ledger-panel__deepseek-archive-run-button"
                disabled={!deepSeekAvailable || loading || items.length === 0} onClick={() => onOrganizeWithDeepSeek(deepSeekMode)}>
                DeepSeek 整理
              </button>}
            </div>
          </div>
          {!deepSeekAvailable ? <small className="favorite-ledger-panel__deepseek-archive-disabled">请先到设置开启 DeepSeek 后再使用辅助整理。</small> : null}
          <p className="favorite-ledger-panel__deepseek-archive-hint">将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息给 DeepSeek。</p>
          {deepSeekFeedback ? <div className="favorite-ledger-panel__deepseek-archive-status"
            role={deepSeekFeedback.status === 'failed' ? 'alert' : 'status'}>
            <p>{deepSeekFeedback.message}</p>
            {deepSeekFeedback.progress ? (() => {
              const { completedChunks, totalChunks, totalVideoCount, successfulVideoCount, failedVideoCount } = deepSeekFeedback.progress
              const completedVideos = successfulVideoCount + failedVideoCount
              const progressValue = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0
              return <div className="favorite-ledger-panel__deepseek-archive-progress" data-running={deepSeekFeedback.status === 'running'}>
                <div className="favorite-ledger-panel__deepseek-archive-progress-copy">
                  <span>第 {completedChunks} / {totalChunks} 批</span>
                  <span>已完成 {completedVideos} / {totalVideoCount} 条视频</span>
                </div>
                <div aria-label="DeepSeek 整理进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue}
                  className="favorite-ledger-panel__deepseek-archive-progress-track" role="progressbar">
                  <span style={{ width: `${progressValue}%` }} />
                </div>
              </div>
            })() : null}
            {deepSeekFeedback.failures?.map((failure) => <p key={failure.chunkIndex}>第 {failure.chunkIndex} 批：{deepSeekFailureMessage(failure.message, failure.affectedVideoCount)}</p>)}
            {deepSeekFeedback.failures?.length ? <button type="button" disabled={loading} onClick={onRetryFailedDeepSeekChunks}>重试失败批次</button> : null}
          </div> : null}
        </div>
        <div className="favorite-ledger-panel__archive-tool-divider favorite-ledger-panel__archive-tool-divider--full-width" aria-hidden="true" />
        <div className="favorite-ledger-panel__archive-history-section" role="group" aria-label="归档预览改动操作">
          <div className="favorite-ledger-panel__archive-history-actions">
            <label className="favorite-ledger-panel__archive-history-select">
              <span>改动记录</span>
              <div className="favorite-ledger-panel__archive-history-select-control">
              <button type="button" className="favorite-ledger-panel__archive-history-trigger"
                aria-label="查看改动记录" aria-expanded={historyOpen} disabled={loading || snapshot.history.length === 0}
                onClick={() => setHistoryOpen((open) => !open)}>
                <span className="favorite-ledger-panel__archive-history-arrow" aria-hidden="true" />
              </button>
              {historyOpen ? <div className="favorite-ledger-panel__archive-history-menu" role="menu" aria-label="改动记录">
                {snapshot.history.entries.map((entry) => <button key={entry.cursor} type="button" role="menuitem"
                  disabled={loading || entry.cursor === snapshot.history.cursor} onClick={() => {
                    setHistoryOpen(false)
                    onMoveHistoryCursor(entry.cursor)
                  }}>{historyLabel(entry)}</button>)}
              </div> : null}
              </div>
            </label>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading || snapshot.history.cursor === 0} onClick={onUndo}>撤销本次改动</button>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading || snapshot.history.cursor >= snapshot.history.length} onClick={onRedo}>恢复本次改动</button>
          </div>
          <p>Ctrl+Z 撤销，Ctrl+Shift+Z 恢复；会按最近改动逐步回退或重做。</p>
        </div>
      </div>
    </div>
    <div className="favorite-ledger-panel__preview-groups">
      {previewGroups.map((group) => {
        const expanded = expandedGroups.has(group.id)
        const visibleItems = expanded ? group.items : group.items.slice(0, INITIAL_GROUP_ITEM_LIMIT)
        const stageAll = group.id === 'unclassified' && group.items.length > 0 && group.items.every((item) =>
          snapshot.classifications[String(item.aid)]?.targetLedgerIds.includes('inbox'))
        const groupAll = group.id !== 'unclassified' && group.items.length > 0 && group.items.every((item) =>
          snapshot.classifications[String(item.aid)]?.targetLedgerIds.includes(group.id))
        return <section key={group.id} className={`favorite-ledger-panel__preview-row${group.id === 'unclassified' ? ' favorite-ledger-panel__preview-row--pending' : ''}`}
          data-archive-ledger-id={group.id} role="group" aria-label={`${group.title} ${group.items.length} 条`}>
          <header><span className="favorite-ledger-panel__preview-heading"><strong>{group.title}</strong><small>{group.items.length} 条{group.id === 'unclassified' ? '需要处理' : '适合'}</small></span>
            {group.id === 'unclassified' ? <label><input type="checkbox" aria-label="全部存入暂存" checked={stageAll} disabled={loading}
              onChange={(event) => onApplyManualClassifications(group.items.map((item) => ({
                aid: item.aid, targetLedgerIds: event.currentTarget.checked ? ['inbox'] : []
              })))} /><span>全部存入暂存</span></label> : <label><input type="checkbox" aria-label={`全选 ${group.title}`} checked={groupAll} disabled={loading}
                onChange={(event) => onApplyManualClassifications(group.items.map((item) => ({
                  aid: item.aid, targetLedgerIds: event.currentTarget.checked ? [group.id] : []
                })))} /><span>全选</span></label>}
          </header>
          {expanded && group.items.length > VIRTUAL_TRACK_THRESHOLD ? <VirtualOldFavoriteTrack className="favorite-ledger-panel__preview-videos favorite-ledger-panel__preview-videos--virtual"
            ariaLabel={`${group.title} 视频`} items={group.items} itemKey={(item) => `${group.id}-${item.aid}`} itemWidth={280} renderItem={renderItem} /> :
            <div className="favorite-ledger-panel__preview-videos" aria-label={`${group.title} 视频`}>{visibleItems.map((item) => <div key={`${group.id}-${item.aid}`} className="favorite-ledger-panel__preview-item-shell">{renderItem(item)}</div>)}
              {group.items.length > INITIAL_GROUP_ITEM_LIMIT && !expanded ? <button type="button" onClick={() => setExpandedGroups((current) => new Set([...current, group.id]))}>显示全部 {group.items.length} 条</button> : null}
            </div>}
        </section>
      })}
    </div>
  </section>
}

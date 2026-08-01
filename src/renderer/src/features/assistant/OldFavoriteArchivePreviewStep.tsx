import type { FavoriteLedger } from '@shared/types'
import type { DeepSeekArchiveMode, DeepSeekArchiveScope } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { VirtualOldFavoriteTrack } from '../favorites/VirtualOldFavoriteTrack'
import { OldFavoritePreviewCard } from './OldFavoritePreviewCard'
import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'
import { toDeepSeekFeedbackView } from './oldFavoriteDeepSeekFeedbackModel'

const VIRTUAL_TRACK_THRESHOLD = 50
const INITIAL_GROUP_ITEM_LIMIT = 6

function isUnavailablePreviewItem(item: { unavailable?: boolean; title?: string; author?: string }) {
  return item.unavailable === true || item.title?.trim() === '已失效视频' || item.author?.trim() === '账号已注销'
}

export function groupOldFavoritePreviewItems<Item extends { aid: number }>(
  items: readonly Item[],
  classifications: OldFavoriteWorkspaceSnapshot['classifications'],
  knownLedgerIds: ReadonlySet<string>
) {
  const classified = new Map<string, Item[]>()
  for (const item of items) {
    const groupIds = new Set((classifications[String(item.aid)]?.targetLedgerIds ?? [])
      .slice(0, 3)
      .map((targetLedgerId) => targetLedgerId === 'inbox' || knownLedgerIds.has(targetLedgerId) ? targetLedgerId : 'other'))
    for (const groupId of groupIds) {
      const bucket = classified.get(groupId)
      if (bucket) bucket.push(item)
      else classified.set(groupId, [item])
    }
  }
  return classified
}

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
  mutationLocked?: boolean
  deepSeekAvailable: boolean
  deepSeekFeedback: DeepSeekWorkspaceFeedback | null
  onOrganizeWithDeepSeek: (mode: DeepSeekArchiveMode, scope?: DeepSeekArchiveScope) => void
  onRetryFailedDeepSeekChunks: () => void
  onCancelDeepSeek?: () => void
  deepSeekCancelRequested?: boolean
  onUndo: () => void
  onRedo: () => void
  onMoveHistoryCursor: (cursor: number) => void
  onApplyManualClassification: (aid: number, targetLedgerIds: string[]) => void
  onApplyManualClassifications: (assignments: Array<{ aid: number; targetLedgerIds: string[] }>) => void
}

type OldFavoriteArchiveGroupsProps = Pick<OldFavoriteArchivePreviewStepProps,
  'snapshot' | 'ledgers' | 'loading' | 'mutationLocked' | 'onApplyManualClassification' | 'onApplyManualClassifications'>

const OldFavoriteArchiveGroups = memo(function OldFavoriteArchiveGroups({
  snapshot,
  ledgers,
  loading,
  mutationLocked = false,
  onApplyManualClassification,
  onApplyManualClassifications
}: OldFavoriteArchiveGroupsProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const [recentlyMovedAidByLedgerId, setRecentlyMovedAidByLedgerId] = useState<Record<string, number>>({})
  const groupsRootRef = useRef<HTMLDivElement>(null)
  const pendingMoveFocusRef = useRef<{ aid: number; sourceLedgerId: string; targetLedgerId: string } | null>(null)
  const originalTargetsRef = useRef<{ key: string; byAid: Map<number, string[]> }>({ key: '', byAid: new Map() })
  const sourceFolderTitles = new Map(snapshot.sourceFolders
    .filter((folder) => folder.selected && !folder.isBilimiWorkFolder)
    .map((folder) => [folder.id, folder.title]))
  const selectedSourceIds = new Set(snapshot.sourceFolders
    .filter((folder) => folder.selected && !folder.isBilimiWorkFolder)
    .map((folder) => folder.id))
  const items = (snapshot.currentSegment?.items ?? []).filter((item) =>
    !isUnavailablePreviewItem(item) && item.sourceFolderIds.some((folderId) => selectedSourceIds.has(folderId)))
  const originalTargetsKey = `${snapshot.workspaceId}:${snapshot.currentSegment?.id ?? 'none'}`
  if (originalTargetsRef.current.key !== originalTargetsKey) {
    originalTargetsRef.current = { key: originalTargetsKey, byAid: new Map() }
  }
  for (const item of items) {
    if (!originalTargetsRef.current.byAid.has(item.aid)) {
      originalTargetsRef.current.byAid.set(item.aid, [...(snapshot.classifications[String(item.aid)]?.targetLedgerIds ?? [])])
    }
  }
  const unmatched = items.filter((item) => !snapshot.classifications[String(item.aid)]?.targetLedgerIds.length)
  const classified = groupOldFavoritePreviewItems(items, snapshot.classifications, new Set(ledgers.map((ledger) => ledger.id)))
  const previewGroups = [
    ...(unmatched.length ? [{ id: 'unclassified', title: '未匹配到合适分类', items: unmatched }] : []),
    ...[...classified.entries()].map(([id, groupedItems]) => ({
      id,
      title: id === 'inbox' ? '暂存' : id === 'other' ? '其它收藏' : ledgers.find((ledger) => ledger.id === id)?.displayName ?? '其它收藏',
      items: recentlyMovedAidByLedgerId[id] === undefined
        ? groupedItems
        : [...groupedItems].sort((left, right) =>
          Number(right.aid === recentlyMovedAidByLedgerId[id]) - Number(left.aid === recentlyMovedAidByLedgerId[id]))
    }))
  ]
  const handleManualClassification = (aid: number, currentLedgerId: string | undefined, nextTargetLedgerIds: string[]) => {
    const previousTargetLedgerIds = snapshot.classifications[String(aid)]?.targetLedgerIds ?? []
    const targetLedgerId = nextTargetLedgerIds.find((ledgerId) => !previousTargetLedgerIds.includes(ledgerId))
      ?? nextTargetLedgerIds[0]
      ?? 'unclassified'
    pendingMoveFocusRef.current = { aid, sourceLedgerId: currentLedgerId ?? 'unclassified', targetLedgerId }
    setRecentlyMovedAidByLedgerId((current) => ({ ...current, [targetLedgerId]: aid }))
    onApplyManualClassification(aid, nextTargetLedgerIds)
  }
  const renderItem = (item: typeof items[number], currentLedgerId?: string) => <OldFavoritePreviewCard
    item={item}
    sourceFolderTitles={item.sourceFolderIds.map((id) => sourceFolderTitles.get(id)).filter((title): title is string => Boolean(title))}
    classification={snapshot.classifications[String(item.aid)]}
    currentLedgerId={currentLedgerId}
    originalTargetLedgerIds={originalTargetsRef.current.byAid.get(item.aid)}
    ledgers={ledgers}
    loading={loading || mutationLocked}
    onApplyManualClassification={(aid, targetLedgerIds) => handleManualClassification(aid, currentLedgerId, targetLedgerIds)}
  />

  useLayoutEffect(() => {
    const pendingMove = pendingMoveFocusRef.current
    if (!pendingMove) return
    const targetItems = pendingMove.targetLedgerId === 'unclassified'
      ? unmatched
      : classified.get(pendingMove.targetLedgerId)
    if (!targetItems?.some((item) => item.aid === pendingMove.aid)) return
    const rows = Array.from(groupsRootRef.current?.querySelectorAll<HTMLElement>('[data-archive-ledger-id]') ?? [])
    const rowForLedger = (ledgerId: string) => rows.find((row) => row.dataset.archiveLedgerId === ledgerId)
    for (const ledgerId of new Set([pendingMove.sourceLedgerId, pendingMove.targetLedgerId])) {
      const track = rowForLedger(ledgerId)?.querySelector<HTMLElement>('.favorite-ledger-panel__preview-videos')
      if (track) track.scrollLeft = 0
    }
    rowForLedger(pendingMove.targetLedgerId)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    pendingMoveFocusRef.current = null
  }, [classified, unmatched])

  return <div ref={groupsRootRef} className="favorite-ledger-panel__preview-groups">
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
          {group.id === 'unclassified' ? <label><input type="checkbox" aria-label="全部存入暂存" checked={stageAll} disabled={loading || mutationLocked}
            onChange={(event) => onApplyManualClassifications(group.items.map((item) => ({
              aid: item.aid, targetLedgerIds: event.currentTarget.checked ? ['inbox'] : []
            })))} /><span>全部存入暂存</span></label> : <label><input type="checkbox" aria-label={`全选 ${group.title}`} checked={groupAll} disabled={loading || mutationLocked}
              onChange={(event) => onApplyManualClassifications(group.items.map((item) => ({
                aid: item.aid, targetLedgerIds: event.currentTarget.checked ? [group.id] : []
              })))} /><span>全选</span></label>}
        </header>
        {expanded && group.items.length > VIRTUAL_TRACK_THRESHOLD ? <VirtualOldFavoriteTrack className="favorite-ledger-panel__preview-videos favorite-ledger-panel__preview-videos--virtual"
          ariaLabel={`${group.title} 视频`} items={group.items} itemKey={(item) => `${group.id}-${item.aid}`} itemWidth={280} renderItem={(item) => renderItem(item, group.id === 'unclassified' ? undefined : group.id)} /> :
          <div className="favorite-ledger-panel__preview-videos" aria-label={`${group.title} 视频`}>{visibleItems.map((item) => <div key={`${group.id}-${item.aid}`} className="favorite-ledger-panel__preview-item-shell">{renderItem(item, group.id === 'unclassified' ? undefined : group.id)}</div>)}
            {group.items.length > INITIAL_GROUP_ITEM_LIMIT && !expanded ? <button type="button" onClick={() => setExpandedGroups((current) => new Set([...current, group.id]))}>显示全部 {group.items.length} 条</button> : null}
          </div>}
      </section>
    })}
  </div>
})

export function OldFavoriteArchivePreviewStep({
  snapshot,
  ledgers,
  loading,
  mutationLocked = false,
  deepSeekAvailable,
  deepSeekFeedback,
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
  const [deepSeekScope, setDeepSeekScope] = useState<DeepSeekArchiveScope>('all')
  const [deepSeekScopeOpen, setDeepSeekScopeOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const [historyMenuPosition, setHistoryMenuPosition] = useState({ top: 0, left: 0 })
  const deepSeekFeedbackView = deepSeekFeedback
    ? toDeepSeekFeedbackView(deepSeekFeedback, deepSeekCancelRequested)
    : null
  const deepSeekCancellationAction = deepSeekFeedbackView?.action === 'cancel' || deepSeekFeedbackView?.action === 'cancelling'
  const historySourceLabels = {
    manual: '人工调整',
    deepseek: 'DeepSeek',
    'system-high': '高置信度自动分类',
    'system-low': '低置信度自动分类'
  } as const
  const ledgerNames = new Map(ledgers.map((ledger) => [ledger.id, ledger.displayName]))
  const historyLabel = (entry: OldFavoriteWorkspaceSnapshot['history']['entries'][number]) =>
    `${historySourceLabels[entry.source]}：${entry.changeCount} 条 → ${entry.targetLedgerIds.map((id) => ledgerNames.get(id) ?? id).join('、') || '未分类'}`
  const historyBaselineCursor = snapshot.history.baselineCursor ?? 0
  const historyEntries = snapshot.history.entries ?? []
  const currentHistoryEntry = historyEntries.find((entry) => entry.cursor === snapshot.history.cursor)
  const previousHistoryEntries = historyEntries.filter((entry) => entry.cursor !== snapshot.history.cursor)
  const currentHistoryLabel = currentHistoryEntry ? historyLabel(currentHistoryEntry) : '初始自动分类'
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable
    }
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const wantsUndo = key === 'z' && !event.shiftKey
      const wantsRedo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)
      if (wantsUndo && !loading && !mutationLocked && snapshot.history.cursor > historyBaselineCursor) {
        event.preventDefault()
        onUndo()
      } else if (wantsRedo && !loading && !mutationLocked && snapshot.history.cursor < snapshot.history.length) {
        event.preventDefault()
        onRedo()
      }
    }
    document.addEventListener('keydown', handleHistoryShortcut)
    return () => document.removeEventListener('keydown', handleHistoryShortcut)
  }, [historyBaselineCursor, loading, mutationLocked, onRedo, onUndo, snapshot.history.cursor, snapshot.history.length])
  useLayoutEffect(() => {
    if (!historyOpen || !historyTriggerRef.current) return
    const updateHistoryMenuPosition = () => {
      const triggerRect = historyTriggerRef.current?.getBoundingClientRect()
      if (!triggerRect) return
      const gutter = 8
      const menuWidth = Math.min(360, window.innerWidth - gutter * 2)
      setHistoryMenuPosition({
        top: triggerRect.bottom + 4,
        left: Math.max(gutter, Math.min(triggerRect.right - menuWidth, window.innerWidth - menuWidth - gutter))
      })
    }
    updateHistoryMenuPosition()
    window.addEventListener('resize', updateHistoryMenuPosition)
    window.addEventListener('scroll', updateHistoryMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateHistoryMenuPosition)
      window.removeEventListener('scroll', updateHistoryMenuPosition, true)
    }
  }, [historyOpen])
  const hasPreviewItems = useMemo(() => {
    const selectedSourceIds = new Set(snapshot.sourceFolders
      .filter((folder) => folder.selected && !folder.isBilimiWorkFolder)
      .map((folder) => folder.id))
    return (snapshot.currentSegment?.items ?? []).some((item) =>
      !isUnavailablePreviewItem(item) && item.sourceFolderIds.some((folderId) => selectedSourceIds.has(folderId)))
  }, [snapshot])

  return <section className="favorite-ledger-panel__preview favorite-ledger-panel__archive-preview" aria-label="归档预览">
    <div className="favorite-ledger-panel__preview-topbar">
      <div>
        <h4 className="favorite-ledger-panel__step-title">归档预览</h4>
      </div>
    </div>
    <p className="favorite-ledger-panel__step-note">检查分类结果，可手动调整或使用 DeepSeek 辅助整理。</p>
    <p className="favorite-ledger-panel__action-explanation">DeepSeek 只辅助更新预览；撤销、恢复和改动记录只处理本轮预览改动。</p>
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
                  title={`整理模式：${DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS.find((option) => option.value === deepSeekMode)?.label ?? ''}；批次范围：${deepSeekScope === 'all' ? '本轮所有批次' : '当前批次'}`}
                  disabled={loading || deepSeekCancellationAction} onClick={() => setDeepSeekScopeOpen((open) => !open)}>
                  <span>整理范围</span><span className="disclosure-arrow favorite-ledger-panel__deepseek-archive-scope-arrow" aria-hidden="true" />
                </button>
                {deepSeekScopeOpen ? <div className="favorite-ledger-panel__deepseek-archive-scope-menu" role="menu" aria-label="DeepSeek 处理对象">
                  {DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS.map((option) => <button key={option.value} type="button" role="menuitemradio"
                    aria-checked={deepSeekMode === option.value} onClick={() => { setDeepSeekMode(option.value); setDeepSeekScopeOpen(false) }}>
                    {option.label}
                  </button>)}
                  {snapshot.hasMultipleSegments ? <>
                    <div className="favorite-ledger-panel__deepseek-archive-scope-menu-divider" aria-hidden="true" />
                    <div className="favorite-ledger-panel__deepseek-archive-batch-scope" role="group" aria-label="DeepSeek 批次范围">
                      <span>批次范围</span>
                      <div className="favorite-ledger-panel__deepseek-archive-batch-scope-options">
                        <button type="button" role="menuitemradio" aria-checked={deepSeekScope === 'current'}
                          onClick={() => { setDeepSeekScope('current'); setDeepSeekScopeOpen(false) }}>当前批次</button>
                        <button type="button" role="menuitemradio" aria-checked={deepSeekScope === 'all'}
                          onClick={() => { setDeepSeekScope('all'); setDeepSeekScopeOpen(false) }}>本轮所有批次</button>
                      </div>
                    </div>
                  </> : null}
                </div> : null}
              </div>
              {deepSeekCancellationAction ? <button
                type="button" className="favorite-ledger-panel__deepseek-archive-run-button" data-action="cancel"
                disabled={deepSeekFeedbackView.action === 'cancelling'} onClick={onCancelDeepSeek}>
                {deepSeekFeedbackView.action === 'cancelling' ? '正在取消' : '取消整理'}
              </button> : <button type="button" className="favorite-ledger-panel__deepseek-archive-run-button"
                disabled={!deepSeekAvailable || loading || mutationLocked || deepSeekFeedbackView?.kind === 'running' || !hasPreviewItems} onClick={() => onOrganizeWithDeepSeek(deepSeekMode, snapshot.hasMultipleSegments ? deepSeekScope : 'current')}>
                DeepSeek 整理
              </button>}
            </div>
          </div>
          {!deepSeekAvailable ? <small className="favorite-ledger-panel__deepseek-archive-disabled">请先到设置开启 DeepSeek 后再使用辅助整理。</small> : null}
          <p className="favorite-ledger-panel__deepseek-archive-hint">将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息给 DeepSeek。</p>
          {deepSeekFeedbackView ? <div className="favorite-ledger-panel__deepseek-result"
            role={deepSeekFeedbackView.kind === 'failed' ? 'alert' : 'status'}>
            <p className="favorite-ledger-panel__deepseek-feedback-copy">{deepSeekFeedbackView.summary}</p>
            {deepSeekFeedbackView.progress ? <div className="favorite-ledger-panel__deepseek-archive-progress" data-running={deepSeekFeedbackView.kind === 'running'}>
              <div className="favorite-ledger-panel__deepseek-archive-progress-copy">
                <span>第 {deepSeekFeedbackView.progress.completedChunks} / {deepSeekFeedbackView.progress.totalChunks} 批</span>
                <span>已完成 {deepSeekFeedbackView.progress.completedVideos} / {deepSeekFeedbackView.progress.totalVideos} 条视频</span>
              </div>
              <div aria-label="DeepSeek 整理进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={deepSeekFeedbackView.progress.value}
                className="favorite-ledger-panel__deepseek-archive-progress-track" role="progressbar">
                <span style={{ width: `${deepSeekFeedbackView.progress.value}%` }} />
              </div>
            </div> : null}
            {deepSeekFeedbackView.failures.length ? <details className="favorite-ledger-panel__deepseek-result-details">
              <summary>查看失败详情</summary>
              {deepSeekFeedbackView.failures.map((failure) => <p key={failure.chunkIndex}>第 {failure.chunkIndex} 批：{deepSeekFailureMessage(failure.message, failure.affectedVideoCount)}</p>)}
            </details> : null}
            {deepSeekFeedbackView.action === 'retry' ? <button type="button" disabled={loading || mutationLocked} onClick={onRetryFailedDeepSeekChunks}>重试失败批次</button> : null}
          </div> : null}
        </div>
        <div className="favorite-ledger-panel__archive-tool-divider favorite-ledger-panel__archive-tool-divider--full-width" aria-hidden="true" />
        <div className="favorite-ledger-panel__archive-history-section" role="group" aria-label="归档预览改动操作">
          <div className="favorite-ledger-panel__archive-history-actions">
            <label className="favorite-ledger-panel__archive-history-select">
              <span>改动记录</span>
              <div className="favorite-ledger-panel__archive-history-select-control">
              <button ref={historyTriggerRef} type="button" className="favorite-ledger-panel__archive-history-trigger"
                aria-label="查看改动记录" aria-expanded={historyOpen} disabled={loading || historyEntries.length === 0}
                onClick={() => setHistoryOpen((open) => !open)}>
                <span className="disclosure-arrow favorite-ledger-panel__archive-history-arrow" aria-hidden="true" />
              </button>
              {historyOpen ? <div className="favorite-ledger-panel__archive-history-menu" style={{ top: historyMenuPosition.top, left: historyMenuPosition.left, right: 'auto' }} role="menu" aria-label="改动记录">
                <div className="favorite-ledger-panel__archive-history-current">当前记录：{currentHistoryLabel}</div>
                {previousHistoryEntries.map((entry) => <button key={entry.cursor} type="button" role="menuitem"
                  disabled={loading || mutationLocked} onClick={() => {
                    setHistoryOpen(false)
                    onMoveHistoryCursor(entry.cursor)
                  }}>{historyLabel(entry)}</button>)}
                <div className="favorite-ledger-panel__archive-history-divider" aria-hidden="true" />
                <button type="button" role="menuitem" className="favorite-ledger-panel__archive-history-restore"
                  disabled={loading || mutationLocked || snapshot.history.cursor <= historyBaselineCursor} onClick={() => {
                    setHistoryOpen(false)
                    onMoveHistoryCursor(historyBaselineCursor)
                  }}>恢复初始改动</button>
              </div> : null}
              </div>
            </label>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading || mutationLocked || snapshot.history.cursor <= historyBaselineCursor} onClick={onUndo}>撤销本次改动</button>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading || mutationLocked || snapshot.history.cursor >= snapshot.history.length} onClick={onRedo}>恢复本次改动</button>
          </div>
          <p>Ctrl+Z 撤销，Ctrl+Shift+Z 恢复；会按最近改动逐步回退或重做。</p>
        </div>
      </div>
    </div>
    <OldFavoriteArchiveGroups snapshot={snapshot} ledgers={ledgers} loading={loading} mutationLocked={mutationLocked}
      onApplyManualClassification={onApplyManualClassification} onApplyManualClassifications={onApplyManualClassifications} />
  </section>
}

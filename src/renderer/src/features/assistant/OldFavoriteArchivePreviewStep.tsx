import type { FavoriteLedger } from '@shared/types'
import type { DeepSeekArchiveMode, DeepSeekArchiveScope } from '@shared/types'
import {
  oldFavoriteFolderIsScanEligible,
  type OldFavoriteWorkspaceDeepSeekProcessedItem,
  type OldFavoriteWorkspaceSnapshot
} from '@shared/oldFavoriteWorkspace'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { VirtualOldFavoriteTrack } from '../favorites/VirtualOldFavoriteTrack'
import { OldFavoritePreviewCard } from './OldFavoritePreviewCard'
import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'
import { toDeepSeekFeedbackView } from './oldFavoriteDeepSeekFeedbackModel'
import { OldFavoriteViewScopeSwitch, OldFavoriteWholeRunOverview, type OldFavoriteViewScope } from './OldFavoriteOverviewControls'
import { OldFavoriteModal } from './OldFavoriteModal'
import { useExclusiveMenu } from '../../components/useExclusiveMenu'

const VIRTUAL_TRACK_THRESHOLD = 50
const INITIAL_GROUP_ITEM_LIMIT = 6

function isUnavailablePreviewItem(item: { unavailable?: boolean; title?: string; author?: string }) {
  return item.unavailable === true || item.title?.trim() === '已失效视频' || item.author?.trim() === '账号已注销'
}

function haveSameTargets(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((targetLedgerId) => right.includes(targetLedgerId))
}

function formatBatchIndices(indices: number[]) {
  const sortedIndices = [...new Set(indices)].sort((left, right) => left - right)
  const labels: string[] = []
  for (let start = 0; start < sortedIndices.length;) {
    let end = start
    while (end + 1 < sortedIndices.length && sortedIndices[end + 1] === sortedIndices[end] + 1) end += 1
    const first = sortedIndices[start]
    const last = sortedIndices[end]
    labels.push(end - start >= 2 ? `${first}～${last}` : sortedIndices.slice(start, end + 1).join('、'))
    start = end + 1
  }
  return labels.join('、')
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
  { value: 'unclassified-only', label: '只整理【未匹配到合适分类】' },
  { value: 'low-confidence-and-unclassified', label: '整理不确定项和【未分类】' },
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
  recommendedCandidateIds?: string[]
  enabledLedgerIds?: ReadonlySet<string>
  viewScope?: OldFavoriteViewScope
  onViewScopeChange?: (scope: OldFavoriteViewScope) => void
  contentAvailable?: boolean
}

type OldFavoriteArchiveGroupsProps = Pick<OldFavoriteArchivePreviewStepProps,
  'snapshot' | 'ledgers' | 'loading' | 'mutationLocked' | 'onApplyManualClassification' | 'onApplyManualClassifications' | 'recommendedCandidateIds' | 'enabledLedgerIds'>

const OldFavoriteArchiveGroups = memo(function OldFavoriteArchiveGroups({
  snapshot,
  ledgers,
  loading,
  mutationLocked = false,
  onApplyManualClassification,
  onApplyManualClassifications,
  recommendedCandidateIds,
  enabledLedgerIds
}: OldFavoriteArchiveGroupsProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const [batchGroupId, setBatchGroupId] = useState<string | null>(null)
  const [batchSelectedAids, setBatchSelectedAids] = useState<Set<number>>(() => new Set())
  const [batchTargetOpen, setBatchTargetOpen, batchTargetScope] = useExclusiveMenu()
  const [batchTargetPosition, setBatchTargetPosition] = useState({ top: 0, left: 0 })
  const [recentlyMovedAidByLedgerId, setRecentlyMovedAidByLedgerId] = useState<Record<string, number>>({})
  const groupsRootRef = useRef<HTMLDivElement>(null)
  const batchTargetTriggerRef = useRef<HTMLButtonElement>(null)
  const batchTargetMenuRef = useRef<HTMLDivElement>(null)
  const pendingMoveFocusRef = useRef<{ aid: number; sourceLedgerId: string; targetLedgerId: string } | null>(null)
  const sourceFolderTitles = new Map(snapshot.sourceFolders
    .filter((folder) => folder.selected && oldFavoriteFolderIsScanEligible(folder))
    .map((folder) => [folder.id, folder.title]))
  const selectedSourceIds = new Set(snapshot.sourceFolders
    .filter((folder) => folder.selected && oldFavoriteFolderIsScanEligible(folder))
    .map((folder) => folder.id))
  const items = (snapshot.currentSegment?.items ?? []).filter((item) =>
    !isUnavailablePreviewItem(item) && item.sourceFolderIds.some((folderId) => selectedSourceIds.has(folderId)))
  const recommendationIds = useMemo(() => new Set(snapshot.recommendations.candidates.map((candidate) => candidate.id)), [snapshot.recommendations.candidates])
  const selectedRecommendationKey = (recommendedCandidateIds ?? snapshot.recommendations.adoptedCandidateIds).join('\u0001')
  const effectiveClassifications = useMemo(() => {
    const selectedRecommendations = new Set(selectedRecommendationKey.split('\u0001').filter(Boolean))
    return Object.fromEntries(Object.entries(snapshot.classifications).map(([aid, classification]) => {
      const targetLedgerIds = classification.targetLedgerIds.filter((ledgerId) =>
        ledgerId === 'inbox' || (enabledLedgerIds?.has(ledgerId) ?? true) && (!recommendationIds.has(ledgerId) || selectedRecommendations.has(ledgerId)))
      return [aid, targetLedgerIds.length === classification.targetLedgerIds.length
        ? classification
        : { ...classification, targetLedgerIds }]
    }))
  }, [enabledLedgerIds, recommendationIds, selectedRecommendationKey, snapshot.classifications])
  const selectedRecommendations = useMemo(() => new Set(selectedRecommendationKey.split('\u0001').filter(Boolean)), [selectedRecommendationKey])
  const unmatched = items.filter((item) => !effectiveClassifications[String(item.aid)]?.targetLedgerIds.length)
  const classified = groupOldFavoritePreviewItems(items, effectiveClassifications, new Set(ledgers.map((ledger) => ledger.id)))
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
  for (const ledger of ledgers) {
    if (!recommendationIds.has(ledger.id) || !selectedRecommendations.has(ledger.id) || previewGroups.some((group) => group.id === ledger.id)) continue
    previewGroups.push({ id: ledger.id, title: ledger.displayName, items: [] })
  }
  const handleManualClassification = (aid: number, currentLedgerId: string | undefined, nextTargetLedgerIds: string[]) => {
    const previousTargetLedgerIds = snapshot.classifications[String(aid)]?.targetLedgerIds ?? []
    const targetLedgerId = nextTargetLedgerIds.find((ledgerId) => !previousTargetLedgerIds.includes(ledgerId))
      ?? nextTargetLedgerIds[0]
      ?? 'unclassified'
    pendingMoveFocusRef.current = { aid, sourceLedgerId: currentLedgerId ?? 'unclassified', targetLedgerId }
    setRecentlyMovedAidByLedgerId((current) => ({ ...current, [targetLedgerId]: aid }))
    onApplyManualClassification(aid, nextTargetLedgerIds)
  }
  const renderItem = (item: typeof items[number], currentLedgerId?: string, batchSelectable = false) => <OldFavoritePreviewCard
    item={item}
    sourceFolderTitles={item.sourceFolderIds.map((id) => sourceFolderTitles.get(id)).filter((title): title is string => Boolean(title))}
    classification={effectiveClassifications[String(item.aid)]}
    currentLedgerId={currentLedgerId}
    originalTargetLedgerIds={snapshot.originalTargetLedgerIdsByAid?.[String(item.aid)]}
    ledgers={ledgers}
    loading={loading || mutationLocked}
    batchSelectable={batchSelectable}
    batchSelected={batchSelectable && batchSelectedAids.has(item.aid)}
    onToggleBatchSelection={(aid) => setBatchSelectedAids((current) => {
      const next = new Set(current)
      if (next.has(aid)) next.delete(aid)
      else next.add(aid)
      return next
    })}
    onApplyManualClassification={(aid, targetLedgerIds) => handleManualClassification(aid, currentLedgerId, targetLedgerIds)}
  />

  const closeBatchMode = () => {
    const closingGroupId = batchGroupId
    setBatchGroupId(null)
    setBatchSelectedAids(new Set())
    setBatchTargetOpen(false)
    if (closingGroupId) {
      setExpandedGroups((current) => {
        const next = new Set(current)
        next.delete(closingGroupId)
        return next
      })
    }
  }

  useEffect(() => {
    setBatchGroupId(null)
    setBatchSelectedAids(new Set())
    setBatchTargetOpen(false)
    setExpandedGroups(new Set())
  }, [snapshot.currentSegment?.id])

  useLayoutEffect(() => {
    if (!batchTargetOpen) return
    const updatePosition = () => {
      const trigger = batchTargetTriggerRef.current
      const menu = batchTargetMenuRef.current
      if (!trigger || !menu) return
      const triggerRect = trigger.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const gutter = 8
      const below = triggerRect.bottom + 4
      const above = triggerRect.top - menuRect.height - 4
      setBatchTargetPosition({
        top: below + menuRect.height <= window.innerHeight || above < gutter ? below : above,
        left: Math.max(gutter, Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - gutter))
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [batchTargetOpen])

  useEffect(() => {
    if (!batchTargetOpen) return
    const closeFromOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && !batchTargetMenuRef.current?.contains(target) && !batchTargetTriggerRef.current?.contains(target)) setBatchTargetOpen(false)
    }
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBatchTargetOpen(false)
    }
    document.addEventListener('mousedown', closeFromOutside)
    document.addEventListener('keydown', closeFromEscape)
    return () => {
      document.removeEventListener('mousedown', closeFromOutside)
      document.removeEventListener('keydown', closeFromEscape)
    }
  }, [batchTargetOpen])

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
      const batchActive = batchGroupId === group.id
      const visibleItems = expanded ? group.items : group.items.slice(0, INITIAL_GROUP_ITEM_LIMIT)
      const allBatchSelected = batchActive && group.items.length > 0 && batchSelectedAids.size === group.items.length
      const applyBatchTarget = (targetLedgerId: string) => {
        const knownLedgerIds = new Set(ledgers.map((ledger) => ledger.id))
        const selectedAids = batchSelectedAids
        onApplyManualClassifications(group.items.filter((item) => selectedAids.has(item.aid)).map((item) => {
          const previous = snapshot.classifications[String(item.aid)]?.targetLedgerIds ?? []
          const preserved = group.id === 'unclassified'
            ? previous
            : previous.filter((id) => group.id === 'other' ? id === 'inbox' || knownLedgerIds.has(id) : id !== group.id)
          return { aid: item.aid, targetLedgerIds: [...new Set([...preserved, targetLedgerId])].slice(0, 3) }
        }))
        closeBatchMode()
      }
      return <section key={group.id} className={`favorite-ledger-panel__preview-row${group.id === 'unclassified' ? ' favorite-ledger-panel__preview-row--pending' : ''}`}
        data-archive-ledger-id={group.id} role="group" aria-label={`${group.title} ${group.items.length} 条`}>
        <header><span className="favorite-ledger-panel__preview-heading"><strong>{group.title}</strong><small>{group.items.length} 条{group.id === 'unclassified' ? '需要处理' : '适合'}</small></span>
          <div className="favorite-ledger-panel__preview-header-actions">
            {batchActive ? <>
              <span className="favorite-ledger-panel__preview-batch-left">
                <button type="button" disabled={loading || mutationLocked} aria-pressed={allBatchSelected} onClick={() => setBatchSelectedAids(allBatchSelected ? new Set() : new Set(group.items.map((item) => item.aid)))}>全选</button>
                <button type="button" disabled={loading || mutationLocked} onClick={closeBatchMode}>取消批量</button>
              </span>
              <button {...batchTargetScope} ref={batchTargetTriggerRef} type="button" aria-haspopup="menu" aria-expanded={batchTargetOpen} disabled={loading || mutationLocked || batchSelectedAids.size === 0}
                onClick={() => setBatchTargetOpen((open) => !open)}>转移所选 <span className="disclosure-arrow" aria-hidden="true">▾</span></button>
              {batchTargetOpen ? createPortal(<div {...batchTargetScope} ref={batchTargetMenuRef} className="favorite-ledger-panel__target-menu favorite-ledger-panel__target-menu--floating favorite-ledger-panel__batch-target-menu"
                style={{ top: batchTargetPosition.top, left: batchTargetPosition.left }} role="menu" aria-label={`批量转移 ${group.title}`}>
                <button type="button" role="menuitem" onClick={() => applyBatchTarget('inbox')}>暂存</button>
                {ledgers.filter((ledger) => ledger.id !== 'inbox' && (enabledLedgerIds?.has(ledger.id) ?? ledger.enabled)).map((ledger) => <button key={ledger.id} type="button" role="menuitem" onClick={() => applyBatchTarget(ledger.id)}>{ledger.displayName}</button>)}
              </div>, document.body) : null}
            </> : <>
              <button type="button" disabled={loading || mutationLocked} onClick={() => {
                setBatchGroupId(group.id)
                setBatchSelectedAids(new Set())
                setExpandedGroups((current) => new Set(current).add(group.id))
              }}>批量转移</button>
              {group.items.length > INITIAL_GROUP_ITEM_LIMIT ? <button type="button" className="favorite-ledger-panel__preview-expand-toggle"
                aria-expanded={expanded} onClick={() => setExpandedGroups((current) => {
                  const next = new Set(current)
                  if (expanded) next.delete(group.id)
                  else next.add(group.id)
                  return next
                })}>{expanded ? `收起 ${group.items.length} 条` : `显示全部 ${group.items.length} 条`}</button> : null}
            </>}
          </div>
        </header>
        {expanded && group.items.length > VIRTUAL_TRACK_THRESHOLD ? <VirtualOldFavoriteTrack className="favorite-ledger-panel__preview-videos favorite-ledger-panel__preview-videos--virtual"
          ariaLabel={`${group.title} 视频`} items={group.items} itemKey={(item) => `${group.id}-${item.aid}`} renderItem={(item) => renderItem(item, group.id === 'unclassified' ? undefined : group.id, batchActive)} /> :
          <div className="favorite-ledger-panel__preview-videos" aria-label={`${group.title} 视频`}>{visibleItems.map((item) => <div key={`${group.id}-${item.aid}`} className="favorite-ledger-panel__preview-item-shell">{renderItem(item, group.id === 'unclassified' ? undefined : group.id, batchActive)}</div>)}</div>}
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
  recommendedCandidateIds = [],
  enabledLedgerIds,
  viewScope: controlledViewScope,
  onViewScopeChange,
  contentAvailable = true,
}: OldFavoriteArchivePreviewStepProps) {
  const [localViewScope, setLocalViewScope] = useState<OldFavoriteViewScope>('current')
  const viewScope = controlledViewScope ?? localViewScope
  const setViewScope = onViewScopeChange ?? setLocalViewScope
  const [deepSeekMode, setDeepSeekMode] = useState<DeepSeekArchiveMode>('unclassified-only')
  const [deepSeekScope, setDeepSeekScope] = useState<DeepSeekArchiveScope>('current')
  const [deepSeekDialogOpen, setDeepSeekDialogOpen] = useState(false)
  const [deepSeekDetailsOpen, setDeepSeekDetailsOpen] = useState(false)
  const [historyOpen, setHistoryOpen, historyMenuScope] = useExclusiveMenu()
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const historyMenuRef = useRef<HTMLDivElement>(null)
  const [historyMenuPosition, setHistoryMenuPosition] = useState({ top: 0, left: 0 })
  const deepSeekFeedbackView = deepSeekFeedback
    ? toDeepSeekFeedbackView(deepSeekFeedback, deepSeekCancelRequested)
    : null
  const persistedDeepSeekRetry = snapshot.deepSeekRun?.status === 'failed' && (snapshot.deepSeekRun.failedVideoCount ?? 0) > 0
    ? { label: `重试失败 ${snapshot.deepSeekRun.failedVideoCount} 条`, count: snapshot.deepSeekRun.failedVideoCount }
    : snapshot.deepSeekRun?.status === 'canceled' && (snapshot.deepSeekRun.pendingVideoCount ?? 0) > 0
      ? { label: `重试未完成 ${snapshot.deepSeekRun.pendingVideoCount} 条`, count: snapshot.deepSeekRun.pendingVideoCount }
      : null
  const retryLabel = persistedDeepSeekRetry?.label ?? (deepSeekFeedbackView?.action === 'retry' && deepSeekFeedbackView.failures.length
    ? `重试失败 ${deepSeekFeedbackView.failures.reduce((total, failure) => total + failure.affectedVideoCount, 0)} 条`
    : null)
  const deepSeekCancellationAction = deepSeekFeedbackView?.action === 'cancel' || deepSeekFeedbackView?.action === 'cancelling'
  const historySourceLabels = {
    manual: '人工调整',
    fallback: '沿用原自动分类',
    deepseek: 'DeepSeek',
    'system-high': '高置信度自动分类',
    'system-low': '低置信度自动分类'
  } as const
  const ledgerNames = new Map(ledgers.filter((ledger) => enabledLedgerIds?.has(ledger.id) ?? ledger.enabled).map((ledger) => [ledger.id, ledger.displayName]))
  const hasMultipleSegments = snapshot.hasMultipleSegments || snapshot.segments.length > 1
  const historyTargetLabel = (targetLedgerIds: string[]) =>
    targetLedgerIds.map((id) => ledgerNames.get(id) ?? id).join('、') || '未分类'
  const detailTargetLabel = (targetLedgerIds: string[]) =>
    targetLedgerIds.map((id) => id === 'inbox' ? '暂存' : ledgerNames.get(id) ?? id).join('、') || '未分类'
  const historyLabel = (entry: OldFavoriteWorkspaceSnapshot['history']['entries'][number]) => {
    if (!entry.summary) {
      return `${historySourceLabels[entry.source]}：${entry.changeCount} 条 → ${historyTargetLabel(entry.targetLedgerIds)}`
    }
    const before = historyTargetLabel(entry.summary.beforeTargetLedgerIds)
    const after = historyTargetLabel(entry.summary.afterTargetLedgerIds)
    if (entry.summary.movedCount === 1 && entry.summary.title) {
      return `${entry.summary.title}：${before} → ${after}`
    }
    return `${entry.summary.reason} ${entry.summary.movedCount} 条：${before} → ${after}`
  }
  const historyBaselineCursor = snapshot.history.baselineCursor ?? 0
  const historyEntries = snapshot.history.entries ?? []
  const currentHistoryEntry = historyEntries.find((entry) => entry.cursor === snapshot.history.cursor)
  const previousHistoryEntries = historyEntries.filter((entry) => entry.cursor !== snapshot.history.cursor)
  const currentHistoryLabel = currentHistoryEntry ? historyLabel(currentHistoryEntry) : '初始自动分类'
  const deepSeekProcessedItems = deepSeekFeedbackView?.progress?.processedItems
  const currentSegmentAidSet = useMemo(() => new Set(snapshot.currentSegment?.aids ?? []), [snapshot.currentSegment?.aids])
  const deepSeekDetails = useMemo(() => {
    const detailsByAid = new Map<number, OldFavoriteWorkspaceDeepSeekProcessedItem>()
    if (snapshot.deepSeekOrganization) {
      const selectedSegments = snapshot.deepSeekOrganization.segments
        .filter((segment) => viewScope === 'all' || segment.id === snapshot.currentSegment?.id)
        .sort((left, right) => left.index - right.index)
      for (const segment of selectedSegments) {
        for (const detail of segment.details) {
          if (detail.title?.trim() === '已失效视频') continue
          detailsByAid.set(detail.aid, detail)
        }
      }
    } else {
      const appliedHistoryEntries = historyEntries
        .filter((entry) => entry.source === 'deepseek' && entry.cursor <= snapshot.history.cursor)
        .sort((left, right) => left.cursor - right.cursor)
      for (const entry of appliedHistoryEntries) {
        for (const detail of entry.summary?.details ?? []) {
          if (detail.title?.trim() === '已失效视频') continue
          detailsByAid.set(detail.aid, {
            ...detail,
            changed: !haveSameTargets(detail.beforeTargetLedgerIds, detail.afterTargetLedgerIds)
          })
        }
      }
    }
    for (const detail of deepSeekProcessedItems ?? []) {
      if (detail.title?.trim() === '已失效视频') continue
      if (viewScope !== 'all' && hasMultipleSegments && !currentSegmentAidSet.has(detail.aid)) continue
      detailsByAid.set(detail.aid, detail)
    }
    return [...detailsByAid.values()]
  }, [currentSegmentAidSet, deepSeekProcessedItems, hasMultipleSegments, historyEntries, snapshot.currentSegment?.id, snapshot.deepSeekOrganization, snapshot.history.cursor, viewScope])
  const otherBatchOrganizationSummary = useMemo(() => {
    if (viewScope !== 'all' || !snapshot.deepSeekOrganization) return ''
    const otherSegments = snapshot.deepSeekOrganization.segments.filter((segment) => segment.id !== snapshot.currentSegment?.id)
    const labels: Array<{ status: typeof otherSegments[number]['status']; label: string }> = [
      { status: 'organized', label: '已整理' },
      { status: 'partial', label: '部分整理' },
      { status: 'unorganized', label: '未整理' }
    ]
    const summaries = labels.flatMap(({ status, label }) => {
      const indices = otherSegments.filter((segment) => segment.status === status).map((segment) => segment.index + 1)
      return indices.length ? [`第 ${formatBatchIndices(indices)} 批${label}`] : []
    })
    return summaries.length ? `其他批次：${summaries.join('；')}` : ''
  }, [snapshot.currentSegment?.id, snapshot.deepSeekOrganization, viewScope])
  useEffect(() => setDeepSeekDetailsOpen(false), [snapshot.workspaceId])
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
      const menuRect = historyMenuRef.current?.getBoundingClientRect()
      if (!triggerRect) return
      const gutter = 8
      const menuWidth = Math.min(360, window.innerWidth - gutter * 2)
      const menuHeight = menuRect?.height ?? 0
      const below = triggerRect.bottom + 4
      const above = triggerRect.top - menuHeight - 4
      setHistoryMenuPosition({
        top: below + menuHeight <= window.innerHeight || above < gutter ? below : above,
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
      .filter((folder) => folder.selected && oldFavoriteFolderIsScanEligible(folder))
      .map((folder) => folder.id))
    return (snapshot.currentSegment?.items ?? []).some((item) =>
      !isUnavailablePreviewItem(item) && item.sourceFolderIds.some((folderId) => selectedSourceIds.has(folderId)))
  }, [snapshot])
  const openDeepSeekDialog = () => {
    setDeepSeekMode('unclassified-only')
    setDeepSeekScope(viewScope === 'all' ? 'all' : 'current')
    setDeepSeekDialogOpen(true)
  }
  const confirmDeepSeekDialog = () => {
    setDeepSeekDialogOpen(false)
    onOrganizeWithDeepSeek(deepSeekMode, hasMultipleSegments ? deepSeekScope : 'current')
  }

  if (!contentAvailable) {
    return <section className="favorite-ledger-panel__preview favorite-ledger-panel__archive-preview" aria-label="归档预览">
      <div className="favorite-ledger-panel__preview-topbar">
        <div className="favorite-ledger-panel__step-title-row">
          <h4 className="favorite-ledger-panel__step-title">归档预览</h4>
          {hasMultipleSegments ? <OldFavoriteViewScopeSwitch label="归档预览视图" value={viewScope} onChange={setViewScope} /> : null}
        </div>
      </div>
      {hasMultipleSegments && viewScope === 'all' ? <OldFavoriteWholeRunOverview snapshot={snapshot} ledgerNames={ledgerNames} showArchiveTargets selectedRecommendationIds={new Set(recommendedCandidateIds)} enabledLedgerIds={enabledLedgerIds} /> : null}
      <p role="status">{viewScope === 'all' ? '本轮仍有标签补取中，完成批次会在就绪后汇总到归档预览。' : '当前批次标签补取中，完成后可查看归档预览。'}</p>
    </section>
  }

  return <section className="favorite-ledger-panel__preview favorite-ledger-panel__archive-preview" aria-label="归档预览">
    <div className="favorite-ledger-panel__preview-topbar">
      <div className="favorite-ledger-panel__step-title-row">
        <h4 className="favorite-ledger-panel__step-title">归档预览</h4>
        {hasMultipleSegments ? <OldFavoriteViewScopeSwitch label="归档预览视图" value={viewScope} onChange={setViewScope} /> : null}
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
              {deepSeekCancellationAction ? <button
                type="button" className="favorite-ledger-panel__deepseek-archive-run-button" data-action="cancel"
                disabled={deepSeekFeedbackView.action === 'cancelling'} onClick={onCancelDeepSeek}>
                {deepSeekFeedbackView.action === 'cancelling' ? '正在取消' : '取消整理'}
              </button> : <button type="button" className="favorite-ledger-panel__deepseek-archive-run-button"
                disabled={!deepSeekAvailable || loading || mutationLocked || deepSeekFeedbackView?.kind === 'running' || !hasPreviewItems} onClick={openDeepSeekDialog}>
                开始整理
              </button>}
            </div>
          </div>
          {!deepSeekAvailable ? <small className="favorite-ledger-panel__deepseek-archive-disabled favorite-ledger-panel__deepseek-archive-disabled--warning">请先到设置开启 DeepSeek 后再使用辅助整理。</small> : null}
          <p className="favorite-ledger-panel__deepseek-archive-hint">将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息给 DeepSeek。</p>
          {otherBatchOrganizationSummary ? <p className="favorite-ledger-panel__deepseek-archive-hint">{otherBatchOrganizationSummary}</p> : null}
          {deepSeekFeedbackView || deepSeekDetails.length || retryLabel ? <div className="favorite-ledger-panel__deepseek-result"
            role={deepSeekFeedbackView ? deepSeekFeedbackView.kind === 'failed' ? 'alert' : 'status' : undefined}>
            {deepSeekFeedbackView ? <>
              <p className="favorite-ledger-panel__deepseek-feedback-copy">{deepSeekFeedbackView.summary}</p>
              {deepSeekFeedbackView.progress ? <div className="favorite-ledger-panel__deepseek-archive-progress" data-running={deepSeekFeedbackView.kind === 'running'}>
              <div className="favorite-ledger-panel__deepseek-archive-progress-copy">
                <span>DeepSeek 请求组 {deepSeekFeedbackView.progress.settledGroups} / {deepSeekFeedbackView.progress.totalGroups} 已结算</span>
                <span>已应用 {deepSeekFeedbackView.progress.appliedVideos} / {deepSeekFeedbackView.progress.totalVideos} 条视频</span>
                {deepSeekFeedbackView.progress.pendingVideos ? <span>{deepSeekFeedbackView.progress.pendingVideos} 条等待处理</span> : null}
                {deepSeekFeedbackView.progress.failedVideos ? <span>{deepSeekFeedbackView.progress.failedVideos} 条等待重试</span> : null}
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
            </> : null}
            {deepSeekDetails.length ? <details className="favorite-ledger-panel__deepseek-result-details favorite-ledger-panel__deepseek-result-details--organization" open={deepSeekDetailsOpen}>
              <summary onClick={(event: { preventDefault: () => void }) => {
                event.preventDefault()
                setDeepSeekDetailsOpen((open: boolean) => !open)
              }}>查看整理明细（{deepSeekDetails.length} 条）</summary>
              {deepSeekDetailsOpen ? deepSeekDetails.map((detail: OldFavoriteWorkspaceDeepSeekProcessedItem) => <p key={detail.aid}>
                {detail.title?.trim() || `av${detail.aid}`}：{detail.changed
                  ? `${detailTargetLabel(detail.beforeTargetLedgerIds)} → ${detailTargetLabel(detail.afterTargetLedgerIds)}`
                  : `保持原分类（${detailTargetLabel(detail.afterTargetLedgerIds)}）`}
              </p>) : null}
            </details> : null}
            {retryLabel ? <button type="button" disabled={loading || mutationLocked} onClick={onRetryFailedDeepSeekChunks}>{retryLabel}</button> : null}
          </div> : null}
        </div>
        <div className="favorite-ledger-panel__archive-tool-divider favorite-ledger-panel__archive-tool-divider--full-width" aria-hidden="true" />
        <div className="favorite-ledger-panel__archive-history-section" role="group" aria-label="归档预览改动操作">
          <div className="favorite-ledger-panel__archive-history-actions">
            <label className="favorite-ledger-panel__archive-history-select">
              <span>改动记录</span>
              <div {...historyMenuScope} className="favorite-ledger-panel__archive-history-select-control">
              <button ref={historyTriggerRef} type="button" className="favorite-ledger-panel__archive-history-trigger"
                aria-label="查看改动记录" aria-expanded={historyOpen} disabled={loading || historyEntries.length === 0}
                onClick={() => setHistoryOpen((open) => !open)}>
                <span className="disclosure-arrow favorite-ledger-panel__archive-history-arrow" aria-hidden="true" />
              </button>
              {historyOpen ? createPortal(<div {...historyMenuScope} ref={historyMenuRef} className="favorite-ledger-panel__archive-history-menu" style={{ top: historyMenuPosition.top, left: historyMenuPosition.left, right: 'auto' }} role="menu" aria-label="改动记录">
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
              </div>, document.body) : null}
              </div>
            </label>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading || mutationLocked || snapshot.history.cursor <= historyBaselineCursor} onClick={onUndo}>撤销本次改动</button>
            <button type="button" className="favorite-ledger-panel__archive-history-button" disabled={loading || mutationLocked || snapshot.history.cursor >= snapshot.history.length} onClick={onRedo}>恢复本次改动</button>
          </div>
          <p>Ctrl+Z 撤销，Ctrl+Shift+Z 恢复；会按最近改动逐步回退或重做。</p>
        </div>
      </div>
    </div>
    {hasMultipleSegments ? <div className="favorite-ledger-panel__scope-panel" hidden={viewScope !== 'all'} data-testid="whole-run-archive-view">
      <OldFavoriteWholeRunOverview snapshot={snapshot} ledgerNames={ledgerNames} showArchiveTargets selectedRecommendationIds={new Set(recommendedCandidateIds)} enabledLedgerIds={enabledLedgerIds} />
    </div> : null}
    <div className="favorite-ledger-panel__scope-panel" hidden={hasMultipleSegments && viewScope === 'all'} data-testid="current-archive-view">
      <OldFavoriteArchiveGroups snapshot={snapshot} ledgers={ledgers} loading={loading} mutationLocked={mutationLocked}
        onApplyManualClassification={onApplyManualClassification} onApplyManualClassifications={onApplyManualClassifications}
        recommendedCandidateIds={recommendedCandidateIds} enabledLedgerIds={enabledLedgerIds} />
    </div>
    {deepSeekDialogOpen ? <OldFavoriteModal
      title="DeepSeek 整理"
      confirmLabel="开始 DeepSeek 整理"
      confirmDisabled={loading || mutationLocked || !deepSeekAvailable || !hasPreviewItems}
      onCancel={() => setDeepSeekDialogOpen(false)}
      onConfirm={confirmDeepSeekDialog}
      extraActions={<button type="button" onClick={() => setDeepSeekDialogOpen(false)}>取消</button>}
    >
      <fieldset className="favorite-ledger-panel__deepseek-dialog-options">
        <legend>整理对象</legend>
        {DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS.map((option) => <label key={option.value}>
          <input type="radio" name="deepseek-archive-mode" aria-label={option.label} checked={deepSeekMode === option.value} onChange={() => setDeepSeekMode(option.value)} />
          <span>{option.label}</span>
        </label>)}
      </fieldset>
      {hasMultipleSegments ? <fieldset className="favorite-ledger-panel__deepseek-dialog-options">
        <legend>批次范围</legend>
        <label><input type="radio" name="deepseek-archive-scope" aria-label="当前批次" checked={deepSeekScope === 'current'} onChange={() => setDeepSeekScope('current')} /><span>当前批次</span></label>
        <label><input type="radio" name="deepseek-archive-scope" aria-label="本轮所有批次" checked={deepSeekScope === 'all'} onChange={() => setDeepSeekScope('all')} /><span>本轮所有批次</span></label>
      </fieldset> : null}
    </OldFavoriteModal> : null}
  </section>
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLayoutEffect } from 'react'
import type { FavoriteRepositoryClassificationAdjustment, FavoriteRepositoryClassificationSource, FavoriteRepositoryFolder, FavoriteRepositoryLastAdjustment } from '@shared/favoriteRepository'
import { determineFavoriteOperationActionEligibility, determineFavoriteOperationEligibility, type FavoriteLibraryOperationSource } from '@shared/favoriteLibraryOperations'
import type {
  FavoriteRepositoryLibraryPage,
  FavoriteRepositoryLibraryVideoDetail,
  FavoriteRepositorySnapshotSummary,
  FavoriteRepositoryArchiveRestorePreview
} from '../../../../../electron/main/favoriteRepositoryIpc'
import type { FavoriteRepositoryLibrarySourceFilter } from '../../../../../electron/main/favoriteRepositoryService'
import type {
  FavoriteRepositoryArchiveImportPreview,
  FavoriteRepositoryRestoreExecutionResult,
  FavoriteRepositoryRestorePlan
} from '../../../../../electron/main/favoriteRepositoryArchiveService'
import type { ManagedFavoriteRemoteFolderDeletionResult } from '../../../../../electron/main/favoriteRepositorySyncService'
import type { VideoAudioTranscriptionQueueSnapshot } from '@shared/types'
import type { FloatingAssistantWorkspaceRequest } from '../assistant/assistantRuntimeTypes'
import { VirtualFavoriteLibraryList } from './VirtualFavoriteLibraryList'
import { FavoriteLibraryHeader } from './FavoriteLibraryHeader'
import { FavoriteLibraryNavigation, type FavoriteLibraryNavigationGroup } from './FavoriteLibraryNavigation'
import { FavoriteLibraryColumnMenu, FavoriteLibraryDestinationButton, FavoriteLibraryMultiSelectColumnMenu, FavoriteLibraryStateFilterMenu, FavoriteLibraryToolbar, type FavoriteLibraryBatchAction, type FavoriteLibraryFilter, type FavoriteLibrarySort, type FavoriteLibraryTranscriptionFilter } from './FavoriteLibraryToolbar'
import { FavoriteLibraryDetail } from './FavoriteLibraryDetail'
import { VideoNoteBatchExportDialog } from '../notes/VideoNoteBatchExportDialog'
import { VideoSummaryMenu } from '../notes/VideoSummaryMenu'
import { FavoriteLibraryConfirmationDialog } from './FavoriteLibraryDialogs'
import { FavoriteLibraryFooter } from './FavoriteLibraryFooter'
import {
  FavoriteLibrarySelectionCheckbox,
  FavoriteLibrarySelectionStore,
  FavoriteLibrarySelectionSubscriber,
  type FavoriteLibrarySelectionSnapshot
} from './favoriteLibrarySelection'
import { createFrameTaskScheduler } from '../state/frameTaskScheduler'
import { buildFavoriteLibraryEligibilityIndex, resolveFavoriteLibrarySource } from './favoriteLibraryEligibilityIndex'
import {
  buildFavoriteLibraryDetail,
  buildFavoriteLibraryNavigation,
  createFavoriteLibraryViewCache,
  formatFavoriteLibraryMetadataStatus,
  formatFavoriteLibraryMirrorStatus,
  formatFavoriteLibraryOrganizationStatus,
  formatFavoriteLibraryPositionStatus,
  formatFavoriteLibraryPositionSyncStatus,
  FAVORITE_LIBRARY_STAGING_TITLE,
  favoriteLibraryLedgerBindingStatus,
  type FavoriteLibraryRow
} from './favoriteLibraryModel'
import './FavoriteLibraryApp.css'
import { useExclusiveMenu } from '../../components/useExclusiveMenu'

type LibraryScope = { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' } | { kind: 'protected' } | { kind: 'unsynced' } | { kind: 'recycle' }
type MutableLibraryScope = Exclude<LibraryScope, { kind: 'recycle' }>
type FavoriteLibraryStateFilterSelection = {
  sync: 'all' | 'synced' | 'unsynced'
  protection: 'all' | 'protected' | 'unprotected'
  organization: 'all' | 'organized' | 'unorganized'
}
type FavoriteLibraryApiStateFilters = {
  sync?: Exclude<FavoriteLibraryStateFilterSelection['sync'], 'all'>
  protection?: Exclude<FavoriteLibraryStateFilterSelection['protection'], 'all'>
  organization?: Exclude<FavoriteLibraryStateFilterSelection['organization'], 'all'>
}

type ManagedFavoriteFolderDeletionCandidate = {
  logicalLedgerId: string
  remoteFolderId?: string
  title: string
  memberCount: number
  state: 'bound' | 'local-only' | 'unbound-name-match' | 'missing-remote'
  requiresUnboundAcknowledgement: boolean
}

function managedRemoteDeletionSummary(candidates: ManagedFavoriteFolderDeletionCandidate[]) {
  const groups = new Map<string, { title: string; count: number }>()
  for (const candidate of candidates) {
    if (!candidate.remoteFolderId) continue
    const current = groups.get(candidate.logicalLedgerId) ?? { title: candidate.title, count: 0 }
    current.count += 1
    groups.set(candidate.logicalLedgerId, current)
  }
  return [...groups.values()]
    .map(({ title, count }) => `删除“${title}”时，会同时从 B 站删除 ${count} 个实际收藏夹及其中分类视频。`)
    .join(' ')
}

function apiStateFilters(filters: FavoriteLibraryStateFilterSelection): FavoriteLibraryApiStateFilters {
  return {
    ...(filters.sync !== 'all' ? { sync: filters.sync } : {}),
    ...(filters.protection !== 'all' ? { protection: filters.protection } : {}),
    ...(filters.organization !== 'all' ? { organization: filters.organization } : {})
  }
}

type FavoriteLibraryOperationSelection = number[] | {
  kind: 'scope'
  scope: MutableLibraryScope
  options: { query?: string; filter?: FavoriteLibraryFilter; sourceFilter?: FavoriteRepositoryLibrarySourceFilter; stateFilters?: FavoriteLibraryApiStateFilters; sort?: FavoriteLibrarySort; transcriptionFilters?: FavoriteLibraryTranscriptionFilter[]; classificationSources?: FavoriteRepositoryClassificationSource[] }
  excludedAids: number[]
}

type FavoriteLibraryDesktopExtensions = {
  readBilibiliAccount?: () => Promise<{ mid: string; nickname?: string }>
  openFavoriteLibraryVideo?: (accountMid: string, aid: number) => Promise<void>
  openFavoriteLibrarySource?: (accountMid: string, folderId: string) => Promise<void>
  resolveFavoriteLibraryArchive?: (accountMid: string, aid: number, cid?: number) => Promise<{ archiveId: string; versionId: string }>
  toggleFavoriteLibraryArchiveStar?: (accountMid: string, aid: number, cid?: number) => Promise<void>
  saveFavoriteLibraryArchiveMemo?: (accountMid: string, aid: number, memo: string, cid?: number) => Promise<void>
}

const text = {
  library: '\u6536\u85cf\u5e93',
  account: '\u5f53\u524d\u8d26\u53f7\uff1a',
  loadingAccount: '\u6b63\u5728\u8bfb\u53d6\u8d26\u53f7...',
  unavailable: '\u6536\u85cf\u5e93\u6682\u4e0d\u53ef\u7528\u3002',
  signIn: '\u8bf7\u5148\u767b\u5f55 B \u7ad9\u8d26\u53f7\u3002',
  cannotRead: '\u6536\u85cf\u5e93\u65e0\u6cd5\u8bfb\u53d6\u3002',
  cannotRefresh: '\u6536\u85cf\u5e93\u65e0\u6cd5\u5237\u65b0\u3002',
  currentPage: '\u6761\u5f53\u524d\u9875',
  version: '\u7248\u672c',
  navigation: '\u6536\u85cf\u5939\u5bfc\u822a',
  all: '\u5168\u90e8\u6536\u85cf',
  pending: '\u5f85\u5904\u7406',
  results: '\u6536\u85cf\u5e93\u7ed3\u679c',
  videoList: '\u6536\u85cf\u5e93\u89c6\u9891\u5217\u8868',
  unknownAuthor: '\u672a\u77e5 UP \u4e3b',
  memberships: '\u4e2a\u5f52\u5c5e',
  nextPage: '\u4e0b\u4e00\u9875',
  detail: '\u89c6\u9891\u8be6\u60c5',
  hideDetail: '\u6536\u8d77\u8be6\u60c5',
  noDescription: '\u6682\u65e0\u7b80\u4ecb\u3002',
  membershipsHeading: '\u5f52\u5c5e',
  pendingStates: '\u5f85\u5904\u7406\uff1a',
  select: '\u9009\u62e9',
  selectPage: '\u5168\u9009\u5f53\u524d\u9875',
  selected: '\u5df2\u9009',
  item: '\u9879',
  syncSelected: '\u5237\u65b0\u6240\u9009\u4fe1\u606f',
  syncFolder: '\u5907\u518c\u5f53\u524d\u6536\u85cf\u5939',
  transcription: '\u52a0\u5165\u8f6c\u5199\u961f\u5217',
  mirror: '\u672c\u5730\u955c\u50cf',
  source: '\u89c6\u9891\u6765\u6e90',
  openVideo: '\u6253\u5f00\u89c6\u9891',
  openSource: '\u6253\u5f00\u6765\u6e90\u6536\u85cf\u5939',
  scan: '\u626b\u63cf\u4fe1\u606f',
  videoId: '\u89c6\u9891 ID',
  archive: '\u6863\u6848\u5173\u8054',
  noArchive: '\u6682\u65e0\u672c\u5730\u6863\u6848',
  star: '\u661f\u6807',
  unstar: '\u53d6\u6d88\u661f\u6807',
  saveMemo: '\u4fdd\u5b58\u5907\u6ce8',
  transcriptionState: '\u8f6c\u5199\u72b6\u6001',
  actionFailed: '\u6536\u85cf\u5e93\u64cd\u4f5c\u672a\u5b8c\u6210\u3002'
  , organizationHistory: '\u6574\u7406\u8bb0\u5f55', noOrganizationHistory: '\u6682\u65e0\u6574\u7406\u8bb0\u5f55\u3002',
  conflicts: '\u68c0\u6d4b\u5230\u6536\u85cf\u5939\u7ed1\u5b9a\u51b2\u7a81\u3002'
} as const

function favoriteLibraryActionFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  if (/account mismatch|account changed|does not match the current Bilibili account/i.test(detail)) return '当前 B 站账号与收藏库账号不一致；请切换回对应账号后重试。'
  if (/revision mismatch|baseline is stale|baseline.*stale/i.test(detail)) return '收藏库内容刚刚变化；请刷新当前列表后重新操作。'
  if (/no unambiguous remote binding|unbound|not bound|binding.*missing/i.test(detail)) return '该工作夹没有可确认的正式 B 站绑定；请先在工作夹设置中完成绑定或重绑。'
  if (/target was not found|target-missing|managed folder was not found/i.test(detail)) return '目标工作夹已不存在或不可用；请刷新列表后重新选择。'
  if (/capacity|full|limit/i.test(detail)) return '目标 B 站收藏夹容量已满；请整理空间或选择其他已绑定分册。'
  if (/result-unknown|reconciliation|required|remote-ambiguous/i.test(detail)) return '删除未成功，请稍后重试。'
  if (/csrf-missing|login|credential/i.test(detail)) return 'B 站登录状态已失效；请刷新已登录的 B 站页面后重试。'
  if (/remote.*reject|http-status|bilibili-code|invalid-response/i.test(detail)) return 'B 站拒绝了本次操作；请检查登录状态和目标收藏夹后重新确认。'
  if (/network|timeout|unavailable/i.test(detail)) return '无法连接 B 站或本地服务；请检查网络和登录状态后重试。'
  return text.actionFailed
}

function isMissingRemoteUnfavoriteTarget(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  return /收藏未同步|managed placement removal has no matching placements/i.test(detail)
}

function pageRows(page: FavoriteRepositoryLibraryPage): FavoriteLibraryRow[] {
  return page.items.map((item) => ({
    ...item.video,
    folderIds: [...item.folderIds],
    pendingStates: [...item.pendingStates],
    libraryStates: item.libraryStates ? { ...item.libraryStates } : undefined,
    ...(item.organization ? { organization: { ...item.organization } } : {})
  }))
}

function pendingCount(summary: FavoriteRepositorySnapshotSummary) {
  return summary.pendingAidCount ?? (summary.syncCounts.pending + summary.syncCounts.failed + summary.syncCounts['result-unknown'] +
    (summary.workspace?.continuationCount ?? 0))
}

function scopeForNavigation(id: string): LibraryScope {
  if (id === 'pending') return { kind: 'pending' }
  if (id === 'protected') return { kind: 'protected' }
  if (id === 'unsynced') return { kind: 'unsynced' }
  if (id === 'recycle') return { kind: 'recycle' }
  if (id.startsWith('folder:')) return { kind: 'folder', folderId: id.slice('folder:'.length) }
  return { kind: 'all' }
}

type FavoriteLibraryAccount = { mid: string; nickname?: string }

type CachedFavoriteLibraryUi = {
  scopeId: string
  pageNumber: number
  pageSize: 25 | 50 | 100
  searchQuery: string
  libraryStateFilters: FavoriteLibraryStateFilterSelection
  sourceFilter: FavoriteRepositoryLibrarySourceFilter | 'all'
  rowSort: FavoriteLibrarySort
  transcriptionFilters: FavoriteLibraryTranscriptionFilter[]
  classificationSources: FavoriteRepositoryClassificationSource[]
  scrollTop: number
  selected?: FavoriteLibraryRow
  detailOpen: boolean
}

function navigationForScope(scope: LibraryScope): string {
  return scope.kind === 'folder' ? `folder:${scope.folderId}` : scope.kind
}

export type FavoriteLibraryUiCallbacks = {
  onBatchAction?: (action: FavoriteLibraryBatchAction, aids: number[]) => void
  onManagedFolderAction?: (folderId: string, action: 'edit' | 'delete') => void
  onManagedFolderDeleteChoice?: (folderId: string, choice: 'local' | 'remote') => void
}

function managedRemoteDeletionOutcomeMessage(result: ManagedFavoriteRemoteFolderDeletionResult) {
  const titleByRemoteFolderId = new Map(result.candidates
    .filter((candidate) => candidate.remoteFolderId)
    .map((candidate) => [candidate.remoteFolderId!, candidate.title]))
  const labels = (remoteFolderIds: string[]) => remoteFolderIds
    .map((remoteFolderId) => titleByRemoteFolderId.get(remoteFolderId) ?? `收藏夹 #${remoteFolderId}`)
    .filter((title, index, all) => all.indexOf(title) === index)
  const lines = [] as string[]
  const succeeded = labels(result.succeededRemoteFolderIds)
  if (succeeded.length) lines.push(`已从 B 站删除：${succeeded.join('、')}；对应已确认删除的绑定已更新。`)
  const failed = labels(result.failedRemoteFolderIds)
  if (failed.length) lines.push(`删除失败：${failed.join('、')}。`)
  const unknown = labels(result.unknownRemoteFolderIds)
  if (unknown.length) lines.push(`删除结果未知：${unknown.join('、')}。`)
  const unattempted = labels(result.unattemptedRemoteFolderIds)
  if (unattempted.length) lines.push(`尚未执行：${unattempted.join('、')}。`)
  lines.push('收藏库工作夹、右侧规则和草稿均已保留；请重新打开删除操作后再处理未完成项。')
  return lines.join(' ')
}

type LightweightBackupBindingCandidate = {
  folderId: string
  logicalLedgerId: string
  title: string
  candidates: Array<{ id: string; title: string; memberCount: number; bindingFailureReason?: string }>
}

type LightweightBackupResult = {
  ok?: boolean
  message?: string
  unboundCandidates?: Array<{
    ledgerId: string
    candidates: Array<{ id: string; title: string; memberCount: number; bindingFailureReason?: string }>
  }>
}

function FavoriteLibraryMenuChevron() {
  return <svg className="favorite-library__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function FavoriteLibraryClassificationOwnershipMenu({
  classificationSources,
  sourceFilter,
  onClassificationSourcesChange,
  onSourceFilterChange
}: {
  classificationSources: FavoriteRepositoryClassificationSource[]
  sourceFilter: FavoriteRepositoryLibrarySourceFilter
  onClassificationSourcesChange: (sources: FavoriteRepositoryClassificationSource[]) => void
  onSourceFilterChange: (sourceFilter: FavoriteRepositoryLibrarySourceFilter) => void
}) {
  const [open, setOpen, menuScope] = useExclusiveMenu()
  const [activeGroup, setActiveGroup] = useState<'classification' | 'ownership' | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<{ top: string; left: string }>()
  const close = useCallback(() => { setOpen(false); setActiveGroup(null); triggerRef.current?.focus() }, [])
  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ top: `${rect.bottom + 6}px`, left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 172))}px` })
  }, [])
  useEffect(() => {
    if (!open) return
    reposition()
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close()
    }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keydown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [close, open, reposition])
  const classificationOptions: Array<{ value: FavoriteRepositoryClassificationSource; label: string }> = [
    { value: 'system-high', label: '系统分类（把握高）' },
    { value: 'system-low', label: '系统分类（把握低）' },
    { value: 'deepseek', label: 'DeepSeek 整理' },
    { value: 'manual', label: '手动调整' }
  ]
  const ownershipOptions: Array<{ value: FavoriteRepositoryLibrarySourceFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'with-other', label: '有其它收藏夹' },
    { value: 'bilimi-only', label: '仅 bilimi 工作夹' }
  ]
  const menu = open ? <div {...menuScope} ref={menuRef} role="menu" aria-label="分类与归属筛选" className="favorite-library__column-menu-options favorite-library__column-menu-options--portal favorite-library__state-filter-options favorite-library__classification-ownership-filter-options" style={position}>
    <span className="favorite-library__state-filter-group"><button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={activeGroup === 'classification'} onClick={() => setActiveGroup((current) => current === 'classification' ? null : 'classification')}>分类 <FavoriteLibraryMenuChevron /></button>
      {activeGroup === 'classification' ? <span role="menu" aria-label="分类" className="favorite-library__state-filter-submenu favorite-library__classification-ownership-filter-submenu">{classificationOptions.map((option) => <button key={option.value} type="button" role="menuitemcheckbox" aria-checked={classificationSources.includes(option.value)} onClick={() => onClassificationSourcesChange(classificationSources.includes(option.value) ? classificationSources.filter((value) => value !== option.value) : [...classificationSources, option.value].sort() as FavoriteRepositoryClassificationSource[])}>{option.label}</button>)}</span> : null}
    </span>
    <span className="favorite-library__state-filter-group"><button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={activeGroup === 'ownership'} onClick={() => setActiveGroup((current) => current === 'ownership' ? null : 'ownership')}>当前归属 <FavoriteLibraryMenuChevron /></button>
      {activeGroup === 'ownership' ? <span role="menu" aria-label="当前归属" className="favorite-library__state-filter-submenu favorite-library__classification-ownership-filter-submenu">{ownershipOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={sourceFilter === option.value} onClick={() => { onSourceFilterChange(option.value); close() }}>{option.label}</button>)}</span> : null}
    </span>
  </div> : null
  return <span {...menuScope} ref={rootRef} className="favorite-library__column-menu">
    <button ref={triggerRef} type="button" className="favorite-library__column-menu-trigger" aria-label="分类与归属筛选" aria-expanded={open} onClick={() => setOpen((current) => !current)}><FavoriteLibraryMenuChevron /></button>
    {typeof document === 'undefined' ? null : createPortal(menu, document.body)}
  </span>
}

function formatDetailTimestamp(value?: string) {
  if (!value) return '暂无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  // Repository times are stored as UTC; the desktop UI consistently presents them in China Standard Time.
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

function formatFavoriteLibraryAdjustment(adjustment?: FavoriteRepositoryLastAdjustment) {
  if (!adjustment) return '未记录（旧记录不会以当前归属补写）'
  return ({
    'system-high': '系统分类（把握高）',
    'system-low': '系统分类（把握低）',
    deepseek: 'DeepSeek 整理',
    manual: '手动调整',
    'local-copy': '本地复制',
    'local-move': '本地移动',
    'adopt-remote': '采用 B 站归属',
    'managed-placement-remove': '从工作夹移出',
    'managed-folder-delete': '删除本地工作夹',
    // Legacy persisted command: retain readability without reintroducing a user-facing clear action.
    'clear-organization-records': '历史整理变更'
  } as const)[adjustment.kind]
}

function formatFavoriteLibraryInitialSource(source?: { folders: Array<{ title: string; kind: 'ordinary' | 'bilimi' }> }) {
  if (!source) return '未记录（旧记录不会以当前归属补写）'
  return source.folders.map((folder) => `${folder.title}（${folder.kind === 'ordinary' ? '普通收藏夹' : 'bilimi 工作夹'}）`).join('、')
}

function transcriptionAction(status?: string, pending = false) {
  if (pending || status === '等待转写') return { label: '排队中', disabled: true }
  if (status === '正在转写') return { label: '转写中', disabled: true }
  if (status === '正在取消') return { label: '正在取消…', disabled: true }
  return { label: '转写音频', disabled: false }
}

function latestTranscriptionForRow(
  queue: VideoAudioTranscriptionQueueSnapshot | undefined,
  accountMid: string | undefined,
  aid: number,
  cid?: number
) {
  if (!queue || !accountMid) return undefined
  const matching = queue.items.filter((item) => item.accountMid === accountMid && Number(item.aid) === aid &&
    (cid === undefined || item.cid === cid))
  return matching.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

function transcriptionActionForQueueItem(item: ReturnType<typeof latestTranscriptionForRow>) {
  if (!item) return transcriptionAction()
  if (item.status === 'pending') return transcriptionAction('等待转写')
  if (item.status === 'running') return transcriptionAction(item.cancelRequested ? '正在取消' : '正在转写')
  if (item.status === 'failed' || item.status === 'waiting-restart') return transcriptionAction('转写失败')
  if (item.status === 'completed') return transcriptionAction('转写完成')
  return transcriptionAction()
}

function transcriptionQueueCommand(item: ReturnType<typeof latestTranscriptionForRow>) {
  if (item?.status === 'pending') return 'cancel-waiting'
  if (item?.status === 'running') {
    if (item.cancelRequested) return 'cancel-requested'
    if (item.progress?.step === 'canceling-summary') return 'cancel-summary-requested'
    return item.progress?.step === 'summarizing-deepseek' ? 'cancel-summary' : 'cancel-running'
  }
  if (item?.status === 'failed' || item?.status === 'waiting-restart') return 'retry'
  if (item?.status === 'completed' && item.archiveRegistrationStatus === 'failed') return 'retry-archive-registration'
  return 'enqueue'
}

function transcriptionQueueCommandLabel(
  command: ReturnType<typeof transcriptionQueueCommand>,
  fallback: ReturnType<typeof transcriptionAction>
) {
  if (command === 'cancel-waiting') return '取消转写'
  if (command === 'cancel-summary') return '取消总结'
  if (command === 'cancel-summary-requested') return '正在取消总结…'
  if (command === 'cancel-running') return '取消转写'
  if (command === 'cancel-requested') return '正在取消…'
  if (command === 'retry' || command === 'retry-archive-registration') return '转写音频'
  return fallback.label
}

export type FavoriteLibraryDrawerNotice = {
  id: string
  priority: number
  message: string
  onActivate: () => void
}

export type FavoriteLibraryDrawerStatus = {
  notices: FavoriteLibraryDrawerNotice[]
}

/** Reads account-scoped repository pages; it owns only visible UI selection. */
export function FavoriteLibraryApp({
  embedded = false,
  active = true,
  onAccountChange,
  onDrawerStatusChange,
  uiCallbacks
}: {
  embedded?: boolean
  /** The hidden drawer remains mounted; reopening validates its retained view in the background. */
  active?: boolean
  onAccountChange?: (account: FavoriteLibraryAccount | undefined) => void
  onDrawerStatusChange?: (status: FavoriteLibraryDrawerStatus) => void
  uiCallbacks?: FavoriteLibraryUiCallbacks
}) {
  const [accountMid, setAccountMid] = useState<string>()
  const [accountNickname, setAccountNickname] = useState<string>()
  const [summary, setSummary] = useState<FavoriteRepositorySnapshotSummary>()
  const [libraryLoadState, setLibraryLoadState] = useState<'loading' | 'ready' | 'refreshing' | 'error'>('loading')
  const [scopeId, setScopeId] = useState('all')
  const [pageScopeId, setPageScopeId] = useState('all')
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(50)
  const [page, setPage] = useState<FavoriteRepositoryLibraryPage>()
  const [pageNumber, setPageNumber] = useState(1)
  const pageNumberRef = useRef(1)
  pageNumberRef.current = pageNumber
  const [selected, setSelected] = useState<FavoriteLibraryRow>()
  const [detailSnapshot, setDetailSnapshot] = useState<FavoriteRepositoryLibraryVideoDetail>()
  const [detailLoadFailedAid, setDetailLoadFailedAid] = useState<number>()
  const [detailOpen, setDetailOpen] = useState(true)
  const [error, setError] = useState<string>()
  const selectionStoreRef = useRef<FavoriteLibrarySelectionStore | null>(null)
  if (!selectionStoreRef.current) selectionStoreRef.current = new FavoriteLibrarySelectionStore()
  const selectionStore = selectionStoreRef.current
  const [searchQuery, setSearchQuery] = useState('')
  const [libraryStateFilters, setLibraryStateFilters] = useState<FavoriteLibraryStateFilterSelection>({ sync: 'all', protection: 'all', organization: 'all' })
  const [sourceFilter, setSourceFilter] = useState<FavoriteRepositoryLibrarySourceFilter | 'all'>('all')
  const [rowSort, setRowSort] = useState<FavoriteLibrarySort>('updated-desc')
  const [transcriptionFilters, setTranscriptionFilters] = useState<FavoriteLibraryTranscriptionFilter[]>([])
  const [classificationSources, setClassificationSources] = useState<FavoriteRepositoryClassificationSource[]>([])
  const [batchEligibilityNotice, setBatchEligibilityNotice] = useState<string>()
  const [detailDangerOpen, setDetailDangerOpen] = useState(false)
  const [classificationAdjustments, setClassificationAdjustments] = useState<FavoriteRepositoryClassificationAdjustment[]>()
  const [classificationAdjustmentTotalCount, setClassificationAdjustmentTotalCount] = useState<number>()
  const [classificationAdjustmentCursor, setClassificationAdjustmentCursor] = useState<string>()
  const [classificationAdjustmentsOpen, setClassificationAdjustmentsOpen] = useState(false)
  const [placementPickerOpen, setPlacementPickerOpen, placementPickerScope] = useExclusiveMenu()
  const [placementConflictChoiceOpen, setPlacementConflictChoiceOpen] = useState(false)
  const [placementPickerBatch, setPlacementPickerBatch] = useState(false)
  const [placementPickerMode, setPlacementPickerMode] = useState<'replace' | 'copy' | 'move'>('replace')
  const [placementPickerSelection, setPlacementPickerSelection] = useState<FavoriteLibraryOperationSelection>([])
  const [placementDraftFolderIds, setPlacementDraftFolderIds] = useState<string[]>([])
  const [placementSyncRequested, setPlacementSyncRequested] = useState(false)
  const [placementSaving, setPlacementSaving] = useState(false)
  const [placementPickerPosition, setPlacementPickerPosition] = useState<Record<string, string>>()
  const placementPickerRef = useRef<HTMLDivElement>(null)
  const placementPickerTriggerRef = useRef<HTMLElement | undefined>(undefined)
  const [statusExplanation, setStatusExplanation] = useState<string>()
  const [moreInformationOpen, setMoreInformationOpen] = useState(false)
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const [deleteOtherWorkFolders, setDeleteOtherWorkFolders] = useState(false)
  const [batchDeleteOtherWorkFolders, setBatchDeleteOtherWorkFolders] = useState(false)
  const [removeManagedOtherFolders, setRemoveManagedOtherFolders] = useState(false)
  const [remoteUnfavoriteDialog, setRemoteUnfavoriteDialog] = useState<'choice' | 'missing-target' | 'unverified'>()
  const [batchLocalDeleteConfirmationOpen, setBatchLocalDeleteConfirmationOpen] = useState(false)
  const [batchRemoteDeletionChoice, setBatchRemoteDeletionChoice] = useState<{
    selection: FavoriteLibraryOperationSelection
    requestedAids: number[]
    includeOtherWorkFolders: boolean
  }>()
  const [remoteUnfavoritePreview, setRemoteUnfavoritePreview] = useState<{
    aids: number[]
    executionToken: string
    affectedLogicalFolders: Array<{ id: string; title: string }>
    preservedOrdinarySources: Array<{ id: string; title: string }>
    recycleAids: number[]
    skippedUnmatchedAids: number[]
  }>()
  const [remoteUnfavoritePreparing, setRemoteUnfavoritePreparing] = useState(false)
  const [remoteUnfavoriteExecuting, setRemoteUnfavoriteExecuting] = useState(false)
  const [archivePanelOpen, setArchivePanelOpen] = useState(false)
  const [archiveText, setArchiveText] = useState('')
  const [archiveImportPreview, setArchiveImportPreview] = useState<FavoriteRepositoryArchiveImportPreview>()
  const [archiveRestorePreview, setArchiveRestorePreview] = useState<FavoriteRepositoryArchiveRestorePreview>()
  const [archiveRestoreExecution, setArchiveRestoreExecution] = useState<FavoriteRepositoryRestoreExecutionResult>()
  const [documentExport, setDocumentExport] = useState<{ accountMid: string; selections: Array<{ archiveId: string; versionId: string }>; skippedAids: number[]; initialFormats?: Array<'markdown' | 'word'> }>()
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveRestoreScope, setArchiveRestoreScope] = useState<'all' | 'selected' | 'current-folder'>('all')
  const [managedFolderDeletionDialog, setManagedFolderDeletionDialog] = useState<{
    mode: 'single' | 'batch'
    candidates: ManagedFavoriteFolderDeletionCandidate[]
    ledgerTitleHints: Record<string, string>
    localExecutionTokens: Record<string, string>
  }>()
  const [managedFolderDeletionAcknowledged, setManagedFolderDeletionAcknowledged] = useState(false)
  const [managedFolderDeletionAcknowledgedUnbound, setManagedFolderDeletionAcknowledgedUnbound] = useState(false)
  const [managedFolderDeletionScope, setManagedFolderDeletionScope] = useState<'local-only' | 'bilibili'>('local-only')
  const [managedFolderDeletionSelection, setManagedFolderDeletionSelection] = useState<string[]>([])
  const [managedFolderDeletionExecuting, setManagedFolderDeletionExecuting] = useState(false)
  const [conflictsOpen, setConflictsOpen] = useState(false)
  const [workspaceSyncResult, setWorkspaceSyncResult] = useState<string>()
  const [workspaceSyncSelection, setWorkspaceSyncSelection] = useState<string[]>([])
  const [workspaceSyncConfirmationOpen, setWorkspaceSyncConfirmationOpen] = useState(false)
  const [workspaceSyncExecuting, setWorkspaceSyncExecuting] = useState(false)
  const [workspaceBindingCandidates, setWorkspaceBindingCandidates] = useState<LightweightBackupBindingCandidate[]>()
  const [workspaceBindingSelections, setWorkspaceBindingSelections] = useState<Record<string, string[]>>({})
  const [batchRemoteUnfavoritePreview, setBatchRemoteUnfavoritePreview] = useState<{
    aids: number[]
    executionToken: string
    baselineRevision?: number
    affectedLogicalFolders: Array<{ id: string; title: string }>
    preservedOrdinarySources: Array<{ id: string; title: string }>
    recycleAids: number[]
    skippedUnsyncedAids: number[]
    skippedUnmatchedAids: number[]
  }>()
  const [remoteReconciliations, setRemoteReconciliations] = useState<Array<{
    kind: 'unfavorite' | 'managed-folder' | 'managed-placement'
    operationId: string
  }>>([])
  const [transcriptionQueue, setTranscriptionQueue] = useState<VideoAudioTranscriptionQueueSnapshot>()
  const [transcriptionSuccessNotice, setTranscriptionSuccessNotice] = useState<{ accountMid: string; count: number }>()
  const [listScrollTop, setListScrollTop] = useState(0)
  const viewCacheRef = useRef(createFavoriteLibraryViewCache<FavoriteRepositorySnapshotSummary, FavoriteRepositoryLibraryPage, CachedFavoriteLibraryUi>())
  const requestIdRef = useRef(0)
  const selectionAttemptRef = useRef(0)
  const refreshIdRef = useRef(0)
  const summaryRef = useRef(summary)
  const pageRef = useRef(page)
  const pageScopeIdRef = useRef(pageScopeId)
  summaryRef.current = summary
  pageRef.current = page
  pageScopeIdRef.current = pageScopeId
  const selectedAidRef = useRef<number | undefined>(undefined)
  const transcriptionStatusesRef = useRef<Map<string, string>>(new Map())
  const transcriptionPageSignatureRef = useRef('')
  const accountMidRef = useRef<string | undefined>(undefined)
  accountMidRef.current = accountMid

  useEffect(() => {
    if (!accountMid || !summary || !page || scopeId !== pageScopeId) return
    viewCacheRef.current.setReady(accountMid, summary, page, {
      scopeId: pageScopeId, pageNumber, pageSize, searchQuery, libraryStateFilters, sourceFilter, rowSort, transcriptionFilters, classificationSources, scrollTop: listScrollTop, selected, detailOpen
    })
  }, [accountMid, classificationSources, detailOpen, libraryStateFilters, listScrollTop, page, pageNumber, pageScopeId, pageSize, rowSort, scopeId, searchQuery, selected, sourceFilter, summary, transcriptionFilters])

  useEffect(() => {
    onAccountChange?.(accountMid ? { mid: accountMid, nickname: accountNickname } : undefined)
  }, [accountMid, accountNickname, onAccountChange])

  const scope = useMemo(() => scopeForNavigation(scopeId), [scopeId])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const pageOptions = useMemo(() => {
    const stateFilters = apiStateFilters(libraryStateFilters)
    return {
      query: searchQuery,
      filter: 'all' as const,
      ...(sourceFilter !== 'all' ? { sourceFilter } : {}),
      ...(Object.keys(stateFilters).length ? { stateFilters } : {}),
      sort: rowSort,
      transcriptionFilters,
      ...(classificationSources.length ? { classificationSources } : {})
    }
  }, [classificationSources, libraryStateFilters, rowSort, searchQuery, sourceFilter, transcriptionFilters])
  const pageOptionsRef = useRef(pageOptions)
  pageOptionsRef.current = pageOptions
  const load = useCallback(async (
    mid: string,
    nextScope: LibraryScope,
    requestedPage = pageNumberRef.current,
    limit = pageSize,
    options: { query?: string; filter?: FavoriteLibraryFilter; sourceFilter?: FavoriteRepositoryLibrarySourceFilter; stateFilters?: FavoriteLibraryApiStateFilters; sort?: FavoriteLibrarySort; transcriptionFilters?: FavoriteLibraryTranscriptionFilter[]; classificationSources?: FavoriteRepositoryClassificationSource[] } = {},
    preserveSelection = false
  ) => {
    const requestId = ++requestIdRef.current
    const api = window.bilimiDesktop
    if (!api?.getFavoriteRepositoryLibraryPage) throw new Error(text.unavailable)
    const next = await api.getFavoriteRepositoryLibraryPage(mid, nextScope, {
      limit,
      page: requestedPage,
      ...(options.query?.trim() ? { query: options.query.trim() } : {}),
      ...(options.filter && options.filter !== 'all' ? { filter: options.filter } : {}),
      ...(options.sourceFilter ? { sourceFilter: options.sourceFilter } : {}),
      ...(options.stateFilters && Object.keys(options.stateFilters).length ? { stateFilters: options.stateFilters } : {}),
      ...(options.sort && options.sort !== 'updated-desc' ? { sort: options.sort } : {}),
      ...(options.transcriptionFilters?.length ? { transcriptionFilters: options.transcriptionFilters } : {}),
      ...(options.classificationSources?.length ? { classificationSources: options.classificationSources } : {})
    })
    if (requestId === requestIdRef.current) {
      setPage(next)
      setPageScopeId(navigationForScope(nextScope))
      if (preserveSelection) {
        setSelected((current) => {
          const matching = current && next.items.find((item) => item.video.aid === current.aid)
          return matching ? { ...matching.video, folderIds: [...matching.folderIds], pendingStates: [...matching.pendingStates], libraryStates: matching.libraryStates ? { ...matching.libraryStates } : undefined, ...(matching.organization ? { organization: { ...matching.organization } } : {}) } : undefined
        })
      } else {
        setSelected(undefined)
      }
      return true
    }
    return false
  }, [pageSize])

  const goToPending = useCallback(() => {
    ++selectionAttemptRef.current
    ++refreshIdRef.current
    setScopeId('pending')
    scopeRef.current = { kind: 'pending' }
    setSearchQuery('')
    setLibraryStateFilters({ sync: 'all', protection: 'all', organization: 'all' })
    setTranscriptionFilters([])
    setClassificationSources([])
    setPageNumber(1)
    setListScrollTop(0)
    selectionStore.clear()
    setSelected(undefined)
    setDetailSnapshot(undefined)
    if (accountMid) {
      ++requestIdRef.current
      void window.bilimiDesktop?.getFavoriteRepositoryLibraryPage?.(accountMid, { kind: 'pending' }, {
        limit: pageSize, page: 1, ...(rowSort !== 'updated-desc' ? { sort: rowSort } : {})
      }).then((next) => {
        if (scopeRef.current.kind !== 'pending') return
        setPage(next)
        setPageScopeId('pending')
      }).catch(() => setError(text.cannotRead))
    }
  }, [accountMid, load, pageSize, rowSort])

  const openAssistantWorkspace = useCallback((request: FloatingAssistantWorkspaceRequest) => {
    void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({ ...request, sidebar: true })
  }, [])

  useEffect(() => {
    if (!active || !accountMid) {
      setTranscriptionQueue(undefined)
      setTranscriptionSuccessNotice(undefined)
      transcriptionStatusesRef.current = new Map()
      return
    }
    let disposed = false
    let observedQueueEvent = false
    transcriptionStatusesRef.current = new Map()
    setTranscriptionSuccessNotice((current) => current?.accountMid === accountMid ? current : undefined)
    const signatureFor = (snapshot: VideoAudioTranscriptionQueueSnapshot) => snapshot.items
      .filter((item) => item.accountMid === accountMid)
      .map((item) => `${item.id}:${item.status}:${item.archiveRegistrationStatus ?? ''}`)
      .sort()
      .join('|')
    void window.bilimiDesktop?.loadVideoAudioTranscriptionQueue?.()
      .then((next) => {
        if (disposed || observedQueueEvent) return
        transcriptionStatusesRef.current = new Map(next.items.map((item) => [item.id, item.status]))
        transcriptionPageSignatureRef.current = signatureFor(next)
        setTranscriptionQueue(next)
      })
      .catch(() => { if (!disposed && !observedQueueEvent) setTranscriptionQueue(undefined) })
    const unsubscribe = window.bilimiDesktop?.onVideoAudioTranscriptionQueueChanged?.((next) => {
      if (disposed) return
      observedQueueEvent = true
      const previousStatuses = transcriptionStatusesRef.current
      const newlyCompleted = next.items.filter((item) => item.accountMid === accountMid && item.status === 'completed' && previousStatuses.get(item.id) !== 'completed').length
      transcriptionStatusesRef.current = new Map(next.items.map((item) => [item.id, item.status]))
      const nextSignature = signatureFor(next)
      const pageStateChanged = nextSignature !== transcriptionPageSignatureRef.current
      transcriptionPageSignatureRef.current = nextSignature
      setTranscriptionQueue(next)
      if (newlyCompleted) {
        setTranscriptionSuccessNotice((current) => current?.accountMid === accountMid
          ? { accountMid, count: current.count + newlyCompleted }
          : { accountMid, count: newlyCompleted })
      }
      if (pageStateChanged && pageOptionsRef.current.transcriptionFilters.length) {
        void load(accountMid, scopeRef.current, pageNumberRef.current, pageSize, pageOptionsRef.current, true)
          .catch(() => setError(text.cannotRead))
      }
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [accountMid, active, load, pageSize])

  const transcriptionSuccessCount = transcriptionSuccessNotice?.accountMid === accountMid ? transcriptionSuccessNotice?.count ?? 0 : 0
  useEffect(() => {
    if (!transcriptionSuccessCount || !accountMid) return
    const timer = window.setTimeout(() => {
      setTranscriptionSuccessNotice((current) => current?.accountMid === accountMid ? undefined : current)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [accountMid, transcriptionSuccessCount])

  const drawerNotices = useMemo<FavoriteLibraryDrawerNotice[]>(() => {
    const failedCount = summary?.syncCounts.failed ?? 0
    const confirmationCount = summary?.syncCounts['result-unknown'] ?? 0
    const legacyRemoteReconciliations = remoteReconciliations.filter((item) => item.kind === 'unfavorite')
    const notices: FavoriteLibraryDrawerNotice[] = []
    if (failedCount) {
      notices.push({
        id: 'sync-failed',
        priority: 100,
        message: `${failedCount}个视频同步失败`,
        onActivate: goToPending
      })
    }
    if (confirmationCount) {
      notices.push({
        id: 'sync-confirmation-required',
        priority: 90,
        message: `${confirmationCount}个视频同步待确认`,
        onActivate: goToPending
      })
    }
    if (legacyRemoteReconciliations.length) {
      notices.push({
        id: 'remote-reconciliation-required',
        priority: 80,
        message: `${legacyRemoteReconciliations.length}项远程操作待处理`,
        onActivate: goToPending
      })
    }
    if (summary?.workspace?.status === 'scanning') {
      notices.push({
        id: 'old-favorite-scan-running',
        priority: 70,
        message: '正在扫描已有收藏',
        onActivate: () => openAssistantWorkspace({ tab: 'ledger', organizeOldFavorites: true })
      })
    }
    const accountTranscriptions = transcriptionQueue?.items.filter((item) => item.accountMid === accountMid) ?? []
    const transcriptionFailures = accountTranscriptions.filter((item) => item.status === 'failed').length
    const archiveRegistrationFailures = accountTranscriptions.filter((item) => item.archiveRegistrationStatus === 'failed').length
    const activeTranscriptions = accountTranscriptions.filter((item) => item.status === 'pending' || item.status === 'running').length
    if (transcriptionFailures) {
      notices.push({
        id: 'transcription-failed',
        priority: 95,
        message: `${transcriptionFailures}项转写失败`,
        onActivate: () => openAssistantWorkspace({ tab: 'notes', openNoteArchive: true })
      })
    }
    if (archiveRegistrationFailures) {
      notices.push({
        id: 'archive-registration-failed',
        priority: 94,
        message: `${archiveRegistrationFailures}项档案登记异常`,
        onActivate: () => openAssistantWorkspace({ tab: 'notes', openNoteArchive: true })
      })
    }
    if (activeTranscriptions) {
      notices.push({
        id: 'transcription-queued',
        priority: 60,
        message: `${activeTranscriptions}项转写排队中`,
        onActivate: () => openAssistantWorkspace({ tab: 'notes', openNoteArchive: true })
      })
    }
    if (transcriptionSuccessCount) {
      notices.push({
        id: 'transcription-succeeded',
        priority: 20,
        message: `本次转写成功 ${transcriptionSuccessCount} 项`,
        onActivate: () => openAssistantWorkspace({ tab: 'notes', openNoteArchive: true })
      })
    }
    return notices.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
  }, [accountMid, goToPending, openAssistantWorkspace, remoteReconciliations, summary?.syncCounts.failed, summary?.syncCounts['result-unknown'], summary?.workspace?.status, transcriptionQueue, transcriptionSuccessCount])

  useEffect(() => {
    if (!embedded) return
    onDrawerStatusChange?.({ notices: drawerNotices })
  }, [drawerNotices, embedded, onDrawerStatusChange])

  const refresh = useCallback(async (expectedAccountMid?: string) => {
    const refreshId = ++refreshIdRef.current
    const api = window.bilimiDesktop
    try {
      const extendedApi = api as (typeof api & FavoriteLibraryDesktopExtensions) | undefined
      const account = await extendedApi?.readBilibiliAccount?.()
      const mid = (account?.mid ?? await api?.readBilibiliAccountMid?.())?.trim()
      if (!mid) {
        if (refreshId !== refreshIdRef.current) return
        setAccountMid(undefined)
        setAccountNickname(undefined)
        setSummary(undefined)
        setRemoteReconciliations([])
        setPage(undefined)
        setSelected(undefined)
        selectionStore.clear()
        setLibraryLoadState('error')
        setError(text.signIn)
        return
      }
      if (!api?.openFavoriteRepositoryAccount) throw new Error(text.signIn)
      if (refreshId !== refreshIdRef.current) return
      viewCacheRef.current.beginRefresh(mid)
      const sameAccount = mid === (expectedAccountMid ?? accountMidRef.current)
      const cachedView = !sameAccount ? viewCacheRef.current.read(mid) : undefined
      const cachedUi = cachedView?.uiState
      if (!sameAccount) {
        setAccountMid(mid)
        setAccountNickname(account?.nickname?.trim() || undefined)
        setSummary(cachedView?.summary)
        setRemoteReconciliations([])
        setPage(cachedView?.page)
        setScopeId(cachedUi?.scopeId ?? 'all')
        setPageScopeId(cachedView?.page ? cachedUi?.scopeId ?? 'all' : 'all')
        setPageNumber(cachedUi?.pageNumber ?? 1)
        setPageSize(cachedUi?.pageSize ?? 50)
        setSearchQuery(cachedUi?.searchQuery ?? '')
        setLibraryStateFilters((current) => {
          const next = cachedUi?.libraryStateFilters ?? { sync: 'all' as const, protection: 'all' as const, organization: 'all' as const }
          return current.sync === next.sync && current.protection === next.protection && current.organization === next.organization
            ? current
            : next
        })
        setSourceFilter(cachedUi?.sourceFilter ?? 'all')
        setRowSort(cachedUi?.rowSort ?? 'updated-desc')
        setTranscriptionFilters((current) => {
          const next = cachedUi?.transcriptionFilters ?? []
          return current.length === next.length && current.every((filter, index) => filter === next[index]) ? current : next
        })
        setClassificationSources((current) => {
          const next = cachedUi?.classificationSources ?? []
          return current.length === next.length && current.every((source, index) => source === next[index]) ? current : next
        })
        setListScrollTop(cachedUi?.scrollTop ?? 0)
        setSelected(cachedUi?.selected)
        setDetailOpen(cachedUi?.detailOpen ?? true)
        selectionStore.clear()
      }
      if (mid === expectedAccountMid) setAccountNickname(account?.nickname?.trim() || undefined)
      setLibraryLoadState((sameAccount && summaryRef.current && pageRef.current) || (cachedView?.summary && cachedView.page) ? 'refreshing' : 'loading')
      const nextScope = sameAccount ? scopeRef.current : cachedUi ? scopeForNavigation(cachedUi.scopeId) : { kind: 'all' } as const
      const nextPageNumber = sameAccount ? pageNumberRef.current : cachedUi?.pageNumber ?? 1
      const nextPageSize = sameAccount ? pageSize : cachedUi?.pageSize ?? 50
      const nextOptions: Pick<CachedFavoriteLibraryUi, 'searchQuery' | 'libraryStateFilters' | 'sourceFilter' | 'rowSort' | 'transcriptionFilters' | 'classificationSources'> = sameAccount
        ? { searchQuery, libraryStateFilters, sourceFilter, rowSort, transcriptionFilters, classificationSources }
        : cachedUi
          ? { searchQuery: cachedUi.searchQuery, libraryStateFilters: cachedUi.libraryStateFilters, sourceFilter: cachedUi.sourceFilter ?? 'all', rowSort: cachedUi.rowSort, transcriptionFilters: cachedUi.transcriptionFilters, classificationSources: cachedUi.classificationSources ?? [] }
          : { searchQuery: '', libraryStateFilters: { sync: 'all', protection: 'all', organization: 'all' }, sourceFilter: 'all', rowSort: 'updated-desc', transcriptionFilters: [], classificationSources: [] }
      const pageRequestId = ++requestIdRef.current
      const pageRequest = api.getFavoriteRepositoryLibraryPage?.(mid, nextScope, {
        limit: nextPageSize,
        page: nextPageNumber,
        ...(nextOptions.searchQuery.trim() ? { query: nextOptions.searchQuery.trim() } : {}),
        ...(nextOptions.sourceFilter !== 'all' ? { sourceFilter: nextOptions.sourceFilter } : {}),
        ...(Object.keys(apiStateFilters(nextOptions.libraryStateFilters)).length ? { stateFilters: apiStateFilters(nextOptions.libraryStateFilters) } : {}),
        ...(nextOptions.rowSort !== 'updated-desc' ? { sort: nextOptions.rowSort } : {}),
        ...(nextOptions.transcriptionFilters?.length ? { transcriptionFilters: nextOptions.transcriptionFilters } : {}),
        ...(nextOptions.classificationSources?.length ? { classificationSources: nextOptions.classificationSources } : {})
      })
      if (!pageRequest) throw new Error(text.unavailable)
      const nextSummary = await api.openFavoriteRepositoryAccount(mid)
      if (refreshId !== refreshIdRef.current || nextSummary.accountMid !== mid) return
      setSummary(nextSummary)
      setRemoteReconciliations(nextSummary.remoteReconciliations ?? [])
      const nextPage = await pageRequest
      if (refreshId !== refreshIdRef.current || pageRequestId !== requestIdRef.current || nextPage.accountMid !== mid) return
      if (nextPage.revision !== nextSummary.revision) throw new Error('Favorite library revision changed while loading.')
      setPage(nextPage)
      setPageScopeId(navigationForScope(nextScope))
      setPageNumber(nextPageNumber)
      viewCacheRef.current.setReady(mid, nextSummary, nextPage, cachedUi ?? {
        scopeId: navigationForScope(nextScope), pageNumber: nextPageNumber, pageSize: nextPageSize,
        searchQuery: nextOptions.searchQuery, libraryStateFilters: nextOptions.libraryStateFilters, sourceFilter: nextOptions.sourceFilter, rowSort: nextOptions.rowSort, transcriptionFilters: nextOptions.transcriptionFilters, classificationSources: nextOptions.classificationSources, scrollTop: sameAccount ? listScrollTop : 0,
        selected: sameAccount ? selected : undefined, detailOpen: sameAccount ? detailOpen : true
      })
      if (sameAccount) {
        setSelected((current) => {
          const matching = current && nextPage.items.find((item) => item.video.aid === current.aid)
          return matching ? { ...matching.video, folderIds: [...matching.folderIds], pendingStates: [...matching.pendingStates], libraryStates: matching.libraryStates ? { ...matching.libraryStates } : undefined, ...(matching.organization ? { organization: { ...matching.organization } } : {}) } : undefined
        })
      }
      setError(undefined)
      setLibraryLoadState('ready')
    } catch {
      if (refreshId === refreshIdRef.current) {
        setError(text.cannotRead)
        setLibraryLoadState('error')
      }
    }
  }, [pageOptions, pageSize, sourceFilter])

  useEffect(() => {
    if (!active) return
    void refresh()
    return () => {
      refreshIdRef.current += 1
      requestIdRef.current += 1
    }
  }, [active, refresh])

  useEffect(() => active ? window.bilimiDesktop?.onBilibiliAccountChanged?.(() => {
    setAccountMid(undefined)
    setAccountNickname(undefined)
    setSummary(undefined)
    setPage(undefined)
    setDocumentExport(undefined)
    setLibraryLoadState('loading')
    setSelected(undefined)
    selectionStore.clear()
    setPageNumber(1)
    void refresh(accountMid)
  }) : undefined, [accountMid, active, refresh])

  useEffect(() => active ? window.bilimiDesktop?.onFavoriteRepositoryAccountDataCleared?.((clearedAccountMid) => {
    const normalizedAccountMid = clearedAccountMid.trim()
    if (!normalizedAccountMid) return
    viewCacheRef.current.invalidate(normalizedAccountMid)
    requestIdRef.current += 1
    if (normalizedAccountMid !== accountMid) return
    setDocumentExport(undefined)
    setSummary(undefined)
    setPage(undefined)
    setSelected(undefined)
    selectionStore.clear()
    setLibraryLoadState('loading')
    void refresh(normalizedAccountMid)
  }) : undefined, [accountMid, active, refresh])

  useEffect(() => {
    if (!active || !accountMid) return
    if (window.bilimiDesktop?.onVideoAudioTranscriptionQueueChanged) return
    return window.bilimiDesktop?.onFavoriteLibraryTranscriptionChanged?.(() => {
      if (!pageOptionsRef.current.transcriptionFilters.length) return
      void load(accountMid, scopeRef.current, pageNumberRef.current, pageSize, pageOptionsRef.current, true)
        .catch(() => setError(text.cannotRead))
    })
  }, [accountMid, active, load, pageSize])

  useLayoutEffect(() => {
    if (!active || !accountMid || !window.bilimiDesktop?.subscribeFavoriteRepository) return
    const scheduler = createFrameTaskScheduler({
      requestFrame: window.requestAnimationFrame.bind(window),
      cancelFrame: window.cancelAnimationFrame.bind(window)
    })
    const unsubscribe = window.bilimiDesktop.subscribeFavoriteRepository(
      accountMid,
      scope.kind === 'folder' ? scope.folderId : undefined,
      // Repository revisions can arrive after the signed-in Bilibili account changed.
      (change) => scheduler.schedule(() => {
        if (navigationForScope(scopeRef.current) !== navigationForScope(scope)) return
        if (change?.pageInvalidated === false && window.bilimiDesktop?.getFavoriteRepositorySnapshot) {
          void window.bilimiDesktop.getFavoriteRepositorySnapshot(accountMid).then((nextSummary) => {
            if (accountMidRef.current !== accountMid || nextSummary.revision < change.revision) return
            setSummary((current) => !current || nextSummary.revision >= current.revision ? nextSummary : current)
            setRemoteReconciliations(nextSummary.remoteReconciliations ?? [])
          }).catch(() => setError(text.cannotRead))
          return
        }
        void refresh()
      })
    )
    return () => {
      scheduler.cancel()
      unsubscribe()
    }
  }, [accountMid, active, refresh, scope])

  useEffect(() => {
    selectedAidRef.current = selected?.aid
    let disposed = false
    setDetailSnapshot((current) => current?.video.aid === selected?.aid ? current : undefined)
    setDetailLoadFailedAid(undefined)
    setClassificationAdjustments(undefined)
    setClassificationAdjustmentCursor(undefined)
    setClassificationAdjustmentsOpen(false)
    if (!active || !accountMid || !selected || !window.bilimiDesktop?.getFavoriteRepositoryLibraryVideoDetail) return
    void window.bilimiDesktop.getFavoriteRepositoryLibraryVideoDetail(accountMid, selected.aid)
      .then((snapshot) => { if (!disposed) setDetailSnapshot(snapshot) })
      .catch(() => { if (!disposed) { setDetailLoadFailedAid(selected.aid); setError(text.cannotRead) } })
    return () => { disposed = true }
  }, [accountMid, active, page?.revision, selected?.aid])

  useEffect(() => {
  }, [detailSnapshot?.video.aid, detailSnapshot?.archive.memoPreview])

  useEffect(() => {
    setStatusExplanation(undefined)
    setMoreInformationOpen(false)
    setPlacementPickerOpen(false)
    setPlacementConflictChoiceOpen(false)
    setDeleteConfirmationOpen(false)
    setDeleteOtherWorkFolders(false)
    setRemoteUnfavoritePreview(undefined)
    setDetailDangerOpen(false)
  }, [selected?.aid])

  const folders = summary?.folders ?? []
  const logicalFolders = useMemo(() => folders
    .filter((folder) => folder.kind === 'bilimi-logical')
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id)), [folders])
  const folderTitleById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.title])), [folders])
  const rows = useMemo(() => page ? pageRows(page) : [], [page])
  const activeRow = selected && page?.items.find((item) => item.video.aid === selected.aid)
  const currentScopeTotal = pageScopeId === 'all'
    ? summary?.scopeCounts?.all ?? summary?.videoCount
    : pageScopeId.startsWith('folder:')
      ? summary?.folderCounts?.[pageScopeId.slice('folder:'.length)]
      : summary?.scopeCounts?.[pageScopeId as keyof typeof summary.scopeCounts]
  const displayedTotal = page?.totalCount ?? currentScopeTotal ?? rows.length
  const hasActiveResultFilter = Boolean(searchQuery.trim()) || sourceFilter !== 'all' || Object.keys(apiStateFilters(libraryStateFilters)).length > 0 || transcriptionFilters.length > 0 || classificationSources.length > 0
  const currentScopeLabel = pageScopeId === 'all'
    ? text.all
    : pageScopeId.startsWith('folder:')
      ? folders.find((folder) => folder.id === pageScopeId.slice('folder:'.length))?.title ?? text.results
      : pageScopeId === 'pending' ? text.pending : pageScopeId === 'recycle' ? '回收站' : text.results
  // A summary may return before the initial page; neither is a valid empty-library result alone.
  const workspaceTitle = !page
    ? libraryLoadState === 'error' ? '收藏库无法读取' : '正在读取收藏库'
    : currentScopeLabel
  const workspaceVideoCount = page ? currentScopeTotal ?? displayedTotal : undefined
  const shouldShowFilteredCount = hasActiveResultFilter && displayedTotal !== currentScopeTotal
  const detail = selected && activeRow ? buildFavoriteLibraryDetail(
    detailSnapshot?.video.aid === selected.aid
      ? { ...detailSnapshot.video, folderIds: [...detailSnapshot.folderIds], pendingStates: [...detailSnapshot.pendingStates].filter((state) => state !== 'transcription'), libraryStates: detailSnapshot.libraryStates ? { ...detailSnapshot.libraryStates } : undefined }
      : selected,
    folders,
    { aid: selected.aid, states: [...(detailSnapshot?.pendingStates ?? activeRow.pendingStates)].filter((state) => state !== 'transcription') }
  ) : undefined
  const navigation = useMemo(
    () => summary ? buildFavoriteLibraryNavigation(folders, pendingCount(summary), summary.scopeCounts?.recycle ?? 0) : [],
    [folders, summary]
  )
  const workspaceDestinationOptions = useMemo(() => {
    const options = new Map<string, { id: string; title: string }>()
    for (const item of navigation) {
      if (item.kind !== 'folder') continue
      const isManaged = item.source === 'bilimi-logical'
      const isDraft = item.source === 'local' && Boolean(item.logicalLedgerId)
      const isUnmatchedStaging = item.folderId === 'local:inbox'
      if (!isManaged && !isDraft && !isUnmatchedStaging) continue
      const id = isManaged
        ? item.folderId
        : `bilimi-logical:${item.logicalLedgerId ?? 'inbox'}`
      if (!options.has(id)) options.set(id, { id, title: item.title })
    }
    return [...options.values()]
  }, [navigation])
  const navigationGroups = useMemo<FavoriteLibraryNavigationGroup[]>(() => {
    const items = navigation.map((item) => {
      const label = item.kind === 'all' ? text.all : item.kind === 'pending' ? text.pending : item.title
      const unmatchedClassification = item.kind === 'folder' && item.folderId === 'local:inbox'
      const managed = item.kind === 'folder' && item.source === 'bilimi-logical'
      const localDraft = item.kind === 'folder' && item.source === 'local' && Boolean(item.logicalLedgerId)
      const workspace = item.kind === 'folder' && (managed || localDraft)
      return {
        id: item.id,
        label,
        count: item.kind === 'pending' ? (summary?.scopeCounts?.pending ?? item.count) : item.kind === 'recycle' ? (summary?.scopeCounts?.recycle ?? item.count) : item.kind === 'all' ? (summary?.scopeCounts?.all ?? summary?.videoCount ?? 0) : (summary?.folderCounts?.[item.folderId] ?? 0),
        managed,
        workspace,
        removable: item.kind === 'folder' && item.source === 'bilibili',
        protected: unmatchedClassification
      }
    })
    const workspaceItems = items.filter((item) => item.workspace || item.protected)
    const rangeItems = items.filter((item) => item.id === 'all' || item.id === 'pending' || item.id === 'recycle')
    const otherFavoriteItems = items.filter((item) => item.id.startsWith('folder:') && !item.workspace && !item.protected)
    return [
      { id: 'range', label: '', items: rangeItems },
      { id: 'workspace', label: 'bilimi 工作夹', videoCount: summary?.workspaceVideoCount, items: workspaceItems },
      { id: 'bilibili', label: '其他收藏夹', videoCount: summary?.otherFavoriteVideoCount, items: otherFavoriteItems }
    ]
  }, [navigation, summary?.workspaceVideoCount, summary?.otherFavoriteVideoCount])
  const [collapsedNavigationGroups, setCollapsedNavigationGroups] = useState<Record<string, boolean>>({})
  const collapsedNavigationGroupsByAccountRef = useRef(new Map<string, Record<string, boolean>>())
  const collapsedNavigationSaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    if (!accountMid || !window.bilimiDesktop?.getFavoriteLibraryUiPreferences) return
    let active = true
    const remembered = collapsedNavigationGroupsByAccountRef.current.get(accountMid)
    setCollapsedNavigationGroups(remembered ?? {})
    void window.bilimiDesktop.getFavoriteLibraryUiPreferences(accountMid).then((stored) => {
      if (!active) return
      const next = { ...stored, ...(collapsedNavigationGroupsByAccountRef.current.get(accountMid) ?? {}) }
      collapsedNavigationGroupsByAccountRef.current.set(accountMid, next)
      setCollapsedNavigationGroups(next)
    }).catch(() => undefined)
    return () => { active = false }
  }, [accountMid])
  useEffect(() => () => {
    collapsedNavigationSaveTimersRef.current.forEach((timer) => clearTimeout(timer))
    collapsedNavigationSaveTimersRef.current.clear()
  }, [])
  const renderSelection = selectionStore.getSnapshot()
  const selectedCount = renderSelection.selectAllScope
    ? Math.max(0, displayedTotal - renderSelection.excludedAids.length)
    : renderSelection.selectedAids.length
  const runAction = async (action: () => Promise<unknown>) => {
    try {
      setError(undefined)
      await action()
      if (accountMid) await refresh(accountMid)
    } catch (error) {
      setError(favoriteLibraryActionFailureMessage(error))
    }
  }
  const runDetailAction = async (action: () => Promise<void>, refreshLibrary = false) => {
    try {
      setError(undefined)
      await action()
      if (refreshLibrary && accountMid) {
        await refresh(accountMid)
      } else if (accountMid && selected) {
        const snapshot = await window.bilimiDesktop?.getFavoriteRepositoryLibraryVideoDetail?.(accountMid, selected.aid)
        if (snapshot) setDetailSnapshot(snapshot)
      }
    } catch (error) {
      setError(favoriteLibraryActionFailureMessage(error))
    }
  }
  const applyLibraryStateFilters = (next: FavoriteLibraryStateFilterSelection) => {
    setLibraryStateFilters(next)
    setPageNumber(1)
    setListScrollTop(0)
    selectionStore.clear()
    if (accountMid) void load(accountMid, scope, 1, pageSize, { ...pageOptions, stateFilters: apiStateFilters(next) })
  }
  const setLocalPlacement = async (folderIds: string[], synchronize = false) => {
    if (!accountMid || !selected || !detailSnapshot || !window.bilimiDesktop?.setFavoriteLibraryLocalPlacements) {
      throw new Error(text.unavailable)
    }
    await window.bilimiDesktop.setFavoriteLibraryLocalPlacements(
      accountMid, [{ aid: selected.aid, folderIds }], detailSnapshot.revision, synchronize
    )
  }
  const repositionPlacementPicker = useCallback(() => {
    const trigger = placementPickerTriggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setPlacementPickerPosition({ top: `${rect.bottom + 4}px`, left: `${rect.left}px` })
  }, [])
  useEffect(() => {
    if (!placementPickerOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!placementPickerTriggerRef.current?.contains(event.target as Node) && !placementPickerRef.current?.contains(event.target as Node)) setPlacementPickerOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !placementSaving) setPlacementPickerOpen(false) }
    repositionPlacementPicker()
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', repositionPlacementPicker)
    window.addEventListener('scroll', repositionPlacementPicker, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', repositionPlacementPicker)
      window.removeEventListener('scroll', repositionPlacementPicker, true)
    }
  }, [placementPickerOpen, placementSaving, repositionPlacementPicker])
  const openPlacementPicker = (trigger?: HTMLElement) => {
    placementPickerTriggerRef.current = trigger
    setPlacementDraftFolderIds([...(detailSnapshot?.position?.localDesiredFolderIds ?? [])])
    setPlacementPickerBatch(false)
    setPlacementPickerMode('replace')
    setPlacementPickerSelection(selected ? [selected.aid] : [])
    setPlacementSyncRequested(false)
    setPlacementPickerOpen(true)
  }
  const openSelectedPlacementPicker = (mode: 'replace' | 'copy' | 'move' = 'replace', selection?: FavoriteLibraryOperationSelection, trigger?: HTMLElement) => {
    const resolvedSelection = selection ?? selectionStore.getSnapshot().selectedAids
    placementPickerTriggerRef.current = trigger
    setPlacementDraftFolderIds([])
    setPlacementPickerBatch(true)
    setPlacementPickerMode(mode)
    setPlacementPickerSelection(Array.isArray(resolvedSelection) ? [...resolvedSelection] : resolvedSelection)
    setPlacementSyncRequested(false)
    setPlacementPickerOpen(true)
  }
  const togglePlacementFolder = (folderId: string) => setPlacementDraftFolderIds((current) => current.includes(folderId)
    ? current.filter((candidate) => candidate !== folderId)
    : [...current, folderId].sort())
  const savePlacement = async () => {
    setPlacementSaving(true)
    try {
      if (placementPickerBatch) {
        await runAction(async () => {
          const api = window.bilimiDesktop
          if (!accountMid || !summary || (Array.isArray(placementPickerSelection) && !placementPickerSelection.length)) {
            throw new Error(text.unavailable)
          }
          if (placementPickerMode === 'copy') {
            if (!api?.copyFavoriteLibrarySelection) throw new Error(text.unavailable)
            return api.copyFavoriteLibrarySelection(accountMid, placementPickerSelection, placementDraftFolderIds, summary.revision, operationSource(Array.isArray(placementPickerSelection) ? placementPickerSelection : []))
          }
          if (placementPickerMode === 'move') {
            const sourceFolderId = currentLogicalFolderId ?? (resolvedOperationSource.sourceScopeKind === 'unmatched' ? 'local:inbox' : undefined)
            if (!sourceFolderId || !api?.moveFavoriteLibrarySelection) throw new Error(text.unavailable)
            return api.moveFavoriteLibrarySelection(accountMid, placementPickerSelection, sourceFolderId, placementDraftFolderIds, summary.revision, operationSource(Array.isArray(placementPickerSelection) ? placementPickerSelection : []))
          }
          if (!api?.setFavoriteLibraryLocalPlacements) throw new Error(text.unavailable)
          return api.setFavoriteLibraryLocalPlacements(
            accountMid,
            (Array.isArray(placementPickerSelection) ? placementPickerSelection : []).map((aid) => ({ aid, folderIds: [...placementDraftFolderIds] })),
            summary.revision,
            placementSyncRequested
          )
        })
      } else {
        await runDetailAction(() => setLocalPlacement(placementDraftFolderIds, placementSyncRequested))
      }
      setPlacementPickerOpen(false)
    } finally {
      setPlacementSaving(false)
    }
  }
  const adoptRemotePlacement = async () => {
    if (!accountMid || !selected || !detailSnapshot || !window.bilimiDesktop?.adoptFavoriteLibraryRemotePlacement) {
      throw new Error(text.unavailable)
    }
    await window.bilimiDesktop.adoptFavoriteLibraryRemotePlacement(accountMid, selected.aid, detailSnapshot.revision)
  }
  const openArchiveDetail = async () => {
    if (!accountMid || !detailSnapshot || !window.bilimiDesktop?.resolveFavoriteLibraryArchive || !window.bilimiDesktop.openFloatingAssistantWorkspace) {
      throw new Error(text.unavailable)
    }
    // Main resolves the private archive identity; the host currently opens its archive view safely without renderer IDs.
    await window.bilimiDesktop.resolveFavoriteLibraryArchive(accountMid, detailSnapshot.video.aid, detailSnapshot.video.cid)
    await window.bilimiDesktop.openFloatingAssistantWorkspace({ tab: 'notes', openNoteArchive: true })
  }
  const openRowArchiveDetail = async (row: FavoriteLibraryRow, cid?: number | string) => {
    const api = window.bilimiDesktop
    if (!accountMid || !api?.resolveFavoriteLibraryArchive || !api.openFloatingAssistantWorkspace) {
      throw new Error(text.unavailable)
    }
    const normalizedCid = cid === undefined ? undefined : Number(cid)
    await api.resolveFavoriteLibraryArchive(accountMid, row.aid, Number.isFinite(normalizedCid) ? normalizedCid : undefined)
    await api.openFloatingAssistantWorkspace({ tab: 'notes', openNoteArchive: true })
  }
  const refreshMetadata = async () => {
    if (!accountMid || !selected || !window.bilimiDesktop?.syncFavoriteLibrarySelection) throw new Error(text.unavailable)
    await window.bilimiDesktop.syncFavoriteLibrarySelection(accountMid, { kind: 'aids', aids: [selected.aid] })
  }
  const deleteFromLibrary = async () => {
    if (!accountMid || !selected || !detailSnapshot) throw new Error(text.unavailable)
    if (!window.bilimiDesktop?.deleteFavoriteLibrarySelection) throw new Error(text.unavailable)
    const otherBilimiFolderIds = (detailSnapshot.position?.localDesiredFolderIds ?? [])
      .filter((folderId) => folderId !== currentLogicalFolderId && folderId.startsWith('bilimi-logical:'))
    const selectedBilimiFolderIds = currentLogicalFolderId
      ? [...new Set([currentLogicalFolderId, ...otherBilimiFolderIds])].sort()
      : []
    const result = await window.bilimiDesktop.deleteFavoriteLibrarySelection(
      accountMid, [selected.aid], detailSnapshot.revision, currentLogicalFolderId
        ? {
            kind: 'folder',
            folderId: currentLogicalFolderId,
            ...(deleteOtherWorkFolders ? { folderIds: selectedBilimiFolderIds } : {})
          }
        : bilimiMembershipSource([selected.aid], deleteOtherWorkFolders ? 'all' : 'primary')
    )
    if (result.status !== 'succeeded') throw new Error(result.reason ?? 'Favorite local deletion was not completed.')
    if (result.skippedAids?.length) setError(`未找到 bilimi 收藏夹归属，已跳过 ${result.skippedAids.length} 个视频。`)
    setDeleteConfirmationOpen(false)
    setDeleteOtherWorkFolders(false)
  }
  const loadClassificationAdjustments = async () => {
    if (!accountMid || !selected || !window.bilimiDesktop?.getFavoriteRepositoryClassificationAdjustments) throw new Error(text.unavailable)
    const selectedAid = selected.aid
    try {
      setError(undefined)
      const next = await window.bilimiDesktop.getFavoriteRepositoryClassificationAdjustments(accountMid, selectedAid, { limit: 20 })
      if (selectedAid !== selectedAidRef.current) return
      setClassificationAdjustments(next.items)
      setClassificationAdjustmentTotalCount(next.totalCount ?? next.items.length)
      setClassificationAdjustmentCursor(next.nextCursor)
      setClassificationAdjustmentsOpen(true)
    } catch (error) {
      setError(favoriteLibraryActionFailureMessage(error))
    }
  }
  const loadMoreClassificationAdjustments = async () => {
    if (!accountMid || !selected || !classificationAdjustmentCursor || !window.bilimiDesktop?.getFavoriteRepositoryClassificationAdjustments) return
    const selectedAid = selected.aid
    try {
      const next = await window.bilimiDesktop.getFavoriteRepositoryClassificationAdjustments(accountMid, selectedAid, { limit: 20, cursor: classificationAdjustmentCursor })
      if (selectedAid !== selectedAidRef.current) return
      setClassificationAdjustments((current) => [...(current ?? []), ...next.items.filter((item) => !current?.some((existing) => existing.id === item.id))])
      setClassificationAdjustmentTotalCount(next.totalCount ?? classificationAdjustmentTotalCount)
      setClassificationAdjustmentCursor(next.nextCursor)
    } catch (error) {
      setError(favoriteLibraryActionFailureMessage(error))
    }
  }
  const toggleClassificationAdjustments = () => {
    if (classificationAdjustmentsOpen) {
      setClassificationAdjustmentsOpen(false)
      return
    }
    if (classificationAdjustments) {
      setClassificationAdjustmentsOpen(true)
      return
    }
    void loadClassificationAdjustments()
  }
  const restoreRecycledVideo = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !selected || !summary || !api?.restoreFavoriteLibraryVideo) throw new Error(text.unavailable)
    await api.restoreFavoriteLibraryVideo(accountMid, selected.aid, summary.revision)
  }
  const clearRecycledVideo = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !selected || !summary || !api?.clearRecycledFavoriteLibraryVideo) throw new Error(text.unavailable)
    await api.clearRecycledFavoriteLibraryVideo(accountMid, selected.aid, summary.revision)
  }
  const deleteSelectedFromLibrary = async () => {
    const api = window.bilimiDesktop
    const selectionSnapshot = selectionStore.getSnapshot()
    const selection = operationSelection(selectionSnapshot)
    if (!accountMid || !summary || (Array.isArray(selection) && !selection.length) || !api?.deleteFavoriteLibrarySelection) throw new Error(text.unavailable)
    const selectedBilimiFolderIds = batchDeleteOtherWorkFolders
      ? folders.filter((folder) => folder.kind === 'bilimi-logical').map((folder) => folder.id).sort()
      : undefined
    const source = currentLogicalFolderId
      ? operationSource(Array.isArray(selection) ? selection : [], selectionActionEligibility(selectionSnapshot, 'delete-local'))
      : bilimiMembershipSource(Array.isArray(selection) ? selection : [], batchDeleteOtherWorkFolders ? 'all' : 'primary')
    const result = await api.deleteFavoriteLibrarySelection(accountMid, selection, summary.revision, source.kind === 'folder' && selectedBilimiFolderIds?.length
      ? { ...source, folderIds: selectedBilimiFolderIds }
      : source)
    if (result.status !== 'succeeded') throw new Error(result.reason ?? 'Favorite local deletion was not completed.')
    setBatchEligibilityNotice(result.skippedAids?.length
      ? `未找到 bilimi 收藏夹归属，已跳过 ${result.skippedAids.length} 个视频。`
      : undefined)
    selectionStore.clear()
    setBatchDeleteOtherWorkFolders(false)
    setBatchLocalDeleteConfirmationOpen(false)
  }
  const remoteUnfavoriteTarget = () => {
    const desiredFolderIds = (detailSnapshot?.position?.localDesiredFolderIds ?? []).filter((folderId) => folderId.startsWith('bilimi-logical:'))
    const remoteObservedLogicalFolderIds = detailSnapshot?.position?.remoteObservedLogicalFolderIds ?? []
    const remoteObservedPhysicalFolderIds = detailSnapshot?.position?.remoteObservedPhysicalFolderIds ?? []
    const knownLogicalFolderIds = desiredFolderIds.length ? desiredFolderIds : remoteObservedLogicalFolderIds
    const logicalFolderIds = currentLogicalFolderId && !removeManagedOtherFolders
      ? knownLogicalFolderIds.filter((folderId) => folderId === currentLogicalFolderId)
      : currentLogicalFolderId
        ? knownLogicalFolderIds
        : []
    const remotePlacementObserved = currentLogicalFolderId && !removeManagedOtherFolders
      ? remoteObservedLogicalFolderIds.includes(currentLogicalFolderId) || (desiredFolderIds.includes(currentLogicalFolderId) && remoteObservedPhysicalFolderIds.length > 0)
      : remoteObservedLogicalFolderIds.length > 0 || (desiredFolderIds.length > 0 && remoteObservedPhysicalFolderIds.length > 0)
    return { logicalFolderIds, remotePlacementObserved }
  }
  const closeRemoteUnfavoriteDialog = () => {
    if (remoteUnfavoritePreparing || remoteUnfavoriteExecuting) return
    setRemoteUnfavoriteDialog(undefined)
    setRemoteUnfavoritePreview(undefined)
    setRemoveManagedOtherFolders(false)
  }
  const openRemoteUnfavoriteDialog = () => {
    setRemoteUnfavoritePreview(undefined)
    setRemoveManagedOtherFolders(false)
    const { remotePlacementObserved } = remoteUnfavoriteTarget()
    setRemoteUnfavoriteDialog(remotePlacementObserved ? 'choice' : 'missing-target')
  }
  const beginRemoteUnfavorite = async () => {
    const api = window.bilimiDesktop
    const { logicalFolderIds, remotePlacementObserved } = remoteUnfavoriteTarget()
    if (!remotePlacementObserved) {
      setRemoteUnfavoriteDialog('missing-target')
      return
    }
    if (!accountMid || !selected || !summary || (currentLogicalFolderId && !logicalFolderIds.length) || !api?.previewFavoriteLibraryManagedPlacementRemoval) {
      setRemoteUnfavoriteDialog('unverified')
      return
    }
    setRemoteUnfavoritePreparing(true)
    try {
      const preview = await api.previewFavoriteLibraryManagedPlacementRemoval(accountMid, [selected.aid], logicalFolderIds, summary.revision, currentLogicalFolderId
        ? operationSource([selected.aid])
        : bilimiMembershipSource([selected.aid], removeManagedOtherFolders ? 'all' : 'primary')) as {
        aids?: number[]
        executionToken?: string
        affectedLogicalFolders?: Array<{ id: string; title: string }>
        preservedOrdinarySources?: Array<{ id: string; title: string }>
        recycleAids?: number[]
        skippedUnmatchedAids?: number[]
      }
      if (!preview.executionToken) throw new Error(text.unavailable)
      setRemoteUnfavoritePreview({
        aids: preview.aids?.length ? preview.aids : [selected.aid],
        executionToken: preview.executionToken,
        affectedLogicalFolders: preview.affectedLogicalFolders ?? [],
        preservedOrdinarySources: preview.preservedOrdinarySources ?? [],
        recycleAids: preview.recycleAids ?? [],
        skippedUnmatchedAids: preview.skippedUnmatchedAids ?? []
      })
      setRemoteUnfavoriteDialog(undefined)
    } catch (error) {
      setRemoteUnfavoriteDialog(isMissingRemoteUnfavoriteTarget(error) ? 'missing-target' : 'unverified')
    } finally {
      setRemoteUnfavoritePreparing(false)
    }
  }
  const confirmRemoteUnfavorite = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !remoteUnfavoritePreview || !api?.confirmFavoriteLibraryManagedPlacementRemoval || !api?.executeFavoriteLibraryManagedPlacementRemoval) {
      throw new Error(text.unavailable)
    }
    setRemoteUnfavoriteExecuting(true)
    try {
      const confirmation = await api.confirmFavoriteLibraryManagedPlacementRemoval(accountMid, remoteUnfavoritePreview.executionToken)
      const result = await api.executeFavoriteLibraryManagedPlacementRemoval(
        accountMid, remoteUnfavoritePreview.executionToken, confirmation.confirmationToken
      ) as { status?: string; operationId?: string; reason?: string }
      setRemoteUnfavoritePreview(undefined)
      setRemoveManagedOtherFolders(false)
      if (result.status === 'succeeded') {
        await refresh(accountMid)
      } else {
        setError('从 B 站 bilimi 收藏夹删除未成功，请稍后重试。')
      }
    } finally {
      setRemoteUnfavoriteExecuting(false)
    }
  }
  const confirmBatchRemoteUnfavorite = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !batchRemoteUnfavoritePreview || !api?.confirmFavoriteLibraryManagedPlacementRemoval || !api?.executeFavoriteLibraryManagedPlacementRemoval) {
      throw new Error(text.unavailable)
    }
    const confirmation = await api.confirmFavoriteLibraryManagedPlacementRemoval(accountMid, batchRemoteUnfavoritePreview.executionToken)
    const result = await api.executeFavoriteLibraryManagedPlacementRemoval(
      accountMid, batchRemoteUnfavoritePreview.executionToken, confirmation.confirmationToken
    ) as { status?: string; operationId?: string }
    setBatchRemoteUnfavoritePreview(undefined)
    if (result.status === 'succeeded') {
      await refresh(accountMid)
      return
    }
    setError('从 B 站 bilimi 收藏夹删除未成功，请稍后重试。')
  }
  const previewBatchRemoteUnfavorite = async (selection: FavoriteLibraryOperationSelection, requestedAids: number[], logicalFolderIds: string[], includeOtherWorkFolders: boolean) => {
    const api = window.bilimiDesktop
    if (!accountMid || !summary || !api?.previewFavoriteLibraryManagedPlacementRemoval) throw new Error(text.unavailable)
    const preview = await api.previewFavoriteLibraryManagedPlacementRemoval(accountMid, selection, logicalFolderIds, summary.revision, currentLogicalFolderId
      ? operationSource(requestedAids)
      : bilimiMembershipSource(requestedAids, includeOtherWorkFolders ? 'all' : 'primary')) as {
      executionToken?: string
      aids?: number[]
      baselineRevision?: number
      affectedLogicalFolders?: Array<{ id: string; title: string }>
      preservedOrdinarySources?: Array<{ id: string; title: string }>
      recycleAids?: number[]
      skippedUnsyncedAids?: number[]
      skippedUnmatchedAids?: number[]
    } | undefined
    if (!preview?.executionToken) throw new Error(text.unavailable)
    const skippedUnsyncedAids = preview.skippedUnsyncedAids ?? []
    const skippedUnmatchedAids = preview.skippedUnmatchedAids ?? []
    setBatchEligibilityNotice([
      ...(skippedUnsyncedAids.length ? [`收藏未同步：跳过 ${skippedUnsyncedAids.length} 个视频。`] : []),
      ...(skippedUnmatchedAids.length ? [`未找到 bilimi 收藏夹归属，已跳过 ${skippedUnmatchedAids.length} 个视频。`] : [])
    ].join(' ') || undefined)
    setBatchRemoteUnfavoritePreview({
      aids: preview.aids?.length ? preview.aids : Array.isArray(selection) ? [...selection] : [],
      executionToken: preview.executionToken,
      baselineRevision: preview.baselineRevision,
      affectedLogicalFolders: preview.affectedLogicalFolders ?? [],
      preservedOrdinarySources: preview.preservedOrdinarySources ?? [],
      recycleAids: preview.recycleAids ?? [],
      skippedUnsyncedAids,
      skippedUnmatchedAids
    })
  }
  const reconcileRemoteOperation = async (remoteReconciliation: { kind: 'unfavorite' | 'managed-folder' | 'managed-placement'; operationId: string }) => {
    const api = window.bilimiDesktop
    if (!accountMid || !remoteReconciliation) throw new Error(text.unavailable)
    if (remoteReconciliation.kind === 'unfavorite') {
      await api?.reconcileFavoriteLibraryRemoteUnfavoriteOperation?.(accountMid, remoteReconciliation.operationId)
    } else if (remoteReconciliation.kind === 'managed-folder') {
      await api?.reconcileFavoriteLibraryManagedFolderDelete?.(accountMid, remoteReconciliation.operationId)
    } else {
      await api?.reconcileFavoriteLibraryManagedPlacementRemoval?.(accountMid, remoteReconciliation.operationId)
    }
    await refresh(accountMid)
  }
  const openManagedFolderDeletion = async (ledgerIds: string[], mode: 'single' | 'batch' = 'batch') => {
    const api = window.bilimiDesktop
    const uniqueLedgerIds = [...new Set(ledgerIds.map((id) => id.trim()).filter(Boolean))]
    if (!accountMid || !uniqueLedgerIds.length || !api?.previewManagedFavoriteFolderDeletion) throw new Error(text.unavailable)
    const ledgerTitleHints = Object.fromEntries(uniqueLedgerIds.map((logicalLedgerId) => {
      const folder = folders.find((candidate) => candidate.kind === 'bilimi-logical' && candidate.logicalLedgerId === logicalLedgerId)
      return [logicalLedgerId, folder?.title ?? logicalLedgerId]
    }))
    const candidates = await api.previewManagedFavoriteFolderDeletion(accountMid, uniqueLedgerIds, ledgerTitleHints)
    if (!Array.isArray(candidates) || !candidates.length) throw new Error(text.unavailable)
    const localExecutionTokens: Record<string, string> = {}
    if (api.previewFavoriteLibraryManagedFolderDelete) {
      for (const logicalLedgerId of uniqueLedgerIds) {
        const folder = folders.find((candidate) => candidate.kind === 'bilimi-logical' && candidate.logicalLedgerId === logicalLedgerId)
        if (!folder) continue
        const localPreview = await api.previewFavoriteLibraryManagedFolderDelete(accountMid, folder.id) as { executionToken?: string }
        if (localPreview?.executionToken) localExecutionTokens[logicalLedgerId] = localPreview.executionToken
      }
    }
    setManagedFolderDeletionAcknowledged(false)
    setManagedFolderDeletionAcknowledgedUnbound(false)
    setManagedFolderDeletionScope('local-only')
    setManagedFolderDeletionSelection(mode === 'single' ? uniqueLedgerIds : [])
    setManagedFolderDeletionDialog({ mode, candidates, ledgerTitleHints, localExecutionTokens })
  }
  const openLocalInboxDeletion = async (folder: FavoriteRepositoryFolder) => {
    const api = window.bilimiDesktop
    if (!accountMid || folder.id !== 'local:inbox' || !api?.previewFavoriteLibraryManagedFolderDelete) throw new Error(text.unavailable)
    const preview = await api.previewFavoriteLibraryManagedFolderDelete(accountMid, folder.id) as { executionToken?: string }
    if (!preview?.executionToken) throw new Error(text.unavailable)
    setManagedFolderDeletionAcknowledged(false)
    setManagedFolderDeletionAcknowledgedUnbound(false)
    setManagedFolderDeletionScope('local-only')
    setManagedFolderDeletionSelection(['inbox'])
    setManagedFolderDeletionDialog({
      mode: 'single',
      candidates: [{
        logicalLedgerId: 'inbox', title: folder.title,
        memberCount: summary?.folderCounts?.[folder.id] ?? 0,
        state: 'local-only', requiresUnboundAcknowledgement: false
      }],
      ledgerTitleHints: { inbox: folder.title },
      localExecutionTokens: { inbox: preview.executionToken }
    })
  }
  const confirmWorkspaceSync = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !api?.ensureFavoriteLedger || !workspaceSyncSelection.length) throw new Error(text.unavailable)
    setWorkspaceSyncExecuting(true)
    try {
      let succeeded = 0
      let failed = 0
      const bindingCandidates: LightweightBackupBindingCandidate[] = []
      for (const folder of folders.filter((folder) => folder.kind === 'bilimi-logical' && workspaceSyncSelection.includes(folder.id))) {
        try {
          const result = await api.ensureFavoriteLedger(folder.id, { lightweightBackup: true }) as LightweightBackupResult
          const unbound = result.unboundCandidates?.find((entry) => entry.ledgerId === folder.logicalLedgerId)
          if (unbound?.candidates.length && folder.logicalLedgerId) {
            bindingCandidates.push({
              folderId: folder.id,
              logicalLedgerId: folder.logicalLedgerId,
              title: folder.title,
              candidates: unbound.candidates
            })
          } else if (result.ok === false) failed++
          else succeeded++
        } catch {
          failed++
        }
      }
      if (bindingCandidates.length) {
        setWorkspaceBindingCandidates(bindingCandidates)
        setWorkspaceBindingSelections(Object.fromEntries(bindingCandidates.map((entry) => [
          entry.logicalLedgerId,
          entry.candidates.map((candidate) => candidate.id)
        ])))
      }
      setWorkspaceSyncResult(bindingCandidates.length
        ? `备册完成 ${succeeded} 个，失败 ${failed} 个；另有 ${bindingCandidates.length} 个工作夹需要确认绑定。`
        : `备册完成 ${succeeded} 个，失败 ${failed} 个`)
      setWorkspaceSyncConfirmationOpen(false)
      await refresh(accountMid)
    } finally {
      setWorkspaceSyncExecuting(false)
    }
  }
  const confirmWorkspaceBindings = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !api?.ensureFavoriteLedger || !workspaceBindingCandidates?.length) throw new Error(text.unavailable)
    if (workspaceBindingCandidates.some((entry) => !(workspaceBindingSelections[entry.logicalLedgerId] ?? []).length)) return
    setWorkspaceSyncExecuting(true)
    try {
      let succeeded = 0
      let failed = 0
      for (const entry of workspaceBindingCandidates) {
        const selectedIds = workspaceBindingSelections[entry.logicalLedgerId] ?? []
        try {
          const result = await api.ensureFavoriteLedger(entry.folderId, {
            lightweightBackup: true,
            rebindRemoteFolderIds: { [entry.logicalLedgerId]: selectedIds[0]! },
            rebindRemoteFolders: {
              [entry.logicalLedgerId]: entry.candidates
                .filter((candidate) => selectedIds.includes(candidate.id))
                .map(({ id, title, memberCount }) => ({ id, title, memberCount }))
            }
          }) as LightweightBackupResult
          if (result.ok === false) failed++
          else succeeded++
        } catch {
          failed++
        }
      }
      setWorkspaceSyncResult(`确认绑定完成 ${succeeded} 个，失败 ${failed} 个`)
      if (!failed) {
        setWorkspaceBindingCandidates(undefined)
        setWorkspaceBindingSelections({})
      }
      await refresh(accountMid)
    } finally {
      setWorkspaceSyncExecuting(false)
    }
  }
  const backupCurrentWorkspaceFolder = async (folderId: string, logicalLedgerId: string, title: string) => {
    const api = window.bilimiDesktop
    if (!accountMid || !api?.ensureFavoriteLedger) throw new Error(text.unavailable)
    const result = await api.ensureFavoriteLedger(folderId, { lightweightBackup: true }) as LightweightBackupResult
    const unbound = result.unboundCandidates?.find((entry) => entry.ledgerId === logicalLedgerId)
    if (unbound?.candidates.length) {
      setWorkspaceBindingCandidates([{ folderId, logicalLedgerId, title, candidates: unbound.candidates }])
      setWorkspaceBindingSelections({ [logicalLedgerId]: unbound.candidates.map((candidate) => candidate.id) })
      setWorkspaceSyncResult('发现未绑定的 B 站收藏夹，请确认后绑定。')
      return
    }
    if (result.ok === false) throw new Error(result.message || text.unavailable)
    setWorkspaceSyncResult('备册完成 1 个，失败 0 个')
  }
  const confirmManagedFolderDeletion = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !managedFolderDeletionDialog || !managedFolderDeletionAcknowledged) {
      throw new Error(text.unavailable)
    }
    const selectedCandidates = managedFolderDeletionDialog.mode === 'single'
      ? managedFolderDeletionDialog.candidates
      : managedFolderDeletionDialog.candidates.filter((candidate) => managedFolderDeletionSelection.includes(candidate.logicalLedgerId))
    if (!selectedCandidates.length) throw new Error(text.unavailable)
    const requiresUnboundAcknowledgement = selectedCandidates.some((candidate) => candidate.requiresUnboundAcknowledgement)
    if (managedFolderDeletionScope === 'bilibili' && requiresUnboundAcknowledgement && !managedFolderDeletionAcknowledgedUnbound) throw new Error(text.unavailable)
    setManagedFolderDeletionExecuting(true)
    try {
      const logicalLedgerIds = [...new Set(selectedCandidates.map((candidate) => candidate.logicalLedgerId))]
      if (managedFolderDeletionScope === 'local-only') {
        const executionTokens = logicalLedgerIds.map((id) => managedFolderDeletionDialog.localExecutionTokens[id]).filter(Boolean).sort()
        if (!api?.deleteFavoriteLibraryManagedFoldersLocal || executionTokens.length !== logicalLedgerIds.length) throw new Error(text.unavailable)
        await api.deleteFavoriteLibraryManagedFoldersLocal(accountMid, executionTokens)
        setManagedFolderDeletionDialog(undefined)
        await refresh(accountMid)
        return
      }
      if (!api?.deleteManagedFavoriteFolders) throw new Error(text.unavailable)
      const expectedRemoteFolderIds = Object.fromEntries(logicalLedgerIds.map((logicalLedgerId) => [
        logicalLedgerId,
        [...new Set(managedFolderDeletionDialog.candidates
          .filter((candidate) => selectedCandidates.includes(candidate) && candidate.logicalLedgerId === logicalLedgerId && candidate.remoteFolderId)
          .map((candidate) => candidate.remoteFolderId!))]
      ]))
      const result = await api.deleteManagedFavoriteFolders(
        accountMid,
        logicalLedgerIds,
        managedFolderDeletionAcknowledgedUnbound,
        Object.fromEntries(logicalLedgerIds.map((logicalLedgerId) => [logicalLedgerId, managedFolderDeletionDialog.ledgerTitleHints[logicalLedgerId] ?? logicalLedgerId])),
        expectedRemoteFolderIds
      )
      if (result.status !== 'succeeded') {
        setManagedFolderDeletionDialog(undefined)
        setError(managedRemoteDeletionOutcomeMessage(result))
        return
      }
      if (scope.kind === 'folder' && selectedCandidates.some((candidate) => candidate.logicalLedgerId === currentFolder?.logicalLedgerId)) {
        setScopeId('all')
      }
      setManagedFolderDeletionDialog(undefined)
      await refresh(accountMid)
    } finally {
      setManagedFolderDeletionExecuting(false)
    }
  }
  const exportFavoriteArchive = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !api?.exportFavoriteRepositoryArchive) throw new Error(text.unavailable)
    setArchiveBusy(true)
    try {
      const archive = await api.exportFavoriteRepositoryArchive(accountMid)
      setArchiveText(JSON.stringify(archive, null, 2))
      setArchiveImportPreview(undefined)
      setArchiveRestorePreview(undefined)
      setArchiveRestoreExecution(undefined)
    } finally {
      setArchiveBusy(false)
    }
  }
  const previewFavoriteArchiveImport = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !archiveText.trim() || !api?.previewFavoriteRepositoryArchiveImport) throw new Error(text.unavailable)
    setArchiveBusy(true)
    try {
      setArchiveImportPreview(await api.previewFavoriteRepositoryArchiveImport(accountMid, archiveText) as FavoriteRepositoryArchiveImportPreview)
      setArchiveRestorePreview(undefined)
      setArchiveRestoreExecution(undefined)
    } finally {
      setArchiveBusy(false)
    }
  }
  const applyFavoriteArchiveImport = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !archiveImportPreview?.canApply || !api?.applyFavoriteRepositoryArchiveImport) throw new Error(text.unavailable)
    setArchiveBusy(true)
    try {
      await api.applyFavoriteRepositoryArchiveImport(accountMid, archiveText)
      await refresh(accountMid)
    } finally {
      setArchiveBusy(false)
    }
  }
  const previewFavoriteArchiveRestore = async (mode: 'safe' | 'full') => {
    const api = window.bilimiDesktop
    if (!accountMid || !archiveImportPreview?.canRestoreRemotely || !api?.createFavoriteRepositoryArchiveRestorePlan ||
      ((archiveRestoreScope === 'selected' || archiveRestoreScope === 'current-folder') && !archiveRestoreAids.length)) throw new Error(text.unavailable)
    setArchiveBusy(true)
    try {
      // The main process actively reads bound managed shards.  No observed
      // physical IDs or remote membership leave this renderer.
      const restoreScope = archiveRestoreScope === 'all'
        ? { kind: 'all' as const }
        : archiveRestoreScope === 'selected'
          ? { kind: 'aids' as const, aids: archiveRestoreAids }
          : currentLogicalFolderId
            ? { kind: 'logical-folder' as const, folderId: currentLogicalFolderId }
            : undefined
      if (!restoreScope) throw new Error(text.unavailable)
      const preview = await api.createFavoriteRepositoryArchiveRestorePlan(accountMid, archiveText, mode, restoreScope)
      setArchiveRestorePreview(preview)
      setArchiveRestoreExecution(undefined)
    } finally {
      setArchiveBusy(false)
    }
  }
  const executeFavoriteArchiveRestore = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !archiveRestorePreview || !api?.executeFavoriteRepositoryArchiveRestore) throw new Error(text.unavailable)
    setArchiveBusy(true)
    try {
      let confirmationToken: string | undefined
      if (archiveRestorePreview.mode === 'full') {
        if (!api.confirmFavoriteRepositoryArchiveFullRestore) throw new Error(text.unavailable)
        confirmationToken = (await api.confirmFavoriteRepositoryArchiveFullRestore(
          accountMid, archiveRestorePreview as FavoriteRepositoryRestorePlan, archiveRestorePreview.executionToken
        )).confirmationToken
      }
      const result = await api.executeFavoriteRepositoryArchiveRestore(
        accountMid, archiveRestorePreview as FavoriteRepositoryRestorePlan, archiveRestorePreview.executionToken, confirmationToken
      ) as FavoriteRepositoryRestoreExecutionResult
      setArchiveRestoreExecution(result)
      if (result.status === 'succeeded') await refresh(accountMid)
    } finally {
      setArchiveBusy(false)
    }
  }
  const reconcileFavoriteArchiveRestore = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !archiveRestorePreview || !api?.reconcileFavoriteRepositoryArchiveRestore) throw new Error(text.unavailable)
    setArchiveBusy(true)
    try {
      setArchiveRestoreExecution(await api.reconcileFavoriteRepositoryArchiveRestore(
        accountMid, archiveRestorePreview as FavoriteRepositoryRestorePlan, archiveRestorePreview.executionToken
      ) as FavoriteRepositoryRestoreExecutionResult)
    } finally {
      setArchiveBusy(false)
    }
  }
  const currentFolderId = scope.kind === 'folder' ? scope.folderId : undefined
  const isRecycleScope = scope.kind === 'recycle'
  const eligibilityIndex = useMemo(() => buildFavoriteLibraryEligibilityIndex(folders, page?.items ?? []), [folders, page?.items])
  const currentFolder = currentFolderId ? eligibilityIndex.folderById.get(currentFolderId) : undefined
  const currentLedgerBindingStatus = favoriteLibraryLedgerBindingStatus(currentFolder)
  const currentLogicalFolderId = currentFolderId && eligibilityIndex.folderById.get(currentFolderId)?.kind === 'bilimi-logical'
    ? currentFolderId
    : undefined
  const resolvedOperationSource = useMemo(() => resolveFavoriteLibrarySource(currentFolderId, eligibilityIndex.folderById, scope.kind), [currentFolderId, eligibilityIndex.folderById, scope.kind])
  const selectionEligibility = useCallback((selection: FavoriteLibrarySelectionSnapshot) => determineFavoriteOperationEligibility({
    source: resolvedOperationSource.source,
    aids: selection.selectedAids,
    folders: resolvedOperationSource.source.kind === 'folder' ? [eligibilityIndex.folderById.get(resolvedOperationSource.source.folderId)!].filter(Boolean) : [],
    aidScopeKinds: eligibilityIndex.aidScopeKinds
  }), [eligibilityIndex.aidScopeKinds, eligibilityIndex.folderById, resolvedOperationSource.source])
  const selectionActionEligibility = useCallback((selection: FavoriteLibrarySelectionSnapshot, action: 'delete-local') => determineFavoriteOperationActionEligibility({
    source: resolvedOperationSource.source,
    action,
    aids: selection.selectedAids,
    folders: resolvedOperationSource.source.kind === 'folder' ? [eligibilityIndex.folderById.get(resolvedOperationSource.source.folderId)!].filter(Boolean) : [],
    aidScopeKinds: eligibilityIndex.aidScopeKinds
  }), [eligibilityIndex.aidScopeKinds, eligibilityIndex.folderById, resolvedOperationSource.source])
  const operationSource = useCallback((requestedAids: number[], sourceEligibility = selectionEligibility(selectionStore.getSnapshot())): FavoriteLibraryOperationSource => currentFolderId
    ? { kind: 'folder', folderId: currentFolderId }
    : {
        kind: 'virtual',
        eligibleAids: sourceEligibility.eligibleAids.filter((aid) => requestedAids.includes(aid)),
        skippedAids: sourceEligibility.skipped.map((item) => item.aid)
      }, [currentFolderId, selectionEligibility])
  const bilimiMembershipSource = useCallback((requestedAids: number[], selection: 'primary' | 'all'): FavoriteLibraryOperationSource => currentLogicalFolderId
    ? { kind: 'folder', folderId: currentLogicalFolderId }
    : {
        kind: 'virtual',
        eligibleAids: [...new Set(requestedAids)].sort((left, right) => left - right),
        skippedAids: [],
        bilimiMembershipSelection: selection
      }, [currentLogicalFolderId])
  const operationSelection = useCallback((selection: FavoriteLibrarySelectionSnapshot): FavoriteLibraryOperationSelection => {
    if (scope.kind === 'recycle') return [...selection.selectedAids]
    return selection.selectAllScope
      ? { kind: 'scope', scope, options: pageOptions, excludedAids: [...selection.excludedAids] }
      : [...selection.selectedAids]
  }, [pageOptions, scope])
  const detailSourceEligibility = selectionEligibility({ selectedAids: [], selectAllScope: false, excludedAids: [] })
  const detailIsOrdinarySource = detailSourceEligibility.sourceScopeKind === 'bilibili-default' || detailSourceEligibility.sourceScopeKind === 'bilibili-user-folder'
  const detailBilimiDeletionVisible = Boolean(currentLogicalFolderId || detailIsOrdinarySource || detailSourceEligibility.sourceScopeKind === 'mixed-virtual')
  const detailRemoteDeletionVisible = Boolean(selected)
  const detailLocalDeletionAvailable = detailBilimiDeletionVisible
  const detailOrdinarySourceNames = detail?.folders.filter((folder) => folder.kind === 'bilibili').map((folder) => folder.title) ?? []
  const detailSourceVideo = detailSnapshot && detailSnapshot.video.aid === selected?.aid ? detailSnapshot.video : selected
  const detailQueueItem = selected && detailSourceVideo
    ? latestTranscriptionForRow(transcriptionQueue, accountMid, selected.aid, detailSourceVideo.cid)
    : undefined
  const detailTranscriptionCommand = transcriptionQueueCommand(detailQueueItem)
  const detailCanStartTranscription = ['enqueue', 'retry', 'retry-archive-registration'].includes(detailTranscriptionCommand)
  const detailCanCancelTranscription = ['cancel-waiting', 'cancel-summary', 'cancel-running'].includes(detailTranscriptionCommand)
  const runDetailTranscriptionAction = (action: 'start' | 'cancel') => void runAction(async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !selected) throw new Error(text.unavailable)
    const cid = detailSourceVideo?.cid
    if (action === 'cancel' && detailTranscriptionCommand === 'cancel-waiting') {
      if (!api?.cancelFavoriteLibraryWaitingTranscription) throw new Error(text.unavailable)
      return api.cancelFavoriteLibraryWaitingTranscription(accountMid, cid === undefined ? { aids: [selected.aid] } : { targets: [{ aid: selected.aid, cid }] })
    }
    if (action === 'cancel' && detailTranscriptionCommand === 'cancel-summary') {
      if (!detailQueueItem || !api?.cancelVideoAudioTranscriptionSummary) throw new Error(text.unavailable)
      return api.cancelVideoAudioTranscriptionSummary(detailQueueItem.id)
    }
    if (action === 'cancel' && detailTranscriptionCommand === 'cancel-running') {
      if (!detailQueueItem || !api?.cancelVideoAudioTranscription) throw new Error(text.unavailable)
      return api.cancelVideoAudioTranscription(detailQueueItem.id)
    }
    if (action === 'start' && detailTranscriptionCommand === 'retry') {
      if (!detailQueueItem || !api?.retryVideoAudioTranscription) throw new Error(text.unavailable)
      return api.retryVideoAudioTranscription(detailQueueItem.id)
    }
    if (action === 'start' && detailTranscriptionCommand === 'retry-archive-registration') {
      if (!detailQueueItem || !api?.retryVideoAudioArchiveRegistration) throw new Error(text.unavailable)
      return api.retryVideoAudioArchiveRegistration(detailQueueItem.id)
    }
    if (action !== 'start' || detailTranscriptionCommand !== 'enqueue') throw new Error(text.unavailable)
    if (!api?.enqueueFavoriteLibraryTranscription) throw new Error(text.unavailable)
    return api.enqueueFavoriteLibraryTranscription(accountMid, cid === undefined ? { aids: [selected.aid] } : { targets: [{ aid: selected.aid, cid }] })
  })
  const openDetailDocumentExport = () => void runAction(async () => {
    const api = window.bilimiDesktop
    if (!api?.resolveFavoriteLibraryDocumentExportSelection || !accountMid || !selected) throw new Error(text.unavailable)
    const cid = detailSourceVideo?.cid
    const resolved = await api.resolveFavoriteLibraryDocumentExportSelection(accountMid, cid === undefined ? { kind: 'aids', aids: [selected.aid] } : { kind: 'targets', targets: [{ aid: selected.aid, cid }] })
    if (accountMidRef.current !== accountMid) return
    setDocumentExport({ accountMid, ...resolved })
  })
  const detailSourceMethod = detailSourceVideo?.favoriteAt ? 'B站收藏' : detailSourceVideo?.scannedAt ? '扫描发现' : '本地收藏库'
  const detailSourceAt = detailSourceVideo?.favoriteAt ?? detailSourceVideo?.scannedAt ?? detailSourceVideo?.updatedAt
  const detailFolderName = (folderId: string) => folders.find((folder) => folder.id === folderId)?.title ?? folderId
  const classificationAdjustmentLabel = (adjustment: FavoriteRepositoryClassificationAdjustment) => {
    const operation = ({
      review: '批阅',
      'organize-favorites': '整理收藏',
      'library-placement': '收藏库归属调整',
      copy: '复制收藏库归属',
      move: '移动收藏库归属',
      'adopt-bilibili-placement': '采用 B 站归属',
      'synchronize-bilibili': '同步到 B 站',
      'remove-bilimi-placement': '从 bilimi 工作夹移除'
    } as const)[adjustment.operation]
    return adjustment.classificationSource
      ? `${operation}，${formatFavoriteLibraryAdjustment({ kind: adjustment.classificationSource, occurredAt: adjustment.occurredAt })}`
      : operation
  }
  const classificationAdjustmentDetail = (adjustment: FavoriteRepositoryClassificationAdjustment) => {
    const before = adjustment.beforeFolderIds.map(detailFolderName)
    const after = adjustment.afterFolderIds.map(detailFolderName)
    const placement = !before.length && !after.length ? '未记录归属变更'
      : !before.length ? `加入收藏库归属：${after.join('、')}`
        : !after.length ? `从收藏库归属移除：${before.join('、')}`
          : `从 ${before.join('、')} 调整到 ${after.join('、')}`
    const bilibiliSync = adjustment.bilibiliSync ?? { attempted: false }
    const sync = bilibiliSync.attempted
      ? `；B站同步${({ succeeded: '成功', failed: '失败', 'result-unknown': '结果待确认', queued: '已排队' } as const)[bilibiliSync.status ?? 'queued']}`
      : ''
    return `${placement}${sync}`
  }
  const detailLocalPositions = detailSnapshot?.position?.localDesiredFolderIds.map(detailFolderName) ?? []
  const detailRemotePositions = detailSnapshot?.position?.remoteObservedLogicalFolderIds.map(detailFolderName) ?? []
  const detailSyncState = detailSnapshot?.libraryStates?.sync ?? detail?.libraryStates?.sync
  const detailRemoteOwnership = detailRemotePositions.join('、') || '未同步'
  const currentLogicalFolderAids = currentLogicalFolderId
    ? [...new Set(rows.filter((row) => row.folderIds.includes(currentLogicalFolderId)).map((row) => row.aid))].sort((left, right) => left - right)
    : []
  const archiveRestoreAids = archiveRestoreScope === 'selected' ? renderSelection.selectedAids : currentLogicalFolderAids
  const archiveScopeRequiresAids = archiveRestoreScope === 'selected' || archiveRestoreScope === 'current-folder'
  const renderPlacementPicker = () => {
    const titleFor = (folderId: string) => workspaceDestinationOptions.find((folder) => folder.id === folderId)?.title ?? folderId
    const finalFolderSet = placementDraftFolderIds.length
      ? placementDraftFolderIds.map(titleFor).join('、')
      : FAVORITE_LIBRARY_STAGING_TITLE
    const previous = detailSnapshot?.position?.localDesiredFolderIds ?? []
    const added = placementDraftFolderIds.filter((folderId) => !previous.includes(folderId))
    const removed = previous.filter((folderId) => !placementDraftFolderIds.includes(folderId))
    const retained = previous.filter((folderId) => placementDraftFolderIds.includes(folderId))
    const picker = <div {...placementPickerScope} ref={placementPickerRef} className="favorite-library__placement-picker favorite-library__placement-floating-menu" role="menu" aria-label={placementPickerBatch ? '调整所选收藏库归属' : '调整收藏库归属'} aria-busy={placementSaving} style={placementPickerPosition}>
      <p>{placementPickerBatch
        ? placementPickerMode === 'copy'
          ? `将复制 ${selectedCount} 个所选视频到选中的收藏库归属；原有归属会保留。`
          : placementPickerMode === 'move'
            ? `将把 ${selectedCount} 个所选视频从当前 bilimi 工作夹移到选中的收藏库归属；只移除当前工作夹归属。`
            : `将调整 ${selectedCount} 个所选视频。勾选代表这些视频共同的最终收藏库归属；默认只调整收藏库。`
        : '勾选代表最终收藏库归属；默认只调整收藏库。'}</p>
      {workspaceDestinationOptions.map((folder) => <label key={folder.id}><input type="checkbox" aria-label={folder.title} checked={placementDraftFolderIds.includes(folder.id)} disabled={placementSaving} onChange={() => togglePlacementFolder(folder.id)} />{folder.title}</label>)}
      {placementPickerBatch && placementPickerMode === 'copy'
        ? <div className="favorite-library__placement-preview"><p>新增收藏库归属：{finalFolderSet}；原有归属保持不变。</p></div>
        : placementPickerBatch && placementPickerMode === 'move'
          ? <div className="favorite-library__placement-preview"><p>移除当前工作夹：{currentLogicalFolderId ? titleFor(currentLogicalFolderId) : '不可用'}；新增：{finalFolderSet}。</p></div>
        : placementPickerBatch
        ? <div className="favorite-library__placement-preview"><p>最终收藏库归属：{finalFolderSet}</p></div>
        : <div className="favorite-library__placement-preview"><p>新增：{added.length ? added.map(titleFor).join('、') : '无'}</p><p>移除：{removed.length ? removed.map(titleFor).join('、') : '无'}</p><p>保留：{retained.length ? retained.map(titleFor).join('、') : '无'}</p></div>}
      <div><button type="button" className="favorite-library__inline-action" disabled={placementSaving} onClick={() => void savePlacement()}>{placementSaving ? '正在保存…' : '保存收藏库归属'}</button><button type="button" className="favorite-library__inline-action" disabled={placementSaving} onClick={() => setPlacementPickerOpen(false)}>取消</button></div>
    </div>
    return typeof document === 'undefined' ? null : createPortal(picker, document.body)
  }

  return (
    <main className="favorite-library" data-embedded={embedded || undefined} aria-label={text.library}>
      {embedded ? null : <div className="favorite-library__header-spacer" aria-hidden="true" />}
      {!embedded ? (
        <FavoriteLibraryHeader title={text.library} remoteWarning={Boolean(summary?.syncCounts.failed || summary?.syncCounts['result-unknown'])}
          account={accountMid ? `${accountNickname ?? '当前账号'}（UID：${accountMid}）` : text.loadingAccount}
          onGoToPending={goToPending}
          onMinimize={() => { void window.bilimiDesktop.controlFavoriteLibraryWindow?.('minimize') }}
          onExpandAndMaximize={() => { void window.bilimiDesktop.controlFavoriteLibraryWindow?.('expand-and-maximize') }}
          onClose={() => { void window.close() }}>
          {summary?.folderConflicts?.length ? <button type="button" className="favorite-library__conflict-trigger" aria-label={`发现 ${summary.folderConflicts.length} 项收藏夹问题，点击处理`} onClick={() => setConflictsOpen(true)}>{`发现 ${summary.folderConflicts.length} 项收藏夹问题 · 点击处理`}</button> : null}
        </FavoriteLibraryHeader>
      ) : null}
      {!embedded ? <section className="favorite-library__archive-tools" aria-label="收藏存档">
        <button type="button" aria-expanded={archivePanelOpen} onClick={() => setArchivePanelOpen((open) => !open)}>收藏存档</button>
        {archivePanelOpen ? <div className="favorite-library__archive-panel" aria-busy={archiveBusy}>
          <p>导出不含 Cookie、密钥或远程授权。导入和恢复都先预览；恢复只管理 bilimi 受管仓库。</p>
          <button type="button" disabled={!accountMid || archiveBusy} onClick={() => void runDetailAction(exportFavoriteArchive)}>导出收藏存档</button>
          <label>存档 JSON<textarea aria-label="存档 JSON" value={archiveText} disabled={archiveBusy} onChange={(event) => {
            setArchiveText(event.currentTarget.value)
            setArchiveImportPreview(undefined)
            setArchiveRestorePreview(undefined)
            setArchiveRestoreExecution(undefined)
          }} /></label>
          <button type="button" disabled={!accountMid || !archiveText.trim() || archiveBusy} onClick={() => void runDetailAction(previewFavoriteArchiveImport)}>检查存档</button>
          {archiveImportPreview ? <div role="status">
            <p>{archiveImportPreview.accountMatches ? `存档包含 ${archiveImportPreview.videoCount} 个视频、${archiveImportPreview.eventCount} 条重要记录。` : '此存档属于其他账号：可离线查看，但禁止写入或恢复到 B 站。'}</p>
            {archiveImportPreview.canApply ? <button type="button" disabled={archiveBusy} onClick={() => void runDetailAction(applyFavoriteArchiveImport)}>导入到本地收藏库</button> : null}
            {archiveImportPreview.canRestoreRemotely ? <div className="favorite-library__archive-restore-actions">
              <label>恢复范围<select aria-label="恢复范围" value={archiveRestoreScope} disabled={archiveBusy} onChange={(event) => setArchiveRestoreScope(event.currentTarget.value === 'selected' ? 'selected' : event.currentTarget.value === 'current-folder' ? 'current-folder' : 'all')}><option value="all">全部存档视频</option><option value="selected">当前已选视频（{renderSelection.selectedAids.length}）</option><option value="current-folder" disabled={!currentLogicalFolderAids.length}>当前逻辑分类视频（{currentLogicalFolderAids.length}）</option></select></label>
              <button type="button" disabled={archiveBusy || (archiveScopeRequiresAids && !archiveRestoreAids.length)} onClick={() => void runDetailAction(() => previewFavoriteArchiveRestore('safe'))}>预览安全恢复到B站</button>
              <button type="button" disabled={archiveBusy || (archiveScopeRequiresAids && !archiveRestoreAids.length)} onClick={() => void runDetailAction(() => previewFavoriteArchiveRestore('full'))}>预览完全恢复到B站</button>
            </div> : null}
          </div> : null}
          {archiveRestorePreview ? (() => {
            const added = archiveRestorePreview.operations.reduce((count, operation) => count + operation.appendLogicalFolderIds.length, 0)
            const removed = archiveRestorePreview.operations.reduce((count, operation) => count + operation.removeLogicalFolderIds.length, 0)
            const unknown = archiveRestoreExecution?.status === 'result-unknown'
            return <div className="favorite-library__archive-restore-preview" role="status">
              <p>{archiveRestorePreview.mode === 'safe'
                ? `将补齐 ${added} 个 B 站受管归属，不会移除远端额外归属。`
                : `将补齐 ${added} 个并移除 ${removed} 个 B 站受管归属；普通 B 站来源不会被删除。`}</p>
              <p>已由主进程主动扫描当前受管分册；执行前还会再次核对远端基线。</p>
              {unknown ? <><p>远程结果待确认：请先对账，不能直接重试。</p><button type="button" disabled={archiveBusy} onClick={() => void runDetailAction(reconcileFavoriteArchiveRestore)}>对账恢复结果</button></> : <button type="button" disabled={archiveBusy || archiveRestoreExecution?.status === 'succeeded'} onClick={() => void runDetailAction(executeFavoriteArchiveRestore)}>{archiveRestorePreview.mode === 'full' ? '二次确认并完全恢复到B站' : '执行安全恢复到B站'}</button>}
              {archiveRestoreExecution ? <><p>{`恢复进度：${archiveRestoreExecution.completedOperationCount}/${archiveRestoreExecution.totalOperationCount}，${archiveRestoreExecution.status === 'succeeded' ? '已完成' : archiveRestoreExecution.status === 'result-unknown' ? '结果待确认' : '存在失败项'}`}</p><ul className="favorite-library__archive-restore-results" aria-label="恢复明细">{archiveRestoreExecution.items.map((item) => <li key={item.aid}>{`视频 #${item.aid}：${item.status === 'succeeded' ? '已完成' : item.status === 'result-unknown' ? '结果待确认' : '失败'}${item.reason ? `（${item.reason}）` : ''}`}</li>)}</ul></> : null}
            </div>
          })() : null}
        </div> : null}
      </section> : null}
      {error ? <p role="alert" className="favorite-library__error">{error}</p> : null}
      {!embedded && remoteReconciliations.filter((item) => item.kind === 'unfavorite').length ? <div className="favorite-library__remote-reconciliation" role="status">
        <p>远程结果待确认：请先逐项对账，不能自动重试或再次执行。</p>
        {remoteReconciliations.filter((item) => item.kind === 'unfavorite').map((remoteReconciliation) => <button key={`${remoteReconciliation.kind}:${remoteReconciliation.operationId}`} type="button" onClick={() => void runDetailAction(() => reconcileRemoteOperation(remoteReconciliation))}>对账取消收藏结果</button>)}
      </div> : null}
      {batchRemoteDeletionChoice ? <FavoriteLibraryConfirmationDialog label="确认批量从 B 站 bilimi 收藏夹删除" onClose={() => setBatchRemoteDeletionChoice(undefined)}>
        <p>{currentLogicalFolderId
          ? batchRemoteDeletionChoice.includeOtherWorkFolders ? '将从当前及其他 bilimi 工作夹移除所选视频的 B 站 bilimi 归属；普通 B 站收藏夹不会修改。' : '将只从当前 bilimi 工作夹移除所选视频的 B 站 bilimi 归属；普通 B 站收藏夹不会修改。'
          : batchRemoteDeletionChoice.includeOtherWorkFolders ? '将从所选视频已记录的全部 bilimi 工作夹移除 B 站 bilimi 归属；普通 B 站收藏夹不会修改。' : '将从所选视频已记录的一个 bilimi 工作夹移除 B 站 bilimi 归属；普通 B 站收藏夹不会修改。'}</p>
        {(currentLogicalFolderId ? workspaceDestinationOptions.some((folder) => folder.id !== currentLogicalFolderId) : workspaceDestinationOptions.length > 1) ? <label><input type="checkbox" aria-label="同时从其他 bilimi 工作夹移除" checked={batchRemoteDeletionChoice.includeOtherWorkFolders} onChange={(event) => setBatchRemoteDeletionChoice((current) => current ? { ...current, includeOtherWorkFolders: event.currentTarget.checked } : current)} />同时从其他 bilimi 工作夹移除</label> : null}
        <div className="favorite-library__dialog-actions"><button type="button" onClick={() => setBatchRemoteDeletionChoice(undefined)}>取消</button><button type="button" className="favorite-library__dialog-remote-action" onClick={() => void runDetailAction(async () => {
          const logicalFolderIds = currentLogicalFolderId
            ? batchRemoteDeletionChoice.includeOtherWorkFolders
              ? workspaceDestinationOptions.map((folder) => folder.id).sort()
              : [currentLogicalFolderId]
            : []
          await previewBatchRemoteUnfavorite(batchRemoteDeletionChoice.selection, batchRemoteDeletionChoice.requestedAids, logicalFolderIds, batchRemoteDeletionChoice.includeOtherWorkFolders)
          setBatchRemoteDeletionChoice(undefined)
        })}>继续</button></div>
      </FavoriteLibraryConfirmationDialog> : null}
      {batchRemoteUnfavoritePreview ? <FavoriteLibraryConfirmationDialog label="确认从 B 站 bilimi 收藏夹删除" busy={remoteUnfavoriteExecuting} onClose={() => setBatchRemoteUnfavoritePreview(undefined)}>
        <p>将从 B 站 bilimi 收藏夹删除 {batchRemoteUnfavoritePreview.aids.length} 个视频的归属：{batchRemoteUnfavoritePreview.affectedLogicalFolders.map((folder) => folder.title).join('、') || '所选 bilimi 工作夹'}。</p>
        {batchRemoteUnfavoritePreview.skippedUnsyncedAids.length ? <p role="alert">收藏未同步：已跳过 {batchRemoteUnfavoritePreview.skippedUnsyncedAids.length} 个视频。</p> : null}
        {batchRemoteUnfavoritePreview.skippedUnmatchedAids.length ? <p role="alert">未找到 bilimi 收藏夹归属，已跳过 {batchRemoteUnfavoritePreview.skippedUnmatchedAids.length} 个视频。</p> : null}
        {batchRemoteUnfavoritePreview.preservedOrdinarySources.length ? <p>普通 B 站收藏夹仍保留：{batchRemoteUnfavoritePreview.preservedOrdinarySources.map((folder) => folder.title).join('、')}</p> : null}
        {batchRemoteUnfavoritePreview.recycleAids.length ? <p role="alert">其中 {batchRemoteUnfavoritePreview.recycleAids.length} 个视频没有其他普通 B 站来源，远端确认移除后会进入回收站。</p> : null}
        <p>{batchRemoteUnfavoritePreview.baselineRevision === undefined ? '执行前会再次核对远端状态。' : `预览基线版本 ${batchRemoteUnfavoritePreview.baselineRevision}；版本变化将拒绝执行。`}</p>
        <p>本地标题、标签、转写与档案都会保留；网络异常不会自动重试，未成功时请稍后重试。</p>
        <div className="favorite-library__dialog-actions"><button type="button" disabled={remoteUnfavoriteExecuting} onClick={() => setBatchRemoteUnfavoritePreview(undefined)}>取消</button><button type="button" className="favorite-library__dialog-remote-action" disabled={remoteUnfavoriteExecuting} onClick={() => void runDetailAction(confirmBatchRemoteUnfavorite)}>确认删除 B 站 bilimi 归属</button></div>
      </FavoriteLibraryConfirmationDialog> : null}
      {batchLocalDeleteConfirmationOpen ? <FavoriteLibraryConfirmationDialog label="确认从收藏库 bilimi 收藏夹删除" onClose={() => setBatchLocalDeleteConfirmationOpen(false)}>
        <p>{currentLogicalFolderId
          ? `将从当前 bilimi 工作夹移除 ${selectedCount} 个所选视频的收藏库归属，不会取消 B 站收藏，也不会删除已有转写、档案、保护记录或处理历史。`
          : `将按所选视频已记录的 bilimi 工作夹归属处理 ${selectedCount} 个视频；普通 B 站收藏夹不会修改，也不会删除已有转写、档案、保护记录或处理历史。`}</p>
        {(currentLogicalFolderId ? workspaceDestinationOptions.some((folder) => folder.id !== currentLogicalFolderId) : workspaceDestinationOptions.length > 1) ? <label><input type="checkbox" aria-label="同时从其他 bilimi 工作夹移除" checked={batchDeleteOtherWorkFolders} onChange={(event) => setBatchDeleteOtherWorkFolders(event.currentTarget.checked)} />同时从其他 bilimi 工作夹移除</label> : null}
        <div className="favorite-library__dialog-actions"><button type="button" onClick={() => { setBatchDeleteOtherWorkFolders(false); setBatchLocalDeleteConfirmationOpen(false) }}>取消</button><button type="button" className="favorite-library__danger-action" onClick={() => void runAction(deleteSelectedFromLibrary)}>确认从收藏库 bilimi 收藏夹删除所选视频</button></div>
      </FavoriteLibraryConfirmationDialog> : null}
      {workspaceSyncConfirmationOpen ? <FavoriteLibraryConfirmationDialog label="备册 bilimi 工作夹" busy={workspaceSyncExecuting} onClose={() => { if (!workspaceSyncExecuting) setWorkspaceSyncConfirmationOpen(false) }}>
        <p>请选择要备册的 bilimi 工作夹。备册只会为所选工作夹创建或绑定 B 站收藏夹，不会同步视频或修改其他收藏夹。</p>
        <div className="favorite-library__dialog-actions"><button type="button" disabled={workspaceSyncExecuting} onClick={() => setWorkspaceSyncSelection(folders.filter((folder) => folder.kind === 'bilimi-logical').map((folder) => folder.id))}>全选</button></div>
        <ul className="favorite-library__managed-folder-preview">{folders.filter((folder) => folder.kind === 'bilimi-logical').map((folder) => <li key={folder.id}><label><input type="checkbox" aria-label={`选择 ${folder.title}`} checked={workspaceSyncSelection.includes(folder.id)} disabled={workspaceSyncExecuting} onChange={(event) => setWorkspaceSyncSelection((current) => event.currentTarget.checked ? [...new Set([...current, folder.id])] : current.filter((id) => id !== folder.id))} /><span>{folder.title}</span></label></li>)}</ul>
        <div className="favorite-library__dialog-actions"><button type="button" disabled={workspaceSyncExecuting} onClick={() => setWorkspaceSyncConfirmationOpen(false)}>取消</button><button type="button" disabled={workspaceSyncExecuting || !workspaceSyncSelection.length} onClick={() => void runAction(confirmWorkspaceSync)}>开始备册</button></div>
      </FavoriteLibraryConfirmationDialog> : null}
      {workspaceBindingCandidates ? <FavoriteLibraryConfirmationDialog label="确认绑定 bilimi 收藏夹" busy={workspaceSyncExecuting} onClose={() => {
        if (!workspaceSyncExecuting) {
          setWorkspaceBindingCandidates(undefined)
          setWorkspaceBindingSelections({})
        }
      }}>
        <p>检测到所选工作夹在 B 站有同名、但尚未正式绑定的收藏夹。请确认要绑定的实际收藏夹；未选中的候选不会被修改。</p>
        <ul className="favorite-library__managed-folder-preview">{workspaceBindingCandidates.flatMap((entry) => entry.candidates.map((candidate) => {
          const selected = (workspaceBindingSelections[entry.logicalLedgerId] ?? []).includes(candidate.id)
          return <li key={`${entry.logicalLedgerId}:${candidate.id}`}><label><input type="checkbox" aria-label={`绑定 ${entry.title} 到 ${candidate.title}`} checked={selected} disabled={workspaceSyncExecuting || Boolean(candidate.bindingFailureReason)} onChange={(event) => setWorkspaceBindingSelections((current) => {
            const selectedIds = current[entry.logicalLedgerId] ?? []
            return {
              ...current,
              [entry.logicalLedgerId]: event.currentTarget.checked
                ? [...new Set([...selectedIds, candidate.id])]
                : selectedIds.filter((id) => id !== candidate.id)
            }
          })} /><span>{entry.title} ← {candidate.title}（{candidate.memberCount} 个视频）{candidate.bindingFailureReason ? `：${candidate.bindingFailureReason}` : ''}</span></label></li>
        }))}</ul>
        <div className="favorite-library__dialog-actions"><button type="button" disabled={workspaceSyncExecuting} onClick={() => {
          setWorkspaceBindingCandidates(undefined)
          setWorkspaceBindingSelections({})
        }}>取消</button><button type="button" disabled={workspaceSyncExecuting || workspaceBindingCandidates.some((entry) => !(workspaceBindingSelections[entry.logicalLedgerId] ?? []).length)} onClick={() => void runAction(confirmWorkspaceBindings)}>确认绑定</button></div>
      </FavoriteLibraryConfirmationDialog> : null}
      {managedFolderDeletionDialog ? <FavoriteLibraryConfirmationDialog label="删除 bilimi 收藏夹" busy={managedFolderDeletionExecuting} onClose={() => {
        if (!managedFolderDeletionExecuting) setManagedFolderDeletionDialog(undefined)
      }}>
        <fieldset className="favorite-library__managed-folder-delete-scope"><legend>删除范围</legend><label className="favorite-library__managed-folder-delete-scope-option"><input type="radio" name="library-managed-folder-delete-scope" checked={managedFolderDeletionScope === 'local-only'} onChange={() => setManagedFolderDeletionScope('local-only')} /><span>仅从收藏库删除 bilimi 工作夹（保留右侧规则和 B 站收藏夹）</span></label>{managedFolderDeletionDialog.candidates.some((candidate) => candidate.state !== 'local-only') ? <label className="favorite-library__managed-folder-delete-scope-option"><input type="radio" name="library-managed-folder-delete-scope" checked={managedFolderDeletionScope === 'bilibili'} onChange={() => setManagedFolderDeletionScope('bilibili')} /><span>同时从 B 站删除收藏夹（保留右侧规则）</span></label> : null}</fieldset>
        <p>{managedFolderDeletionScope === 'local-only' ? '仅删除收藏库工作夹和分类关系；右侧规则、草稿、B 站收藏夹、视频、档案、转写和札记都会保留。' : '将删除所选收藏库工作夹及对应 B 站收藏夹；右侧规则和草稿会保留并显示未备册，可再次备册。'}</p>
        {managedFolderDeletionScope === 'bilibili' && managedRemoteDeletionSummary(managedFolderDeletionDialog.candidates) ? <p className="favorite-library__managed-folder-delete-summary">{managedRemoteDeletionSummary(managedFolderDeletionDialog.candidates)}</p> : null}
        {managedFolderDeletionDialog.mode === 'batch' ? <div className="favorite-library__dialog-actions"><button type="button" disabled={managedFolderDeletionExecuting} onClick={() => setManagedFolderDeletionSelection([...new Set(managedFolderDeletionDialog.candidates.map((candidate) => candidate.logicalLedgerId))])}>全选</button></div> : null}
        <ul className="favorite-library__managed-folder-preview">{managedFolderDeletionDialog.candidates.map((candidate) => {
          const selectedCandidate = managedFolderDeletionDialog.mode === 'single' || managedFolderDeletionSelection.includes(candidate.logicalLedgerId)
          const label = <span>{candidate.title}（{candidate.memberCount} 个视频，{candidate.state === 'bound' ? '已备册' : candidate.state === 'unbound-name-match' ? '未绑定' : candidate.state === 'missing-remote' ? '远端已不存在' : '未备册'}）</span>
          return <li key={`${candidate.logicalLedgerId}:${candidate.remoteFolderId ?? 'local'}`}>{managedFolderDeletionDialog.mode === 'single' ? label : <label><input type="checkbox" aria-label={`选择 ${candidate.title}`} checked={selectedCandidate} disabled={managedFolderDeletionExecuting} onChange={(event) => setManagedFolderDeletionSelection((current) => event.currentTarget.checked ? [...new Set([...current, candidate.logicalLedgerId])] : current.filter((id) => id !== candidate.logicalLedgerId))} />{label}</label>}</li>
        })}</ul>
        {managedFolderDeletionScope === 'bilibili' && managedFolderDeletionDialog.candidates.some((candidate) => candidate.requiresUnboundAcknowledgement) ? <label><input type="checkbox" checked={managedFolderDeletionAcknowledgedUnbound} disabled={managedFolderDeletionExecuting} onChange={(event) => setManagedFolderDeletionAcknowledgedUnbound(event.currentTarget.checked)} />已检测到 {managedFolderDeletionDialog.candidates.filter((candidate) => candidate.requiresUnboundAcknowledgement).length} 个未绑定的 bilimi 收藏夹。它们仅通过名称识别，未建立本地绑定。请确认这些不是你在 B 站手动创建的同名普通收藏夹再勾选。</label> : null}
        <label><input type="checkbox" aria-label="我已确认" checked={managedFolderDeletionAcknowledged} disabled={managedFolderDeletionExecuting} onChange={(event) => setManagedFolderDeletionAcknowledged(event.currentTarget.checked)} />我已确认</label>
        <div className="favorite-library__dialog-actions"><button type="button" disabled={managedFolderDeletionExecuting} onClick={() => setManagedFolderDeletionDialog(undefined)}>取消</button><button type="button" className="favorite-library__danger-action" disabled={managedFolderDeletionExecuting || (managedFolderDeletionDialog.mode === 'batch' && !managedFolderDeletionSelection.length) || !managedFolderDeletionAcknowledged || (managedFolderDeletionScope === 'bilibili' && managedFolderDeletionDialog.candidates.filter((candidate) => managedFolderDeletionDialog.mode === 'single' || managedFolderDeletionSelection.includes(candidate.logicalLedgerId)).some((candidate) => candidate.requiresUnboundAcknowledgement) && !managedFolderDeletionAcknowledgedUnbound)} onClick={() => void runAction(confirmManagedFolderDeletion)}>删除</button></div>
      </FavoriteLibraryConfirmationDialog> : null}
      {conflictsOpen && summary?.folderConflicts?.length ? <FavoriteLibraryConfirmationDialog label="收藏夹问题处理" onClose={() => setConflictsOpen(false)}>
        <h2>收藏夹问题</h2>
        <p>仅在归属证据不唯一时需要处理；关闭弹窗不会修改任何本地或 B 站数据。</p>
        <div className="favorite-library__conflict-list">
          {summary.folderConflicts.map((conflict) => <section key={`${conflict.title}:${conflict.folderIds.join(':')}`}>
            <strong>{conflict.title}</strong>
            <p>{conflict.reason ?? '候选归属不明确。'}</p>
            <ul>{(conflict.candidates ?? conflict.folderIds.map((id) => ({ id, title: id }))).map((candidate) => <li key={candidate.id}><span>{candidate.title}</span><code>{candidate.id}</code></li>)}</ul>
          </section>)}
        </div>
        <p>系统不会自行移动、改名或删除 B 站收藏夹。请核对候选后重新扫描。</p>
        <div className="favorite-library__dialog-actions"><button type="button" onClick={() => setConflictsOpen(false)}>关闭</button><button type="button" onClick={() => { setConflictsOpen(false); void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({ tab: 'ledger', sidebar: true }) }}>重新扫描</button></div>
      </FavoriteLibraryConfirmationDialog> : null}
      <div className="favorite-library__layout favorite-library__workspace" data-detail-state={detail && !detailOpen ? 'collapsed' : 'open'} data-embedded-layout={embedded || undefined} data-footer-split="true">
        <FavoriteLibraryNavigation
          uid={accountMid}
          groups={navigationGroups}
          collapsedGroups={collapsedNavigationGroups}
          selectedId={scopeId}
          onCollapseChange={(uid, groupId, collapsed) => {
            if (!uid) return
            const next = {
              ...(collapsedNavigationGroupsByAccountRef.current.get(uid) ?? (uid === accountMid ? collapsedNavigationGroups : {})),
              [groupId]: collapsed
            }
            collapsedNavigationGroupsByAccountRef.current.set(uid, next)
            const pendingSave = collapsedNavigationSaveTimersRef.current.get(uid)
            if (pendingSave) clearTimeout(pendingSave)
            collapsedNavigationSaveTimersRef.current.set(uid, setTimeout(() => {
              collapsedNavigationSaveTimersRef.current.delete(uid)
              void window.bilimiDesktop.saveFavoriteLibraryUiPreferences?.(uid, collapsedNavigationGroupsByAccountRef.current.get(uid) ?? {})
            }, 200))
          }}
          onSelect={(id) => {
            if (!accountMid) return false
            const selectionAttempt = ++selectionAttemptRef.current
            refreshIdRef.current += 1
            const confirmedScopeId = pageScopeId
            const nextScope = scopeForNavigation(id)
            const enteringRecycle = nextScope.kind === 'recycle'
            const nextPageOptions = enteringRecycle ? { sort: rowSort } : pageOptions
            setScopeId(id)
            return load(accountMid, nextScope, 1, pageSize, nextPageOptions).then((applied) => {
              if (selectionAttempt !== selectionAttemptRef.current) return false
              if (!applied) {
                setScopeId(confirmedScopeId)
                return false
              }
              if (enteringRecycle) {
                setSearchQuery('')
                setLibraryStateFilters({ sync: 'all', protection: 'all', organization: 'all' })
                setSourceFilter('all')
                setTranscriptionFilters([])
                setClassificationSources([])
              }
              setPageNumber(1)
              setListScrollTop(0)
              selectionStore.clear()
              setSelected(undefined)
              setDetailSnapshot(undefined)
              return true
            }).catch(() => {
              if (selectionAttempt !== selectionAttemptRef.current) return false
              setScopeId(confirmedScopeId)
              setError(text.unavailable)
              return false
            })
          }}
          onManagedFolderAction={(id, action) => {
            const folder = folders.find((candidate) => `folder:${candidate.id}` === id)
            if (action === 'edit') {
              uiCallbacks?.onManagedFolderAction?.(id, action)
              if (!folder?.logicalLedgerId) {
                if (folder?.id === 'local:inbox') {
                  void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({ tab: 'ledger', sidebar: true })
                  return
                }
                setError(text.unavailable)
                return
              }
              void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({ tab: 'ledger', ledgerId: folder.logicalLedgerId, ...(folder.kind === 'local' ? { ledgerTitle: folder.title } : {}), sidebar: true })
              return
            }
            if (!folder || !accountMid) return
            if (folder.id === 'local:inbox') {
              void openLocalInboxDeletion(folder).catch((error) => setError(favoriteLibraryActionFailureMessage(error)))
              return
            }
            if (!folder.logicalLedgerId) return
            void openManagedFolderDeletion([folder.logicalLedgerId], 'single').catch((error) => setError(favoriteLibraryActionFailureMessage(error)))
          }}
          onWorkspaceAction={(action) => {
            if (action === 'create') {
              void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({ tab: 'ledger', sidebar: true, createLedger: true })
              return
            }
            if (!accountMid) return
            if (action === 'sync-all') {
              setWorkspaceSyncSelection([])
              setWorkspaceSyncConfirmationOpen(true)
              return
            }
            if (action === 'delete-all') {
              const ledgerIds = folders.filter((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId)
                .map((folder) => folder.logicalLedgerId!)
              void openManagedFolderDeletion(ledgerIds).catch((error) => setError(favoriteLibraryActionFailureMessage(error)))
            }
          }}
        />
        {workspaceSyncResult ? <p className="favorite-library__batch-eligibility" role="status">{workspaceSyncResult}</p> : null}
        <section className="favorite-library__results" aria-label={text.results}>
          <div className="favorite-library__workspace-heading">
            <h2 {...(!page ? { role: 'status', 'aria-label': workspaceTitle } : {})}>{workspaceTitle}{workspaceVideoCount !== undefined ? <small className="favorite-library__workspace-video-count"> {workspaceVideoCount} 个视频</small> : null}</h2>
            {currentLedgerBindingStatus ? <span className="favorite-library__ledger-binding-status" data-state={currentLedgerBindingStatus.kind}>
              <strong>{currentLedgerBindingStatus.label}</strong>
              {currentLedgerBindingStatus.actionLabel && currentFolder?.logicalLedgerId ? <button type="button" onClick={() => void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({
                tab: 'ledger', sidebar: true, ledgerId: currentFolder.logicalLedgerId, ...(currentFolder.kind === 'local' ? { ledgerTitle: currentFolder.title } : {})
              })}>{currentLedgerBindingStatus.actionLabel}</button> : null}
            </span> : null}
            {page && libraryLoadState === 'refreshing' ? <p className="sr-only" role="status" aria-label="正在刷新收藏库">正在刷新收藏库</p> : null}
            {shouldShowFilteredCount ? <small>{`总计 ${currentScopeTotal} 个 · 当前显示 ${displayedTotal} 个`}</small> : null}
            {currentLogicalFolderId ? <span className="favorite-library__workspace-actions">
              <button type="button" disabled={!accountMid} title="为当前分类创建并绑定对应的 B 站 bilimi 收藏夹，不会同步视频。视频需通过“同步到B站”另行同步。" onClick={() => void runAction(() => backupCurrentWorkspaceFolder(currentLogicalFolderId, currentFolder?.logicalLedgerId ?? currentLogicalFolderId.replace(/^bilimi-logical:/, ''), currentFolder?.title ?? currentLogicalFolderId))}>{text.syncFolder}</button>
            </span> : null}
          </div>
          <FavoriteLibrarySelectionSubscriber store={selectionStore}>{(selectionSnapshot) => {
            const selection = operationSelection(selectionSnapshot)
            const sourceEligibility = selectionEligibility(selectionSnapshot)
            const eligibleSelectedAids = sourceEligibility.eligibleAids
            const deleteEligibleAids = selectionActionEligibility(selectionSnapshot, 'delete-local').eligibleAids
            const commonActions: FavoriteLibraryBatchAction[] = [
              'copy', 'refresh', 'transcribe', 'cancel-transcribe', 'download-documents',
              'reorganize'
            ]
            const batchAllowedActions = isRecycleScope
              ? []
              : !selectionSnapshot.selectAllScope && selectionSnapshot.selectedAids.length > 0 && !eligibleSelectedAids.length && sourceEligibility.sourceScopeKind !== 'mixed-virtual'
                ? ['copy', 'reorganize', 'download-documents'] as const
                : currentLogicalFolderId
                  ? [...commonActions, 'move', 'sync', 'delete-local', 'remove-managed-placement'] as const
                  : sourceEligibility.sourceScopeKind === 'bilibili-default' || sourceEligibility.sourceScopeKind === 'bilibili-user-folder' || sourceEligibility.sourceScopeKind === 'mixed-virtual'
                    ? [...commonActions, 'delete-local', 'remove-managed-placement'] as const
                    : [...commonActions, 'move', 'sync'] as const
            const hasPendingSelection = eligibleSelectedAids.some((aid) =>
              latestTranscriptionForRow(transcriptionQueue, accountMid, aid)?.status === 'pending')
            const batchDisabledActions: FavoriteLibraryBatchAction[] = [
              ...(selectionSnapshot.selectAllScope || hasPendingSelection ? [] : ['cancel-transcribe']),
              ...(currentLogicalFolderId && currentFolder?.syncState !== 'bound' ? ['remove-managed-placement'] : [])
            ]
            const currentSelectedCount = selectionSnapshot.selectAllScope
              ? Math.max(0, displayedTotal - selectionSnapshot.excludedAids.length)
              : selectionSnapshot.selectedAids.length
            return <FavoriteLibraryToolbar pageCount={displayedTotal} selectedCount={currentSelectedCount} allCurrentPageSelected={selectionSnapshot.selectAllScope} onTogglePage={selectionStore.toggleAll} batchDisabled={!currentSelectedCount} disabledActions={[...batchDisabledActions]} allowedActions={[...batchAllowedActions]} logicalFolders={workspaceDestinationOptions} onBatchDownload={() => {
            if (Array.isArray(selection) && !selectionSnapshot.selectedAids.length) return
            void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.resolveFavoriteLibraryDocumentExportSelection || !accountMid) throw new Error(text.unavailable)
              const requestedAccountMid = accountMid
              const exportSelection = Array.isArray(selection) ? { kind: 'aids' as const, aids: selectionSnapshot.selectedAids } : selection
              const resolved = await api.resolveFavoriteLibraryDocumentExportSelection(requestedAccountMid, exportSelection)
              if (accountMidRef.current !== requestedAccountMid) return
              setDocumentExport({ accountMid: requestedAccountMid, ...resolved })
            })
          }} onBatchPlacement={(action, folderIds) => {
            const actionAids = action === 'copy' ? selectionSnapshot.selectedAids : eligibleSelectedAids
            if (Array.isArray(selection) && !actionAids.length) return
            void runAction(async () => {
              const api = window.bilimiDesktop
              if (!accountMid || !summary) throw new Error(text.unavailable)
              if (action === 'copy') {
                if (!api?.copyFavoriteLibrarySelection) throw new Error(text.unavailable)
                return api.copyFavoriteLibrarySelection(accountMid, selection, folderIds, summary.revision, operationSource(Array.isArray(selection) ? selection : []))
              }
              const sourceFolderId = currentLogicalFolderId ?? (sourceEligibility.sourceScopeKind === 'unmatched' ? 'local:inbox' : undefined)
              if (!sourceFolderId || !api?.moveFavoriteLibrarySelection) throw new Error(text.unavailable)
              return api.moveFavoriteLibrarySelection(accountMid, selection, sourceFolderId, folderIds, summary.revision, operationSource(Array.isArray(selection) ? selection : []))
            })
          }} searchQuery={searchQuery} deferSearchChange onSearchChange={(query) => {
            setSearchQuery(query)
            setPageNumber(1)
            setListScrollTop(0)
            selectionStore.clear()
            if (accountMid) void load(accountMid, scope, 1, pageSize, { ...pageOptions, query })
          }} onBatchAction={(action) => {
            const actionAids = action === 'delete-local'
              ? deleteEligibleAids
              : action === 'copy' || action === 'reorganize' || action === 'remove-managed-placement' || action === 'download-documents'
                ? selectionSnapshot.selectedAids
                : eligibleSelectedAids
            setBatchEligibilityNotice(selectionSnapshot.selectedAids.length === actionAids.length ? undefined : `可操作 ${actionAids.length} 项，跳过 ${selectionSnapshot.selectedAids.length - actionAids.length} 项`)
            if (Array.isArray(selection)) uiCallbacks?.onBatchAction?.(action, [...actionAids])
            if (Array.isArray(selection) && !actionAids.length) return
            if (action === 'reorganize' && (selectionSnapshot.selectAllScope || actionAids.length)) {
              void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({
                tab: 'ledger',
                sidebar: true,
                organizeOldFavorites: true,
                ...(selectionSnapshot.selectAllScope
                  ? { selectedFavoriteSelection: selection as Exclude<FavoriteLibraryOperationSelection, number[]> }
                  : { selectedFavoriteAids: [...actionAids] })
              })
            }
            if (action === 'refresh') void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.syncFavoriteLibrarySelection || !accountMid) throw new Error(text.unavailable)
              return api.syncFavoriteLibrarySelection(accountMid, selectionSnapshot.selectAllScope ? selection : { kind: 'aids', aids: actionAids })
            })
            if (action === 'transcribe') void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.enqueueFavoriteLibraryTranscription || !accountMid) throw new Error(text.unavailable)
              return api.enqueueFavoriteLibraryTranscription(accountMid, selectionSnapshot.selectAllScope
                ? selection as Exclude<FavoriteLibraryOperationSelection, number[]>
                : { aids: actionAids })
            })
            if (action === 'cancel-transcribe') void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.cancelFavoriteLibraryWaitingTranscription || !accountMid) throw new Error(text.unavailable)
              return api.cancelFavoriteLibraryWaitingTranscription(accountMid, selectionSnapshot.selectAllScope ? selection : { aids: actionAids })
            })
            if (action === 'download-documents') void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.resolveFavoriteLibraryDocumentExportSelection || !accountMid) throw new Error(text.unavailable)
              const requestedAccountMid = accountMid
              const exportSelection = Array.isArray(selection) ? { kind: 'aids' as const, aids: actionAids } : selection
              const resolved = await api.resolveFavoriteLibraryDocumentExportSelection(requestedAccountMid, exportSelection)
              if (accountMidRef.current !== requestedAccountMid) return
              setDocumentExport({ accountMid: requestedAccountMid, ...resolved })
            })
            if (action === 'delete-local') {
              setBatchDeleteOtherWorkFolders(false)
              setBatchLocalDeleteConfirmationOpen(true)
            }
            if (action === 'remove-managed-placement' && accountMid && summary) {
              setBatchRemoteDeletionChoice({ selection, requestedAids: Array.isArray(selection) ? selection : [], includeOtherWorkFolders: false })
            }
          }}>
            {batchEligibilityNotice ? <p role="alert" className="favorite-library__batch-eligibility">{batchEligibilityNotice}</p> : null}
          </FavoriteLibraryToolbar>
          }}</FavoriteLibrarySelectionSubscriber>
          <div className="favorite-library__list-card">
          <div className="favorite-library__row-columns" data-testid="favorite-library-column-headings">
            <span aria-hidden="true" /> <span>{`视频名称（${({ 'updated-desc': '最近更新', 'updated-asc': '最早更新', 'title-asc': '标题 A-Z', 'title-desc': '标题 Z-A' } as const)[rowSort]}）`} <FavoriteLibraryColumnMenu label="标题排序" value={rowSort} options={[{ value: 'updated-desc', label: '最近更新' }, { value: 'updated-asc', label: '最早更新' }, { value: 'title-asc', label: '标题 A-Z' }, { value: 'title-desc', label: '标题 Z-A' }]} onChange={(sort) => {
              setRowSort(sort); setPageNumber(1); setListScrollTop(0); if (accountMid) void load(accountMid, scope, 1, pageSize, { ...pageOptions, sort })
            }} /></span><span>状态 <FavoriteLibraryStateFilterMenu value={libraryStateFilters} onChange={(key, value) => applyLibraryStateFilters({ ...libraryStateFilters, [key]: value })} /></span><span>{`转写（${transcriptionFilters.length ? transcriptionFilters.length === 1 ? ({ completed: '已转写', none: '无转写', pending: '等待', running: '进行中', failed: '失败' } as const)[transcriptionFilters[0]] : `已选 ${transcriptionFilters.length} 项` : '全部'}）`} <FavoriteLibraryMultiSelectColumnMenu label="转写筛选" values={transcriptionFilters} options={[{ value: 'completed', label: '已转写' }, { value: 'none', label: '无转写' }, { value: 'pending', label: '等待' }, { value: 'running', label: '进行中' }, { value: 'failed', label: '失败' }]} onChange={(nextFilters) => {
              setTranscriptionFilters(nextFilters); setPageNumber(1); setListScrollTop(0); selectionStore.clear(); if (accountMid) void load(accountMid, scope, 1, pageSize, { ...pageOptions, transcriptionFilters: nextFilters })
            }} /></span><span className="favorite-library__history-heading">分类与归属 <FavoriteLibraryClassificationOwnershipMenu classificationSources={classificationSources} sourceFilter={sourceFilter} onClassificationSourcesChange={(nextSources) => {
              setClassificationSources(nextSources); setPageNumber(1); setListScrollTop(0); selectionStore.clear(); if (accountMid) void load(accountMid, scope, 1, pageSize, { ...pageOptions, classificationSources: nextSources })
            }} onSourceFilterChange={(nextSourceFilter) => {
              setSourceFilter(nextSourceFilter); setPageNumber(1); setListScrollTop(0); selectionStore.clear(); if (accountMid) void load(accountMid, scope, 1, pageSize, { ...pageOptions, sourceFilter: nextSourceFilter === 'all' ? undefined : nextSourceFilter })
            }} /></span>
          </div>
          <VirtualFavoriteLibraryList
            ariaLabel={text.videoList}
            items={rows}
            className="favorite-library__list"
            scrollTop={listScrollTop}
            scrollResetKey={`${accountMid ?? ''}:${scopeId}:${pageNumber}:${pageSize}:${searchQuery}:${sourceFilter}:${libraryStateFilters.sync}:${libraryStateFilters.protection}:${libraryStateFilters.organization}:${rowSort}:${transcriptionFilters.join(',')}:${classificationSources.join(',')}`}
            onScrollTopChange={setListScrollTop}
            renderItem={(row) => (
              (() => {
                const rowDetail = detailSnapshot?.video.aid === row.aid ? detailSnapshot : undefined
                const queueItem = latestTranscriptionForRow(transcriptionQueue, accountMid, row.aid, row.cid)
                const transcription = queueItem
                  ? transcriptionActionForQueueItem(queueItem)
                  : transcriptionAction(rowDetail?.transcription.status)
                const transcriptionCommand = transcriptionQueueCommand(queueItem)
                const transcriptionLabel = transcriptionQueueCommandLabel(transcriptionCommand, transcription)
                const sourceNames = row.folderIds.map((folderId) => folderTitleById.get(folderId) ?? folderId)
                const sourceLabel = sourceNames.length ? sourceNames.join('、') : '未记录'
                const lastAdjustment = row.lastAdjustment
                const adjustmentLabel = formatFavoriteLibraryAdjustment(lastAdjustment)
                const adjustmentTime = lastAdjustment ? formatDetailTimestamp(lastAdjustment.occurredAt) : undefined
                const archiveAvailable = rowDetail?.archive.status === '已入档' ||
                  Boolean(queueItem?.archiveNoteId && queueItem.archiveRegistrationStatus !== 'failed')
                return (
              <div className="favorite-library__row-wrap" data-selected={selected?.aid === row.aid || undefined}>
                <FavoriteLibrarySelectionCheckbox store={selectionStore} aid={row.aid} label={`${text.select} ${row.title}`} />
                <div role="button" tabIndex={0} className="favorite-library__row" onClick={() => {
                  if (selected?.aid === row.aid && detailOpen) setDetailOpen(false)
                  else { setSelected(row); setDetailOpen(true) }
                }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.click() }}>
            <span className="favorite-library__row-title"><strong title={row.title}>{row.title}</strong><small>{row.author ?? text.unknownAuthor}{row.bvid ? ` · ${row.bvid}` : ` · AV${row.aid}`}</small></span>
                  <span className="favorite-library__row-status"><span className="favorite-library__row-status-sync">{formatFavoriteLibraryMirrorStatus(row.pendingStates ?? [], row.libraryStates?.sync)}</span><span className="favorite-library__row-status-local">{row.libraryStates?.protection === 'protected' ? '已保护' : '未保护'} · {formatFavoriteLibraryOrganizationStatus(row.libraryStates?.organization ?? 'unorganized')}</span></span>
                  <span className="favorite-library__row-transcription" onClick={(event) => event.stopPropagation()}><button type="button" disabled={transcriptionCommand === 'cancel-requested' || transcriptionCommand === 'cancel-summary-requested' || transcriptionCommand === 'enqueue' && transcription.disabled} onClick={() => void runAction(async () => {
                    const api = window.bilimiDesktop
                    if (!accountMid) throw new Error(text.unavailable)
                    if (transcriptionCommand === 'cancel-waiting') {
                      if (!api?.cancelFavoriteLibraryWaitingTranscription) throw new Error(text.unavailable)
                      return api.cancelFavoriteLibraryWaitingTranscription(accountMid, row.cid === undefined
                        ? { aids: [row.aid] }
                        : { targets: [{ aid: row.aid, cid: row.cid }] })
                    }
                    if (transcriptionCommand === 'cancel-summary') {
                      if (!queueItem || !api?.cancelVideoAudioTranscriptionSummary) throw new Error(text.unavailable)
                      return api.cancelVideoAudioTranscriptionSummary(queueItem.id)
                    }
                    if (transcriptionCommand === 'cancel-running') {
                      if (!queueItem || !api?.cancelVideoAudioTranscription) throw new Error(text.unavailable)
                      return api.cancelVideoAudioTranscription(queueItem.id)
                    }
                    if (transcriptionCommand === 'retry') {
                      if (!queueItem || !api?.retryVideoAudioTranscription) throw new Error(text.unavailable)
                      return api.retryVideoAudioTranscription(queueItem.id)
                    }
                    if (transcriptionCommand === 'retry-archive-registration') {
                      if (!queueItem || !api?.retryVideoAudioArchiveRegistration) throw new Error(text.unavailable)
                      return api.retryVideoAudioArchiveRegistration(queueItem.id)
                    }
                    if (!api?.enqueueFavoriteLibraryTranscription) throw new Error(text.unavailable)
                    return api.enqueueFavoriteLibraryTranscription(accountMid, row.cid === undefined
                      ? { aids: [row.aid] }
                      : { targets: [{ aid: row.aid, cid: row.cid }] })
                  })}>{transcriptionLabel}</button><button type="button" disabled={!archiveAvailable} onClick={() => void runDetailAction(() => openRowArchiveDetail(row, queueItem?.cid ?? rowDetail?.video.cid))}>档案详情</button></span>
                  <span className="favorite-library__row-source" title={`当前归属：${sourceLabel} · 分类：${adjustmentLabel}${adjustmentTime ? ` · ${adjustmentTime}` : ''}`}><span className="favorite-library__row-source-line">当前归属：{sourceLabel}</span><span className="favorite-library__row-source-line">分类：{adjustmentLabel}</span></span>
                </div>
              </div>
                )
              })()
            )}
          />
          </div>
        </section>
        <FavoriteLibraryDetail
          selected={Boolean(detail)}
          collapsed={Boolean(detail && !detailOpen)}
          onCollapse={() => setDetailOpen(false)}
          title={detail?.title}
          onTitleClick={accountMid && detail ? () => { void runDetailAction(async () => {
            const api = window.bilimiDesktop as typeof window.bilimiDesktop & FavoriteLibraryDesktopExtensions
            if (!api.openFavoriteLibraryVideo) throw new Error(text.unavailable)
            await api.openFavoriteLibraryVideo(accountMid, detail.aid)
          }) } : undefined}
          author={detail?.author ?? text.unknownAuthor}
          videoId={undefined}
          moreInformation={detail ? detailSnapshot?.video.aid !== detail.aid
            ? detailLoadFailedAid === detail.aid ? { status: 'failed' } : { status: 'loading' }
            : detailSnapshot?.video.description || detailSnapshot?.video.tags?.length
              ? { description: detailSnapshot.video.description, tags: detailSnapshot.video.tags.length ? detailSnapshot.video.tags : detail.tags }
              : { status: 'missing' }
            : undefined}
          headerActions={accountMid && detail ? <><button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(refreshMetadata)}>刷新信息</button>{!isRecycleScope ? <button type="button" className="favorite-library__inline-action" onClick={() => openAssistantWorkspace({ tab: 'ledger', organizeOldFavorites: true, selectedFavoriteAids: [detail.aid] })}>重新整理</button> : null}</> : null}
        >
          {detail ? <>
            {(() => {
              const statusTone = (value: string): 'success' | 'warning' | 'danger' | 'neutral' => {
                if (value.includes('失败') || value.includes('已失效')) return 'danger'
                if (value.includes('待确认') || value.includes('未同步') || value.includes('未保护') || value.includes('未整理') || value.includes('等待回读') || value.includes('不一致')) return 'warning'
                if (value.includes('已同步') || value.includes('已保护') || value.includes('已整理')) return 'success'
                return 'neutral'
              }
              const unavailableExplanation = detailSnapshot?.mirror.errorCode === 'unavailable'
                ? `B 站已明确返回该视频不可见${detailSnapshot.mirror.remoteCode !== undefined ? `（返回码 ${detailSnapshot.mirror.remoteCode}）` : ''}。最后检测时间 ${formatDetailTimestamp(detailSnapshot.mirror.lastCheckedAt)}；本地已保存的标题、标签、档案、备注和收藏归属会继续保留，点击刷新信息可重新检测。`
                : null
              const syncExplanation = '同步状态只显示已同步或未同步；失败、未知和归属不一致均为未同步。'
              const chips = [
                { label: '同步状态说明', value: detailSyncState
                  ? formatFavoriteLibraryMirrorStatus(detailSnapshot?.pendingStates ?? detail.pendingStates ?? [], detailSyncState)
                  : formatFavoriteLibraryPositionSyncStatus(detailSnapshot?.position?.state), explanation: syncExplanation },
                { label: '保护状态说明', value: detailSnapshot?.protected ? '已保护' : '未保护', explanation: '保护只决定下一次增量整理是否跳过该视频，不会隐藏位置差异或同步错误。' },
                { label: '整理状态说明', value: formatFavoriteLibraryOrganizationStatus(detailSnapshot?.libraryStates?.organization ?? detail.libraryStates?.organization ?? 'unorganized'), explanation: '整理状态与保护及远程位置状态相互独立。' },
                ...(unavailableExplanation ? [{ label: '失效状态说明', value: '已失效', explanation: unavailableExplanation }] : [])
              ]
              const displayedStatusExplanation = statusExplanation ?? unavailableExplanation
              return <section className="favorite-library__status-tags" aria-label="视频状态"><h3>状态</h3><div className="favorite-library__status-row">{chips.map((chip) => <button key={chip.label} type="button" aria-label={chip.label} aria-pressed={statusExplanation === chip.explanation} data-tone={statusTone(chip.value)} onClick={() => setStatusExplanation(chip.explanation)}>{chip.value}</button>)}</div>{displayedStatusExplanation ? <p role="status">{displayedStatusExplanation}</p> : null}</section>
            })()}
            {isRecycleScope ? <section className="favorite-library__detail-danger"><h3>回收站操作</h3><p>这里保留已无实际收藏夹来源的视频及其本地信息；清除只影响收藏库，不会删除札记、转写或档案。</p><div className="favorite-library__detail-action-row"><button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(restoreRecycledVideo)}>恢复到收藏库</button><button type="button" className="favorite-library__inline-action favorite-library__danger-action" onClick={() => void runDetailAction(clearRecycledVideo)}>彻底清除本地记录</button></div></section> : null}
            {!isRecycleScope ? <section><h3>收藏归属</h3><div className="favorite-library__detail-action-row"><FavoriteLibraryDestinationButton action="copy" logicalFolders={workspaceDestinationOptions} onConfirm={(folderIds) => void runAction(async () => {
              const api = window.bilimiDesktop
              if (!accountMid || !summary || !selected || !api?.copyFavoriteLibrarySelection) throw new Error(text.unavailable)
              return api.copyFavoriteLibrarySelection(accountMid, [selected.aid], folderIds, summary.revision, operationSource([selected.aid]))
            })} />{!detailIsOrdinarySource ? <>{currentLogicalFolderId || resolvedOperationSource.sourceScopeKind === 'unmatched' ? <FavoriteLibraryDestinationButton action="move" logicalFolders={workspaceDestinationOptions} onConfirm={(folderIds) => void runAction(async () => {
              const api = window.bilimiDesktop
              const sourceFolderId = currentLogicalFolderId ?? (resolvedOperationSource.sourceScopeKind === 'unmatched' ? 'local:inbox' : undefined)
              if (!accountMid || !summary || !selected || !sourceFolderId || !api?.moveFavoriteLibrarySelection) throw new Error(text.unavailable)
              return api.moveFavoriteLibrarySelection(accountMid, [selected.aid], sourceFolderId, folderIds, summary.revision, operationSource([selected.aid]))
            })} /> : null}<button type="button" className="favorite-library__inline-action" onClick={() => void runAction(async () => {
              const api = window.bilimiDesktop
              if (!accountMid || !selected || !api?.synchronizeFavoriteLibraryPlacements) throw new Error(text.unavailable)
              return api.synchronizeFavoriteLibraryPlacements(accountMid, { kind: 'aids', aids: [selected.aid] })
            })}>同步到B站</button>{detailSnapshot?.position?.state === 'local-only-change' && detailSnapshot.position.remoteObservedPhysicalFolderIds.length ? <button type="button" className="favorite-library__inline-action" aria-expanded={placementConflictChoiceOpen} onClick={() => setPlacementConflictChoiceOpen((open) => !open)}>处理归属冲突</button> : null}</> : null}</div>{placementConflictChoiceOpen ? <div className="favorite-library__detail-action-row" aria-label="归属冲突选择"><button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(async () => {
              await setLocalPlacement(detailSnapshot?.position?.localDesiredFolderIds ?? [], true)
              setPlacementConflictChoiceOpen(false)
            })}>以收藏库为准并同步</button><button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(async () => {
              await adoptRemotePlacement()
              setPlacementConflictChoiceOpen(false)
            })}>采用B站归属</button></div> : null}{placementPickerOpen ? renderPlacementPicker() : null}<p>收藏库归属：{detailLocalPositions.length ? detailLocalPositions.join('、') : FAVORITE_LIBRARY_STAGING_TITLE}</p><p>B站收藏夹：{detailRemoteOwnership}</p><p>归属状态：{formatFavoriteLibraryPositionStatus(detailSnapshot?.position?.state, Boolean(detailSnapshot?.position?.remoteObservedPhysicalFolderIds.length))}</p></section> : null}
            <section><h3>音频与档案</h3><div className="favorite-library__detail-action-row"><VideoSummaryMenu actions={[{ id: 'transcribe', label: '转写音频', disabled: !detailCanStartTranscription, onSelect: () => runDetailTranscriptionAction('start') }, { id: 'cancel-transcribe', label: '取消转写', disabled: !detailCanCancelTranscription, onSelect: () => runDetailTranscriptionAction('cancel') }]} download={{ disabled: detailSnapshot?.archive.status !== '已入档' || detailSnapshot.transcription.status !== '转写完成', onSelect: openDetailDocumentExport }} /><button type="button" aria-label="查看档案详情" className="favorite-library__inline-action" disabled={detailSnapshot?.archive.status !== '已入档' || detailSnapshot.transcription.status !== '转写完成'} onClick={() => void runDetailAction(openArchiveDetail)}>笔记档案详情</button></div><p>{text.transcriptionState}：{detailSnapshot?.transcription.status ?? (detail.pendingStates.includes('continuation') ? '等待处理' : '暂无转写任务')}</p><p>{text.archive}：{detailSnapshot?.archive.status ?? text.noArchive}{detailSnapshot?.archive.versionCount ? ` · ${detailSnapshot.archive.versionCount} 个版本` : ''}</p></section>
            <section className="favorite-library__classification-history"><h3>初始来源</h3><p>{formatFavoriteLibraryInitialSource(detailSnapshot?.video.initialSource ?? detail.initialSource)}</p>{(() => {
              const latest = detailSnapshot?.latestClassificationAdjustment
              return <><h3>最近调整</h3>{latest ? <><p>分类时间：{formatDetailTimestamp(latest.occurredAt)}</p><p>分类方式：{classificationAdjustmentLabel(latest)}</p><p>分类详情：{classificationAdjustmentDetail(latest)}</p></> : <p>未记录</p>}</>
            })()}<button type="button" className="favorite-library__inline-action" aria-expanded={classificationAdjustmentsOpen} onClick={toggleClassificationAdjustments}>{classificationAdjustmentsOpen ? '收起完整记录' : '查看完整记录'}</button>{classificationAdjustmentsOpen ? <ol className="favorite-library__classification-adjustment-list" aria-label="完整分类调整记录">{classificationAdjustments?.map((adjustment, index, items) => <li key={adjustment.id}><h3>{index === items.length - 1 && !classificationAdjustmentCursor ? '首次分类' : `第 ${(classificationAdjustmentTotalCount ?? items.length) - index} 次调整`}</h3><p>分类时间：{formatDetailTimestamp(adjustment.occurredAt)}</p><p>分类方式：{classificationAdjustmentLabel(adjustment)}</p><p>分类详情：{classificationAdjustmentDetail(adjustment)}</p></li>)}</ol> : null}
              {classificationAdjustmentsOpen && classificationAdjustmentCursor ? <button type="button" className="favorite-library__inline-action" onClick={() => void loadMoreClassificationAdjustments()}>加载更早记录</button> : null}
            </section>
            {!isRecycleScope ? <section className="favorite-library__detail-danger"><h3>其他操作</h3><button type="button" className="favorite-library__inline-action favorite-library__danger-toggle" aria-label="其他操作" aria-expanded={detailDangerOpen} onClick={() => setDetailDangerOpen((open) => !open)}>{detailDangerOpen ? '收起' : '展开'}</button>{detailDangerOpen ? <>{detailLocalDeletionAvailable ? <><button type="button" className="favorite-library__inline-action favorite-library__danger-action" onClick={() => { setDeleteOtherWorkFolders(false); setDeleteConfirmationOpen(true) }}>从收藏库 bilimi 收藏夹删除</button>{deleteConfirmationOpen ? <FavoriteLibraryConfirmationDialog label="确认从收藏库 bilimi 收藏夹删除" onClose={() => { setDeleteOtherWorkFolders(false); setDeleteConfirmationOpen(false) }}>{currentLogicalFolderId ? <>{(() => {
              const otherFolderIds = (detailSnapshot?.position?.localDesiredFolderIds ?? []).filter((folderId) => folderId !== currentLogicalFolderId)
              return <><p>只会从当前工作夹“{detailFolderName(currentLogicalFolderId)}”移除；转写、档案、保护和处理记录会保留。</p>{otherFolderIds.length ? <><label><input type="checkbox" aria-label="同时从其他 bilimi 工作夹移除" checked={deleteOtherWorkFolders} onChange={(event) => setDeleteOtherWorkFolders(event.currentTarget.checked)} />同时从其他 bilimi 工作夹移除</label>{deleteOtherWorkFolders ? <p>还会从 {otherFolderIds.length} 个工作夹移除：{otherFolderIds.map(detailFolderName).join('、')}</p> : null}</> : null}{detailOrdinarySourceNames.length ? <p>普通 B 站收藏夹仍保留：{detailOrdinarySourceNames.join('、')}</p> : deleteOtherWorkFolders ? <p role="alert">该视频没有其他普通 B 站收藏夹来源；从全部 bilimi 工作夹移除后仍可从回收站恢复。</p> : null}</>
            })()}</> : <><p>将按该视频已记录的 bilimi 工作夹归属处理；普通 B 站收藏夹不会修改，转写、档案、保护和处理记录会保留。</p>{workspaceDestinationOptions.length > 1 ? <label><input type="checkbox" aria-label="同时从其他 bilimi 工作夹移除" checked={deleteOtherWorkFolders} onChange={(event) => setDeleteOtherWorkFolders(event.currentTarget.checked)} />同时从其他 bilimi 工作夹移除</label> : null}{deleteOtherWorkFolders ? <p>还会从该视频已记录的其他 bilimi 工作夹移除。</p> : null}{detailOrdinarySourceNames.length ? <p>普通 B 站收藏夹仍保留：{detailOrdinarySourceNames.join('、')}</p> : null}</>}<div className="favorite-library__dialog-actions"><button type="button" className="favorite-library__inline-action" onClick={() => { setDeleteOtherWorkFolders(false); setDeleteConfirmationOpen(false) }}>取消</button><button type="button" className="favorite-library__inline-action favorite-library__danger-action" onClick={() => void runDetailAction(deleteFromLibrary, true)}>确认从收藏库 bilimi 收藏夹删除</button></div></FavoriteLibraryConfirmationDialog> : null}</> : null}{(() => {
              const desiredLogicalFolderIds = (detailSnapshot?.position?.localDesiredFolderIds ?? []).filter((folderId) => folderId.startsWith('bilimi-logical:'))
              const otherLogicalFolderIds = desiredLogicalFolderIds.filter((folderId) => folderId !== currentLogicalFolderId)
              return detailRemoteDeletionVisible ? <>
                <button type="button" className="favorite-library__inline-action favorite-library__danger-action" disabled={remoteUnfavoritePreparing || remoteUnfavoriteExecuting || Boolean(remoteUnfavoritePreview)} onClick={openRemoteUnfavoriteDialog}>{remoteUnfavoritePreparing ? '正在准备确认…' : remoteUnfavoriteExecuting ? '正在删除 B 站 bilimi 收藏夹…' : '从 B 站 bilimi 收藏夹删除'}</button>
                {remoteUnfavoriteDialog === 'choice' ? <FavoriteLibraryConfirmationDialog label="确认从 B 站 bilimi 收藏夹删除" busy={remoteUnfavoritePreparing} onClose={closeRemoteUnfavoriteDialog}>
                  <p>{currentLogicalFolderId ? `只删除当前工作夹“${detailFolderName(currentLogicalFolderId)}”已同步的 B 站 bilimi 收藏夹归属；不会修改普通 B 站收藏夹。` : '只删除该视频已记录的 B 站 bilimi 收藏夹归属；不会修改普通 B 站收藏夹。'}</p>
                  {(currentLogicalFolderId ? otherLogicalFolderIds.length > 0 : workspaceDestinationOptions.length > 1) ? <label><input type="checkbox" aria-label="同时从其他 bilimi 工作夹移除" checked={removeManagedOtherFolders} onChange={(event) => setRemoveManagedOtherFolders(event.currentTarget.checked)} />同时从其他 bilimi 工作夹移除</label> : null}
                  {removeManagedOtherFolders ? <p>{currentLogicalFolderId ? `还会从 ${otherLogicalFolderIds.length} 个其他 bilimi 工作夹移除。` : '还会从该视频已记录的其他 bilimi 工作夹移除。'}</p> : null}
                  <div className="favorite-library__dialog-actions"><button type="button" disabled={remoteUnfavoritePreparing} onClick={closeRemoteUnfavoriteDialog}>取消</button><button type="button" className="favorite-library__dialog-remote-action" disabled={remoteUnfavoritePreparing} onClick={() => void beginRemoteUnfavorite()}>{remoteUnfavoritePreparing ? '正在核验…' : '继续'}</button></div>
                </FavoriteLibraryConfirmationDialog> : null}
                {remoteUnfavoriteDialog === 'missing-target' ? <FavoriteLibraryConfirmationDialog label="确认从 B 站 bilimi 收藏夹删除" onClose={closeRemoteUnfavoriteDialog}>
                  <p>当前没有实际 B 站 bilimi 收藏夹，无法执行删除。</p>
                  <div className="favorite-library__dialog-actions"><button type="button" onClick={closeRemoteUnfavoriteDialog}>关闭</button></div>
                </FavoriteLibraryConfirmationDialog> : null}
                {remoteUnfavoriteDialog === 'unverified' ? <FavoriteLibraryConfirmationDialog label="确认从 B 站 bilimi 收藏夹删除" onClose={closeRemoteUnfavoriteDialog}>
                  <p>暂时无法核验 B 站收藏夹，请稍后重试。</p>
                  <div className="favorite-library__dialog-actions"><button type="button" onClick={closeRemoteUnfavoriteDialog}>关闭</button></div>
                </FavoriteLibraryConfirmationDialog> : null}
                {remoteUnfavoritePreview ? <FavoriteLibraryConfirmationDialog label="确认从 B 站 bilimi 收藏夹删除" busy={remoteUnfavoriteExecuting} onClose={closeRemoteUnfavoriteDialog}>
                  <p>将从 B 站 bilimi 收藏夹删除“{detail?.title ?? remoteUnfavoritePreview.aids.join('、')}”的归属：{remoteUnfavoritePreview.affectedLogicalFolders.map((folder) => folder.title).join('、') || '所选 bilimi 工作夹'}。</p>
                  {remoteUnfavoritePreview.skippedUnmatchedAids.length ? <p role="alert">未找到 bilimi 收藏夹归属，已跳过 {remoteUnfavoritePreview.skippedUnmatchedAids.length} 个视频。</p> : null}
                  {remoteUnfavoritePreview.preservedOrdinarySources.length ? <p>普通 B 站收藏夹仍保留：{remoteUnfavoritePreview.preservedOrdinarySources.map((folder) => folder.title).join('、')}</p> : null}
                  {remoteUnfavoritePreview.recycleAids.length ? <p role="alert">该视频没有其他普通 B 站收藏夹来源；远端确认移除后会进入回收站，本地标题、标签、转写、档案和历史仍保留。</p> : null}
                  <p>网络中断时不会自动重试；如未成功，请稍后重试。</p>
                  <div className="favorite-library__dialog-actions"><button type="button" disabled={remoteUnfavoriteExecuting} onClick={() => setRemoteUnfavoritePreview(undefined)}>取消</button><button type="button" className="favorite-library__dialog-remote-action" disabled={remoteUnfavoriteExecuting} onClick={() => void confirmRemoteUnfavorite()}>确认删除 B 站 bilimi 归属</button></div>
                </FavoriteLibraryConfirmationDialog> : null}
              </> : null
              })()}</> : null}</section> : null}
            </> : null}
        </FavoriteLibraryDetail>
        <FavoriteLibraryFooter
        hasPreviousPage={pageNumber > 1}
        hasNextPage={pageNumber < (page?.pageCount ?? (page?.nextCursor ? pageNumber + 1 : pageNumber))}
        pageNumber={page?.page ?? pageNumber}
        pageSize={pageSize}
        visibleCount={rows.length}
        totalCount={displayedTotal}
      onFirstPage={() => {
          if (!accountMid || pageNumber === 1) return
          void load(accountMid, scope, 1, pageSize, pageOptions).then((applied) => {
          if (!applied) return
          setPageNumber(1)
          setListScrollTop(0)
            })
          }}
        onPreviousPage={() => {
          if (!accountMid || pageNumber === 1) return
          const previousPage = pageNumber - 1
          void load(accountMid, scope, previousPage, pageSize, pageOptions).then((applied) => {
          if (!applied) return
          setPageNumber(previousPage)
          setListScrollTop(0)
          })
        }}
        onNextPage={() => {
          const nextPage = pageNumber + 1
          if (accountMid && (page?.pageCount === undefined ? page?.nextCursor : nextPage <= page.pageCount)) {
            void load(accountMid, scope, nextPage, pageSize, pageOptions).then((applied) => {
          if (!applied) return
          setPageNumber(nextPage)
          setListScrollTop(0)
            })
          }
        }}
        onLastPage={() => {
          const lastPage = page?.pageCount
          if (accountMid && lastPage && pageNumber !== lastPage) {
            void load(accountMid, scope, lastPage, pageSize, pageOptions).then((applied) => {
          if (!applied) return
          setPageNumber(lastPage)
          setListScrollTop(0)
            })
          }
        }}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize)
          setPageNumber(1)
          setListScrollTop(0)
          if (accountMid) void load(accountMid, scope, 1, nextPageSize, pageOptions)
        }}
        />
      </div>
      {accountMid && documentExport?.accountMid === accountMid ? <VideoNoteBatchExportDialog
        open
        accountMid={accountMid}
        selections={documentExport.selections}
        initialSkippedCount={documentExport.skippedAids.length}
        initialFormats={documentExport.initialFormats}
        onClose={() => setDocumentExport(undefined)}
        preview={(request) => window.bilimiDesktop.previewVideoNoteArchiveBatch?.(request) ?? Promise.resolve({ selectedCount: request.selections.length, exportableCount: 0, skippedCount: request.selections.length })}
        start={(request) => window.bilimiDesktop.startVideoNoteArchiveBatch?.(request) as Promise<{ folderPath?: string; succeededCount: number; skippedCount: number; failedCount: number }>}
        cancel={(input) => window.bilimiDesktop.cancelVideoNoteArchiveBatch?.(input) ?? Promise.resolve(false)}
        openFolder={(input) => window.bilimiDesktop.openVideoNoteArchiveBatchFolder?.(input) ?? Promise.resolve(undefined)}
        onProgress={(callback) => window.bilimiDesktop.onVideoNoteArchiveBatchProgress?.(callback) ?? (() => undefined)}
      /> : null}
    </main>
  )
}

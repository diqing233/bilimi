import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FavoriteRepositoryFolder } from '@shared/favoriteRepository'
import type {
  FavoriteRepositoryLibraryPage,
  FavoriteRepositoryLibraryVideoDetail,
  FavoriteRepositorySnapshotSummary,
  FavoriteRepositoryEventPage,
  FavoriteRepositoryArchiveRestorePreview
} from '../../../../../electron/main/favoriteRepositoryIpc'
import type {
  FavoriteRepositoryArchiveImportPreview,
  FavoriteRepositoryRestoreExecutionResult,
  FavoriteRepositoryRestorePlan
} from '../../../../../electron/main/favoriteRepositoryArchiveService'
import { VirtualFavoriteLibraryList } from './VirtualFavoriteLibraryList'
import { FavoriteLibraryHeader } from './FavoriteLibraryHeader'
import { FavoriteLibraryNavigation, type FavoriteLibraryNavigationGroup } from './FavoriteLibraryNavigation'
import { FavoriteLibraryToolbar } from './FavoriteLibraryToolbar'
import { FavoriteLibraryDetail } from './FavoriteLibraryDetail'
import { FavoriteLibraryDialogs } from './FavoriteLibraryDialogs'
import {
  buildFavoriteLibraryDetail,
  buildFavoriteLibraryNavigation,
  formatFavoriteLibraryMetadataStatus,
  formatFavoriteLibraryMirrorStatus,
  formatFavoriteLibraryOrganizationStatus,
  formatFavoriteLibraryPositionStatus,
  type FavoriteLibraryRow
} from './favoriteLibraryModel'
import './FavoriteLibraryApp.css'

type LibraryScope = { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' } | { kind: 'protected' } | { kind: 'unsynced' }

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
  syncFolder: '\u5237\u65b0\u5f53\u524d\u5206\u7c7b',
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
  actionFailed: '\u6536\u85cf\u5e93\u64cd\u4f5c\u5931\u8d25\u3002'
  , organizationHistory: '\u6574\u7406\u8bb0\u5f55', noOrganizationHistory: '\u6682\u65e0\u6574\u7406\u8bb0\u5f55\u3002',
  conflicts: '\u68c0\u6d4b\u5230\u53ef\u80fd\u51b2\u7a81\uff0c\u8bf7\u6838\u5bf9\u540e\u624b\u52a8\u5904\u7406\u3002'
} as const

function pageRows(page: FavoriteRepositoryLibraryPage): FavoriteLibraryRow[] {
  return page.items.map((item) => ({ ...item.video, folderIds: [...item.folderIds], pendingStates: [...item.pendingStates] }))
}

function pendingCount(summary: FavoriteRepositorySnapshotSummary) {
  return summary.pendingAidCount ?? (summary.syncCounts.pending + summary.syncCounts.failed + summary.syncCounts['result-unknown'] +
    (summary.workspace?.continuationCount ?? 0))
}

function scopeForNavigation(id: string): LibraryScope {
  if (id === 'pending') return { kind: 'pending' }
  if (id === 'protected') return { kind: 'protected' }
  if (id === 'unsynced') return { kind: 'unsynced' }
  if (id.startsWith('folder:')) return { kind: 'folder', folderId: id.slice('folder:'.length) }
  return { kind: 'all' }
}

type FavoriteLibraryAccount = { mid: string; nickname?: string }

export type FavoriteLibraryUiCallbacks = {
  onBatchAction?: (action: 'copy' | 'move' | 'refresh' | 'transcribe' | 'sync' | 'delete-local' | 'unfavorite-remote', aids: number[]) => void
  onManagedFolderAction?: (folderId: string, action: 'edit' | 'delete') => void
  onManagedFolderDeleteChoice?: (folderId: string, choice: 'local' | 'remote') => void
}

/** Reads account-scoped repository pages; it owns only visible UI selection. */
export function FavoriteLibraryApp({
  embedded = false,
  onAccountChange,
  uiCallbacks
}: {
  embedded?: boolean
  onAccountChange?: (account: FavoriteLibraryAccount | undefined) => void
  uiCallbacks?: FavoriteLibraryUiCallbacks
}) {
  const [accountMid, setAccountMid] = useState<string>()
  const [accountNickname, setAccountNickname] = useState<string>()
  const [summary, setSummary] = useState<FavoriteRepositorySnapshotSummary>()
  const [scopeId, setScopeId] = useState('all')
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(50)
  const [page, setPage] = useState<FavoriteRepositoryLibraryPage>()
  const [selected, setSelected] = useState<FavoriteLibraryRow>()
  const [detailSnapshot, setDetailSnapshot] = useState<FavoriteRepositoryLibraryVideoDetail>()
  const [memoDraft, setMemoDraft] = useState('')
  const [detailOpen, setDetailOpen] = useState(true)
  const [error, setError] = useState<string>()
  const [selectedAids, setSelectedAids] = useState<number[]>([])
  const [events, setEvents] = useState<FavoriteRepositoryEventPage>()
  const [eventsOpen, setEventsOpen] = useState(false)
  const [placementPickerOpen, setPlacementPickerOpen] = useState(false)
  const [placementPickerBatch, setPlacementPickerBatch] = useState(false)
  const [placementPickerMode, setPlacementPickerMode] = useState<'replace' | 'copy' | 'move'>('replace')
  const [placementPickerAids, setPlacementPickerAids] = useState<number[]>([])
  const [placementDraftFolderIds, setPlacementDraftFolderIds] = useState<string[]>([])
  const [placementSyncRequested, setPlacementSyncRequested] = useState(false)
  const [placementSaving, setPlacementSaving] = useState(false)
  const [statusExplanation, setStatusExplanation] = useState<string>()
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const [remoteUnfavoritePreview, setRemoteUnfavoritePreview] = useState<{ aids: number[]; executionToken: string }>()
  const [remoteUnfavoritePreparing, setRemoteUnfavoritePreparing] = useState(false)
  const [remoteUnfavoriteExecuting, setRemoteUnfavoriteExecuting] = useState(false)
  const [archivePanelOpen, setArchivePanelOpen] = useState(false)
  const [archiveText, setArchiveText] = useState('')
  const [archiveImportPreview, setArchiveImportPreview] = useState<FavoriteRepositoryArchiveImportPreview>()
  const [archiveRestorePreview, setArchiveRestorePreview] = useState<FavoriteRepositoryArchiveRestorePreview>()
  const [archiveRestoreExecution, setArchiveRestoreExecution] = useState<FavoriteRepositoryRestoreExecutionResult>()
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveRestoreScope, setArchiveRestoreScope] = useState<'all' | 'selected' | 'current-folder'>('all')
  const [managedFolderDialog, setManagedFolderDialog] = useState<{
    id: string
    title: string
    preview: {
      executionToken: string
      currentRevision: number
      localMemberCount: number
      unmatchedFallbackCount: number
      extraRemoteMemberCount: number
      remoteOnlyMemberCount: number
    }
  }>()
  const [batchRemoteUnfavoritePreview, setBatchRemoteUnfavoritePreview] = useState<{
    aids: number[]
    executionToken: string
    baselineRevision?: number
  }>()
  const [remoteReconciliation, setRemoteReconciliation] = useState<{
    kind: 'unfavorite' | 'managed-folder'
    operationId: string
  }>()
  const requestIdRef = useRef(0)

  useEffect(() => {
    onAccountChange?.(accountMid ? { mid: accountMid, nickname: accountNickname } : undefined)
  }, [accountMid, accountNickname, onAccountChange])

  const scope = useMemo(() => scopeForNavigation(scopeId), [scopeId])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const load = useCallback(async (mid: string, nextScope: LibraryScope, cursor?: string, limit = pageSize) => {
    const requestId = ++requestIdRef.current
    const api = window.bilimiDesktop
    if (!api?.getFavoriteRepositoryLibraryPage) throw new Error(text.unavailable)
    const next = await api.getFavoriteRepositoryLibraryPage(mid, nextScope, {
      limit,
      ...(cursor ? { cursor } : {})
    })
    if (requestId === requestIdRef.current) {
      setPage(next)
      setSelected(undefined)
    }
  }, [pageSize])

  const refresh = useCallback(async (expectedAccountMid?: string) => {
    const refreshId = ++requestIdRef.current
    const api = window.bilimiDesktop
    try {
      const extendedApi = api as (typeof api & FavoriteLibraryDesktopExtensions) | undefined
      const account = await extendedApi?.readBilibiliAccount?.()
      const mid = (account?.mid ?? await api?.readBilibiliAccountMid?.())?.trim()
      if (!mid) {
        if (refreshId !== requestIdRef.current) return
        setAccountMid(undefined)
        setAccountNickname(undefined)
        setSummary(undefined)
        setPage(undefined)
        setSelected(undefined)
        setSelectedAids([])
        setError(text.signIn)
        return
      }
      if (!api?.openFavoriteRepositoryAccount) throw new Error(text.signIn)
      if (refreshId !== requestIdRef.current) return
      if (mid !== expectedAccountMid) {
        setAccountMid(mid)
        setAccountNickname(account?.nickname?.trim() || undefined)
        setSummary(undefined)
        setPage(undefined)
      setSelected(undefined)
      setSelectedAids([])
      }
      if (mid === expectedAccountMid) setAccountNickname(account?.nickname?.trim() || undefined)
      const nextSummary = await api.openFavoriteRepositoryAccount(mid)
      if (refreshId !== requestIdRef.current) return
      setSummary(nextSummary)
      await load(mid, mid === expectedAccountMid ? scopeRef.current : { kind: 'all' })
    } catch {
      if (refreshId === requestIdRef.current) setError(text.cannotRead)
    }
  }, [load])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => window.bilimiDesktop?.onBilibiliAccountChanged?.(() => {
    setAccountMid(undefined)
    setAccountNickname(undefined)
    setSummary(undefined)
    setPage(undefined)
    setSelected(undefined)
    setSelectedAids([])
    void refresh(accountMid)
  }), [accountMid, refresh])

  useEffect(() => window.bilimiDesktop?.onFavoriteLibraryTranscriptionChanged?.(() => {
    if (accountMid) void refresh(accountMid)
  }), [accountMid, refresh])

  useEffect(() => {
    if (!accountMid || !window.bilimiDesktop?.subscribeFavoriteRepository) return
    return window.bilimiDesktop.subscribeFavoriteRepository(
      accountMid,
      scope.kind === 'folder' ? scope.folderId : undefined,
      () => void refresh(accountMid)
    )
  }, [accountMid, refresh, scope])

  useEffect(() => {
    let disposed = false
    setDetailSnapshot(undefined)
    setEvents(undefined)
    setEventsOpen(false)
    if (!accountMid || !selected || !window.bilimiDesktop?.getFavoriteRepositoryLibraryVideoDetail) return
    void window.bilimiDesktop.getFavoriteRepositoryLibraryVideoDetail(accountMid, selected.aid)
      .then((snapshot) => { if (!disposed) setDetailSnapshot(snapshot) })
      .catch(() => { if (!disposed) setError(text.cannotRead) })
    return () => { disposed = true }
  }, [accountMid, selected])

  useEffect(() => {
    setMemoDraft(detailSnapshot?.archive.memoPreview ?? '')
  }, [detailSnapshot?.video.aid, detailSnapshot?.archive.memoPreview])

  useEffect(() => {
    setStatusExplanation(undefined)
    setPlacementPickerOpen(false)
    setDeleteConfirmationOpen(false)
    setRemoteUnfavoritePreview(undefined)
  }, [selected?.aid])

  const folders = summary?.folders ?? []
  const logicalFolders = useMemo(() => folders
    .filter((folder) => folder.kind === 'bilimi-logical')
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id)), [folders])
  const rows = page ? pageRows(page) : []
  const activeRow = selected && page?.items.find((item) => item.video.aid === selected.aid)
  const detail = selected && activeRow ? buildFavoriteLibraryDetail(
    detailSnapshot?.video.aid === selected.aid
      ? { ...detailSnapshot.video, folderIds: [...detailSnapshot.folderIds], pendingStates: [...detailSnapshot.pendingStates].filter((state) => state !== 'transcription') }
      : selected,
    folders,
    { aid: selected.aid, states: [...(detailSnapshot?.pendingStates ?? activeRow.pendingStates)].filter((state) => state !== 'transcription') }
  ) : undefined
  const navigation = summary ? buildFavoriteLibraryNavigation(folders, pendingCount(summary)) : []
  const navigationGroups = useMemo<FavoriteLibraryNavigationGroup[]>(() => {
    const items = navigation.map((item) => ({
      id: item.id,
      label: item.kind === 'all' ? text.all : item.kind === 'pending' ? text.pending : item.title,
      count: item.kind === 'pending' ? (summary?.scopeCounts?.pending ?? item.count) : item.kind === 'all' ? (summary?.scopeCounts?.all ?? summary?.videoCount ?? 0) : (summary?.folderCounts?.[item.folderId] ?? 0),
      managed: item.kind === 'folder' && item.source === 'bilimi-logical',
      protected: item.kind === 'folder' && /unmatched|inbox/i.test(item.folderId)
    }))
    return [
      { id: 'range', label: '收藏范围', items: [
        ...items.filter((item) => item.id === 'all' || item.id === 'pending'),
        { id: 'protected', label: '已保护', count: summary?.scopeCounts?.protected ?? 0 },
        { id: 'unsynced', label: '未同步', count: summary?.scopeCounts?.unsynced ?? 0 }
      ] },
      { id: 'workspace', label: 'bilimi 工作夹', items: items.filter((item) => item.managed || item.protected) },
      { id: 'bilibili', label: 'B站收藏夹', items: items.filter((item) => item.id.startsWith('folder:') && !item.managed && !item.protected) }
    ]
  }, [navigation, summary?.videoCount])
  const [collapsedNavigationGroups, setCollapsedNavigationGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!accountMid || !window.bilimiDesktop?.getFavoriteLibraryUiPreferences) return
    void window.bilimiDesktop.getFavoriteLibraryUiPreferences(accountMid).then(setCollapsedNavigationGroups).catch(() => undefined)
  }, [accountMid])
  const toggleAid = (aid: number) => setSelectedAids((current) => current.includes(aid)
    ? current.filter((candidate) => candidate !== aid)
    : [...current, aid].sort((left, right) => left - right))
  const allCurrentPageSelected = rows.length > 0 && rows.every((row) => selectedAids.includes(row.aid))
  const toggleCurrentPage = () => setSelectedAids((current) => allCurrentPageSelected
    ? current.filter((aid) => !rows.some((row) => row.aid === aid))
    : [...new Set([...current, ...rows.map((row) => row.aid)])].sort((left, right) => left - right))
  const allSelectedSynced = selectedAids.length > 0 && selectedAids.every((aid) => {
    const row = rows.find((candidate) => candidate.aid === aid)
    return Boolean(row && !(row.pendingStates ?? []).some((state) =>
      state === 'unsynced' || state === 'continuation' || state === 'failed' || state === 'result-unknown'))
  })
  const runAction = async (action: () => Promise<{ runId?: string; status: string }>) => {
    try {
      setError(undefined)
      const result = await action()
      if (accountMid) await refresh(accountMid)
    } catch {
      setError(text.actionFailed)
    }
  }
  const runDetailAction = async (action: () => Promise<void>) => {
    try {
      setError(undefined)
      await action()
      if (accountMid && selected) {
        const snapshot = await window.bilimiDesktop?.getFavoriteRepositoryLibraryVideoDetail?.(accountMid, selected.aid)
        if (snapshot) setDetailSnapshot(snapshot)
      }
    } catch {
      setError(text.actionFailed)
    }
  }
  const loadEvents = async () => {
    if (!accountMid || !selected || !window.bilimiDesktop?.getFavoriteRepositoryVideoEvents) throw new Error(text.unavailable)
    try {
      setError(undefined)
      const next = await window.bilimiDesktop.getFavoriteRepositoryVideoEvents(accountMid, selected.aid, { limit: 20 })
      setEvents(next)
      setEventsOpen(true)
    } catch {
      setError(text.actionFailed)
    }
  }
  const loadMoreEvents = async () => {
    if (!accountMid || !selected || !events?.nextCursor || !window.bilimiDesktop?.getFavoriteRepositoryVideoEvents) return
    try {
      const next = await window.bilimiDesktop.getFavoriteRepositoryVideoEvents(accountMid, selected.aid, { limit: 20, cursor: events.nextCursor })
      setEvents((current) => current ? {
        ...next,
        items: [...current.items, ...next.items.filter((event) => !current.items.some((existing) => existing.id === event.id))]
      } : next)
    } catch {
      setError(text.actionFailed)
    }
  }
  const setLocalPlacement = async (folderIds: string[], synchronize = false) => {
    if (!accountMid || !selected || !detailSnapshot || !window.bilimiDesktop?.setFavoriteLibraryLocalPlacements) {
      throw new Error(text.unavailable)
    }
    await window.bilimiDesktop.setFavoriteLibraryLocalPlacements(
      accountMid, [{ aid: selected.aid, folderIds }], detailSnapshot.revision, synchronize
    )
  }
  const openPlacementPicker = () => {
    setPlacementDraftFolderIds([...(detailSnapshot?.position?.localDesiredFolderIds ?? [])])
    setPlacementPickerBatch(false)
    setPlacementPickerMode('replace')
    setPlacementPickerAids(selected ? [selected.aid] : [])
    setPlacementSyncRequested(false)
    setPlacementPickerOpen(true)
  }
  const openSelectedPlacementPicker = (mode: 'replace' | 'copy' | 'move' = 'replace') => {
    setPlacementDraftFolderIds([])
    setPlacementPickerBatch(true)
    setPlacementPickerMode(mode)
    setPlacementPickerAids([...selectedAids])
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
          if (!accountMid || !summary || !placementPickerAids.length) {
            throw new Error(text.unavailable)
          }
          if (placementPickerMode === 'copy') {
            if (!api?.copyFavoriteLibrarySelection) throw new Error(text.unavailable)
            return api.copyFavoriteLibrarySelection(accountMid, placementPickerAids, placementDraftFolderIds, summary.revision)
          }
          if (placementPickerMode === 'move') {
            if (!currentLogicalFolderId || !api?.moveFavoriteLibrarySelection) throw new Error(text.unavailable)
            return api.moveFavoriteLibrarySelection(accountMid, placementPickerAids, currentLogicalFolderId, placementDraftFolderIds, summary.revision)
          }
          if (!api?.setFavoriteLibraryLocalPlacements) throw new Error(text.unavailable)
          return api.setFavoriteLibraryLocalPlacements(
            accountMid,
            placementPickerAids.map((aid) => ({ aid, folderIds: [...placementDraftFolderIds] })),
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
  const refreshMetadata = async () => {
    if (!accountMid || !selected || !window.bilimiDesktop?.syncFavoriteLibrarySelection) throw new Error(text.unavailable)
    await window.bilimiDesktop.syncFavoriteLibrarySelection(accountMid, { kind: 'aids', aids: [selected.aid] })
  }
  const deleteFromLibrary = async () => {
    if (!accountMid || !selected || !detailSnapshot || !window.bilimiDesktop?.deleteFavoriteLibraryVideo) throw new Error(text.unavailable)
    await window.bilimiDesktop.deleteFavoriteLibraryVideo(accountMid, selected.aid, detailSnapshot.revision)
    setDeleteConfirmationOpen(false)
  }
  const beginRemoteUnfavorite = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !selected || !api?.previewFavoriteLibraryBilibiliUnfavorite) throw new Error(text.unavailable)
    setRemoteUnfavoritePreparing(true)
    try {
      const preview = await api.previewFavoriteLibraryBilibiliUnfavorite(accountMid, [selected.aid])
      setRemoteUnfavoritePreview({ aids: preview.aids, executionToken: preview.executionToken })
    } finally {
      setRemoteUnfavoritePreparing(false)
    }
  }
  const confirmRemoteUnfavorite = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !remoteUnfavoritePreview || !api?.confirmFavoriteLibraryBilibiliUnfavorite || !api?.executeFavoriteLibraryBilibiliUnfavorite) {
      throw new Error(text.unavailable)
    }
    setRemoteUnfavoriteExecuting(true)
    try {
      const confirmation = await api.confirmFavoriteLibraryBilibiliUnfavorite(
        accountMid, remoteUnfavoritePreview.aids, remoteUnfavoritePreview.executionToken
      )
      const result = await api.executeFavoriteLibraryBilibiliUnfavorite(
        accountMid, remoteUnfavoritePreview.aids, remoteUnfavoritePreview.executionToken, confirmation.confirmationToken
      )
      setRemoteUnfavoritePreview(undefined)
      if (result.status === 'result-unknown') {
        setRemoteReconciliation({ kind: 'unfavorite', operationId: remoteUnfavoritePreview.executionToken })
      } else if (result.status === 'failed') {
        setError(`取消 B 站收藏失败${result.reason ? `：${result.reason}` : '，请稍后重试。'}`)
      }
    } finally {
      setRemoteUnfavoriteExecuting(false)
    }
  }
  const confirmBatchRemoteUnfavorite = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !batchRemoteUnfavoritePreview || !api?.confirmFavoriteLibraryRemoteUnfavoriteOperation || !api?.executeFavoriteLibraryRemoteUnfavoriteOperation) {
      throw new Error(text.unavailable)
    }
    const confirmation = await api.confirmFavoriteLibraryRemoteUnfavoriteOperation(accountMid, batchRemoteUnfavoritePreview.executionToken)
    const result = await api.executeFavoriteLibraryRemoteUnfavoriteOperation(
      accountMid, batchRemoteUnfavoritePreview.executionToken, confirmation.confirmationToken
    ) as { status?: string; operationId?: string }
    setBatchRemoteUnfavoritePreview(undefined)
    if (result.status === 'result-unknown') {
      setRemoteReconciliation({ kind: 'unfavorite', operationId: result.operationId ?? batchRemoteUnfavoritePreview.executionToken })
      return
    }
    await refresh(accountMid)
  }
  const reconcileRemoteOperation = async () => {
    const api = window.bilimiDesktop
    if (!accountMid || !remoteReconciliation) throw new Error(text.unavailable)
    if (remoteReconciliation.kind === 'unfavorite') {
      await api?.reconcileFavoriteLibraryRemoteUnfavoriteOperation?.(accountMid, remoteReconciliation.operationId)
    } else {
      await api?.reconcileFavoriteLibraryManagedFolderDelete?.(accountMid, remoteReconciliation.operationId)
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
  const currentLogicalFolderId = currentFolderId && folders.find((folder) => folder.id === currentFolderId)?.kind === 'bilimi-logical'
    ? currentFolderId
    : undefined
  const currentLogicalFolderAids = currentLogicalFolderId
    ? [...new Set(rows.filter((row) => row.folderIds.includes(currentLogicalFolderId)).map((row) => row.aid))].sort((left, right) => left - right)
    : []
  const archiveRestoreAids = archiveRestoreScope === 'selected' ? selectedAids : currentLogicalFolderAids
  const archiveScopeRequiresAids = archiveRestoreScope === 'selected' || archiveRestoreScope === 'current-folder'
  const syncCurrentFolder = currentFolderId && folders.find((folder) => folder.id === currentFolderId)?.kind !== 'bilibili'
  const renderPlacementPicker = () => {
    const titleFor = (folderId: string) => logicalFolders.find((folder) => folder.id === folderId)?.title ?? folderId
    const finalFolderSet = placementDraftFolderIds.length
      ? placementDraftFolderIds.map(titleFor).join('、')
      : '未匹配分类'
    const previous = detailSnapshot?.position?.localDesiredFolderIds ?? []
    const added = placementDraftFolderIds.filter((folderId) => !previous.includes(folderId))
    const removed = previous.filter((folderId) => !placementDraftFolderIds.includes(folderId))
    const retained = previous.filter((folderId) => placementDraftFolderIds.includes(folderId))
    return <div className="favorite-library__placement-picker" aria-label={placementPickerBatch ? '调整所选本地归属' : '调整本地归属'} aria-busy={placementSaving}>
      <p>{placementPickerBatch
        ? placementPickerMode === 'copy'
          ? `将复制 ${placementPickerAids.length} 个所选视频到选中的本地逻辑归属；原有归属会保留。`
          : placementPickerMode === 'move'
            ? `将把 ${placementPickerAids.length} 个所选视频从当前 bilimi 工作夹移到选中的本地逻辑归属；只移除当前工作夹归属。`
            : `将调整 ${placementPickerAids.length} 个所选视频。勾选代表这些视频共同的最终本地逻辑归属；默认只调整本地收藏库。`
        : '勾选代表最终本地逻辑归属；默认只调整本地收藏库。'}</p>
      {logicalFolders.map((folder) => <label key={folder.id}><input type="checkbox" aria-label={folder.title} checked={placementDraftFolderIds.includes(folder.id)} disabled={placementSaving} onChange={() => togglePlacementFolder(folder.id)} />{folder.title}</label>)}
      {placementPickerBatch && placementPickerMode === 'copy'
        ? <div className="favorite-library__placement-preview"><p>新增本地归属：{finalFolderSet}；原有归属保持不变。</p></div>
        : placementPickerBatch && placementPickerMode === 'move'
          ? <div className="favorite-library__placement-preview"><p>移除当前工作夹：{currentLogicalFolderId ? titleFor(currentLogicalFolderId) : '不可用'}；新增：{finalFolderSet}。</p></div>
        : placementPickerBatch
        ? <div className="favorite-library__placement-preview"><p>最终本地归属：{finalFolderSet}</p></div>
        : <div className="favorite-library__placement-preview"><p>新增：{added.length ? added.map(titleFor).join('、') : '无'}</p><p>移除：{removed.length ? removed.map(titleFor).join('、') : '无'}</p><p>保留：{retained.length ? retained.map(titleFor).join('、') : '无'}</p></div>}
      {placementPickerMode === 'replace' ? <label><input type="checkbox" aria-label="同时同步到B站" checked={placementSyncRequested} disabled={placementSaving} onChange={(event) => setPlacementSyncRequested(event.currentTarget.checked)} />同时同步到B站</label> : null}
      <div><button type="button" className="favorite-library__inline-action" disabled={placementSaving} onClick={() => void savePlacement()}>{placementSaving ? '正在保存…' : '保存本地归属'}</button><button type="button" className="favorite-library__inline-action" disabled={placementSaving} onClick={() => setPlacementPickerOpen(false)}>取消</button></div>
    </div>
  }

  return (
    <main className="favorite-library" data-embedded={embedded || undefined} aria-label={text.library}>
      {embedded ? null : <div className="favorite-library__header-spacer" aria-hidden="true" />}
      {!embedded ? (
        <FavoriteLibraryHeader title={text.library} remoteWarning={Boolean(summary?.syncCounts.failed || summary?.syncCounts['result-unknown'])}
          onGoToPending={() => {
            setScopeId('pending')
            setSelectedAids([])
            setSelected(undefined)
            if (accountMid) void load(accountMid, { kind: 'pending' })
          }}
          onMinimize={() => { void window.bilimiDesktop.controlFavoriteLibraryWindow?.('minimize') }}
          onToggleMaximize={() => { void window.bilimiDesktop.controlFavoriteLibraryWindow?.('toggle-maximize') }}>
          <div className="favorite-library__header-account"><h1>{text.library}</h1><p>{accountMid ? `${text.account}${accountNickname ? `${accountNickname}\uff08UID\uff1a${accountMid}\uff09` : `UID\uff1a${accountMid}`}` : text.loadingAccount}</p></div>
          {page ? <small>{page.items.length} {text.currentPage} - {text.version} {page.revision}</small> : null}
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
              <label>恢复范围<select aria-label="恢复范围" value={archiveRestoreScope} disabled={archiveBusy} onChange={(event) => setArchiveRestoreScope(event.currentTarget.value === 'selected' ? 'selected' : event.currentTarget.value === 'current-folder' ? 'current-folder' : 'all')}><option value="all">全部存档视频</option><option value="selected">当前已选视频（{selectedAids.length}）</option><option value="current-folder" disabled={!currentLogicalFolderAids.length}>当前逻辑分类视频（{currentLogicalFolderAids.length}）</option></select></label>
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
      {remoteReconciliation ? <div className="favorite-library__remote-reconciliation" role="status">
        <p>远程结果待确认：请先对账，不能自动重试或再次执行。</p>
        <button type="button" onClick={() => void runDetailAction(reconcileRemoteOperation)}>{remoteReconciliation.kind === 'unfavorite' ? '对账取消收藏结果' : '对账文件夹删除结果'}</button>
      </div> : null}
      {batchRemoteUnfavoritePreview ? <div className="favorite-library__delete-confirmation" role="alertdialog" aria-label="确认批量取消B站收藏">
        <p>将取消 {batchRemoteUnfavoritePreview.aids.length} 个视频在 B 站的全部收藏关系。</p>
        <p>{batchRemoteUnfavoritePreview.baselineRevision === undefined ? '执行前会再次核对远端状态。' : `预览基线版本 ${batchRemoteUnfavoritePreview.baselineRevision}；版本变化将拒绝执行。`}</p>
        <p>本地记录、转写与档案都会保留；网络异常只会进入待对账状态，绝不自动重试。</p>
        <button type="button" className="favorite-library__danger-action" onClick={() => void runDetailAction(confirmBatchRemoteUnfavorite)}>确认取消所选 B 站收藏</button>
        <button type="button" onClick={() => setBatchRemoteUnfavoritePreview(undefined)}>取消</button>
      </div> : null}
      <div className="favorite-library__layout favorite-library__workspace" data-embedded-layout={embedded || undefined} data-footer-split="true">
        <FavoriteLibraryNavigation
          uid={accountMid}
          groups={navigationGroups}
          collapsedGroups={collapsedNavigationGroups}
          selectedId={scopeId}
          onCollapseChange={(uid, groupId, collapsed) => {
            if (!uid) return
            setCollapsedNavigationGroups((current) => {
              const next = { ...current, [groupId]: collapsed }
              void window.bilimiDesktop.saveFavoriteLibraryUiPreferences?.(uid, next)
              return next
            })
          }}
          onSelect={(id) => {
            setScopeId(id)
            setSelectedAids([])
            setSelected(undefined)
            setDetailSnapshot(undefined)
            if (accountMid) void load(accountMid, scopeForNavigation(id))
          }}
          onManagedFolderAction={(id, action) => {
            if (action === 'edit') {
              uiCallbacks?.onManagedFolderAction?.(id, action)
              void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({ tab: 'ledger' })
              return
            }
            const folder = folders.find((candidate) => `folder:${candidate.id}` === id)
            if (!folder || !accountMid) return
            void window.bilimiDesktop?.previewFavoriteLibraryManagedFolderDelete?.(accountMid, folder.id)
              .then((preview) => {
                const value = preview as Partial<{
                  executionToken: string
                  currentRevision: number
                  localMemberCount: number
                  unmatchedFallbackCount: number
                  extraRemoteMemberCount: number
                  remoteOnlyMemberCount: number
                }>
                const currentRevision = value.currentRevision
                if (!value.executionToken || !Number.isSafeInteger(currentRevision)) throw new Error(text.unavailable)
                setManagedFolderDialog({
                  id,
                  title: folder.title,
                  preview: {
                    executionToken: value.executionToken,
                    currentRevision,
                    localMemberCount: value.localMemberCount ?? 0,
                    unmatchedFallbackCount: value.unmatchedFallbackCount ?? 0,
                    extraRemoteMemberCount: value.extraRemoteMemberCount ?? 0,
                    remoteOnlyMemberCount: value.remoteOnlyMemberCount ?? 0
                  }
                })
              })
              .catch(() => setError(text.actionFailed))
          }}
        />
        <FavoriteLibraryDialogs managedFolder={managedFolderDialog ? {
          title: managedFolderDialog.title,
          canDeleteRemotely: true,
          preview: managedFolderDialog.preview
        } : undefined} onManagedFolderChoice={(choice) => {
          if (managedFolderDialog) {
            uiCallbacks?.onManagedFolderDeleteChoice?.(managedFolderDialog.id, choice)
            if (accountMid) void (async () => {
              const api = window.bilimiDesktop
              const preview = managedFolderDialog.preview
              if (choice === 'local') await api.deleteFavoriteLibraryManagedFolderLocal?.(accountMid, preview.executionToken)
              else {
                const confirmation = await api.confirmFavoriteLibraryManagedFolderRemoteDelete?.(accountMid, preview.executionToken)
                if (!confirmation?.confirmationToken) throw new Error(text.unavailable)
                const result = await api.executeFavoriteLibraryManagedFolderRemoteDelete?.(accountMid, preview.executionToken, confirmation.confirmationToken) as { status?: string; operationId?: string } | undefined
                if (result?.status === 'result-unknown') {
                  setRemoteReconciliation({ kind: 'managed-folder', operationId: result.operationId ?? preview.executionToken })
                  return
                }
              }
              await refresh(accountMid)
            })().catch(() => setError(text.actionFailed))
          }
          setManagedFolderDialog(undefined)
        }} />
        {summary?.folderConflicts?.length ? <p className="favorite-library__conflicts" role="status">{text.conflicts}</p> : null}
        <section className="favorite-library__results" aria-label={text.results}>
          <FavoriteLibraryToolbar pageCount={rows.length} selectedCount={selectedAids.length} allCurrentPageSelected={allCurrentPageSelected} onTogglePage={toggleCurrentPage} batchDisabled={!selectedAids.length} onBatchAction={(action) => {
            uiCallbacks?.onBatchAction?.(action, [...selectedAids])
            if (action === 'copy' || action === 'move') openSelectedPlacementPicker(action)
            if (action === 'refresh') void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.syncFavoriteLibrarySelection || !accountMid) throw new Error(text.unavailable)
              return api.syncFavoriteLibrarySelection(accountMid, { kind: 'aids', aids: selectedAids })
            })
            if (action === 'transcribe') void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.enqueueFavoriteLibraryTranscription || !accountMid) throw new Error(text.unavailable)
              return api.enqueueFavoriteLibraryTranscription(accountMid, { aids: selectedAids })
            })
            if (action === 'unfavorite-remote' && accountMid && summary) void (async () => {
              const api = window.bilimiDesktop
              const preview = await api.previewFavoriteLibraryRemoteUnfavoriteOperation?.(accountMid, selectedAids, summary.revision) as {
                executionToken?: string; aids?: number[]; baselineRevision?: number
              } | undefined
              if (!preview?.executionToken) throw new Error(text.unavailable)
              setBatchRemoteUnfavoritePreview({
                aids: preview.aids?.length ? preview.aids : [...selectedAids],
                executionToken: preview.executionToken,
                baselineRevision: preview.baselineRevision
              })
            })().catch(() => setError(text.actionFailed))
          }}>
            <button type="button" disabled={!accountMid || !selectedAids.length} onClick={() => void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.syncFavoriteLibrarySelection || !accountMid) throw new Error(text.unavailable)
              return api.syncFavoriteLibrarySelection(accountMid, { kind: 'aids', aids: selectedAids })
            })}>{(allSelectedSynced ? '\u91cd\u65b0' : '') + text.syncSelected + '\uff08' + selectedAids.length + '\uff09'}</button>
            <button type="button" disabled={!accountMid || !selectedAids.length} onClick={() => openSelectedPlacementPicker()} aria-expanded={placementPickerOpen && placementPickerBatch}>调整所选本地归属（{selectedAids.length}）</button>
            {syncCurrentFolder ? <button type="button" disabled={!accountMid} onClick={() => void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.syncFavoriteLibrarySelection || !accountMid || !currentFolderId) throw new Error(text.unavailable)
              return api.syncFavoriteLibrarySelection(accountMid, { kind: 'folder', folderId: currentFolderId })
            })}>{text.syncFolder}</button> : null}
            <button type="button" disabled={!accountMid || !selectedAids.length} onClick={() => void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.enqueueFavoriteLibraryTranscription || !accountMid) throw new Error(text.unavailable)
              return api.enqueueFavoriteLibraryTranscription(accountMid, { aids: selectedAids })
            })}>{text.transcription + '\uff08' + selectedAids.length + '\uff09'}</button>
            {placementPickerOpen && placementPickerBatch ? renderPlacementPicker() : null}
            <label className="favorite-library__page-size">每页<select aria-label="每页数量" value={pageSize} onChange={(event) => {
              const nextPageSize = Number(event.currentTarget.value) as 25 | 50 | 100
              setPageSize(nextPageSize)
              if (accountMid) void load(accountMid, scope, undefined, nextPageSize)
            }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
          </FavoriteLibraryToolbar>
          <VirtualFavoriteLibraryList
            ariaLabel={text.videoList}
            items={rows}
            className="favorite-library__list"
            renderItem={(row) => (
              <div className="favorite-library__row-wrap">
                <input type="checkbox" aria-label={`${text.select} ${row.title}`} checked={selectedAids.includes(row.aid)} onChange={() => toggleAid(row.aid)} />
                <button type="button" className="favorite-library__row" onClick={() => { setSelected(row); setDetailOpen(true) }}>
                  <strong>{row.title}</strong><small>{row.author ?? text.unknownAuthor} - {row.folderIds.length} {text.memberships} - {formatFavoriteLibraryMirrorStatus((row.pendingStates ?? []).filter((state) => state !== 'protected'))} - {formatFavoriteLibraryOrganizationStatus(row.pendingStates ?? [])}</small>
                </button>
              </div>
            )}
          />
          {page?.nextCursor ? (
            <button
              type="button"
              className="favorite-library__next-page"
              onClick={() => accountMid && void load(accountMid, scope, page.nextCursor)}
            >
              {text.nextPage}
            </button>
          ) : null}
        </section>
        {detail ? (
          <FavoriteLibraryDetail title={detail.title} collapsed={!detailOpen} onRestore={() => setDetailOpen(true)} onCollapse={() => setDetailOpen(false)}>
            {eventsOpen ? <section className="favorite-library__detail-history" aria-label="完整处理记录">
              <h2>完整处理记录</h2>
              <ol className="favorite-library__events">{events?.items.map((event) => <li key={event.id}>{event.kind} · {event.occurredAt}</li>)}</ol>
              {events?.nextCursor ? <button type="button" className="favorite-library__inline-action" onClick={() => void loadMoreEvents()}>加载更早记录</button> : null}
              <button type="button" className="favorite-library__inline-action" onClick={() => setEventsOpen(false)}>返回视频详情</button>
            </section> : <>
            <div className="favorite-library__detail-heading"><h2>{detail.title}</h2>{accountMid ? <button type="button" className="favorite-library__open-video" onClick={() => void runDetailAction(async () => {
              const api = window.bilimiDesktop as typeof window.bilimiDesktop & FavoriteLibraryDesktopExtensions
              if (!api.openFavoriteLibraryVideo) throw new Error(text.unavailable)
              await api.openFavoriteLibraryVideo(accountMid, detail.aid)
            })}>{text.openVideo}</button> : null}</div><p>{detail.author ?? text.unknownAuthor} · 视频 ID: {detail.aid}</p>
            {detail.tags.length ? <p className="favorite-library__tags">标签：{detail.tags.join('、')}</p> : null}
            {(() => {
              const metadataStale = detail.title === 'Video + ID' || !detail.author
              const chips = [
                { label: '资料状态说明', value: formatFavoriteLibraryMetadataStatus(detailSnapshot?.mirror.status, metadataStale), explanation: '资料状态只反映标题、UP 主、封面、标签和简介的新鲜度，不代表收藏位置是否已同步。' },
                { label: '整理状态说明', value: formatFavoriteLibraryOrganizationStatus(detail.pendingStates), explanation: '整理状态说明该视频是否已经完成本轮整理；它与保护及远程位置状态相互独立。' },
                { label: '保护状态说明', value: detailSnapshot?.protected ? '已保护' : '未保护', explanation: '保护只决定下一次增量整理是否跳过该视频，不会隐藏位置差异或同步错误。' },
                { label: '位置状态说明', value: formatFavoriteLibraryPositionStatus(detailSnapshot?.position?.state), explanation: '位置状态比较本地最终意图与最近一次扫描到的 B 站位置；不会把资料刷新结果当作位置同步。' },
                { label: '转写状态说明', value: detailSnapshot?.transcription.status ?? '未转写', explanation: '转写状态按当前账号、视频和分 P 独立记录，移动收藏位置不会重复转写。' },
                { label: '档案状态说明', value: detailSnapshot?.archive.status ?? '未入档', explanation: '档案状态反映转写结果是否已经登记为档案；登记失败可以单独重新登记，无需重新转写。' }
              ]
              return <section className="favorite-library__status-tags" aria-label="视频状态">{chips.map((chip) => <button key={chip.label} type="button" aria-label={chip.label} aria-pressed={statusExplanation === chip.explanation} onClick={() => setStatusExplanation(chip.explanation)}>{chip.value}</button>)}{statusExplanation ? <p role="status">{statusExplanation}</p> : null}{metadataStale ? <button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(refreshMetadata)}>刷新资料</button> : null}</section>
            })()}
            <section><h3>处理记录</h3><p>{events?.items[0] ? `${events.items[0].kind} · ${events.items[0].occurredAt}` : '尚未加载完整处理记录。'}</p><button type="button" className="favorite-library__inline-action" onClick={() => void loadEvents()}>查看完整处理记录</button></section>
            <section><h3>收藏位置</h3><p>本地：{detailSnapshot?.position?.localDesiredFolderIds.length ? detailSnapshot.position.localDesiredFolderIds.join('、') : '未匹配分类'}</p><p>B站：{detailSnapshot?.position?.remoteObservedLogicalFolderIds.length ? detailSnapshot.position.remoteObservedLogicalFolderIds.join('、') : '尚未扫描或未映射'}</p><p>{formatFavoriteLibraryPositionStatus(detailSnapshot?.position?.state)}</p><button type="button" className="favorite-library__inline-action" onClick={openPlacementPicker} aria-expanded={placementPickerOpen && !placementPickerBatch}>调整本地归属</button>{placementPickerOpen && !placementPickerBatch ? renderPlacementPicker() : null}<button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(() => setLocalPlacement([]))}>移出所有本地仓库</button>{detailSnapshot?.position ? <button type="button" className="favorite-library__inline-action" disabled={['failed', 'result-unknown', 'needs-review', 'syncing'].includes(detailSnapshot.position.state)} onClick={() => void runDetailAction(adoptRemotePlacement)}>采用B站位置</button> : null}<button type="button" className="favorite-library__inline-action" onClick={() => setDeleteConfirmationOpen(true)}>从收藏库删除</button>{deleteConfirmationOpen ? <div className="favorite-library__delete-confirmation" role="alertdialog" aria-label="确认从收藏库删除"><p>不会取消 B 站收藏，也不会删除已有转写和档案。</p><button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(deleteFromLibrary)}>确认仅从收藏库删除</button><button type="button" className="favorite-library__inline-action" onClick={() => setDeleteConfirmationOpen(false)}>取消</button></div> : null}{(() => {
              const remoteUnfavoriteAvailable = Boolean(accountMid && selected && window.bilimiDesktop?.previewFavoriteLibraryBilibiliUnfavorite && window.bilimiDesktop?.confirmFavoriteLibraryBilibiliUnfavorite && window.bilimiDesktop?.executeFavoriteLibraryBilibiliUnfavorite)
              return <><button type="button" className="favorite-library__inline-action" disabled={!remoteUnfavoriteAvailable || remoteUnfavoritePreparing || remoteUnfavoriteExecuting || Boolean(remoteUnfavoritePreview)} aria-describedby="favorite-library-remote-unfavorite-note" onClick={() => void runDetailAction(beginRemoteUnfavorite)}>{remoteUnfavoritePreparing ? '正在准备确认…' : remoteUnfavoriteExecuting ? '正在取消 B 站收藏…' : '取消B站收藏'}</button><p id="favorite-library-remote-unfavorite-note" className="favorite-library__danger-note">仅取消当前视频在 B 站的全部收藏；不会删除收藏库本地记录、转写或档案。</p>{remoteUnfavoritePreview ? <div className="favorite-library__delete-confirmation" role="alertdialog" aria-label="确认取消B站收藏" aria-busy={remoteUnfavoriteExecuting}><p>将取消 B 站对“{detail?.title ?? remoteUnfavoritePreview.aids.join('、')}”的全部收藏（视频 ID：{remoteUnfavoritePreview.aids.join('、')}）。</p><p>本地记录、转写和档案会保留。网络中断时结果会标为待确认，不会自动重试。</p><button type="button" className="favorite-library__inline-action" disabled={remoteUnfavoriteExecuting} onClick={() => void confirmRemoteUnfavorite()}>确认取消 B 站收藏</button><button type="button" className="favorite-library__inline-action" disabled={remoteUnfavoriteExecuting} onClick={() => setRemoteUnfavoritePreview(undefined)}>取消</button></div> : null}</>
            })()}</section>
            <section><h3>{text.mirror}</h3><p>{detailSnapshot?.mirror.status ?? formatFavoriteLibraryMirrorStatus(detail.pendingStates.filter((state) => state !== 'protected'))}</p>{detailSnapshot?.mirror.lastSyncedAt ? <small>{`上次刷新: ${detailSnapshot.mirror.lastSyncedAt}`}</small> : null}</section>
            <section><h3>{text.source}</h3><ul>{detail.folders.map((folder: FavoriteRepositoryFolder) => <li key={folder.id}>{folder.title} {accountMid && folder.kind === 'bilibili' ? <button type="button" onClick={() => void runDetailAction(async () => {
               const api = window.bilimiDesktop as typeof window.bilimiDesktop & FavoriteLibraryDesktopExtensions
               if (!api.openFavoriteLibrarySource) throw new Error(text.unavailable)
               await api.openFavoriteLibrarySource(accountMid, folder.id)
             })}>{text.openSource}</button> : null}</li>)}</ul></section>
            {detailSnapshot?.sourceShards?.length ? <section><h3>来源分册</h3><ul>{detailSnapshot.sourceShards.map((shard) => <li key={shard.folderId}>{shard.title} {accountMid ? <button type="button" onClick={() => void runDetailAction(async () => {
              const api = window.bilimiDesktop as typeof window.bilimiDesktop & FavoriteLibraryDesktopExtensions
              if (!api.openFavoriteLibrarySource) throw new Error(text.unavailable)
              await api.openFavoriteLibrarySource(accountMid, shard.folderId)
            })}>{`打开第 ${shard.shardNumber} 分册`}</button> : null}</li>)}</ul></section> : null}
            <section><h3>{text.scan}</h3><p>{text.videoId}: {detail.aid}</p>{detailSnapshot?.video.bvid ? <p>BV 号: {detailSnapshot.video.bvid}</p> : null}{detailSnapshot?.video.durationSeconds ? <p>时长: {Math.floor(detailSnapshot.video.durationSeconds / 60)} 分 {detailSnapshot.video.durationSeconds % 60} 秒</p> : null}{detailSnapshot?.video.category ? <p>分区: {detailSnapshot.video.category}</p> : null}{detailSnapshot?.video.tags.length ? <p>标签: {detailSnapshot.video.tags.join('、')}</p> : null}<p>{text.transcriptionState}: {detailSnapshot?.transcription.status ?? (detail.pendingStates.includes('continuation') ? '\u7b49\u5f85\u5904\u7406' : '\u6682\u65e0\u8f6c\u5199\u4efb\u52a1')}</p></section>
            <section><h3>{text.archive}</h3><p>{detailSnapshot?.archive.status ?? text.noArchive}</p>{detailSnapshot?.archive.versionCount ? <small>{`${detailSnapshot.archive.versionCount} 个版本`}</small> : null}{detailSnapshot?.archive.status === '已入档' && accountMid ? <><button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(openArchiveDetail)}>查看档案详情</button><button type="button" onClick={() => void runDetailAction(async () => {
              const api = window.bilimiDesktop as typeof window.bilimiDesktop & FavoriteLibraryDesktopExtensions
              if (!api.toggleFavoriteLibraryArchiveStar) throw new Error(text.unavailable)
              await api.toggleFavoriteLibraryArchiveStar(accountMid, detail.aid, detailSnapshot?.video.cid)
            })}>{detailSnapshot.archive.starred ? text.unstar : text.star}</button><label>备注<textarea aria-label="档案备注" value={memoDraft} onChange={(event) => setMemoDraft(event.currentTarget.value)} /></label><button type="button" onClick={() => void runDetailAction(async () => {
              const api = window.bilimiDesktop as typeof window.bilimiDesktop & FavoriteLibraryDesktopExtensions
              if (!api.saveFavoriteLibraryArchiveMemo) throw new Error(text.unavailable)
              await api.saveFavoriteLibraryArchiveMemo(accountMid, detail.aid, memoDraft, detailSnapshot?.video.cid)
            })}>{text.saveMemo}</button></> : null}</section>
            {detail.pendingStates.length ? <p>{text.pendingStates}{formatFavoriteLibraryMirrorStatus(detail.pendingStates)}</p> : null}
            </>}
          </FavoriteLibraryDetail>
        ) : null}
      </div>
    </main>
  )
}

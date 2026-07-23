import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FavoriteRepositoryFolder } from '@shared/favoriteRepository'
import type {
  FavoriteRepositoryLibraryPage,
  FavoriteRepositoryLibraryVideoDetail,
  FavoriteRepositorySnapshotSummary,
  FavoriteRepositoryEventPage
} from '../../../../../electron/main/favoriteRepositoryIpc'
import { VirtualFavoriteLibraryList } from './VirtualFavoriteLibraryList'
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

type LibraryScope = { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' }

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
  if (id.startsWith('folder:')) return { kind: 'folder', folderId: id.slice('folder:'.length) }
  return { kind: 'all' }
}

type FavoriteLibraryAccount = { mid: string; nickname?: string }

/** Reads account-scoped repository pages; it owns only visible UI selection. */
export function FavoriteLibraryApp({
  embedded = false,
  onAccountChange
}: {
  embedded?: boolean
  onAccountChange?: (account: FavoriteLibraryAccount | undefined) => void
}) {
  const [accountMid, setAccountMid] = useState<string>()
  const [accountNickname, setAccountNickname] = useState<string>()
  const [summary, setSummary] = useState<FavoriteRepositorySnapshotSummary>()
  const [scopeId, setScopeId] = useState('all')
  const [page, setPage] = useState<FavoriteRepositoryLibraryPage>()
  const [selected, setSelected] = useState<FavoriteLibraryRow>()
  const [detailSnapshot, setDetailSnapshot] = useState<FavoriteRepositoryLibraryVideoDetail>()
  const [memoDraft, setMemoDraft] = useState('')
  const [detailOpen, setDetailOpen] = useState(true)
  const [error, setError] = useState<string>()
  const [selectedAids, setSelectedAids] = useState<number[]>([])
  const [organizationChanges, setOrganizationChanges] = useState<Array<{ id: string; aid: number; status: string; beforeFolderIds: string[]; afterFolderIds: string[] }>>([])
  const [events, setEvents] = useState<FavoriteRepositoryEventPage>()
  const [eventsOpen, setEventsOpen] = useState(false)
  const requestIdRef = useRef(0)

  useEffect(() => {
    onAccountChange?.(accountMid ? { mid: accountMid, nickname: accountNickname } : undefined)
  }, [accountMid, accountNickname, onAccountChange])

  const scope = useMemo(() => scopeForNavigation(scopeId), [scopeId])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const load = useCallback(async (mid: string, nextScope: LibraryScope, cursor?: string) => {
    const requestId = ++requestIdRef.current
    const api = window.bilimiDesktop
    if (!api?.getFavoriteRepositoryLibraryPage) throw new Error(text.unavailable)
    const next = await api.getFavoriteRepositoryLibraryPage(mid, nextScope, {
      limit: 100,
      ...(cursor ? { cursor } : {})
    })
    if (requestId === requestIdRef.current) {
      setPage(next)
      setSelected(undefined)
    }
  }, [])

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
      void (api as (typeof api & FavoriteLibraryDesktopExtensions))?.getFavoriteRepositoryOrganizationChanges?.(mid)
        ?.then((changes) => { if (refreshId === requestIdRef.current) setOrganizationChanges(changes) })
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

  const folders = summary?.folders ?? []
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
  const setLocalPlacement = async (folderIds: string[]) => {
    if (!accountMid || !selected || !detailSnapshot || !window.bilimiDesktop?.setFavoriteLibraryLocalPlacements) {
      throw new Error(text.unavailable)
    }
    await window.bilimiDesktop.setFavoriteLibraryLocalPlacements(
      accountMid, [{ aid: selected.aid, folderIds }], detailSnapshot.revision, false
    )
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
  const currentFolderId = scope.kind === 'folder' ? scope.folderId : undefined
  const syncCurrentFolder = currentFolderId && folders.find((folder) => folder.id === currentFolderId)?.kind !== 'bilibili'

  return (
    <main className="favorite-library" data-embedded={embedded || undefined} aria-label={text.library}>
      {!embedded ? (
        <header className="favorite-library__header">
        <div><h1>{text.library}</h1><p>{accountMid ? `${text.account}${accountNickname ? `${accountNickname}\uff08UID\uff1a${accountMid}\uff09` : `UID\uff1a${accountMid}`}` : text.loadingAccount}</p></div>
        {page ? <small>{page.items.length} {text.currentPage} - {text.version} {page.revision}</small> : null}
        </header>
      ) : null}
      <section className="favorite-library__organization-history" aria-label={text.organizationHistory}>
        <h2>{text.organizationHistory}</h2>
        {organizationChanges.length ? <ul>{organizationChanges.slice(-5).reverse().map((change) => <li key={change.id}>#{change.aid}：{change.status === 'succeeded' ? '已确认' : change.status === 'failed' ? '失败' : '待确认'}（{change.beforeFolderIds.length} → {change.afterFolderIds.length}）</li>)}</ul> : <p>{text.noOrganizationHistory}</p>}
      </section>
      {error ? <p role="alert" className="favorite-library__error">{error}</p> : null}
      <div className="favorite-library__layout" data-embedded-layout={embedded || undefined}>
        <nav className="favorite-library__nav" aria-label={text.navigation}>
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={scopeId === item.id ? 'page' : undefined}
              onClick={() => {
                setScopeId(item.id)
                setSelectedAids([])
                setSelected(undefined)
                setDetailSnapshot(undefined)
                if (accountMid) void load(accountMid, scopeForNavigation(item.id))
              }}
            >
              {item.kind === 'all' ? text.all : item.kind === 'pending' ? `${text.pending} ${item.count}` : item.title}
            </button>
          ))}
          {summary?.folderConflicts?.length ? <p className="favorite-library__conflicts" role="status">{text.conflicts}</p> : null}
        </nav>
        <section className="favorite-library__results" aria-label={text.results}>
          <div className="favorite-library__actions">
            <label className="favorite-library__select-page"><input type="checkbox" aria-label={text.selectPage} checked={allCurrentPageSelected} disabled={!rows.length} onChange={toggleCurrentPage} />{text.selectPage}</label>
            <small>{text.selected} {selectedAids.length} {text.item}</small>
            <button type="button" disabled={!accountMid || !selectedAids.length} onClick={() => void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.syncFavoriteLibrarySelection || !accountMid) throw new Error(text.unavailable)
              return api.syncFavoriteLibrarySelection(accountMid, { kind: 'aids', aids: selectedAids })
            })}>{(allSelectedSynced ? '\u91cd\u65b0' : '') + text.syncSelected + '\uff08' + selectedAids.length + '\uff09'}</button>
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
          </div>
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
        {detailOpen && detail ? (
          <aside className="favorite-library__detail" aria-label={text.detail}>
            <button type="button" onClick={() => setDetailOpen(false)}>{text.hideDetail}</button>
            <div className="favorite-library__detail-heading"><h2>{detail.title}</h2>{accountMid ? <button type="button" className="favorite-library__open-video" onClick={() => void runDetailAction(async () => {
              const api = window.bilimiDesktop as typeof window.bilimiDesktop & FavoriteLibraryDesktopExtensions
              if (!api.openFavoriteLibraryVideo) throw new Error(text.unavailable)
              await api.openFavoriteLibraryVideo(accountMid, detail.aid)
            })}>{text.openVideo}</button> : null}</div><p>{detail.author ?? text.unknownAuthor} · 视频 ID: {detail.aid}</p>
            <p>{detail.description ?? text.noDescription}</p>
            <section className="favorite-library__status-tags" aria-label="视频状态"><button type="button" aria-label="资料状态说明">{formatFavoriteLibraryMetadataStatus(detailSnapshot?.mirror.status, detail.title === 'Video + ID' || !detail.author)}</button><button type="button" aria-label="整理状态说明">{formatFavoriteLibraryOrganizationStatus(detail.pendingStates)}</button>{detailSnapshot?.protected ? <button type="button" aria-label="保护状态说明">已保护</button> : null}<button type="button" aria-label="位置状态说明">{formatFavoriteLibraryPositionStatus(detailSnapshot?.position?.state)}</button></section>
            <section><h3>处理记录</h3><p>{events?.items[0] ? `${events.items[0].kind} · ${events.items[0].occurredAt}` : '尚未加载完整处理记录。'}</p><button type="button" className="favorite-library__inline-action" onClick={() => void loadEvents()} aria-expanded={eventsOpen}>查看完整处理记录</button>{eventsOpen ? <><ol className="favorite-library__events">{events?.items.map((event) => <li key={event.id}>{event.kind} · {event.occurredAt}</li>)}</ol>{events?.nextCursor ? <button type="button" className="favorite-library__inline-action" onClick={() => void loadMoreEvents()}>加载更多处理记录</button> : null}</> : null}</section>
            <section><h3>收藏位置</h3><p>本地：{detailSnapshot?.position?.localDesiredFolderIds.length ? detailSnapshot.position.localDesiredFolderIds.join('、') : '未匹配分类'}</p><p>B站：{detailSnapshot?.position?.remoteObservedLogicalFolderIds.length ? detailSnapshot.position.remoteObservedLogicalFolderIds.join('、') : '尚未扫描或未映射'}</p><p>{formatFavoriteLibraryPositionStatus(detailSnapshot?.position?.state)}</p><button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(() => setLocalPlacement([]))}>移出所有本地仓库</button>{detailSnapshot?.position ? <button type="button" className="favorite-library__inline-action" onClick={() => void runDetailAction(adoptRemotePlacement)}>采用B站位置</button> : null}</section>
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
          </aside>
        ) : null}
      </div>
    </main>
  )
}

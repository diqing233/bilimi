import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FavoriteRepositoryFolder } from '@shared/favoriteRepository'
import type {
  FavoriteRepositoryLibraryPage,
  FavoriteRepositorySnapshotSummary
} from '../../../../../electron/main/favoriteRepositoryIpc'
import { VirtualFavoriteLibraryList } from './VirtualFavoriteLibraryList'
import {
  buildFavoriteLibraryDetail,
  buildFavoriteLibraryNavigation,
  type FavoriteLibraryRow
} from './favoriteLibraryModel'
import './FavoriteLibraryApp.css'

type LibraryScope = { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' }

const text = {
  library: '\u6536\u85cf\u5e93',
  account: '\u8d26\u53f7',
  loadingAccount: '\u6b63\u5728\u8bfb\u53d6\u8d26\u53f7...',
  unavailable: '\u6536\u85cf\u5e93\u6682\u4e0d\u53ef\u7528\u3002',
  signIn: '\u8bf7\u5148\u767b\u5f55 B \u7ad9\u8d26\u53f7\u3002',
  cannotRead: '\u6536\u85cf\u5e93\u65e0\u6cd5\u8bfb\u53d6\u3002',
  unavailableState: '\u6536\u85cf\u5e93\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\uff0c\u8bf7\u91cd\u65b0\u52a0\u8f7d\u3002',
  reload: '\u91cd\u65b0\u52a0\u8f7d\u6536\u85cf\u5e93',
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
  empty: '\u5f53\u524d\u8d26\u53f7\u6682\u65e0\u5df2\u4fdd\u5b58\u7684\u6536\u85cf\u3002',
  emptyHint: '\u53ef\u5148\u5728\u638c\u5e93\u5b8c\u6210\u6574\u7406\u65e7\u85cf\u626b\u63cf\uff0c\u6216\u5237\u65b0\u540e\u518d\u67e5\u770b\u3002',
  membershipsHeading: '\u5f52\u5c5e',
  pendingStates: '\u5f85\u5904\u7406\uff1a',
  select: 'Select',
  selected: 'selected',
  syncSelected: 'Sync selected',
  syncFolder: 'Sync folder',
  reconcile: 'Reconcile',
  retry: 'Retry',
  bind: 'Bind Bilibili page',
  transcription: 'Queue transcription',
  actionFailed: '\u6536\u85cf\u5e93\u64cd\u4f5c\u5931\u8d25\u3002'
} as const

function pageRows(page: FavoriteRepositoryLibraryPage): FavoriteLibraryRow[] {
  return page.items.map((item) => ({ ...item.video, folderIds: [...item.folderIds] }))
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

/** Reads account-scoped repository pages; it owns only visible UI selection. */
export function FavoriteLibraryApp() {
  const [accountMid, setAccountMid] = useState<string>()
  const [summary, setSummary] = useState<FavoriteRepositorySnapshotSummary>()
  const [scopeId, setScopeId] = useState('all')
  const [page, setPage] = useState<FavoriteRepositoryLibraryPage>()
  const [selected, setSelected] = useState<FavoriteLibraryRow>()
  const [detailOpen, setDetailOpen] = useState(true)
  const [error, setError] = useState<string>()
  const [selectedAids, setSelectedAids] = useState<number[]>([])
  const [lastSyncRun, setLastSyncRun] = useState<{ id: string; status: string }>()
  const [pendingSyncRuns, setPendingSyncRuns] = useState<Array<{ id: string; status: string }>>([])
  const [boundRunId, setBoundRunId] = useState<string>()
  const requestIdRef = useRef(0)

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
    setError(undefined)
    try {
      const mid = (await api?.readBilibiliAccountMid?.())?.trim()
      if (!mid) {
        if (refreshId !== requestIdRef.current) return
        setAccountMid(undefined)
        setSummary(undefined)
        setPage(undefined)
        setSelected(undefined)
        setSelectedAids([])
        setBoundRunId(undefined)
        setPendingSyncRuns([])
        setError(text.signIn)
        return
      }
      if (!api?.openFavoriteRepositoryAccount) throw new Error(text.signIn)
      if (refreshId !== requestIdRef.current) return
      if (mid !== expectedAccountMid) {
        setAccountMid(mid)
        setSummary(undefined)
        setPage(undefined)
      setSelected(undefined)
      setSelectedAids([])
      setBoundRunId(undefined)
      }
      const nextSummary = await api.openFavoriteRepositoryAccount(mid)
      if (refreshId !== requestIdRef.current) return
      setSummary(nextSummary)
      const pendingRuns = await api.getPendingFavoriteLibrarySyncRuns?.(mid)
      if (refreshId !== requestIdRef.current) return
      const runs = (pendingRuns ?? []).flatMap((run) => run.runId ? [{ id: run.runId, status: run.status }] : [])
      setPendingSyncRuns(runs)
      setLastSyncRun((current) => current && runs.some((run) => run.id === current.id) ? current : runs[0])
      await load(mid, mid === expectedAccountMid ? scopeRef.current : { kind: 'all' })
    } catch (reason) {
      if (refreshId === requestIdRef.current) setError(text.unavailableState)
    }
  }, [load])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => window.bilimiDesktop?.onBilibiliAccountChanged?.(() => {
    setSummary(undefined)
    setPage(undefined)
    setSelected(undefined)
    void refresh(accountMid)
  }), [accountMid, refresh])

  useEffect(() => {
    if (!accountMid || !window.bilimiDesktop?.subscribeFavoriteRepository) return
    return window.bilimiDesktop.subscribeFavoriteRepository(
      accountMid,
      scope.kind === 'folder' ? scope.folderId : undefined,
      () => void refresh(accountMid)
    )
  }, [accountMid, refresh, scope])

  const folders = summary?.folders ?? []
  const rows = page ? pageRows(page) : []
  const activeRow = selected && page?.items.find((item) => item.video.aid === selected.aid)
  const detail = selected && activeRow ? buildFavoriteLibraryDetail(selected, folders, {
    aid: selected.aid,
    states: [...activeRow.pendingStates]
  }) : undefined
  const navigation = summary ? buildFavoriteLibraryNavigation(folders, pendingCount(summary)) : []
  const toggleAid = (aid: number) => setSelectedAids((current) => current.includes(aid)
    ? current.filter((candidate) => candidate !== aid)
    : [...current, aid].sort((left, right) => left - right))
  const runAction = async (action: () => Promise<{ runId?: string; status: string }>) => {
    try {
      setError(undefined)
      const result = await action()
      if (result.runId) setLastSyncRun({ id: result.runId, status: result.status })
      if (accountMid) await refresh(accountMid)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.actionFailed)
    }
  }
  const currentFolderId = scope.kind === 'folder' ? scope.folderId : undefined
  const syncCurrentFolder = currentFolderId && folders.find((folder) => folder.id === currentFolderId)?.kind !== 'bilibili'

  return (
    <main className="favorite-library" aria-label={text.library}>
      <header className="favorite-library__header">
        <div><h1>{text.library}</h1><p>{accountMid ? `${text.account} ${accountMid}` : text.loadingAccount}</p></div>
        {page ? <small>{page.items.length} {text.currentPage} - {text.version} {page.revision}</small> : null}
      </header>
      {error ? <p role="alert" className="favorite-library__error">{error}</p> : null}
      <div className="favorite-library__layout">
        <nav className="favorite-library__nav" aria-label={text.navigation}>
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={scopeId === item.id ? 'page' : undefined}
              onClick={() => {
                setScopeId(item.id)
                if (accountMid) void load(accountMid, scopeForNavigation(item.id))
              }}
            >
              {item.kind === 'all' ? text.all : item.kind === 'pending' ? `${text.pending} ${item.count}` : item.title}
            </button>
          ))}
        </nav>
        <section className="favorite-library__results" aria-label={text.results}>
          {error && !page && accountMid ? <div className="favorite-library__unavailable" role="status">
            <strong>{text.unavailableState}</strong>
            <button type="button" onClick={() => void refresh(accountMid)}>{text.reload}</button>
          </div> : null}
          <div className="favorite-library__actions">
            <small>{selectedAids.length} {text.selected}</small>
            <button type="button" disabled={!accountMid || !selectedAids.length} onClick={() => void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.syncFavoriteLibrarySelection || !accountMid) throw new Error(text.unavailable)
              return api.syncFavoriteLibrarySelection(accountMid, { kind: 'aids', aids: selectedAids })
            })}>{text.syncSelected}</button>
            {syncCurrentFolder ? <button type="button" disabled={!accountMid} onClick={() => void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.syncFavoriteLibrarySelection || !accountMid || !currentFolderId) throw new Error(text.unavailable)
              return api.syncFavoriteLibrarySelection(accountMid, { kind: 'folder', folderId: currentFolderId })
            })}>{text.syncFolder}</button> : null}
            <button type="button" disabled={!accountMid || !selectedAids.length} onClick={() => void runAction(async () => {
              const api = window.bilimiDesktop
              if (!api?.enqueueFavoriteLibraryTranscription || !accountMid) throw new Error(text.unavailable)
              return api.enqueueFavoriteLibraryTranscription(accountMid, { aids: selectedAids })
            })}>{text.transcription}</button>
            {lastSyncRun?.status === 'result-unknown' ? <button type="button" disabled={!accountMid} onClick={() => void runAction(async () => {
              if (boundRunId !== lastSyncRun.id) throw new Error(text.bind)
              const api = window.bilimiDesktop
              if (!api?.reconcileFavoriteLibrarySync || !accountMid) throw new Error(text.unavailable)
              return api.reconcileFavoriteLibrarySync(accountMid, lastSyncRun.id)
            })}>{text.reconcile}</button> : null}
            {lastSyncRun && boundRunId !== lastSyncRun.id && (lastSyncRun.status === 'result-unknown' || lastSyncRun.status === 'failed' || lastSyncRun.status === 'ready-to-retry') ? <button type="button" disabled={!accountMid} onClick={() => void (async () => {
              try {
                const api = window.bilimiDesktop
                if (!api?.bindFavoriteLibrarySyncPage || !accountMid) throw new Error(text.unavailable)
                await api.bindFavoriteLibrarySyncPage(accountMid, lastSyncRun.id)
                setBoundRunId(lastSyncRun.id)
                setError(undefined)
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : text.actionFailed)
              }
            })()}>{text.bind}</button> : null}
            {lastSyncRun?.status === 'failed' || lastSyncRun?.status === 'ready-to-retry' ? <button type="button" disabled={!accountMid} onClick={() => void runAction(async () => {
              if (boundRunId !== lastSyncRun.id) throw new Error(text.bind)
              const api = window.bilimiDesktop
              if (!api?.retryFavoriteLibrarySync || !accountMid) throw new Error(text.unavailable)
              return api.retryFavoriteLibrarySync(accountMid, lastSyncRun.id)
            })}>{text.retry}</button> : null}
            {pendingSyncRuns.length > 1 ? <span className="favorite-library__runs" aria-label="Pending sync runs">{pendingSyncRuns.map((run) => (
              <button key={run.id} type="button" aria-pressed={lastSyncRun?.id === run.id} onClick={() => setLastSyncRun(run)}>{run.id}</button>
            ))}</span> : null}
          </div>
          <VirtualFavoriteLibraryList
            ariaLabel={text.videoList}
            items={rows}
            className="favorite-library__list"
            renderItem={(row) => (
              <div className="favorite-library__row-wrap">
                <input type="checkbox" aria-label={`${text.select} ${row.title}`} checked={selectedAids.includes(row.aid)} onChange={() => toggleAid(row.aid)} />
                <button type="button" className="favorite-library__row" onClick={() => { setSelected(row); setDetailOpen(true) }}>
                  <strong>{row.title}</strong><small>{row.author ?? text.unknownAuthor} - {row.folderIds.length} {text.memberships}</small>
                </button>
              </div>
            )}
          />
          {page && rows.length === 0 ? <div className="favorite-library__empty" role="status">
            <strong>{text.empty}</strong><span>{text.emptyHint}</span>
          </div> : null}
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
            <h2>{detail.title}</h2><p>{detail.author ?? text.unknownAuthor}</p>
            <p>{detail.description ?? text.noDescription}</p>
            <h3>{text.membershipsHeading}</h3><ul>{detail.folders.map((folder: FavoriteRepositoryFolder) => <li key={folder.id}>{folder.title}</li>)}</ul>
            {detail.pendingStates.length ? <p>{text.pendingStates}{detail.pendingStates.join('\u3001')}</p> : null}
          </aside>
        ) : null}
      </div>
    </main>
  )
}

import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FavoriteLedger } from '@shared/types'
import * as favoriteLedgerApiModule from './favoriteLedgerApi'
import {
  buildEnsureFavoriteLedgersScript,
  buildExecuteFavoriteLedgerPlanScript,
  buildFavoriteLedgerStatusScript,
  buildSaveFavoriteLedgersScript,
  buildOldFavoriteTagEnrichmentScript,
  buildCommitOldFavoriteBatchCheckpointScript,
  buildReadOldFavoriteBatchStatusScript,
  buildScanOldFavoriteVideoScript,
  buildScanOldFavoritesScript
} from './favoriteLedgerApi'

function installCookies() {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    value: 'bili_jct=csrf-token; DedeUserID=42'
  })
}

describe('favorite ledger API scripts', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    Object.defineProperty(document, 'cookie', { configurable: true, value: '' })
    const runtimeWindow = window as typeof window & {
      __bilimiOldFavoriteScanControl?: unknown
      __bilimiOldFavoriteTagWorkerRunning?: boolean
      __bilimiStartOldFavoriteTagWorker?: () => void
    }
    delete runtimeWindow.__bilimiOldFavoriteScanControl
    delete runtimeWindow.__bilimiOldFavoriteTagWorkerRunning
    delete runtimeWindow.__bilimiStartOldFavoriteTagWorker
  })

  it('exposes an explicit old favorite batch checkpoint commit script', () => {
    expect(typeof (
      favoriteLedgerApiModule as typeof favoriteLedgerApiModule & {
        buildCommitOldFavoriteBatchCheckpointScript?: unknown
      }
    ).buildCommitOldFavoriteBatchCheckpointScript).toBe('function')
  })

  async function scanCheckpointFixture(videoCount: number) {
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: { list: [{ id: 101, title: '批次来源', media_count: videoCount }] }
        })
      }
      const page = Number(new URL(url).searchParams.get('pn'))
      const firstAid = (page - 1) * 20 + 1
      const pageSize = Math.min(20, Math.max(0, videoCount - firstAid + 1))
      return Response.json({
        code: 0,
        data: {
          medias: Array.from({ length: pageSize }, (_, index) => ({
            id: firstAid + index,
            title: `第 ${firstAid + index} 条`,
            type: 2,
            tags: ['现成标签']
          })),
          has_more: firstAid + pageSize - 1 < videoCount
        }
      })
    }))
    return window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
  }

  it('commits an exhausted full-scan token atomically and treats an identical retry as idempotent', async () => {
    const scanResult = await scanCheckpointFixture(3020)
    const token = scanResult.batch.commitToken
    const beforeCommit = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(token).toMatchObject({
      version: 1,
      accountMid: '42',
      scanRunId: scanResult.scanProgress.basic.runId,
      folderOrder: ['101'],
      expectedCurrentCursor: null,
      nextCursor: null
    })
    expect(token.seenAids).toHaveLength(3020)
    expect(beforeCommit.batchCursor).toBeUndefined()

    const firstCommit = await window.eval(buildCommitOldFavoriteBatchCheckpointScript(token))
    const committed = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    localStorage.setItem('bilimi:old-favorite-batch-status:v1', JSON.stringify({
      accountMid: token.accountMid,
      scanRunId: token.scanRunId
    }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const repeatedCommit = await window.eval(buildCommitOldFavoriteBatchCheckpointScript(token))

    expect(firstCommit).toMatchObject({ ok: true, committed: true, idempotent: false, exhausted: true })
    expect(committed.batchCursor).toBeUndefined()
    expect(committed.batchSeenAids).toEqual(token.seenAids)
    expect(committed.batchExhausted).toMatchObject({ accountMid: '42', scanRunId: token.scanRunId })
    expect(repeatedCommit).toMatchObject({ ok: true, committed: true, idempotent: true, exhausted: true })
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeItemSpy).toHaveBeenCalledWith('bilimi:old-favorite-batch-status:v1')
    expect(window.eval(buildReadOldFavoriteBatchStatusScript())).toEqual({ pending: false })
  })

  it('commits a terminal scan token as exhausted instead of deleting all checkpoint state', async () => {
    const scanResult = await scanCheckpointFixture(1)
    const token = scanResult.batch.commitToken

    expect(token.nextCursor).toBeNull()
    const firstCommit = await window.eval(buildCommitOldFavoriteBatchCheckpointScript(token))
    const committed = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    const repeatedCommit = await window.eval(buildCommitOldFavoriteBatchCheckpointScript(token))

    expect(firstCommit).toMatchObject({ ok: true, committed: true, idempotent: false, exhausted: true })
    expect(committed.batchCursor).toBeUndefined()
    expect(committed.batchSeenAids).toEqual([1])
    expect(committed.batchExhausted).toMatchObject({
      accountMid: '42',
      scanRunId: token.scanRunId,
      folderOrder: ['101']
    })
    expect(repeatedCommit).toMatchObject({ ok: true, committed: true, idempotent: true, exhausted: true })
  })

  it('reports a completed but uncommitted scan batch as pending across a page restart', async () => {
    await scanCheckpointFixture(1)

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const firstRead = await window.eval(buildReadOldFavoriteBatchStatusScript())
    const persistedStatus = localStorage.getItem('bilimi:old-favorite-batch-status:v1')

    expect(firstRead).toEqual({ pending: true })
    expect(persistedStatus).toContain('scanRunId')
    expect(getItemSpy).not.toHaveBeenCalledWith('bilimi:old-favorite-tag-enrichment:v1')

    const secondRead = await window.eval(buildReadOldFavoriteBatchStatusScript())
    expect(secondRead).toEqual({ pending: true })
  })

  it.each([1, 3020])('does not report a committed %s-video batch as pending', async (videoCount) => {
    const scanResult = await scanCheckpointFixture(videoCount)

    await window.eval(buildCommitOldFavoriteBatchCheckpointScript(scanResult.batch.commitToken))

    expect(window.eval(buildReadOldFavoriteBatchStatusScript())).toEqual({
      pending: false
    })
  })

  it('does not reveal another accounts pending scan batch', async () => {
    await scanCheckpointFixture(1)
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'bili_jct=csrf-token; DedeUserID=99'
    })

    expect(window.eval(buildReadOldFavoriteBatchStatusScript())).toEqual({
      pending: false
    })
  })

  it.each([
    ['account', (store: Record<string, unknown>) => {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        value: 'bili_jct=csrf-token; DedeUserID=99'
      })
      return store
    }],
    ['completed run', (store: Record<string, any>) => ({
      ...store,
      lastScan: { ...store.lastScan, basic: { ...store.lastScan.basic, runId: 'newer-run' } }
    })],
    ['folder order', (store: Record<string, any>) => ({
      ...store,
      lastScan: { ...store.lastScan, batch: { ...store.lastScan.batch, folderOrder: ['changed'] } }
    })],
    ['committed cursor', (store: Record<string, unknown>) => ({
      ...store,
      batchCursor: { accountMid: '42', folderId: '101', nextPage: 2, folderOrder: ['101'] }
    })]
  ])('rejects a checkpoint token when the current %s no longer matches', async (_label, mutateStore) => {
    const scanResult = await scanCheckpointFixture(1)
    const token = scanResult.batch.commitToken
    const originalStore = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    const mutatedStore = mutateStore(originalStore)
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify(mutatedStore))

    const result = await window.eval(buildCommitOldFavoriteBatchCheckpointScript(token))
    const after = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(result).toMatchObject({ ok: false, stale: true })
    expect(after).toEqual(mutatedStore)
  })

  it('clears another accounts persisted scan state and tag cache', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '99',
      cache: { '123': { tags: ['攻略'], updatedAt: Date.now() } },
      queue: [124],
      progress: { completed: 242, total: 242, pending: 0, cacheHits: 0, succeeded: 242, failed: 0, status: 'complete' },
      lastScan: {
        sourceFolders: [{ id: '101', title: '旧账号收藏夹', videos: [{ aid: 123, title: '旧账号视频', tags: ['攻略'] }] }],
        basic: { completed: 242, total: 242, status: 'complete' }
      }
    }))

    const read = await window.eval(buildOldFavoriteTagEnrichmentScript('read'))
    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(read).toMatchObject({
      accountMid: '42',
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 0, total: 0 },
        tags: { completed: 0, total: 0, pending: 0 }
      }
    })
    expect(stored).toMatchObject({ accountMid: '42', cache: {}, queue: [] })
    expect(stored.lastScan).toBeUndefined()
  })

  it('discards legacy unowned scan state instead of assigning it to the current account', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      cache: { '123': { tags: ['攻略'], updatedAt: Date.now() } },
      queue: [],
      progress: { completed: 242, total: 242, pending: 0, cacheHits: 0, succeeded: 242, failed: 0, status: 'complete' },
      lastScan: {
        sourceFolders: [{ id: '101', title: '未知账号收藏夹', videos: [{ aid: 123, title: '未知账号视频', tags: ['攻略'] }] }],
        basic: { completed: 242, total: 242, status: 'complete' }
      }
    }))

    const read = await window.eval(buildOldFavoriteTagEnrichmentScript('read'))

    expect(read.sourceFolders).toEqual([])
    expect(read.scanProgress.tags).toMatchObject({ completed: 0, total: 0, pending: 0 })
  })

  it('hides persisted scan state when there is no signed-in account', async () => {
    Object.defineProperty(document, 'cookie', { configurable: true, value: '' })
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: { '123': { tags: ['攻略'], updatedAt: Date.now() } },
      queue: [],
      progress: { completed: 242, total: 242, pending: 0, cacheHits: 0, succeeded: 242, failed: 0, status: 'complete' },
      lastScan: { sourceFolders: [{ id: '101', title: '旧账号收藏夹', videos: [] }], basic: { completed: 242, total: 242, status: 'complete' } }
    }))

    const read = await window.eval(buildOldFavoriteTagEnrichmentScript('read'))

    expect(read.accountMid).toBe('')
    expect(read.sourceFolders).toEqual([])
    expect(read.scanProgress.tags).toMatchObject({ completed: 0, total: 0, pending: 0 })
  })

  it('reads and controls the persisted old favorite tag enrichment worker', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: { '123': { tags: ['攻略'], updatedAt: Date.now() } },
      queue: [124],
      progress: { completed: 1, total: 2, pending: 1, cacheHits: 0, succeeded: 1, failed: 0, status: 'running' },
      lastScan: { sourceFolders: [{ id: '101', title: '默认收藏夹', videos: [{ aid: 123, title: '攻略', tags: [] }] }] }
    }))

    const read = await window.eval(buildOldFavoriteTagEnrichmentScript('read'))
    expect(read.sourceFolders[0].videos[0].tags).toEqual(['攻略'])
    expect(read.scanProgress.tags).toMatchObject({ completed: 1, pending: 1 })

    const paused = await window.eval(buildOldFavoriteTagEnrichmentScript('pause'))
    expect(paused.scanProgress.tags.status).toBe('paused')
    const cancelled = await window.eval(buildOldFavoriteTagEnrichmentScript('cancel'))
    expect(cancelled.scanProgress.tags).toMatchObject({ pending: 0, status: 'partial', terminalReason: 'cancelled' })
  })

  it('reports cancelled tag work as a partial accepted terminal instead of a normal completion', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42', cache: {}, queue: [11, 12], controlRevision: 0,
      progress: { completed: 1, total: 3, pending: 2, cacheHits: 0, succeeded: 1, failed: 0, status: 'running' }
    }))

    const cancelled = await window.eval(buildOldFavoriteTagEnrichmentScript('cancel'))

    expect(cancelled.scanProgress.tags).toMatchObject({
      completed: 1, total: 3, pending: 0, status: 'partial', terminalReason: 'cancelled'
    })
  })

  it('normalizes impossible persisted tag progress before returning it', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42', cache: {}, queue: [],
      progress: { completed: 2431, total: 2300, pending: 99, cacheHits: 0, succeeded: 2431, failed: 0, status: 'complete' }
    }))

    const read = await window.eval(buildOldFavoriteTagEnrichmentScript('read'))
    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(read.scanProgress.tags).toMatchObject({ completed: 2300, total: 2300, pending: 0, status: 'complete' })
    expect(stored.progress).toMatchObject({ completed: 2300, total: 2300, pending: 0, status: 'complete' })
  })

  it('does not rewrite the persisted full scan snapshot for a read-only progress poll', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42', cache: {}, queue: [2],
      progress: { completed: 1, total: 2, pending: 1, cacheHits: 0, succeeded: 1, failed: 0, status: 'running' },
      lastScan: {
        sourceFolders: [{ id: 'large', title: '大收藏夹', videos: Array.from({ length: 200 }, (_, index) => ({ aid: index + 1, title: `视频${index + 1}` })) }],
        basic: { completed: 200, total: 200, status: 'complete' }
      }
    }))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const result = await window.eval(buildOldFavoriteTagEnrichmentScript('progress'))

    expect(result.sourceFolders).toEqual([])
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it.each(['running', 'paused'])('marks an empty persisted tag queue complete when its status is %s', async (status) => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42', cache: {}, queue: [],
      progress: { completed: 3, total: 5, pending: 2, cacheHits: 0, succeeded: 3, failed: 0, status }
    }))

    const read = await window.eval(buildOldFavoriteTagEnrichmentScript('read'))

    expect(read.scanProgress.tags).toMatchObject({ completed: 3, total: 5, pending: 0, status: 'complete' })
  })

  it('pauses a non-empty persisted tag queue that was incorrectly marked complete', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42', cache: {}, queue: [11, 12],
      progress: { completed: 5, total: 5, pending: 0, cacheHits: 0, succeeded: 5, failed: 0, status: 'complete' }
    }))

    const read = await window.eval(buildOldFavoriteTagEnrichmentScript('read'))

    expect(read.scanProgress.tags).toMatchObject({ completed: 3, total: 5, pending: 2, status: 'paused' })
  })

  it('bootstraps tag enrichment from a persisted queue after the webview restarts', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {}, queue: [321], progress: { completed: 0, total: 1, pending: 1, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' }
    }))
    delete (window as typeof window & { __bilimiStartOldFavoriteTagWorker?: unknown }).__bilimiStartOldFavoriteTagWorker
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 0, data: [{ tag_name: '续传标签' }] })))

    await window.eval(buildOldFavoriteTagEnrichmentScript('resume'))
    await vi.advanceTimersByTimeAsync(1200)

    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(stored.queue).toEqual([])
    expect(stored.cache['321'].tags).toEqual(['续传标签'])
    expect(stored.progress).toMatchObject({ completed: 1, total: 1, pending: 0, status: 'complete' })
    vi.useRealTimers()
  })

  it('preserves the last scan snapshot while the worker persists completed tags', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {}, queue: [321], controlRevision: 0,
      progress: { completed: 0, total: 1, pending: 1, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' },
      lastScan: { sourceFolders: [{ id: '101', title: '默认收藏夹', videos: [{ aid: 321, title: '续传', tags: [] }] }], basic: { completed: 1, total: 1, status: 'complete' } }
    }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 0, data: [{ tag_name: '标签' }] })))
    await window.eval(buildOldFavoriteTagEnrichmentScript('resume'))
    await vi.advanceTimersByTimeAsync(1200)
    const snapshot = await window.eval(buildOldFavoriteTagEnrichmentScript('read'))
    expect(snapshot.sourceFolders[0]).toMatchObject({ id: '101', videos: [expect.objectContaining({ aid: 321, tags: ['标签'] })] })
    vi.useRealTimers()
  })

  it('marks one resumed aid failed after three attempts and continues to the next aid', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {}, queue: [1, 2], controlRevision: 0,
      progress: { completed: 0, total: 2, pending: 2, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' }
    }))
    let firstAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('aid=1')) {
        firstAttempts += 1
        return Response.json({ code: -500, message: 'failed' })
      }
      return Response.json({ code: 0, data: [{ tag_name: '后续标签' }] })
    }))

    await window.eval(buildOldFavoriteTagEnrichmentScript('resume'))
    await vi.advanceTimersByTimeAsync(20_000)

    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(firstAttempts).toBe(3)
    expect(stored.queue).toEqual([])
    expect(stored.cache['2'].tags).toEqual(['后续标签'])
    expect(stored.progress).toMatchObject({ completed: 2, pending: 0, succeeded: 1, failed: 1, status: 'complete' })
    vi.useRealTimers()
  })

  it('checkpoints a successful tag batch once instead of serializing the full store per aid', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42', cache: {}, queue: [1, 2, 3], controlRevision: 0,
      progress: { completed: 0, total: 3, pending: 3, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' }
    }))
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 0, data: [{ tag_name: '标签' }] })))

    await window.eval(buildOldFavoriteTagEnrichmentScript('resume'))
    await vi.advanceTimersByTimeAsync(5_000)

    const tagStoreWrites = writes.mock.calls.filter(([key]) => key === 'bilimi:old-favorite-tag-enrichment:v1')
    expect(tagStoreWrites).toHaveLength(2)
    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(stored.queue).toEqual([])
    expect(stored.progress).toMatchObject({ completed: 3, pending: 0, succeeded: 3, status: 'complete' })
    vi.useRealTimers()
  })

  it.each([
    ['html login response', () => new Response('<!DOCTYPE html><html>login</html>', { headers: { 'content-type': 'text/html' } }), { errorKind: 'login', errorMessage: expect.stringContaining('please log in') }],
    ['not logged in response', () => Response.json({ code: -101, message: '账号未登录' }), { errorKind: 'login', errorCode: -101, errorMessage: '账号未登录' }],
    ['risk control response', () => Response.json({ code: -412, message: 'risk control' }), { errorKind: 'risk-control', errorCode: -412, errorMessage: 'risk control' }]
  ] as const)('pauses tag enrichment on a global %s', async (_label, makeResponse, metadata) => {
    vi.useFakeTimers()
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42', cache: {}, queue: [1, 2], controlRevision: 0,
      progress: { completed: 0, total: 2, pending: 2, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' }
    }))
    const fetchMock = vi.fn(async () => makeResponse())
    vi.stubGlobal('fetch', fetchMock)

    await window.eval(buildOldFavoriteTagEnrichmentScript('resume'))
    await vi.advanceTimersByTimeAsync(5000)

    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(stored.queue).toEqual([1, 2])
    expect(stored.progress).toMatchObject({ completed: 0, pending: 2, failed: 0, status: 'paused', ...metadata })
    vi.useRealTimers()
  })

  it('keeps invalid JSON errors classified as unknown instead of risk-control', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42', cache: {}, queue: [1, 2], controlRevision: 0,
      progress: { completed: 0, total: 2, pending: 2, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' }
    }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{not-json}', {
      status: 200, headers: { 'content-type': 'application/json' }
    })))

    await window.eval(buildOldFavoriteTagEnrichmentScript('resume'))
    await vi.advanceTimersByTimeAsync(5000)

    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(stored.progress).toMatchObject({ status: 'paused', errorKind: 'unknown' })
    expect(stored.progress.errorKind).not.toBe('risk-control')
    vi.useRealTimers()
  })

  it('does not resurrect a cancelled queue when a pending tag request finishes', async () => {
    vi.useFakeTimers()
    installCookies()
    let resolveFetch!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({ accountMid: '42', cache: {}, queue: [9], controlRevision: 0, progress: { completed: 0, total: 1, pending: 1, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' } }))
    await window.eval(buildOldFavoriteTagEnrichmentScript('resume'))
    await vi.advanceTimersByTimeAsync(1000)
    await window.eval(buildOldFavoriteTagEnrichmentScript('cancel'))
    resolveFetch(Response.json({ code: 0, data: [{ tag_name: 'late' }] }))
    await Promise.resolve()
    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(stored.queue).toEqual([])
    expect(stored.progress).toMatchObject({ status: 'partial', terminalReason: 'cancelled' })
    vi.useRealTimers()
  })
  it('reports missing enabled Bilimi ledgers without creating them', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 1, title: ledgers[0].displayName }]
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildFavoriteLedgerStatusScript(ledgers))

    expect(result.ok).toBe(false)
    expect(result.missingLedgerIds).toEqual(
      ledgers.filter((ledger) => ledger.enabled).map((ledger) => ledger.id)
    )
    expect(result.unboundLedgerIds).toEqual(['knowledge'])
    expect((result.ledgers as FavoriteLedger[]).find((ledger) => ledger.id === 'knowledge')?.bilibiliFolderId).toBeUndefined()
  })

  it('reports an existing bilimi-prefixed folder as an explicit rebind candidate instead of binding by name', async () => {
    installCookies()
    const ledgers: FavoriteLedger[] = [{
      id: 'custom-genshin', displayName: '原神', keywords: ['原神'], enabled: true,
      priority: 90, isDefault: false
    }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 42, title: 'bilimi·原神' }] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildFavoriteLedgerStatusScript(ledgers))

    expect(result.missingLedgerIds).toEqual(['custom-genshin'])
    expect(result.unboundLedgerIds).toEqual(['custom-genshin'])
    expect(result.unboundCandidates).toEqual([{
      ledgerId: 'custom-genshin',
      candidates: [{ id: '42', title: 'bilimi·原神', memberCount: 0 }]
    }])
    expect(result.ledgers).toEqual([
      expect.objectContaining({ id: 'custom-genshin', displayName: '原神', bindingState: 'unbound' })
    ])
    expect(result.ledgers[0]).not.toHaveProperty('bilibiliFolderId')
  })

  it('creates an unsaved local draft for an unconfigured remote bilimi folder', async () => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 88, title: 'bilimi·你好', media_count: 6 }] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildFavoriteLedgerStatusScript([]))

    expect(result.ok).toBe(true)
    expect(result.missingLedgerIds).toEqual([])
    expect(result.ledgers).toEqual([expect.objectContaining({
      displayName: 'bilimi·你好', keywords: [], ruleType: 'keyword', enabled: false, isDefault: false,
      bilibiliFolderId: '88', bindingState: 'unbound', syncState: 'local-draft'
    })])
    expect(result.remoteOnlyDraftLedgerIds).toEqual([expect.any(String)])
  })

  it('creates one remote-only draft per Bilibili folder even when titles are identical', async () => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 88, title: 'bilimi·同名', media_count: 6 },
          { id: 89, title: 'bilimi·同名', media_count: 9 }
        ] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildFavoriteLedgerStatusScript([]))

    expect(result.ledgers).toHaveLength(2)
    expect(result.ledgers.map((ledger: FavoriteLedger) => ledger.bilibiliFolderId)).toEqual(['88', '89'])
    expect(new Set(result.ledgers.map((ledger: FavoriteLedger) => ledger.id)).size).toBe(2)
  })

  it('keeps a same-name local draft separate from the remote folder until the user rebinds it', async () => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 88, title: 'bilimi·同名', media_count: 6 }] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildFavoriteLedgerStatusScript([{
      id: 'local-same-name', displayName: 'bilimi·同名', keywords: [], enabled: true, priority: 1, isDefault: false,
      bindingState: 'unbound'
    }]))

    expect(result.ledgers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'local-same-name', bindingState: 'unbound' }),
      expect.objectContaining({ bilibiliFolderId: '88', syncState: 'local-draft', bindingState: 'unbound' })
    ]))
  })

  it('keeps a bound folder when Bilibili changes its title', async () => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 88, title: '用户改过的名称', media_count: 6 }] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildFavoriteLedgerStatusScript([{
      id: 'local-bound', displayName: 'bilimi·原名称', keywords: [], enabled: true, priority: 1, isDefault: false,
      bilibiliFolderId: '88', bindingState: 'bound'
    }]))

    expect(result.ledgers).toEqual([expect.objectContaining({ id: 'local-bound', bilibiliFolderId: '88', bindingState: 'bound' })])
  })

  it('does not recreate a dismissed remote-only draft reminder for the same remote folder', async () => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 88, title: 'bilimi·你好', media_count: 6 }] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildFavoriteLedgerStatusScript([], ['88']))

    expect(result.remoteOnlyDraftLedgerIds).toEqual([])
    expect(result.ledgers).toEqual([])
  })

  it('recognizes bilimi folders written with a space or without punctuation', async () => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 89, title: 'bilimi 资料' },
          { id: 90, title: 'bilimi知识' },
          { id: 91, title: 'bilimini' }
        ] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildFavoriteLedgerStatusScript([]))

    expect(result.ledgers).toEqual([
      expect.objectContaining({ displayName: 'bilimi 资料', bilibiliFolderId: '89', syncState: 'local-draft' }),
      expect.objectContaining({ displayName: 'bilimi知识', bilibiliFolderId: '90', syncState: 'local-draft' })
    ])
    expect(result.ledgers).not.toEqual(expect.arrayContaining([expect.objectContaining({ displayName: 'bilimini' })]))
  })

  it('does not guess when multiple folders normalize to the same custom rule name', async () => {
    installCookies()
    const ledgers: FavoriteLedger[] = [{
      id: 'custom-genshin', displayName: '原神', keywords: ['原神'], enabled: true,
      priority: 90, isDefault: false
    }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 42, title: '原神' },
          { id: 43, title: 'bilimi·原神' }
        ] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildFavoriteLedgerStatusScript(ledgers))

    expect(result.missingLedgerIds).toEqual(['custom-genshin'])
    expect(result.unboundLedgerIds).toEqual(['custom-genshin'])
    expect(result.ledgers[0]).not.toHaveProperty('bilibiliFolderId')
  })

  it('requires an explicit rebind selection before using an existing bilimi-prefixed folder during backup', async () => {
    installCookies()
    const ledgers: FavoriteLedger[] = [{
      id: 'custom-genshin', displayName: '原神', keywords: ['原神'], enabled: true,
      priority: 90, isDefault: false
    }]
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 42, title: 'bilimi·原神' }] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildEnsureFavoriteLedgersScript(ledgers))

    expect(result.ok).toBe(false)
    expect(result.unboundCandidates).toEqual([{
      ledgerId: 'custom-genshin',
      candidates: [{ id: '42', title: 'bilimi·原神', memberCount: 0 }]
    }])
    expect(result.ledgers).toEqual([expect.objectContaining({ bindingState: 'unbound' })])
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/folder/add'))).toBe(false)
  })

  it('creates only missing enabled ledgers', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 2).map((ledger, index) => index === 0 ? { ...ledger, bilibiliFolderId: '1' } : ledger)
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [{ id: 1, title: ledgers[0].displayName }] } })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: { id: 2, title: 'created' } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildEnsureFavoriteLedgersScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:game'])
    expect(requests.filter((request) => request.url.includes('/folder/add'))).toHaveLength(1)
    const createRequest = requests.find((request) => request.url.includes('/folder/add'))
    expect(createRequest?.body).toContain('csrf=csrf-token')
    expect(createRequest?.body).toContain('privacy=0')
    expect(createRequest?.body).toContain(`title=${encodeURIComponent(ledgers[1].displayName)}`)
  })

  it('returns an explicit rebind candidate when a remote bilimi folder appears during creation recheck', async () => {
    installCookies()
    const ledger = createDefaultFavoriteLedgers()[0]
    let listCount = 0
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        listCount += 1
        return Response.json({
          code: 0,
          data: { list: listCount === 1 ? [] : [{ id: 77, title: ledger.displayName }] }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await window.eval(buildEnsureFavoriteLedgersScript([ledger]))

    expect(result.ok).toBe(false)
    expect(result.unboundCandidates).toEqual([{ ledgerId: ledger.id, candidates: [{ id: '77', title: ledger.displayName, memberCount: 0 }] }])
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/folder/add'))).toHaveLength(0)
  })

  it('stops backup on exact duplicate titles without treating a ·02 volume as a duplicate', async () => {
    installCookies()
    const ledger = createDefaultFavoriteLedgers()[0]
    const secondVolume = { id: 3, title: `${ledger.displayName}·02` }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 1, title: ledger.displayName }, { id: 2, title: ledger.displayName }, secondVolume] } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildEnsureFavoriteLedgersScript([ledger]))

    expect(result).toMatchObject({ ok: false, missingTargets: [ledger.id], unboundLedgerIds: [ledger.id] })
  })

  it('rejects an overlong enabled ledger before setup can create a remote folder', async () => {
    installCookies()
    const overlongLedger = {
      ...createDefaultFavoriteLedgers()[0],
      id: 'custom-overlong-setup',
      displayName: 'bilimi·测试测试测试测试测试测试测试',
      bilibiliFolderId: undefined,
      isDefault: false
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await window.eval(buildEnsureFavoriteLedgersScript([overlongLedger]))

    expect(result).toMatchObject({
      ok: false,
      missingTargets: ['custom-overlong-setup'],
      message: expect.stringContaining('20')
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports setup as incomplete when created ledgers still lack folder ids', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 2).map((ledger, index) => index === 0 ? { ...ledger, bilibiliFolderId: '1' } : ledger)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [{ id: 1, title: ledgers[0].displayName }] } })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildEnsureFavoriteLedgersScript(ledgers))

    expect(result.ok).toBe(false)
    expect(result.missingTargets).toEqual(['game'])
  })

  it('recreates an enabled ledger when its stored folder id no longer exists during setup', async () => {
    installCookies()
    const inboxLedger = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'inbox')!,
      bilibiliFolderId: '9001'
    }
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: { id: 9002 } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildEnsureFavoriteLedgersScript([inboxLedger]))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:inbox'])
    expect((result.ledgers as FavoriteLedger[]).find((ledger) => ledger.id === 'inbox')?.bilibiliFolderId).toBe('9002')
    const createRequest = requests.find((request) => request.url.includes('/folder/add'))
    expect(createRequest?.body).toContain(`title=${encodeURIComponent(inboxLedger.displayName)}`)
  })

  it('saves edited ledgers by creating missing enabled folders', async () => {
    installCookies()
    const previousLedgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    const nextLedgers = [
      previousLedgers[0],
      {
        ...createDefaultFavoriteLedgers()[1],
        id: 'custom-bilimi',
        displayName: 'Bilimi Custom',
        bilibiliFolderId: undefined,
        isDefault: false
      }
    ]
    const requests: Array<{ body?: string; url: string }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 9001, title: previousLedgers[0].displayName }]
            }
          })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: { id: 9002 } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildSaveFavoriteLedgersScript(nextLedgers, previousLedgers))

    expect(result.ok).toBe(true)
    expect(result.message).toBe('收藏夹已备册。')
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:custom-bilimi'])
    expect(requests.filter((request) => request.url.includes('/folder/add'))).toHaveLength(1)
    expect(requests[1].body).toContain('csrf=csrf-token')
    expect(requests[1].body).toContain(`title=${encodeURIComponent('bilimi·Custom')}`)
    expect((result.ledgers as FavoriteLedger[]).find((ledger) => ledger.id === 'custom-bilimi')?.bilibiliFolderId).toBe(
      '9002'
    )
  })

  it('rejects an enabled ledger name over 20 Unicode characters before any network request', async () => {
    installCookies()
    const overlongLedger = {
      ...createDefaultFavoriteLedgers()[0],
      id: 'custom-overlong',
      displayName: 'bilimi·12345678901234',
      bilibiliFolderId: undefined,
      isDefault: false
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await window.eval(buildSaveFavoriteLedgersScript([overlongLedger], []))

    expect(result).toMatchObject({
      ok: false,
      missingTargets: ['custom-overlong'],
      message: expect.stringContaining('20')
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('recreates an enabled ledger when its stored folder id no longer exists while saving', async () => {
    installCookies()
    const inboxLedger = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'inbox')!,
      bilibiliFolderId: '9001'
    }
    const requests: Array<{ body?: string; url: string }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: { id: 9002 } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildSaveFavoriteLedgersScript([inboxLedger], [inboxLedger]))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:inbox'])
    expect((result.ledgers as FavoriteLedger[]).find((ledger) => ledger.id === 'inbox')?.bilibiliFolderId).toBe('9002')
    const createRequest = requests.find((request) => request.url.includes('/folder/add'))
    expect(createRequest?.body).toContain(`title=${encodeURIComponent(inboxLedger.displayName)}`)
  })

  it('never deletes a remote bilimi folder merely because a rule was removed while saving', async () => {
    installCookies()
    const baseLedgers = createDefaultFavoriteLedgers()
    const nextLedgers = [{ ...baseLedgers[0], bilibiliFolderId: '9001' }]
    const previousLedgers = [
      baseLedgers[0],
      {
        ...baseLedgers[1],
        id: 'removed-bilimi',
        displayName: 'Bilimi Old',
        bilibiliFolderId: '9002',
        isDefault: false
      },
      {
        ...baseLedgers[2],
        id: 'removed-personal',
        displayName: 'Personal Old',
        bilibiliFolderId: '9003',
        isDefault: false
      },
      {
        ...baseLedgers[3],
        id: 'removed-default',
        displayName: 'Bilimi Default',
        bilibiliFolderId: '9004',
        isDefault: true
      }
    ]
    const requests: Array<{ body?: string; url: string }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 9001, title: baseLedgers[0].displayName },
                { id: 9002, title: 'Bilimi Old' },
                { id: 9003, title: 'Personal Old' },
                { id: 9004, title: 'Bilimi Default' }
              ]
            }
          })
        }

        if (url.includes('/x/v3/fav/folder/del')) {
          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildSaveFavoriteLedgersScript(nextLedgers, previousLedgers))

    const deleteRequests = requests.filter((request) => request.url.includes('/folder/del'))
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list'])
    expect(deleteRequests).toHaveLength(0)
  })

  it('keeps disabled bilimi folders remote until the explicit delete flow confirms removal', async () => {
    installCookies()
    const baseLedgers = createDefaultFavoriteLedgers()
    const nextLedgers = [
      {
        ...baseLedgers[0],
        enabled: false,
        bilibiliFolderId: '9001'
      },
      {
        ...baseLedgers[1],
        displayName: '个人收藏夹',
        enabled: false,
        bilibiliFolderId: '9002',
        isDefault: false
      }
    ]
    const requests: Array<{ body?: string; url: string }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 9001, title: baseLedgers[0].displayName },
                { id: 9002, title: '个人收藏夹' }
              ]
            }
          })
        }

        if (url.includes('/x/v3/fav/folder/del')) {
          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildSaveFavoriteLedgersScript(nextLedgers, nextLedgers))

    const deleteRequests = requests.filter((request) => request.url.includes('/folder/del'))
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list'])
    expect(deleteRequests).toHaveLength(0)
    const disabledLedger = (result.ledgers as FavoriteLedger[]).find((ledger) => ledger.id === 'knowledge')
    expect(disabledLedger).toEqual(
      expect.objectContaining({
        id: 'knowledge',
        enabled: false
      })
    )
    expect(disabledLedger).toHaveProperty('bilibiliFolderId', '9001')
    expect((result.ledgers as FavoriteLedger[]).find((ledger) => ledger.id === 'game')?.bilibiliFolderId).toBe('9002')
  })

  it('keeps disabled Bilimi-managed folders when saving without disabled deletion', async () => {
    installCookies()
    const baseLedgers = createDefaultFavoriteLedgers()
    const nextLedgers = [
      {
        ...baseLedgers[0],
        enabled: false,
        bilibiliFolderId: '9001'
      },
      {
        ...baseLedgers[1],
        enabled: true,
        bilibiliFolderId: '9002'
      }
    ]
    const requests: Array<{ body?: string; url: string }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 9001, title: baseLedgers[0].displayName },
                { id: 9002, title: baseLedgers[1].displayName }
              ]
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildSaveFavoriteLedgersScript(nextLedgers, nextLedgers, { deleteDisabled: false })
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list'])
    expect(requests.some((request) => request.url.includes('/folder/del'))).toBe(false)
    expect((result.ledgers as FavoriteLedger[]).find((ledger) => ledger.id === 'knowledge')?.bilibiliFolderId).toBe('9001')
  })

  it('appends old favorites without passing delete media ids', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi路瑙侀椈澧炲箍',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 456,
          title: '已归册',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi路瑙侀椈澧炲箍',
          reviewRequired: false,
          alreadyInTarget: true,
          selected: true
        }
      ])
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:append:123'])
    const dealRequests = requests.filter((request) => request.url.includes('/x/v3/fav/resource/deal'))
    expect(dealRequests).toHaveLength(1)
    const body = new URLSearchParams(dealRequests[0].body)
    expect(body.get('add_media_ids')).toBe('9001')
    expect(body.get('csrf')).toBe('csrf-token')
    expect(body.has('del_media_ids')).toBe(false)
    expect(body.get('rid')).toBe('123')
    expect(body.get('type')).toBe('2')
    expect(body.get('platform')).toBe('web')
    expect(body.get('from_spmid')).toBe('')
    expect(body.get('spmid')).toBe('333.788.0.0')
    expect(body.get('statistics')).toBeTruthy()
  })

  it('merges multiple targets for one aid into one append request with per-target completions', async () => {
    installCookies()
    const requests: URLSearchParams[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·知识' },
          { id: 9002, title: 'bilimi·影视' }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) return Response.json({ code: 0, data: [] })
      if (url.includes('/x/v3/fav/resource/deal')) {
        requests.push(new URLSearchParams(init?.body?.toString()))
        return Response.json({ code: 0, data: {} })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const base = {
      aid: 123,
      title: '同一视频多目标',
      sourceFolderTitle: '默认收藏夹',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }
    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([
      { ...base, targetLedgerId: 'knowledge', targetFolderId: '9001', targetDisplayName: 'bilimi·知识' },
      { ...base, targetLedgerId: 'movie-tv', targetFolderId: '9002', targetDisplayName: 'bilimi·影视' }
    ]))

    expect(result.ok).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0].get('add_media_ids')).toBe('9001,9002')
    expect(requests[0].has('del_media_ids')).toBe(false)
    expect(result.completedItems).toEqual([
      expect.objectContaining({ aid: 123, targetLedgerId: 'knowledge', targetFolderId: '9001' }),
      expect.objectContaining({ aid: 123, targetLedgerId: 'movie-tv', targetFolderId: '9002' })
    ])
  })

  it('stops before the first write when the expected account changed inside the webview', async () => {
    installCookies()
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'bili_jct=csrf-token; DedeUserID=99'
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 123,
      title: '账号已切换',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }], {}, '42'))

    expect(result).toMatchObject({
      ok: false,
      paused: true,
      resultUnknown: true,
      missingTargets: ['bilibili-account']
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rechecks the expected account before each write in one execution group', async () => {
    installCookies()
    let cookie = 'bili_jct=csrf-token; DedeUserID=42'
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => cookie
    })
    const requests: URLSearchParams[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·知识' },
          { id: 9002, title: 'bilimi·影视' }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) return Response.json({ code: 0, data: [] })
      if (parsed.pathname.endsWith('/resource/deal')) {
        requests.push(new URLSearchParams(init?.body?.toString()))
        cookie = 'bili_jct=csrf-token; DedeUserID=99'
        return Response.json({ code: 0, data: {} })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 123,
      title: '一组多次写入',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: '知识',
      currentBilimiFolderIds: ['9008'],
      desiredTargetFolderIds: ['9001'],
      reorganizeProtected: true,
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }], {}, '42'))

    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ ok: false, paused: true, resultUnknown: true })
  })

  it('keeps staging when every formal destination fails', async () => {
    installCookies()
    const requests: URLSearchParams[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·知识' },
          { id: 9008, title: 'bilimi·暂存' }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) {
        return Response.json({ code: 0, data: parsed.searchParams.get('media_id') === '9008' ? [{ id: 123, type: 2 }] : [] })
      }
      if (!parsed.pathname.endsWith('/resource/deal')) throw new Error(`Unexpected request: ${url}`)
      const body = new URLSearchParams(init?.body?.toString())
      requests.push(body)
      return Response.json({ code: -101, message: 'add failed' })
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([
      {
        aid: 123,
        title: '暂存迁移失败',
        sourceFolderTitle: 'bilimi·暂存',
        sourceFolderIds: ['9008'],
        sourceFolderTitles: ['bilimi·暂存'],
        currentBilimiFolderIds: ['9008'],
        stagingFolderIds: ['9008'],
        targetLedgerId: 'knowledge',
        targetFolderId: '9001',
        targetDisplayName: 'bilimi·知识',
        reviewRequired: false,
        alreadyInTarget: false,
        selected: true
      }
    ]))

    expect(result).toMatchObject({ ok: false, partial: false })
    expect(requests).toHaveLength(1)
    expect(requests[0].get('add_media_ids')).toBe('9001')
    expect(requests[0].has('del_media_ids')).toBe(false)
  })

  it('removes staging after one formal destination succeeds and reports partial completion', async () => {
    installCookies()
    const requests: URLSearchParams[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·知识' },
          { id: 9002, title: 'bilimi·游戏' },
          { id: 9008, title: 'bilimi·暂存' }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) {
        return Response.json({ code: 0, data: parsed.searchParams.get('media_id') === '9008' ? [{ id: 123, type: 2 }] : [] })
      }
      if (!parsed.pathname.endsWith('/resource/deal')) throw new Error(`Unexpected request: ${url}`)
      const body = new URLSearchParams(init?.body?.toString())
      requests.push(body)
      if (body.get('add_media_ids') === '9002') {
        return Response.json({ code: -101, message: 'second add failed' })
      }
      return Response.json({ code: 0, data: {} })
    }))

    const base = {
      aid: 123,
      title: '暂存部分迁移',
      sourceFolderTitle: 'bilimi·暂存',
      sourceFolderIds: ['9008', 'ordinary-1'],
      sourceFolderTitles: ['bilimi·暂存', '我的普通收藏'],
      currentBilimiFolderIds: ['9008'],
      stagingFolderIds: ['9008'],
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }
    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([
      { ...base, targetLedgerId: 'knowledge', targetFolderId: '9001', targetDisplayName: 'bilimi·知识' },
      { ...base, targetLedgerId: 'game', targetFolderId: '9002', targetDisplayName: 'bilimi·游戏' }
    ]))

    expect(result).toMatchObject({
      ok: false,
      partial: true,
      completedItems: [expect.objectContaining({ aid: 123, targetFolderId: '9001' })]
    })
    expect(requests.map((body) => ({ add: body.get('add_media_ids'), remove: body.get('del_media_ids') }))).toEqual([
      { add: '9001', remove: null },
      { add: '9002', remove: null },
      { add: null, remove: '9008' }
    ])
    expect(requests.some((body) => body.get('del_media_ids') === 'ordinary-1')).toBe(false)
  })

  it('reads every physical shard and appends to the last shard with capacity', async () => {
    installCookies()
    const requests: Array<{ body?: URLSearchParams; url: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      const body = init?.body ? new URLSearchParams(init.body.toString()) : undefined
      requests.push({ body, url })
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·原神', media_count: 1000 },
          { id: 9002, title: 'bilimi·原神·2', media_count: 999 }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) {
        const mediaId = parsed.searchParams.get('media_id')
        const count = mediaId === '9001' ? 1000 : 999
        return Response.json({ code: 0, data: Array.from({ length: count }, (_, index) => ({ id: index + 1, type: 2 })) })
      }
      if (parsed.pathname.endsWith('/resource/deal')) return Response.json({ code: 0, data: {} })
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 5000,
      title: '新视频',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'game',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·原神',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }]))

    expect(result).toMatchObject({ ok: true, completedItems: [expect.objectContaining({ targetFolderId: '9002' })] })
    expect(requests.filter(({ url }) => url.includes('/resource/ids'))).toHaveLength(2)
    expect(requests.find(({ url }) => url.includes('/resource/deal'))?.body?.get('add_media_ids')).toBe('9002')
  })

  it('creates the next physical shard when all existing shards are full', async () => {
    installCookies()
    const requests: Array<{ body?: URLSearchParams; url: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      const body = init?.body ? new URLSearchParams(init.body.toString()) : undefined
      requests.push({ body, url })
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·原神', media_count: 1000 },
          { id: 9002, title: 'bilimi·原神·2', media_count: 1000 }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) {
        return Response.json({ code: 0, data: Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, type: 2 })) })
      }
      if (parsed.pathname.endsWith('/folder/add')) return Response.json({ code: 0, data: { id: 9003 } })
      if (parsed.pathname.endsWith('/resource/deal')) return Response.json({ code: 0, data: {} })
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 5000,
      title: '新视频',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'game',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·原神',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }]))

    expect(result).toMatchObject({ ok: true, completedItems: [expect.objectContaining({ targetFolderId: '9003' })] })
    expect(requests.find(({ url }) => url.includes('/folder/add'))?.body?.get('title')).toBe('bilimi·原神·3')
    expect(requests.find(({ url }) => url.includes('/resource/deal'))?.body?.get('add_media_ids')).toBe('9003')
  })

  it('pauses a logical target without appending elsewhere when shard creation fails', async () => {
    installCookies()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url)
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 9001, title: 'bilimi·原神', media_count: 1000 }] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) {
        return Response.json({ code: 0, data: Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, type: 2 })) })
      }
      if (parsed.pathname.endsWith('/folder/add')) return Response.json({ code: -500, message: 'create failed' })
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 5000,
      title: '新视频',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'game',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·原神',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }]))

    expect(result).toMatchObject({ ok: false, paused: true, missingTargets: ['favorite-ledger-shard:game'] })
    expect(requests.some((url) => url.includes('/resource/deal'))).toBe(false)
  })

  it('blocks all writes when any formal shard membership cannot be read completely', async () => {
    installCookies()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url)
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·知识', media_count: 1 },
          { id: 9002, title: 'bilimi·知识·2', media_count: 1 }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids') && parsed.searchParams.get('media_id') === '9001') {
        return Response.json({ code: 0, data: [{ id: 1, type: 2 }] })
      }
      if (parsed.pathname.endsWith('/resource/ids')) return Response.json({ code: -500, message: 'incomplete' })
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 5000,
      title: '不能冒险执行',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }]))

    expect(result).toMatchObject({ ok: false, paused: true, missingTargets: ['favorite-ledger-membership-incomplete'] })
    expect(requests.some((url) => url.includes('/resource/deal'))).toBe(false)
  })

  it('keeps every staging shard when a formal append result is unknown', async () => {
    installCookies()
    const dealBodies: URLSearchParams[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·知识' },
          { id: 9008, title: 'bilimi·暂存' },
          { id: 9009, title: 'bilimi·暂存·2' }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) {
        const mediaId = parsed.searchParams.get('media_id')
        return Response.json({ code: 0, data: mediaId === '9001' ? [] : [{ id: 123, type: 2 }] })
      }
      if (parsed.pathname.endsWith('/resource/deal')) {
        dealBodies.push(new URLSearchParams(init?.body?.toString()))
        throw new DOMException('request interrupted while closing', 'AbortError')
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 123,
      title: '结果未知',
      sourceFolderTitle: 'bilimi·暂存',
      currentBilimiFolderIds: ['9008', '9009'],
      stagingFolderIds: ['9008'],
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }]))

    expect(result).toMatchObject({
      ok: false,
      paused: true,
      resultUnknown: true,
      missingTargets: ['favorite-ledger-reconcile:123']
    })
    expect(dealBodies).toHaveLength(1)
    expect(dealBodies[0].get('add_media_ids')).toBe('9001')
    expect(dealBodies[0].has('del_media_ids')).toBe(false)
  })

  it('pauses before writing when any staging shard membership is incomplete', async () => {
    installCookies()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url)
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·知识' },
          { id: 9008, title: 'bilimi·暂存' },
          { id: 9009, title: 'bilimi·暂存·2' }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids') && parsed.searchParams.get('media_id') === '9008') {
        return Response.json({ code: 0, data: [{ id: 123, type: 2 }] })
      }
      if (parsed.pathname.endsWith('/resource/ids') && parsed.searchParams.get('media_id') === '9009') {
        return Response.json({ code: -500, message: 'incomplete staging membership' })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 123,
      title: '暂存分卷不完整',
      sourceFolderTitle: 'bilimi·暂存',
      stagingFolderIds: ['9008'],
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }]))

    expect(result).toMatchObject({
      ok: false,
      paused: true,
      resultUnknown: true,
      missingTargets: ['favorite-ledger-reconcile:123']
    })
    expect(requests.some((url) => url.includes('/resource/deal'))).toBe(false)
  })

  it('recognizes every shard of a long logical title after stable truncation', async () => {
    installCookies()
    const dealBodies: URLSearchParams[] = []
    const logicalTitle = 'bilimi·超级长的游戏攻略收藏分类名称'
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·超级长的游戏攻略收藏分', media_count: 1000 },
          { id: 9002, title: 'bilimi·超级长的游戏攻略收藏分·2', media_count: 999 }
        ] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) {
        const count = parsed.searchParams.get('media_id') === '9001' ? 1000 : 999
        return Response.json({ code: 0, data: Array.from({ length: count }, (_, index) => ({ id: index + 1, type: 2 })) })
      }
      if (parsed.pathname.endsWith('/resource/deal')) {
        dealBodies.push(new URLSearchParams(init?.body?.toString()))
        return Response.json({ code: 0, data: {} })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 5000,
      title: '长名逻辑夹视频',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'long-game',
      targetFolderId: '9001',
      targetDisplayName: logicalTitle,
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }]))

    expect(result).toMatchObject({ ok: true, completedItems: [expect.objectContaining({ targetFolderId: '9002' })] })
    expect(dealBodies[0].get('add_media_ids')).toBe('9002')
  })

  it('paces repeated old favorite appends to avoid Bilibili protection', async () => {
    installCookies()
    const delays: number[] = []
    const originalSetTimeout = window.setTimeout
    vi.stubGlobal('setTimeout', ((callback: TimerHandler, delay?: number) => {
      delays.push(Number(delay ?? 0))
      if (typeof callback === 'function') {
        callback()
      }
      return 0
    }) as typeof setTimeout)
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: 0, data: {} })
        }

        if (url.includes('/x/v3/fav/resource/ids')) {
          return Response.json({ code: 0, data: [] })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript(
        [
          {
            aid: 123,
            title: 'old favorite one',
            sourceFolderTitle: 'Default Favorites',
            targetLedgerId: 'knowledge',
            targetFolderId: '9001',
            targetDisplayName: 'Bilimi Knowledge',
            reviewRequired: false,
            alreadyInTarget: false,
            selected: true
          },
          {
            aid: 456,
            title: 'old favorite two',
            sourceFolderTitle: 'Default Favorites',
            targetLedgerId: 'knowledge',
            targetFolderId: '9001',
            targetDisplayName: 'Bilimi Knowledge',
            reviewRequired: false,
            alreadyInTarget: false,
            selected: true
          }
        ],
        {
          appendDelayMs: { min: 2500, max: 2500 },
          cooldownEvery: 99,
          cooldownDelayMs: { min: 30000, max: 30000 }
        }
      )
    )

    vi.stubGlobal('setTimeout', originalSetTimeout)

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual([
      'api:ledger:append:123',
      'api:ledger:pace:2500',
      'api:ledger:append:456'
    ])
    expect(delays).toEqual([2500])
    expect(requests.filter((request) => request.url.includes('/x/v3/fav/resource/deal'))).toHaveLength(2)
  })

  it('pauses old favorite execution when Bilibili protection is detected', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: -509, message: 'request too fast', data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: 'old favorite one',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 456,
          title: 'old favorite two',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: ['api:ledger:protection-paused:123'],
      missingTargets: ['favorite-ledger-protection'],
      paused: true,
      completedCount: 0,
      failedCount: 1,
      remainingCount: 1
    })
    expect(result.message).toContain('paused')
    expect(requests.filter((request) => request.url.includes('/x/v3/fav/resource/deal'))).toHaveLength(1)
  })

  it.each([
    ['API -352', () => Response.json({ code: -352, message: 'captcha required', data: {} })],
    ['HTTP 412', () => new Response('precondition failed', { status: 412 })]
  ])('safely stops old favorite execution for %s', async (_label, responseFactory) => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async () => responseFactory()))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 123,
      title: '风控边界测试',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }]))

    expect(result).toMatchObject({
      ok: false,
      paused: true,
      missingTargets: ['favorite-ledger-protection']
    })
  })

  it('returns completed items when a later aid fails in the same execution boundary', async () => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 9001, title: 'bilimi·知识' }] } })
      }
      if (url.includes('/x/v3/fav/resource/ids')) {
        return Response.json({ code: 0, data: [] })
      }
      const aid = new URLSearchParams(init?.body?.toString()).get('rid')
      return aid === '123'
        ? Response.json({ code: 0, data: {} })
        : Response.json({ code: 62002, message: '目标不存在', data: {} })
    }))

    const item = (aid: number) => ({
      aid,
      title: `视频 ${aid}`,
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    })
    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([item(123), item(456)], {
      appendDelayMs: { min: 0, max: 0 }
    }))

    expect(result).toMatchObject({
      ok: false,
      partial: true,
      completedItems: [expect.objectContaining({ aid: 123 })]
    })
  })

  it.each(['风控', '访问受限', '安全验证'])('safely stops on the Chinese risk message %s', async (message) => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: -400, message, data: {} })))
    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 123,
      title: '中文风控提示',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    }]))
    expect(result).toMatchObject({ paused: true, missingTargets: ['favorite-ledger-protection'] })
  })

  it('asks the user to sync when confirming old favorites without a target folder id', async () => {
    installCookies()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '待分类旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: [],
      missingTargets: ['inbox']
    })
    expect(result.message).toContain('掌库和 B 站收藏夹不一致')
    expect(result.message).toContain('请先同步掌库')
  })

  it('refreshes a newly synced generated ledger folder id before appending old favorites', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 9010, title: 'bilimi·摄影' }]
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/ids')) {
          return Response.json({ code: 0, data: [] })
        }

        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '光影构图入门',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'custom-tag-cluster-摄影',
          targetDisplayName: 'bilimi·摄影',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          selectedCandidateTarget: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: true,
      steps: ['api:ledger:append:123'],
      missingTargets: [],
      completedItems: [expect.objectContaining({ aid: 123, targetFolderId: '9010' })]
    })
    const appendBody = new URLSearchParams(
      requests.find((request) => request.url.includes('/x/v3/fav/resource/deal'))?.body
    )
    expect(appendBody.get('add_media_ids')).toBe('9010')
  })

  it('returns structured failure when appending a favorite fails', async () => {
    installCookies()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }
        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: -101, message: '账号未登录', data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·见闻增广',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: ['api:ledger:append-failed:123'],
      missingTargets: ['favorite-ledger-append:123'],
      message: expect.stringContaining('账号未登录')
    })
  })

  it('asks the user to sync when a stale target folder id cannot be refreshed before retry', async () => {
    installCookies()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: 62002, message: '目标收藏夹不存在', data: {} })
        }

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        throw new Error(`Unexpected request: ${url} ${init?.body?.toString() ?? ''}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '待分类旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: ['api:ledger:append-failed:123'],
      missingTargets: ['favorite-ledger-append:123']
    })
    expect(result.message).toContain('掌库和 B 站收藏夹不一致')
    expect(result.message).toContain('请先同步掌库')
  })

  it('continues appending old favorites when one selected item no longer exists', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/resource/deal')) {
          const body = new URLSearchParams(init?.body?.toString())
          if (body.get('rid') === '123') {
            return Response.json({ code: 62002, message: '您访问的内容不存在', data: {} })
          }

          return Response.json({ code: 0, data: {} })
        }

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '失效旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 456,
          title: '可归册旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: ['api:ledger:append-failed:123', 'api:ledger:append:456'],
      missingTargets: ['favorite-ledger-append:123']
    })
    expect(result.message).toContain('partially completed')
    expect(result.message).toContain('1 appended')
    expect(result.message).toContain('1 failed')
    expect(requests.filter((request) => request.url.includes('/x/v3/fav/resource/deal'))).toHaveLength(2)
  })

  it('summarizes repeated html append failures with one login hint', async () => {
    installCookies()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/resource/deal')) {
          return new Response('<!DOCTYPE html><html><body>login</body></html>', {
            headers: { 'content-type': 'text/html;charset=utf-8' },
            status: 200
          })
        }

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '旧藏甲',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 456,
          title: '旧藏乙',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: ['api:ledger:append-failed:123', 'api:ledger:append-failed:456'],
      missingTargets: ['favorite-ledger-append:123', 'favorite-ledger-append:456']
    })
    expect(result.message).toContain('0 appended, 2 failed')
    expect(result.message).toContain('旧藏甲')
    expect(result.message).toContain('旧藏乙')
    expect(result.message.match(/Please log in to Bilibili again/g)).toBeNull()
    expect(result.message.match(/请重新登录 Bilibili/g)).toHaveLength(1)
  })

  it('refreshes a stale target folder id and retries an old favorite append once', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 9009, title: 'Knowledge' }]
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/ids')) {
          return Response.json({ code: 0, data: [] })
        }

        if (url.includes('/x/v3/fav/resource/deal')) {
          const body = new URLSearchParams(init?.body?.toString())
          if (body.get('add_media_ids') === '9001') {
            return Response.json({ code: 62002, message: '您访问的内容不存在', data: {} })
          }

          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '可归册旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: true,
      steps: ['api:ledger:append-retry:123', 'api:ledger:append:123'],
      missingTargets: [],
      completedItems: [expect.objectContaining({ aid: 123, targetFolderId: '9009' })]
    })
    const appendBodies = requests
      .filter((request) => request.url.includes('/x/v3/fav/resource/deal'))
      .map((request) => new URLSearchParams(request.body))
    expect(appendBodies.map((body) => body.get('add_media_ids'))).toEqual(['9001', '9009'])
    expect(appendBodies[1].has('del_media_ids')).toBe(false)
  })

  it('scans old favorites and Bilimi target folders without moving source items', async () => {
    installCookies()
    localStorage.clear()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 2).map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: String(9001 + index)
    }))
    const requests: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requests.push(url)

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 101, title: 'Default Favorites' },
                { id: 9001, title: ledgers[0].displayName }
              ]
            }
          })
        }

        if (url.includes('media_id=101') && url.includes('pn=1')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 123,
                  title: 'Machine learning tutorial',
                  intro: 'A practical lesson',
                  upper: { name: 'AI Teacher' },
                  cnt_info: { collect: 42 },
                  ugc: { first_cid: 11 },
                  bvid: 'BV123',
                  page: 1,
                  attr: 0,
                  type: 2,
                  link: 'https://www.bilibili.com/video/BV123',
                  cover: 'https://i0.hdslb.com/bfs/archive/demo.jpg',
                  pubtime: 1710000000,
                  fav_time: 1720000000,
                  tags: ['AI', 'Tutorial'],
                  tname: 'Knowledge'
                }
              ],
              has_more: true
            }
          })
        }

        if (url.includes('media_id=101') && url.includes('pn=2')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 124,
                  title: 'Comedy sketch',
                  intro: 'Funny moment',
                  author: 'Comedy UP',
                  tags: [{ name: 'Funny' }, 'Sketch'],
                  category: 'Entertainment',
                  type: 2
                }
              ],
              has_more: false
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/ids') && url.includes('media_id=9001')) {
          return Response.json({ code: 0, data: [{ id: 123, type: 2 }] })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.accountMid).toBe('42')
    expect(result.managedFolderScanComplete).toBe(true)
    expect(result.managedFolders).toEqual([
      {
        id: '9001',
        title: ledgers[0].displayName,
        ledgerId: ledgers[0].id,
        isInbox: false
      }
    ])
    expect(result.sourceFolders).toEqual([
      {
        id: '101',
        title: 'Default Favorites',
        mediaCount: 2,
        scanFailed: false,
        scanStatus: 'complete',
        readVideoCount: 2,
        videos: [
          {
            aid: 123,
            title: 'Machine learning tutorial',
            description: 'A practical lesson',
            author: 'AI Teacher',
            tags: ['AI', 'Tutorial'],
            category: 'Knowledge'
          },
          {
            aid: 124,
            title: 'Comedy sketch',
            description: 'Funny moment',
            author: 'Comedy UP',
            tags: ['Funny', 'Sketch'],
            category: 'Entertainment'
          }
        ]
      }
    ])
    expect(result.targetMembership).toEqual({ '9001': [123] })
    expect(result.steps).toEqual([
      'api:favorite:list',
      'api:favorite:scan-source:101',
      'api:favorite:scan-target:9001'
    ])
    expect(requests.some((url) => url.includes('/x/v3/fav/resource/deal'))).toBe(false)
  })

  it.each([
    ['abort', () => new DOMException('request interrupted while closing', 'AbortError')],
    ['network', () => new TypeError('Failed to fetch')]
  ])('pauses with an unknown result when the refreshed append retry ends in %s', async (_label, errorFactory) => {
    installCookies()
    const dealAids: string[] = []
    let dealCall = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 9002, title: 'bilimi·知识' }] } })
      }
      if (parsed.pathname.endsWith('/resource/ids')) {
        return Response.json({ code: 0, data: [] })
      }
      if (parsed.pathname.endsWith('/resource/deal')) {
        const body = new URLSearchParams(init?.body?.toString())
        dealAids.push(body.get('rid') ?? '')
        dealCall += 1
        if (dealCall === 1) return Response.json({ code: 62002, message: '旧目标不存在' })
        if (dealCall === 2) throw errorFactory()
        return Response.json({ code: 0, data: {} })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const item = (aid: number) => ({
      aid,
      title: `视频 ${aid}`,
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true
    })
    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([item(123), item(456)], {
      appendDelayMs: { min: 0, max: 0 }
    }))

    expect(result).toMatchObject({
      ok: false,
      paused: true,
      resultUnknown: true,
      missingTargets: ['favorite-ledger-reconcile:123'],
      remainingCount: 2
    })
    expect(dealAids).toEqual(['123', '123'])
  })

  it('recognizes physical shard suffixes as one stable logical managed folder', async () => {
    installCookies()
    localStorage.clear()
    const ledger = { ...createDefaultFavoriteLedgers()[0], bilibiliFolderId: '9001' }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: ledger.displayName, media_count: 1 },
          { id: 9002, title: `${ledger.displayName}·2`, media_count: 1 }
        ] } })
      }
      if (url.includes('/x/v3/fav/resource/ids') && url.includes('media_id=9001')) {
        return Response.json({ code: 0, data: [{ id: 1, type: 2 }] })
      }
      if (url.includes('/x/v3/fav/resource/ids') && url.includes('media_id=9002')) {
        return Response.json({ code: 0, data: [{ id: 2, type: 2 }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildScanOldFavoritesScript([ledger]))

    expect(result.managedFolders).toEqual([
      expect.objectContaining({ id: '9001', ledgerId: ledger.id }),
      expect.objectContaining({ id: '9002', ledgerId: ledger.id })
    ])
    expect(result.targetMembership).toEqual({ '9001': [1], '9002': [2] })
  })

  it('queues unique videos for background tag enrichment after basic discovery', async () => {
    installCookies()
    localStorage.clear()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1)
    const requests: string[] = []

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url)
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }, { id: 102, title: '稍后再看' }] } })
      }
      if (url.includes('media_id=101')) {
        return Response.json({ code: 0, data: { medias: [{ id: 123, title: '教程', intro: '完整简介', upper: { name: '老师' }, tname: '知识', type: 2 }], has_more: false } })
      }
      if (url.includes('media_id=102')) {
        return Response.json({ code: 0, data: { medias: [{ id: 123, title: '教程', intro: '完整简介', upper: { name: '老师' }, tname: '知识', type: 2 }], has_more: false } })
      }
      if (url.includes('/x/tag/archive/tags')) {
        return Response.json({ code: 0, data: [{ tag_name: '学习' }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.sourceFolders).toHaveLength(2)
    expect(result.sourceFolders[0].videos[0]).toMatchObject({
      aid: 123,
      title: '教程',
      description: '完整简介',
      author: '老师',
      category: '知识',
      tags: []
    })
    expect(result.scanProgress).toMatchObject({
      basic: { completed: 1, total: 1, status: 'complete' },
      tags: { completed: 0, total: 1, pending: 1, succeeded: 0, failed: 0, status: 'running' }
    })
    expect(requests.filter((url) => url.includes('/x/tag/archive/tags'))).toHaveLength(0)
    const persisted = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(persisted.progress.total).toBe(1)
  })

  it('keeps the scan worker tag progress within its total after persisted progress is corrupted', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }] } })
      }
      if (url.includes('/x/v3/fav/resource/list')) {
        return Response.json({ code: 0, data: { medias: [{ id: 123, title: '教程', type: 2 }], has_more: false } })
      }
      if (url.includes('/x/tag/archive/tags')) {
        return Response.json({ code: 0, data: [{ tag_name: '学习' }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const key = 'bilimi:old-favorite-tag-enrichment:v1'
    const corrupted = JSON.parse(localStorage.getItem(key) ?? '{}')
    corrupted.progress = { ...corrupted.progress, completed: 10, total: 1, pending: 1, status: 'running' }
    localStorage.setItem(key, JSON.stringify(corrupted))
    ;(window as typeof window & { __bilimiStartOldFavoriteTagWorker?: () => void })
      .__bilimiStartOldFavoriteTagWorker?.()
    await vi.advanceTimersByTimeAsync(1200)

    const stored = JSON.parse(localStorage.getItem(key) ?? '{}')
    expect(stored.progress.completed).toBeLessThanOrEqual(stored.progress.total)
    expect(stored.progress.pending).toBeLessThanOrEqual(stored.progress.total)
    vi.useRealTimers()
  })

  it('counts current cache hits as completed tag enrichment without double-counting pending videos', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: { '123': { tags: ['已缓存'], updatedAt: Date.now() } },
      queue: [999],
      progress: { completed: 8, total: 10, pending: 2, cacheHits: 3, succeeded: 5, failed: 0, status: 'paused' }
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }] } })
      if (url.includes('/x/v3/fav/resource/list')) return Response.json({ code: 0, data: { medias: [
        { id: 123, title: '缓存视频', type: 2 },
        { id: 456, title: '待补视频', type: 2 }
      ], has_more: false } })
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(result.scanProgress.tags).toMatchObject({ completed: 1, total: 2, pending: 1, cacheHits: 1, failed: 0 })
    expect(JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').queue).toEqual([456])
  })

  it('returns the persisted full-scan run id when every tag is already cached', async () => {
    installCookies()
    localStorage.clear()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: { '123': { tags: ['已缓存'], updatedAt: Date.now() } },
      queue: [],
      progress: { completed: 0, total: 0, pending: 0, status: 'complete' }
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹', media_count: 1 }] } })
      }
      return Response.json({
        code: 0,
        data: { medias: [{ id: 123, title: '缓存视频', type: 2 }], has_more: false }
      })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(result.scanProgress.tags).toMatchObject({ completed: 1, total: 1, pending: 0, status: 'complete' })
    expect(result.scanProgress.basic.runId).toEqual(expect.any(String))
    expect(stored.lastScan.basic.runId).toBe(result.scanProgress.basic.runId)
  })

  it('counts a cached empty tag response as completed instead of leaving impossible progress', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: { '123': { tags: [], updatedAt: Date.now() } }, queue: [], progress: {}
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }] } })
      if (url.includes('/x/v3/fav/resource/list')) return Response.json({ code: 0, data: { medias: [{ id: 123, title: '无标签视频', type: 2 }], has_more: false } })
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(result.scanProgress.tags).toMatchObject({ completed: 1, total: 1, pending: 0, cacheHits: 1, status: 'complete' })
  })

  it('does not queue a duplicate aid when another folder already supplied its tags', async () => {
    installCookies()
    localStorage.clear()
    const tagRequests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) return Response.json({ code: 0, data: { list: [{ id: 101, title: '一' }, { id: 102, title: '二' }] } })
      if (url.includes('media_id=101')) return Response.json({ code: 0, data: { medias: [{ id: 123, title: '重复视频', type: 2, tags: ['现成标签'] }], has_more: false } })
      if (url.includes('media_id=102')) return Response.json({ code: 0, data: { medias: [{ id: 123, title: '重复视频', type: 2 }], has_more: false } })
      if (url.includes('/x/tag/archive/tags')) {
        tagRequests.push(url)
        return Response.json({ code: 0, data: [] })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(tagRequests).toEqual([])
    expect(result.sourceFolders.map((folder: { videos: Array<{ tags: string[] }> }) => folder.videos[0].tags)).toEqual([
      ['现成标签'], ['现成标签']
    ])
    expect(result.scanProgress.tags).toMatchObject({ completed: 1, total: 1, pending: 0 })
  })

  it('invalidates an older persisted worker before replacing its queue', async () => {
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {}, queue: [999], controlRevision: 4,
      progress: { completed: 0, total: 1, pending: 1, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' }
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }] } })
      if (url.includes('/x/v3/fav/resource/list')) return Response.json({ code: 0, data: { medias: [{ id: 123, title: '新扫描', type: 2, tags: ['标签'] }], has_more: false } })
      throw new Error(`Unexpected request: ${url}`)
    }))

    await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(stored.controlRevision).toBe(5)
    expect(stored.queue).toEqual([])
  })

  it('hands a replacement scan queue from an older worker to the current worker automatically', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {}, queue: [999], controlRevision: 4,
      progress: { completed: 0, total: 1, pending: 1, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' }
    }))
    let resolveOldRequest!: (response: Response) => void
    let resolveNewRequest!: (response: Response) => void
    const oldRequest = new Promise<Response>((resolve) => { resolveOldRequest = resolve })
    const newRequest = new Promise<Response>((resolve) => { resolveNewRequest = resolve })
    let newAidRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }] } })
      if (url.includes('/x/v3/fav/resource/list')) return Response.json({ code: 0, data: { medias: [{ id: 123, title: '新扫描', type: 2 }], has_more: false } })
      if (url.includes('aid=999')) return oldRequest
      if (url.includes('aid=123')) {
        newAidRequests += 1
        return newRequest
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    await window.eval(buildOldFavoriteTagEnrichmentScript('resume'))
    await vi.advanceTimersByTimeAsync(1_000)
    const scanPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(1_000)
    resolveOldRequest(Response.json({ code: 0, data: [{ tag_name: '旧标签' }] }))
    await vi.advanceTimersByTimeAsync(1_000)
    await scanPromise
    await vi.advanceTimersByTimeAsync(1_000)
    expect(newAidRequests).toBe(1)
    resolveNewRequest(Response.json({ code: 0, data: [{ tag_name: '新标签' }] }))
    await vi.runAllTimersAsync()

    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(stored.progress).toMatchObject({ completed: 1, total: 1, pending: 0, status: 'complete' })
    vi.useRealTimers()
  })

  it('does not restore an older queue when its pending tag request rejects after a replacement scan', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {}, queue: [999], controlRevision: 4,
      progress: { completed: 0, total: 1, pending: 1, cacheHits: 0, succeeded: 0, failed: 0, status: 'paused' }
    }))
    let rejectOldRequest!: (error: Error) => void
    const oldRequest = new Promise<Response>((_, reject) => { rejectOldRequest = reject })
    let oldAidRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }] } })
      if (url.includes('/x/v3/fav/resource/list')) return Response.json({ code: 0, data: { medias: [{ id: 123, title: '新扫描', type: 2, tags: ['新标签'] }], has_more: false } })
      if (url.includes('aid=999')) {
        oldAidRequests += 1
        return oldRequest
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    await window.eval(buildOldFavoriteTagEnrichmentScript('resume'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(oldAidRequests).toBe(1)
    await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    rejectOldRequest(new Error('-412'))
    await vi.advanceTimersByTimeAsync(1)

    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(stored.queue).toEqual([])
    expect(stored.progress).toMatchObject({ completed: 1, total: 1, pending: 0, status: 'complete' })
    vi.useRealTimers()
  })

  it('persists intermediate basic discovery progress after each resource page', async () => {
    installCookies()
    localStorage.clear()
    let observedProgress: unknown
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }] } })
      if (url.includes('pn=1')) {
        observedProgress = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').lastScan?.basic
        return Response.json({ code: 0, data: { medias: [{ id: 1, title: '第一页', type: 2, tags: ['现成'] }], has_more: true } })
      }
      if (url.includes('pn=2')) return Response.json({ code: 0, data: { medias: [], has_more: false } })
      throw new Error(`Unexpected request: ${url}`)
    }))
    await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    expect(observedProgress).toMatchObject({ completed: 0, total: 0, status: 'running' })
    const finalProgress = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').lastScan.basic
    expect(finalProgress).toMatchObject({ completed: 1, total: 1, status: 'complete' })
  })

  it('replaces obsolete protected targets after the single desired physical shard succeeds', async () => {
    installCookies()
    const requests: URLSearchParams[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [
            { id: 9001, title: 'bilimi·旧分类' },
            { id: 9002, title: 'bilimi·知识学习', media_count: 1000 },
            { id: 9012, title: 'bilimi·知识学习·2', media_count: 999 }
          ] } })
        }
        if (url.includes('/x/v3/fav/resource/ids')) {
          const mediaId = new URL(url).searchParams.get('media_id')
          const count = mediaId === '9002' ? 1000 : mediaId === '9012' ? 999 : 1
          return Response.json({ code: 0, data: Array.from({ length: count }, (_, index) => ({ id: index + 1, type: 2 })) })
        }
        if (url.includes('/x/v3/fav/resource/deal')) {
          requests.push(new URLSearchParams(init?.body?.toString()))
          return Response.json({ code: 0, data: {} })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 5000,
          title: '重新整理视频',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          desiredTargetFolderIds: ['9002'],
          currentBilimiFolderIds: ['9001'],
          reorganizeProtected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: true,
      completedItems: [
        expect.objectContaining({
          aid: 5000,
          finalFolderIds: ['9012'],
          addedFolderIds: ['9012'],
          removedFolderIds: ['9001']
        })
      ]
    })
    expect(requests).toHaveLength(2)
    expect(requests[0].get('add_media_ids')).toBe('9012')
    expect(requests[1].get('del_media_ids')).toBe('9001')
  })

  it('does not remove old Bilimi targets when adding a replacement fails', async () => {
    installCookies()
    const requests: URLSearchParams[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/x/v3/fav/resource/deal')) {
          const body = new URLSearchParams(init?.body?.toString())
          requests.push(body)
          return Response.json({ code: -101, message: 'add failed', data: {} })
        }
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '加入失败',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          desiredTargetFolderIds: ['9002'],
          currentBilimiFolderIds: ['9001'],
          reorganizeProtected: true
        }
      ])
    )

    expect(result.ok).toBe(false)
    expect(requests).toHaveLength(1)
    expect(requests[0].has('del_media_ids')).toBe(false)
  })

  it('keeps protected targets append-only when multiple formal targets are desired', async () => {
    installCookies()
    const requests: URLSearchParams[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/x/v3/fav/resource/deal')) {
          const body = new URLSearchParams(init?.body?.toString())
          requests.push(body)
          return Response.json({ code: 0, data: {} })
        }
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '移出失败',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          desiredTargetFolderIds: ['9002', '9003'],
          currentBilimiFolderIds: ['9001'],
          reorganizeProtected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: true,
      completedItems: [expect.objectContaining({
        aid: 123,
        finalFolderIds: ['9001', '9002', '9003'],
        addedFolderIds: ['9002', '9003'],
        removedFolderIds: []
      })]
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].get('add_media_ids')).toBe('9002,9003')
    expect(requests[0].has('del_media_ids')).toBe(false)
  })

  it('pauses protected reorganization with an unknown result when its physical shard append aborts', async () => {
    installCookies()
    const dealBodies: URLSearchParams[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 9002, title: 'bilimi·知识' }] } })
      }
      if (url.includes('/x/v3/fav/resource/ids')) return Response.json({ code: 0, data: [] })
      if (url.includes('/x/v3/fav/resource/deal')) {
        dealBodies.push(new URLSearchParams(init?.body?.toString()))
        throw new DOMException('network interrupted', 'AbortError')
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 123,
      title: '结果未知的重整',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9002',
      targetDisplayName: 'bilimi·知识',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true,
      desiredTargetFolderIds: ['9002'],
      currentBilimiFolderIds: ['9001'],
      reorganizeProtected: true
    }]))

    expect(result).toMatchObject({
      ok: false,
      paused: true,
      resultUnknown: true,
      missingTargets: ['favorite-ledger-reconcile:123']
    })
    expect(dealBodies).toHaveLength(1)
    expect(dealBodies[0].get('add_media_ids')).toBe('9002')
    expect(dealBodies[0].has('del_media_ids')).toBe(false)
  })

  it('pauses protected reconciliation when Bilibili protection is detected', async () => {
    installCookies()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: -509, message: 'request too fast' })))

    const result = await window.eval(buildExecuteFavoriteLedgerPlanScript([{
      aid: 123,
      title: '风控中的重新整理',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9002',
      targetDisplayName: 'bilimi·知识学习',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true,
      desiredTargetFolderIds: ['9002'],
      currentBilimiFolderIds: ['9001'],
      reorganizeProtected: true
    }]))

    expect(result).toMatchObject({ ok: false, paused: true, steps: ['api:ledger:protection-paused:123'] })
  })

  it('uses lightweight ids for non-empty managed folders when full resources return HTML', async () => {
    installCookies()
    localStorage.clear()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {},
      queue: [],
      progress: { completed: 0, total: 0, pending: 0, status: 'complete' },
      batchCursor: {
        accountMid: '42', folderId: '101', nextPage: 1, folderOrder: ['101', '9001']
      },
      batchSeenAids: []
    }))
    localStorage.setItem('bilimi:old-favorite-batch-status:v1', JSON.stringify({
      accountMid: '42',
      scanRunId: 'interrupted-run'
    }))
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url)
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 101, title: '普通来源', media_count: 1 },
          { id: 9001, title: 'bilimi·影视动漫', media_count: 1 }
        ] } })
      }
      if (url.includes('/x/v3/fav/resource/ids')) {
        return Response.json({ code: 0, data: [{ id: 7, type: 2 }] })
      }

      const parsed = new URL(url)
      if (parsed.pathname === '/x/v3/fav/resource/list' && parsed.searchParams.get('media_id') === '101') {
        return Response.json({ code: 0, data: {
          medias: [{
            id: 7,
            title: '中断前已追加的视频',
            intro: '普通来源仍提供完整资料',
            upper: { name: '来源 UP' },
            type: 2,
            tags: ['影视']
          }],
          has_more: false
        } })
      }
      if (parsed.pathname === '/x/v3/fav/resource/list' && parsed.searchParams.get('media_id') === '9001') {
        return new Response('<!doctype html><html><body>risk control</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.managedFolderScanComplete).toBe(true)
    expect(result.recoveringPendingBatch).toBe(true)
    expect(result.targetMembership).toEqual({ '9001': [7] })
    expect(result.sourceFolders).toEqual([
      expect.objectContaining({
        id: '101',
        videos: [expect.objectContaining({
          aid: 7,
          title: '中断前已追加的视频',
          author: '来源 UP',
          tags: ['影视']
        })]
      })
    ])
    expect(requests.filter((url) => url.includes('/x/v3/fav/resource/list'))).toHaveLength(1)
    expect(requests.some((url) => url.includes('/x/v3/fav/resource/ids?media_id=9001'))).toBe(true)
    expect(requests.some((url) => /\/resource\/deal|\/folder\/del|unfavorite|archive-confirm/i.test(url))).toBe(false)
  })

  it('fails closed with safe diagnostics when target membership returns HTML', async () => {
    installCookies()
    localStorage.clear()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 101, title: '普通来源', media_count: 0 },
          { id: 9001, title: 'bilimi·影视动漫', media_count: 1 }
        ] } })
      }
      if (url.includes('/x/v3/fav/resource/ids')) {
        const response = new Response('<!doctype html><html><body>login risk page</body></html>', {
          status: 403,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
        Object.defineProperties(response, {
          url: { configurable: true, value: 'https://redirect.invalid/private/session-token?from=favorite' },
          redirected: { configurable: true, value: true }
        })
        return response
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))
    const failure = result.scanDiagnostics.folderFailures.find(
      (item: { folderId?: string }) => item.folderId === '9001'
    )

    expect(result.ok).toBe(true)
    expect(result.managedFolderScanComplete).toBe(false)
    expect(result.targetMembership).not.toHaveProperty('9001')
    expect(failure).toMatchObject({
      operation: 'target-membership',
      httpStatus: 403,
      contentType: 'text/html; charset=utf-8',
      finalUrl: 'https://redirect.invalid',
      redirected: true,
      retainedVideoCount: 0
    })
    expect(JSON.stringify(failure)).not.toContain('login risk page')
    expect(localStorage.getItem('bilimi:old-favorite-batch-status:v1')).not.toBeNull()
  })

  it.each([
    [-101, '账号未登录'],
    [-352, '风控校验失败']
  ])('fails closed when target membership returns API %s', async (code, message) => {
    installCookies()
    localStorage.clear()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 101, title: '普通来源', media_count: 0 },
          { id: 9001, title: 'bilimi·影视动漫', media_count: 1 }
        ] } })
      }
      if (url.includes('/x/v3/fav/resource/ids')) {
        return Response.json({ code, message })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.managedFolderScanComplete).toBe(false)
    expect(result.targetMembership).not.toHaveProperty('9001')
    expect(result.scanDiagnostics.folderFailures).toEqual([
      expect.objectContaining({
        folderId: '9001',
        operation: 'target-membership',
        message: expect.stringContaining(message),
        retainedVideoCount: 0
      })
    ])
    expect(localStorage.getItem('bilimi:old-favorite-batch-status:v1')).not.toBeNull()
  })

  it('scans legacy Bilimi folders and marks managed folder failures as incomplete', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 101, title: '默认收藏夹' },
                { id: 9001, title: ledgers[0].displayName },
                { id: 9009, title: 'bilimi·旧分类' }
              ]
            }
          })
        }

        if (url.includes('media_id=101')) {
          return Response.json({ code: 0, data: { medias: [], has_more: false } })
        }
        if (url.includes('/x/v3/fav/resource/ids') && url.includes('media_id=9001')) {
          return Response.json({ code: 0, data: [{ id: 7, type: 2 }] })
        }
        if (url.includes('/x/v3/fav/resource/ids') && url.includes('media_id=9009')) {
          return Response.json({ code: -500, message: 'failed' })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.managedFolders).toEqual([
      expect.objectContaining({ id: '9001', ledgerId: ledgers[0].id, isInbox: false }),
      expect.objectContaining({ id: '9009', title: 'bilimi·旧分类', isInbox: false })
    ])
    expect(result.targetMembership).toEqual({ '9001': [7] })
    expect(result.managedFolderScanComplete).toBe(false)
  })

  it('returns basic favorites before background tag enrichment finishes', async () => {
    installCookies()
    localStorage.clear()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1)
    const requests: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requests.push(url)

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 101, title: 'Default Favorites' }]
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/list')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 123,
                  title: '角色配队',
                  intro: '深渊配队记录',
                  upper: { name: 'Genshin UP' },
                  type: 2
                }
              ],
              has_more: false
            }
          })
        }

        if (url.includes('/x/tag/archive/tags') && url.includes('aid=123')) {
          return Response.json({
            code: 0,
            data: [{ tag_name: '原神' }, { name: '攻略' }]
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.sourceFolders[0].videos[0]).toMatchObject({
      aid: 123,
      title: '角色配队',
      tags: []
    })
    expect(result.scanProgress.tags).toMatchObject({ completed: 0, total: 1, pending: 1, status: 'running' })

    expect(requests.some((url) => url.includes('/x/tag/archive/tags') && url.includes('aid=123'))).toBe(false)
  })

  it('settles an automatically queued tag as failed after three transient worker attempts', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    let tagAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }] } })
      }
      if (url.includes('/x/v3/fav/resource/list')) {
        return Response.json({ code: 0, data: {
          medias: [{ id: 123, title: '无标签视频', type: 2 }], has_more: false
        } })
      }
      if (url.includes('/x/tag/archive/tags')) {
        tagAttempts += 1
        return Response.json({ code: -500, message: 'temporary failure' })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    ;(window as typeof window & { __bilimiStartOldFavoriteTagWorker?: () => void }).__bilimiStartOldFavoriteTagWorker?.()
    await vi.advanceTimersByTimeAsync(30_000)

    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(tagAttempts).toBe(3)
    expect(stored.queue).toEqual([])
    expect(stored.progress).toMatchObject({ completed: 1, pending: 0, failed: 1, status: 'complete' })
    vi.useRealTimers()
  })

  it('retries a transient favorite folder page failure before marking the scan incomplete', async () => {
    installCookies()
    localStorage.clear()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1)
    let resourceAttempts = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 101, title: 'Default Favorites' }]
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/list')) {
          resourceAttempts += 1
          if (resourceAttempts === 1) {
            return Response.json({ code: -500, message: 'temporary failure' })
          }
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 123,
                  title: 'Tag limited video',
                  intro: '',
                  upper: { name: 'Limited UP' },
                  type: 2
                }
              ],
              has_more: false
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.managedFolderScanComplete).toBe(true)
    expect(resourceAttempts).toBe(2)
  })

  it('refreshes one old favorite video with latest tags and target membership without appending favorites', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game' ? { ...ledger, bilibiliFolderId: '9002' } : ledger
    )
    const requests: Array<{ body?: string; url: string }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 101, title: 'Default Favorites' },
                { id: 9002, title: 'bilimi·游戏专区' }
              ]
            }
          })
        }

        if (url.includes('media_id=101')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 250,
                  title: '用户刚补了标签',
                  intro: '新补标签后应该进游戏区',
                  upper: { name: '游戏 UP' },
                  type: 2
                }
              ],
              has_more: false
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/ids') && url.includes('media_id=9002')) {
          return Response.json({ code: 0, data: [{ id: 250, type: 2 }] })
        }

        if (url.includes('/x/tag/archive/tags') && url.includes('aid=250')) {
          return Response.json({
            code: 0,
            data: [{ name: '原神' }, { tag_name: '攻略' }]
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoriteVideoScript(ledgers, 250))

    expect(result.ok).toBe(true)
    expect(result.sourceFolders).toEqual([
      {
        id: '101',
        title: 'Default Favorites',
        mediaCount: 1,
        scanFailed: false,
        scanStatus: 'complete',
        readVideoCount: 1,
        videos: [
          {
            aid: 250,
            title: '用户刚补了标签',
            description: '新补标签后应该进游戏区',
            author: '游戏 UP',
            tags: ['原神', '攻略'],
            category: ''
          }
        ]
      }
    ])
    expect(result.targetMembership).toEqual({ '9002': [250] })
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'api:favorite:list',
        'api:favorite:scan-video-source:101',
        'api:favorite:scan-video-target:9002'
      ])
    )
    expect(requests.some((request) => request.url.includes('/x/v3/fav/resource/deal'))).toBe(false)
  })

  it('scans Bilimi ledgers as target membership without adding them to business sources', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      if (ledger.id === 'knowledge') {
        return { ...ledger, bilibiliFolderId: '9001' }
      }
      return ledger
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 101, title: 'Default Favorites' },
                { id: 9001, title: 'bilimi·知识' },
                { id: 9008, title: 'bilimi·待分类' }
              ]
            }
          })
        }

        if (url.includes('media_id=101')) {
          return Response.json({
            code: 0,
            data: {
              medias: [{ id: 123, title: 'Machine learning tutorial', type: 2 }],
              has_more: false
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/ids') && url.includes('media_id=9001')) {
          return Response.json({ code: 0, data: [{ id: 789, type: 2 }] })
        }

        if (url.includes('/x/v3/fav/resource/ids') && url.includes('media_id=9008')) {
          return Response.json({ code: 0, data: [{ id: 456, type: 2 }] })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.sourceFolders).toEqual([
      expect.objectContaining({ id: '101', title: 'Default Favorites' })
    ])
    expect(result.targetMembership).toMatchObject({
      '9001': [789],
      '9008': [456]
    })
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'api:favorite:scan-target:9001',
        'api:favorite:scan-target:9008'
      ])
    )
  })

  it('scans only video resources from old favorite folders', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 101, title: 'Default Favorites' }]
            }
          })
        }

        if (url.includes('media_id=101')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                { id: 123, title: 'Video tutorial', intro: 'video', type: 2 },
                { id: 223, title: 'Bangumi episode', intro: 'episode', type: 24 },
                { id: 323, title: 'Article note', intro: 'article', type: 12 },
                { id: 423, title: 'Missing video', intro: 'missing', type: 2, attr: 9 },
                { id: 523, title: 'Link video', intro: 'video by link', link: 'https://www.bilibili.com/video/BV123' }
              ],
              has_more: false
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect((result.sourceFolders[0].videos as Array<{ title: string }>).map((video) => video.title)).toEqual([
      'Video tutorial',
      'Link video'
    ])
  })

  it('reports a readable error when old favorite scan receives html instead of json', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return new Response('<!DOCTYPE html><html><body>login</body></html>', {
            headers: { 'content-type': 'text/html;charset=utf-8' },
            status: 200
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result).toMatchObject({
      ok: false,
      sourceFolders: [],
      targetMembership: {},
      missingTargets: ['favorite-ledger-api']
    })
    expect(result.message).toContain('favorite folder list returned HTML instead of JSON')
    expect(result.message).not.toContain('Unexpected token')
  })

  it('continues scanning old favorites when one resource folder returns html', async () => {
    vi.useFakeTimers()
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 101, title: 'Default Favorites', media_count: 3 },
                { id: 102, title: 'Login Redirect Favorites', media_count: 4 }
              ]
            }
          })
        }

        if (url.includes('media_id=101')) {
          return Response.json({
            code: 0,
            data: {
              medias: [{ id: 123, title: 'Video tutorial', intro: 'video', type: 2 }],
              has_more: false
            }
          })
        }

        if (url.includes('media_id=102')) {
          return new Response('<!DOCTYPE html><html><body>login</body></html>', {
            headers: { 'content-type': 'text/html;charset=utf-8' },
            status: 200
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const resultPromise = window.eval(buildScanOldFavoritesScript(ledgers))
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await resultPromise

    expect(result).toMatchObject({
      ok: true,
      skippedSourceFolderTitles: ['Login Redirect Favorites'],
      sourceFolders: [
        {
          id: '101',
          title: 'Default Favorites',
          mediaCount: 3,
          scanFailed: false,
          videos: [expect.objectContaining({ aid: 123, title: 'Video tutorial' })]
        }
      ],
      missingTargets: []
    })
    expect(result.steps).toEqual([
      'api:favorite:list',
      'api:favorite:scan-source:101',
      'api:favorite:scan-source-failed:102'
    ])
    expect(result.message).toContain('skipped 1 folder')
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('media_id=102'))
    ).toHaveLength(1)
  })

  it('keeps the existing scan run and revision when refreshing one old favorite video', async () => {
    installCookies()
    localStorage.clear()
    const key = 'bilimi:old-favorite-tag-enrichment:v1'
    localStorage.setItem(key, JSON.stringify({
      accountMid: '42',
      controlRevision: 7,
      scanCancelled: false,
      cache: {},
      queue: [],
      progress: { completed: 1, total: 1, pending: 0, status: 'complete' },
      lastScan: {
        sourceFolders: [],
        basic: { completed: 1, total: 1, status: 'complete', runId: 'fixed-full-scan-run' }
      }
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹', media_count: 1 }] } })
      }
      return Response.json({
        code: 0,
        data: {
          medias: [{ id: 123, title: '单视频刷新', type: 2, tags: ['最新标签'] }],
          has_more: false
        }
      })
    }))

    const result = await window.eval(
      buildScanOldFavoriteVideoScript(createDefaultFavoriteLedgers().slice(0, 1), 123)
    )
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}')

    expect(result.scanProgress.basic.runId).toBe('fixed-full-scan-run')
    expect(stored.lastScan.basic.runId).toBe('fixed-full-scan-run')
    expect(stored.controlRevision).toBe(7)
  })

  it('retries a recoverable resource timeout three times and persists the active scan location', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 102, title: '番剧待看' }] } })
      }
      throw new Error('request timeout')
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(1)
    const firstRetry = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').lastScan.basic
    expect(firstRetry).toMatchObject({
      folderId: '102', folderTitle: '番剧待看', page: 1, attempt: 1, phase: 'retrying'
    })
    expect(firstRetry.runId).toEqual(expect.any(String))

    await vi.advanceTimersByTimeAsync(3_500)
    await resultPromise
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('media_id=102'))).toHaveLength(3)
  })

  it.each(['fetch', 'body'] as const)('hard-times out a hanging favorite folder list %s', async (hangAt) => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (hangAt === 'fetch') return new Promise<Response>(() => undefined)
      return {
        headers: { get: () => 'application/json' },
        ok: true,
        statusText: '',
        text: () => new Promise<string>(() => undefined)
      } as Response
    }))

    let settled = false
    void window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
      .finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(10_001)

    expect(settled).toBe(true)
  })

  it('keeps a scan cancelled when cancellation happens while the folder list is pending', async () => {
    installCookies()
    localStorage.clear()
    let resolveList!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return new Promise<Response>((resolve) => { resolveList = resolve })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const scanPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.waitFor(() => expect(resolveList).toEqual(expect.any(Function)))
    const pendingStore = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(pendingStore.lastScan.basic).toMatchObject({
      runId: expect.any(String), status: 'running', phase: 'listing'
    })
    await window.eval(buildOldFavoriteTagEnrichmentScript('cancel-scan'))
    resolveList(Response.json({ code: 0, data: { list: [] } }))

    await expect(scanPromise).resolves.toMatchObject({ cancelled: true })
    const finalStore = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(finalStore.scanCancelled).toBe(true)
    expect(finalStore.lastScan.basic.status).toBe('cancelled')
  })

  it('does not let an older delayed folder list overwrite a newer completed scan', async () => {
    installCookies()
    localStorage.clear()
    let listCall = 0
    let resolveOlderList!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        listCall += 1
        if (listCall === 1) return new Promise<Response>((resolve) => { resolveOlderList = resolve })
        return Response.json({ code: 0, data: { list: [{ id: 202, title: '新扫描收藏夹' }] } })
      }
      if (url.includes('media_id=202')) {
        return Response.json({ code: 0, data: { medias: [{ id: 2020, title: '新扫描视频', type: 2 }], has_more: false } })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const olderScan = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.waitFor(() => expect(resolveOlderList).toEqual(expect.any(Function)))
    const newerResult = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const newerStore = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    resolveOlderList(Response.json({ code: 0, data: { list: [{ id: 101, title: '旧扫描收藏夹' }] } }))

    expect(newerResult.sourceFolders[0].videos[0].aid).toBe(2020)
    await expect(olderScan).resolves.toMatchObject({ cancelled: true })
    const finalStore = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(finalStore.lastScan.basic.runId).toBe(newerStore.lastScan.basic.runId)
    expect(finalStore.lastScan.sourceFolders[0].videos[0].aid).toBe(2020)
  })

  it.each(['fetch', 'body'] as const)('retries a hanging favorite resource %s three times before settling', async (hangAt) => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '悬挂收藏夹' }] } })
      }
      if (hangAt === 'fetch') return new Promise<Response>(() => undefined)
      return {
        headers: { get: () => 'application/json' },
        ok: true,
        statusText: '',
        text: () => new Promise<string>(() => undefined)
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(33_501)
    const result = await resultPromise

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/list'))).toHaveLength(3)
    expect(result.sourceFolders).toEqual([])
    expect(result.scanDiagnostics.folderFailures[0]).toMatchObject({ status: 'failed', failedPage: 1 })
  })

  it.each([
    ['HTTP 412', () => new Response('precondition failed', { status: 412 })],
    ['API -352', () => Response.json({ code: -352, message: 'challenge required' })]
  ] as const)('does not retry terminal resource response %s', async (_label, makeResponse) => {
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '终止收藏夹' }] } })
      }
      return makeResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/list'))).toHaveLength(1)
    expect(result.sourceFolders).toEqual([])
    expect(result.scanDiagnostics.folderFailures[0]).toMatchObject({ status: 'failed', failedPage: 1 })
  })

  it.each([
    [
      'login HTML',
      'https://passport.bilibili.com/login?from=favorite#secret',
      '<html><body>请登录 marker-login-body</body></html>',
      { errorKind: 'html', loginSignal: true, riskSignal: false }
    ],
    [
      'risk HTML',
      'https://api.bilibili.com/x/v3/fav/resource/list?csrf=secret',
      '<html><body>访问频繁，请完成 captcha marker-risk-body</body></html>',
      { errorKind: 'html', loginSignal: false, riskSignal: true }
    ],
    [
      'unknown HTML',
      'https://unexpected.example/challenge?token=secret',
      '<html><body>temporary upstream page marker-unknown-body</body></html>',
      { errorKind: 'html', loginSignal: false, riskSignal: false }
    ]
  ] as const)('keeps safe structured diagnostics for %s without persisting response bodies', async (
    _label,
    responseUrl,
    body,
    expected
  ) => {
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '诊断收藏夹' }] } })
      }
      return {
        ok: true,
        status: 200,
        statusText: '',
        redirected: responseUrl.includes('passport'),
        url: responseUrl,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => body
      } as Response
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const failure = result.scanDiagnostics.folderFailures[0]
    const serialized = JSON.stringify(failure)

    expect(failure).toMatchObject({
      operation: 'resource-list',
      folderId: '101',
      httpStatus: 200,
      contentType: 'text/html; charset=utf-8',
      attempts: 1,
      ...expected
    })
    expect(failure.durationMs).toEqual(expect.any(Number))
    expect(failure.finalUrl).toBe(
      responseUrl.includes('unexpected.example')
        ? 'https://unexpected.example'
        : new URL(responseUrl).origin + new URL(responseUrl).pathname
    )
    expect(serialized).not.toContain('marker-')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('<html')
  })

  it.each([
    [-101, '账号未登录', { loginSignal: true, riskSignal: false }],
    [-352, 'challenge required', { loginSignal: false, riskSignal: true }]
  ] as const)('classifies API code %s without relying on HTML text', async (apiCode, message, signals) => {
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '异常来源' }] } })
      }
      return Response.json({ code: apiCode, message })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(result.scanDiagnostics.folderFailures[0]).toMatchObject({
      folderId: '101',
      apiCode,
      ...signals
    })
  })

  it('opens a global circuit after the first obvious HTML risk failure and keeps the batch pending', async () => {
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: { list: [
            { id: 101, title: '来源一' },
            { id: 102, title: '来源二' },
            { id: 103, title: '来源三' }
          ] }
        })
      }
      return new Response('<html><body>captcha 访问频繁 sensitive-body</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/list'))).toHaveLength(1)
    expect(result.scanDiagnostics.folderFailures).toEqual([
      expect.objectContaining({ folderId: '101', errorKind: 'html', riskSignal: true }),
      expect.objectContaining({ folderId: '102', errorKind: 'global-circuit-open', attempts: 0 }),
      expect.objectContaining({ folderId: '103', errorKind: 'global-circuit-open', attempts: 0 })
    ])
    expect(result.batch).toMatchObject({ hasMore: true, nextCursor: { folderId: '101', nextPage: 1 } })
    expect(JSON.stringify(result.scanDiagnostics)).not.toContain('sensitive-body')
  })

  it('fails a terminal favorite folder list once and closes its listing progress', async () => {
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async () => new Response('precondition failed', { status: 412 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const basic = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').lastScan.basic

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, missingTargets: ['favorite-ledger-api'] })
    expect(basic).toMatchObject({ status: 'failed', phase: 'failed', runId: expect.any(String) })
  })

  it('accepts an empty lightweight membership result when managed folder counts are unknown', async () => {
    installCookies()
    localStorage.clear()
    const folderId = '4037824954'
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: folderId
    }))
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 4037824954, title: 'bilimi·暂存' }] } })
      }
      return Response.json({ code: 0, data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/ids'))).toHaveLength(1)
    expect(result).toMatchObject({
      ok: true,
      managedFolderScanComplete: true,
      targetMembership: { [folderId]: [] },
      sourceFolders: []
    })
    expect(result.scanDiagnostics.folderFailures).toEqual([])
  })

  it.each(['media_count', 'count'] as const)(
    'skips the resource request for a managed folder reliably declared empty by folder-list %s',
    async (countField) => {
      installCookies()
      localStorage.clear()
      const folderId = '40381351854'
      const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
        ...ledger,
        bilibiliFolderId: folderId
      }))
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: { list: [{ id: Number(folderId), title: 'bilimi·honker233', [countField]: 0 }] }
          })
        }
        return new Response('<html>login or risk control</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await window.eval(buildScanOldFavoritesScript(ledgers))

      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/list'))).toHaveLength(0)
      expect(result).toMatchObject({
        ok: true,
        managedFolderScanComplete: true,
        targetMembership: { [folderId]: [] }
      })
      expect(result.scanDiagnostics.folderFailures).toEqual([])
    }
  )

  it('does not skip a managed folder when folder-list counts conflict', async () => {
    installCookies()
    localStorage.clear()
    const folderId = '40381351854'
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: folderId
    }))
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: {
            list: [{
              id: Number(folderId),
              title: 'bilimi·honker233',
              media_count: 0,
              count: 1
            }]
          }
        })
      }
      return new Response('<html>login or risk control</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/ids'))).toHaveLength(1)
    expect(result.managedFolderScanComplete).toBe(false)
    expect(result.targetMembership).toEqual({})
    expect(result.scanDiagnostics.folderFailures).toEqual([
      expect.objectContaining({ folderId, status: 'failed', failedPage: 1 })
    ])
  })

  it.each([
    ['folder count is nonzero', 1, false, 0],
    ['response info count is nonzero', undefined, false, 1],
    ['response claims another page', undefined, true, 0]
  ] as const)('rejects null medias when %s', async (_label, folderCount, hasMore, infoCount) => {
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: { list: [{
            id: 101,
            title: '异常空收藏夹',
            ...(folderCount === undefined ? {} : { media_count: folderCount })
          }] }
        })
      }
      return Response.json({
        code: 0,
        data: { medias: null, has_more: hasMore, info: { media_count: infoCount } }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/list'))).toHaveLength(1)
    expect(result.sourceFolders).toEqual([])
    expect(result.scanDiagnostics.folderFailures[0]).toMatchObject({
      status: 'failed', message: 'favorite resource list returned invalid media data'
    })
  })

  it('rejects a missing medias field when only the resource response declares zero', async () => {
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '字段缺失收藏夹' }] } })
      }
      return Response.json({ code: 0, data: { has_more: false, info: { media_count: 0 } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/list'))).toHaveLength(1)
    expect(result.sourceFolders).toEqual([])
    expect(result.scanDiagnostics.folderFailures[0]).toMatchObject({
      status: 'failed', message: 'favorite resource list returned invalid media data'
    })
  })

  it.each([
    ['both counts are unknown', undefined, undefined, null],
    ['folder count is a numeric string', '0', undefined, null],
    ['folder count is an empty string', '', undefined, null],
    ['folder count is null', null, undefined, null],
    ['response count is whitespace', undefined, '   ', null],
    ['folder count is false', false, undefined, null],
    ['medias is an object', undefined, 0, { id: 1 }],
    ['medias is a string', undefined, 0, '']
  ] as const)('rejects an unreliable empty-folder response when %s', async (
    _label,
    folderCount,
    infoCount,
    medias
  ) => {
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: { list: [{
            id: 101,
            title: '不可靠空收藏夹',
            ...(folderCount === undefined ? {} : { media_count: folderCount })
          }] }
        })
      }
      return Response.json({
        code: 0,
        data: {
          medias,
          has_more: false,
          info: infoCount === undefined ? {} : { media_count: infoCount }
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/list'))).toHaveLength(1)
    expect(result.sourceFolders).toEqual([])
    expect(result.scanDiagnostics.folderFailures[0]).toMatchObject({
      status: 'failed', message: 'favorite resource list returned invalid media data'
    })
  })

  it('cancels a hanging resource request promptly without starting another attempt', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '悬挂收藏夹' }] } })
      }
      return new Promise<Response>(() => undefined)
    })
    vi.stubGlobal('fetch', fetchMock)

    const scanPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(1)
    const pendingBasic = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').lastScan.basic
    expect(pendingBasic).toMatchObject({ folderId: '101', page: 1, attempt: 1, phase: 'requesting' })
    await window.eval(buildOldFavoriteTagEnrichmentScript('cancel-scan'))
    await vi.advanceTimersByTimeAsync(100)

    await expect(scanPromise).resolves.toMatchObject({ cancelled: true })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/list'))).toHaveLength(1)
    const cancelledBasic = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').lastScan.basic
    expect(cancelledBasic).toMatchObject({
      runId: pendingBasic.runId, folderId: '101', page: 1, attempt: 1, phase: 'cancelled', status: 'cancelled'
    })
  })

  it('cancels a resource retry backoff without starting the second attempt', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '退避收藏夹' }] } })
      }
      throw new Error('request timeout')
    })
    vi.stubGlobal('fetch', fetchMock)

    const scanPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(1)
    const retryingBasic = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').lastScan.basic
    expect(retryingBasic).toMatchObject({ folderId: '101', page: 1, attempt: 1, phase: 'retrying' })
    await window.eval(buildOldFavoriteTagEnrichmentScript('cancel-scan'))
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(scanPromise).resolves.toMatchObject({ cancelled: true })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/x/v3/fav/resource/list'))).toHaveLength(1)
    const cancelledBasic = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').lastScan.basic
    expect(cancelledBasic).toMatchObject({
      runId: retryingBasic.runId, folderId: '101', page: 1, attempt: 1, phase: 'cancelled', status: 'cancelled'
    })
  })

  it('polls hanging resource cancellation without repeatedly reading the full tag store', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: Object.fromEntries(Array.from({ length: 2337 }, (_, index) => [String(index + 1), { tags: ['缓存'], updatedAt: 1 }]))
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '大缓存收藏夹' }] } })
      }
      return new Promise<Response>(() => undefined)
    }))

    const scanPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(1)
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    await vi.advanceTimersByTimeAsync(500)

    expect(getItemSpy.mock.calls.filter(([key]) => key === 'bilimi:old-favorite-tag-enrichment:v1')).toHaveLength(0)
    await window.eval(buildOldFavoriteTagEnrichmentScript('cancel-scan'))
    await vi.advanceTimersByTimeAsync(100)
    await expect(scanPromise).resolves.toMatchObject({ cancelled: true })
  })

  it('throttles page discoveries instead of rewriting the checkpoint for every page', async () => {
    installCookies()
    localStorage.clear()
    let pageTwoRequested = false
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '多页收藏夹' }] } })
      }
      const page = Number(new URL(url).searchParams.get('pn'))
      if (page === 1) {
        return Response.json({ code: 0, data: { medias: [{ id: 701, title: '第一页', type: 2 }], has_more: true } })
      }
      pageTwoRequested = true
      return new Promise<Response>(() => undefined)
    }))

    const scanPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.waitFor(() => expect(pageTwoRequested).toBe(true))
    const checkpoint = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}').lastScan

    expect(checkpoint.basic).toMatchObject({ completed: 0, total: 0, folderId: '101', page: 1, attempt: 1, phase: 'requesting' })
    expect(checkpoint.discoveredAids ?? []).toEqual([])
    await window.eval(buildOldFavoriteTagEnrichmentScript('cancel-scan'))
    await expect(scanPromise).resolves.toMatchObject({ cancelled: true })
  })

  it('reports a first-page folder failure with retry diagnostics and second-level backoff', async () => {
    vi.useFakeTimers()
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1)
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 102, title: '番剧待看', media_count: 137 }] } })
      }
      if (url.includes('media_id=102')) throw new Error('request timeout')
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = window.eval(buildScanOldFavoritesScript(ledgers))
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('media_id=102'))).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('media_id=102'))).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2499)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('media_id=102'))).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    const result = await resultPromise

    expect(result.sourceFolders).toEqual([])
    expect(result.scanDiagnostics.folderFailures).toEqual([expect.objectContaining({
      folderId: '102', folderTitle: '番剧待看', failedPage: 1, attempts: 3,
      status: 'failed', message: 'request timeout', retainedVideoCount: 0
    })])
  })

  it('does not retain target membership when the lightweight response has invalid schema', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 9001, title: 'bilimi·影视动漫', media_count: 45 }] } })
      }
      return Response.json({ code: 0, data: { ids: [{ id: 701, type: 2 }], has_more: true } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.managedFolderScanComplete).toBe(false)
    expect(result.targetMembership).not.toHaveProperty('9001')
    expect(result.sourceFolders).toEqual([])
    expect(result.scanDiagnostics.folderFailures).toEqual([expect.objectContaining({
      folderId: '9001', failedPage: 1, attempts: 1, status: 'failed',
      operation: 'target-membership', retainedVideoCount: 0
    })])
  })

  it('keeps partial-only videos out of business totals and the tag queue', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '课程', media_count: 40 }] } })
      }
      const page = Number(new URL(url).searchParams.get('pn'))
      if (page === 1) return Response.json({ code: 0, data: { medias: [{ id: 701, title: '仅部分来源', type: 2 }], has_more: true } })
      throw new Error('request timeout')
    }))

    const resultPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(3500)
    const result = await resultPromise
    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(result.sourceFolders).toEqual([])
    expect(result.scanDiagnostics.folderFailures).toEqual([expect.objectContaining({
      folderId: '101', status: 'partial', retainedVideoCount: 1
    })])
    expect(result.scanProgress.basic).toMatchObject({ completed: 0, total: 0 })
    expect(result.scanProgress.tags).toMatchObject({ completed: 0, total: 0, pending: 0 })
    expect(result.scanDiagnostics).toMatchObject({ taggedVideos: 0, untaggedVideos: 0 })
    expect(stored.queue).toEqual([])
  })

  it('counts an aid from a complete source once when the same aid also occurs in a partial source', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 101, title: '部分课程', media_count: 40 },
          { id: 102, title: '完整课程', media_count: 1 }
        ] } })
      }
      const parsed = new URL(url)
      const folderId = parsed.searchParams.get('media_id')
      const page = Number(parsed.searchParams.get('pn'))
      if (folderId === '101' && page > 1) throw new Error('request timeout')
      return Response.json({ code: 0, data: {
        medias: [{ id: 701, title: '重复视频', type: 2 }],
        has_more: folderId === '101'
      } })
    }))

    const resultPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(3500)
    const result = await resultPromise
    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(result.scanProgress.basic).toMatchObject({ completed: 1, total: 1 })
    expect(result.scanProgress.tags).toMatchObject({ total: 1, pending: 1 })
    expect(stored.queue).toEqual([701])
  })

  it('retries an empty page that claims more results instead of treating it as complete', async () => {
    vi.useFakeTimers()
    installCookies()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '异常收藏夹', media_count: 20 }] } })
      }
      return Response.json({ code: 0, data: { medias: [], has_more: true } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(3500)
    const result = await resultPromise

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('media_id=101'))).toHaveLength(3)
    expect(result.sourceFolders).toEqual([])
    expect(result.scanDiagnostics.folderFailures[0]).toMatchObject({ status: 'failed', failedPage: 1 })
  })

  it('cancels an older scan when a newer scan advances the persisted revision', async () => {
    installCookies()
    localStorage.clear()
    let resourceCall = 0
    let resolveOlderResource!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '默认收藏夹' }] } })
      }
      resourceCall += 1
      if (resourceCall === 1) {
        return new Promise<Response>((resolve) => { resolveOlderResource = resolve })
      }
      return Response.json({ code: 0, data: { medias: [{ id: 202, title: '新扫描', type: 2 }], has_more: false } })
    }))

    const olderScan = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.waitFor(() => expect(resourceCall).toBe(1))
    const newerScan = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await expect(newerScan).resolves.toMatchObject({ ok: true })
    resolveOlderResource(Response.json({ code: 0, data: { medias: [{ id: 101, title: '旧扫描', type: 2 }], has_more: false } }))

    await expect(olderScan).resolves.toMatchObject({ cancelled: true, sourceFolders: [] })
    const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
    expect(stored.lastScan.basic).toMatchObject({
      completed: 1, total: 1, status: 'complete', runId: expect.any(String)
    })
  })

  it('returns a structured cancellation when revision changes between resource pages', async () => {
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '多页收藏夹' }] } })
      }
      queueMicrotask(() => { void window.eval(buildOldFavoriteTagEnrichmentScript('cancel-scan')) })
      return Response.json({
        code: 0,
        data: { medias: [{ id: 701, title: '第一页', type: 2 }], has_more: true }
      })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(result).toMatchObject({ cancelled: true, sourceFolders: [] })
    expect(result.steps).toContain('api:favorite:scan-cancelled')
    expect(result.message).toBe('old favorite scan cancelled')
  })

  it('scans every unique video in one user batch without a visible 3000 item cap', async () => {
    installCookies()
    localStorage.clear()
    const requestedPages: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: { list: [{ id: 101, title: '三千零二十条收藏', media_count: 3020 }] }
        })
      }
      const page = Number(new URL(url).searchParams.get('pn'))
      requestedPages.push(page)
      const firstAid = (page - 1) * 20 + 1
      return Response.json({
        code: 0,
        data: {
          medias: Array.from({ length: 20 }, (_, index) => ({
            id: firstAid + index,
            title: `第 ${firstAid + index} 条`,
            type: 2,
            tags: ['现成标签']
          })),
          has_more: page < 151
        }
      })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const store = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(result.scanProgress.basic).toMatchObject({ completed: 3020, total: 3020, status: 'complete' })
    expect(result.batch).toMatchObject({ hasMore: false })
    expect(result.sourceFolders[0].videos).toHaveLength(3020)
    expect(result.batch.nextCursor).toBeUndefined()
    expect(store.batchCursor).toBeUndefined()
    expect(store.batchSeenAids).toBeUndefined()
    expect(requestedPages.at(-1)).toBe(151)
  })

  it('publishes the first frozen 2000-video segment before the remaining scan finishes', async () => {
    installCookies()
    localStorage.clear()
    let releasePage101: (() => void) | undefined
    const page101Blocked = new Promise<void>((resolve) => { releasePage101 = resolve })
    let reachedPage101: (() => void) | undefined
    const page101Reached = new Promise<void>((resolve) => { reachedPage101 = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: { list: [{ id: 101, title: '三万条收藏', media_count: 30_000 }] }
        })
      }
      const page = Number(new URL(url).searchParams.get('pn'))
      if (page === 101) {
        reachedPage101?.()
        await page101Blocked
      }
      const firstAid = (page - 1) * 20 + 1
      return Response.json({ code: 0, data: {
        medias: Array.from({ length: 20 }, (_, index) => ({
          id: firstAid + index,
          title: `第 ${firstAid + index} 条`,
          type: 2,
          tags: ['现成标签']
        })),
        has_more: page < 1500
      } })
    }))

    const scanPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await page101Reached
    const firstProgress = await window.eval(buildOldFavoriteTagEnrichmentScript('progress'))
    const secondProgress = await window.eval(buildOldFavoriteTagEnrichmentScript('progress'))

    expect(firstProgress.scanProgress.basic.status).toBe('running')
    expect(firstProgress.discoveredAids).toHaveLength(2_000)
    expect(secondProgress.discoveredAids).toEqual([])
    expect(firstProgress.readySegments).toHaveLength(1)
    expect(firstProgress.readySegments[0]).toMatchObject({ index: 0, status: 'ready' })
    expect(firstProgress.readySegments[0].aids).toHaveLength(2_000)
    expect(firstProgress.readySegments[0].sourceFolders[0].videos).toHaveLength(2_000)
    expect(secondProgress.readySegments).toEqual([])
    expect(secondProgress.sourceUpdates).toEqual([])

    await window.eval(buildOldFavoriteTagEnrichmentScript('cancel-scan'))
    releasePage101?.()
    await scanPromise
  })

  it('settles missing tags for a frozen segment while later discovery remains blocked', async () => {
    installCookies()
    localStorage.clear()
    let releasePage101: (() => void) | undefined
    const page101Blocked = new Promise<void>((resolve) => { releasePage101 = resolve })
    let reachedPage101: (() => void) | undefined
    const page101Reached = new Promise<void>((resolve) => { reachedPage101 = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '流水收藏', media_count: 2020 }] } })
      }
      if (url.includes('/x/tag/archive/tags')) {
        return Response.json({ code: 0, data: [{ tag_name: '后台补齐' }] })
      }
      const page = Number(new URL(url).searchParams.get('pn'))
      if (page === 101) {
        reachedPage101?.()
        await page101Blocked
      }
      const firstAid = (page - 1) * 20 + 1
      return Response.json({ code: 0, data: {
        medias: Array.from({ length: 20 }, (_, index) => ({
          id: firstAid + index,
          title: `第 ${firstAid + index} 条`,
          type: 2,
          ...(firstAid + index === 2000 ? {} : { tags: ['现成标签'] })
        })),
        has_more: page < 101
      } })
    }))

    const scanPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await page101Reached
    let progress
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve()
      progress = await window.eval(buildOldFavoriteTagEnrichmentScript('progress'))
      if (progress.readySegments?.length) break
    }

    expect(progress.scanProgress.basic.status).toBe('running')
    expect(progress.readySegments).toHaveLength(1)
    expect(progress.readySegments[0].sourceFolders[0].videos.at(-1)).toMatchObject({
      aid: 2000,
      tags: ['后台补齐']
    })

    await window.eval(buildOldFavoriteTagEnrichmentScript('cancel-scan'))
    releasePage101?.()
    await scanPromise
  })

  it('keeps the final partial segment pending until its tags reach a terminal state', async () => {
    installCookies()
    localStorage.clear()
    let tagRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '末段收藏', media_count: 1001 }] } })
      }
      if (url.includes('/x/tag/archive/tags')) {
        tagRequests += 1
        return Response.json({ code: 0, data: [{ tag_name: '末段标签' }] })
      }
      return Response.json({ code: 0, data: {
        medias: Array.from({ length: 1001 }, (_, index) => ({
          id: index + 1, title: `第 ${index + 1} 条`, type: 2,
          ...(index === 1000 ? {} : { tags: ['现成标签'] })
        })),
        has_more: false
      } })
    }))

    await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const progress = await window.eval(buildOldFavoriteTagEnrichmentScript('progress'))

    expect(progress.readySegments).toHaveLength(1)
    expect(progress.readySegments[0]).toMatchObject({ status: 'ready' })
    expect(progress.readySegments[0].sourceFolders[0].videos.at(-1).tags).toEqual(['末段标签'])
    expect(tagRequests).toBe(1)
  })

  it('does not enqueue a frozen segment aid again when its streaming tag settles at scan completion', async () => {
    installCookies()
    localStorage.clear()
    let tagRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '完整分段', media_count: 2000 }] } })
      }
      if (url.includes('/x/tag/archive/tags')) {
        tagRequests += 1
        return Response.json({ code: 0, data: [{ tag_name: '只补一次' }] })
      }
      return Response.json({ code: 0, data: {
        medias: Array.from({ length: 2000 }, (_, index) => ({
          id: index + 1, title: `第 ${index + 1} 条`, type: 2,
          ...(index === 1999 ? {} : { tags: ['现成标签'] })
        })),
        has_more: false
      } })
    }))

    await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const progress = await window.eval(buildOldFavoriteTagEnrichmentScript('progress'))
    const store = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(tagRequests).toBe(1)
    expect(store.queue).toEqual([])
    expect(progress.readySegments[0].sourceFolders[0].videos.at(-1).tags).toEqual(['只补一次'])
  })

  it('keeps streaming segment tag requests on one low-speed consumer', async () => {
    installCookies()
    localStorage.clear()
    let activeTagRequests = 0
    let peakTagRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '双分段', media_count: 4000 }] } })
      }
      if (url.includes('/x/tag/archive/tags')) {
        activeTagRequests += 1
        peakTagRequests = Math.max(peakTagRequests, activeTagRequests)
        await Promise.resolve()
        activeTagRequests -= 1
        return Response.json({ code: 0, data: [{ tag_name: '串行标签' }] })
      }
      return Response.json({ code: 0, data: {
        medias: Array.from({ length: 4000 }, (_, index) => ({
          id: index + 1, title: `第 ${index + 1} 条`, type: 2,
          ...([1999, 3999].includes(index) ? {} : { tags: ['现成标签'] })
        })),
        has_more: false
      } })
    }))

    await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(peakTagRequests).toBe(1)
  })

  it('pauses a streaming segment on risk control without requesting later aids or publishing ready', async () => {
    installCookies()
    localStorage.clear()
    const requestedTagAids: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '风控分段', media_count: 2000 }] } })
      }
      if (url.includes('/x/tag/archive/tags')) {
        requestedTagAids.push(Number(new URL(url).searchParams.get('aid')))
        return Response.json({ code: -412, message: 'risk control' })
      }
      return Response.json({ code: 0, data: {
        medias: Array.from({ length: 2000 }, (_, index) => ({
          id: index + 1, title: `第 ${index + 1} 条`, type: 2,
          ...(index < 1998 ? { tags: ['现成标签'] } : {})
        })),
        has_more: false
      } })
    }))

    await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const progress = await window.eval(buildOldFavoriteTagEnrichmentScript('progress'))

    expect(requestedTagAids).toEqual([1999])
    expect(progress.readySegments).toEqual([])
    expect(progress.scanProgress.tags).toMatchObject({
      status: 'paused',
      errorKind: 'risk-control',
      errorCode: -412,
      errorMessage: expect.stringContaining('risk control')
    })
  })

  it('stops the streaming segment tail when scan cancellation lands during a tag request', async () => {
    installCookies()
    localStorage.clear()
    let resolveFirstTag: ((response: Response) => void) | undefined
    let firstTagStarted: (() => void) | undefined
    const firstTagPending = new Promise<void>((resolve) => { firstTagStarted = resolve })
    const requestedTagAids: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '可取消分段', media_count: 2000 }] } })
      }
      if (url.includes('/x/tag/archive/tags')) {
        requestedTagAids.push(Number(new URL(url).searchParams.get('aid')))
        firstTagStarted?.()
        return new Promise<Response>((resolve) => { resolveFirstTag = resolve })
      }
      return Response.json({ code: 0, data: {
        medias: Array.from({ length: 2000 }, (_, index) => ({
          id: index + 1, title: `第 ${index + 1} 条`, type: 2,
          ...(index < 1998 ? { tags: ['现成标签'] } : {})
        })),
        has_more: false
      } })
    }))

    const scanPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await firstTagPending
    await window.eval(buildOldFavoriteTagEnrichmentScript('cancel-scan'))
    resolveFirstTag?.(Response.json({ code: 0, data: [{ tag_name: '过期结果' }] }))
    await scanPromise
    const progress = await window.eval(buildOldFavoriteTagEnrichmentScript('progress'))

    expect(requestedTagAids).toEqual([1999])
    expect(progress.readySegments).toEqual([])
  })

  it('fully scans managed membership without consuming business batch capacity', async () => {
    installCookies()
    localStorage.clear()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    const observedBasicCompleted: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: { list: [{ id: 9001, title: 'bilimi·影视动漫', media_count: 3040 }] }
        })
      }
      const stored = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')
      observedBasicCompleted.push(Number(stored.lastScan?.basic?.completed ?? 0))
      return Response.json({
        code: 0,
        data: Array.from({ length: 3040 }, (_, index) => ({ id: index + 1, type: 2 }))
      })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.managedFolderScanComplete).toBe(true)
    expect(result.targetMembership['9001']).toHaveLength(3040)
    expect(result.sourceFolders).toEqual([])
    expect(result.scanProgress.basic).toMatchObject({ completed: 0, total: 0, status: 'complete' })
    expect(result.batch).toMatchObject({ hasMore: false })
    expect(Math.max(0, ...observedBasicCompleted)).toBe(0)
  })

  it('keeps all 3000 business slots when a managed folder is scanned first', async () => {
    installCookies()
    localStorage.clear()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·影视动漫', media_count: 100 },
          { id: 101, title: '普通来源', media_count: 3000 }
        ] } })
      }
      const parsed = new URL(url)
      const folderId = parsed.searchParams.get('media_id')
      const page = Number(parsed.searchParams.get('pn'))
      if (folderId === '9001') {
        return Response.json({
          code: 0,
          data: Array.from({ length: 100 }, (_, index) => ({ id: 9000 + index, type: 2 }))
        })
      }
      const firstAid = (page - 1) * 20 + 1
      return Response.json({ code: 0, data: {
        medias: Array.from({ length: 20 }, (_, index) => ({
          id: firstAid + index, title: `第 ${firstAid + index} 条`, type: 2, tags: ['现成标签']
        })),
        has_more: page < 150
      } })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.targetMembership['9001']).toHaveLength(100)
    expect(result.scanProgress.basic.completed).toBe(3000)
    expect(result.sourceFolders).toHaveLength(1)
    expect(result.sourceFolders[0]).toMatchObject({ id: '101' })
    expect(result.sourceFolders[0].videos).toHaveLength(3000)
  })

  it('rescans managed folders that appear before a committed ordinary cursor', async () => {
    installCookies()
    localStorage.clear()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {},
      queue: [],
      progress: { completed: 0, total: 0, pending: 0, status: 'complete' },
      batchCursor: {
        accountMid: '42', folderId: '101', nextPage: 2, folderOrder: ['9001', '101']
      },
      batchSeenAids: [1]
    }))
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    const requestedFolderPages: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 9001, title: 'bilimi·影视动漫', media_count: 1 },
          { id: 101, title: '普通来源', media_count: 21 }
        ] } })
      }
      const parsed = new URL(url)
      const folderId = parsed.searchParams.get('media_id') ?? ''
      const page = parsed.searchParams.get('pn') ?? ''
      requestedFolderPages.push(`${folderId}:${page}`)
      if (folderId === '9001') {
        return Response.json({ code: 0, data: [{ id: 9999, type: 2 }] })
      }
      return Response.json({ code: 0, data: {
        medias: [{ id: 21, title: '续扫视频', type: 2, tags: ['现成标签'] }], has_more: false
      } })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(requestedFolderPages).toContain('9001:')
    expect(requestedFolderPages).toContain('101:2')
    expect(result.targetMembership['9001']).toEqual([9999])
    expect(result.sourceFolders[0].videos.map((video: { aid: number }) => video.aid)).toEqual([21])
  })

  it('deduplicates an aid globally when it appears in multiple source folders in one user batch', async () => {
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 101, title: '第一批', media_count: 3000 },
          { id: 102, title: '第二批', media_count: 20 }
        ] } })
      }
      const parsed = new URL(url)
      const folderId = parsed.searchParams.get('media_id')
      const page = Number(parsed.searchParams.get('pn'))
      if (folderId === '101') {
        const firstAid = (page - 1) * 20 + 1
        return Response.json({ code: 0, data: {
          medias: Array.from({ length: 20 }, (_, index) => ({
            id: firstAid + index, title: `第 ${firstAid + index} 条`, type: 2, tags: ['现成标签']
          })),
          has_more: page < 150
        } })
      }
      return Response.json({ code: 0, data: {
        medias: [
          { id: 1, title: '跨收藏夹重复视频', type: 2, tags: ['现成标签'] },
          ...Array.from({ length: 19 }, (_, index) => ({
            id: 3001 + index, title: `第 ${3001 + index} 条`, type: 2, tags: ['现成标签']
          }))
        ],
        has_more: false
      } })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const allAids = result.sourceFolders.flatMap(
      (folder: { videos: Array<{ aid: number }> }) => folder.videos.map((video) => video.aid)
    )

    expect(result.scanProgress.basic.completed).toBe(3019)
    expect(result.batch).toMatchObject({ hasMore: false })
    expect(allAids.filter((aid: number) => aid === 1)).toHaveLength(2)
    expect(new Set(allAids).size).toBe(3019)
  })

  it('still fully scans later managed folders after an earlier source fills the business batch', async () => {
    installCookies()
    localStorage.clear()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 101, title: '普通来源', media_count: 3000 },
          { id: 9001, title: 'bilimi·影视动漫', media_count: 1 }
        ] } })
      }
      const parsed = new URL(url)
      const folderId = parsed.searchParams.get('media_id')
      const page = Number(parsed.searchParams.get('pn'))
      if (folderId === '9001') {
        return Response.json({ code: 0, data: [{ id: 9999, type: 2 }] })
      }
      const firstAid = (page - 1) * 20 + 1
      return Response.json({ code: 0, data: {
        medias: Array.from({ length: 20 }, (_, index) => ({
          id: firstAid + index, title: `第 ${firstAid + index} 条`, type: 2, tags: ['现成标签']
        })),
        has_more: page < 150
      } })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.scanProgress.basic.completed).toBe(3000)
    expect(result.managedFolderScanComplete).toBe(true)
    expect(result.targetMembership['9001']).toEqual([9999])
  })

  it('does not commit an ordinary failure cursor while retaining later successful batch work', async () => {
    vi.useFakeTimers()
    installCookies()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 101, title: '暂时失败', media_count: 1 },
          { id: 102, title: '成功来源', media_count: 1 }
        ] } })
      }
      const folderId = new URL(url).searchParams.get('media_id')
      if (folderId === '101') throw new Error('request timeout')
      return Response.json({ code: 0, data: {
        medias: [{ id: 202, title: '成功保留', type: 2, tags: ['现成标签'] }], has_more: false
      } })
    }))

    const resultPromise = window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    await vi.advanceTimersByTimeAsync(3500)
    const result = await resultPromise
    const store = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(result.sourceFolders.map((folder: { id: string }) => folder.id)).toEqual(['102'])
    expect(result.batch.nextCursor).toMatchObject({ accountMid: '42', folderId: '101', nextPage: 1 })
    expect(store.batchCursor).toBeUndefined()
    expect(store.batchSeenAids).toBeUndefined()
  })

  it('invalidates a persisted cursor and seen aids when its folder no longer exists', async () => {
    installCookies()
    localStorage.clear()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {},
      queue: [],
      progress: { completed: 0, total: 0, pending: 0, status: 'complete' },
      batchCursor: { accountMid: '42', folderId: '999', nextPage: 7 },
      batchSeenAids: [1]
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 101, title: '新列表', media_count: 1 }] } })
      }
      return Response.json({ code: 0, data: {
        medias: [{ id: 1, title: '不能被旧游标隐藏', type: 2, tags: ['现成标签'] }], has_more: false
      } })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))
    const store = JSON.parse(localStorage.getItem('bilimi:old-favorite-tag-enrichment:v1') ?? '{}')

    expect(result.scanProgress.basic.completed).toBe(1)
    expect(result.sourceFolders[0].videos.map((video: { aid: number }) => video.aid)).toEqual([1])
    expect(store.batchCursor).toBeUndefined()
    expect(store.batchSeenAids).toBeUndefined()
  })

  it('invalidates a persisted cursor when the favorite folder order changes', async () => {
    installCookies()
    localStorage.clear()
    localStorage.setItem('bilimi:old-favorite-tag-enrichment:v1', JSON.stringify({
      accountMid: '42',
      cache: {},
      queue: [],
      progress: { completed: 0, total: 0, pending: 0, status: 'complete' },
      batchCursor: {
        accountMid: '42', folderId: '102', nextPage: 1, folderOrder: ['101', '102']
      },
      batchSeenAids: [1]
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [
          { id: 102, title: '顺序提前', media_count: 1 },
          { id: 101, title: '顺序靠后', media_count: 1 }
        ] } })
      }
      const folderId = Number(new URL(url).searchParams.get('media_id'))
      return Response.json({ code: 0, data: {
        medias: [{ id: folderId === 101 ? 1 : 2, title: '重新可靠扫描', type: 2, tags: ['现成标签'] }],
        has_more: false
      } })
    }))

    const result = await window.eval(buildScanOldFavoritesScript(createDefaultFavoriteLedgers().slice(0, 1)))

    expect(result.scanProgress.basic.completed).toBe(2)
    expect(result.sourceFolders.flatMap((folder: { videos: Array<{ aid: number }> }) => folder.videos.map((video) => video.aid)))
      .toEqual([2, 1])
  })
})

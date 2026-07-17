import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { DEEPSEEK_CONSTRAINT_MARKER } from '@shared/favoriteLedgerConstraints'
import type { DeepSeekGenerateResult, FavoriteLedger } from '@shared/types'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import type { FavoriteLedgerPreview } from '../favorites/favoriteLedgerPreview'
import type { OldFavoriteSessionsState } from '../../../../shared/oldFavoriteSessions'
import * as favoriteLedgerPreviewModule from '../favorites/favoriteLedgerPreview'
import { createArchivePlanState } from '../favorites/favoriteArchivePlanState'
import {
  applyArchivePreviewHistorySnapshotToPlan,
  buildOldFavoriteSegmentExecution,
  createArchivePreviewItemHistorySnapshot,
  FavoriteLedgerPanel,
  oldFavoriteExecutionAllowsPlanUpdates,
  oldFavoriteExecutionPacingFor,
  resetOldFavoriteRuntimeSession,
  updateSingleArchivePlanItem,
  waitForOldFavoriteExecutionDelay
} from './FavoriteLedgerPanel'
import {
  bindOldFavoriteRuntimeAccount,
  getOldFavoriteRuntimeValue,
  setOldFavoriteRuntimeValue
} from './oldFavoriteRuntimeSession'

describe('FavoriteLedgerPanel', () => {
  const pendingScanResolvers = new Set<() => void>()
  const pendingScan = <T,>() => {
    const promise = new Promise<T>((_resolve, reject) => {
    const release = () => {
      pendingScanResolvers.delete(release)
      reject(new Error('test scan cancelled'))
    }
    pendingScanResolvers.add(release)
    })
    void promise.catch(() => undefined)
    return promise
  }

  it('updates and records one item sparsely without mapping a 30,000 item plan', () => {
    const state = createArchivePlanState(Array.from({ length: 30_000 }, (_, index) => ({
      aid: index + 1,
      title: `video-${index + 1}`,
      sourceFolderTitle: 'source',
      originalSuggestedLedgerIds: ['knowledge'],
      currentTargetLedgerIds: ['knowledge'],
      selectedTargetLedgerIds: ['knowledge']
    })))
    const targetIndex = 29_499
    const targetItem = state.items[targetIndex]
    const originalMap = state.items.map
    Object.defineProperty(state.items, 'map', {
      configurable: true,
      value: () => { throw new Error('single-item update must not map the full plan') }
    })
    const update = vi.fn(() => ['game'])

    const result = updateSingleArchivePlanItem(state, targetIndex, update)

    Object.defineProperty(state.items, 'map', { configurable: true, value: originalMap })
    expect(result).not.toBeNull()
    expect(update).toHaveBeenCalledOnce()
    expect(result?.state.items[targetIndex]).toMatchObject({
      aid: targetItem.aid,
      selectedTargetLedgerIds: ['game'],
      userModified: true,
      lastChangeSource: 'user'
    })
    expect(result?.state.items[0]).toBe(state.items[0])

    const undoSnapshot = createArchivePreviewItemHistorySnapshot(result!.previousItem)
    expect(undoSnapshot).toMatchObject({
      kind: 'item',
      itemKey: targetItem.itemKey,
      archivePlanItem: { selectedTargetLedgerIds: ['knowledge'] }
    })
    expect(undoSnapshot).not.toHaveProperty('archivePlanState')

    const undone = applyArchivePreviewHistorySnapshotToPlan(result!.state, undoSnapshot, targetIndex)
    const redoSnapshot = createArchivePreviewItemHistorySnapshot(result!.nextItem)
    const redone = applyArchivePreviewHistorySnapshotToPlan(undone, redoSnapshot, targetIndex)
    expect(undone.items[targetIndex].selectedTargetLedgerIds).toEqual(['knowledge'])
    expect(redone.items[targetIndex].selectedTargetLedgerIds).toEqual(['game'])
  })

  it('does not load old favorite sessions or pending state before the entry is clicked', async () => {
    const { api } = installOldFavoriteSessionBridge()
    const onReadOldFavoriteBatchStatus = vi.fn().mockResolvedValue({ pending: false })
    renderPanel({ onReadOldFavoriteBatchStatus })

    await screen.findByRole('button', { name: '整理旧藏' })

    expect(api.loadOldFavoriteSessions).not.toHaveBeenCalled()
    expect(onReadOldFavoriteBatchStatus).not.toHaveBeenCalled()
  })

  const nativeWindowSetTimeout = window.setTimeout

  beforeEach(() => {
    resetOldFavoriteRuntimeSession()
  })

  afterEach(async () => {
    cleanup()
    for (const resolve of [...pendingScanResolvers]) resolve()
    await Promise.resolve()
    resetOldFavoriteRuntimeSession()
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
    window.setTimeout = nativeWindowSetTimeout
    vi.unstubAllGlobals()
  })

  const safetyNote =
    '使用bilimi第一件事就是备册，生成专属收藏夹，同一个视频可以同时保存在不同的收藏夹里，小咪不会删除主人的旧收藏哦，安心使用吧'

  it.each(['running', 'pausing', 'paused', 'risk-stopped', 'awaiting-acknowledgement'] as const)(
    'rejects late plan snapshots while execution phase is %s',
    (phase) => {
      expect(oldFavoriteExecutionAllowsPlanUpdates(phase)).toBe(false)
    }
  )

  it('allows plan snapshots only while execution is idle', () => {
    expect(oldFavoriteExecutionAllowsPlanUpdates('idle')).toBe(true)
  })

  it('interrupts an execution pacing wait when pause is requested', async () => {
    vi.useFakeTimers()
    let stopped = false
    const waiting = waitForOldFavoriteExecutionDelay(3_000, () => stopped)

    await vi.advanceTimersByTimeAsync(100)
    stopped = true
    await vi.advanceTimersByTimeAsync(50)

    await expect(waiting).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([1_200, 3_000, 15_000, 45_000])(
    'measures a %ims execution delay by elapsed time when background timers are clamped',
    async (delayMs) => {
      vi.useFakeTimers()
      const fakeSetTimeout = window.setTimeout.bind(window)
      const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        fakeSetTimeout(handler, Math.max(1_000, Number(timeout ?? 0)), ...args)) as typeof window.setTimeout)
      let resolved = false

      const waiting = waitForOldFavoriteExecutionDelay(delayMs, () => false).then((result) => {
        resolved = true
        return result
      })

      await vi.advanceTimersByTimeAsync(delayMs + 1_000)

      expect(resolved).toBe(true)
      await expect(waiting).resolves.toBe(true)
      expect(vi.getTimerCount()).toBe(0)
      setTimeoutSpy.mockRestore()
    }
  )

  it('still responds after one clamped timer while an execution delay is being paused', async () => {
    vi.useFakeTimers()
    const fakeSetTimeout = window.setTimeout.bind(window)
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      fakeSetTimeout(handler, Math.max(1_000, Number(timeout ?? 0)), ...args)) as typeof window.setTimeout)
    let stopped = false
    const waiting = waitForOldFavoriteExecutionDelay(45_000, () => stopped)

    await vi.advanceTimersByTimeAsync(100)
    stopped = true
    await vi.advanceTimersByTimeAsync(900)

    await expect(waiting).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    setTimeoutSpy.mockRestore()
  })

  it('keeps the first 50 tasks conservative, then uses faster serial pacing', () => {
    expect(oldFavoriteExecutionPacingFor(25)).toEqual({
      delayMs: { min: 15_000, max: 45_000 },
      kind: 'cooldown'
    })
    expect(oldFavoriteExecutionPacingFor(50)).toEqual({
      delayMs: { min: 15_000, max: 45_000 },
      kind: 'cooldown'
    })
    expect(oldFavoriteExecutionPacingFor(51)).toEqual({
      delayMs: { min: 600, max: 1_400 },
      kind: 'pace'
    })
    expect(oldFavoriteExecutionPacingFor(60)).toEqual({
      delayMs: { min: 10_000, max: 20_000 },
      kind: 'cooldown'
    })
    expect(oldFavoriteExecutionPacingFor(120)).toEqual({
      delayMs: { min: 10_000, max: 20_000 },
      kind: 'cooldown'
    })
  })

  function renderPanel(overrides: Partial<Parameters<typeof FavoriteLedgerPanel>[0]> = {}) {
    return render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
        {...overrides}
      />
    )
  }

  function getPreviewVideoButton(container: HTMLElement, name: RegExp) {
    const previewVideo = Array.from(
      container.querySelectorAll<HTMLElement>('.favorite-ledger-panel__preview-video')
    ).find((candidate) => name.test(candidate.textContent ?? ''))
    expect(previewVideo).toBeDefined()
    return previewVideo!
  }

  function getPreviewArticle(container: HTMLElement, name: RegExp) {
    const article = getPreviewVideoButton(container, name).closest('article')
    expect(article).toBeDefined()
    return article!
  }

  function getPreviewTargetToggle(container: HTMLElement, name: RegExp) {
    return getPreviewVideoButton(container, name)
  }

  function createArchivePreviewFixture(): FavoriteLedgerPreview {
    return {
      items: [
        {
          aid: 701,
          title: 'AI 效率工具实战',
          author: '效率研究所',
          description: 'AI 工具流拆解。',
          tags: ['AI', '效率'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        },
        {
          aid: 702,
          title: '暂时不知道放哪',
          author: '杂谈UP',
          description: '需要人工补判。',
          tags: ['杂谈'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          originalSuggestedLedgerIds: [],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 2 }],
        titleSeries: [],
        candidateLedgers: []
      }
    }
  }

  function oldFavoriteBatchCommitToken() {
    return {
      version: 1 as const,
      accountMid: '42',
      scanRunId: 'scan-batch-1',
      folderOrder: ['source-default'],
      expectedCurrentCursor: null,
      nextCursor: {
        accountMid: '42',
        folderId: 'source-default',
        nextPage: 31,
        folderOrder: ['source-default']
      },
      seenAids: [701, 702]
    }
  }

  function markPreviewAsResumableBatch(preview: FavoriteLedgerPreview) {
    preview.batch = {
      limit: 3000,
      hasMore: true,
      nextCursor: {
        accountMid: '42',
        folderId: 'source-default',
        nextPage: 31
      },
      commitToken: oldFavoriteBatchCommitToken()
    } as NonNullable<FavoriteLedgerPreview['batch']>
    return preview
  }

  function installOldFavoriteSessionBridge(initial: OldFavoriteSessionsState = {
    version: 1,
    batches: [],
    lease: null
  }) {
    let state = structuredClone(initial)
    const listeners = new Set<(next: OldFavoriteSessionsState) => void>()
    const api = {
      loadOldFavoriteSessions: vi.fn(async () => structuredClone(state)),
      saveOldFavoriteSessions: vi.fn(async (next: OldFavoriteSessionsState) => {
        state = structuredClone({ ...next, lease: state.lease })
        listeners.forEach((listener) => listener(structuredClone(state)))
        return structuredClone(state)
      }),
      resetOldFavoriteSessionsAccount: vi.fn(async (accountMid: string) => {
        const removedIds = new Set(state.batches
          .filter((batch) => batch.accountMid === accountMid)
          .map((batch) => batch.id))
        state = {
          ...state,
          batches: state.batches.filter((batch) => batch.accountMid !== accountMid),
          lease: state.lease && removedIds.has(state.lease.batchId) ? null : state.lease
        }
        listeners.forEach((listener) => listener(structuredClone(state)))
        return structuredClone(state)
      }),
      claimOldFavoriteTaskLease: vi.fn(async (
        batchId: string,
        segmentId: string,
        task: 'scan' | 'tag' | 'deepseek' | 'execute' | 'reconcile',
        accountMid: string
      ) => {
        const batch = state.batches.find((candidate) => candidate.id === batchId)
        if (state.lease || !batch || batch.accountMid !== accountMid) return false
        state.lease = { batchId, segmentId, task }
        return true
      }),
      releaseOldFavoriteTaskLease: vi.fn(async (batchId: string, segmentId: string) => {
        if (state.lease?.batchId !== batchId || state.lease.segmentId !== segmentId) return false
        state.lease = null
        return true
      }),
      onOldFavoriteSessionsChanged: vi.fn((listener: (next: OldFavoriteSessionsState) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      })
    }
    vi.stubGlobal('bilimiDesktop', api)
    return { api, getState: () => structuredClone(state) }
  }

  it('loads an active compact batch from the workspace only when the user continues it', async () => {
    const preview = createArchivePreviewFixture()
    installOldFavoriteSessionBridge({
      version: 1,
      lease: null,
      batches: [{
        id: 'restored-batch',
        accountMid: '42',
        kind: 'full',
        createdAt: '2026-07-16T10:00:00.000Z',
        status: 'active',
        segments: [{ id: 'restored-batch:segment:1', index: 0, aids: [701, 702], status: 'ready' }],
        snapshot: { currentStep: 'preview', executionPhase: 'idle' }
      }]
    })
    const loadOldFavoriteWorkspaceBatch = vi.fn().mockResolvedValue({
      summary: { id: 'restored-batch', kind: 'full', createdAt: '2026-07-16T10:00:00.000Z', status: 'active' },
      base: preview.items,
      tags: [{ aid: 701, tags: ['恢复标签'] }],
      sources: [{ aid: 701, sourceFolderIds: ['source-1'], sourceFolderTitles: ['来源一'] }],
      overlays: { user: {}, deepseek: {}, execution: {} }
    })
    const recoverOldFavoriteWorkspaceBatch = vi.fn().mockResolvedValue({ discardedTail: null })
    Object.assign(window.bilimiDesktop!, {
      recoverOldFavoriteWorkspaceBatch,
      loadOldFavoriteWorkspaceBatch
    })

    renderPanel()
    expect(loadOldFavoriteWorkspaceBatch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    const dialog = await screen.findByRole('dialog', { name: '整理旧藏' })
    fireEvent.click(within(dialog).getByRole('button', { name: '继续上次整理' }))

    await waitFor(() => expect(
      getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items.map((item) => item.aid)
    ).toEqual([701, 702]))
    expect(loadOldFavoriteWorkspaceBatch).toHaveBeenCalledWith('42', 'restored-batch')
    expect(recoverOldFavoriteWorkspaceBatch).toHaveBeenCalledWith('42', 'restored-batch')
    expect(recoverOldFavoriteWorkspaceBatch.mock.invocationCallOrder[0]).toBeLessThan(
      loadOldFavoriteWorkspaceBatch.mock.invocationCallOrder[0]
    )
    expect(screen.getByRole('combobox', { name: '当前整理批次' })).toHaveValue('restored-batch')
    expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items[0]).toMatchObject({
      tags: ['恢复标签'], sourceFolderIds: ['source-1'], sourceFolderTitles: ['来源一']
    })
    expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.scanDiagnostics?.folderFailures?.[0])
      .toMatchObject({ operation: 'target-membership', status: 'partial' })
    expect(getOldFavoriteRuntimeValue<any[]>('oldFavoriteUserBatches', [])[0]?.snapshot?.collectionSnapshot)
      .toEqual([
        { aid: 701, sourceFolderIds: ['source-1'] },
        { aid: 702, sourceFolderIds: ['默认收藏夹'] }
      ])
  })

  it('merges every persisted source relation for the same aid during workspace recovery', async () => {
    const preview = createArchivePreviewFixture()
    installOldFavoriteSessionBridge({
      version: 1,
      lease: null,
      batches: [{
        id: 'restored-batch', accountMid: '42', kind: 'full',
        createdAt: '2026-07-16T10:00:00.000Z', status: 'active',
        segments: [{ id: 'restored-batch:segment:1', index: 0, aids: [701, 702], status: 'ready' }],
        snapshot: { currentStep: 'preview', executionPhase: 'idle' }
      }]
    })
    Object.assign(window.bilimiDesktop!, {
      recoverOldFavoriteWorkspaceBatch: vi.fn().mockResolvedValue({ discardedTail: null }),
      loadOldFavoriteWorkspaceBatch: vi.fn().mockResolvedValue({
        summary: { id: 'restored-batch', kind: 'full', createdAt: '2026-07-16T10:00:00.000Z', status: 'active' },
        base: preview.items,
        tags: [],
        sources: [
          { aid: 701, sourceFolderIds: ['source-1'], sourceFolderTitles: [''] },
          { aid: 701, sourceFolderIds: ['source-1'], sourceFolderTitles: ['来源一'] },
          { aid: 701, sourceFolderIds: ['source-2'], sourceFolderTitles: ['来源二'] }
        ],
        overlays: { user: {}, deepseek: {}, execution: {} }
      })
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: '整理旧藏' }))
      .getByRole('button', { name: '继续上次整理' }))

    await waitFor(() => expect(
      getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items[0]
    ).toMatchObject({
      sourceFolderIds: ['source-1', 'source-2'],
      sourceFolderTitles: ['来源一', '来源二']
    }))
  })

  it('uses the workspace collection summary after restart so an unchanged incremental scan stays empty', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[0].sourceFolderIds = ['source-1']
    preview.items[0].sourceFolderTitles = ['来源一']
    preview.items[1].sourceFolderIds = ['source-2']
    preview.items[1].sourceFolderTitles = ['来源二']
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2,
      sourceFolders: [{ id: 'source-1', title: '来源一', videos: preview.items }],
      activeSourceFolders: [{ id: 'source-1', title: '来源一', videos: preview.items }],
      protectedVideos: [], managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    installOldFavoriteSessionBridge({
      version: 1,
      lease: null,
      batches: [{
        id: 'restored-batch', accountMid: '42', kind: 'full',
        createdAt: '2026-07-16T10:00:00.000Z', status: 'active',
        segments: [{ id: 'restored-batch:segment:1', index: 0, aids: [701, 702], status: 'ready' }],
        snapshot: { currentStep: 'preview', executionPhase: 'idle' }
      }]
    })
    Object.assign(window.bilimiDesktop!, {
      recoverOldFavoriteWorkspaceBatch: vi.fn().mockResolvedValue({ discardedTail: null }),
      loadOldFavoriteWorkspaceBatch: vi.fn().mockResolvedValue({
        summary: { id: 'restored-batch', kind: 'full', createdAt: '2026-07-16T10:00:00.000Z', status: 'active' },
        base: preview.items, tags: [], sources: [],
        overlays: { user: {}, deepseek: {}, execution: {} }
      })
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue(structuredClone(preview))
    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: '整理旧藏' }))
      .getByRole('button', { name: '继续上次整理' }))
    await waitFor(() => expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '新增视频整理' }))
    fireEvent.click(screen.getByRole('button', { name: '创建并扫描' }))

    expect(await screen.findByText('暂未发现需要新增整理的视频')).toBeInTheDocument()
  })

  it('persists and claims a scan session before Bilibili scanning, then completes and releases it', async () => {
    const { api, getState } = installOldFavoriteSessionBridge()
    const onReadCurrentOldFavoriteAccount = vi.fn().mockResolvedValue('42')
    const onScanOldFavorites = vi.fn().mockImplementation(async () => {
      expect(getState().lease?.task).toBe('scan')
      expect(getState().batches[0].segments[0].task).toEqual({
        kind: 'scan',
        status: 'running',
        requestState: 'in-flight'
      })
      return {
        items: [{
          aid: 101,
          title: 'session scan item',
          sourceFolderTitle: 'default',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }],
        skippedSourceFolderTitles: [],
        scanContext: {
          accountMid: '42',
          totalUniqueVideos: 1,
          activeSourceFolders: [],
          protectedVideos: [],
          sourceFolders: [],
          managedFolders: []
        }
      } satisfies FavoriteLedgerPreview
    })
    renderPanel({ onReadCurrentOldFavoriteAccount, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await screen.findByRole('region', { name: '整理旧藏向导' })
    expect(onReadCurrentOldFavoriteAccount).toHaveBeenCalledBefore(onScanOldFavorites)
    expect(api.claimOldFavoriteTaskLease).toHaveBeenCalledBefore(onScanOldFavorites)
    expect(api.releaseOldFavoriteTaskLease).toHaveBeenCalledOnce()
    expect(getState().lease).toBeNull()
    expect(getState().batches[0].segments[0]).toMatchObject({
      aids: [101],
      status: 'ready'
    })
    expect(getState().batches[0].segments[0].task).toBeUndefined()
  })

  it('shows continuous user batch controls without the retired visible batch cap flow', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      sourceFolders: [],
      protectedSourceFolders: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    await waitFor(() => expect(screen.getByRole('button', { name: '新增视频整理' }).closest('.favorite-ledger-panel__old-favorites-guide')).toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: '当前整理批次' }).textContent).toMatch(/\d{2}\/\d{2} \d{2}:\d{2}/)
    expect(document.querySelector('.favorite-ledger-panel__guide-title-row .favorite-ledger-panel__batch-switcher')).toBeInTheDocument()
    expect(document.querySelector('.favorite-ledger-panel__topbar .favorite-ledger-panel__batch-switcher')).not.toBeInTheDocument()
    expect(screen.queryByText('本批最多3000，完成或放弃后可继续')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '放弃本批' })).not.toBeInTheDocument()
  })

  it('keeps the batch selector, segment selector, and incremental action in one compact row', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42', sourceFolders: [], activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    const selector = screen.getByRole('combobox', { name: '当前整理批次' })
    const switcher = selector.closest('.favorite-ledger-panel__batch-switcher')
    expect(switcher?.firstElementChild).toBe(selector)
    expect(selector).toHaveAttribute('title', expect.stringContaining('当前批次'))
    expect(selector.options[selector.selectedIndex]?.text).toMatch(/\d{2}\/\d{2} \d{2}:\d{2}/)
    expect(screen.getByRole('button', { name: '新增视频整理' }).parentElement).toBe(switcher)
    expect(Array.from(switcher?.children ?? [])).toEqual(expect.arrayContaining([
      selector,
      screen.getByRole('button', { name: '新增视频整理' })
    ]))
  })

  it('keeps ended batches out of the workspace until history is requested', async () => {
    const preview = createArchivePreviewFixture()
    const archivePlanState = {
      items: preview.items.map((item) => ({
        itemKey: `${item.sourceFolderTitle}::${item.aid}`,
        aid: item.aid,
        title: item.title,
        author: item.author,
        description: item.description,
        tags: item.tags,
        sourceFolderTitle: item.sourceFolderTitle,
        selected: item.selected,
        originalSuggestedLedgerIds: item.originalSuggestedLedgerIds,
        currentTargetLedgerIds: item.currentTargetLedgerIds,
        selectedTargetLedgerIds: item.selectedTargetLedgerIds,
        userModified: false,
        lastChangeSource: 'classifier' as const
      })),
      originalItemsByAid: {} as Record<number, any>,
      originalItemsByKey: {} as Record<string, any>
    }
    archivePlanState.originalItemsByAid = Object.fromEntries(archivePlanState.items.map((item) => [item.aid, item]))
    archivePlanState.originalItemsByKey = Object.fromEntries(archivePlanState.items.map((item) => [item.itemKey, item]))
    installOldFavoriteSessionBridge({
      version: 1,
      lease: null,
      batches: [{
        id: 'ended-batch', accountMid: '42', kind: 'full', createdAt: '2026-07-17T08:00:00Z', status: 'ended', endedAt: '2026-07-17T09:00:00Z',
        segments: [{ id: 'ended-batch:segment:1', index: 0, aids: [701, 702], status: 'ended' }],
        snapshot: {
          preview, baseScanPreview: preview,
          archiveEditorState: { archivePlanState, selectedCandidateKeys: [], draftLedgers: createDefaultFavoriteLedgers(), candidateSourceLedgerIdsByItemKey: {} }
        }
      }]
    })
    const loadOldFavoriteWorkspaceBatch = vi.fn().mockResolvedValue({
      summary: { id: 'ended-batch', kind: 'full', createdAt: '2026-07-17T08:00:00Z', status: 'archived' },
      base: preview.items,
      tags: [], sources: [], overlays: { user: {}, deepseek: {}, execution: {} }
    })
    Object.assign(window.bilimiDesktop!, { loadOldFavoriteWorkspaceBatch })
    renderPanel({
      currentAccountMid: '42',
      onScanOldFavorites: vi.fn().mockResolvedValue(createArchivePreviewFixture())
    })

    expect(screen.queryByRole('button', { name: '查看历史整理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    const selector = await screen.findByRole('combobox', { name: '当前整理批次' })
    await waitFor(() => expect(selector).not.toHaveValue('ended-batch'))
    expect(screen.queryByRole('button', { name: '查看历史整理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '整理旧藏' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '当前整理批次' }), {
      target: { value: 'ended-batch' }
    })
    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    expect(loadOldFavoriteWorkspaceBatch).toHaveBeenCalledWith('42', 'ended-batch')
    expect(screen.getByRole('heading', { name: '整理结果' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '整理旧藏步骤' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重置' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'DeepSeek 整理' })).not.toBeInTheDocument()
  })

  it('keeps source-list DOM, focus, and scroll stable across lightweight progress updates', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2,
      sourceFolders: [{ id: 'ordinary', title: '普通收藏', videos: preview.items }],
      activeSourceFolders: [{ id: 'ordinary', title: '普通收藏', videos: preview.items }],
      protectedVideos: [], managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    const table = screen.getByRole('table', { name: '用户收藏夹' })
    const list = within(table).getByRole('rowgroup')
    const checkbox = screen.getByRole('checkbox', { name: /整理来源 普通收藏/ })
    list.scrollTop = 37
    checkbox.focus()

    for (const completed of [25, 26, 27]) {
      act(() => setOldFavoriteRuntimeValue('scanProgress', {
        basic: { status: 'running', completed, total: 100 },
        tags: { status: 'pending', completed: 0, total: 2, pending: 2, failed: 0 }
      }))
      expect(screen.getByRole('table', { name: '用户收藏夹' })).toBe(table)
      expect(within(table).getByRole('rowgroup')).toBe(list)
      expect(document.activeElement).toBe(checkbox)
      expect(list.scrollTop).toBe(37)
    }
  })

  it('lists complete ordinary and logical bilimi folders with staging selectable and formal folders locked', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 4,
      sourceFolders: [
        { id: 'ordinary', title: '普通收藏', videos: preview.items },
        { id: 'ordinary-empty', title: '空收藏', videos: [] }
      ],
      activeSourceFolders: [{ id: 'ordinary', title: '普通收藏', videos: preview.items }],
      protectedVideos: [
        {
          aid: 801,
          title: '原神一',
          sourceFolderIds: ['ordinary'],
          sourceFolderTitles: ['普通收藏'],
          currentBilimiFolderIds: ['formal-1']
        },
        {
          aid: 802,
          title: '原神二',
          sourceFolderIds: ['ordinary'],
          sourceFolderTitles: ['普通收藏'],
          currentBilimiFolderIds: ['formal-2']
        }
      ],
      managedFolders: [
        { id: 'formal-1', title: 'bilimi·原神', ledgerId: 'game', isInbox: false },
        { id: 'formal-2', title: 'bilimi·原神·2', ledgerId: 'game', isInbox: false },
        { id: 'formal-empty', title: 'bilimi·音乐', ledgerId: 'music', isInbox: false },
        { id: 'inbox', title: 'bilimi·暂存', ledgerId: 'inbox', isInbox: true }
      ],
      targetMembership: {
        'formal-1': [801],
        'formal-2': [802],
        'formal-empty': [],
        inbox: [803]
      },
      multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByRole('row', { name: /普通收藏，总数 2/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /空收藏，总数 0/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /bilimi·原神.*已有 2.*2 卷/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /bilimi·音乐.*已有 0/ })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 bilimi·暂存' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '选择 bilimi·原神' })).toBeDisabled()
    expect(screen.getByText('已识别 4 个 · 2 个唯一视频受保护')).toBeInTheDocument()
  })

  it('clears the old account preview when the current account logs out', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42', sourceFolders: [], activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    const props = {
      currentAccountMid: '42',
      ledgers: createDefaultFavoriteLedgers(), missingLedgerIds: [],
      onEnsureLedgers: vi.fn(), onSaveLedgers: vi.fn(),
      onScanOldFavorites: vi.fn().mockResolvedValue(preview), onExecuteOldFavoritePlan: vi.fn()
    }
    const rendered = render(<FavoriteLedgerPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    rendered.rerender(<FavoriteLedgerPanel {...props} currentAccountMid="" />)

    await waitFor(() => expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument())
  })

  it('rebuilds protected aids when only part of the unlocked managed folders remain selected', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 4,
      sourceFolders: [{ id: 'ordinary', title: '普通收藏', videos: preview.items }],
      activeSourceFolders: [{ id: 'ordinary', title: '普通收藏', videos: preview.items }],
      protectedVideos: [
        { aid: 801, title: '游戏视频', sourceFolderIds: ['ordinary'], sourceFolderTitles: ['普通收藏'], currentBilimiFolderIds: ['game'] },
        { aid: 802, title: '音乐视频', sourceFolderIds: ['ordinary'], sourceFolderTitles: ['普通收藏'], currentBilimiFolderIds: ['music'] }
      ],
      managedFolders: [
        { id: 'game', title: 'bilimi·游戏', ledgerId: 'game', isInbox: false },
        { id: 'music', title: 'bilimi·音乐', ledgerId: 'music', isInbox: false }
      ],
      targetMembership: { game: [801], music: [802] },
      multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '重新整理全部已整理视频 2 条' }))
    fireEvent.click(screen.getByRole('button', { name: '继续重新整理' }))
    expect(screen.getByText('已重新纳入 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 bilimi·音乐' }))

    expect(screen.getByText('已重新纳入 1')).toBeInTheDocument()
    expect(getOldFavoriteRuntimeValue<Set<number>>('reorganizedProtectedAids', new Set())).toEqual(new Set([801]))
  })

  it('creates an incremental batch only from collection snapshot additions and source changes', async () => {
    const first = createArchivePreviewFixture()
    first.scanContext = {
      accountMid: '42', totalUniqueVideos: 2,
      sourceFolders: [{ id: 'a', title: 'A', videos: first.items }],
      activeSourceFolders: [{ id: 'a', title: 'A', videos: first.items }],
      protectedVideos: [], managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    first.items[0].sourceFolderIds = ['a']
    first.items[0].sourceFolderTitles = ['A']
    first.items[1].sourceFolderIds = ['a']
    first.items[1].sourceFolderTitles = ['A']
    const second = structuredClone(first)
    second.items = [
      { ...second.items[0], sourceFolderIds: ['a'] },
      { ...second.items[1], sourceFolderIds: ['a', 'b'] },
      { ...second.items[0], aid: 703, title: '新增视频', sourceFolderIds: ['b'], sourceFolderTitles: ['B'] }
    ]
    second.scanContext!.totalUniqueVideos = 3
    const onScanOldFavorites = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '新增视频整理' }))
    expect(screen.getByRole('dialog', { name: '新增视频整理' })).toHaveTextContent('基于上次快照创建独立批次')
    fireEvent.click(screen.getByRole('button', { name: '创建并扫描' }))
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledTimes(2))

    const incrementalPreview = getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)
    expect(incrementalPreview?.items.map((item) => item.aid)).toEqual([703])
    expect(screen.getByRole('combobox', { name: '当前整理批次' })).toHaveAttribute(
      'title',
      expect.stringContaining('新增批次')
    )
  })

  it('cancels incremental batch confirmation without scanning or changing the current batch', async () => {
    const preview = createArchivePreviewFixture()
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    renderPanel({ onScanOldFavorites })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    const currentLabel = screen.getByRole('combobox', { name: '当前整理批次' }).textContent

    fireEvent.click(screen.getByRole('button', { name: '新增视频整理' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onScanOldFavorites).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: '新增视频整理' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '当前整理批次' })).toHaveTextContent(currentLabel ?? '')
  })

  it('does not retain an empty incremental batch', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: preview.items.length,
      sourceFolders: [{ id: 'a', title: 'A', videos: preview.items }],
      activeSourceFolders: [{ id: 'a', title: 'A', videos: preview.items }],
      protectedVideos: [], managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    renderPanel({ onScanOldFavorites })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '新增视频整理' }))
    fireEvent.click(screen.getByRole('button', { name: '创建并扫描' }))

    expect(await screen.findByText('暂未发现需要新增整理的视频')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '当前整理批次' }).querySelectorAll('option')).toHaveLength(1)
  })

  it('merges snapshot state when switching batches instead of dropping segment archives', async () => {
    const firstPreview = createArchivePreviewFixture()
    const secondPreview = structuredClone(firstPreview)
    secondPreview.items[0].aid = 801
    const editor = {
      archivePlanState: null,
      selectedCandidateKeys: [],
      draftLedgers: createDefaultFavoriteLedgers(),
      candidateSourceLedgerIdsByItemKey: {}
    }
    setOldFavoriteRuntimeValue('oldFavoriteUserBatches', [
      {
        id: 'first', kind: 'full', createdAt: '2026-07-17T08:00:00Z', accountMid: '42', segmentIndex: 1, segmentCount: 1,
        segmentAids: [[701, 702]], status: 'active',
        snapshot: { preview: firstPreview, baseScanPreview: firstPreview, archiveEditorState: editor, step: 'scan', executionPhase: 'idle', executionRun: null, executionProgress: null, collectionSnapshot: [{ aid: 701, sourceFolderIds: ['a'] }], segmentSnapshots: { 0: { preview: firstPreview, baseScanPreview: firstPreview, archiveEditorState: editor, finalReconciled: true } } }
      },
      {
        id: 'second', kind: 'incremental', createdAt: '2026-07-17T09:00:00Z', accountMid: '42', segmentIndex: 1, segmentCount: 1,
        segmentAids: [[801]], status: 'active',
        snapshot: { preview: secondPreview, baseScanPreview: secondPreview, archiveEditorState: editor, step: 'scan', executionPhase: 'idle', executionRun: null, executionProgress: null }
      }
    ])
    setOldFavoriteRuntimeValue('activeOldFavoriteUserBatchId', 'first')
    setOldFavoriteRuntimeValue('preview', firstPreview)
    setOldFavoriteRuntimeValue('baseScanPreview', firstPreview)
    renderPanel()

    fireEvent.change(screen.getByRole('combobox', { name: '当前整理批次' }), { target: { value: 'second' } })
    const first = getOldFavoriteRuntimeValue<any[]>('oldFavoriteUserBatches', []).find((batch) => batch.id === 'first')
    expect(first.snapshot.collectionSnapshot).toEqual([{ aid: 701, sourceFolderIds: ['a'] }])
    expect(first.snapshot.segmentSnapshots[0].finalReconciled).toBe(true)
  })

  it('shows one batch recommendation with unique, current-segment, and scanned-segment counts', () => {
    const preview = createArchivePreviewFixture()
    const candidate = {
      kind: 'tag-cluster' as const,
      sourceName: '原神',
      displayName: 'bilimi·原神',
      keywords: ['原神'],
      count: 3,
      confidence: 'high' as const,
      reason: '高频标签'
    }
    preview.insights!.candidateLedgers = [candidate]
    preview.items = [701, 702, 703].map((aid, index) => ({
      ...preview.items[index % 2],
      aid,
      title: `video-${aid}`,
      candidateTargets: [{
        candidateKey: 'tag-cluster:原神',
        ledgerId: 'candidate-tag-cluster-原神',
        displayName: 'bilimi·原神',
        keywords: ['原神']
      }]
    }))
    setOldFavoriteRuntimeValue('preview', preview)
    setOldFavoriteRuntimeValue('baseScanPreview', preview)
    const archivePlanState = {
      items: preview.items.map((item) => ({
        itemKey: `${item.sourceFolderTitle}::${item.aid}`,
        aid: item.aid,
        title: item.title,
        author: item.author,
        description: item.description,
        tags: item.tags,
        sourceFolderTitle: item.sourceFolderTitle,
        originalSuggestedLedgerIds: [...(item.originalSuggestedLedgerIds ?? [])],
        currentTargetLedgerIds: [...(item.currentTargetLedgerIds ?? [])],
        selectedTargetLedgerIds: [...(item.selectedTargetLedgerIds ?? [])],
        lowConfidence: item.lowConfidence,
        userModified: false,
        lastChangeSource: 'classifier' as const
      })),
      originalItemsByAid: {},
      originalItemsByKey: {}
    }
    archivePlanState.originalItemsByAid = Object.fromEntries(archivePlanState.items.map((item) => [item.aid, item]))
    archivePlanState.originalItemsByKey = Object.fromEntries(archivePlanState.items.map((item) => [item.itemKey, item]))
    setOldFavoriteRuntimeValue('archiveEditorState', {
      archivePlanState,
      selectedCandidateKeys: [],
      draftLedgers: createDefaultFavoriteLedgers(),
      candidateSourceLedgerIdsByItemKey: {}
    })
    setOldFavoriteRuntimeValue('oldFavoriteGuideMode', 'organize')
    setOldFavoriteRuntimeValue('oldFavoriteStep', 'generated')
    setOldFavoriteRuntimeValue('activeOldFavoriteUserBatchId', 'batch-1')
    setOldFavoriteRuntimeValue('oldFavoriteUserBatches', [{
      id: 'batch-1', kind: 'full', createdAt: '2026-07-16T10:00:00.000Z', accountMid: '42',
      segmentIndex: 2, segmentCount: 3, segmentAids: [[701], [702], [703]], status: 'active',
      snapshot: {
        preview, baseScanPreview: preview,
        archiveEditorState: {
          archivePlanState: null,
          selectedCandidateKeys: [],
          draftLedgers: createDefaultFavoriteLedgers(),
          candidateSourceLedgerIdsByItemKey: {}
        },
        step: 'generated', executionPhase: 'idle', executionRun: null, executionProgress: null,
        recommendations: {
          scannedSegmentIndexes: [0, 1],
          entries: [
            { stableKey: 'tag-cluster:原神', ledgerId: 'candidate-tag-cluster-原神', displayName: 'bilimi·原神', segmentIndex: 0, matchedAids: [701, 703], matchedItemKeys: ['701:a', '703:a'] },
            { stableKey: 'tag-cluster:原神', ledgerId: 'candidate-tag-cluster-原神', displayName: 'bilimi·原神', segmentIndex: 1, matchedAids: [702, 703], matchedItemKeys: ['702:a', '703:a'] }
          ]
        }
      }
    }])

    renderPanel()

    expect(screen.getByText('全批 3+ · 本段 2 · 2/3')).toBeInTheDocument()
  })

  it('offers four batch DeepSeek scopes and shows current and whole-batch execution progress', async () => {
    const preview = createArchivePreviewFixture()
    setOldFavoriteRuntimeValue('preview', preview)
    setOldFavoriteRuntimeValue('baseScanPreview', preview)
    setOldFavoriteRuntimeValue('oldFavoriteGuideMode', 'organize')
    setOldFavoriteRuntimeValue('oldFavoriteStep', 'preview')
    setOldFavoriteRuntimeValue('activeOldFavoriteUserBatchId', 'batch-progress')
    setOldFavoriteRuntimeValue('oldFavoriteUserBatches', [{
      id: 'batch-progress', kind: 'full', createdAt: '2026-07-16T10:00:00.000Z', accountMid: '42',
      segmentIndex: 1, segmentCount: 2, segmentAids: [[701, 702], [703]], status: 'active',
      snapshot: {
        preview, baseScanPreview: preview,
        archiveEditorState: {
          archivePlanState: null, selectedCandidateKeys: [],
          draftLedgers: createDefaultFavoriteLedgers(), candidateSourceLedgerIdsByItemKey: {}
        },
        step: 'preview', executionPhase: 'idle', executionRun: null, executionProgress: null,
        segmentExecution: [
          { index: 0, status: 'ready', executableCount: 2, completedCount: 0 },
          { index: 1, status: 'ready', executableCount: 1, completedCount: 0 }
        ]
      }
    }])
    renderPanel({ deepSeekArchiveAvailable: true, onOrganizeOldFavoritesWithDeepSeek: vi.fn() })

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '整理范围' }))

    expect(screen.getByRole('menuitemradio', { name: '当前分段' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: '全批未匹配' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: '全批待复核' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: '全批未匹配 + 待复核' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText((_, element) =>
      element?.textContent === '当前段可执行 2 · 全批可执行 3 · 已完成 0/3'
    )).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '连续执行所有已就绪分段' })).not.toBeChecked()
  })

  it('uses earlier segments only as DeepSeek context while protecting their decisions', async () => {
    const preview = createArchivePreviewFixture()
    preview.items.push({
      ...preview.items[1],
      aid: 703,
      title: '第二段待复核',
      lowConfidence: true
    }, {
      ...preview.items[1],
      aid: 704,
      title: '第二段仅未匹配',
      lowConfidence: false
    })
    setOldFavoriteRuntimeValue('preview', preview)
    setOldFavoriteRuntimeValue('baseScanPreview', preview)
    const deepSeekPlanItems = preview.items.map((item) => ({
      itemKey: `${item.sourceFolderTitle}::${item.aid}`,
      aid: item.aid,
      title: item.title,
      author: item.author,
      description: item.description,
      tags: item.tags,
      sourceFolderTitle: item.sourceFolderTitle,
      originalSuggestedLedgerIds: [...(item.originalSuggestedLedgerIds ?? [])],
      currentTargetLedgerIds: [...(item.currentTargetLedgerIds ?? [])],
      selectedTargetLedgerIds: [...(item.selectedTargetLedgerIds ?? [])],
      lowConfidence: item.lowConfidence,
      userModified: item.aid === 702,
      lastChangeSource: item.aid === 701
        ? 'deepseek' as const
        : item.aid === 702
          ? 'user' as const
          : 'classifier' as const
    }))
    deepSeekPlanItems[0].currentTargetLedgerIds = ['knowledge']
    deepSeekPlanItems[0].selectedTargetLedgerIds = ['knowledge']
    deepSeekPlanItems[1].currentTargetLedgerIds = ['movie-tv']
    deepSeekPlanItems[1].selectedTargetLedgerIds = ['movie-tv']
    const deepSeekPlan = {
      items: deepSeekPlanItems,
      originalItemsByAid: Object.fromEntries(deepSeekPlanItems.map((item) => [item.aid, item])),
      originalItemsByKey: Object.fromEntries(deepSeekPlanItems.map((item) => [item.itemKey, item]))
    }
    setOldFavoriteRuntimeValue('archiveEditorState', {
      archivePlanState: deepSeekPlan,
      selectedCandidateKeys: [],
      draftLedgers: createDefaultFavoriteLedgers(),
      candidateSourceLedgerIdsByItemKey: {}
    })
    setOldFavoriteRuntimeValue('oldFavoriteGuideMode', 'organize')
    setOldFavoriteRuntimeValue('oldFavoriteStep', 'preview')
    setOldFavoriteRuntimeValue('activeOldFavoriteUserBatchId', 'batch-deepseek')
    setOldFavoriteRuntimeValue('oldFavoriteUserBatches', [{
      id: 'batch-deepseek', kind: 'full', createdAt: '2026-07-16T10:00:00.000Z', accountMid: '42',
      segmentIndex: 2, segmentCount: 2, segmentAids: [[701, 702], [703, 704]], status: 'active',
      snapshot: {
        preview, baseScanPreview: preview,
        archiveEditorState: {
          archivePlanState: deepSeekPlan, selectedCandidateKeys: [],
          draftLedgers: createDefaultFavoriteLedgers(), candidateSourceLedgerIdsByItemKey: {}
        },
        step: 'preview', executionPhase: 'idle', executionRun: null, executionProgress: null,
        segmentExecution: [
          { index: 0, status: 'ready', executableCount: 2, completedCount: 0 },
          { index: 1, status: 'ready', executableCount: 2, completedCount: 0 }
        ]
      }
    }])
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 701,
          sourceFolderTitle: preview.items[0].sourceFolderTitle,
          targetLedgerIds: ['game'],
          keepOriginal: false,
          reason: 'stale earlier-segment result',
          lowConfidence: false
        },
        {
          aid: 703,
          sourceFolderTitle: preview.items[2].sourceFolderTitle,
          targetLedgerIds: ['game'],
          keepOriginal: false,
          reason: 'current segment result',
          lowConfidence: false
        }
      ]
    })
    renderPanel({ deepSeekArchiveAvailable: true, onOrganizeOldFavoritesWithDeepSeek })

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '整理范围' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '全批待复核' }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalled())
    const request = onOrganizeOldFavoritesWithDeepSeek.mock.calls[0][1]
    expect(request.videos.map((video: { aid: number }) => video.aid)).toEqual([703])
    expect(request.ledgers.length).toBeGreaterThan(0)
    expect(request.videos).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ aid: 701 }),
      expect.objectContaining({ aid: 702 })
    ]))
    await waitFor(() => {
      const appliedState = getOldFavoriteRuntimeValue<{
        archivePlanState: typeof deepSeekPlan
      }>('archiveEditorState', { archivePlanState: deepSeekPlan }).archivePlanState
      expect(appliedState.items.find((item) => item.aid === 701)?.selectedTargetLedgerIds).toEqual(['knowledge'])
      expect(appliedState.items.find((item) => item.aid === 702)?.selectedTargetLedgerIds).toEqual(['movie-tv'])
      expect(appliedState.items.find((item) => item.aid === 703)?.selectedTargetLedgerIds).toEqual(['game'])
    })
  })

  it('keeps complete long ledger names in title and accessible labels', () => {
    const names = [
      'bilimi·这是一个非常非常长的中文收藏夹名称',
      'bilimi·ThisIsAnExtremelyLongLedgerNameWithoutAnySpaces',
      'bilimi·AI工具Workflow2026长名称MixedCharacters'
    ]
    const ledgers = createDefaultFavoriteLedgers().map((ledger, index) =>
      names[index] ? { ...ledger, displayName: names[index] } : ledger
    )

    renderPanel({ ledgers })

    for (const name of names) {
      const accessibleName = name.replace(/^bilimi·/, '')
      expect(screen.getByRole('button', { name: accessibleName })).toHaveAttribute('title', name)
    }
  })

  it('shows complete-name length and blocks saving or syncing names over 20 Unicode characters', async () => {
    const onSaveLedgers = vi.fn()
    renderPanel({ onSaveLedgers })

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))
    fireEvent.change(screen.getByLabelText('册名'), {
      target: { value: '12345678901234' }
    })

    const nameLabel = screen.getByText('册名').closest('.favorite-ledger-panel__name-label')!
    const lengthCounter = within(nameLabel as HTMLElement).getByText('21/20')
    expect(lengthCounter).toHaveAttribute('data-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('B站收藏夹名称最多20个字，当前21个字')
    expect(screen.getByRole('alert')).not.toHaveTextContent('21/20')
    expect(within(screen.getByRole('region', { name: '当前收藏夹' })).getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '同步' })).toBeDisabled()
    expect(onSaveLedgers).not.toHaveBeenCalled()
  })

  it('clears the dirty marker after saving a valid ledger draft', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))
    fireEvent.change(screen.getByLabelText('册名'), { target: { value: '新名称' } })
    expect(screen.getByRole('button', { name: '（未保存）新名称' })).toBeInTheDocument()
    expect(screen.getByText('（未保存）正在编辑：bilimi·新名称')).toBeInTheDocument()

    const nameLabel = screen.getByText('册名').closest('.favorite-ledger-panel__name-label')!
    expect(within(nameLabel as HTMLElement).getByText('10/20')).toHaveAttribute('data-invalid', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('region', { name: '当前收藏夹' })).getByRole('button', { name: '保存' }))
    expect(screen.getByRole('button', { name: '新名称' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '（未保存）新名称' })).not.toBeInTheDocument()
    expect(screen.getByText('正在编辑：bilimi·新名称')).toBeInTheDocument()
    expect(screen.queryByText('（未保存）正在编辑：bilimi·新名称')).not.toBeInTheDocument()
  })

  it('clears the leading dirty markers after resetting ledger drafts', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))
    fireEvent.change(screen.getByLabelText('册名'), { target: { value: '临时名称' } })

    expect(screen.getByRole('button', { name: '（未保存）临时名称' })).toBeInTheDocument()
    expect(screen.getByText('（未保存）正在编辑：bilimi·临时名称')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重置' }))

    expect(screen.getByRole('button', { name: '知识学习' })).toBeInTheDocument()
    expect(screen.queryByText(/（未保存）/)).not.toBeInTheDocument()
  })

  it('prepares the Bilibili environment before saving and scanning', async () => {
    const order: string[] = []
    const onPrepareOldFavoriteScan = vi.fn(async () => {
      order.push('prepare')
      return { ok: true, steps: [], missingTargets: [] }
    })
    const onSaveLedgers = vi.fn(async () => {
      order.push('save')
      return { ok: true, steps: [], missingTargets: [] }
    })
    const onScanOldFavorites = vi.fn(async () => {
      order.push('scan')
      return createArchivePreviewFixture()
    })
    renderPanel({ onPrepareOldFavoriteScan, onSaveLedgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await waitFor(() => expect(order).toEqual(['prepare', 'save', 'scan']))
  })

  it('keeps the main action label stable and offers explicit choices for an unfinished archive', async () => {
    renderPanel({
      onReadOldFavoriteBatchStatus: vi.fn().mockResolvedValue({ pending: true })
    })

    const organizeButton = await screen.findByRole('button', { name: '整理旧藏' })
    fireEvent.click(organizeButton)
    const dialog = await screen.findByRole('dialog', { name: '整理旧藏' })
    expect(within(dialog).getByRole('button', { name: '继续上次整理' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '全部重新整理' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '仅整理新增' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
  })

  it('re-reads the resumable batch status after scan preparation becomes ready', async () => {
    const onReadOldFavoriteBatchStatus = vi.fn().mockResolvedValue({ pending: true })
    renderPanel({
      onReadOldFavoriteBatchStatus,
      onPrepareOldFavoriteScan: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [] }),
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [] }),
      onScanOldFavorites: vi.fn(() => pendingScan<FavoriteLedgerPreview>())
    })

    expect(onReadOldFavoriteBatchStatus).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await waitFor(() => expect(onReadOldFavoriteBatchStatus).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '整理旧藏' })).toBeInTheDocument()
  })

  it('does not persist a full session snapshot for ordinary progress and editor updates', async () => {
    const preview = createArchivePreviewFixture()
    const sessionBridge = installOldFavoriteSessionBridge({
      version: 1,
      lease: null,
      batches: [{
        id: 'active-batch', accountMid: '42', kind: 'full', createdAt: '2026-07-17T10:00:00Z', status: 'active',
        segments: [{ id: 'active-batch:segment:1', index: 0, aids: [701, 702], status: 'ready' }],
        snapshot: {
          preview,
          baseScanPreview: preview,
          archiveEditorState: {
            archivePlanState: null,
            selectedCandidateKeys: [],
            draftLedgers: createDefaultFavoriteLedgers(),
            candidateSourceLedgerIdsByItemKey: {}
          }
        }
      }]
    })
    renderPanel({
      currentAccountMid: '42',
      onPrepareOldFavoriteScan: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [] }),
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [] }),
      onScanOldFavorites: vi.fn(() => pendingScan<FavoriteLedgerPreview>())
    })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '当前整理批次' })).toBeInTheDocument())
    sessionBridge.api.saveOldFavoriteSessions.mockClear()

    act(() => setOldFavoriteRuntimeValue('scanProgress', {
      basic: { completed: 25, total: 100, status: 'running' },
      tags: { completed: 1, total: 2, pending: 1, failed: 0, status: 'running' }
    }))
    act(() => setOldFavoriteRuntimeValue('archiveEditorState', {
      archivePlanState: null,
      selectedCandidateKeys: ['game'],
      draftLedgers: createDefaultFavoriteLedgers(),
      candidateSourceLedgerIdsByItemKey: {}
    }))
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(sessionBridge.api.saveOldFavoriteSessions).not.toHaveBeenCalled()
  })

  it('writes a 30,000 item scan to one workspace batch in bounded immutable chunks', async () => {
    installOldFavoriteSessionBridge()
    const items = Array.from({ length: 30_000 }, (_, index) => ({
      aid: index + 1,
      title: `video-${index + 1}`,
      author: 'mock',
      tags: [],
      sourceFolderTitle: 'mock-source',
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识学习',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: true,
      originalSuggestedLedgerIds: ['knowledge'],
      currentTargetLedgerIds: ['knowledge'],
      selectedTargetLedgerIds: ['knowledge'],
      lowConfidence: false
    }))
    const preview: FavoriteLedgerPreview = {
      items,
      skippedSourceFolderTitles: [],
      scanContext: {
        accountMid: '42', totalUniqueVideos: items.length,
        sourceFolders: [], activeSourceFolders: [], protectedVideos: [],
        managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
      }
    }
    const createOldFavoriteWorkspaceBatch = vi.fn().mockResolvedValue({ id: 'workspace-batch' })
    const appendOldFavoriteWorkspaceChunkGroup = vi.fn().mockResolvedValue([])
    Object.assign(window.bilimiDesktop!, {
      openOldFavoriteWorkspaceAccount: vi.fn().mockResolvedValue({ version: 2, accountMid: '42', batches: [] }),
      createOldFavoriteWorkspaceBatch,
      appendOldFavoriteWorkspaceChunkGroup
    })
    renderPanel({
      currentAccountMid: '42',
      onPrepareOldFavoriteScan: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [] }),
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [] }),
      onScanOldFavorites: vi.fn().mockResolvedValue(preview)
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await waitFor(() => expect(appendOldFavoriteWorkspaceChunkGroup).toHaveBeenCalledTimes(60), { timeout: 10_000 })
    expect(createOldFavoriteWorkspaceBatch).toHaveBeenCalledOnce()
    expect(appendOldFavoriteWorkspaceChunkGroup.mock.calls.every((call) => {
      const chunks = call[2] as Record<string, unknown[]>
      return chunks.base.length === 500 && chunks.tags.length === 500 && chunks.sources.length === 500
    })).toBe(true)
  }, 15_000)

  it('keeps archive editor state in one aggregate runtime snapshot', () => {
    renderPanel()

    const aggregate = getOldFavoriteRuntimeValue<any>('archiveEditorState', null)
    expect(aggregate).toMatchObject({
      archivePlanState: null,
      selectedCandidateKeys: [],
      candidateSourceLedgerIdsByItemKey: {}
    })
    expect(Array.isArray(aggregate.draftLedgers)).toBe(true)
  })

  it('keeps duplicate-only source folders visible with raw and actionable counts', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[0].sourceFolderIds = ['source-default', 'source-cute']
    preview.items[0].sourceFolderTitles = ['默认收藏夹', '可爱收藏']
    preview.items[1].sourceFolderIds = ['source-default']
    preview.items[1].sourceFolderTitles = ['默认收藏夹']
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [
        {
          id: 'source-default',
          title: '默认收藏夹',
          videos: [
            { aid: 701, title: 'AI 效率工具实战', sourceFolderIds: ['source-default', 'source-cute'], sourceFolderTitles: ['默认收藏夹', '可爱收藏'] },
            { aid: 702, title: '暂时不知道放哪', sourceFolderIds: ['source-default'], sourceFolderTitles: ['默认收藏夹'] }
          ]
        }
      ],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off',
      sourceFolders: [
        { id: 'source-default', title: '默认收藏夹', mediaCount: 2, videos: [] },
        { id: 'source-cute', title: '可爱收藏', mediaCount: 1, videos: [] }
      ]
    } as FavoriteLedgerPreview['scanContext'] & {
      sourceFolders: Array<{ id: string; title: string; mediaCount: number; videos: [] }>
    }

    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByLabelText('整理来源 默认收藏夹，共 2')).toBeChecked()
    expect(screen.getByLabelText('整理来源 可爱收藏，共 1')).toBeChecked()
    const defaultRow = screen.getByRole('row', { name: '默认收藏夹，总数 2' })
    const cuteRow = screen.getByRole('row', { name: '可爱收藏，总数 1' })
    expect(within(defaultRow).getAllByText('2')).toHaveLength(2)
    expect(within(cuteRow).getAllByText('1')).toHaveLength(2)
  })

  it('keeps same-name source folders independent by folder id', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[0].sourceFolderIds = ['music-old']
    preview.items[0].sourceFolderTitles = ['音乐']
    preview.items[0].sourceFolderTitle = '音乐'
    preview.items[1].sourceFolderIds = ['music-new']
    preview.items[1].sourceFolderTitles = ['音乐']
    preview.items[1].sourceFolderTitle = '音乐'
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off',
      sourceFolders: [
        { id: 'music-old', title: '音乐', mediaCount: 19, videos: [] },
        { id: 'music-new', title: '音乐', mediaCount: 39, videos: [] }
      ]
    }

    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    const musicSources = [
      screen.getByLabelText('整理来源 音乐，共 19'),
      screen.getByLabelText('整理来源 音乐，共 39')
    ]
    const oldMusicRow = screen.getByRole('row', { name: '音乐，总数 19' })
    const newMusicRow = screen.getByRole('row', { name: '音乐，总数 39' })
    expect(within(oldMusicRow).getByText('19')).toBeInTheDocument()
    expect(within(oldMusicRow).getByText('1')).toBeInTheDocument()
    expect(within(newMusicRow).getByText('39')).toBeInTheDocument()
    expect(within(newMusicRow).getByText('1')).toBeInTheDocument()
    expect(musicSources).toHaveLength(2)
    expect(musicSources[0]).toBeChecked()
    expect(musicSources[1]).toBeChecked()

    fireEvent.click(musicSources[0])
    expect(musicSources[0]).not.toBeChecked()
    expect(musicSources[1]).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.queryByText(preview.items[0].title)).not.toBeInTheDocument()
    expect(screen.getAllByText(preview.items[1].title).length).toBeGreaterThan(0)
  })

  it('adds a readable occurrence number when same-name folders also have the same total', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[0].sourceFolderIds = ['music-1']
    preview.items[0].sourceFolderTitles = ['音乐']
    preview.items[1].sourceFolderIds = ['music-2']
    preview.items[1].sourceFolderTitles = ['音乐']
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off',
      sourceFolders: [
        { id: 'music-1', title: '音乐', mediaCount: 19, videos: [] },
        { id: 'music-2', title: '音乐', mediaCount: 19, videos: [] }
      ]
    }

    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByRole('row', { name: '音乐，总数 19，第 1 个' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: '音乐，总数 19，第 2 个' })).toBeInTheDocument()
    expect(screen.getByLabelText('整理来源 音乐，共 19，第 1 个')).toBeChecked()
    expect(screen.getByLabelText('整理来源 音乐，共 19，第 2 个')).toBeChecked()
  })

  it('migrates a legacy title selection to every valid same-name folder id', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[0].sourceFolderIds = ['music-old']
    preview.items[0].sourceFolderTitles = ['音乐']
    preview.items[1].sourceFolderIds = ['music-new']
    preview.items[1].sourceFolderTitles = ['音乐']
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off',
      sourceFolders: [
        { id: 'music-old', title: '音乐', mediaCount: 19, videos: [] },
        { id: 'music-new', title: '音乐', mediaCount: 39, videos: [] }
      ]
    }
    setOldFavoriteRuntimeValue('preview', preview)
    setOldFavoriteRuntimeValue('baseScanPreview', preview)
    setOldFavoriteRuntimeValue('selectedOldFavoriteSourceFolderTitles', new Set(['音乐']))

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    const musicSources = screen.getAllByLabelText(/^整理来源 音乐/)
    expect(musicSources).toHaveLength(2)
    expect(musicSources[0]).toBeChecked()
    expect(musicSources[1]).toBeChecked()
    await waitFor(() => expect(getOldFavoriteRuntimeValue(
      'selectedOldFavoriteSourceFolderTitles',
      new Set<string>()
    )).toEqual(new Set(['id:music-old', 'id:music-new'])))
    fireEvent.click(musicSources[0])
    expect(musicSources[0]).not.toBeChecked()
    expect(musicSources[1]).toBeChecked()
  })

  it('does not select failed or bilimi sources restored from stale runtime keys', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[0].sourceFolderIds = ['failed-source']
    preview.items[0].sourceFolderTitles = ['失败来源']
    preview.items[1].sourceFolderIds = ['managed-source']
    preview.items[1].sourceFolderTitles = ['bilimi·暂存']
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off',
      sourceFolders: [
        { id: 'failed-source', title: '失败来源', mediaCount: 1, scanFailed: true, videos: [] },
        { id: 'managed-source', title: 'bilimi·暂存', mediaCount: 1, videos: [] }
      ]
    }
    setOldFavoriteRuntimeValue('preview', preview)
    setOldFavoriteRuntimeValue('baseScanPreview', preview)
    setOldFavoriteRuntimeValue(
      'selectedOldFavoriteSourceFolderTitles',
      new Set(['id:failed-source', 'title:bilimi·暂存'])
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.queryByText(preview.items[0].title)).not.toBeInTheDocument()
    expect(screen.queryByText(preview.items[1].title)).not.toBeInTheDocument()
  })

  it('renders aligned user source columns and keeps failed and bilimi folders out of selectable sources', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[0].sourceFolderIds = ['source-default']
    preview.items[0].sourceFolderTitles = ['默认收藏夹']
    preview.items[0].sourceFolderTitle = '默认收藏夹'
    preview.items[1].sourceFolderIds = ['managed-inbox']
    preview.items[1].sourceFolderTitles = ['bilimi·待分类']
    preview.items[1].sourceFolderTitle = 'bilimi·待分类'
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off',
      sourceFolders: [
        { id: 'source-default', title: '默认收藏夹', mediaCount: 120, videos: [] },
        { id: 'source-failed', title: '番剧待看', mediaCount: 137, scanFailed: true, videos: [] },
        { id: 'managed-inbox', title: 'bilimi·待分类', mediaCount: 2, videos: [] }
      ]
    }

    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByText('待整理数会排除已整理视频，并对多个收藏夹中的同一视频去重，因此数量可能较少。')).toBeInTheDocument()
    const userSourceTable = screen.getByRole('table', { name: '用户收藏夹' })
    const userHeaderRow = within(userSourceTable).getByRole('row', { name: '选择 用户收藏夹 总数 本轮待整理' })
    expect(within(userHeaderRow).getByRole('columnheader', { name: '选择' })).toBeInTheDocument()
    expect(within(userHeaderRow).getByRole('columnheader', { name: '用户收藏夹' })).toBeInTheDocument()
    expect(within(userHeaderRow).getByRole('columnheader', { name: '总数' })).toBeInTheDocument()
    expect(within(userHeaderRow).getByRole('columnheader', { name: '本轮待整理' })).toBeInTheDocument()

    const defaultRow = screen.getByRole('row', { name: '默认收藏夹，总数 120' })
    expect(within(defaultRow).getAllByRole('cell')).toHaveLength(4)
    expect(within(defaultRow).getByText('120')).toBeInTheDocument()
    expect(within(defaultRow).getByText('1')).toBeInTheDocument()
    expect(within(defaultRow).getByText('默认收藏夹')).toHaveAttribute('title', '默认收藏夹')

    const failedSource = screen.getByLabelText('整理来源 番剧待看，共 137')
    expect(failedSource).toBeDisabled()
    expect(within(screen.getByRole('row', { name: '番剧待看，总数 137' })).getByText('扫描失败')).toBeInTheDocument()

    const bilimiSourceTable = screen.getByRole('table', { name: 'bilimi 工作夹' })
    const bilimiHeaderRow = within(bilimiSourceTable).getByRole('row', { name: '选择 bilimi 工作夹 已有 本轮待整理' })
    expect(within(bilimiHeaderRow).getByRole('columnheader', { name: '选择' })).toBeInTheDocument()
    expect(within(bilimiHeaderRow).getByRole('columnheader', { name: 'bilimi 工作夹' })).toBeInTheDocument()
    expect(within(bilimiHeaderRow).getByRole('columnheader', { name: '已有' })).toBeInTheDocument()
    expect(screen.queryByLabelText('整理来源 bilimi·待分类')).not.toBeInTheDocument()
    const managedRow = screen.getByRole('row', { name: 'bilimi·待分类，已有 2，本轮待整理 2' })
    expect(within(managedRow).getAllByRole('cell')).toHaveLength(4)
    expect(within(managedRow).getAllByText('2')).toHaveLength(2)
    expect(within(managedRow).queryByText('本轮待整理')).not.toBeInTheDocument()
  })

  it('explains failed and partial source scans and retries all folders with a full rescan', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off',
      sourceFolders: [
        {
          id: 'failed', title: '番剧待看', mediaCount: 137, scanFailed: true, scanStatus: 'failed',
          failedPage: 1, readVideoCount: 0, scanFailureMessage: 'request timeout', videos: []
        },
        {
          id: 'partial', title: '课程', mediaCount: 45, scanFailed: true, scanStatus: 'partial',
          failedPage: 3, readVideoCount: 40, scanFailureMessage: 'favorite resource list returned HTML instead of JSON', videos: []
        }
      ]
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByLabelText('整理来源 番剧待看，共 137')).toBeDisabled()
    expect(screen.getByLabelText('整理来源 课程，共 45')).toBeDisabled()
    expect(within(screen.getByRole('row', { name: '番剧待看，总数 137' })).getByText('扫描失败')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: '课程，总数 45' })).getByText('部分扫描')).toBeInTheDocument()
    expect(screen.getByText('第 1 页请求超时，已读取 0 条')).toBeInTheDocument()
    expect(screen.getByText('第 3 页收藏明细接口返回异常页面，已读取 40 条')).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: '重新扫描全部' })
    fireEvent.click(retry)
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledTimes(2))
    expect(onScanOldFavorites).toHaveBeenLastCalledWith({ multiArchiveMode: 'off' })
  })

  it.each([
    ['returns a failed result', 'result', '保存成功：主收藏同步失败'],
    ['throws', 'throw', '同步未完成：账号同步超时']
  ])('returns to an idle retryable state when the pre-scan ledger save %s', async (_case, failureKind, failureMessage) => {
    const onSaveLedgers = failureKind === 'throw'
      ? vi.fn().mockRejectedValue(new Error('账号同步超时'))
      : vi.fn().mockResolvedValue({ ok: false, steps: [], missingTargets: [], message: '主收藏同步失败' })
    const onScanOldFavorites = vi.fn()
    renderPanel({ onSaveLedgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await screen.findByText(failureMessage)
    await waitFor(() => expect(screen.queryByRole('button', { name: '取消旧藏扫描' })).not.toBeInTheDocument())
    expect(onScanOldFavorites).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: '整理旧藏' })).toBeEnabled())
  })

  it('shows folder failure diagnostics even when failed folders are excluded from source folders', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanDiagnostics = {
      tagDetailRequests: 2,
      tagDetailFailures: 0,
      taggedVideos: 2,
      untaggedVideos: 0,
      folderFailures: [
        {
          folderId: 'failed-anime',
          folderTitle: '番剧待看',
          failedPage: 3,
          attempts: 3,
          status: 'partial',
          message: 'request timeout',
          retainedVideoCount: 40
        },
        {
          folderId: 'failed-course',
          folderTitle: '课程收藏',
          failedPage: 1,
          attempts: 1,
          status: 'failed',
          message: 'favorite resource list returned HTML instead of JSON',
          retainedVideoCount: 0
        }
      ]
    }
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off',
      sourceFolders: [
        { id: 'successful', title: '默认收藏夹', mediaCount: 2, videos: [] }
      ]
    }

    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    const diagnostics = screen.getByRole('list', { name: '普通扫描失败' })
    expect(diagnostics).toHaveTextContent(/番剧待看.*部分扫描.*第\s*3\s*页.*请求超时.*尝试\s*3\s*次.*已读取\s*40\s*条/)
    expect(diagnostics).toHaveTextContent(/课程收藏.*扫描失败.*第\s*1\s*页.*收藏明细接口返回异常页面.*尝试\s*1\s*次.*已读取\s*0\s*条/)
  })

  it('classifies structured source failures without treating every HTML page as logged out', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanDiagnostics = {
      tagDetailRequests: 0,
      tagDetailFailures: 0,
      taggedVideos: 0,
      untaggedVideos: 0,
      folderFailures: [
        {
          folderId: 'login', folderTitle: '登录来源', failedPage: 1, attempts: 1,
          status: 'failed', operation: 'resource-list', message: 'html', retainedVideoCount: 0,
          errorKind: 'html', apiCode: -101, loginSignal: true,
          finalUrl: 'https://passport.bilibili.com/login'
        },
        {
          folderId: 'risk', folderTitle: '受限来源', failedPage: 1, attempts: 1,
          status: 'failed', operation: 'resource-list', message: 'html', retainedVideoCount: 0,
          errorKind: 'html', httpStatus: 412, riskSignal: true
        },
        {
          folderId: 'html', folderTitle: '未知页面', failedPage: 1, attempts: 1,
          status: 'failed', operation: 'resource-list', message: 'html', retainedVideoCount: 0,
          errorKind: 'html'
        },
        {
          folderId: 'skipped', folderTitle: '后续来源', failedPage: 1, attempts: 0,
          status: 'failed', operation: 'resource-list', message: 'skipped', retainedVideoCount: 0,
          errorKind: 'global-circuit-open', riskSignal: true
        }
      ]
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    const summary = screen.getByRole('alert', { name: '访问受限，扫描已安全停止' })
    expect(summary).toHaveTextContent(/第\s*1\s*页.*安全跳过\s*1\s*个收藏夹.*未发送请求.*已读取\s*0\s*条.*30\s*分钟.*2\s*小时/)
    const globalDetails = within(summary).getByText('查看详细信息').closest('details')
    expect(globalDetails).not.toHaveAttribute('open')
    expect(globalDetails).toHaveTextContent(/受限来源.*HTTP\s*412/)
    expect(globalDetails).toHaveTextContent(/后续来源.*未发送请求/)

    const diagnostics = screen.getByRole('list', { name: '普通扫描失败' })
    expect(diagnostics).toHaveTextContent(/登录来源.*登录状态失效/)
    expect(diagnostics).toHaveTextContent(/未知页面.*收藏明细接口返回异常页面/)
    expect(diagnostics).not.toHaveTextContent('受限来源')
    expect(diagnostics).not.toHaveTextContent('后续来源')
    expect(diagnostics).not.toHaveTextContent('尝试 0 次')
  })

  it('shows at most three ordinary scan failures before folding the rest', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanDiagnostics = {
      tagDetailRequests: 0,
      tagDetailFailures: 0,
      taggedVideos: 0,
      untaggedVideos: 0,
      folderFailures: Array.from({ length: 5 }, (_, index) => ({
        folderId: `failed-${index + 1}`,
        folderTitle: `普通失败 ${index + 1}`,
        failedPage: index + 1,
        attempts: 3,
        status: 'failed' as const,
        message: 'request timeout',
        retainedVideoCount: index
      }))
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(within(screen.getByRole('list', { name: '普通扫描失败' })).getAllByRole('listitem')).toHaveLength(3)
    const remaining = screen.getByText('查看其余 2 条普通失败').closest('details')
    expect(remaining).not.toHaveAttribute('open')
    expect(remaining).toHaveTextContent('普通失败 4')
    expect(remaining).toHaveTextContent('普通失败 5')
  })


  it('does not commit a resumable batch when execution pauses or fails', async () => {
    const preview = markPreviewAsResumableBatch(createArchivePreviewFixture())
    preview.batch!.hasMore = false
    const onCommitOldFavoriteBatchCheckpoint = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan: vi.fn().mockResolvedValue({
        ok: false,
        paused: true,
        steps: [],
        missingTargets: [],
        message: 'paused'
      }),
      onCommitOldFavoriteBatchCheckpoint
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await screen.findByText('访问受限，已安全停止。请等待 30 分钟后结束本轮并重新扫描。')
    expect(onCommitOldFavoriteBatchCheckpoint).not.toHaveBeenCalled()
  })

  it('does not allow execution while the source scan still has another batch to discover', async () => {
    const preview = markPreviewAsResumableBatch(createArchivePreviewFixture())
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('请等待扫描结束')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认整理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '使用当前结果执行' })).not.toBeInTheDocument()
  })

  it('does not allow execution after an ordinary source folder was only partially scanned', async () => {
    const preview = createArchivePreviewFixture()
    preview.skippedSourceFolderTitles = ['未完整收藏夹']
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2,
      sourceFolders: [{
        id: 'partial', title: '未完整收藏夹', videos: preview.items,
        scanFailed: true, scanStatus: 'partial', failedPage: 2, readVideoCount: 2
      }],
      activeSourceFolders: [], protectedVideos: [], managedFolders: [], targetMembership: {},
      multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('请等待扫描结束')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认整理' })).not.toBeInTheDocument()
  })




  it('allows abandoning from confirmation even with zero tasks or an unresolved target', async () => {
    const preview = markPreviewAsResumableBatch(createArchivePreviewFixture())
    preview.batch!.hasMore = false
    preview.items[0] = {
      ...preview.items[0],
      targetLedgerId: 'missing-ledger',
      targetDisplayName: '已失效目标',
      originalSuggestedLedgerIds: ['missing-ledger'],
      currentTargetLedgerIds: ['missing-ledger'],
      selectedTargetLedgerIds: ['missing-ledger']
    }
    const onCommitOldFavoriteBatchCheckpoint = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: 'committed'
    })
    const onExecuteOldFavoritePlan = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onCommitOldFavoriteBatchCheckpoint
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText(/无法解析归档目标/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认整理' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '结束本轮' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认结束本轮？' })
    expect(dialog).toHaveTextContent('转为历史只读')
    fireEvent.click(within(dialog).getByRole('button', { name: '确认结束' }))

    expect(onCommitOldFavoriteBatchCheckpoint).not.toHaveBeenCalled()
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
  })

  async function openArchivePreview(overrides: Partial<Parameters<typeof FavoriteLedgerPanel>[0]> = {}) {
    const preview = createArchivePreviewFixture()
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const renderResult = renderPanel({
      onScanOldFavorites,
      ...overrides
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    return { ...renderResult, onScanOldFavorites, preview }
  }

  function selectDeepSeekArchiveScope(label: string) {
    fireEvent.click(screen.getByRole('button', { name: '整理范围' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: label }))
  }

  function confirmOldFavoriteExecution() {
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认开始整理？' })
    expect(dialog).toHaveTextContent('小咪提醒：主人要开始整理吗？开始后就不能再调整了哦！')
    fireEvent.click(within(dialog).getByRole('button', { name: '开始整理' }))
  }

  it('keeps later steps clickable but hides their content until the whole scan flow completes', async () => {
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    const onScanOldFavorites = vi.fn(() => new Promise<FavoriteLedgerPreview>((resolve) => {
      resolveScan = resolve
    }))
    renderPanel({
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    const generatedStep = screen.getByRole('button', { name: '推荐收藏夹' })
    expect(generatedStep).toBeEnabled()
    expect(screen.getByText('视频基本信息')).toBeInTheDocument()
    expect(screen.getByText('标签补取')).toBeInTheDocument()
    expect(screen.getByText('正在读取')).toBeInTheDocument()
    expect(screen.queryByText('0 / 1')).not.toBeInTheDocument()

    fireEvent.click(generatedStep)
    expect(screen.getByRole('heading', { name: '推荐收藏夹' })).toBeInTheDocument()
    expect(screen.getByText('确认执行后，会把已勾选候选同步到 B 站收藏夹里。')).toBeInTheDocument()
    expect(screen.getByText('请等待扫描结束')).toBeInTheDocument()
    expect(screen.queryByText('专属 UP 追更')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('heading', { name: '归档预览' })).toBeInTheDocument()
    expect(screen.getByText('请等待扫描结束')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新归档预览' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByRole('heading', { name: '确认执行' })).toBeInTheDocument()
    expect(screen.getByText('请等待扫描结束')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认整理' })).not.toBeInTheDocument()

    resolveScan({
      items: [],
      skippedSourceFolderTitles: [],
      scanProgress: {
        basic: { completed: 2536, total: 2536, status: 'complete' },
        tags: { completed: 378, total: 2158, pending: 1780, cacheHits: 126, succeeded: 252, failed: 0, status: 'running' }
      }
    })

    await waitFor(() => expect(screen.getByText('请等待扫描结束')).toBeInTheDocument())
    expect(screen.getByText(/标签仍在后台补取/)).toBeInTheDocument()
    expect(screen.getByText('378 / 2158')).toBeInTheDocument()
  })

  it('reads one full snapshot and unlocks the stable preview when tag enrichment completes', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: undefined, totalUniqueVideos: 2,
      activeSourceFolders: [{ id: 'default', title: preview.items[0].sourceFolderTitle, videos: preview.items }],
      protectedVideos: [], managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete' },
      tags: { completed: 0, total: 1, pending: 1, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' }
    }
    const completedSnapshot = {
      sourceFolders: [{ id: 'default', title: preview.items[0].sourceFolderTitle, videos: [{ aid: 701, title: preview.items[0].title, description: preview.items[0].description, author: preview.items[0].author, category: '', tags: ['新标签'] }] }],
      scanProgress: { basic: { completed: 2, total: 2, status: 'complete' }, tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' } }
    }
    let resolveProgress!: (snapshot: typeof completedSnapshot) => void
    const onReadOldFavoriteTagEnrichment = vi.fn((action = 'read') => action === 'progress'
      ? new Promise<typeof completedSnapshot>((resolve) => { resolveProgress = resolve })
      : Promise.resolve(completedSnapshot))
    const createPreviewSpy = vi.spyOn(favoriteLedgerPreviewModule, 'createFavoriteLedgerPreview')
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    const previewStep = screen.getByRole('button', { name: '归档预览' })
    fireEvent.click(previewStep)
    expect(screen.getByText('请等待扫描结束')).toBeInTheDocument()
    createPreviewSpy.mockClear()

    await act(async () => { resolveProgress({ ...completedSnapshot, sourceFolders: [] }); await Promise.resolve() })

    await waitFor(() => expect(createPreviewSpy).toHaveBeenCalledOnce())
    expect(onReadOldFavoriteTagEnrichment.mock.calls.filter(([action]) => action === 'read')).toHaveLength(1)
    expect(screen.queryByText('请等待扫描结束')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新归档预览' })).not.toBeInTheDocument()
    expect(screen.queryByText('标签补取已完成，重新进入归档预览或点击刷新后，将按最新标签重新计算。')).not.toBeInTheDocument()
  })

  it('rebuilds archive targets from enriched title, UP, category, and tags', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game' ? { ...ledger, bilibiliFolderId: '9002' } : ledger
    )
    const preview = createArchivePreviewFixture()
    preview.items = [{
      ...preview.items[1],
      aid: 750,
      title: '尚未识别',
      author: '',
      category: '',
      tags: []
    }]
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 1,
      activeSourceFolders: [{ id: 'default', title: '默认收藏夹', videos: preview.items }],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    preview.scanProgress = {
      basic: { completed: 1, total: 1, status: 'complete' },
      tags: { completed: 0, total: 1, pending: 1, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' }
    }
    const completedSnapshot = {
      sourceFolders: [{
        id: 'default',
        title: '默认收藏夹',
        videos: [{
          aid: 750,
          title: '原神角色配队攻略',
          author: '游戏研究社',
          category: '游戏',
          description: '手游实战',
          tags: ['原神', '攻略']
        }]
      }],
      scanProgress: {
        basic: { completed: 1, total: 1, status: 'complete' },
        tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' }
      }
    }
    let resolveProgress!: (snapshot: typeof completedSnapshot) => void
    const onReadOldFavoriteTagEnrichment = vi.fn((action = 'read') => action === 'progress'
      ? new Promise<typeof completedSnapshot>((resolve) => { resolveProgress = resolve })
      : Promise.resolve(completedSnapshot))
    const createPreviewSpy = vi.spyOn(favoriteLedgerPreviewModule, 'createFavoriteLedgerPreview')

    renderPanel({ ledgers, onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByText('请等待扫描结束')).toBeInTheDocument()

    await act(async () => { resolveProgress(completedSnapshot); await Promise.resolve() })

    await waitFor(() => expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toBeInTheDocument())
    expect(screen.queryByRole('group', { name: /未匹配到合适分类/ })).not.toBeInTheDocument()
    const gameGroup = screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })
    expect(gameGroup).toHaveTextContent('原神角色配队攻略')
    expect(gameGroup).toHaveTextContent('UP：游戏研究社')
    expect(createPreviewSpy).toHaveBeenCalledWith(expect.objectContaining({
      sourceFolders: [expect.objectContaining({
        videos: [expect.objectContaining({ category: '游戏', tags: ['原神', '攻略'] })]
      })]
    }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
  })

  it('does not reread or rebuild an already completed stable snapshot after remount', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete', runId: 'stable-run' },
      tags: { completed: 2, total: 2, pending: 0, cacheHits: 0, succeeded: 2, failed: 0, status: 'complete' }
    }
    setOldFavoriteRuntimeValue('preview', preview)
    setOldFavoriteRuntimeValue('baseScanPreview', preview)
    const onReadOldFavoriteTagEnrichment = vi.fn()

    renderPanel({ onReadOldFavoriteTagEnrichment })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(onReadOldFavoriteTagEnrichment).not.toHaveBeenCalled()
  })

  it('does not rebuild scanned source counts when only tag progress changes', async () => {
    const preview = createArchivePreviewFixture()
    let filterReads = 0
    const baseItems = new Proxy(preview.items, {
      get(target, property, receiver) {
        if (property === 'filter') filterReads += 1
        return Reflect.get(target, property, receiver)
      }
    })
    const basePreview = { ...preview, items: baseItems }
    basePreview.scanContext = {
      accountMid: undefined, totalUniqueVideos: 2,
      activeSourceFolders: [{ id: 'default', title: '默认收藏夹', videos: baseItems }],
      protectedVideos: [], managedFolders: [], targetMembership: {}, multiArchiveMode: 'off',
      sourceFolders: [{ id: 'default', title: '默认收藏夹', mediaCount: 2, videos: [] }]
    }
    preview.scanContext = basePreview.scanContext
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete' },
      tags: { completed: 0, total: 2, pending: 2, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' }
    }
    let resolveProgress!: (snapshot: any) => void
    const onReadOldFavoriteTagEnrichment = vi.fn(() => new Promise((resolve) => { resolveProgress = resolve }))
    setOldFavoriteRuntimeValue('preview', preview)
    setOldFavoriteRuntimeValue('baseScanPreview', basePreview)
    renderPanel({ onReadOldFavoriteTagEnrichment })
    await waitFor(() => expect(filterReads).toBeGreaterThan(0))
    const readsAfterInitialSummary = filterReads

    await act(async () => {
      resolveProgress({
        sourceFolders: [],
        scanProgress: {
          basic: { completed: 2, total: 2, status: 'complete' },
          tags: { completed: 1, total: 2, pending: 1, cacheHits: 0, succeeded: 1, failed: 0, status: 'running' }
        }
      })
      await Promise.resolve()
    })

    expect(filterReads).toBe(readsAfterInitialSummary)
  })

  it('retries the completion snapshot after a transient full-read failure', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete' },
      tags: { completed: 1, total: 2, pending: 1, cacheHits: 0, succeeded: 1, failed: 0, status: 'running' }
    }
    const completedSnapshot = {
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 2, total: 2, status: 'complete' as const },
        tags: { completed: 2, total: 2, pending: 0, cacheHits: 0, succeeded: 2, failed: 0, status: 'complete' as const }
      }
    }
    let readAttempts = 0
    let resolveFirstProgress!: (snapshot: typeof completedSnapshot) => void
    let progressAttempts = 0
    const onReadOldFavoriteTagEnrichment = vi.fn((action = 'read') => {
      if (action === 'progress') {
        progressAttempts += 1
        return progressAttempts === 1
          ? new Promise<typeof completedSnapshot>((resolve) => { resolveFirstProgress = resolve })
          : Promise.resolve(completedSnapshot)
      }
      readAttempts += 1
      return readAttempts === 1
        ? Promise.reject(new Error('temporary read failure'))
        : Promise.resolve(completedSnapshot)
    })
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    const previewStep = screen.getByRole('button', { name: '归档预览' })
    await waitFor(() => expect(previewStep).toBeEnabled())
    fireEvent.click(previewStep)
    await act(async () => {
      resolveFirstProgress(completedSnapshot)
      await Promise.resolve()
    })

    await waitFor(() => expect(readAttempts).toBeGreaterThanOrEqual(2), { timeout: 2500 })
    expect(screen.queryByText('请等待扫描结束')).not.toBeInTheDocument()
  })

  it('accepts a corrected tag snapshot after an impossible completed count was displayed', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 2337, total: 2337, status: 'complete' },
      tags: { completed: 2457, total: 2337, pending: 0, cacheHits: 0, succeeded: 2457, failed: 0, status: 'complete' }
    }
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: preview.scanContext?.activeSourceFolders ?? [],
      scanProgress: {
        basic: { completed: 2337, total: 2337, status: 'complete' },
        tags: { completed: 2300, total: 2337, pending: 37, cacheHits: 0, succeeded: 2300, failed: 0, status: 'running' }
      }
    })

    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await waitFor(() => expect(screen.getByText('2300 / 2337')).toBeInTheDocument())
  })

  it('replaces an impossible complete tag snapshot whose work is still unfinished', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete' },
      tags: { completed: 5, total: 10, pending: 0, cacheHits: 0, succeeded: 5, failed: 0, status: 'complete' }
    }
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 2, total: 2, status: 'complete' },
        tags: { completed: 4, total: 10, pending: 6, cacheHits: 0, succeeded: 4, failed: 0, status: 'running' }
      }
    })
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByText('4 / 10')).toBeInTheDocument()
  })

  it('uses the unique scanned video count in the overview metrics', async () => {
    const preview = createArchivePreviewFixture()
    preview.insights = { ...preview.insights!, totalVideos: 3 }
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    const scannedMetric = screen.getByText('共扫描').closest('article')
    expect(scannedMetric).toHaveTextContent('共扫描2')
    expect(scannedMetric).not.toHaveTextContent('3')
  })

  it('only merges tag progress outside archive preview without rebuilding the large preview', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete' },
      tags: { completed: 0, total: 2, pending: 2, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' }
    }
    const createPreviewSpy = vi.spyOn(favoriteLedgerPreviewModule, 'createFavoriteLedgerPreview')
    const intermediateSnapshot = {
      sourceFolders: [],
      scanProgress: { ...preview.scanProgress, tags: { ...preview.scanProgress.tags, completed: 1, pending: 1 } }
    }
    let resolveSnapshot!: (snapshot: typeof intermediateSnapshot) => void
    const onReadOldFavoriteTagEnrichment = vi.fn(() => new Promise<typeof intermediateSnapshot>((resolve) => {
      resolveSnapshot = resolve
    }))
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    await waitFor(() => expect(screen.getByRole('button', { name: '归档预览' })).toBeEnabled())
    createPreviewSpy.mockClear()

    await act(async () => { resolveSnapshot(intermediateSnapshot); await Promise.resolve() })

    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(createPreviewSpy).not.toHaveBeenCalled()
  })

  it('uses the unique scanned count in the normal organization status message', async () => {
    const preview = createArchivePreviewFixture()
    preview.insights = { ...preview.insights!, totalVideos: 3 }
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    const onOldFavoriteStatusUpdate = vi.fn()
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onOldFavoriteStatusUpdate })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByText('已扫描 2 条旧藏，可勾选后整理。')).toBeInTheDocument()
    expect(onOldFavoriteStatusUpdate).toHaveBeenCalledWith(expect.objectContaining({
      message: '已扫描 2 条旧藏，可勾选后整理。'
    }))
  })

  it('opens the first ready streaming segment for classification before the full scan resolves', async () => {
    let progressReads = 0
    const firstSegmentFolder = {
      id: 'first', title: '第一组来源', videos: [{
        aid: 901, title: '第一组视频', author: 'UP一', description: '第一组', tags: ['AI']
      }]
    }
    const onReadOldFavoriteTagEnrichment = vi.fn(() => Promise.resolve({
      accountMid: '42', sourceFolders: [], discoveredAids: progressReads++ === 0 ? [901] : [],
      readySegments: [{ index: 0, status: 'ready' as const, aids: [901], sourceFolders: [firstSegmentFolder] }],
      sourceUpdates: [],
      scanProgress: {
        basic: { completed: 2000, total: 30000, status: 'running' as const, runId: 'stream-run' },
        tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' as const }
      }
    }))
    const { api } = installOldFavoriteSessionBridge()
    const createOldFavoriteWorkspaceBatch = vi.fn().mockResolvedValue({ id: 'workspace-batch' })
    const appendOldFavoriteWorkspaceChunk = vi.fn().mockResolvedValue({})
    Object.assign(api, {
      createOldFavoriteWorkspaceBatch,
      appendOldFavoriteWorkspaceChunk
    })
    const view = renderPanel({
      currentAccountMid: '42',
      onReadCurrentOldFavoriteAccount: vi.fn().mockResolvedValue('42'),
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => pendingScan()),
      onReadOldFavoriteTagEnrichment
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    await waitFor(() => expect(
      getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items[0]?.title
    ).toBe('第一组视频'))
    await waitFor(() => expect(appendOldFavoriteWorkspaceChunk).toHaveBeenCalledWith(
      '42', expect.any(String), 'base', expect.arrayContaining([expect.objectContaining({ aid: 901 })])
    ))
    expect(appendOldFavoriteWorkspaceChunk).toHaveBeenCalledWith(
      '42', expect.any(String), 'tags', expect.arrayContaining([expect.objectContaining({ aid: 901 })])
    )
    expect(appendOldFavoriteWorkspaceChunk).toHaveBeenCalledWith(
      '42', expect.any(String), 'sources', expect.arrayContaining([expect.objectContaining({ aid: 901 })])
    )
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.queryByText('请等待扫描结束')).not.toBeInTheDocument()
    expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items.map((item) => item.title))
      .toEqual(['第一组视频'])
  })

  it('applies a ready segment once and merges later source updates without overwriting a manual decision', async () => {
    let poll = 0
    const firstFolder = {
      id: 'first', title: '第一来源', videos: [{ aid: 902, title: '不重复视频', tags: ['科技'] }]
    }
    const snapshot = () => ({
      accountMid: '42', sourceFolders: [], discoveredAids: poll === 0 ? [902] : [],
      readySegments: [{ index: 0, status: 'ready' as const, aids: [902], sourceFolders: [firstFolder] }],
      sourceUpdates: poll > 0
        ? [{ aid: 902, segmentIndex: 0, folderId: 'second', folderTitle: '第二来源', relationKey: 'first:second' }]
        : [],
      scanProgress: {
        basic: { completed: 2000 + poll, total: 30000, status: 'running' as const, runId: 'stream-run' },
        tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' as const }
      }
    })
    const onReadOldFavoriteTagEnrichment = vi.fn(() => Promise.resolve(snapshot()))
    renderPanel({
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => pendingScan()),
      onReadOldFavoriteTagEnrichment
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(
      getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items[0]?.title
    ).toBe('不重复视频'))
    const editor = getOldFavoriteRuntimeValue<any>('archiveEditorState', null)
    setOldFavoriteRuntimeValue('archiveEditorState', {
      ...editor,
      archivePlanState: {
        ...editor.archivePlanState,
        items: editor.archivePlanState.items.map((item: any) => item.aid === 902 ? {
        ...item, currentTargetLedgerIds: ['game'], selectedTargetLedgerIds: ['game'],
        userModified: true, lastChangeSource: 'user'
        } : item)
      }
    })
    poll = 1

    await waitFor(() => expect(onReadOldFavoriteTagEnrichment.mock.calls.length).toBeGreaterThan(2), { timeout: 2500 })
    const preview = getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)
    const plan = getOldFavoriteRuntimeValue<any>('archiveEditorState', null).archivePlanState
    expect(preview?.items).toHaveLength(1)
    expect(preview?.items[0].sourceFolderIds).toEqual(['first', 'second'])
    expect(plan.items[0]).toMatchObject({
      currentTargetLedgerIds: ['game'], selectedTargetLedgerIds: ['game'],
      userModified: true, lastChangeSource: 'user'
    })
  })

  it('switches between ready segments without mixing videos or losing the first segment edit', async () => {
    const first = { id: 'first', title: '一组', videos: [{ aid: 911, title: '第一段', tags: ['AI'] }] }
    const second = { id: 'second', title: '二组', videos: [{ aid: 912, title: '第二段', tags: ['音乐'] }] }
    let includeSecond = false
    const onReadOldFavoriteTagEnrichment = vi.fn(() => Promise.resolve({
      accountMid: '42', sourceFolders: [], discoveredAids: [], sourceUpdates: [],
      readySegments: [
        { index: 0, status: 'ready' as const, aids: [911], sourceFolders: [first] },
        ...(includeSecond ? [{ index: 1, status: 'ready' as const, aids: [912], sourceFolders: [second] }] : [])
      ],
      scanProgress: {
        basic: { completed: includeSecond ? 4000 : 2000, total: 30000, status: 'running' as const, runId: 'segments' },
        tags: { completed: includeSecond ? 2 : 1, total: includeSecond ? 2 : 1, pending: 0, cacheHits: 0, succeeded: includeSecond ? 2 : 1, failed: 0, status: 'complete' as const }
      }
    }))
    renderPanel({
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => pendingScan()), onReadOldFavoriteTagEnrichment
    })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items[0].aid).toBe(911))
    const editor = getOldFavoriteRuntimeValue<any>('archiveEditorState', null)
    act(() => setOldFavoriteRuntimeValue('archiveEditorState', {
      ...editor,
      archivePlanState: {
        ...editor.archivePlanState,
        items: editor.archivePlanState.items.map((item: any) => ({
          ...item, currentTargetLedgerIds: ['game'], selectedTargetLedgerIds: ['game'],
          userModified: true, lastChangeSource: 'user'
        }))
      }
    }))
    includeSecond = true
    await waitFor(() => expect(screen.getByRole('combobox', { name: '当前性能分段' })).toBeInTheDocument(), { timeout: 2500 })
    fireEvent.change(screen.getByRole('combobox', { name: '当前性能分段' }), { target: { value: '2' } })
    expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items.map((item) => item.aid)).toEqual([912])
    fireEvent.change(screen.getByRole('combobox', { name: '当前性能分段' }), { target: { value: '1' } })
    expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items.map((item) => item.aid)).toEqual([911])
    expect(getOldFavoriteRuntimeValue<any>('archiveEditorState', null).archivePlanState.items[0])
      .toMatchObject({ currentTargetLedgerIds: ['game'], userModified: true, lastChangeSource: 'user' })
  })

  it('keeps the active segment edit when the final full scan snapshot resolves', async () => {
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    const segmentFolder = { id: 'first', title: '一组', videos: [{ aid: 921, title: '首段视频', tags: ['AI'] }] }
    const onReadOldFavoriteTagEnrichment = vi.fn(() => Promise.resolve({
      accountMid: '42', sourceFolders: [], discoveredAids: [921], sourceUpdates: [],
      readySegments: [{ index: 0, status: 'ready' as const, aids: [921], sourceFolders: [segmentFolder] }],
      scanProgress: {
        basic: { completed: 2000, total: 30000, status: 'running' as const, runId: 'final-run' },
        tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' as const }
      }
    }))
    renderPanel({
      onReadCurrentOldFavoriteAccount: vi.fn().mockResolvedValue('42'),
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => new Promise((resolve) => { resolveScan = resolve })),
      onReadOldFavoriteTagEnrichment
    })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items[0]?.aid).toBe(921))
    const editor = getOldFavoriteRuntimeValue<any>('archiveEditorState', null)
    act(() => setOldFavoriteRuntimeValue('archiveEditorState', {
      ...editor,
      archivePlanState: {
        ...editor.archivePlanState,
        items: editor.archivePlanState.items.map((item: any) => ({
          ...item, currentTargetLedgerIds: ['game'], selectedTargetLedgerIds: ['game'],
          userModified: true, lastChangeSource: 'user'
        }))
      }
    }))
    const finalPreview = createArchivePreviewFixture()
    finalPreview.items = [{ ...finalPreview.items[0], aid: 921, title: '完整扫描标题' }]
    finalPreview.scanProgress = {
      basic: { completed: 30000, total: 30000, status: 'complete', runId: 'final-run' },
      tags: { completed: 30000, total: 30000, pending: 0, cacheHits: 0, succeeded: 30000, failed: 0, status: 'complete' }
    }
    finalPreview.scanContext = {
      accountMid: '42', totalUniqueVideos: 30000, sourceFolders: [], activeSourceFolders: [],
      protectedVideos: [], managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    await act(async () => { resolveScan(finalPreview); await Promise.resolve() })

    await waitFor(() => expect(getOldFavoriteRuntimeValue<any>('archiveEditorState', null).archivePlanState.items[0])
      .toMatchObject({ currentTargetLedgerIds: ['game'], userModified: true, lastChangeSource: 'user' }))
    expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items[0]?.title).toBe('完整扫描标题')
  })

  it('reconciles a streamed segment with final target membership without losing its manual classification', async () => {
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game' ? { ...ledger, bilibiliFolderId: 'game-folder' } : ledger
    )
    const segmentFolder = { id: 'source', title: '来源', videos: [{ aid: 931, title: '已在目标', tags: ['游戏'] }] }
    const onReadOldFavoriteTagEnrichment = vi.fn(() => Promise.resolve({
      accountMid: '42', sourceFolders: [], discoveredAids: [931], sourceUpdates: [],
      readySegments: [{ index: 0, status: 'ready' as const, aids: [931], sourceFolders: [segmentFolder] }],
      scanProgress: {
        basic: { completed: 2000, total: 30000, status: 'running' as const, runId: 'reconcile-run' },
        tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' as const }
      }
    }))
    renderPanel({
      ledgers,
      onReadCurrentOldFavoriteAccount: vi.fn().mockResolvedValue('42'),
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => new Promise((resolve) => { resolveScan = resolve })),
      onReadOldFavoriteTagEnrichment
    })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items[0]?.aid).toBe(931))
    const editor = getOldFavoriteRuntimeValue<any>('archiveEditorState', null)
    act(() => setOldFavoriteRuntimeValue('archiveEditorState', {
      ...editor,
      archivePlanState: {
        ...editor.archivePlanState,
        items: editor.archivePlanState.items.map((item: any) => ({
          ...item, currentTargetLedgerIds: ['game'], selectedTargetLedgerIds: ['game'],
          userModified: true, lastChangeSource: 'user'
        }))
      }
    }))
    const finalPreview = createArchivePreviewFixture()
    finalPreview.items = [{
      ...finalPreview.items[0], aid: 931, title: '已在目标', targetLedgerId: 'game',
      targetFolderId: 'game-folder', targetDisplayName: 'bilimi·游戏专区',
      currentBilimiFolderIds: ['game-folder'], alreadyInTarget: true,
      originalSuggestedLedgerIds: ['game'], currentTargetLedgerIds: ['game'], selectedTargetLedgerIds: []
    }]
    finalPreview.scanProgress = {
      basic: { completed: 30000, total: 30000, status: 'complete', runId: 'reconcile-run' },
      tags: { completed: 30000, total: 30000, pending: 0, cacheHits: 0, succeeded: 30000, failed: 0, status: 'complete' }
    }
    finalPreview.scanContext = {
      accountMid: '42', totalUniqueVideos: 30000, sourceFolders: [], activeSourceFolders: [],
      protectedVideos: [], managedFolders: [{ id: 'game-folder', title: 'bilimi·游戏专区', ledgerId: 'game', isInbox: false }],
      targetMembership: { 'game-folder': [931] }, multiArchiveMode: 'off'
    }
    await act(async () => { resolveScan(finalPreview); await Promise.resolve() })

    await waitFor(() => expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.items[0])
      .toMatchObject({ aid: 931, currentBilimiFolderIds: ['game-folder'], alreadyInTarget: true }))
    expect(getOldFavoriteRuntimeValue<any>('archiveEditorState', null).archivePlanState.items[0])
      .toMatchObject({ currentTargetLedgerIds: ['game'], userModified: true, lastChangeSource: 'user' })
    await waitFor(() => {
      const batch = getOldFavoriteRuntimeValue<any[]>('oldFavoriteUserBatches', [])[0]
      expect(batch.snapshot.segmentSnapshots[0].finalReconciled).toBe(true)
    })
  })

  it('polls real intermediate basic discovery progress before the scan result returns', async () => {
    vi.useFakeTimers()
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: [],
      scanProgress: { basic: { completed: 40, total: 100, status: 'running', runId: 'new-run' }, tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'idle' } }
    })
    const view = renderPanel({
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => new Promise((resolve) => { resolveScan = resolve })),
      onReadOldFavoriteTagEnrichment
    })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await act(async () => { vi.advanceTimersByTime(1600); await Promise.resolve() })
    expect(screen.getByText('40 / 100')).toBeInTheDocument()
    await act(async () => {
      resolveScan({ items: [], skippedSourceFolderTitles: [] })
      await Promise.resolve()
    })
    view.unmount()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('ignores another progress run after locking onto the active run', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 1, total: 1, status: 'complete', runId: 'old-run' },
      tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' }
    }
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 1, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off',
      sourceFolders: [{ id: 'failed', title: '旧收藏夹', scanFailed: true, scanStatus: 'failed', videos: [] }]
    }
    let rescanStarted = false
    let activeReturned = false
    let otherReturned = false
    const activeSnapshot = {
      accountMid: '42', sourceFolders: [],
      scanProgress: {
        basic: { completed: 10, total: 100, status: 'running' as const, runId: 'new-run', phase: 'listing' as const },
        tags: { completed: 0, total: 100, pending: 100, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' as const }
      }
    }
    const otherSnapshot = {
      ...activeSnapshot,
      scanProgress: {
        basic: { completed: 77, total: 77, status: 'complete' as const, runId: 'other-run' },
        tags: { completed: 77, total: 77, pending: 0, cacheHits: 0, succeeded: 77, failed: 0, status: 'complete' as const }
      }
    }
    const onReadOldFavoriteTagEnrichment = vi.fn(() => {
      if (!rescanStarted) return Promise.resolve({ ...activeSnapshot, scanProgress: preview.scanProgress })
      if (!activeReturned) {
        activeReturned = true
        return Promise.resolve(activeSnapshot)
      }
      otherReturned = true
      return Promise.resolve(otherSnapshot)
    })
    const onScanOldFavorites = vi.fn().mockResolvedValueOnce(preview).mockReturnValueOnce(pendingScan())
    renderPanel({ onScanOldFavorites, onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    vi.useFakeTimers()
    rescanStarted = true
    fireEvent.click(screen.getByRole('button', { name: '重新扫描全部' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
      await Promise.resolve()
    })
    expect(otherReturned).toBe(true)
    expect(screen.queryByText('77 / 77')).not.toBeInTheDocument()
    expect(screen.getByText('10 / 100')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('does not persist discovered aids into the full session during lightweight progress polling', async () => {
    let poll = 0
    const folder = {
      id: 'first', title: '第一组来源', videos: [{ aid: 901, title: '第一组视频', tags: ['AI'] }]
    }
    const onReadOldFavoriteTagEnrichment = vi.fn(() => Promise.resolve({
      accountMid: '42', sourceFolders: [], discoveredAids: poll++ === 1 ? [901] : [],
      readySegments: [{ index: 0, status: 'ready' as const, aids: [901], sourceFolders: [folder] }],
      sourceUpdates: [],
      scanProgress: {
        basic: { completed: 2000, total: 30000, status: 'running' as const, runId: 'poll-no-session-write' },
        tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' as const }
      }
    }))
    const sessionBridge = installOldFavoriteSessionBridge()
    renderPanel({
      currentAccountMid: '42',
      onReadCurrentOldFavoriteAccount: vi.fn().mockResolvedValue('42'),
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => pendingScan()),
      onReadOldFavoriteTagEnrichment
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    await waitFor(() => expect(onReadOldFavoriteTagEnrichment).toHaveBeenCalled())
    sessionBridge.api.saveOldFavoriteSessions.mockClear()
    await waitFor(() => expect(onReadOldFavoriteTagEnrichment.mock.calls.length).toBeGreaterThan(1), { timeout: 2500 })

    expect(sessionBridge.api.saveOldFavoriteSessions).not.toHaveBeenCalled()
  })

  it('builds 30,000-item segment execution counts in one item pass', () => {
    const segments = Array.from({ length: 15 }, (_, segmentIndex) =>
      Array.from({ length: 2_000 }, (_, itemIndex) => segmentIndex * 2_000 + itemIndex + 1)
    )
    const items = Array.from({ length: 30_000 }, (_, index) => ({ aid: index + 1 }))

    expect(buildOldFavoriteSegmentExecution(segments, items)).toEqual(
      segments.map((_, index) => ({ index, status: 'ready', executableCount: 2_000, completedCount: 0 }))
    )
  })

  it('establishes a fresh run guard after cancelling the previous scan generation', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 1, total: 1, status: 'complete', runId: 'old-run' },
      tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' }
    }
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 1, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off',
      sourceFolders: [{ id: 'failed', title: '旧收藏夹', scanFailed: true, scanStatus: 'failed', videos: [] }]
    }
    let activeRun = 'old-run'
    const snapshot = () => ({
      accountMid: '42', sourceFolders: [],
      scanProgress: activeRun === 'old-run' ? preview.scanProgress! : {
        basic: {
          completed: activeRun === 'run-one' ? 1 : 2, total: 10, status: 'running' as const,
          runId: activeRun, phase: 'requesting' as const, folderTitle: activeRun, page: 1, attempt: 1
        },
        tags: { completed: 0, total: 10, pending: 10, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' as const }
      }
    })
    const onReadOldFavoriteTagEnrichment = vi.fn(() => Promise.resolve(snapshot()))
    const onScanOldFavorites = vi.fn()
      .mockResolvedValueOnce(preview)
      .mockReturnValue(pendingScan())
    renderPanel({ onScanOldFavorites, onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    activeRun = 'run-one'
    fireEvent.click(screen.getByRole('button', { name: '重新扫描全部' }))
    expect(await screen.findByText('正在读取“run-one”第 1 页（第 1/3 次请求）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消旧藏扫描' }))
    await screen.findByText('已取消扫描。')

    activeRun = 'run-two'
    fireEvent.click(screen.getByRole('button', { name: '重新扫描全部' }))
    expect(await screen.findByText('正在读取“run-two”第 1 页（第 1/3 次请求）')).toBeInTheDocument()
    expect(screen.getByText('2 / 10')).toBeInTheDocument()
  })

  it('rejects an older progress snapshot that resolves after the scan result locks its run', async () => {
    const finalPreview = createArchivePreviewFixture()
    finalPreview.scanProgress = {
      basic: { completed: 10, total: 10, status: 'complete', runId: 'new-run' },
      tags: { completed: 5, total: 10, pending: 5, cacheHits: 0, succeeded: 5, failed: 0, status: 'running' }
    }
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    let resolveOldProgress!: (snapshot: any) => void
    let resolveFollowupProgress: ((snapshot: any) => void) | undefined
    let firstProgressPending = true
    const onReadOldFavoriteTagEnrichment = vi.fn((action = 'read') => {
      if (action === 'progress' && firstProgressPending) {
        firstProgressPending = false
        return new Promise((resolve) => { resolveOldProgress = resolve })
      }
      return new Promise((resolve) => { resolveFollowupProgress = resolve })
    })
    renderPanel({
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => new Promise((resolve) => { resolveScan = resolve })),
      onReadOldFavoriteTagEnrichment
    })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(resolveOldProgress).toBeTypeOf('function'))
    await act(async () => { resolveScan(finalPreview); await Promise.resolve() })
    await waitFor(() => expect(screen.getByText('10 / 10')).toBeInTheDocument())

    await act(async () => {
      resolveOldProgress({
        sourceFolders: [],
        scanProgress: {
          basic: { completed: 77, total: 77, status: 'complete', runId: 'old-run' },
          tags: { completed: 77, total: 77, pending: 0, cacheHits: 0, succeeded: 77, failed: 0, status: 'complete' }
        }
      })
      await Promise.resolve()
    })

    expect(screen.queryByText('77 / 77')).not.toBeInTheDocument()
    expect(screen.getByText('10 / 10')).toBeInTheDocument()
    if (resolveFollowupProgress) {
      await act(async () => {
        resolveFollowupProgress!({ sourceFolders: [], scanProgress: finalPreview.scanProgress! })
        await Promise.resolve()
      })
    }
  })

  it.each([
    ['pause', 'running', '暂停补取'],
    ['resume', 'paused', '继续补取'],
    ['cancel', 'running', '结束补取，使用当前结果']
  ] as const)(
    'invalidates a completed account preview when manual %s returns another account',
    async (action, tagStatus, buttonName) => {
      const preview = createArchivePreviewFixture()
      preview.scanProgress = {
        basic: { completed: 2, total: 2, status: 'complete', runId: 'final-42' },
        tags: { completed: 1, total: 2, pending: 1, cacheHits: 0, succeeded: 1, failed: 0, status: tagStatus }
      }
      preview.scanContext = {
        accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
        managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
      }
      const onReadOldFavoriteTagEnrichment = vi.fn((requestedAction = 'read') => Promise.resolve(
        requestedAction === action
          ? {
              accountMid: '99', sourceFolders: [],
              scanProgress: {
                basic: { completed: 99, total: 99, status: 'complete' as const, runId: 'other-99' },
                tags: { completed: 99, total: 99, pending: 0, cacheHits: 0, succeeded: 99, failed: 0, status: 'complete' as const }
              }
            }
          : { accountMid: '42', sourceFolders: [], scanProgress: preview.scanProgress! }
      ))
      renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
      fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
      await screen.findByText('已扫描 2 条旧藏，可勾选后整理。')

      fireEvent.click(screen.getByRole('button', { name: buttonName }))
      if (action === 'cancel') {
        fireEvent.click(within(screen.getByRole('alertdialog', { name: '确认结束标签补取？' }))
          .getByRole('button', { name: '确认结束' }))
      }

      expect(await screen.findByText('检测到账号已切换，请重新扫描当前账号。')).toBeInTheDocument()
      expect(getOldFavoriteRuntimeValue('preview', null)).toBeNull()
      expect(getOldFavoriteRuntimeValue('baseScanPreview', null)).toBeNull()
      expect(getOldFavoriteRuntimeValue('archivePlanState', null)).toBeNull()
      expect(screen.queryByText('99 / 99')).not.toBeInTheDocument()
    }
  )

  it('does not let an unmounted polling owner mutate a newly mounted runtime session', async () => {
    const oldPreview = createArchivePreviewFixture()
    oldPreview.scanProgress = {
      basic: { completed: 1, total: 1, status: 'complete', runId: 'old-session' },
      tags: { completed: 0, total: 1, pending: 1, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' }
    }
    setOldFavoriteRuntimeValue('preview', oldPreview)
    let resolveOldPoll!: (snapshot: any) => void
    const oldRead = vi.fn(() => new Promise((resolve) => { resolveOldPoll = resolve }))
    const first = renderPanel({ onReadOldFavoriteTagEnrichment: oldRead })
    await waitFor(() => expect(resolveOldPoll).toBeTypeOf('function'))
    first.unmount()

    resetOldFavoriteRuntimeSession()
    const newPreview = createArchivePreviewFixture()
    newPreview.items = newPreview.items.map((item) => ({ ...item, title: `新会话-${item.aid}` }))
    newPreview.scanProgress = {
      basic: { completed: 5, total: 5, status: 'complete', runId: 'new-session' },
      tags: { completed: 5, total: 5, pending: 0, cacheHits: 0, succeeded: 5, failed: 0, status: 'complete' }
    }
    setOldFavoriteRuntimeValue('preview', newPreview)
    renderPanel()

    await act(async () => {
      resolveOldPoll({
        sourceFolders: [],
        scanProgress: {
          basic: { completed: 99, total: 99, status: 'complete', runId: 'old-session' },
          tags: { completed: 99, total: 99, pending: 0, cacheHits: 0, succeeded: 99, failed: 0, status: 'complete' }
        }
      })
      await Promise.resolve()
    })

    expect(getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.scanProgress?.basic.runId).toBe('new-session')
    expect(screen.queryByText('99 / 99')).not.toBeInTheDocument()
  })

  it('keeps the current polling owner active after the StrictMode effect replay', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 1, total: 1, status: 'complete', runId: 'strict-run' },
      tags: { completed: 0, total: 2, pending: 2, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' }
    }
    setOldFavoriteRuntimeValue('preview', preview)
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 1, total: 1, status: 'complete', runId: 'strict-run' },
        tags: { completed: 1, total: 2, pending: 1, cacheHits: 0, succeeded: 1, failed: 0, status: 'running' }
      }
    })

    render(
      <StrictMode>
        <FavoriteLedgerPanel
          ledgers={createDefaultFavoriteLedgers()}
          missingLedgerIds={[]}
          onEnsureLedgers={vi.fn()}
          onSaveLedgers={vi.fn()}
          onScanOldFavorites={vi.fn()}
          onReadOldFavoriteTagEnrichment={onReadOldFavoriteTagEnrichment}
          onExecuteOldFavoritePlan={vi.fn()}
        />
      </StrictMode>
    )

    expect(await screen.findByText('1 / 2')).toBeInTheDocument()
  })

  it('reports a recoverable status when a manual tag action rejects', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete', runId: 'active-run' },
      tags: { completed: 1, total: 2, pending: 1, cacheHits: 0, succeeded: 1, failed: 0, status: 'running' }
    }
    const onReadOldFavoriteTagEnrichment = vi.fn((action = 'read') => action === 'pause'
      ? Promise.reject(new Error('temporary failure'))
      : Promise.resolve({ sourceFolders: [], scanProgress: preview.scanProgress! }))
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '暂停补取' }))

    expect(await screen.findByText('标签补取操作未完成，请稍后重试。')).toBeInTheDocument()
  })

  it('requires confirmation before ending tag enrichment with the current result', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete', runId: 'active-run' },
      tags: { completed: 1, total: 2, pending: 1, cacheHits: 0, succeeded: 1, failed: 0, status: 'running' }
    }
    const onReadOldFavoriteTagEnrichment = vi.fn((action = 'read') => Promise.resolve({
      sourceFolders: [],
      scanProgress: action === 'cancel'
        ? { ...preview.scanProgress!, tags: { ...preview.scanProgress!.tags, pending: 0, status: 'complete' as const } }
        : preview.scanProgress!
    }))
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.queryByRole('button', { name: '取消标签补取' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '结束补取，使用当前结果' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认结束标签补取？' })
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog', { name: '确认结束标签补取？' })).not.toBeInTheDocument()
    expect(onReadOldFavoriteTagEnrichment).not.toHaveBeenCalledWith('cancel')

    fireEvent.click(screen.getByRole('button', { name: '结束补取，使用当前结果' }))
    fireEvent.click(within(screen.getByRole('alertdialog', { name: '确认结束标签补取？' }))
      .getByRole('button', { name: '确认结束' }))
    await waitFor(() => expect(onReadOldFavoriteTagEnrichment).toHaveBeenCalledWith('cancel'))
  })

  it('does not merge a full read snapshot from a different run after locking the active run', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 1, total: 1, status: 'complete', runId: 'old-run' },
      tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' }
    }
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 1, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off',
      sourceFolders: [{ id: 'failed', title: '旧收藏夹', scanFailed: true, scanStatus: 'failed', videos: [] }]
    }
    let rescanStarted = false
    let readOtherRun = false
    const activeSnapshot = {
      accountMid: '42', sourceFolders: [],
      scanProgress: {
        basic: { completed: 10, total: 100, status: 'running' as const, runId: 'new-run', phase: 'listing' as const },
        tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'complete' as const }
      }
    }
    const onReadOldFavoriteTagEnrichment = vi.fn((action = 'read') => {
      if (!rescanStarted) return Promise.resolve({ ...activeSnapshot, scanProgress: preview.scanProgress })
      if (action === 'progress') return Promise.resolve(activeSnapshot)
      readOtherRun = true
      return Promise.resolve({
        ...activeSnapshot,
        scanProgress: {
          basic: { completed: 77, total: 77, status: 'complete' as const, runId: 'other-run' },
          tags: { completed: 77, total: 77, pending: 0, cacheHits: 0, succeeded: 77, failed: 0, status: 'complete' as const }
        }
      })
    })
    const onScanOldFavorites = vi.fn().mockResolvedValueOnce(preview).mockReturnValueOnce(pendingScan())
    renderPanel({ onScanOldFavorites, onReadOldFavoriteTagEnrichment })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    vi.useFakeTimers()
    rescanStarted = true
    fireEvent.click(screen.getByRole('button', { name: '重新扫描全部' }))

    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(readOtherRun).toBe(false)
    expect(screen.queryByText('77 / 77')).not.toBeInTheDocument()
    expect(screen.getByText('10 / 100')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it.each([
    [{ phase: 'requesting', attempt: 2 }, '正在读取“知识学习”第 4 页（第 2/3 次请求）'],
    [{ phase: 'retrying', attempt: 2 }, '“知识学习”第 4 页请求失败，准备第 3/3 次请求']
  ] as const)('shows the current folder page and request stage for %s', async (location, message) => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: {
        completed: 20, total: 100, status: 'running', runId: 'visible-run',
        folderId: '101', folderTitle: '知识学习', page: 4, ...location
      },
      tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'idle' }
    } as FavoriteLedgerPreview['scanProgress']
    setOldFavoriteRuntimeValue('preview', preview)

    renderPanel()

    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('keeps counts monotonic within one run while applying its latest retry stage', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: {
        completed: 40, total: 100, status: 'running', runId: 'same-run', phase: 'requesting',
        folderId: '101', folderTitle: '知识学习', page: 2, attempt: 1
      },
      tags: { completed: 20, total: 100, pending: 80, cacheHits: 0, succeeded: 20, failed: 0, status: 'running' }
    } as FavoriteLedgerPreview['scanProgress']
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: [],
      scanProgress: {
        basic: {
          completed: 20, total: 80, status: 'running', runId: 'same-run', phase: 'retrying',
          folderId: '101', folderTitle: '知识学习', page: 3, attempt: 1
        },
        tags: { completed: 10, total: 80, pending: 70, cacheHits: 0, succeeded: 10, failed: 0, status: 'running' }
      }
    })
    setOldFavoriteRuntimeValue('preview', preview)

    renderPanel({ onReadOldFavoriteTagEnrichment })

    expect(await screen.findByText('40 / 100')).toBeInTheDocument()
    expect(await screen.findByText('“知识学习”第 3 页请求失败，准备第 2/3 次请求')).toBeInTheDocument()
    expect(screen.getByText('20 / 100')).toBeInTheDocument()
  })

  it.each(['complete', 'failed', 'cancelled'] as const)('does not retain running request details after the scan is %s', async (status) => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: {
        completed: 20, total: 100, status, runId: 'terminal-run', phase: 'requesting',
        folderId: '101', folderTitle: '知识学习', page: 4, attempt: 2
      },
      tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'idle' }
    } as FavoriteLedgerPreview['scanProgress']
    setOldFavoriteRuntimeValue('preview', preview)

    renderPanel()

    await screen.findByRole('region', { name: '整理旧藏向导' })
    expect(screen.queryByText('正在读取“知识学习”第 4 页（第 2/3 次请求）')).not.toBeInTheDocument()
  })

  it('shows scan guidance and cancels an active scan', async () => {
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 0, total: 0, status: 'cancelled' },
        tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'complete' }
      }
    })
    const onScanOldFavorites = vi.fn(() => new Promise((resolve) => { resolveScan = resolve }))
    renderPanel({ onScanOldFavorites, onReadOldFavoriteTagEnrichment })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalled())

    expect(screen.getByText('请耐心等待扫描完成；完成后按上方步骤从左到右，依次完成本轮整理。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消旧藏扫描' }))

    await waitFor(() => expect(onReadOldFavoriteTagEnrichment).toHaveBeenCalledWith('cancel-scan'))
    expect(screen.getByRole('status')).toHaveTextContent('已取消扫描。')
  })

  it('does not let an older cancelled scan clear the busy state of an immediate rescan', async () => {
    const pendingScans: Array<(preview: FavoriteLedgerPreview) => void> = []
    const onScanOldFavorites = vi.fn(() => new Promise<FavoriteLedgerPreview>((resolve) => {
      pendingScans.push(resolve)
    }))
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 0, total: 0, status: 'cancelled' },
        tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'complete' }
      }
    })
    renderPanel({ onScanOldFavorites, onReadOldFavoriteTagEnrichment })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '取消旧藏扫描' }))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledTimes(2))

    await act(async () => {
      pendingScans[0](createArchivePreviewFixture())
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: '取消旧藏扫描' })).toBeInTheDocument()
  })

  it('does not start scanning after cancellation during the pre-scan sync', async () => {
    let resolveSave!: (result: { ok: true; steps: string[]; missingTargets: string[]; message: string }) => void
    const onSaveLedgers = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    const onScanOldFavorites = vi.fn()
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 0, total: 0, status: 'cancelled' },
        tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'complete' }
      }
    })
    renderPanel({ onSaveLedgers, onScanOldFavorites, onReadOldFavoriteTagEnrichment })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消旧藏扫描' }))
    await act(async () => {
      resolveSave({ ok: true, steps: [], missingTargets: [], message: 'saved' })
      await Promise.resolve()
    })

    expect(onScanOldFavorites).not.toHaveBeenCalled()
  })

  it('hides fractional basic scan counts that are not real video totals', async () => {
    vi.useFakeTimers()
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 0.6000000000000001, total: 9, status: 'running' },
        tags: { completed: 0, total: 242, pending: 242, cacheHits: 0, succeeded: 0, failed: 0, status: 'running' }
      }
    })
    renderPanel({
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => new Promise((resolve) => { resolveScan = resolve })),
      onReadOldFavoriteTagEnrichment
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await act(async () => { vi.advanceTimersByTime(1600); await Promise.resolve() })

    expect(screen.getByText('正在读取')).toBeInTheDocument()
    expect(screen.queryByText('0.6000000000000001 / 9')).not.toBeInTheDocument()

    await act(async () => {
      resolveScan({ items: [], skippedSourceFolderTitles: [] })
      await Promise.resolve()
    })
    vi.useRealTimers()
  })

  it('shows a stable waiting label when persisted tag progress is incomplete', async () => {
    vi.useFakeTimers()
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 0, total: 0, status: 'running' },
        tags: { pending: 0, status: 'paused' }
      }
    })
    renderPanel({
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => new Promise((resolve) => { resolveScan = resolve })),
      onReadOldFavoriteTagEnrichment
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await act(async () => { vi.advanceTimersByTime(1600); await Promise.resolve() })

    expect(screen.getByText('正在统计缺失标签')).toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
    await act(async () => {
      resolveScan({ items: [], skippedSourceFolderTitles: [] })
      await Promise.resolve()
    })
    vi.useRealTimers()
  })

  it('does not let an older polling snapshot replace completed tag progress', async () => {
    vi.useFakeTimers()
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 1, total: 1, status: 'complete' },
      tags: { completed: 1, total: 1, pending: 0, cacheHits: 0, succeeded: 1, failed: 0, status: 'complete' }
    }
    let resolvePoll!: (value: unknown) => void
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    const onReadOldFavoriteTagEnrichment = vi.fn(() => new Promise((resolve) => { resolvePoll = resolve }))
    renderPanel({ onScanOldFavorites: vi.fn(() => new Promise((resolve) => { resolveScan = resolve })), onReadOldFavoriteTagEnrichment })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await act(async () => { vi.advanceTimersByTime(1600); await Promise.resolve() })
    await act(async () => { resolveScan(preview); await Promise.resolve() })
    await act(async () => {
      resolvePoll({
        sourceFolders: [],
        scanProgress: {
          basic: { completed: 1, total: 1, status: 'complete' },
          tags: { pending: 1, status: 'running' }
        }
      })
      await Promise.resolve()
    })

    expect(screen.getAllByText('1 / 1')).toHaveLength(2)
    expect(screen.queryByText('正在统计缺失标签')).not.toBeInTheDocument()
    expect(screen.queryByText(/标签仍在后台补取/)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('clears a completed preview when polling detects a different signed-in account', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete' },
      tags: { completed: 2, total: 2, pending: 0, cacheHits: 0, succeeded: 2, failed: 0, status: 'complete' }
    }
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      accountMid: '99',
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 0, total: 0, status: 'complete' },
        tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'complete' }
      }
    })
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(onReadOldFavoriteTagEnrichment).toHaveBeenCalled())

    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
    expect(screen.getByText('检测到账号已切换，请重新扫描当前账号。')).toBeInTheDocument()
  })

  it.each(['other-run', undefined])(
    'clears a locked preview before run filtering when polling detects another account with run %s',
    async (incomingRunId) => {
      const preview = createArchivePreviewFixture()
      preview.scanContext = {
        accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
        managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
      }
      preview.scanProgress = {
        basic: { completed: 2, total: 2, status: 'complete', runId: 'final-42' },
        tags: { completed: 2, total: 2, pending: 0, cacheHits: 0, succeeded: 2, failed: 0, status: 'complete' }
      }
      let resolveForeignPoll!: (snapshot: any) => void
      let scanResultRead = false
      const onReadOldFavoriteTagEnrichment = vi.fn((action = 'read') => {
        if (action === 'read' && !scanResultRead) {
          scanResultRead = true
          return Promise.resolve({ accountMid: '42', sourceFolders: [], scanProgress: preview.scanProgress! })
        }
        return new Promise((resolve) => { resolveForeignPoll = resolve })
      })
      renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview), onReadOldFavoriteTagEnrichment })
      fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
      await screen.findByText('已扫描 2 条旧藏，可勾选后整理。')
      await waitFor(() => expect(resolveForeignPoll).toBeTypeOf('function'))

      await act(async () => {
        resolveForeignPoll({
          accountMid: '99', sourceFolders: [],
          scanProgress: {
            basic: { completed: 99, total: 99, status: 'complete', runId: incomingRunId },
            tags: { completed: 99, total: 99, pending: 0, cacheHits: 0, succeeded: 99, failed: 0, status: 'complete' }
          }
        })
        await Promise.resolve()
      })

      expect(await screen.findByText('检测到账号已切换，请重新扫描当前账号。')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
      expect(getOldFavoriteRuntimeValue('preview', null)).toBeNull()
      expect(getOldFavoriteRuntimeValue('baseScanPreview', null)).toBeNull()
      expect(getOldFavoriteRuntimeValue('archivePlanState', null)).toBeNull()
      expect(screen.queryByText('99 / 99')).not.toBeInTheDocument()
    }
  )

  it('atomically ends an active scan on account mismatch and ignores its late result before a new scan', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off',
      sourceFolders: [{ id: 'failed', title: '旧收藏夹', scanFailed: true, scanStatus: 'failed', videos: [] }]
    }
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete', runId: 'final-42' },
      tags: { completed: 2, total: 2, pending: 0, cacheHits: 0, succeeded: 2, failed: 0, status: 'complete' }
    }
    let scanActive = false
    const scanResolvers: Array<(value: FavoriteLedgerPreview) => void> = []
    const onScanOldFavorites = vi.fn()
      .mockResolvedValueOnce(preview)
      .mockImplementation(() => new Promise<FavoriteLedgerPreview>((resolve) => scanResolvers.push(resolve)))
    const onReadOldFavoriteTagEnrichment = vi.fn(() => Promise.resolve(
      scanActive
        ? {
            accountMid: '99', sourceFolders: [],
            scanProgress: {
              basic: { completed: 99, total: 99, status: 'complete' as const, runId: 'foreign-99' },
              tags: { completed: 99, total: 99, pending: 0, cacheHits: 0, succeeded: 99, failed: 0, status: 'complete' as const }
            }
          }
        : { accountMid: '42', sourceFolders: [], scanProgress: preview.scanProgress! }
    ))
    renderPanel({
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites,
      onReadOldFavoriteTagEnrichment
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('button', { name: '重新扫描全部' })
    scanActive = true
    fireEvent.click(screen.getByRole('button', { name: '重新扫描全部' }))
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('检测到账号已切换，请重新扫描当前账号。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '整理旧藏' })).toBeEnabled()

    await act(async () => {
      scanResolvers[0]({ ...preview, items: [{ ...preview.items[0], title: '不应复活的旧扫描' }] })
      await Promise.resolve()
    })
    expect(screen.queryByText('不应复活的旧扫描')).not.toBeInTheDocument()
    expect(getOldFavoriteRuntimeValue('preview', null)).toBeNull()

    scanActive = false
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledTimes(3))
    await act(async () => {
      scanResolvers[1]({ items: [], skippedSourceFolderTitles: [] })
      await Promise.resolve()
    })
  })

  it('does not start scanning when account mismatch invalidates a pending pre-scan save', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    preview.scanProgress = {
      basic: { completed: 2, total: 2, status: 'complete', runId: 'final-42' },
      tags: { completed: 2, total: 2, pending: 0, cacheHits: 0, succeeded: 2, failed: 0, status: 'complete' }
    }
    setOldFavoriteRuntimeValue('preview', preview)
    setOldFavoriteRuntimeValue('oldFavoriteGuideMode', 'setup')
    let resolveSave!: (result: any) => void
    const onSaveLedgers = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    const onScanOldFavorites = vi.fn()
    const snapshotResolvers: Array<(snapshot: any) => void> = []
    const onReadOldFavoriteTagEnrichment = vi.fn(() => new Promise((resolve) => snapshotResolvers.push(resolve)))
    renderPanel({ onSaveLedgers, onScanOldFavorites, onReadOldFavoriteTagEnrichment })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await waitFor(() => expect(resolveSave).toBeTypeOf('function'))
    await waitFor(() => expect(snapshotResolvers).toHaveLength(1))
    await act(async () => {
      snapshotResolvers[0]({
        accountMid: '99', sourceFolders: [],
        scanProgress: {
          basic: { completed: 99, total: 99, status: 'complete', runId: 'foreign-99' },
          tags: { completed: 99, total: 99, pending: 0, cacheHits: 0, succeeded: 99, failed: 0, status: 'complete' }
        }
      })
      await Promise.resolve()
    })
    expect(await screen.findByText('检测到账号已切换，请重新扫描当前账号。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '整理旧藏' })).toBeEnabled()

    await act(async () => {
      resolveSave({ ok: true, steps: [], missingTargets: [], message: 'saved' })
      await Promise.resolve()
    })

    expect(onScanOldFavorites).not.toHaveBeenCalled()
    expect(screen.getByText('检测到账号已切换，请重新扫描当前账号。')).toBeInTheDocument()
    expect(getOldFavoriteRuntimeValue('preview', null)).toBeNull()
  })

  it('ignores a scan result when the signed-in account changes before it completes', async () => {
    let resolveScan!: (preview: FavoriteLedgerPreview) => void
    const onReadOldFavoriteTagEnrichment = vi.fn().mockResolvedValue({
      accountMid: '99',
      sourceFolders: [],
      scanProgress: {
        basic: { completed: 0, total: 0, status: 'complete' },
        tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'complete' }
      }
    })
    renderPanel({
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn(() => new Promise((resolve) => { resolveScan = resolve })),
      onReadOldFavoriteTagEnrichment
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(resolveScan).toBeTypeOf('function')
    await act(async () => {
      resolveScan({
        items: [],
        skippedSourceFolderTitles: [],
        scanContext: {
          accountMid: '42', totalUniqueVideos: 0, activeSourceFolders: [], protectedVideos: [],
          managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
        }
      })
      await Promise.resolve()
    })

    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
    expect(screen.getByText('检测到账号已切换，请重新扫描当前账号。')).toBeInTheDocument()
  })

  it('uses a compact archive selector without visible helper labels', async () => {
    const { container } = await openArchivePreview()

    expect(screen.getByText('查看本轮归档分类结果，并在确认前调整。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^存入 / })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再次整理 暂时不知道放哪' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^恢复原建议 / })).not.toBeInTheDocument()
    expect(
      within(getPreviewArticle(container, /AI 效率工具实战/)).getByLabelText('转移 AI 效率工具实战')
    ).toBeInTheDocument()
    expect(
      within(getPreviewArticle(container, /暂时不知道放哪/)).getByLabelText('转移 暂时不知道放哪')
    ).toBeInTheDocument()
    expect(
      within(getPreviewArticle(container, /AI 效率工具实战/)).getByLabelText('转移 AI 效率工具实战')
    ).toHaveAttribute('title', '当前位置：bilimi·知识学习，可手动切换')
    expect(
      within(getPreviewArticle(container, /暂时不知道放哪/)).getByLabelText('转移 暂时不知道放哪')
    ).toHaveAttribute('title', '当前位置：未分类，可手动切换到 bilimi 收藏夹')
    expect(screen.queryByText('当前位置')).not.toBeInTheDocument()
    expect(screen.queryByText('当前建议分类')).not.toBeInTheDocument()
  })

  it('renders old favorite step notes as compact text directly under their headings', async () => {
    await openArchivePreview()

    const previewHeading = screen.getByRole('heading', { name: '归档预览' })
    const previewNote = screen.getByText('查看本轮归档分类结果，并在确认前调整。')
    expect(previewHeading).toHaveClass('favorite-ledger-panel__step-title')
    expect(previewNote).toHaveClass('favorite-ledger-panel__step-note')
    expect(previewHeading.compareDocumentPosition(previewNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const generatedHeading = screen.getByRole('heading', { name: '推荐收藏夹' })
    const generatedNote = screen.getByText('确认执行后，会把已勾选候选同步到 B 站收藏夹里。')
    expect(generatedHeading).toHaveClass('favorite-ledger-panel__step-title')
    expect(generatedNote).toHaveClass('favorite-ledger-panel__step-note')
    expect(generatedHeading.compareDocumentPosition(generatedNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('requires a second confirmation before executing old favorite organization', async () => {
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:701'],
      missingTargets: [],
      message: '旧藏整理已完成。'
    })
    await openArchivePreview({ onExecuteOldFavoritePlan })

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
    expect(screen.getByText('开始整理后，本轮将按当前预览追加到 bilimi 收藏夹，执行中不能再更改。原收藏不会被删除、移动或取消。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认开始整理？' })
    expect(dialog).toHaveTextContent('小咪提醒：主人要开始整理吗？开始后就不能再调整了哦！')
    expect(dialog).toHaveTextContent('本次将整理 1 条视频，每条视频最多存入 1 个 bilimi 收藏夹。')
    expect(dialog).not.toHaveTextContent('收藏夹数量设置已从')
    expect(screen.queryByRole('heading', { name: '确认执行' })).not.toBeInTheDocument()
    expect(screen.queryByText('已选择 1 条归档任务')).not.toBeInTheDocument()
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: '返回检查' }))
    expect(screen.queryByRole('alertdialog', { name: '确认开始整理？' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '确认执行' })).toBeInTheDocument()
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
  })

  it('keeps the current-location switch outside the selectable preview card body', async () => {
    const { container } = await openArchivePreview()

    const article = getPreviewArticle(container, /AI 效率工具实战/)
    const cardBody = article.querySelector('.favorite-ledger-panel__preview-video')
    const controls = article.querySelector('.favorite-ledger-panel__preview-controls')

    expect(cardBody).toBeInTheDocument()
    expect(controls).toBeInTheDocument()
    expect(cardBody).not.toContainElement(controls as HTMLElement)
  })

  it('shows unrecognized tag text when an old favorite has no tags', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[0] = {
      ...preview.items[0],
      tags: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)

    const { container } = await openArchivePreview({ onScanOldFavorites })

    expect(within(getPreviewArticle(container, /AI 效率工具实战/)).getByText('标签：未识别到')).toBeInTheDocument()
  })

  it('keeps DeepSeek controls and archive change history in one combined tool card', async () => {
    await openArchivePreview()

    const toolCard = screen.getByRole('group', { name: '归档预览辅助工具' })
    expect(toolCard.querySelector('.favorite-ledger-panel__archive-tool-divider')).toBeInTheDocument()
    expect(toolCard.querySelector('.favorite-ledger-panel__deepseek-archive-card')).not.toBeInTheDocument()
    expect(toolCard.querySelector('.favorite-ledger-panel__archive-history-card')).not.toBeInTheDocument()

    const historyTools = within(toolCard).getByRole('group', { name: '归档预览改动操作' })
    const historySelect = within(historyTools).getByRole('combobox', { name: '改动记录' })
    const undoButton = within(historyTools).getByRole('button', { name: '撤销本次改动' })
    const redoButton = within(historyTools).getByRole('button', { name: '恢复本次改动' })

    expect(historySelect.parentElement).toHaveClass(
      'favorite-ledger-panel__archive-history-select-control'
    )
    expect(historySelect.compareDocumentPosition(undoButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(undoButton.compareDocumentPosition(redoButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses a compact scope dropdown button before the DeepSeek organize button', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [],
      keywordSuggestions: []
    } satisfies DeepSeekGenerateResult)
    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    expect(screen.queryByRole('combobox', { name: 'DeepSeek 辅助整理范围' })).not.toBeInTheDocument()

    const toolCard = screen.getByRole('group', { name: '归档预览辅助工具' })
    const scopeButton = within(toolCard).getByRole('button', { name: '整理范围' })
    const deepSeekButton = within(toolCard).getByRole('button', { name: 'DeepSeek 整理' })
    const scopeArrow = scopeButton.querySelector('.favorite-ledger-panel__deepseek-archive-scope-arrow')
    expect(scopeButton).toHaveAttribute('title', '当前选择：当前分段')
    expect(scopeArrow).toBeInTheDocument()
    expect(scopeArrow).toHaveAttribute('aria-hidden', 'true')
    expect(scopeButton.compareDocumentPosition(deepSeekButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(scopeButton)
    fireEvent.click(screen.getByRole('menuitemradio', { name: '全批未匹配 + 待复核' }))
    expect(scopeButton).toHaveAttribute('title', '当前选择：全批未匹配 + 待复核')

    fireEvent.click(deepSeekButton)
    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledWith(
      'low-confidence-and-unclassified', expect.anything()
    ))
  })

  it('uses compact stacked-arrow help toggles without text glyphs', async () => {
    await openArchivePreview()

    const ledgerHelpButton = screen.getByRole('button', { name: '展开收藏夹说明' })
    const oldFavoriteHelpButton = screen.getByRole('button', { name: '展开整理旧藏说明' })

    for (const helpButton of [ledgerHelpButton, oldFavoriteHelpButton]) {
      expect(helpButton).not.toHaveTextContent(/[\^v]/)
      expect(helpButton.querySelectorAll('.favorite-ledger-panel__help-arrow')).toHaveLength(2)
    }

    expect(ledgerHelpButton.getAttribute('title')?.split('\n')).toHaveLength(3)
    expect(oldFavoriteHelpButton.getAttribute('title')?.split('\n')).toHaveLength(5)
  })

  it('keeps the first-use backup note out of the ledger panel body', () => {
    renderPanel()

    expect(screen.queryByText(safetyNote)).not.toBeInTheDocument()
  })

  it('shows the current and initial states in archive change history', async () => {
    const { container } = await openArchivePreview()
    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'game' }
    })

    const historySelect = screen.getByRole('combobox', { name: '改动记录' })
    expect(screen.getByText(/当前状态：最近一次改动：AI 效率工具实战/)).toBeInTheDocument()
    expect(within(historySelect).queryByRole('option', { name: /当前状态/ })).not.toBeInTheDocument()
    expect(within(historySelect).getByRole('option', { name: '归档预览初始状态' })).toBeInTheDocument()
    expect(getPreviewArticle(container, /AI 效率工具实战/)).toHaveAttribute('data-latest-change', 'true')
  })

  it('focuses the destination archive group and resets affected horizontal preview tracks after a manual move', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      const preview = createArchivePreviewFixture()
      preview.items.push(
        {
          aid: 703,
          title: '知识区保底视频',
          author: '知识UP',
          description: '保留源分组。',
          tags: ['知识'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        },
        {
          aid: 704,
          title: '游戏区保底视频',
          author: '游戏UP',
          description: '保留目标分组。',
          tags: ['游戏'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏专区',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['game'],
          currentTargetLedgerIds: ['game'],
          selectedTargetLedgerIds: ['game'],
          lowConfidence: false
        }
      )
      const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
      const { container } = renderPanel({ onScanOldFavorites })

      fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
      await screen.findByRole('region', { name: '整理旧藏向导' })
      fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

      const knowledgeGroup = getPreviewArticle(container, /AI 效率工具实战/).closest('section')
      const gameGroup = getPreviewArticle(container, /游戏区保底视频/).closest('section')
      expect(knowledgeGroup).not.toBeNull()
      expect(gameGroup).not.toBeNull()
      const knowledgeSection = knowledgeGroup!
      const gameSection = gameGroup!
      const knowledgeTrack = knowledgeSection.querySelector<HTMLElement>(
        '.favorite-ledger-panel__preview-videos'
      )
      const gameTrack = gameSection.querySelector<HTMLElement>('.favorite-ledger-panel__preview-videos')
      expect(knowledgeTrack).toBeDefined()
      expect(gameTrack).toBeDefined()
      knowledgeTrack!.scrollLeft = 128
      gameTrack!.scrollLeft = 96

      fireEvent.change(within(knowledgeSection).getByLabelText('转移 AI 效率工具实战'), {
        target: { value: 'game' }
      })

      await waitFor(() =>
        expect(getPreviewArticle(container, /AI 效率工具实战/).closest('section')).toHaveTextContent(
          '游戏区保底视频'
        )
      )
      const updatedKnowledgeGroup = getPreviewArticle(container, /知识区保底视频/).closest('section')
      const updatedGameGroup = getPreviewArticle(container, /AI 效率工具实战/).closest('section')
      expect(updatedKnowledgeGroup).not.toBeNull()
      expect(updatedGameGroup).not.toBeNull()
      const updatedKnowledgeSection = updatedKnowledgeGroup!
      const updatedGameSection = updatedGameGroup!
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
      expect(updatedKnowledgeSection.querySelector('.favorite-ledger-panel__preview-videos')).toHaveProperty(
        'scrollLeft',
        0
      )
      expect(updatedGameSection.querySelector('.favorite-ledger-panel__preview-videos')).toHaveProperty(
        'scrollLeft',
        0
      )
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('shows original archive source notices for every manually moved card', async () => {
    const { container } = await openArchivePreview()

    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    fireEvent.change(screen.getByLabelText('转移 暂时不知道放哪'), {
      target: { value: 'inbox' }
    })

    const knowledgeArticle = getPreviewArticle(container, /AI 效率工具实战/)
    const unclassifiedArticle = getPreviewArticle(container, /暂时不知道放哪/)
    expect(container.querySelectorAll('.favorite-ledger-panel__preview-delta-row')).toHaveLength(2)
    expect(within(knowledgeArticle).getByText('来自 bilimi·知识学习')).toHaveClass(
      'favorite-ledger-panel__preview-delta'
    )
    expect(within(unclassifiedArticle).getByText('来自 未分类')).toHaveClass(
      'favorite-ledger-panel__preview-delta'
    )
    expect(within(unclassifiedArticle).getByText('来自 未分类')).toHaveAttribute(
      'title',
      '整理前位置：【未分类】；当前位置：【bilimi·暂存】。'
    )
    expect(within(unclassifiedArticle).queryByRole('button', { name: '撤销' })).not.toBeInTheDocument()
    expect(getPreviewArticle(container, /AI 效率工具实战/)).not.toHaveAttribute(
      'data-latest-change',
      'true'
    )
  })

  it('keeps the round-start source after the same card moves repeatedly and clears it at origin', async () => {
    const { container } = await openArchivePreview()

    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'movie-tv' }
    })

    const movedArticle = getPreviewArticle(container, /AI 效率工具实战/)
    expect(within(movedArticle).getByText('来自 bilimi·知识学习')).toHaveAttribute(
      'title',
      '整理前位置：【bilimi·知识学习】；当前位置：【bilimi·影视动漫】。'
    )

    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'knowledge' }
    })

    expect(
      within(getPreviewArticle(container, /AI 效率工具实战/)).queryByText(
        '来自 bilimi·知识学习'
      )
    ).not.toBeInTheDocument()
  })

  it('reports old favorite scan results to the global feedback owner while keeping the local message', async () => {
    const onOldFavoriteStatusUpdate = vi.fn()

    await openArchivePreview({ onOldFavoriteStatusUpdate })

    expect(onOldFavoriteStatusUpdate).toHaveBeenCalledWith({
      label: '旧藏待整理 2',
      message: '已扫描 2 条旧藏，可勾选后整理。',
      tone: 'warn'
    })
    expect(screen.getByText('已扫描 2 条旧藏，可勾选后整理。')).toBeInTheDocument()
  })

  it('shows protected counts and temporarily reintroduces only selected-source favorites', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 241, total: 241, status: 'complete' },
      tags: { completed: 241, total: 241, pending: 0, cacheHits: 0, succeeded: 241, failed: 0, status: 'complete' }
    }
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 4,
      activeSourceFolders: [
        {
          id: 'source-1',
          title: '默认收藏夹',
          videos: preview.items.map((item) => ({
            aid: item.aid,
            title: item.title,
            description: item.description,
            tags: item.tags,
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹'],
            currentBilimiFolderIds: []
          }))
        }
      ],
      protectedVideos: [
        {
          aid: 801,
          title: '默认来源已整理',
          tags: ['游戏'],
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: ['9002'],
          protectedForIncrementalScan: true
        },
        {
          aid: 802,
          title: '旅行来源已整理',
          tags: ['旅行'],
          sourceFolderIds: ['source-2'],
          sourceFolderTitles: ['旅行收藏'],
          currentBilimiFolderIds: ['9005'],
          protectedForIncrementalScan: true
        }
      ],
      managedFolders: [
        { id: '9002', title: 'bilimi·游戏专区', ledgerId: 'game', isInbox: false },
        { id: '9005', title: 'bilimi·生活日常', ledgerId: 'life-interest', isInbox: false }
      ],
      targetMembership: { '9002': [801], '9005': [802] },
      multiArchiveMode: 'off'
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByText('已识别 4 个 · 2 个唯一视频受保护')).toBeInTheDocument()
    expect(screen.getByText('正式工作夹保护')).toBeInTheDocument()
    expect(screen.getByText('可执行')).toBeInTheDocument()
    expect(screen.getByText('待复核')).toBeInTheDocument()
    expect(screen.getByText('未匹配')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/^整理来源 旅行收藏，共 /))
    const basicDataHeading = screen.getByRole('heading', { name: '基础数据' })
    const allReorganizeButton = screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' })
    const metrics = screen.getByText('共扫描').closest('.favorite-ledger-panel__guide-metrics')
    expect(screen.getByText(/当前勾选来源中的全部已整理视频/)).toBeInTheDocument()
    expect(screen.queryByLabelText('原归档状态')).not.toBeInTheDocument()
    expect(basicDataHeading.compareDocumentPosition(allReorganizeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(allReorganizeButton.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('默认来源已整理')).not.toBeInTheDocument()

    fireEvent.click(allReorganizeButton)
    const dialog = screen.getByRole('alertdialog', { name: '确认重新整理已整理收藏？' })
    expect(dialog).toHaveTextContent('当前勾选来源中全部已整理的 1 条')
    expect(dialog).toHaveTextContent('按当前规则重新计算，不受以前分类限制')
    expect(dialog).toHaveTextContent('用户原有普通收藏不会改变')
    expect(allReorganizeButton.closest('.favorite-ledger-panel__protected-summary')).not.toContainElement(dialog)
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: '继续重新整理' }))

    expect(screen.getByText('已重新纳入 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复保护' })).toBeInTheDocument()
    expect(screen.getAllByText('241 / 241')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getAllByText('默认来源已整理').length).toBeGreaterThan(0)
    expect(screen.queryByText('旅行来源已整理')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '扫描概览' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复保护' }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.queryByText('默认来源已整理')).not.toBeInTheDocument()
  })

  it('does not inject a protected video when its source is deselected before a rebuild', async () => {
    const createPreviewSpy = vi.spyOn(favoriteLedgerPreviewModule, 'createFavoriteLedgerPreview')
    const preview = createArchivePreviewFixture()
    preview.items = preview.items.slice(0, 1)
    preview.items[0].sourceFolderIds = ['source-1']
    preview.items[0].sourceFolderTitles = ['默认收藏夹']
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [{
        id: 'source-1',
        title: '默认收藏夹',
        videos: preview.items.map((item) => ({ ...item, sourceFolderIds: ['source-1'], sourceFolderTitles: ['默认收藏夹'] }))
      }],
      protectedVideos: [{
        aid: 8801,
        title: '取消来源后不可重建',
        tags: ['测试'],
        sourceFolderIds: ['source-1'],
        sourceFolderTitles: ['默认收藏夹'],
        currentBilimiFolderIds: [],
        protectedForIncrementalScan: true
      }],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off',
      sourceFolders: [{ id: 'source-1', title: '默认收藏夹', mediaCount: 2, videos: [] }]
    }
    const commonProps = {
      ledgers: createDefaultFavoriteLedgers(),
      missingLedgerIds: [],
      onEnsureLedgers: vi.fn(),
      onSaveLedgers: vi.fn(),
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan: vi.fn()
    }
    const rendered = render(<FavoriteLedgerPanel {...commonProps} favoriteArchiveMultiMode="off" />)

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' }))
    fireEvent.click(screen.getByRole('button', { name: '继续重新整理' }))
    fireEvent.click(screen.getByLabelText('整理来源 默认收藏夹，共 2'))

    createPreviewSpy.mockClear()
    rendered.rerender(<FavoriteLedgerPanel {...commonProps} favoriteArchiveMultiMode="two" />)
    await waitFor(() => expect(createPreviewSpy).toHaveBeenCalled())
    expect(createPreviewSpy.mock.calls.every(([input]) =>
      input.sourceFolders.every((folder) => folder.videos.every((video) => video.aid !== 8801))
    )).toBe(true)
  })

  it('rebuilds a protected video from the selected source summary when source metadata arrays are uneven', async () => {
    const createPreviewSpy = vi.spyOn(favoriteLedgerPreviewModule, 'createFavoriteLedgerPreview')
    const preview = createArchivePreviewFixture()
    preview.items = preview.items.slice(0, 1)
    preview.items[0].sourceFolderIds = ['music-2']
    preview.items[0].sourceFolderTitles = ['音乐']
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [],
      protectedVideos: [{
        aid: 8802,
        title: '不对称来源元数据',
        tags: ['测试'],
        sourceFolderIds: ['music-1', 'music-2'],
        sourceFolderTitles: ['音乐'],
        currentBilimiFolderIds: [],
        protectedForIncrementalScan: true
      }],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off',
      sourceFolders: [
        { id: 'music-1', title: '音乐', mediaCount: 1, videos: [] },
        { id: 'music-2', title: '音乐', mediaCount: 1, videos: [] }
      ]
    }
    const commonProps = {
      ledgers: createDefaultFavoriteLedgers(),
      missingLedgerIds: [],
      onEnsureLedgers: vi.fn(),
      onSaveLedgers: vi.fn(),
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan: vi.fn()
    }
    const rendered = render(<FavoriteLedgerPanel {...commonProps} favoriteArchiveMultiMode="off" />)

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    const musicSources = screen.getAllByLabelText(/^\u6574\u7406\u6765\u6e90 \u97f3\u4e50/)
    fireEvent.click(musicSources[0])
    fireEvent.click(screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' }))
    fireEvent.click(screen.getByRole('button', { name: '继续重新整理' }))

    createPreviewSpy.mockClear()
    rendered.rerender(<FavoriteLedgerPanel {...commonProps} favoriteArchiveMultiMode="two" />)
    await waitFor(() => expect(createPreviewSpy).toHaveBeenCalled())
    const rebuiltProtectedFolders = createPreviewSpy.mock.calls
      .flatMap(([input]) => input.sourceFolders)
      .filter((folder) => folder.videos.some((video) => video.aid === 8802))

    expect(rebuiltProtectedFolders).not.toHaveLength(0)
    expect(rebuiltProtectedFolders.every((folder) => folder.id === 'music-2' && folder.title === '音乐')).toBe(true)
  })

  it('restores protected reorganization progress after remount', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 3,
      activeSourceFolders: [
        {
          id: 'source-1',
          title: '默认收藏夹',
          videos: preview.items.map((item) => ({
            aid: item.aid,
            title: item.title,
            description: item.description,
            tags: item.tags,
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹'],
            currentBilimiFolderIds: []
          }))
        }
      ],
      protectedVideos: [
        {
          aid: 801,
          title: '需要恢复进度的已整理视频',
          tags: ['游戏'],
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: ['9002'],
          protectedForIncrementalScan: true
        }
      ],
      managedFolders: [
        { id: '9002', title: 'bilimi·游戏专区', ledgerId: 'game', isInbox: false }
      ],
      targetMembership: { '9002': [801] },
      multiArchiveMode: 'off'
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const first = renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '确认重新整理已整理收藏？' })).getByRole(
        'button',
        { name: '继续重新整理' }
      )
    )
    expect(screen.getByText('已重新纳入 1')).toBeInTheDocument()

    first.unmount()
    renderPanel({ onScanOldFavorites })

    expect(screen.getByText('已重新纳入 1')).toBeInTheDocument()
  })

  it('restores edited draft ledger keywords after remount', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue(createArchivePreviewFixture())
    const first = renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))
    let editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('关键词'), {
      target: { value: '热更新保留词' }
    })

    first.unmount()
    renderPanel({ onScanOldFavorites })
    fireEvent.click(screen.getByRole('button', { name: '（未保存）知识学习' }))
    editor = within(screen.getByRole('region', { name: '当前收藏夹' }))

    expect(editor.getByLabelText('关键词')).toHaveValue('热更新保留词')
  })

  it('reports archive health and reintroduces only abnormal protected favorites', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 5,
      activeSourceFolders: [],
      protectedVideos: [
        {
          aid: 801,
          title: '归档完整',
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: ['9001'],
          protectedForIncrementalScan: true,
          archiveHealth: 'complete'
        },
        {
          aid: 802,
          title: '归档不完整',
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: ['9001'],
          protectedForIncrementalScan: true,
          archiveHealth: 'incomplete'
        },
        {
          aid: 803,
          title: '归档已失效',
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: [],
          protectedForIncrementalScan: true,
          archiveHealth: 'invalid'
        }
      ],
      managedFolders: [
        { id: '9001', title: 'bilimi·知识学习', ledgerId: 'knowledge', isInbox: false }
      ],
      targetMembership: { '9001': [801, 802] },
      multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByText('仍在原归档').closest('article')).toHaveTextContent('1')
    expect(screen.getByText('仅保留部分归档').closest('article')).toHaveTextContent('1')
    expect(screen.getByText('已不在原归档').closest('article')).toHaveTextContent('1')
    expect(screen.getByText(/原归档状态发生变化/)).toBeInTheDocument()
    expect(screen.queryByText(/仍在原归档表示视频仍位于全部原归档收藏夹/)).not.toBeInTheDocument()
    expect(screen.queryByText(/仅保留部分归档表示只剩部分位置/)).not.toBeInTheDocument()
    const changedStatusButton = screen.getByRole('button', { name: '重新整理状态有变化的 2 条' })
    expect(changedStatusButton).toHaveAttribute(
      'title',
      '原归档是上次整理时记录的视频所在收藏夹。状态变化表示视频已不完全在原位置中；为避免覆盖你的手动调整，本轮先跳过，点击后重新纳入整理。'
    )
    expect(screen.getByRole('button', { name: '重新整理全部已整理视频 3 条' })).toBeInTheDocument()

    fireEvent.click(changedStatusButton)
    const dialog = screen.getByRole('alertdialog', { name: '确认重新整理状态有变化的视频？' })
    expect(changedStatusButton.closest('.favorite-ledger-panel__protected-summary')).not.toContainElement(dialog)
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    expect(dialog).toHaveTextContent('2 条')
    expect(dialog).toHaveTextContent('当前勾选来源')
    expect(dialog).toHaveTextContent('用户原有普通收藏不会改变')
    fireEvent.click(within(dialog).getByRole('button', { name: '继续重新整理' }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getAllByText('归档不完整').length).toBeGreaterThan(0)
    expect(screen.getAllByText('归档已失效').length).toBeGreaterThan(0)
    expect(screen.queryByText('归档完整')).not.toBeInTheDocument()
  })

  it('keeps all and changed-status reorganization actions visible when their counts match', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 3,
      activeSourceFolders: [],
      protectedVideos: [801, 802, 803].map((aid) => ({
        aid,
        title: `状态变化 ${aid}`,
        sourceFolderIds: ['source-1'],
        sourceFolderTitles: ['默认收藏夹'],
        currentBilimiFolderIds: [],
        protectedForIncrementalScan: true,
        archiveHealth: 'invalid' as const
      })),
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByRole('button', { name: '重新整理全部已整理视频 3 条' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新整理状态有变化的 3 条' })).toBeInTheDocument()
  })

  it('executes a protected multi-target reorganization as one reconciled video plan', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') return { ...ledger, bilibiliFolderId: '9001' }
      if (ledger.id === 'game') return { ...ledger, bilibiliFolderId: '9002' }
      return ledger
    })
    const preview: FavoriteLedgerPreview = {
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 0,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [],
        titleSeries: [],
        candidateLedgers: []
      },
      scanContext: {
        accountMid: '42',
        totalUniqueVideos: 1,
        activeSourceFolders: [],
        protectedVideos: [
          {
            aid: 801,
            title: '需要双目标重新整理',
            tags: ['知识', '游戏'],
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹'],
            currentBilimiFolderIds: ['9001'],
            protectedForIncrementalScan: true
          }
        ],
        managedFolders: [
          { id: '9001', title: 'bilimi·知识学习', ledgerId: 'knowledge', isInbox: false },
          { id: '9002', title: 'bilimi·游戏专区', ledgerId: 'game', isInbox: false }
        ],
        targetMembership: { '9001': [801], '9002': [] },
        multiArchiveMode: 'two'
      }
    }
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      completedItems: [],
      message: 'done'
    })
    renderPanel({
      ledgers,
      favoriteArchiveMultiMode: 'two',
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' }))
    fireEvent.click(screen.getByRole('button', { name: '继续重新整理' }))
    await screen.findByText('已重新纳入 1')
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    const item = (await screen.findByText('需要双目标重新整理')).closest('article')!
    fireEvent.change(within(item).getByLabelText('转移 需要双目标重新整理'), {
      target: { value: 'game' }
    })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([
      expect.objectContaining({
        aid: 801,
        reorganizeProtected: true,
        currentBilimiFolderIds: ['9001'],
        desiredTargetFolderIds: expect.arrayContaining(['9001', '9002'])
      })
    ])
  })

  it('records complete protected reorganization results without showing reconciliation details in cards', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') return { ...ledger, bilibiliFolderId: '9001' }
      if (ledger.id === 'game') return { ...ledger, bilibiliFolderId: '9002' }
      return ledger
    })
    const preview: FavoriteLedgerPreview = {
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 0,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [],
        titleSeries: [],
        candidateLedgers: []
      },
      scanContext: {
        accountMid: '42',
        totalUniqueVideos: 1,
        activeSourceFolders: [],
        protectedVideos: [
          {
            aid: 801,
            title: '需要迁移归档',
            tags: ['游戏'],
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹'],
            currentBilimiFolderIds: ['9001'],
            protectedForIncrementalScan: true
          }
        ],
        managedFolders: [
          { id: '9001', title: 'bilimi·知识学习', ledgerId: 'knowledge', isInbox: false },
          { id: '9002', title: 'bilimi·游戏专区', ledgerId: 'game', isInbox: false }
        ],
        targetMembership: { '9001': [801], '9002': [] },
        multiArchiveMode: 'off'
      }
    }
    const onExecuteOldFavoritePlan = vi.fn().mockImplementation(async ([item]) => ({
      ok: true,
      steps: [],
      missingTargets: [],
      completedItems: [{ ...item, finalFolderIds: ['9002'], addedFolderIds: ['9002'], removedFolderIds: ['9001'] }],
      message: 'done'
    }))
    const onConfirmArchiveProtections = vi.fn()
    renderPanel({
      ledgers,
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onConfirmArchiveProtections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' }))
    fireEvent.click(screen.getByRole('button', { name: '继续重新整理' }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const item = (await screen.findByText('需要迁移归档')).closest('article')!
    expect(within(item).queryByText('将加入：bilimi·游戏专区')).not.toBeInTheDocument()
    expect(within(item).queryByText('将移出：bilimi·知识学习')).not.toBeInTheDocument()
    expect(within(item).queryByText('普通收藏：保持不变')).not.toBeInTheDocument()
    expect(within(item).queryByText('保持当前 bilimi 归档')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('重新整理 1 条：1 条将追加，0 条保持当前 bilimi 归档。')).toBeInTheDocument()
    expect(screen.queryByText(/将移出/)).not.toBeInTheDocument()
    expect(screen.getByText('普通收藏保持不变。')).toBeInTheDocument()
    confirmOldFavoriteExecution()

    await waitFor(() =>
      expect(onConfirmArchiveProtections).toHaveBeenCalledWith([
        expect.objectContaining({
          accountMid: '42',
          aid: 801,
          targetLedgerIds: ['game'],
          targetFolderIds: ['9002'],
          completedAt: expect.any(String)
        })
      ])
    )
  })

  it('reports partial old favorite results separately from complete failures', async () => {
    const preview = createArchivePreviewFixture()
    preview.items = [
      preview.items[0],
      {
        ...preview.items[0],
        aid: 703,
        title: '完全失败的视频'
      }
    ]
    const onExecuteOldFavoritePlan = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, partial: true, steps: [], missingTargets: [], completedItems: [], message: 'partial' })
      .mockResolvedValueOnce({ ok: false, steps: [], missingTargets: [], completedItems: [], message: 'failed' })
    const onOldFavoriteStatusUpdate = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onOldFavoriteStatusUpdate
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(screen.getByText('本次整理已结束，0 条成功，1 条部分完成，1 条失败。')).toBeInTheDocument()
    expect(onOldFavoriteStatusUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: '整理未完全成功', tone: 'error' })
    )
  })

  it('uses a warning status when some videos were not processed but no partial operation occurred', async () => {
    const preview = createArchivePreviewFixture()
    preview.items = [preview.items[0], { ...preview.items[0], aid: 703, title: '遗漏的视频' }]
    const onExecuteOldFavoritePlan = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, steps: [], missingTargets: [], completedItems: [], message: 'done' })
      .mockResolvedValueOnce({ ok: false, steps: [], missingTargets: [], completedItems: [], message: 'failed' })
    const onOldFavoriteStatusUpdate = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onOldFavoriteStatusUpdate
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(onOldFavoriteStatusUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: '整理有遗漏', tone: 'warn' })
    )
  })

  it('protects a normal video only after every selected target completes successfully', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'two'
    }
    preview.items[0] = {
      ...preview.items[0],
      targets: [
        { ledgerId: 'knowledge', folderId: '9001', displayName: 'bilimi·知识学习', keywords: [], alreadyInTarget: false, selected: true },
        { ledgerId: 'game', folderId: '9002', displayName: 'bilimi·游戏专区', keywords: [], alreadyInTarget: false, selected: true }
      ],
      originalSuggestedLedgerIds: ['knowledge', 'game'],
      currentTargetLedgerIds: ['knowledge', 'game'],
      selectedTargetLedgerIds: ['knowledge', 'game']
    }
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') return { ...ledger, bilibiliFolderId: '9001' }
      if (ledger.id === 'game') return { ...ledger, bilibiliFolderId: '9002' }
      return ledger
    })
    const onExecuteOldFavoritePlan = vi.fn().mockImplementationOnce(async ([item]) => ({
      ok: false,
      partial: true,
      steps: [],
      missingTargets: ['9002'],
      completedItems: [item],
      message: 'failed'
    }))
    const onConfirmArchiveProtections = vi.fn()
    renderPanel({
      ledgers,
      favoriteArchiveMultiMode: 'two',
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onConfirmArchiveProtections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    expect(onConfirmArchiveProtections).not.toHaveBeenCalled()
  })

  it('does not count an execution result with unknown success as protected or successful', async () => {
    const preview = createArchivePreviewFixture()
    preview.items = [preview.items[0]]
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 1, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    const onConfirmArchiveProtections = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan: vi.fn().mockResolvedValue({
        steps: [], missingTargets: [], completedItems: [preview.items[0]], message: 'unknown'
      }),
      onConfirmArchiveProtections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await screen.findByText('本次整理已结束，0 条成功，0 条部分完成，1 条失败。')
    expect(onConfirmArchiveProtections).not.toHaveBeenCalled()
  })

  it('persists the refreshed target folder id after a successful append retry', async () => {
    const preview = createArchivePreviewFixture()
    preview.items = [preview.items[0]]
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 1, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    const onConfirmArchiveProtections = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan: vi.fn().mockResolvedValue({
        ok: true,
        steps: ['api:ledger:append-retry:701'],
        missingTargets: [],
        completedItems: [{ ...preview.items[0], targetFolderId: '9999' }],
        message: 'done'
      }),
      onConfirmArchiveProtections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onConfirmArchiveProtections).toHaveBeenCalledWith([
      expect.objectContaining({ aid: 701, targetFolderIds: ['9999'] })
    ]))
  })


  it('refreshes the preview locally when the target-count setting changed after scanning', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanProgress = {
      basic: { completed: 241, total: 241, status: 'complete' },
      tags: { completed: 241, total: 241, pending: 0, cacheHits: 0, succeeded: 241, failed: 0, status: 'complete' }
    }
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [
        {
          id: 'source-1',
          title: '默认收藏夹',
          videos: preview.items.map((item) => ({
            aid: item.aid,
            title: item.title,
            author: item.author,
            description: item.description,
            tags: item.tags,
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹']
          }))
        }
      ],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, bilibiliFolderId: '9001' } : ledger
    )
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      completedItems: [],
      message: 'done'
    })
    renderPanel({
      ledgers,
      favoriteArchiveMultiMode: 'two',
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    await waitFor(() =>
      expect(screen.getByText('归档预览已按“最多 2 个收藏夹”更新。')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: '扫描概览' }))
    expect(screen.getAllByText('241 / 241')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认开始整理？' })
    expect(dialog).toHaveTextContent('本次将整理 1 条视频，每条视频最多存入 2 个 bilimi 收藏夹。')
    expect(dialog).toHaveTextContent(
      '收藏夹数量设置已从“单收藏夹”调整为“最多 2 个”，归档预览已按新设置更新。'
    )
    fireEvent.click(within(dialog).getByRole('button', { name: '开始整理' }))

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalled())
  })

  it('stores a card toggle as sparse history and restores it with undo and redo', async () => {
    const { container } = await openArchivePreview()
    const previewVideo = getPreviewVideoButton(container, /AI 效率工具实战/)

    expect(previewVideo).toHaveAttribute('data-selected', 'true')
    fireEvent.click(previewVideo)
    await waitFor(() => expect(previewVideo).toHaveAttribute('data-selected', 'false'))
    expect(getOldFavoriteRuntimeValue<any[]>('archiveUndoStack', [])).toEqual([
      expect.objectContaining({
        kind: 'item',
        itemKey: expect.stringContaining('701'),
        archivePlanItem: expect.objectContaining({ selectedTargetLedgerIds: ['knowledge'] })
      })
    ])
    expect(getOldFavoriteRuntimeValue<any[]>('archiveUndoStack', [])[0]).not.toHaveProperty(
      'archivePlanState'
    )

    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))
    await waitFor(() => expect(previewVideo).toHaveAttribute('data-selected', 'true'))
    expect(getOldFavoriteRuntimeValue<any[]>('archiveRedoStack', [])[0]).toMatchObject({
      kind: 'item',
      archivePlanItem: { selectedTargetLedgerIds: [] }
    })

    fireEvent.click(screen.getByRole('button', { name: '恢复本次改动' }))
    await waitFor(() => expect(previewVideo).toHaveAttribute('data-selected', 'false'))
  })

  it('rolls back across multiple sparse item changes without leaving a later item patch applied', async () => {
    const preview = createArchivePreviewFixture()
    preview.items.push({ ...structuredClone(preview.items[0]), aid: 703, title: '第三个已分类视频' })
    const { container } = await openArchivePreview({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview)
    })
    const firstVideo = getPreviewVideoButton(container, /AI 效率工具实战/)
    const thirdVideo = getPreviewVideoButton(container, /第三个已分类视频/)
    const thirdInitiallySelected = thirdVideo.getAttribute('data-selected')

    fireEvent.click(firstVideo)
    await waitFor(() => expect(getOldFavoriteRuntimeValue<any[]>('archiveUndoStack', [])).toHaveLength(1))
    fireEvent.click(getPreviewVideoButton(container, /第三个已分类视频/))
    await waitFor(() => expect(getOldFavoriteRuntimeValue<any[]>('archiveUndoStack', [])).toHaveLength(2))
    fireEvent.click(getPreviewVideoButton(container, /AI 效率工具实战/))
    await waitFor(() => expect(getOldFavoriteRuntimeValue<any[]>('archiveUndoStack', [])).toHaveLength(3))

    fireEvent.change(screen.getByRole('combobox', { name: '改动记录' }), {
      target: { value: 'change:0' }
    })

    expect(firstVideo).toHaveAttribute('data-selected', 'false')
    expect(thirdVideo).toHaveAttribute('data-selected', thirdInitiallySelected)
  })

  it('does not render the standalone pending queue panel', () => {
    const onScanOldFavorites = vi.fn()

    renderPanel({
      onScanOldFavorites
    })

    expect(screen.queryByRole('region', { name: '待分类队列' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清空待分类队列' })).not.toBeInTheDocument()
    expect(onScanOldFavorites).not.toHaveBeenCalled()
  })

  it('shows clear toolbar descriptions for preparing and organizing ledgers', () => {
    renderPanel()

    expect(screen.getByRole('button', { name: '备册' })).toHaveTextContent(
      '一键生成 bilimi 收藏夹，用于归类收藏和整理'
    )
    expect(screen.getByRole('button', { name: '整理旧藏' })).toHaveTextContent(
      '扫描旧藏，确认后整理到 bilimi 收藏夹里'
    )
  })

  it('shows only unresolved old favorites in a top pending section in archive preview', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 1,
          title: '真正待分类',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: true,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        },
        {
          aid: 2,
          title: '已经对号入座',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: true,
          selected: false,
          targets: []
        },
        {
          aid: 3,
          title: '自动归档视频',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'knowledge',
              folderId: '9001',
              displayName: 'bilimi·学吧你就',
              keywords: ['学习'],
              alreadyInTarget: false,
              selected: true
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const pendingGroup = screen.getByRole('group', { name: '未匹配到合适分类 1 条' })
    expect(pendingGroup).toBeInTheDocument()
    expect(within(pendingGroup).getByText('真正待分类')).toBeInTheDocument()
    expect(within(pendingGroup).queryByText('暂无明确归档目标')).not.toBeInTheDocument()
    expect(within(pendingGroup).queryByText('已经对号入座')).not.toBeInTheDocument()
    expect(within(pendingGroup).queryByText('自动归档视频')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·学吧你就 1 条' })).toBeInTheDocument()
  })

  it('keeps unclassified old favorites unselected in the unmatched preview group', async () => {
    const onOpenOldFavoriteVideo = vi.fn()
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 601,
          title: '没有命中分类的旧藏',
          author: '',
          tags: ['冷门', '待看', '长视频', '资料'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          originalSuggestedLedgerIds: [],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: true,
          classificationDiagnostic: {
            score: 0.4,
            lowConfidence: true,
            scoreGap: 0.08,
            confidence: 'low',
            matchedKeywords: [],
            strongSignals: [],
            weakSignals: ['标题只命中弱关键词', '标签不足'],
            entityAliases: [],
            conceptClusters: [],
            positiveRules: [],
            negativeRules: []
          }
        }
      ],
      skippedSourceFolderTitles: []
    })

    const { container } = renderPanel({ onScanOldFavorites, onOpenOldFavoriteVideo })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const unmatchedGroup = screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })
    expect(within(unmatchedGroup).getByText('没有命中分类的旧藏')).toBeInTheDocument()
    expect(within(unmatchedGroup).getByText('来源：默认收藏夹')).toBeInTheDocument()
    expect(within(unmatchedGroup).getByText('UP：未知')).toBeInTheDocument()
    expect(within(unmatchedGroup).getByText(/标签：冷门、待看、长视频/)).toHaveAttribute(
      'title',
      '冷门、待看、长视频、资料'
    )
    expect(within(unmatchedGroup).getByText('分类把握：不太稳')).toHaveAttribute(
      'title',
      '当前分类比第二候选高 0.08、标题只命中弱关键词、标签不足'
    )
    expect(within(unmatchedGroup).queryByText('暂无明确归档目标')).not.toBeInTheDocument()
    fireEvent.click(within(unmatchedGroup).getByRole('button', { name: '打开视频来源 没有命中分类的旧藏' }))
    expect(onOpenOldFavoriteVideo).toHaveBeenCalledWith('https://www.bilibili.com/video/av601')
    expect(container.querySelector('.favorite-ledger-panel__preview-video')).not.toHaveAttribute(
      'aria-pressed'
    )
  })

  it('moves an old favorite to another ledger and reverts the item to its original group', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 602,
          title: '可以改去游戏区的视频',
          author: '小UP',
          tags: ['教程'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('转移 可以改去游戏区的视频'), {
      target: { value: 'game' }
    })

    const gameGroup = screen.getByRole('group', { name: 'bilimi·游戏 1 条' })
    expect(within(gameGroup).getByText('可以改去游戏区的视频')).toBeInTheDocument()
    expect(within(gameGroup).queryByText('将移至此分类')).not.toBeInTheDocument()
    expect(within(gameGroup).queryByText('当前位置')).not.toBeInTheDocument()
    expect(within(gameGroup).getByLabelText('转移 可以改去游戏区的视频')).toHaveAttribute(
      'title',
      '当前位置：bilimi·游戏，可手动切换'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·学习 1 条' })).not.toBeInTheDocument()

    fireEvent.change(within(gameGroup).getByLabelText('转移 可以改去游戏区的视频'), {
      target: { value: 'knowledge' }
    })

    expect(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'bilimi·游戏 1 条' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('转移 可以改去游戏区的视频')).toHaveAttribute(
      'title',
      '当前位置：bilimi·学习，可手动切换'
    )
  })

  it('sorts moved archive targets before low-confidence matches inside each ledger group', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 701,
          title: '低置信但未移动',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['game'],
          currentTargetLedgerIds: ['game'],
          selectedTargetLedgerIds: ['game'],
          lowConfidence: true
        },
        {
          aid: 702,
          title: 'DeepSeek 已移动',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['game'],
          selectedTargetLedgerIds: ['game'],
          lowConfidence: false
        },
        {
          aid: 703,
          title: '普通稳定匹配',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['game'],
          currentTargetLedgerIds: ['game'],
          selectedTargetLedgerIds: ['game'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const gameGroup = screen.getByRole('group', { name: 'bilimi·游戏 3 条' })
    const titles = Array.from(
      gameGroup.querySelectorAll('.favorite-ledger-panel__preview-video-title')
    ).map((node) => node.textContent)

    expect(titles).toEqual(['DeepSeek 已移动', '低置信但未移动', '普通稳定匹配'])
  })

  it('confirms how multi-target old favorites move to unclassified', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 603,
          title: '单目标去未分类',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        },
        {
          aid: 604,
          title: '多目标只取消当前',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge', 'game'],
          currentTargetLedgerIds: ['knowledge', 'game'],
          selectedTargetLedgerIds: ['knowledge', 'game'],
          lowConfidence: false
        },
        {
          aid: 605,
          title: '多目标全部去掉',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge', 'game'],
          currentTargetLedgerIds: ['knowledge', 'game'],
          selectedTargetLedgerIds: ['knowledge', 'game'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    fireEvent.change(screen.getByLabelText('转移 单目标去未分类'), {
      target: { value: 'unclassified' }
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '单目标去未分类'
    )

    fireEvent.change(within(screen.getByRole('group', { name: 'bilimi·学习 2 条' })).getByLabelText('转移 多目标只取消当前'), {
      target: { value: 'unclassified' }
    })
    const unclassifiedDialog = screen.getByRole('alertdialog', { name: '确认未分类处理' })
    expect(unclassifiedDialog.parentElement?.parentElement).toBe(document.body)
    expect(within(unclassifiedDialog).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.click(within(unclassifiedDialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('group', { name: 'bilimi·学习 2 条' })).toHaveTextContent(
      '多目标只取消当前'
    )
    expect(screen.getByRole('group', { name: 'bilimi·游戏 2 条' })).toHaveTextContent(
      '多目标只取消当前'
    )

    fireEvent.change(within(screen.getByRole('group', { name: 'bilimi·学习 2 条' })).getByLabelText('转移 多目标只取消当前'), {
      target: { value: 'unclassified' }
    })
    fireEvent.click(screen.getByRole('button', { name: '只取消当前收藏夹' }))
    expect(screen.queryByRole('group', { name: /未匹配到合适分类 2 条/ })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·游戏 2 条' })).toHaveTextContent(
      '多目标只取消当前'
    )
    expect(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).not.toHaveTextContent(
      '多目标只取消当前'
    )

    fireEvent.change(within(screen.getByRole('group', { name: 'bilimi·游戏 2 条' })).getByLabelText('转移 多目标全部去掉'), {
      target: { value: 'unclassified' }
    })
    fireEvent.click(screen.getByRole('button', { name: '全部去掉不整理' }))
    expect(screen.getByRole('group', { name: /未匹配到合适分类 2 条/ })).toHaveTextContent(
      '多目标全部去掉'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·游戏 2 条' })).not.toBeInTheDocument()
  })

  it('retargets only the current area for multi-target old favorites', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      if (ledger.id === 'movie-tv') {
        return { ...ledger, displayName: 'bilimi·影视', bilibiliFolderId: '9003' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 606,
          title: '多目标改其中一个',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge', 'game'],
          currentTargetLedgerIds: ['knowledge', 'game'],
          selectedTargetLedgerIds: ['knowledge', 'game'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    fireEvent.change(
      within(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).getByLabelText('转移 多目标改其中一个'),
      { target: { value: 'movie-tv' } }
    )

    expect(screen.queryByRole('group', { name: 'bilimi·学习 1 条' })).not.toBeInTheDocument()
    const movieGroup = screen.getByRole('group', { name: 'bilimi·影视 1 条' })
    const gameGroup = screen.getByRole('group', { name: 'bilimi·游戏 1 条' })
    expect(movieGroup).toHaveTextContent('多目标改其中一个')
    expect(getPreviewArticle(movieGroup, /多目标改其中一个/)).toHaveTextContent(
      '来自 bilimi·学习、bilimi·游戏'
    )
    expect(gameGroup).toHaveTextContent('多目标改其中一个')
    expect(getPreviewArticle(gameGroup, /多目标改其中一个/)).not.toHaveTextContent('来自')
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 2 条归档任务')).toBeInTheDocument()
  })

  it('opens a pending old favorite source without removing it from the round', async () => {
    const onOpenOldFavoriteVideo = vi.fn()
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 242,
          title: '手动分类旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ onScanOldFavorites, onOpenOldFavoriteVideo })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    fireEvent.click(screen.getByRole('button', { name: '打开视频来源 手动分类旧藏' }))

    expect(onOpenOldFavoriteVideo).toHaveBeenCalledWith('https://www.bilibili.com/video/av242')
    expect(screen.getByRole('group', { name: '未匹配到合适分类 1 条' })).toBeInTheDocument()
    expect(screen.getByText('手动分类旧藏')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '视频来源 手动分类旧藏' })).not.toBeInTheDocument()
  })

  it('adds a pending old favorite to staging for this round when requested', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 243,
          title: '暂存旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.change(screen.getByLabelText('转移 暂存旧藏'), {
      target: { value: 'inbox' }
    })

    const stagingGroup = screen.getByRole('group', { name: 'bilimi·暂存 1 条' })
    expect(getPreviewTargetToggle(stagingGroup, /暂存旧藏/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
  })

  it('lets unmatched old favorites choose any enabled bilimi ledger instead of only staging', async () => {
    await openArchivePreview()

    const pendingGroup = screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })
    fireEvent.change(within(pendingGroup).getByLabelText('转移 暂时不知道放哪'), {
      target: { value: 'game' }
    })

    expect(screen.queryByRole('group', { name: /未匹配到合适分类 0 条/ })).not.toBeInTheDocument()
    const gameGroup = screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })
    expect(getPreviewTargetToggle(gameGroup, /暂时不知道放哪/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('undoes and redoes archive preview changes step by step from separate toolbar buttons', async () => {
    await openArchivePreview()

    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    fireEvent.change(screen.getByLabelText('转移 暂时不知道放哪'), {
      target: { value: 'music' }
    })
    expect(screen.getByRole('group', { name: 'bilimi·音乐舞台 1 条' })).toHaveTextContent(
      '暂时不知道放哪'
    )

    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·音乐舞台 1 条' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·知识学习 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·游戏专区 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeDisabled()

    expect(screen.queryByText('已撤销本次改动。')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '恢复本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )

    fireEvent.click(screen.getByRole('button', { name: '恢复本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·音乐舞台 1 条' })).toHaveTextContent(
      '暂时不知道放哪'
    )
    expect(screen.getByRole('button', { name: '恢复本次改动' })).toBeDisabled()
  })

  it('lists archive changes and rolls back directly to a selected history state', async () => {
    await openArchivePreview()

    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    fireEvent.change(screen.getByLabelText('转移 暂时不知道放哪'), {
      target: { value: 'music' }
    })

    const historySelect = screen.getByRole('combobox', { name: '改动记录' })
    expect(within(historySelect).getByRole('option', { name: '归档预览初始状态' })).toBeInTheDocument()
    expect(within(historySelect).getByRole('option', { name: '最近一次改动：AI 效率工具实战' })).toBeInTheDocument()
    expect(within(historySelect).queryByRole('option', { name: '最近一次改动：暂时不知道放哪' })).not.toBeInTheDocument()
    expect(screen.getByText(/当前状态：最近一次改动：暂时不知道放哪/)).toBeInTheDocument()

    fireEvent.change(historySelect, { target: { value: 'change:0' } })

    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·音乐舞台 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复本次改动' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('转移 暂时不知道放哪'), {
      target: { value: 'inbox' }
    })

    expect(screen.getByRole('button', { name: '恢复本次改动' })).toBeDisabled()
  })

  it('rolls archive history back to the initial preview state', async () => {
    await openArchivePreview()

    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    fireEvent.change(screen.getByLabelText('转移 暂时不知道放哪'), {
      target: { value: 'music' }
    })

    fireEvent.change(screen.getByRole('combobox', { name: '改动记录' }), {
      target: { value: 'initial' }
    })

    expect(screen.getByRole('group', { name: 'bilimi·知识学习 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '恢复本次改动' }))
    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
  })

  it('toggles the old favorite guide hint from the heading help button', async () => {
    const preview = createArchivePreviewFixture()
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    const guideHint = /请从左到右完成本轮整理/
    expect(screen.queryByText(guideHint)).not.toBeInTheDocument()

    const helpButton = screen.getByRole('button', { name: '展开整理旧藏说明' })
    expect(helpButton).toHaveAttribute('title', expect.stringContaining('请从左到右完成本轮整理\n'))
    fireEvent.click(helpButton)

    const guide = screen.getByText(guideHint)
    const stepNav = screen.getByRole('navigation', { name: '整理旧藏步骤' })
    expect(Boolean(guide.compareDocumentPosition(stepNav) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(screen.getByText(guideHint)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByText(guideHint)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByText(guideHint)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText(guideHint)).toBeInTheDocument()
  })

  it('supports archive undo and redo keyboard shortcuts outside form controls', async () => {
    await openArchivePreview()

    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

    expect(screen.getByRole('group', { name: 'bilimi·知识学习 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·游戏专区 1 条' })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Z', ctrlKey: true, shiftKey: true })

    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )

    const historySelect = screen.getByLabelText('改动记录')
    historySelect.focus()
    fireEvent.keyDown(historySelect, { key: 'z', ctrlKey: true })

    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
  })

  it('confirms archive preview correction drafts only after executing the selected plan', async () => {
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:701'],
      missingTargets: [],
      message: '旧藏整理已完成。'
    })
    const onConfirmArchiveCorrections = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game'
        ? { ...ledger, bilibiliFolderId: '9002' }
        : ledger.id === 'knowledge'
          ? { ...ledger, bilibiliFolderId: '9001' }
          : ledger
    )
    await openArchivePreview({
      ledgers,
      onExecuteOldFavoritePlan,
      onConfirmArchiveCorrections
    })

    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), {
      target: { value: 'game' }
    })

    expect(onConfirmArchiveCorrections).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(onConfirmArchiveCorrections).toHaveBeenCalledWith([
        expect.objectContaining({
          aid: 701,
          title: 'AI 效率工具实战',
          originalLedgerId: 'knowledge',
          userLedgerIds: ['game'],
          source: 'user',
          feedbackType: 'strong-correction',
          sourceScene: 'archive-preview',
          sourceFolderTitle: '默认收藏夹',
          confirmedAt: expect.any(String)
        })
      ])
    )
  })

  it('persists each correction once across pause and resume', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[1] = { ...preview.items[0], aid: 703, title: '第二条知识视频' }
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game'
        ? { ...ledger, bilibiliFolderId: '9002' }
        : ledger.id === 'knowledge'
          ? { ...ledger, bilibiliFolderId: '9001' }
          : ledger
    )
    let resolveFirst!: (value: {
      ok: true; steps: string[]; missingTargets: string[]
      completedItems: FavoriteLedgerPreview['items']; message: string
    }) => void
    const firstRequest = new Promise<Parameters<typeof resolveFirst>[0]>((resolve) => { resolveFirst = resolve })
    const onExecuteOldFavoritePlan = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockImplementationOnce(async ([item]) => ({
        ok: true, steps: [], missingTargets: [], completedItems: [item], message: 'done'
      }))
    const onConfirmArchiveCorrections = vi.fn()
    renderPanel({
      ledgers,
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onConfirmArchiveCorrections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.change(screen.getByLabelText('转移 AI 效率工具实战'), { target: { value: 'game' } })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()
    await screen.findByRole('button', { name: '暂停整理' })
    fireEvent.click(screen.getByRole('button', { name: '暂停整理' }))
    await act(async () => {
      resolveFirst({
        ok: true, steps: [], missingTargets: [],
        completedItems: [{ ...preview.items[0], targetLedgerId: 'game', targetFolderId: '9002' }],
        message: 'done'
      })
      await firstRequest
    })
    await waitFor(() => expect(onConfirmArchiveCorrections).toHaveBeenCalledOnce())

    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '继续整理' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    vi.useRealTimers()
    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    await screen.findByRole('button', { name: '结束本轮' })
    expect(onConfirmArchiveCorrections).toHaveBeenCalledOnce()
  })

  it('does not confirm added archive correction targets when that target execution fails', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      return ledger
    })
    const preview: FavoriteLedgerPreview = {
      items: [
        {
          aid: 703,
          title: 'AI 工具也能做游戏剧情复盘',
          author: '效率研究所',
          description: '从 AI 工具聊到游戏剧情整理。',
          tags: ['AI', '游戏'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge', 'game'],
          selectedTargetLedgerIds: ['knowledge', 'game'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockImplementationOnce(async ([knowledge]) => ({
      ok: false,
      partial: true,
      steps: ['api:ledger:append:703:knowledge'],
      missingTargets: ['9002'],
      completedItems: [knowledge],
      message: '游戏收藏夹追加失败。'
    }))
    const onConfirmArchiveCorrections = vi.fn()

    renderPanel({
      ledgers,
      onScanOldFavorites,
      onExecuteOldFavoritePlan,
      onConfirmArchiveCorrections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const gameGroup = screen.getByRole('group', { name: /bilimi·游戏 1 条/ })
    const gameTargetToggle = getPreviewTargetToggle(gameGroup, /AI 工具也能做游戏剧情复盘/)
    fireEvent.click(gameTargetToggle)
    fireEvent.click(gameTargetToggle)

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ targetLedgerId: 'knowledge' }),
      expect.objectContaining({ targetLedgerId: 'game' })
    ]))
    expect(onConfirmArchiveCorrections).not.toHaveBeenCalled()
  })

  it('drops weak negative archive correction drafts for items without executed targets', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge'
        ? { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
        : ledger.id === 'game'
          ? { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
          : ledger
    )
    const preview: FavoriteLedgerPreview = {
      items: [
        {
          aid: 704,
          title: '取消归档的知识视频',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        },
        {
          aid: 705,
          title: '改去游戏区的视频',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:705:game'],
      missingTargets: [],
      message: '游戏收藏夹追加成功。'
    })
    const onConfirmArchiveCorrections = vi.fn()

    renderPanel({
      ledgers,
      onScanOldFavorites,
      onExecuteOldFavoritePlan,
      onConfirmArchiveCorrections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const knowledgeGroup = screen.getByRole('group', { name: /bilimi·学习 2 条/ })
    fireEvent.click(getPreviewTargetToggle(knowledgeGroup, /取消归档的知识视频/))
    fireEvent.change(within(knowledgeGroup).getByLabelText('转移 改去游戏区的视频'), {
      target: { value: 'game' }
    })

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(onConfirmArchiveCorrections).toHaveBeenCalledWith([
        expect.objectContaining({
          aid: 705,
          originalLedgerId: 'knowledge',
          userLedgerIds: ['game'],
          source: 'user',
          feedbackType: 'strong-correction'
        })
      ])
    )
  })

  it('ends a zero-task old favorite round directly from confirmation', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 248,
          title: '暂存旧藏一',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        },
        {
          aid: 249,
          title: '暂存旧藏二',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    const onExecuteOldFavoritePlan = vi.fn()
    const onOldFavoriteAcknowledged = vi.fn()

    renderPanel({
      onScanOldFavorites,
      onExecuteOldFavoritePlan,
      onOldFavoriteAcknowledged
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全部存入暂存' }))

    const stagingGroup = screen.getByRole('group', { name: 'bilimi·暂存 2 条' })
    expect(getPreviewTargetToggle(stagingGroup, /暂存旧藏一/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getPreviewTargetToggle(stagingGroup, /暂存旧藏二/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getPreviewArticle(stagingGroup, /暂存旧藏一/)).toHaveTextContent('来自 未分类')
    expect(getPreviewArticle(stagingGroup, /暂存旧藏二/)).toHaveTextContent('来自 未分类')
    expect(screen.getByRole('group', { name: '归档预览改动操作' })).toHaveTextContent(
      '最近批量改动：全部存入暂存，移动 2 条'
    )
    expect(screen.getByRole('alert')).toHaveTextContent('全部存入暂存：移动 2 条')

    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))
    expect(screen.getByRole('group', { name: /未匹配到合适分类 2 条/ })).toHaveTextContent(
      '暂存旧藏一'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·暂存 2 条' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 0 条归档任务')).toBeInTheDocument()
    expect(
      screen.getByText('本轮没有需要执行的归档任务，点击确认整理后结束本轮整理')
    ).toBeInTheDocument()
    const confirmButton = screen.getByRole('button', { name: '确认整理' })
    expect(confirmButton).toBeEnabled()

    fireEvent.click(confirmButton)

    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()
    await waitFor(() => expect(onOldFavoriteAcknowledged).toHaveBeenCalledOnce())
    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '结束本轮' })).not.toBeInTheDocument()
  })

  it('keeps retry judgment available for pending old favorites without a usable target', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 246,
          title: '无法补判旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getByRole('button', { name: '打开视频来源 无法补判旧藏' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '视频来源 无法补判旧藏' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '转移 无法补判旧藏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再次整理 无法补判旧藏' })).toBeInTheDocument()
  })

  it('moves a pending old favorite into a matched ledger after retry judgment uses edited keywords', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'music' ? { ...ledger, bilibiliFolderId: '9006' } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 247,
          title: '很喜欢草根逆袭的故事',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '音乐舞台' }))
    fireEvent.change(screen.getByLabelText('关键词'), {
      target: { value: '歌曲、MV、草根逆袭' }
    })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '再次整理 很喜欢草根逆袭的故事' }))

    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·音乐舞台 1 条' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
  })

  it('refreshes a pending old favorite before rejudging without staging the matched target', async () => {
    const onRejudgeOldFavorite = vi.fn().mockResolvedValue({
      aid: 250,
      title: '用户刚补了标签',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'game',
      targetFolderId: '9002',
      targetDisplayName: 'bilimi·游戏专区',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: false,
      tags: ['原神'],
      originalSuggestedLedgerIds: ['game'],
      currentTargetLedgerIds: [],
      selectedTargetLedgerIds: [],
      lowConfidence: false,
      targets: [
        {
          ledgerId: 'game',
          folderId: '9002',
          displayName: 'bilimi·游戏专区',
          keywords: ['原神'],
          alreadyInTarget: false,
          selected: true
        }
      ]
    })
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game' ? { ...ledger, bilibiliFolderId: '9002', keywords: ['原神'] } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 250,
          title: '用户刚补了标签',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          tags: [],
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites, onRejudgeOldFavorite })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '再次整理 用户刚补了标签' }))

    await waitFor(() => expect(onRejudgeOldFavorite).toHaveBeenCalledWith(expect.objectContaining({ aid: 250 })))
    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 0 条归档任务')).toBeInTheDocument()
  })

  it('moves a pending old favorite into a candidate target group after further judgment', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 244,
          title: '原神旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9901',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:原神',
              ledgerId: 'custom-tag-cluster-原神',
              displayName: 'bilimi·原神',
              keywords: ['原神']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: '原神', count: 1 }],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: '原神',
            displayName: 'bilimi·原神',
            keywords: ['原神'],
            count: 1,
            confidence: 'medium' as const,
            reason: '原神标签适合单独成册。'
          }
        ]
      }
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '再次整理 原神旧藏' }))

    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·原神 1 条' })).toBeInTheDocument()
  })

  it('selects an existing candidate target when further judgment uses preview targets', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 245,
          title: 'UP 主旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          candidateTargets: [
            {
              candidateKey: 'author:老番茄',
              ledgerId: 'custom-author-老番茄',
              displayName: 'bilimi·老番茄',
              keywords: ['老番茄']
            }
          ],
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            },
            {
              ledgerId: 'custom-author-老番茄',
              folderId: '',
              displayName: 'bilimi·老番茄',
              keywords: ['老番茄'],
              alreadyInTarget: false,
              selected: false,
              selectedCandidateTarget: true,
              candidateKey: 'author:老番茄'
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [{ name: '老番茄', count: 1, share: 1 }],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'author' as const,
            sourceName: '老番茄',
            displayName: 'bilimi·老番茄',
            keywords: ['老番茄'],
            count: 1,
            confidence: 'medium' as const,
            reason: '固定 UP 适合追更。'
          }
        ]
      }
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '再次整理 UP 主旧藏' }))

    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·老番茄 1 条' })).toBeInTheDocument()
  })

  it('backs up ledgers directly from 备册 without the old setup prompt', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )
    const onEnsureLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:list', 'api:ledger:create:humor'],
      missingTargets: [],
      message: '册目已备齐。'
    })
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。',
      ledgers: [
        ...createDefaultFavoriteLedgers(),
        {
          ...createDefaultFavoriteLedgers()[0],
          id: 'custom-tag-cluster-AI',
          displayName: 'Bilimi·AI效率工坊',
          bilibiliFolderId: '9901',
          isDefault: false
        }
      ]
    })
    const onOpenFavoritePage = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite-page:open'],
      missingTargets: [],
      message: '已打开 B 站收藏夹。'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [{ name: '效率研究所', count: 2, share: 2 / 3 }],
        topTags: [{ name: 'AI', count: 2 }],
        topCategories: [{ name: '科技数码', count: 2 }],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })
    const props: Parameters<typeof FavoriteLedgerPanel>[0] & {
      onOpenFavoritePage: typeof onOpenFavoritePage
    } = {
      ledgers,
      missingLedgerIds: ['game'],
      onEnsureLedgers,
      onSaveLedgers,
      onScanOldFavorites,
      onExecuteOldFavoritePlan: vi.fn(),
      onOpenFavoritePage
    }

    const { container } = render(<FavoriteLedgerPanel {...props} />)

    expect(screen.getByRole('heading', { name: '掌库' })).toHaveClass('sr-only')
    expect(screen.getByText('尚缺 bilimi·游戏专区。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    expect(onEnsureLedgers).not.toHaveBeenCalled()
    expect(onScanOldFavorites).not.toHaveBeenCalled()
    expect(screen.queryByText('是否根据旧藏生成你的专属库房？')).not.toBeInTheDocument()

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())

    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'bilimi·影视动漫', enabled: true }),
        expect.objectContaining({ displayName: 'bilimi·游戏专区', enabled: true }),
        expect.objectContaining({ displayName: 'bilimi·知识学习', enabled: true }),
        expect.objectContaining({ displayName: 'bilimi·生活日常', enabled: true })
      ]),
      { deleteDisabled: false }
    )
    await waitFor(() => expect(onOpenFavoritePage).toHaveBeenCalledOnce())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '小咪备册已完成，主人可以再增加自己想要的收藏夹，点击同步即可'
    )
    const toolbar = container.querySelector('.favorite-ledger-panel__toolbar')
    const status = container.querySelector('.favorite-ledger-panel__status')
    const workspace = container.querySelector('.favorite-ledger-panel__workspace')

    expect(toolbar?.compareDocumentPosition(status as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(status?.compareDocumentPosition(workspace as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('syncs checked Bilibili categories and personalized candidates', async () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·影视动漫',
            enabled: true,
            isDefault: true
          }),
          expect.objectContaining({
            displayName: 'bilimi·知识学习',
            enabled: true,
            isDefault: true
          })
        ])
      )
    )
  })

  it('uses a compact ledger header with the framed default ledgers and lower-right creation controls', async () => {
    const ledgers = createDefaultFavoriteLedgers()

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    expect(within(ledgerRegion).getByRole('heading', { name: '收藏夹' })).toBeInTheDocument()
    expect(screen.queryByText('推荐主分类收藏夹')).not.toBeInTheDocument()

    const headerActions = ledgerRegion.querySelector('.favorite-ledger-panel__category-actions')!
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '重置' })).toBeInTheDocument()
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '取消全选' })).toBeInTheDocument()
    expect(within(headerActions as HTMLElement).queryByRole('button', { name: '全选' })).not.toBeInTheDocument()
    expect(within(headerActions as HTMLElement).queryByRole('button', { name: '展开' })).not.toBeInTheDocument()
    expect(within(headerActions as HTMLElement).queryByRole('button', { name: '新建收藏夹' })).not.toBeInTheDocument()
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '同步' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    const ledgerHelpButton = within(ledgerRegion).getByRole('button', { name: '展开收藏夹说明' })
    const ledgerHelpTitle = [
      '自定义你的 bilimi 收藏夹',
      '点击收藏名字可以编辑，添加好后点击【同步】即可更新到 B 站',
      '取消勾选再点击同步，也会删除对应的 bilimi 收藏夹'
    ].join('\n')
    expect(ledgerHelpButton).toHaveAttribute(
      'title',
      ledgerHelpTitle
    )
    expect(ledgerRegion.querySelector('.favorite-ledger-panel__sync-hint')).not.toBeInTheDocument()
    fireEvent.click(ledgerHelpButton)
    expect(ledgerRegion.querySelector('.favorite-ledger-panel__sync-hint')).toHaveTextContent(
      '自定义你的 bilimi 收藏夹 点击收藏名字可以编辑，添加好后点击【同步】即可更新到 B 站 取消勾选再点击同步，也会删除对应的 bilimi 收藏夹'
    )
    const syncHint = ledgerRegion.querySelector('.favorite-ledger-panel__sync-hint')
    expect(syncHint).toHaveTextContent(
      '关键词、UP 名字和标签用于本地识别；DeepSeek 约束只在开启 DeepSeek 后作为辅助判断参考，可以输入一段自然语言。'
    )
    expect(syncHint).not.toHaveTextContent('【DeepSeek约束】')
    expect(syncHint).not.toHaveTextContent('手动输入')

    const visibleLedgerNames = Array.from(
      ledgerRegion.querySelector('.favorite-ledger-panel__chips')?.children ?? []
    ).map((item) => within(item as HTMLElement).getAllByRole('button')[0].textContent)
    expect(visibleLedgerNames).toEqual([
      '知识学习',
      '游戏专区',
      '影视动漫',
      '创意美学',
      '生活日常',
      '音乐舞台',
      '搞笑杂谈',
      '暂存'
    ])
    expect(within(ledgerRegion).queryByRole('button', { name: '鬼畜' })).not.toBeInTheDocument()
    expect(within(ledgerRegion).queryByRole('button', { name: '旅游出行' })).not.toBeInTheDocument()
    expect(ledgerRegion.querySelector('.favorite-ledger-panel__chips')?.children).toHaveLength(8)
    const listToggle = ledgerRegion.querySelector('.favorite-ledger-panel__list-toggle')!
    const creationControls = within(listToggle as HTMLElement).getAllByRole('button')
    expect(creationControls.map((button) => button.textContent)).toEqual(['新建收藏夹'])
    expect(within(listToggle as HTMLElement).queryByRole('button', { name: '展开' })).not.toBeInTheDocument()
    expect(within(listToggle as HTMLElement).getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()
  })

  it('selects and clears every ledger before sync from the header actions', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'movie-tv' || ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    const headerActions = ledgerRegion.querySelector('.favorite-ledger-panel__category-actions')!

    fireEvent.click(within(headerActions as HTMLElement).getByRole('button', { name: '全选' }))
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '取消全选' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'movie-tv', enabled: true }),
          expect.objectContaining({ id: 'knowledge', enabled: true })
        ])
      )
    )

    fireEvent.click(within(headerActions as HTMLElement).getByRole('button', { name: '取消全选' }))
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '全选' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'movie-tv', enabled: false }),
          expect.objectContaining({ id: 'knowledge', enabled: false })
        ])
      )
    )
  })

  it('starts with an empty editor area until a ledger is selected', () => {
    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    expect(container.querySelector('.favorite-ledger-panel__editor-placeholder')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))

    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
    expect(screen.getByText('正在编辑：bilimi·影视动漫')).toBeInTheDocument()
  })
  it('frames the ledger list and editor together in the workspace', () => {
    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const workspace = container.querySelector('.favorite-ledger-panel__workspace')
    expect(workspace).toBeInTheDocument()
    expect(workspace?.querySelector('.favorite-ledger-panel__checklist')).toBeInTheDocument()
    expect(workspace?.querySelector('.favorite-ledger-panel__editor-placeholder')).toBeInTheDocument()
  })

  it('selects a ledger without changing whether it syncs', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'movie-tv' ? { ...ledger, enabled: false } : ledger
    )
    const targetLedger = ledgers.find((ledger) => ledger.id === 'movie-tv')!
    const targetLabel = targetLedger.displayName.replace(/^bilimi[·\s-]*/i, '')

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const ledgerButton = screen.getByRole('button', { name: targetLabel })
    expect(ledgerButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(ledgerButton)

    expect(screen.getByText(`正在编辑：${targetLedger.displayName}`)).toBeInTheDocument()
    expect(screen.getByDisplayValue(targetLabel)).toBeInTheDocument()
    expect(ledgerButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            enabled: false
          })
        ])
      )
    )
  })

  it('locks the rule type for default ledgers while keeping name and keywords editable', async () => {
    const onSaveLedgers = vi.fn()
    renderPanel({ onSaveLedgers })

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    expect(editor.getByLabelText('收藏夹种类')).toBeDisabled()
    expect(editor.getByLabelText('收藏夹种类')).toHaveValue('keyword')

    fireEvent.change(editor.getByLabelText('册名'), { target: { value: '知识库' } })
    fireEvent.change(editor.getByLabelText('关键词'), { target: { value: '课程 教程 学术' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'knowledge',
            displayName: 'bilimi·知识库',
            keywords: ['课程', '教程', '学术'],
            isDefault: true
          })
        ])
      )
    )
  })

  it('warns when a non-inbox default ledger is saved without local keywords', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('关键词'), { target: { value: '' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    expect(screen.getByRole('status')).toHaveTextContent('默认分类关键词已清空')
  })

  it('adds a disabled ledger to sync without asking for confirmation', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'movie-tv' ? { ...ledger, enabled: false } : ledger
    )
    const targetLedger = ledgers.find((ledger) => ledger.id === 'movie-tv')!
    const targetLabel = targetLedger.displayName.replace(/^bilimi[·\s-]*/i, '')

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const ledgerButton = screen.getByRole('button', { name: targetLabel })
    const addButton = screen.getByRole('button', {
      name: new RegExp(targetLedger.displayName)
    })
    fireEvent.click(addButton)

    expect(ledgerButton).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen
        .queryAllByRole('dialog')
        .some((dialog) => dialog.classList.contains('favorite-ledger-panel__sync-confirm'))
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            enabled: true
          })
        ])
      )
    )
  })

  it('creates a new custom ledger from the final shortcut without the old form', async () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const chips = screen.getByRole('region', { name: '收藏夹' })
        expect(chips.querySelector('.favorite-ledger-panel__add-shortcut')).not.toBeInTheDocument()
    expect(within(chips).getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '新立册目' })).not.toBeInTheDocument()

    fireEvent.click(within(chips).getByRole('button', { name: '新建收藏夹' }))

    expect(screen.getByText('正在编辑：bilimi·')).toBeInTheDocument()
    const nextChipItems = Array.from(
      chips.querySelector('.favorite-ledger-panel__chips')?.children ?? []
    )
    const newLedgerItemIndex = nextChipItems.findIndex((item) =>
      within(item as HTMLElement).queryByRole('button', { name: '选择新建收藏夹' })
    )
    expect(newLedgerItemIndex).toBe(nextChipItems.length - 1)
    expect(within(chips).getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    expect(editor.getByLabelText('收藏夹种类')).toHaveValue('keyword')
    fireEvent.change(editor.getByLabelText('册名'), { target: { value: '摄影' } })
    fireEvent.change(editor.getByLabelText('关键词'), { target: { value: '摄影 写真、镜头' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·摄影' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·摄影',
            keywords: ['摄影', '写真', '镜头'],
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it('edits a new ledger as an author follow-up collection', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: 'favorite ledgers saved'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('收藏夹种类'), { target: { value: 'author' } })
    expect(editor.getByLabelText('UP 名字')).toBeInTheDocument()
    expect(
      screen.getByText('填写一个或多个 UP 名，命中作者时会优先存入这个收藏夹。')
    ).toBeInTheDocument()

    fireEvent.change(editor.getByLabelText('册名'), { target: { value: '我的追更' } })
    fireEvent.change(editor.getByLabelText('UP 名字'), { target: { value: '影视飓风、罗翔说刑法' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·我的追更' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·我的追更',
            keywords: ['影视飓风', '罗翔说刑法'],
            ruleType: 'author',
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it.each([
    {
      ruleType: 'keyword',
      ruleLabel: '关键词',
      name: 'AI资料',
      localRules: 'AI 教程',
      expectedLocalRules: ['AI', '教程'],
      constraint: '只收可复用的学习资料，排除带货软广。'
    },
    {
      ruleType: 'author',
      ruleLabel: 'UP 名字',
      name: '追更',
      localRules: '影视飓风、罗翔说刑法',
      expectedLocalRules: ['影视飓风', '罗翔说刑法'],
      constraint: '优先收系列长视频，不收切片搬运。'
    },
    {
      ruleType: 'tag',
      ruleLabel: '标签',
      name: '摄影标签',
      localRules: '摄影 后期',
      expectedLocalRules: ['摄影', '后期'],
      constraint: '只收教程和案例复盘，排除器材广告。'
    }
  ] as const)('saves a separate DeepSeek constraint for $ruleType ledgers', async ({
    ruleType,
    ruleLabel,
    name,
    localRules,
    expectedLocalRules,
    constraint
  }) => {
    const onSaveLedgers = vi.fn()
    renderPanel({ onSaveLedgers })

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('收藏夹种类'), { target: { value: ruleType } })
    fireEvent.change(editor.getByLabelText('册名'), { target: { value: name } })
    fireEvent.change(editor.getByLabelText(ruleLabel), { target: { value: localRules } })
    const constraintField = editor.getByLabelText('DeepSeek约束')
    expect(constraintField.tagName).toBe('INPUT')
    expect(constraintField).toHaveAttribute('type', 'text')
    fireEvent.change(constraintField, { target: { value: constraint } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    fireEvent.click(screen.getByRole('button', { name: `加入同步 bilimi·${name}` }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: `bilimi·${name}`,
            keywords: [...expectedLocalRules, DEEPSEEK_CONSTRAINT_MARKER, constraint],
            ruleType,
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it('splits a legacy inline DeepSeek constraint into the separate one-line constraint field', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-photo',
        displayName: 'bilimi·摄影',
        keywords: [
          '摄影',
          '后期',
          DEEPSEEK_CONSTRAINT_MARKER,
          '只收教程和案例复盘。\n排除器材广告。',
          '保留案例复盘。'
        ],
        ruleType: 'tag' as const,
        enabled: true,
        priority: 999,
        isDefault: false
      }
    ]
    renderPanel({ ledgers })

    fireEvent.click(screen.getByRole('button', { name: '摄影' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    expect(editor.getByLabelText('标签')).toHaveValue('摄影、后期')
    const constraintField = editor.getByLabelText('DeepSeek约束')
    expect(constraintField.tagName).toBe('INPUT')
    expect(constraintField).toHaveValue('只收教程和案例复盘。 排除器材广告。 保留案例复盘。')
  })

  it('edits a new ledger as a DeepSeek constraint collection', async () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('收藏夹种类'), { target: { value: 'deepseek' } })
    expect(editor.getByLabelText('DeepSeek约束')).toBeInTheDocument()
    expect(
      screen.getByText('填写自然语言判断规则。此类型不参与本地自动分类，必须开启 DeepSeek 后才会用于辅助判断。')
    ).toBeInTheDocument()
    expect(
      screen.getByText('DeepSeek 未开启时不会自动命中；需要本地规则时请选择关键词、UP 或标签收藏夹。')
    ).toBeInTheDocument()

    fireEvent.change(editor.getByLabelText('册名'), { target: { value: '剧情考据' } })
    fireEvent.change(editor.getByLabelText('DeepSeek约束'), {
      target: { value: '只收剧情解析、角色考据、世界观分析。\n不要收抽卡、整活、直播切片。' }
    })
    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·剧情考据' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·剧情考据',
            ruleType: 'deepseek',
            keywords: ['只收剧情解析、角色考据、世界观分析。\n不要收抽卡、整活、直播切片。']
          })
        ])
      )
    )
  })

  it('saves the dragged ledger order and keeps new ledgers in the header action', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。',
      ledgers: [
        ...createDefaultFavoriteLedgers(),
        {
          ...createDefaultFavoriteLedgers()[0],
          id: 'custom-tag-cluster-AI',
          displayName: 'bilimi·AI效率工坊',
          bilibiliFolderId: '9901',
          isDefault: false
        }
      ]
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const chips = screen.getByRole('region', { name: '收藏夹' })
        const chipGrid = chips.querySelector('.favorite-ledger-panel__chips')!
    const musicItem = within(chips).getByRole('button', { name: '音乐舞台' }).closest('.favorite-ledger-panel__chip-item')!
    const knowledgeItem = within(chips).getByRole('button', { name: '知识学习' }).closest('.favorite-ledger-panel__chip-item')!

    let dragPayload = ''
    fireEvent.dragStart(musicItem, {
      dataTransfer: { effectAllowed: '', setData: (_type: string, value: string) => { dragPayload = value } }
    })
    fireEvent.dragOver(knowledgeItem, { dataTransfer: { dropEffect: '' } })
    fireEvent.drop(knowledgeItem, { dataTransfer: { getData: () => dragPayload } })

    expect(
      Array.from(chipGrid.children).some((item) =>
        item.classList.contains('favorite-ledger-panel__add-shortcut')
      )
    ).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    const savedLedgers = onSaveLedgers.mock.calls[0][0] as FavoriteLedger[]
    const savedLedgerIds = savedLedgers.map((ledger) => ledger.id)
    expect(savedLedgerIds.indexOf('music')).toBeLessThan(savedLedgerIds.indexOf('knowledge'))
    expect(savedLedgers.find((ledger) => ledger.id === 'music')!.priority).toBeLessThan(
      savedLedgers.find((ledger) => ledger.id === 'knowledge')!.priority
    )
    expect(await screen.findByRole('status')).toHaveTextContent('掌库已同步。')
  })

  it('keeps ledger positions stable while showing an insertion line during dragging', async () => {
    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const chips = screen.getByRole('region', { name: '收藏夹' })
        const chipGrid = chips.querySelector('.favorite-ledger-panel__chips')!
    const musicItem = within(chips).getByRole('button', { name: '音乐舞台' }).closest('.favorite-ledger-panel__chip-item')!
    const knowledgeItem = within(chips).getByRole('button', { name: '知识学习' }).closest('.favorite-ledger-panel__chip-item')!
    const orderBeforeDrag = Array.from(chipGrid.children).map(
      (item) => item.querySelector('button')?.textContent ?? ''
    )

    fireEvent.dragStart(musicItem, { dataTransfer: { effectAllowed: '', setData: vi.fn() } })
    fireEvent.dragOver(knowledgeItem, { dataTransfer: { dropEffect: '' } })

    const stableOrder = Array.from(chipGrid.children).map(
      (item) => item.querySelector('button')?.textContent ?? ''
    )

    expect(stableOrder).toEqual(orderBeforeDrag)
    expect(musicItem).toHaveAttribute('data-dragging', 'true')
    expect(knowledgeItem).toHaveAttribute('data-drop-target', 'true')
  })

  it('moves a later dragged ledger before the insertion-line target on drop', async () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const chips = screen.getByRole('region', { name: '收藏夹' })
        const musicItem = within(chips).getByRole('button', { name: '音乐舞台' }).closest('.favorite-ledger-panel__chip-item')!
    const gameItem = within(chips).getByRole('button', { name: '游戏专区' }).closest('.favorite-ledger-panel__chip-item')!

    let dragPayload = ''
    fireEvent.dragStart(musicItem, {
      dataTransfer: { effectAllowed: '', setData: (_type: string, value: string) => { dragPayload = value } }
    })
    fireEvent.dragOver(gameItem, { dataTransfer: { dropEffect: '' } })
    fireEvent.drop(gameItem, { dataTransfer: { getData: () => dragPayload } })
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    const savedLedgerIds = (onSaveLedgers.mock.calls[0][0] as FavoriteLedger[]).map(
      (ledger) => ledger.id
    )
    expect(savedLedgerIds.indexOf('music')).toBe(savedLedgerIds.indexOf('game') - 1)
    expect(savedLedgerIds.indexOf('music')).toBeLessThan(savedLedgerIds.indexOf('movie-tv'))
    expect(savedLedgerIds.indexOf('game')).toBeLessThan(savedLedgerIds.indexOf('movie-tv'))
  })

  it('resets the ledger draft to unchecked defaults before saving', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger, index) =>
      ledger.id === 'movie-tv'
        ? {
            ...ledger,
            displayName: 'bilimi·影视动漫改名',
            enabled: false,
            priority: 999
          }
        : {
            ...ledger,
            priority: (index + 5) * 10
          }
    )

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            displayName: 'bilimi·影视动漫',
            enabled: false,
            priority: 30
          }),
          expect.objectContaining({
            id: 'inbox',
            enabled: false
          })
        ])
      )
    )
  })

  it('edits the active ledger from the highlighted ledger buttons', async () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    expect(screen.queryByText('bilimi·见闻增广')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '暂歇' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))

    expect(screen.getByText('正在编辑：bilimi·影视动漫')).toBeInTheDocument()
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('册名'), {
      target: { value: 'bilimi·音MAD' }
    })
    fireEvent.change(editor.getByLabelText('关键词'), {
      target: { value: '音MAD、鬼畜 调音 / 人力' }
    })

    expect(editor.queryByRole('button', { name: '删除末词' })).not.toBeInTheDocument()
    expect(editor.queryByRole('button', { name: '新增关键词' })).not.toBeInTheDocument()
    expect(screen.getByText('不同关键词用顿号或空格隔开，逗号、斜杠也能识别。')).toBeInTheDocument()
    expect(editor.getByLabelText('DeepSeek约束')).toBeInTheDocument()

    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            displayName: 'bilimi·音MAD',
            keywords: ['音MAD', '鬼畜', '调音', '人力']
          })
        ])
      )
    )
  })

  it('switches directly to another ledger when the editor is clean', () => {
    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    expect(screen.getByText('正在编辑：bilimi·影视动漫')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))

    expect(screen.getByText('正在编辑：bilimi·知识学习')).toBeInTheDocument()
    expect(screen.queryByText('正在编辑：bilimi·影视动漫')).not.toBeInTheDocument()
  })

  it('collapses an unmodified editor when clicking outside the editor', () => {
    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    expect(screen.getByText('正在编辑：bilimi·影视动漫')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('dialog', { name: '掌库' }))

    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
  })
  it('keeps each ledger draft when switching cards and marks only dirty cards', () => {
    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('册名'), {
      target: { value: '音MAD' }
    })
    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))

    expect(screen.getByText('正在编辑：bilimi·知识学习')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '（未保存）音MAD' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '（未保存）音MAD' }))
    expect(screen.getByLabelText('册名')).toHaveValue('音MAD')
  })

  it('collapses a dirty editor without discarding its draft', () => {
    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('册名'), {
      target: { value: '音MAD' }
    })
    fireEvent.click(screen.getByRole('button', { name: '（未保存）音MAD' }))

    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '（未保存）音MAD' })).toBeInTheDocument()
  })

  it('places save before delete in the editor title and deletes only the selected duplicate-id ledger', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-new-ledger',
        displayName: 'bilimi·摄影',
        keywords: ['摄影'],
        enabled: true,
        priority: 100,
        isDefault: false
      },
      {
        id: 'custom-new-ledger',
        displayName: 'bilimi·剪辑',
        keywords: ['剪辑'],
        enabled: true,
        priority: 110,
        isDefault: false
      }
    ]

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const chips = screen.getByRole('region', { name: '收藏夹' })
    fireEvent.click(screen.getByRole('button', { name: '摄影' }))

    const editorTitle = screen.getByText('正在编辑：bilimi·摄影').closest('.favorite-ledger-panel__editor-title')!
    const titleButtons = within(editorTitle as HTMLElement).getAllByRole('button')
    expect(titleButtons.map((button) => button.textContent)).toEqual(['保存', '删除'])

    fireEvent.click(within(editorTitle as HTMLElement).getByRole('button', { name: '删除 bilimi·摄影' }))

    expect(screen.queryByRole('button', { name: '摄影' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '剪辑' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
  })

  it('updates only the selected occurrence when duplicate ledger ids exist', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-duplicate',
        displayName: 'bilimi·摄影',
        keywords: ['摄影'],
        enabled: true,
        priority: 100,
        isDefault: false
      },
      {
        id: 'custom-duplicate',
        displayName: 'bilimi·剪辑',
        keywords: ['剪辑'],
        enabled: true,
        priority: 110,
        isDefault: false
      }
    ]
    renderPanel({ ledgers })

    fireEvent.click(screen.getByRole('button', { name: '剪辑' }))
    fireEvent.change(screen.getByLabelText('册名'), { target: { value: '剪辑新名' } })

    expect(screen.getByRole('button', { name: '摄影' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '（未保存）剪辑新名' })).toBeInTheDocument()
  })

  it('drags the selected duplicate occurrence and keeps its editor attached after reordering', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-duplicate',
        displayName: 'bilimi·摄影',
        keywords: ['摄影'],
        enabled: true,
        priority: 100,
        isDefault: false
      },
      {
        id: 'custom-duplicate',
        displayName: 'bilimi·剪辑',
        keywords: ['剪辑'],
        enabled: true,
        priority: 110,
        isDefault: false
      }
    ]
    renderPanel({ ledgers })
    const chips = screen.getByRole('region', { name: '收藏夹' })
    const editingItem = within(chips).getByRole('button', { name: '剪辑' }).closest('.favorite-ledger-panel__chip-item')!
    const knowledgeItem = within(chips).getByRole('button', { name: '知识学习' }).closest('.favorite-ledger-panel__chip-item')!
    let dragPayload = ''

    fireEvent.click(within(chips).getByRole('button', { name: '剪辑' }))
    fireEvent.dragStart(editingItem, {
      dataTransfer: { effectAllowed: '', setData: (_type: string, value: string) => { dragPayload = value } }
    })
    fireEvent.dragOver(knowledgeItem, { dataTransfer: { dropEffect: '' } })
    fireEvent.drop(knowledgeItem, { dataTransfer: { getData: () => dragPayload } })

    const orderedNames = Array.from(chips.querySelectorAll('.favorite-ledger-panel__chip-item > button:first-child'))
      .map((button) => button.textContent)
    expect(orderedNames.indexOf('剪辑')).toBeLessThan(orderedNames.indexOf('知识学习'))
    expect(orderedNames.indexOf('摄影')).toBeGreaterThan(orderedNames.indexOf('知识学习'))
    expect(screen.getByText('正在编辑：bilimi·剪辑')).toBeInTheDocument()
  })

  it('keeps the active ledger editor attached to the same card after reordering', () => {
    renderPanel()
    const chips = screen.getByRole('region', { name: '收藏夹' })
    const musicItem = within(chips).getByRole('button', { name: '音乐舞台' }).closest('.favorite-ledger-panel__chip-item')!
    const gameItem = within(chips).getByRole('button', { name: '游戏专区' }).closest('.favorite-ledger-panel__chip-item')!
    let dragPayload = ''

    fireEvent.click(within(chips).getByRole('button', { name: '音乐舞台' }))
    fireEvent.dragStart(musicItem, {
      dataTransfer: { effectAllowed: '', setData: (_type: string, value: string) => { dragPayload = value } }
    })
    fireEvent.dragOver(gameItem, { dataTransfer: { dropEffect: '' } })
    fireEvent.drop(gameItem, { dataTransfer: { getData: () => dragPayload } })

    expect(screen.getByText('正在编辑：bilimi·音乐舞台')).toBeInTheDocument()
  })
  it('keeps the Bilimi prefix fixed while editing a managed ledger name', async () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))

    expect(editor.getByText('bilimi·')).toBeInTheDocument()
    const nameInput = editor.getByLabelText('册名')
    expect(nameInput).toHaveValue('影视动漫')

    fireEvent.change(nameInput, {
      target: { value: '音MAD' }
    })
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            displayName: 'bilimi·音MAD'
          })
        ])
      )
    )
  })

  it('explains that ledger keywords are rules used to match future favorites', () => {
    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))

    expect(
      screen.getByText('建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。')
    ).toBeInTheDocument()
    expect(screen.getByText('不同关键词用顿号或空格隔开，逗号、斜杠也能识别。')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '当前收藏夹' })).getByLabelText('DeepSeek约束')).toBeInTheDocument()
  })

  it('deletes only Bilimi custom ledgers after 同步', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-photo',
        displayName: 'bilimi·光影留真',
        keywords: ['摄影'],
        enabled: true,
        priority: 100,
        isDefault: false
      },
      {
        id: 'custom-personal',
        displayName: '个人摄影夹',
        keywords: ['摄影'],
        enabled: true,
        priority: 101,
        isDefault: false
      }
    ]

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

        fireEvent.click(screen.getByRole('button', { name: '光影留真' }))
    fireEvent.click(screen.getByRole('button', { name: '删除 bilimi·光影留真' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()
    expect(screen.queryByText('bilimi·光影留真')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '个人摄影夹' }))
    expect(screen.getByText('正在编辑：个人摄影夹')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 个人摄影夹' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.not.arrayContaining([
          expect.objectContaining({
            id: 'custom-photo'
          })
        ])
      )
    )
    expect(screen.queryByRole('button', { name: '删除 bilimi·见闻增广' })).not.toBeInTheDocument()
  })

  it('rebuilds recommendations and removes dangling archive targets after deleting local custom ledgers', async () => {
    const customLedgers: FavoriteLedger[] = [
      {
        id: 'custom-tag-cluster-明日方舟',
        displayName: 'bilimi·明日方舟',
        keywords: ['明日方舟'],
        ruleType: 'tag',
        enabled: true,
        priority: 90,
        isDefault: false,
        bilibiliFolderId: '9101'
      },
      {
        id: 'custom-author-honker233-小王爱马枪',
        displayName: 'bilimi·honker233',
        keywords: ['honker233-小王爱马枪'],
        ruleType: 'author',
        enabled: true,
        priority: 100,
        isDefault: false,
        bilibiliFolderId: '9102'
      }
    ]
    const ledgers = [...createDefaultFavoriteLedgers(), ...customLedgers]
    const sourceFolders = [{
      id: 'source-default',
      title: '默认收藏夹',
      videos: Array.from({ length: 6 }, (_, index) => ({
        aid: 9200 + index,
        title: `明日方舟视频 ${index + 1}`,
        author: 'honker233-小王爱马枪',
        tags: ['明日方舟'],
        sourceFolderIds: ['source-default'],
        sourceFolderTitles: ['默认收藏夹']
      }))
    }]
    const preview = favoriteLedgerPreviewModule.createFavoriteLedgerPreview({
      ledgers,
      sourceFolders,
      targetMembership: { '9101': [], '9102': [] }
    })
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 6,
      sourceFolders,
      activeSourceFolders: sourceFolders,
      protectedVideos: [],
      managedFolders: [
        { id: '9101', title: 'bilimi·明日方舟', ledgerId: customLedgers[0].id, isInbox: false },
        { id: '9102', title: 'bilimi·honker233', ledgerId: customLedgers[1].id, isInbox: false }
      ],
      targetMembership: { '9101': [], '9102': [] },
      multiArchiveMode: 'off'
    }
    renderPanel({
      ledgers,
      onSaveLedgers: vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' }),
      onScanOldFavorites: vi.fn().mockResolvedValue(preview)
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.queryByLabelText('bilimi·明日方舟')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·honker233')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '明日方舟' }))
    fireEvent.click(screen.getByRole('button', { name: '删除 bilimi·明日方舟' }))
    fireEvent.click(screen.getByRole('button', { name: 'honker233' }))
    fireEvent.click(screen.getByRole('button', { name: '删除 bilimi·honker233' }))

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·明日方舟')).toBeEnabled()
    expect(screen.getByLabelText('bilimi·honker233')).toBeEnabled()
    expect(screen.getByLabelText('bilimi·明日方舟')).not.toBeChecked()
    expect(screen.getByLabelText('bilimi·honker233')).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.queryByRole('group', { name: /bilimi·明日方舟/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /bilimi·honker233/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.queryByText(/无法解析归档目标/)).not.toBeInTheDocument()
  })

  it('does not render the old close-only 合卷 button', () => {
    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: '合卷' })).not.toBeInTheDocument()
  })

  it('guides old favorite organization through scan, recommended ledgers, preview, and confirmation', async () => {
    const preview: FavoriteLedgerPreview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          sourceFolderTitles: ['默认收藏夹', '旅行收藏'],
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi路知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'Bilimi路AI效率工坊',
              keywords: ['AI', '效率', '工具']
            }
          ]
        },
        {
          aid: 102,
          title: '标题党软广避雷',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'Bilimi路待分类',
          reviewRequired: true,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 103,
          title: '已经归档的视频',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi路知识',
          reviewRequired: false,
          alreadyInTarget: true,
          selected: false
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [{ name: '效率研究所', count: 2, share: 2 / 3 }],
        topTags: [{ name: 'AI', count: 2 }],
        topCategories: [{ name: '科技', count: 2 }],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: 'AI',
            displayName: 'Bilimi路AI效率工坊',
            keywords: ['AI', '效率', '工具'],
            count: 2,
            confidence: 'medium' as const,
            reason: 'DeepSeek 认为 AI 与效率工具可以合并成一个工作流收藏夹。',
          }
        ]
      }
    }
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。',
      ledgers: [
        ...createDefaultFavoriteLedgers(),
        { ...createDefaultFavoriteLedgers()[0], id: 'custom-tag-cluster-AI', displayName: 'Bilimi·AI效率工坊', bilibiliFolderId: '9901', isDefault: false }
      ]
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:101'],
      missingTargets: [],
      message: '旧藏整理已完成。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    await screen.findByText(/已扫描 .*可勾选后整理。/)
    await waitFor(() => expect(screen.queryByRole('button', { name: '取消旧藏扫描' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('可执行')).toBeInTheDocument()
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText('待复核')).toBeInTheDocument()
    expect(screen.getByText('已存在')).toBeInTheDocument()
    expect(screen.getByText('跳过来源')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const candidateSection = screen.getByRole('region', { name: '专属收藏夹候选' })
    expect(within(candidateSection).getByText('暂无专属 UP 追更候选。')).toBeInTheDocument()
    const firstCandidateCard = screen.getByLabelText('Bilimi路AI效率工坊').closest('article')!
    expect(firstCandidateCard).toHaveTextContent('AI效率工坊')
    expect(firstCandidateCard).toHaveTextContent('1 条适合')
    expect(screen.getByLabelText('Bilimi路AI效率工坊')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('全选 高频标签收藏夹'))
    expect(screen.getByLabelText('Bilimi路AI效率工坊')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getAllByText('机器学习科普教程')).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Bilimi路AI效率工坊 1 条' })).toBeInTheDocument()
    expect(screen.getByText('标题党软广避雷')).toBeInTheDocument()
    expect(screen.queryByText(/需要复核/)).not.toBeInTheDocument()
    expect(screen.queryByText('已经归档的视频')).not.toBeInTheDocument()
    const knowledgeGroup = screen.getByRole('group', { name: 'Bilimi路知识 1 条' })
    const knowledgeVideo = getPreviewVideoButton(knowledgeGroup, /机器学习科普教程/)
    expect(knowledgeVideo).toHaveAttribute('data-selected', 'true')
    fireEvent.click(getPreviewTargetToggle(knowledgeGroup, /机器学习科普教程/))

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认整理' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    const refreshedKnowledgeGroup = screen.getByRole('group', { name: 'Bilimi路知识 1 条' })
    fireEvent.click(getPreviewTargetToggle(refreshedKnowledgeGroup, /机器学习科普教程/))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledTimes(2))
    expect(onSaveLedgers.mock.invocationCallOrder[1]).toBeLessThan(
      onExecuteOldFavoritePlan.mock.invocationCallOrder[0]
    )
    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'bilimi·影视动漫', enabled: true }),
        expect.objectContaining({
          displayName: 'bilimi·AI效率工坊',
          keywords: ['AI', '效率', '工具'],
          enabled: true,
          isDefault: false
        })
      ])
    )
    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        aid: 101,
        targetLedgerId: 'knowledge',
        targetFolderId: '9001'
      }),
      expect.objectContaining({
        aid: 101,
        targetLedgerId: 'custom-tag-cluster-AI',
        targetFolderId: '9901',
        selectedCandidateTarget: true
      })
    ]))
  })

  it('shows the full old favorite title on hover while preview titles can be truncated', async () => {
    const longTitle =
      '【原神】枫丹七分熟！居鸟哥欣赏至冬新角色，他还是那么爱男角色'
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: longTitle,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏专区',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: []
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const title = screen
      .getByText(longTitle)
      .closest('.favorite-ledger-panel__preview-video-title')
    expect(title).toHaveAttribute('title', longTitle)
  })

  it('syncs missing ledgers before organizing old favorites', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: 'favorite ledgers saved'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers().slice(0, 2)}
        missingLedgerIds={['knowledge']}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledOnce())
    expect(onSaveLedgers.mock.invocationCallOrder[0]).toBeLessThan(
      onScanOldFavorites.mock.invocationCallOrder[0]
    )
    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '整理旧藏' })).toBeInTheDocument()
    expect(screen.queryByText('是否根据旧藏生成你的专属库房？')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('可勾选后整理')
  })

  it('scans old favorites and executes only checked append operations', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 102,
          title: '爆笑鬼畜合集',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:101'],
      missingTargets: [],
      message: '旧藏整理已毕。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByText('机器学习科普教程')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·知识学习 1 条' })).toBeInTheDocument()
    const movieGroup = screen.getByRole('group', { name: 'bilimi·影视动漫 1 条' })
    fireEvent.click(getPreviewTargetToggle(movieGroup, /爆笑鬼畜合集/))
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([preview.items[0]]))
  })

  it('stops old favorite batches when Bilibili protection pauses execution', async () => {
    const preview: FavoriteLedgerPreview = {
      items: [
        {
          aid: 101,
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
          aid: 102,
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
      skippedSourceFolderTitles: []
    }
    markPreviewAsResumableBatch(preview)
    preview.batch!.hasMore = false
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: false,
      steps: ['api:ledger:protection-paused:101'],
      missingTargets: ['favorite-ledger-protection'],
      message:
        'Bilibili may be protecting your account from high-frequency favorite changes. Old favorite organization is paused; wait a while, then continue with the remaining items.',
      paused: true,
      completedCount: 0,
      failedCount: 1,
      remainingCount: 1
    })

    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent(
        '访问受限，已安全停止'
      )
    )
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent(
      '等待 30 分钟后结束本轮并重新扫描'
    )
    expect(screen.queryByRole('button', { name: '继续整理' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '结束本轮' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '扫描概览' }))
    expect(screen.queryByRole('button', { name: '放弃本批' })).not.toBeInTheDocument()
  })

  it('keeps review steps clickable but locks plan edits after execution starts', async () => {
    let resolveExecution!: (value: {
      ok: true
      steps: string[]
      missingTargets: string[]
      completedItems: FavoriteLedgerPreview['items']
      message: string
    }) => void
    const execution = new Promise<Parameters<typeof resolveExecution>[0]>((resolve) => {
      resolveExecution = resolve
    })
    const { container, preview } = await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onExecuteOldFavoritePlan: vi.fn().mockReturnValue(execution)
    })

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(screen.getByRole('button', { name: '暂停整理' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '扫描概览' }))
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByLabelText('整理来源 默认收藏夹，共 2')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toHaveAttribute('aria-current', 'step')

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'DeepSeek 整理' })).toBeDisabled()
    expect(within(getPreviewArticle(container, /AI 效率工具实战/)).getByLabelText('转移 AI 效率工具实战')).toBeDisabled()

    await act(async () => {
      resolveExecution({
        ok: true,
        steps: ['api:ledger:append:701'],
        missingTargets: [],
        completedItems: [preview.items[0]],
        message: 'done'
      })
      await execution
    })
  })

  it('merges multiple targets for one aid into one request and one progress item', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: 'old favorite with two targets',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'knowledge',
              folderId: '9001',
              displayName: 'Bilimi Knowledge',
              keywords: ['knowledge'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'movie-tv',
              folderId: '9002',
              displayName: 'Bilimi Movie',
              keywords: ['movie'],
              alreadyInTarget: false,
              selected: true
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    let resolveExecution: ((value: { ok: boolean; steps: string[]; missingTargets: string[]; completedItems: FavoriteLedgerPreview['items']; message: string }) => void) | undefined
    const execution = new Promise<{ ok: boolean; steps: string[]; missingTargets: string[]; completedItems: FavoriteLedgerPreview['items']; message: string }>(
      (resolve) => {
        resolveExecution = resolve
      }
    )
    const onExecuteOldFavoritePlan = vi.fn().mockReturnValue(execution)

    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__toolbar button')[1])
    await waitFor(() => expect(container.querySelector('.favorite-ledger-panel__old-favorites-guide')).toBeInTheDocument())
    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__guide-steps button')[2])
    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__guide-steps button')[3])
    confirmOldFavoriteExecution()

    await waitFor(() =>
      expect(container.querySelector('.favorite-ledger-panel__old-favorite-progress progress')).toHaveAttribute(
        'value',
        '0'
      )
    )
    expect(container.querySelector('.favorite-ledger-panel__old-favorite-progress progress')).toHaveAttribute(
      'max',
      '1'
    )
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(1)
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([
      expect.objectContaining({ targetLedgerId: 'knowledge' }),
      expect.objectContaining({ targetLedgerId: 'movie-tv' })
    ])

    await act(async () => {
      resolveExecution?.({
        ok: true,
        steps: ['api:ledger:append:101'],
        missingTargets: [],
        completedItems: [
          { ...preview.items[0], targetLedgerId: 'knowledge', targetFolderId: '9001' },
          { ...preview.items[0], targetLedgerId: 'movie-tv', targetFolderId: '9002' }
        ],
        message: 'done'
      })
      await execution
    })

    expect(container.querySelector('.favorite-ledger-panel__old-favorite-progress progress')).toHaveAttribute(
      'value',
      '1'
    )
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce()
  })

  it('pauses after the in-flight item, preserves its success, and leaves the batch pending', async () => {
    const preview = markPreviewAsResumableBatch(createArchivePreviewFixture())
    preview.batch!.hasMore = false
    preview.items[1] = {
      ...preview.items[0],
      aid: 703,
      title: '第二条待整理旧藏'
    }
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    let resolveFirst!: (value: {
      ok: true
      steps: string[]
      missingTargets: string[]
      completedItems: FavoriteLedgerPreview['items']
      message: string
    }) => void
    const firstRequest = new Promise<Parameters<typeof resolveFirst>[0]>((resolve) => {
      resolveFirst = resolve
    })
    const onExecuteOldFavoritePlan = vi.fn().mockReturnValue(firstRequest)
    const onCommitOldFavoriteBatchCheckpoint = vi.fn()
    const onConfirmArchiveProtections = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onCommitOldFavoriteBatchCheckpoint,
      onConfirmArchiveProtections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()
    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: '暂停整理' }))
    expect(screen.getByRole('button', { name: '正在暂停…' })).toBeDisabled()
    await act(async () => {
      resolveFirst({
        ok: true,
        steps: ['api:ledger:append:701'],
        missingTargets: [],
        completedItems: [preview.items[0]],
        message: 'done'
      })
      await firstRequest
    })

    await waitFor(() => expect(screen.getByText('已暂停整理：1 条已完成，1 条剩余；暂停期间不会发送 B 站请求。')).toBeInTheDocument())
    const pausedProgress = screen.getByLabelText('整理旧藏进度').closest('[role="status"]') as HTMLElement
    expect(pausedProgress).toHaveTextContent('整理已暂停 1/2')
    expect(pausedProgress).toHaveTextContent('已完成 1 条，剩余 1 条')
    expect(pausedProgress).toHaveTextContent('暂停期间不会发送 B 站请求')
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce()
    expect(onCommitOldFavoriteBatchCheckpoint).not.toHaveBeenCalled()
    expect(onConfirmArchiveProtections).toHaveBeenCalledWith([
      expect.objectContaining({ aid: preview.items[0].aid })
    ])
    expect(screen.getByRole('button', { name: '继续整理' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '结束本轮' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '扫描概览' }))
    expect(screen.queryByRole('button', { name: '放弃本批' })).not.toBeInTheDocument()
  })

  it('marks an in-flight execution result unknown when the signed-in account changes', async () => {
    const sessionBridge = installOldFavoriteSessionBridge()
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    let resolveExecution!: (value: {
      ok: true
      steps: string[]
      missingTargets: string[]
      completedItems: FavoriteLedgerPreview['items']
      message: string
    }) => void
    const execution = new Promise<Parameters<typeof resolveExecution>[0]>((resolve) => {
      resolveExecution = resolve
    })
    const onConfirmArchiveProtections = vi.fn()
    const onOldFavoriteStageFeedback = vi.fn()
    const { rerender } = render(
      <FavoriteLedgerPanel
        currentAccountMid="42"
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn().mockResolvedValue(preview)}
        onExecuteOldFavoritePlan={vi.fn().mockReturnValue(execution)}
        onConfirmArchiveProtections={onConfirmArchiveProtections}
        onOldFavoriteStageFeedback={onOldFavoriteStageFeedback}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    onOldFavoriteStageFeedback.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()
    await screen.findByRole('button', { name: '暂停整理' })

    rerender(
      <FavoriteLedgerPanel
        currentAccountMid="99"
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn().mockResolvedValue(preview)}
        onExecuteOldFavoritePlan={vi.fn().mockReturnValue(execution)}
        onConfirmArchiveProtections={onConfirmArchiveProtections}
        onOldFavoriteStageFeedback={onOldFavoriteStageFeedback}
      />
    )
    await waitFor(() => expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument())

    await act(async () => {
      resolveExecution({
        ok: true,
        steps: ['api:ledger:append:701'],
        missingTargets: [],
        completedItems: [preview.items[0]],
        message: 'old account completed'
      })
      await execution
    })

    expect(onConfirmArchiveProtections).not.toHaveBeenCalled()
    expect(onOldFavoriteStageFeedback).not.toHaveBeenCalled()
    expect(screen.queryByText('old account completed')).not.toBeInTheDocument()
    expect(sessionBridge.getState().batches).toHaveLength(1)
    expect(sessionBridge.getState().batches[0].segments[0]).toMatchObject({
      status: 'paused',
      task: {
        kind: 'execute',
        status: 'paused',
        requestState: 'result-unknown',
        currentAid: preview.items[0].aid
      }
    })

    rerender(
      <FavoriteLedgerPanel
        currentAccountMid="42"
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn().mockResolvedValue(preview)}
        onExecuteOldFavoritePlan={vi.fn().mockReturnValue(execution)}
        onConfirmArchiveProtections={onConfirmArchiveProtections}
        onOldFavoriteStageFeedback={onOldFavoriteStageFeedback}
      />
    )
    await waitFor(() => expect(
      getOldFavoriteRuntimeValue('oldFavoriteRecoveryRequiresReconciliation', false)
    ).toBe(true))
  })

  it('does not start the frozen execution queue when the account changes during pre-execution sync', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42', totalUniqueVideos: 2, activeSourceFolders: [], protectedVideos: [],
      managedFolders: [], targetMembership: {}, multiArchiveMode: 'off'
    }
    let resolveSave!: (value: { ok: true; steps: string[]; missingTargets: string[]; message: string }) => void
    const save = new Promise<Parameters<typeof resolveSave>[0]>((resolve) => { resolveSave = resolve })
    const onExecuteOldFavoritePlan = vi.fn()
    const onSaveLedgers = vi.fn()
      .mockResolvedValueOnce({ ok: true, steps: [], missingTargets: [], message: 'scan prepared' })
      .mockReturnValueOnce(save)
    const commonProps = {
      ledgers: createDefaultFavoriteLedgers(),
      missingLedgerIds: [],
      onEnsureLedgers: vi.fn(),
      onSaveLedgers,
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan
    }
    const { rerender } = render(<FavoriteLedgerPanel currentAccountMid="42" {...commonProps} />)

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()
    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledTimes(2))

    rerender(<FavoriteLedgerPanel currentAccountMid="99" {...commonProps} />)
    await act(async () => {
      resolveSave({ ok: true, steps: [], missingTargets: [], message: 'old account synced' })
      await save
    })

    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()
    expect(screen.queryByText('old account synced')).not.toBeInTheDocument()
  })

  it('resumes from the next group after an interruptible cooldown and confirms ending a paused batch', async () => {
    const preview = markPreviewAsResumableBatch(createArchivePreviewFixture())
    preview.batch!.hasMore = false
    preview.items[1] = {
      ...preview.items[0],
      aid: 703,
      title: '第二条待整理旧藏'
    }
    let resolveFirst!: (value: {
      ok: true
      steps: string[]
      missingTargets: string[]
      completedItems: FavoriteLedgerPreview['items']
      message: string
    }) => void
    const firstRequest = new Promise<Parameters<typeof resolveFirst>[0]>((resolve) => {
      resolveFirst = resolve
    })
    const onExecuteOldFavoritePlan = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({
        ok: true,
        steps: ['api:ledger:append:703'],
        missingTargets: [],
        completedItems: [preview.items[1]],
        message: 'done'
      })
    const onCommitOldFavoriteBatchCheckpoint = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onCommitOldFavoriteBatchCheckpoint
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()
    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: '暂停整理' }))
    await act(async () => {
      resolveFirst({
        ok: true,
        steps: ['api:ledger:append:701'],
        missingTargets: [],
        completedItems: [preview.items[0]],
        message: 'done'
      })
      await firstRequest
    })
    await screen.findByRole('button', { name: '继续整理' })

    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '继续整理' }))
    expect(screen.getByText('继续整理前正在安全冷却；冷却期间可再次暂停。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '暂停整理' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '继续整理' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '继续整理' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    vi.useRealTimers()
    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(onExecuteOldFavoritePlan).toHaveBeenLastCalledWith([
      expect.objectContaining({ aid: 703 })
    ])
    expect(onCommitOldFavoriteBatchCheckpoint).not.toHaveBeenCalled()

  })

  it('requires confirmation before ending a paused round and preserves its pending checkpoint', async () => {
    const preview = markPreviewAsResumableBatch(createArchivePreviewFixture())
    preview.batch!.hasMore = false
    preview.items[1] = { ...preview.items[0], aid: 703, title: '第二条待整理旧藏' }
    let resolveFirst!: (value: { ok: true; steps: string[]; missingTargets: string[]; completedItems: FavoriteLedgerPreview['items']; message: string }) => void
    const firstRequest = new Promise<Parameters<typeof resolveFirst>[0]>((resolve) => { resolveFirst = resolve })
    const onCommitOldFavoriteBatchCheckpoint = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan: vi.fn().mockReturnValue(firstRequest),
      onCommitOldFavoriteBatchCheckpoint
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()
    await screen.findByRole('button', { name: '暂停整理' })
    fireEvent.click(screen.getByRole('button', { name: '暂停整理' }))
    await act(async () => {
      resolveFirst({ ok: true, steps: [], missingTargets: [], completedItems: [preview.items[0]], message: 'done' })
      await firstRequest
    })

    const progress = screen.getByLabelText('整理旧藏进度').closest('[role="status"]') as HTMLElement
    fireEvent.click(await within(progress).findByRole('button', { name: '结束本轮' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认结束本轮？' })
    expect(dialog).toHaveTextContent('已完成 1 条，剩余 1 条')
    expect(onCommitOldFavoriteBatchCheckpoint).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认结束' }))
    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
    expect(onCommitOldFavoriteBatchCheckpoint).not.toHaveBeenCalled()
  })

  it('keeps real archive execution locked after remount', async () => {
    let resolveExecution!: (value: {
      ok: boolean
      steps: string[]
      missingTargets: string[]
      message: string
    }) => void
    const execution = new Promise<{
      ok: boolean
      steps: string[]
      missingTargets: string[]
      message: string
    }>((resolve) => {
      resolveExecution = resolve
    })
    const onExecuteOldFavoritePlan = vi.fn(() => execution)
    const first = await openArchivePreview({ onExecuteOldFavoritePlan })

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()
    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())

    first.unmount()
    renderPanel({ onExecuteOldFavoritePlan })

    const runningButton = screen.getByRole('button', { name: '整理中' })
    expect(runningButton).toBeDisabled()
    fireEvent.click(runningButton)
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce()

    await act(async () => {
      resolveExecution({
        ok: true,
        steps: ['api:ledger:append:701'],
        missingTargets: [],
        message: 'done'
      })
      await execution
    })
  })

  it('keeps old favorite organization locked until the completion acknowledgement', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: 'old favorite one',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:101'],
      missingTargets: [],
      message: 'done'
    })

    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: '结束本轮' })).toBeInTheDocument())
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent('本次整理已结束')

    fireEvent.click(screen.getByRole('button', { name: '备册' }))
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent('本次整理已结束')

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent('本次整理已结束')
    expect(onScanOldFavorites).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '结束本轮' }))
    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认整理' })).not.toBeInTheDocument()
  })

  it('defaults recommended old favorite ledgers on and previews videos grouped by ledger', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'movie-tv') {
        return { ...ledger, bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      return ledger
    })
    const preview = {
      items: [
        {
          aid: 101,
          title: '影视飓风相机评测',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'movie-tv',
              folderId: '9001',
              displayName: 'bilimi·影视动漫',
              keywords: ['影视'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-author-影视飓风',
              folderId: '',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'author:影视飓风'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'author:影视飓风',
              ledgerId: 'custom-author-影视飓风',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风']
            }
          ]
        },
        {
          aid: 102,
          title: '影视飓风剪辑教程',
          sourceFolderTitle: 'bilimi·待分类',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'movie-tv',
              folderId: '9001',
              displayName: 'bilimi·影视动漫',
              keywords: ['影视'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-author-影视飓风',
              folderId: '',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'author:影视飓风'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'author:影视飓风',
              ledgerId: 'custom-author-影视飓风',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风']
            }
          ]
        },
        {
          aid: 103,
          title: '影视飓风调色教程',
          sourceFolderTitle: 'bilimi·影视飓风追更',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'movie-tv',
              folderId: '9001',
              displayName: 'bilimi·影视动漫',
              keywords: ['影视'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-author-影视飓风',
              folderId: '',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'author:影视飓风'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'author:影视飓风',
              ledgerId: 'custom-author-影视飓风',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [{ name: '影视飓风', count: 3, share: 1 }],
        topTags: [],
        topCategories: [{ name: '影视', count: 2 }],
        sourceFolders: [
          { name: '默认收藏夹', count: 1 },
          { name: 'bilimi·影视飓风追更', count: 4 },
          { name: 'bilimi·待分类', count: 1 }
        ],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'author' as const,
            sourceName: '影视飓风',
            displayName: 'bilimi·影视飓风追更',
            keywords: ['影视飓风'],
            count: 2,
            confidence: 'high' as const,
            reason: '旧藏推荐：2 条旧藏适合归入此收藏夹。',
          }
        ]
      }
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:101'],
      missingTargets: [],
      message: '旧藏整理已毕。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByText('扫描收藏夹')).toBeInTheDocument()
    expect(screen.getByText('用户收藏夹')).toBeInTheDocument()
    expect(screen.getByText('bilimi 工作夹')).toBeInTheDocument()
    expect(screen.queryByLabelText('整理来源 bilimi·影视飓风追更')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('整理来源 bilimi·待分类')).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: 'bilimi·影视飓风追更，已有 4，本轮待整理 0' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: 'bilimi·待分类，已有 1，本轮待整理 1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·影视飓风')).not.toBeChecked()
    expect(screen.queryByLabelText('bilimi·影视动漫')).not.toBeInTheDocument()
    const authorCandidateCard = screen.getByLabelText('bilimi·影视飓风').closest('article')
    expect(authorCandidateCard).toHaveAttribute('title', '影视飓风')
    expect(authorCandidateCard).toHaveTextContent('影视飓风')
    expect(authorCandidateCard).not.toHaveTextContent('bilimi·影视飓风')
    expect(authorCandidateCard).toHaveTextContent('1 条适合')
    expect(authorCandidateCard).not.toHaveTextContent('固定 UP · 固定 UP')
    expect(screen.queryByText('初始收藏夹')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('全选 专属 UP 追更'))
    expect(screen.getByLabelText('bilimi·影视飓风')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const movieGroup = screen.getByRole('group', { name: 'bilimi·影视动漫 1 条' })
    const authorGroup = screen.getByRole('group', { name: 'bilimi·影视飓风追更 1 条' })
    expect(movieGroup).toHaveClass('favorite-ledger-panel__preview-row')
    expect(authorGroup).toHaveClass('favorite-ledger-panel__preview-row')
    const movieTrack = movieGroup.querySelector('.favorite-ledger-panel__preview-videos')
    const authorTrack = authorGroup.querySelector('.favorite-ledger-panel__preview-videos')
    expect(movieTrack).toHaveAttribute('aria-label', 'bilimi·影视动漫 视频')
    expect(authorTrack).toHaveAttribute('aria-label', 'bilimi·影视飓风追更 视频')
    expect(movieTrack?.children).toHaveLength(1)
    expect(authorTrack?.children).toHaveLength(1)
    expect(movieGroup.querySelector('.favorite-ledger-panel__preview-heading')).toBeInTheDocument()
    expect(movieTrack?.querySelector('.favorite-ledger-panel__preview-video-title')).toBeInTheDocument()
    expect(movieGroup.querySelector('.favorite-ledger-panel__preview-heading')).toHaveAttribute(
      'title',
      'bilimi·影视动漫'
    )
    expect(within(movieGroup).getByLabelText('全选 bilimi·影视动漫')).toBeChecked()
    expect(within(authorGroup).getByLabelText('全选 bilimi·影视飓风追更')).toBeChecked()
    expect(getPreviewTargetToggle(movieGroup, /影视飓风相机评测/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getPreviewTargetToggle(authorGroup, /影视飓风相机评测/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(movieGroup).queryByLabelText('整理 影视飓风相机评测 到 bilimi·影视动漫')).not.toBeInTheDocument()
  })

  it('does not fall back unchecked old favorite targets to inbox before executing', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'movie-tv') {
        return { ...ledger, bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      return ledger
    })
    const preview = {
      items: [
        {
          aid: 101,
          title: '影视飓风相机评测',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'movie-tv',
              folderId: '9001',
              displayName: 'bilimi·影视动漫',
              keywords: ['影视'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-author-影视飓风',
              folderId: '',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'author:影视飓风'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'author:影视飓风',
              ledgerId: 'custom-author-影视飓风',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [{ name: '影视飓风', count: 2, share: 1 }],
        topTags: [],
        topCategories: [{ name: '影视', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'author' as const,
            sourceName: '影视飓风',
            displayName: 'bilimi·影视飓风追更',
            keywords: ['影视飓风'],
            count: 2,
            confidence: 'high' as const,
            reason: '旧藏推荐：2 条旧藏适合归入此收藏夹。',
          }
        ]
      }
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn()
    const onOldFavoriteAcknowledged = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: '掌库已同步。' })}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
        onOldFavoriteAcknowledged={onOldFavoriteAcknowledged}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByLabelText('全选 bilimi·影视动漫'))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 0 条归档任务')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()
    await waitFor(() => expect(onOldFavoriteAcknowledged).toHaveBeenCalledOnce())
  })

  it('lets users choose which old favorite source folders to organize from the scan overview', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          sourceFolderTitles: ['默认收藏夹', '旅行收藏'],
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 202,
          title: '东京旅行攻略',
          sourceFolderTitle: '旅行收藏',
          targetLedgerId: 'life-interest',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·生活日常',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [
          { name: '默认收藏夹', count: 1 },
          { name: '旅行收藏', count: 1 }
        ],
        titleSeries: [],
        candidateLedgers: []
      }
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '旧藏整理已毕。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    fireEvent.click(screen.getByLabelText(/^整理来源 默认收藏夹，共 /))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getByText('机器学习科普教程')).toBeInTheDocument()
    expect(screen.getByText('东京旅行攻略')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 2 条归档任务')).toBeInTheDocument()
  })

  it('bulk-selects only healthy user source folders and exposes the partial state', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      sourceFolders: [
        { id: '101', title: '默认收藏夹', videos: [preview.items[0] as never], mediaCount: 1 },
        { id: '102', title: '旅行收藏', videos: [preview.items[1] as never], mediaCount: 1 },
        {
          id: '103',
          title: '失败收藏夹',
          videos: [],
          mediaCount: 3,
          scanFailed: true,
          scanStatus: 'failed',
          scanFailureMessage: 'request timeout'
        },
        { id: '9001', title: 'bilimi·知识学习', videos: [], mediaCount: 1 }
      ],
      activeSourceFolders: [],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    const selectAll = screen.getByRole('checkbox', { name: '全选扫描收藏夹' }) as HTMLInputElement
    expect(selectAll).toBeChecked()
    expect(screen.getByLabelText(/^整理来源 失败收藏夹，共 /)).toBeDisabled()
    expect(screen.queryByLabelText(/^整理来源 bilimi·知识学习，共 /)).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/^整理来源 旅行收藏，共 /))
    expect(selectAll).not.toBeChecked()
    expect(selectAll.indeterminate).toBe(true)

    fireEvent.click(selectAll)
    expect(screen.getByLabelText(/^整理来源 默认收藏夹，共 /)).toBeChecked()
    expect(screen.getByLabelText(/^整理来源 旅行收藏，共 /)).toBeChecked()

    fireEvent.click(selectAll)
    expect(screen.getByLabelText(/^整理来源 默认收藏夹，共 /)).not.toBeChecked()
    expect(screen.getByLabelText(/^整理来源 旅行收藏，共 /)).not.toBeChecked()
  })

  it('reuses and enables a disabled local author ledger when its recommendation is selected again', async () => {
    const disabledLedger: FavoriteLedger = {
      id: 'custom-author-honker233-小王爱马枪',
      displayName: 'bilimi·honker233',
      keywords: ['honker233-小王爱马枪'],
      ruleType: 'author',
      enabled: false,
      priority: 90,
      isDefault: false
    }
    const preview = createArchivePreviewFixture()
    const candidate = {
      id: disabledLedger.id,
      kind: 'author' as const,
      sourceName: 'honker233-小王爱马枪',
      displayName: 'bilimi·honker233-小王爱马枪追更',
      keywords: ['honker233-小王爱马枪'],
      ruleType: 'author' as const,
      count: 2,
      confidence: 'high' as const,
      reason: '作者推荐'
    }
    preview.insights = { ...preview.insights!, candidateLedgers: [candidate] }
    preview.items[0].candidateTargets = [{
      candidateKey: `author:${candidate.sourceName}`,
      ledgerId: disabledLedger.id,
      displayName: disabledLedger.displayName,
      keywords: candidate.keywords,
      ruleType: 'author'
    }]
    preview.items[0].targets = [{
      candidateKey: `author:${candidate.sourceName}`,
      ledgerId: disabledLedger.id,
      folderId: '',
      displayName: disabledLedger.displayName,
      keywords: candidate.keywords,
      ruleType: 'author',
      alreadyInTarget: false,
      selected: false,
      selectedCandidateTarget: true
    }]
    const onSaveLedgers = vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: 'saved' })
    renderPanel({
      ledgers: [...createDefaultFavoriteLedgers(), disabledLedger],
      onSaveLedgers,
      onScanOldFavorites: vi.fn().mockResolvedValue(preview)
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    const recommendation = screen.getByLabelText('bilimi·honker233')
    expect(recommendation).toBeEnabled()
    fireEvent.click(recommendation)
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledTimes(2))
    const saved = onSaveLedgers.mock.calls.at(-1)?.[0] as FavoriteLedger[]
    expect(saved.filter((ledger) => ledger.id === disabledLedger.id)).toEqual([
      expect.objectContaining({ enabled: true, displayName: 'bilimi·honker233' })
    ])
  })

  it('applies selected candidate ledgers to source folders that are re-enabled later', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'Bilimi路AI效率工坊',
              keywords: ['AI']
            }
          ]
        },
        {
          aid: 202,
          title: '旅行 AI 工具',
          sourceFolderTitle: '旅行收藏',
          targetLedgerId: 'life-interest',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·生活日常',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'Bilimi路AI效率工坊',
              keywords: ['AI']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [{ name: 'AI', count: 2 }],
        topCategories: [],
        sourceFolders: [
          { name: '默认收藏夹', count: 1 },
          { name: '旅行收藏', count: 1 }
        ],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: 'AI',
            displayName: 'Bilimi路AI效率工坊',
            keywords: ['AI'],
            count: 2,
            confidence: 'high' as const,
            reason: '旧藏推荐：2 条旧藏适合归入此收藏夹。'
          }
        ]
      }
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByLabelText(/^整理来源 旅行收藏，共 /))
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByLabelText('Bilimi路AI效率工坊'))
    fireEvent.click(screen.getByRole('button', { name: '扫描概览' }))
    fireEvent.click(screen.getByLabelText(/^整理来源 旅行收藏，共 /))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const candidateGroup = screen.getByRole('group', { name: 'Bilimi路AI效率工坊 2 条' })
    expect(candidateGroup).toHaveTextContent('机器学习科普教程')
    expect(candidateGroup).toHaveTextContent('旅行 AI 工具')
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 4 条归档任务')).toBeInTheDocument()
  })

  it('syncs generated ledgers on confirmation and executes selected generated targets', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: 'AI 效率工具实战',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'custom-tag-cluster-AI',
          targetFolderId: '9901',
          targetDisplayName: 'bilimi·AI效率工坊',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          selectedCandidateTarget: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'bilimi·AI效率工坊',
              keywords: ['AI', '效率', '工具']
            }
          ],
          targets: [
            {
              ledgerId: 'custom-tag-cluster-AI',
              folderId: '',
              displayName: 'bilimi·AI效率工坊',
              keywords: ['AI', '效率', '工具'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'tag-cluster:AI'
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: 'AI', count: 1 }],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: 'AI',
            displayName: 'bilimi·AI效率工坊',
            keywords: ['AI', '效率', '工具'],
            count: 1,
            confidence: 'medium' as const,
            reason: '高频标签 AI 适合单独成册。',
          }
        ]
      }
    }
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。',
      ledgers: [
        ...createDefaultFavoriteLedgers(),
        { ...createDefaultFavoriteLedgers()[0], id: 'custom-tag-cluster-AI', displayName: 'bilimi·AI效率工坊', bilibiliFolderId: '9901', isDefault: false }
      ]
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:101'],
      missingTargets: [],
      message: '已归档一条。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·AI效率工坊')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('全选 高频标签收藏夹'))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([
        expect.objectContaining({
          aid: 101,
          targetLedgerId: 'custom-tag-cluster-AI',
          targetFolderId: '9901',
          targetDisplayName: 'bilimi·AI效率工坊',
          selectedCandidateTarget: true
        })
      ])
    )
  })

  it('runs 同步 even when local selections are unchanged', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    expect(await screen.findByRole('status')).toHaveTextContent('掌库已同步。')
  })

  it('shows sync failures instead of failing silently', async () => {
    const onSaveLedgers = vi.fn().mockRejectedValue(new Error('账号同步超时'))

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    expect(await screen.findByRole('status')).toHaveTextContent('同步未完成：账号同步超时')
  })

  it('explains the Bilibili favorite folder limit in Chinese', async () => {
    const onSaveLedgers = vi.fn().mockRejectedValue(
      new Error(
        "Error invoking remote method 'floating-assistant:save-ledgers': Error: BILI_MANAGER_CALL: Error: favorite ledger create failed: 已达到数量上限"
      )
    )

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '同步未完成：收藏夹数量已超过b站上限99个，小咪已经无法再生成更多收藏夹了，主人想继续使用建议适当删除几个哦'
    )
  })

  it('shows a status message while old favorites are scanning', async () => {
    let resolveSave:
      | ((value: { ok: boolean; steps: string[]; missingTargets: string[]; message: string }) => void)
      | undefined
    const savePromise = new Promise<{ ok: boolean; steps: string[]; missingTargets: string[]; message: string }>(
      (resolve) => {
        resolveSave = resolve
      }
    )
    const onSaveLedgers = vi.fn().mockReturnValue(savePromise)
    let resolveScan: (preview: FavoriteLedgerPreview) => void = () => {}
    const onScanOldFavorites = vi.fn(
      () =>
        new Promise<FavoriteLedgerPreview>((resolve) => {
          resolveScan = resolve
        })
    )

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByRole('status')).toHaveTextContent('正在同步整理旧藏需要的主收藏...')
    expect(onScanOldFavorites).not.toHaveBeenCalled()

    await act(async () => {
      resolveSave?.({
        ok: true,
        steps: ['api:ledger:list'],
        missingTargets: [],
        message: 'favorite ledgers saved'
      })
    })

    expect(screen.getByRole('status')).toHaveTextContent('正在扫描旧藏，请稍候。')

    await act(async () => {
      resolveScan({
        items: [],
        skippedSourceFolderTitles: []
      })
    })
  })

  it('shows old favorite scan failures instead of an empty preview', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      ok: false,
      message: '未能读取登录凭据，无法整理旧藏。',
      items: [],
      skippedSourceFolderTitles: []
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '整理旧藏未完成：未能读取登录凭据，无法整理旧藏。'
      )
    )
    expect(screen.queryByText('旧藏预览')).not.toBeInTheDocument()
  })

  it('syncs missing default ledgers before directly organizing old favorites', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'inbox' ? { ...ledger, bilibiliFolderId: undefined } : ledger
    )
    let resolveSave:
      | ((value: { ok: boolean; steps: string[]; missingTargets: string[]; message: string }) => void)
      | undefined
    const savePromise = new Promise<{ ok: boolean; steps: string[]; missingTargets: string[]; message: string }>(
      (resolve) => {
        resolveSave = resolve
      }
    )
    const onSaveLedgers = vi.fn().mockReturnValue(savePromise)
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 601,
          title: 'old favorite needing inbox',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'Bilimi Inbox',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: []
    })

    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={['inbox']}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__toolbar button')[1])

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    expect(onScanOldFavorites).not.toHaveBeenCalled()
    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'inbox', enabled: true, isDefault: true })
      ]),
      { deleteDisabled: false }
    )

    await act(async () => {
      resolveSave?.({
        ok: true,
        steps: ['api:ledger:list', 'api:ledger:create:inbox'],
        missingTargets: [],
        message: 'favorite ledgers saved'
      })
    })

    await waitFor(() =>
      expect(onScanOldFavorites).toHaveBeenCalledWith(
        expect.objectContaining({ multiArchiveMode: 'off' })
      )
    )
  })

  it('syncs the eight default ledgers before organizing even when none are marked missing', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: String(9001 + index)
    }))
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:list'],
      missingTargets: [],
      message: 'favorite ledgers saved'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: []
    })

    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__toolbar button')[1])

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledOnce())
    expect(onSaveLedgers.mock.invocationCallOrder[0]).toBeLessThan(
      onScanOldFavorites.mock.invocationCallOrder[0]
    )
    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining(
        createDefaultFavoriteLedgers().map((ledger) =>
          expect.objectContaining({ id: ledger.id, enabled: true, isDefault: true })
        )
      ),
      { deleteDisabled: false }
    )
  })

  it('shows old favorite insights and lets users add suggested ledgers without AI', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 601,
          title: '稍后整理的旧藏一',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 602,
          title: '稍后整理的旧藏二',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['inbox'],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: [],
      scanDiagnostics: {
        tagDetailRequests: 6,
        tagDetailFailures: 4,
        taggedVideos: 2,
        untaggedVideos: 4
      },
      insights: {
        totalVideos: 6,
        topAuthors: [{ name: '效率研究所', count: 4, share: 4 / 6 }],
        topTags: [
          { name: 'AI', count: 4 },
          { name: '工具', count: 3 }
        ],
        topCategories: [{ name: '科技', count: 4 }],
        sourceFolders: [
          { name: '默认收藏夹', count: 6 },
          { name: 'bilimi·待分类', count: 2 }
        ],
        titleSeries: [{ name: 'AI工具效率教程', count: 4 }],
        candidateLedgers: [
          {
            kind: 'tag-cluster',
            sourceName: 'AI',
            displayName: 'bilimi·AI工具',
            keywords: ['AI', '工具', '效率'],
            count: 4,
            confidence: 'high',
            reason: '高频标签“AI”出现 4 次，适合单独成册。',
          }
        ]
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    const scanOverviewHeading = await screen.findByRole('heading', { name: '扫描概览' })
    const scanOverviewNote = screen.getByText('共扫描 6 条旧藏，生成 1 个候选收藏夹')
    const scanOverviewSection = scanOverviewHeading.closest('section')
    expect(scanOverviewSection).toBeInTheDocument()
    expect(scanOverviewNote).toHaveClass('favorite-ledger-panel__step-note')
    expect(scanOverviewSection).toHaveTextContent(/扫描概览[\s\S]*共扫描 6 条旧藏，生成 1 个候选收藏夹[\s\S]*基础数据/)
    expect(scanOverviewSection?.querySelectorAll('.favorite-ledger-panel__step-divider')).toHaveLength(2)
    expect(await screen.findByText('基础数据')).toBeInTheDocument()
    expect(screen.getByText('标签补取失败 4 条，高频标签候选可能偏少；稍后重扫会更准。')).toBeInTheDocument()
    expect(screen.getByText('未匹配')).toBeInTheDocument()
    expect(screen.queryByText('高频标签候选')).not.toBeInTheDocument()
    expect(screen.queryByText('4 条适合')).not.toBeInTheDocument()
    expect(screen.queryByText('常追 UP')).not.toBeInTheDocument()
    expect(screen.queryByText('分区')).not.toBeInTheDocument()
    expect(screen.getByText('扫描收藏夹')).toBeInTheDocument()
    expect(screen.getByText('用户收藏夹')).toBeInTheDocument()
    expect(screen.getByText('bilimi 工作夹')).toBeInTheDocument()
    const defaultSourceRow = screen.getByRole('row', { name: '默认收藏夹，总数 6' })
    expect(within(defaultSourceRow).getAllByText('6')).toHaveLength(2)
    const bilimiSourceRow = screen.getByRole('row', { name: 'bilimi·待分类，已有 2，本轮待整理 2' })
    expect(within(bilimiSourceRow).getAllByText('2')).toHaveLength(2)
    expect(within(bilimiSourceRow).queryByText('本轮待整理')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    const generatedHeading = screen.getByRole('heading', { name: '推荐收藏夹' })
    const generatedSection = generatedHeading.closest('section')
    expect(generatedSection).toBeInTheDocument()
    expect(generatedSection).toHaveTextContent(
      /推荐收藏夹[\s\S]*确认执行后，会把已勾选候选同步到 B 站收藏夹里。[\s\S]*专属 UP 追更[\s\S]*高频标签收藏夹/
    )
    expect(generatedSection?.querySelectorAll('.favorite-ledger-panel__step-divider')).toHaveLength(2)
    expect(screen.getAllByText('AI工具').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText('bilimi·AI工具')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('全选 高频标签收藏夹'))
    expect(screen.getByLabelText('bilimi·AI工具')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·AI工具',
            keywords: ['AI', '工具', '效率'],
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it('uses selected generated ledgers to preview old favorites instead of leaving them in inbox', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'inbox' ? { ...ledger, bilibiliFolderId: '9008' } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '光影构图入门',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:摄影',
              ledgerId: 'custom-tag-cluster-摄影',
              displayName: 'bilimi·摄影',
              keywords: ['摄影']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: '摄影', count: 1 }],
        topCategories: [{ name: '摄影', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster',
            sourceName: '摄影',
            displayName: 'bilimi·摄影',
            keywords: ['摄影'],
            count: 1,
            confidence: 'medium',
            reason: '摄影相关旧藏适合单独成册。',
          }
        ]
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    expect(screen.getByText('共扫描 1 条旧藏，生成 1 个候选收藏夹')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·摄影')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('全选 高频标签收藏夹'))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const photoGroup = screen.getByRole('group', { name: 'bilimi·摄影 1 条' })
    expect(photoGroup).toBeInTheDocument()
    expect(getPreviewArticle(photoGroup, /光影构图入门/)).toHaveTextContent('来自 未分类')
    expect(screen.getByRole('group', { name: '归档预览改动操作' })).toHaveTextContent(
      '最近批量改动：勾选收藏夹「bilimi·摄影」，移动 1 条'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·待分类 1 条' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))
    expect(screen.queryByRole('group', { name: 'bilimi·摄影 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·暂存 1 条' })).toHaveTextContent('光影构图入门')

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·摄影')).not.toBeChecked()
  })

  it('backs up the top ledger checklist immediately from 备册', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 6,
        topAuthors: [],
        topTags: [{ name: 'AI', count: 4 }],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 6 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster',
            sourceName: 'AI',
            displayName: 'bilimi·AI工具',
            keywords: ['AI', '工具', '效率'],
            count: 4,
            confidence: 'high',
            reason: '高频标签“AI”出现 4 次，适合单独成册。',
          }
        ]
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={['knowledge']}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    const knowledgeTopButton = within(ledgerRegion).getByRole('button', { name: '知识学习' })
    expect(await screen.findByRole('status')).toHaveTextContent(
      '小咪备册已完成，主人可以再增加自己想要的收藏夹，点击同步即可'
    )
    expect(knowledgeTopButton).toHaveAttribute('aria-pressed', 'true')
    expect(within(ledgerRegion).getByRole('button', { name: '生活日常' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'knowledge', enabled: true }),
        expect.objectContaining({ id: 'life-interest', enabled: true })
      ]),
      { deleteDisabled: false }
    )

    expect(within(ledgerRegion).queryByRole('button', { name: 'AI工具' })).not.toBeInTheDocument()
  })

  it('recommends existing unchecked ledgers that match scanned old favorites', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 102,
          title: '深度学习入门路线',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [{ name: '学习', count: 2 }],
        topCategories: [{ name: '知识', count: 2 }],
        sourceFolders: [{ name: '默认收藏夹', count: 2 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={['knowledge']}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    const knowledgeTopButton = within(ledgerRegion).getByRole('button', { name: '知识学习' })
    expect(knowledgeTopButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('bilimi·知识学习')).not.toBeInTheDocument()

    fireEvent.click(within(ledgerRegion).getByLabelText('移出同步 bilimi·知识学习'))

    expect(knowledgeTopButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows preset Bilimi ledgers as selectable recommendations while organizing old favorites', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'life-interest' ? { ...ledger, enabled: false } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '东京旅行攻略',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'life-interest',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·生活日常',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    const travelTopButton = within(ledgerRegion).getByRole('button', { name: '生活日常' })
    expect(travelTopButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('bilimi·生活日常')).not.toBeInTheDocument()

    fireEvent.click(within(ledgerRegion).getByLabelText('移出同步 bilimi·生活日常'))

    expect(travelTopButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows matching old favorite counts for already checked preset ledgers', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '动画分镜教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 102,
          title: '番剧演出解析',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [],
        topCategories: [{ name: '动画', count: 2 }],
        sourceFolders: [{ name: '默认收藏夹', count: 2 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    expect(screen.queryByLabelText('bilimi·影视动漫')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('group', { name: 'bilimi·影视动漫 2 条' })).toBeInTheDocument()
  })

  it('hides suggested category ledgers from generated recommendations', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge' || ledger.id === 'movie-tv') {
        return { ...ledger, enabled: false }
      }
      if (ledger.id === 'game') {
        return { ...ledger, enabled: false, bilibiliFolderId: '9001' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '机器学习入门',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 102,
          title: '影视剪辑教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 103,
          title: '游戏攻略',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·游戏专区',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [],
        topTags: [],
        topCategories: [
          { name: '知识', count: 1 },
          { name: '影视', count: 1 },
          { name: '游戏', count: 1 }
        ],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    expect(screen.queryByRole('table', { name: '推荐分区收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·知识学习')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·影视动漫')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·游戏专区')).not.toBeInTheDocument()
  })

  it('does not show inbox as a generated recommendation or content to split further', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '机器学习入门',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 102,
          title: '暂时无法判断的旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['inbox'],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [],
        topCategories: [{ name: '知识', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 2 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    expect(screen.queryByRole('table', { name: '推荐分区收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·待分类')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '待拆解内容' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '智能补判待分类' })).not.toBeInTheDocument()
  })

  it('does not show preset ledgers as generated recommendations', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '动画分镜教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [],
        topCategories: [{ name: '动画', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    expect(screen.queryByLabelText('bilimi·影视动漫')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·生活日常')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示其他收藏夹' })).not.toBeInTheDocument()
  })

  it('recommends high-frequency tag folders while preserving other matched targets in preview', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'life-interest') {
        return { ...ledger, enabled: false }
      }
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '篮球训练教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'life-interest',
          targetFolderId: '',
          targetDisplayName: 'bilimi·生活日常',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'life-interest',
              folderId: '',
              displayName: 'bilimi·生活日常',
              keywords: ['体育', '篮球'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-tag-cluster-原神',
              folderId: '',
              displayName: 'bilimi·原神',
              keywords: ['原神'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'tag-cluster:原神'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:原神',
              ledgerId: 'custom-tag-cluster-原神',
              displayName: 'bilimi·原神',
              keywords: ['原神']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [{ name: '篮球教练', count: 1, share: 1 }],
        topTags: [{ name: '原神', count: 1 }],
        topCategories: [{ name: '体育', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: '原神',
            displayName: 'bilimi·原神',
            keywords: ['原神'],
            count: 1,
            confidence: 'medium' as const,
            reason: '高频标签“原神”出现 1 次，适合单独成册。',
          }
        ]
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const candidates = screen.getByRole('region', { name: '专属收藏夹候选' })
    expect(within(candidates).getByText('高频标签收藏夹')).toBeInTheDocument()
    expect(within(candidates).getByLabelText('bilimi·原神')).not.toBeChecked()
    expect(within(candidates).queryByLabelText('bilimi·生活日常')).not.toBeInTheDocument()
    expect(within(candidates).queryByLabelText('bilimi·时尚美妆')).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: '推荐分区收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '待拆解内容' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示其他收藏夹' })).not.toBeInTheDocument()
    expect(within(candidates).getByLabelText('bilimi·原神').closest('article')).toHaveTextContent('1 条适合')
    fireEvent.click(within(candidates).getByLabelText('全选 高频标签收藏夹'))
    expect(within(candidates).getByLabelText('bilimi·原神')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('group', { name: 'bilimi·生活日常 1 条' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·原神 1 条' })).toBeInTheDocument()
  })

  it('sorts tag recommendations by matched count, leaves them unchecked, and expands to twenty-four', async () => {
    const tagNames = Array.from({ length: 24 }, (_, index) => `标签${index + 1}`)
    const tagCount = (tagName: string) => {
      if (tagName === '标签8') {
        return 40
      }
      if (tagName === '标签3') {
        return 30
      }
      if (tagName === '标签1') {
        return 20
      }
      return 2
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: tagNames.flatMap((tagName, index) =>
        Array.from({ length: tagCount(tagName) }, (_, countIndex) => ({
          aid: 300000 + index * 100 + countIndex,
          title: `${tagName} 视频 ${countIndex + 1}`,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          candidateTargets: [
            {
              candidateKey: `tag-cluster:${tagName}`,
              ledgerId: `custom-tag-cluster-${tagName}`,
              displayName: `bilimi·${tagName}`,
              keywords: [tagName]
            }
          ]
        }))
      ),
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: tagNames.reduce((total, tagName) => total + tagCount(tagName), 0),
        topAuthors: [],
        topTags: tagNames.map((tagName) => ({ name: tagName, count: tagCount(tagName) })),
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 134 }],
        titleSeries: [],
        candidateLedgers: tagNames.map((tagName) => ({
          kind: 'tag-cluster' as const,
          sourceName: tagName,
          displayName: `bilimi·${tagName}`,
          keywords: [tagName],
          count: 2,
          confidence: 'medium' as const,
          reason: `高频标签“${tagName}”出现 ${tagCount(tagName)} 次，适合单独成册。`,
        }))
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const candidates = screen.getByRole('region', { name: '专属收藏夹候选' })
    expect(within(candidates).getByLabelText('bilimi·标签1')).not.toBeChecked()
    const visibleCandidateNames = within(candidates)
      .getAllByRole('checkbox', { name: /^bilimi·标签/ })
      .map((checkbox) => checkbox.getAttribute('aria-label'))
    expect(visibleCandidateNames.slice(0, 3)).toEqual(['bilimi·标签8', 'bilimi·标签3', 'bilimi·标签1'])
    expect(within(candidates).getByLabelText('bilimi·标签12')).toBeInTheDocument()
    expect(within(candidates).queryByLabelText('bilimi·标签13')).not.toBeInTheDocument()
    expect(within(candidates).getByLabelText('全选 高频标签收藏夹')).not.toBeChecked()
    fireEvent.click(within(candidates).getByLabelText('全选 高频标签收藏夹'))
    await waitFor(() =>
      expect(within(candidates).getByLabelText('全选 高频标签收藏夹')).toBeChecked()
    )
    expect(within(candidates).getByLabelText('bilimi·标签8')).toBeChecked()
    expect(within(candidates).getByLabelText('bilimi·标签12')).toBeChecked()

    fireEvent.click(within(candidates).getByRole('button', { name: '展开更多高频标签' }))

    expect(within(candidates).getByLabelText('bilimi·标签24')).toBeInTheDocument()
    expect(within(candidates).getByLabelText('bilimi·标签24')).toBeChecked()
    expect(within(candidates).getAllByText(/条适合/)).toHaveLength(24)
  })

  it('keeps the old favorite guide instead of rescanning when the ledger panel is reopened', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '动画分镜教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: '动画', count: 1 }],
        topCategories: [{ name: '动画', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')

    fireEvent.click(screen.getByRole('button', { name: '折叠' }))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(onScanOldFavorites).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('group', { name: 'bilimi·影视动漫 1 条' })).toBeInTheDocument()
  })

  it('reports unavailable DeepSeek organization through stage feedback without starting a task', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn()
    const onOldFavoriteStageFeedback = vi.fn()

    await openArchivePreview({
      deepSeekArchiveAvailable: false,
      onOrganizeOldFavoritesWithDeepSeek,
      onOldFavoriteStageFeedback
    })

    const organizeButton = screen.getByRole('button', { name: 'DeepSeek 整理' })
    expect(organizeButton).toBeEnabled()
    expect(screen.getByText('请先到设置开启 DeepSeek 后再使用辅助整理。')).toBeInTheDocument()
    expect(screen.getByText(/将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息/)).toBeInTheDocument()

    fireEvent.click(organizeButton)

    expect(onOldFavoriteStageFeedback).toHaveBeenCalledWith(
      '请先到设置开启 DeepSeek 后再使用辅助整理。'
    )
    expect(onOrganizeOldFavoritesWithDeepSeek).not.toHaveBeenCalled()
  })

  it('uses a compact transfer trigger while keeping full folder names in the menu', async () => {
    const { container } = await openArchivePreview()
    const article = getPreviewArticle(container, /AI 效率工具实战/)
    const transfer = within(article).getByLabelText('转移 AI 效率工具实战')

    expect(transfer).toHaveValue('')
    expect(within(transfer).getByRole('option', { name: 'bilimi·生活日常' })).toBeInTheDocument()

    fireEvent.change(transfer, { target: { value: 'game' } })

    const source = within(getPreviewArticle(container, /AI 效率工具实战/)).getByText(
      '来自 bilimi·知识学习'
    )
    expect(source).toHaveAttribute(
      'title',
      '整理前位置：【bilimi·知识学习】；当前位置：【bilimi·游戏专区】。'
    )
  })

  it('presents DeepSeek organization and archive undo in a combined preview tool', async () => {
    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek: vi.fn()
    })

    const toolCard = screen.getByRole('group', { name: '归档预览辅助工具' })
    expect(toolCard).toHaveClass('favorite-ledger-panel__archive-tool-card')
    expect(toolCard.querySelector('.favorite-ledger-panel__archive-tool-divider')).toBeInTheDocument()

    const deepSeekCard = within(toolCard).getByRole('group', { name: 'DeepSeek 辅助整理' })
    expect(within(deepSeekCard).getByText('DeepSeek 辅助整理')).toBeInTheDocument()
    expect(within(deepSeekCard).getByRole('button', { name: '整理范围' })).toHaveAttribute(
      'title',
      '当前选择：当前分段'
    )
    expect(within(deepSeekCard).getByRole('button', { name: 'DeepSeek 整理' })).toBeInTheDocument()
    expect(
      within(deepSeekCard).getByText(/将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息/)
    ).toBeInTheDocument()

    const undoTools = within(toolCard).getByRole('group', { name: '归档预览改动操作' })
    expect(within(undoTools).getByRole('button', { name: '撤销本次改动' })).toBeInTheDocument()
    expect(within(undoTools).getByRole('button', { name: '恢复本次改动' })).toBeInTheDocument()
    expect(within(undoTools).getByText(/Ctrl\+Z 撤销，Ctrl\+Shift\+Z 恢复/)).toBeInTheDocument()
    expect(Boolean(deepSeekCard.compareDocumentPosition(undoTools) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true
    )
    expect(screen.getByRole('heading', { name: '归档预览' }).closest('.favorite-ledger-panel__preview-topbar')).not.toHaveTextContent(
      'DeepSeek 辅助整理'
    )
  })

  it('keeps DeepSeek archive mode changes local until the user starts organization', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    expect(screen.getByRole('button', { name: '整理范围' })).toHaveAttribute(
      'title',
      '当前选择：当前分段'
    )

    selectDeepSeekArchiveScope('当前分段')
    expect(onOrganizeOldFavoritesWithDeepSeek).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledWith(
      'all',
      expect.objectContaining({
        kind: 'favorite-archive-organize',
        mode: 'all',
        videos: [expect.objectContaining({ aid: 701 }), expect.objectContaining({ aid: 702 })]
      })
    )
  })

  it('sends only unclassified-area videos for DeepSeek archive unclassified-only mode', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    selectDeepSeekArchiveScope('全批未匹配')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledWith(
      'unclassified-only',
      expect.objectContaining({
        mode: 'unclassified-only',
        videos: [expect.objectContaining({ aid: 702 })]
      })
    )
  })

  it('locks archive preview edits and execution while DeepSeek organization is running', async () => {
    let resolveDeepSeek: (result: DeepSeekGenerateResult) => void = () => undefined
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockReturnValue(
      new Promise<DeepSeekGenerateResult>((resolve) => {
        resolveDeepSeek = resolve
      })
    )
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '旧藏已归册。'
    })

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onExecuteOldFavoritePlan
    })

    const originalGroup = screen.getByRole('group', { name: 'bilimi·学吧你就 1 条' })
    const originalVideo = getPreviewVideoButton(originalGroup, /AI 效率工具实战/)
    const originalTargetToggle = getPreviewTargetToggle(originalGroup, /AI 效率工具实战/)

    selectDeepSeekArchiveScope('当前分段')
    selectDeepSeekArchiveScope('当前分段')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    expect(await screen.findByText('DeepSeek 正在整理旧藏...')).toBeInTheDocument()
    expect(originalTargetToggle).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(originalVideo)
    expect(screen.getByRole('group', { name: 'bilimi·学吧你就 1 条' })).toBeInTheDocument()

    const confirmStepButton = screen.getByRole('button', { name: '确认执行' })
    expect(confirmStepButton).toBeDisabled()
    fireEvent.click(confirmStepButton)
    expect(screen.queryByRole('button', { name: '确认整理' })).not.toBeInTheDocument()
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    await act(async () => {
      resolveDeepSeek({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })
  })

  it('locks old favorite guide candidate selection while DeepSeek organization is running', async () => {
    let resolveDeepSeek: (result: DeepSeekGenerateResult) => void = () => undefined
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockReturnValue(
      new Promise<DeepSeekGenerateResult>((resolve) => {
        resolveDeepSeek = resolve
      })
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 801,
          title: 'AI 候选视频',
          author: '效率研究所',
          description: 'AI 工作流拆解。',
          tags: ['AI', '效率'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'bilimi·AI效率工坊',
              keywords: ['AI', '效率']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: 'AI', count: 1 }],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: 'AI',
            displayName: 'bilimi·AI效率工坊',
            keywords: ['AI', '效率'],
            count: 1,
            confidence: 'medium' as const,
            reason: 'AI 标签适合单独成册。'
          }
        ]
      }
    } satisfies FavoriteLedgerPreview)

    renderPanel({
      deepSeekArchiveAvailable: true,
      onScanOldFavorites,
      onOrganizeOldFavoritesWithDeepSeek
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·AI效率工坊')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    selectDeepSeekArchiveScope('当前分段')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    expect(await screen.findByText('DeepSeek 正在整理旧藏...')).toBeInTheDocument()

    const candidateStepButton = screen.getByRole('button', { name: '推荐收藏夹' })
    expect(candidateStepButton).toBeDisabled()
    fireEvent.click(candidateStepButton)
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')

    await act(async () => {
      resolveDeepSeek({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·AI效率工坊')).not.toBeChecked()
  })

  it('shows DeepSeek archive progress across request batches', async () => {
    const resolvers: Array<(result: DeepSeekGenerateResult) => void> = []
    const onOldFavoriteStatusUpdate = vi.fn()
    const onOldFavoriteStageFeedback = vi.fn()
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockImplementation(
      () =>
        new Promise<DeepSeekGenerateResult>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: Array.from({ length: 21 }, (_, index) => ({
        aid: 900 + index,
        title: `待整理旧藏 ${index + 1}`,
        sourceFolderTitle: '默认收藏夹',
        targetLedgerId: 'inbox',
        targetFolderId: '9008',
        targetDisplayName: 'bilimi·暂存',
        reviewRequired: false,
        alreadyInTarget: false,
        selected: false,
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        lowConfidence: true
      })),
      skippedSourceFolderTitles: []
    } satisfies FavoriteLedgerPreview)

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onScanOldFavorites,
      onOrganizeOldFavoritesWithDeepSeek,
      onOldFavoriteStatusUpdate,
      onOldFavoriteStageFeedback
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    expect(screen.getByText('第 1 / 2 批')).toBeInTheDocument()
    expect(screen.getByText(/已完成 0 \/ 21 条/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'DeepSeek 整理进度' })).toHaveAttribute(
      'aria-valuenow',
      '0'
    )
    expect(onOldFavoriteStatusUpdate).toHaveBeenCalledWith({
      label: 'DeepSeek整理 0/21',
      message: 'DeepSeek 正在辅助整理旧藏。',
      tone: 'running'
    })

    await act(async () => {
      resolvers[0]({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledTimes(2))
    expect(screen.getByText('第 2 / 2 批')).toBeInTheDocument()
    expect(screen.getByText(/已完成 20 \/ 21 条/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'DeepSeek 整理进度' })).toHaveAttribute(
      'aria-valuenow',
      '95'
    )
    expect(onOldFavoriteStatusUpdate).toHaveBeenCalledWith({
      label: 'DeepSeek整理 20/21',
      message: 'DeepSeek 正在辅助整理旧藏。',
      tone: 'running'
    })

    await act(async () => {
      resolvers[1]({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    await waitFor(() => expect(screen.getByText(/已完成 21 \/ 21 条/)).toBeInTheDocument())
    expect(screen.getByRole('progressbar', { name: 'DeepSeek 整理进度' })).toHaveAttribute(
      'aria-valuenow',
      '100'
    )
    expect(onOldFavoriteStatusUpdate).toHaveBeenCalledWith({
      label: '整理待确认 21',
      message: 'DeepSeek 整理完成，请确认执行。',
      tone: 'warn'
    })
    expect(onOldFavoriteStageFeedback).toHaveBeenCalledWith('DeepSeek 整理完成，请确认执行')
  })

  it('delivers DeepSeek completion callbacks to the latest remounted panel', async () => {
    let resolveDeepSeek!: (result: DeepSeekGenerateResult) => void
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn(
      () =>
        new Promise<DeepSeekGenerateResult>((resolve) => {
          resolveDeepSeek = resolve
        })
    )
    const staleStageFeedback = vi.fn()
    const latestStageFeedback = vi.fn()
    const staleKeywordSuggestions = vi.fn()
    const latestKeywordSuggestions = vi.fn()
    const first = await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onOldFavoriteStageFeedback: staleStageFeedback,
      onDeepSeekArchiveKeywordSuggestions: staleKeywordSuggestions
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    staleStageFeedback.mockClear()
    first.unmount()
    renderPanel({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onOldFavoriteStageFeedback: latestStageFeedback,
      onDeepSeekArchiveKeywordSuggestions: latestKeywordSuggestions
    })

    await act(async () => {
      resolveDeepSeek({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: [
          {
            id: 'suggestion-after-remount',
            action: 'add-keyword',
            ledgerId: 'knowledge',
            keyword: 'AI 工具',
            reason: '补充常用关键词',
            source: 'deepseek',
            status: 'pending',
            createdAt: '2026-07-12T00:00:00.000Z'
          }
        ]
      })
    })

    await waitFor(() =>
      expect(latestStageFeedback).toHaveBeenCalledWith('DeepSeek 整理完成，请确认执行')
    )
    expect(latestKeywordSuggestions).toHaveBeenCalledOnce()
    expect(staleStageFeedback).not.toHaveBeenCalled()
    expect(staleKeywordSuggestions).not.toHaveBeenCalled()
  })

  it('ignores a stale DeepSeek completion after the runtime account changes', async () => {
    let resolveDeepSeek!: (result: DeepSeekGenerateResult) => void
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn(
      () =>
        new Promise<DeepSeekGenerateResult>((resolve) => {
          resolveDeepSeek = resolve
        })
    )
    const onOldFavoriteStageFeedback = vi.fn()

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onOldFavoriteStageFeedback
    })
    bindOldFavoriteRuntimeAccount('42')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    onOldFavoriteStageFeedback.mockClear()

    act(() => {
      bindOldFavoriteRuntimeAccount('99')
    })
    await act(async () => {
      resolveDeepSeek({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    expect(onOldFavoriteStageFeedback).not.toHaveBeenCalled()
    expect(screen.queryByText(/DeepSeek 整理完成/)).not.toBeInTheDocument()
  })

  it('clears the running status when DeepSeek archive organization fails', async () => {
    const onOldFavoriteStatusUpdate = vi.fn()
    const onDeepSeekArchiveKeywordSuggestions = vi.fn(() => {
      throw new Error('建议列表写入失败')
    })
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [],
      keywordSuggestions: [
        {
          id: 'suggestion-1',
          action: 'add-keyword',
          ledgerId: 'knowledge',
          keyword: 'AI 工具',
          reason: '补充常用关键词',
          source: 'deepseek',
          status: 'pending',
          createdAt: '2026-07-12T00:00:00.000Z'
        }
      ]
    } satisfies DeepSeekGenerateResult)

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onDeepSeekArchiveKeywordSuggestions,
      onOldFavoriteStatusUpdate
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() =>
      expect(onOldFavoriteStatusUpdate).toHaveBeenLastCalledWith({
        label: 'DeepSeek整理失败',
        message: '建议列表写入失败',
        tone: 'error'
      })
    )
    expect(screen.getByText('建议列表写入失败')).toBeInTheDocument()
  })

  it('cancels DeepSeek archive organization after remount before starting the next batch', async () => {
    let resolveFirstBatch!: (result: DeepSeekGenerateResult) => void
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn(
      () =>
        new Promise<DeepSeekGenerateResult>((resolve) => {
          resolveFirstBatch = resolve
        })
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: Array.from({ length: 21 }, (_, index) => ({
        aid: 1200 + index,
        title: `可取消旧藏 ${index + 1}`,
        sourceFolderTitle: '默认收藏夹',
        targetLedgerId: 'inbox',
        targetFolderId: '9008',
        targetDisplayName: 'bilimi·暂存',
        reviewRequired: false,
        alreadyInTarget: false,
        selected: false,
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        lowConfidence: true
      })),
      skippedSourceFolderTitles: []
    } satisfies FavoriteLedgerPreview)

    const first = await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onScanOldFavorites,
      onOrganizeOldFavoritesWithDeepSeek
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    first.unmount()
    const { container } = renderPanel({
      deepSeekArchiveAvailable: true,
      onScanOldFavorites,
      onOrganizeOldFavoritesWithDeepSeek
    })
    expect(
      container.querySelectorAll('.favorite-ledger-panel__deepseek-archive-run-button')
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '取消整理' }))

    expect(screen.getByText('正在取消 DeepSeek 整理...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消中...' })).toBeDisabled()

    await act(async () => {
      resolveFirstBatch({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce()
    expect(await screen.findByText('DeepSeek 整理已取消。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DeepSeek 整理' })).toBeEnabled()
  })

  it('applies DeepSeek archive results with displacement notice and reverts the whole run', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      if (ledger.id === 'movie-tv') {
        return { ...ledger, displayName: 'bilimi·影视', bilibiliFolderId: '9003' }
      }
      return ledger
    })
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 701,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['game', 'movie-tv'],
          keepOriginal: false,
          reason: 'DeepSeek 认为它更像游戏工具。',
          confidence: 0.91,
          lowConfidence: false
        },
        {
          aid: 702,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['game'],
          keepOriginal: false,
          reason: 'DeepSeek 补判为游戏。',
          confidence: 0.86,
          lowConfidence: false
        }
      ],
      keywordSuggestions: []
    } satisfies DeepSeekGenerateResult)

    await openArchivePreview({
      ledgers,
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    expect(screen.getByRole('group', { name: 'bilimi·学吧你就 1 条' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    const gameGroup = await screen.findByRole('group', { name: 'bilimi·游戏 2 条' })
    expect(gameGroup).toHaveTextContent('AI 效率工具实战')
    expect(gameGroup).toHaveTextContent('暂时不知道放哪')
    expect(screen.queryByRole('group', { name: 'bilimi·学吧你就 1 条' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /未匹配到合适分类 0 条/ })).not.toBeInTheDocument()
    const deepSeekMovedVideo = getPreviewVideoButton(gameGroup, /AI 效率工具实战/)
    expect(deepSeekMovedVideo).toHaveAttribute('data-selected', 'true')
    expect(deepSeekMovedVideo).toHaveClass(
      'favorite-ledger-panel__preview-video--deepseek'
    )
    expect(getPreviewArticle(gameGroup, /AI 效率工具实战/)).toHaveTextContent('来自 bilimi·学习')
    expect(getPreviewArticle(gameGroup, /暂时不知道放哪/)).toHaveTextContent('来自 未分类')
    expect(screen.getByRole('group', { name: '归档预览改动操作' })).toHaveTextContent(
      '最近批量改动：DeepSeek 批量整理，移动 2 条'
    )
    expect(screen.getByRole('alert')).toHaveTextContent('超过 1 个目标')

    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·游戏 2 条' })).not.toBeInTheDocument()
  })

  it('explains both applied and unapplied DeepSeek archive results from the whole status line', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 701,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['knowledge'],
          keepOriginal: false,
          reason: '继续归入知识学习。',
          confidence: 0.91,
          lowConfidence: false
        },
        {
          aid: 702,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['未分类'],
          keepOriginal: false,
          reason: '没有明确适合的分类。',
          confidence: 0.6,
          lowConfidence: true
        }
      ],
      keywordSuggestions: []
    } satisfies DeepSeekGenerateResult)

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    const summary = await screen.findByRole('status', { name: 'DeepSeek 整理结果' })
    expect(summary).toHaveTextContent('DeepSeek 整理完成：已应用 1 条，未应用 1 条')
    expect(summary).toHaveAttribute('title', 'DeepSeek 整理完成：已应用 1 条，未应用 1 条')
    const detailsButton = screen.getByRole('button', { name: '查看 DeepSeek 整理结果详情' })
    fireEvent.click(detailsButton)
    const detail = screen.getByRole('region', { name: '本次 DeepSeek 整理结果' })
    expect(detail).toHaveTextContent('本次 DeepSeek 整理结果')
    expect(detail).toHaveTextContent('共处理 2 条视频')
    expect(detail).toHaveTextContent('已采用 DeepSeek 建议并更新归档预览，尚未操作 B 站收藏夹。')
    expect(detail).toHaveTextContent('未采用 DeepSeek 建议，继续保持整理前的归档状态。')
    expect(detail).toHaveTextContent('保持未分类：1 条')
    expect(detailsButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(detailsButton)
    expect(screen.queryByRole('region', { name: '本次 DeepSeek 整理结果' })).not.toBeInTheDocument()
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('resets affected horizontal preview tracks without vertically focusing after DeepSeek moves archive cards', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
        if (ledger.id === 'knowledge') {
          return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
        }
        if (ledger.id === 'game') {
          return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
        }
        return ledger
      })
      const preview = createArchivePreviewFixture()
      preview.items.push({
        aid: 704,
        title: '游戏区保底视频',
        author: '游戏UP',
        description: '保留目标分组。',
        tags: ['游戏'],
        sourceFolderTitle: '默认收藏夹',
        targetLedgerId: 'game',
        targetFolderId: '9002',
        targetDisplayName: 'bilimi·游戏',
        reviewRequired: false,
        alreadyInTarget: false,
        selected: true,
        originalSuggestedLedgerIds: ['game'],
        currentTargetLedgerIds: ['game'],
        selectedTargetLedgerIds: ['game'],
        lowConfidence: false
      })
      const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
      const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize',
        results: [
          {
            aid: 701,
            sourceFolderTitle: '默认收藏夹',
            targetLedgerIds: ['game'],
            keepOriginal: false,
            reason: 'DeepSeek 认为它更像游戏工具。',
            confidence: 0.91,
            lowConfidence: false
          }
        ],
        keywordSuggestions: []
      } satisfies DeepSeekGenerateResult)
      const { container } = renderPanel({
        ledgers,
        deepSeekArchiveAvailable: true,
        onScanOldFavorites,
        onOrganizeOldFavoritesWithDeepSeek
      })

      fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
      await screen.findByRole('region', { name: '整理旧藏向导' })
      fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

      const knowledgeSection = getPreviewArticle(container, /AI 效率工具实战/).closest('section')
      const gameSection = getPreviewArticle(container, /游戏区保底视频/).closest('section')
      expect(knowledgeSection).not.toBeNull()
      expect(gameSection).not.toBeNull()
      const knowledgeTrack = knowledgeSection!.querySelector<HTMLElement>(
        '.favorite-ledger-panel__preview-videos'
      )
      const gameTrack = gameSection!.querySelector<HTMLElement>('.favorite-ledger-panel__preview-videos')
      expect(knowledgeTrack).toBeDefined()
      expect(gameTrack).toBeDefined()
      knowledgeTrack!.scrollLeft = 128
      gameTrack!.scrollLeft = 96

      fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

      const updatedGameGroup = await screen.findByRole('group', { name: 'bilimi·游戏 2 条' })
      expect(updatedGameGroup).toHaveTextContent('AI 效率工具实战')
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(
        getPreviewArticle(container, /AI 效率工具实战/)
          .closest('section')
          ?.querySelector('.favorite-ledger-panel__preview-videos')
      ).toHaveProperty('scrollLeft', 0)
      expect(updatedGameGroup.querySelector('.favorite-ledger-panel__preview-videos')).toHaveProperty(
        'scrollLeft',
        0
      )
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('invalidates the DeepSeek run snapshot after manual archive edits or reset', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      if (ledger.id === 'movie-tv') {
        return { ...ledger, displayName: 'bilimi·影视', bilibiliFolderId: '9003' }
      }
      return ledger
    })
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 702,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['game'],
          keepOriginal: false,
          reason: 'DeepSeek 补判为游戏。',
          confidence: 0.84,
          lowConfidence: false
        }
      ],
      keywordSuggestions: []
    } satisfies DeepSeekGenerateResult)

    await openArchivePreview({
      ledgers,
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    const gameGroup = await screen.findByRole('group', { name: 'bilimi·游戏 1 条' })
    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeEnabled()

    fireEvent.change(within(gameGroup).getByLabelText('转移 暂时不知道放哪'), {
      target: { value: 'movie-tv' }
    })
    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·影视 1 条' })).toHaveTextContent(
      '暂时不知道放哪'
    )

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('group', { name: 'bilimi·游戏 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·影视 1 条' })).toHaveTextContent('暂时不知道放哪')
    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
  })

  it('does not offer DeepSeek old favorite assistance from the scan overview', async () => {
    const plainPreview: FavoriteLedgerPreview = {
      items: [
        {
          aid: 101,
          title: 'AI 效率工具实战',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['inbox'],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: 'AI', count: 1 }],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: []
      }
    }
    const onScanOldFavorites = vi.fn().mockResolvedValueOnce(plainPreview)

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await screen.findByRole('region', { name: '整理旧藏向导' })
    expect(onScanOldFavorites).toHaveBeenCalledWith(
      expect.not.objectContaining({ enhanceWithDeepSeek: expect.anything() })
    )
    expect(screen.queryByRole('button', { name: '智能补判旧藏' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'DeepSeek 整理' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('DeepSeek 辅助整理范围')).not.toBeInTheDocument()
  })

  it('recommends using Bilibili tags as ledger keywords', () => {
    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))

    expect(
      screen.getByText('建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。')
    ).toBeInTheDocument()
  })

  it('shows visible progress before publishing one large archive group move', async () => {
    const preview = createArchivePreviewFixture()
    preview.items = Array.from({ length: 101 }, (_, index) => ({
      ...preview.items[0],
      aid: 9000 + index,
      title: `批量视频 ${index + 1}`,
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      targetDisplayName: 'bilimi·知识学习',
      originalSuggestedLedgerIds: ['knowledge'],
      currentTargetLedgerIds: ['knowledge'],
      selectedTargetLedgerIds: ['knowledge'],
      candidateTargets: [{
        ledgerId: 'knowledge',
        folderId: '9001',
        displayName: 'bilimi·知识学习',
        keywords: [],
        alreadyInTarget: false
      }]
    }))
    preview.insights = {
      ...preview.insights!,
      totalVideos: 101,
      sourceFolders: [{ name: '默认收藏夹', count: 101 }]
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^全选 / }))

    expect(screen.getByRole('status', { name: '批量移动进度' })).toHaveTextContent('正在移动 101 条')
    expect(screen.getByRole('button', { name: '扫描概览' })).toBeEnabled()
    expect(await screen.findByText('已移动 101 条')).toBeInTheDocument()
  })

  it('shows immediate chunked progress while selecting a candidate that affects 350 videos', async () => {
    const preview = createArchivePreviewFixture()
    const candidate = {
      kind: 'tag-cluster' as const,
      sourceName: '批量候选',
      displayName: 'bilimi·批量候选',
      keywords: ['批量候选'],
      count: 350,
      confidence: 'high' as const,
      reason: '高频标签'
    }
    preview.items = Array.from({ length: 350 }, (_, index) => ({
      ...preview.items[0],
      aid: 12000 + index,
      title: `候选批量视频 ${index + 1}`,
      candidateTargets: [{
        ledgerId: 'custom-tag-cluster-批量候选',
        displayName: candidate.displayName,
        keywords: candidate.keywords,
        ruleType: 'tag' as const,
        candidateKey: `tag-cluster:${candidate.sourceName}`,
        alreadyInTarget: false
      }]
    }))
    preview.insights = {
      ...preview.insights!,
      totalVideos: 350,
      candidateLedgers: [candidate],
      sourceFolders: [{ name: '默认收藏夹', count: 350 }]
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByLabelText('bilimi·批量候选'))

    expect(screen.getByRole('status', { name: '批量移动进度' })).toHaveTextContent('正在移动 350 条')
    expect(await screen.findByText('已移动 350 条')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·批量候选')).not.toBeChecked()
  })

  it('blocks Ctrl+Z and Ctrl+Shift+Z while a chunked archive move is running', async () => {
    const preview = createArchivePreviewFixture()
    preview.items = Array.from({ length: 101 }, (_, index) => ({
      ...preview.items[0],
      aid: 13000 + index,
      title: `快捷键批量视频 ${index + 1}`,
      candidateTargets: [{
        ledgerId: 'knowledge',
        folderId: '9001',
        displayName: 'bilimi·知识学习',
        keywords: [],
        alreadyInTarget: false
      }]
    }))
    preview.insights = {
      ...preview.insights!,
      totalVideos: 101,
      sourceFolders: [{ name: '默认收藏夹', count: 101 }]
    }
    const { container } = renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(getPreviewVideoButton(container, /快捷键批量视频 1/))
    fireEvent.click(screen.getByRole('checkbox', { name: /^\u5168\u9009/ }))
    expect(screen.getByRole('status', { name: '批量移动进度' })).toHaveTextContent('正在移动 101 条')

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(document, { key: 'Z', ctrlKey: true, shiftKey: true })

    expect(getPreviewVideoButton(container, /快捷键批量视频 1/)).toHaveAttribute('aria-pressed', 'false')
    expect(await screen.findByText('已移动 101 条')).toBeInTheDocument()
  })

  it('keeps the full author source in the UP-name field while using its account prefix as the recommended name', async () => {
    const preview = createArchivePreviewFixture()
    const candidate = {
      kind: 'author' as const,
      sourceName: 'honker233-小王爱马枪',
      displayName: 'bilimi·honker233-小王爱马枪追更',
      keywords: ['小王爱马枪'],
      count: 1,
      confidence: 'high' as const,
      reason: '作者推荐'
    }
    preview.insights = { ...preview.insights!, candidateLedgers: [candidate] }
    preview.items[0].candidateTargets = [{
      ledgerId: 'custom-author-honker233-小王爱马枪',
      displayName: candidate.displayName,
      keywords: candidate.keywords,
      ruleType: 'author',
      candidateKey: `author:${candidate.sourceName}`,
      alreadyInTarget: false
    }]
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByLabelText('bilimi·honker233'))
    fireEvent.click(screen.getByRole('button', { name: 'honker233' }))

    expect((screen.getByLabelText('UP 名字') as HTMLTextAreaElement).value).toContain('honker233-小王爱马枪')
  })

  it('shows stable unique names for recommended authors that share an account prefix', async () => {
    const preview = createArchivePreviewFixture()
    const candidates = [
      {
        kind: 'author' as const,
        sourceName: 'same-account-beta',
        displayName: 'bilimi·same-account-beta',
        keywords: ['same-account-beta'],
        count: 1,
        confidence: 'high' as const,
        reason: '作者推荐'
      },
      {
        kind: 'author' as const,
        sourceName: 'same-account-alpha',
        displayName: 'bilimi·same-account-alpha',
        keywords: ['same-account-alpha'],
        count: 1,
        confidence: 'high' as const,
        reason: '作者推荐'
      }
    ]
    preview.insights = { ...preview.insights!, candidateLedgers: candidates }
    preview.items[0].candidateTargets = candidates.map((candidate) => ({
      ledgerId: `custom-author-${candidate.sourceName}`,
      displayName: candidate.displayName,
      keywords: candidate.keywords,
      ruleType: 'author' as const,
      candidateKey: `author:${candidate.sourceName}`,
      alreadyInTarget: false
    }))
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    const candidateRegion = screen.getByRole('region', { name: '专属收藏夹候选' })
    const authorNames = within(candidateRegion)
      .getAllByRole('checkbox')
      .map((checkbox) => checkbox.getAttribute('aria-label'))
      .filter((label): label is string => Boolean(label?.startsWith('bilimi·same')))

    expect(authorNames).toHaveLength(2)
    expect(new Set(authorNames)).toHaveLength(2)
  })
})

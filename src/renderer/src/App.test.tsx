import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type {
  AssistantAutomationResult,
  AssistantPreferences,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult
} from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import App, { shouldMountBrowserTab, VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS } from './App'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload
} from './features/assistant/assistantRuntimeTypes'
import type { FavoriteLedgerPreview } from './features/favorites/favoriteLedgerPreview'

const biliWebviewRenderProbe = vi.hoisted(() => ({ count: 0, hostResizePaused: false }))
vi.mock('./features/browser/BiliWebview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./features/browser/BiliWebview')>()
  return {
    ...actual,
    BiliWebview: (props: React.ComponentProps<typeof actual.BiliWebview>) => {
      biliWebviewRenderProbe.count += 1
      biliWebviewRenderProbe.hostResizePaused = props.hostResizePaused ?? false
      return <actual.BiliWebview {...props} />
    }
  }
})

const LEDGER_STATUS_SCRIPT_MARKER = '/x/v3/fav/folder/created/list-all'
const LEDGER_SAVE_SCRIPT_MARKER = '/x/v3/fav/folder/add'
const OLD_FAVORITE_SCAN_SCRIPT_MARKER = '/x/v3/fav/resource/list'
const OLD_FAVORITE_BATCH_STATUS_SCRIPT_MARKER = 'old-favorite-batch-status:v1'
const OLD_FAVORITE_PREPARATION_SCRIPT_MARKER = 'bilimi-old-favorite-preparation'
const VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER = 'pageText: readText'

function isLedgerStatusScript(script: string) {
  return script.includes(LEDGER_STATUS_SCRIPT_MARKER) && script.includes('missingLedgerIds')
}

function emptyLedgerStatus() {
  return {
    ok: true,
    verified: true,
    ledgers: createDefaultFavoriteLedgers(),
    missingLedgerIds: [],
    message: '册目查验已毕。'
  }
}

async function primeProvisionedFavoriteStatus(
  requestRuntime: (request: AssistantRuntimeRequest) => Promise<AssistantRuntimeResponsePayload | undefined>,
  ledgers = createDefaultFavoriteLedgers()
) {
  const webview = document.getElementById('bilimi-webview') as HTMLElement & {
    executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
  }
  const executeJavaScript = webview.executeJavaScript
  if (!executeJavaScript) throw new Error('Test webview script runner is unavailable.')
  const provisionedLedgers = ledgers.map((ledger, index) => ({
    ...ledger,
    bilibiliFolderId: ledger.bilibiliFolderId ?? String(9_000 + index)
  }))
  Object.assign(window.bilimiDesktop, {
    readBilibiliAccountMid: vi.fn().mockResolvedValue('100')
  })
  Object.assign(webview, {
    executeJavaScript: vi.fn((script: string, userGesture?: boolean) =>
      isLedgerStatusScript(script)
        ? Promise.resolve({
            ...emptyLedgerStatus(),
            ledgers: provisionedLedgers,
            backupConflictLedgerIds: []
          })
        : executeJavaScript(script, userGesture)
    )
  })
  await requestRuntime({ id: `prime-provisioned-${Math.random()}`, type: 'snapshot' })
}

function createAppPreferences(
  overrides: Partial<AssistantPreferences> = {}
): AssistantPreferences {
  return {
    favoritesFolderName: 'bilimi 内库',
    favoriteLedgers: createDefaultFavoriteLedgers(),
    ledgerPromptDismissed: true,
    preferenceCounts: {},
    petStyle: 'big-head',
    petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
    showPetAssistantShortcut: true,
    autoShowPetOnStartup: false,
    hidePetDuringVideoFullscreen: false,
    bilibiliOperationMode: 'api-assisted',
    favoriteArchiveMultiMode: 'off',
    defaultCoinCount: 1,
    commentSubmitMode: 'random',
    deepseekEnabled: false,
    deepseekApiKeyStored: false,
    deepseekCommentEnabled: false,
    deepseekAutoSummaryEnabled: false,
    deepseekPetChatEnabled: false,
    deepseekDailyClassificationEnabled: false,
    deepseekDailyClassificationMode: 'all',
    deepseekModel: 'deepseek-v4-flash',
    deepseekBaseUrl: 'https://api.deepseek.com',
    favoriteArchiveStrategy: 'aggressive',
    favoriteCorrectionLearningEnabled: true,
    favoriteCorrectionLearningClassificationEnabled: true,
    favoriteCorrectionRecords: [],
    favoriteKeywordSuggestions: [],
    assistantSidebarWidthPx: null,
    videoAudioTranscriptionThreadLimit: 'unlimited',
    permissionOnboardingCompleted: true,
    ...overrides
  }
}

function renderAppWithRuntimeBridge(apiOverrides: Partial<Window['bilimiDesktop']> = {}) {
  let runtimeHandler:
    | ((request: AssistantRuntimeRequest) => Promise<AssistantRuntimeResponsePayload>)
    | undefined
  let preferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
  let favoriteLedgerEnabledChanged: ((patch: { accountMid: string; ledgerId: string; enabled: boolean }) => void) | undefined
  let openInTab: ((url: string) => void) | undefined
  let favoriteSpaceRefreshStatusChanged: ((status: { accountMid: string; status: 'idle' | 'pending' }) => void) | undefined
  const registerAssistantRuntime = vi.fn(
    (handler: (request: AssistantRuntimeRequest) => Promise<AssistantRuntimeResponsePayload>) => {
      runtimeHandler = handler
      return vi.fn()
    }
  )
  const desktopApi = {
    version: '0.1.0',
    loadPreferences: vi.fn(),
    notifyAssistantSnapshotChanged: vi.fn(),
    onAssistantPreferencesChanged: vi.fn((callback: (preferences: AssistantPreferences) => void) => {
      preferencesChanged = callback
      return vi.fn()
    }),
    onFavoriteLedgerEnabledChanged: vi.fn((callback) => {
      favoriteLedgerEnabledChanged = callback
      return vi.fn()
    }),
    onOpenInTab: vi.fn((callback: (url: string) => void) => {
      openInTab = callback
      return vi.fn()
    }),
    onBilibiliFavoriteSpaceRefreshStatusChanged: vi.fn((callback: (status: { accountMid: string; status: 'idle' | 'pending' }) => void) => {
      favoriteSpaceRefreshStatusChanged = callback
      return vi.fn()
    }),
    setAssistantPetHint: vi.fn(),
    savePreferences: vi.fn(async (preferences: AssistantPreferences) => preferences),
    adoptFavoriteRepositoryLedgerBinding: vi.fn().mockResolvedValue(undefined),
    renameFavoriteRepositoryBoundLedgerShard: vi.fn(async (_accountMid, input) => ({
      shards: [{
        logicalLedgerId: input.logicalLedgerId,
        shardNumber: input.shardNumber,
        remoteFolderId: input.remoteFolderId,
        remoteTitle: input.logicalTitle,
        remoteMemberCount: 0,
        bindingState: 'bound' as const
      }]
    })),
    openFavoriteRepositoryAccount: vi.fn(async (accountMid: string) => ({
      version: 1,
      accountMid,
      revision: 1,
      updatedAt: '2026-09-04T00:00:00.000Z',
      videoCount: 0,
      folderCount: 0,
      folders: [],
      folderCounts: {},
      scopeCounts: {},
      physicalShardCount: 0,
      physicalShards: [],
      syncRecordCount: 0,
      syncCounts: {},
      pendingAidCount: 0,
      remoteReconciliations: []
    })),
    checkpointConfirmedFavoriteReview: vi.fn().mockResolvedValue(undefined),
    commitConfirmedFavoriteReview: vi.fn().mockResolvedValue(undefined),
    registerAssistantRuntime,
    ...apiOverrides
  }

  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: desktopApi
  })

  const renderResult = render(<App />)

  return {
    ...renderResult,
    desktopApi,
    notifyPreferencesChanged: (preferences: AssistantPreferences) => {
      if (!preferencesChanged) {
        throw new Error('Assistant preferences listener was not registered.')
      }

      act(() => {
        preferencesChanged?.(preferences)
      })
    },
    notifyFavoriteLedgerEnabledChanged: (patch: { accountMid: string; ledgerId: string; enabled: boolean }) => {
      if (!favoriteLedgerEnabledChanged) throw new Error('Favorite ledger enabled listener was not registered.')
      act(() => favoriteLedgerEnabledChanged?.(patch))
    },
    openInTab: (url: string) => {
      if (!openInTab) throw new Error('Open-in-tab listener was not registered.')
      act(() => openInTab?.(url))
    },
    notifyFavoriteSpaceRefreshStatusChanged: (status: { accountMid: string; status: 'idle' | 'pending' }) => {
      if (!favoriteSpaceRefreshStatusChanged) throw new Error('Favorite-space refresh listener was not registered.')
      act(() => favoriteSpaceRefreshStatusChanged?.(status))
    },
    requestRuntime: async (request: AssistantRuntimeRequest) => {
      if (!runtimeHandler) {
        throw new Error('Assistant runtime was not registered.')
      }

      let response: AssistantRuntimeResponsePayload | undefined

      await act(async () => {
        response = await runtimeHandler?.(request)
      })

      return response
    },
    requestRuntimeDirect: (request: AssistantRuntimeRequest) => {
      if (!runtimeHandler) {
        throw new Error('Assistant runtime was not registered.')
      }

      return runtimeHandler(request)
    }
  }
}

describe('App runtime integration', () => {
  it('persists normalized preferences after removing orphaned remote drafts at startup', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const orphanedRemoteDraft = {
      id: 'custom-remote-orphan',
      displayName: 'bilimi·历史残留',
      keywords: [],
      enabled: false,
      priority: 90,
      bindingState: 'unbacked' as const,
      syncState: 'local-draft' as const,
      isDefault: false
    }
    const loadedPreferences = createAppPreferences({
      favoriteLedgers: [...createDefaultFavoriteLedgers(), orphanedRemoteDraft]
    })

    renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(loadedPreferences),
      savePreferences
    })

    await waitFor(() => expect(savePreferences).toHaveBeenCalled())
    expect(savePreferences.mock.calls[0]?.[0].favoriteLedgers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: orphanedRemoteDraft.id })])
    )
  })

  it('fails closed without running a Bilibili projection when the available repository summary rejects', async () => {
    const accountMid = '100'
    const ledgers = createDefaultFavoriteLedgers()
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: ledgers }
        }
      })),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockRejectedValue(new Error('repository unavailable'))
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn()
    Object.assign(webview, { executeJavaScript })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await expect(requestRuntime({ id: 'repository-summary-unavailable', type: 'snapshot' })).resolves.toMatchObject({
      favoriteLedgerStatus: {
        ok: false,
        verified: false,
        ledgers,
        message: '收藏库状态暂不可用，请稍后重试。'
      }
    })
    expect(executeJavaScript).not.toHaveBeenCalled()
    expect(savePreferences).not.toHaveBeenCalled()
  })

  it('does not run a full backup when the available repository summary rejects', async () => {
    const accountMid = '100'
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences()),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockRejectedValue(new Error('repository unavailable'))
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (_script: string, userGesture?: boolean) => userGesture
      ? { hasUserId: true, hasCsrf: true }
      : undefined)
    Object.assign(webview, { executeJavaScript })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    savePreferences.mockClear()
    await expect(requestRuntime({ id: 'repository-summary-unavailable-backup', type: 'ensure-ledgers' })).resolves.toMatchObject({
      ok: false,
      missingTargets: ['favorite-repository'],
      message: '收藏库状态暂不可用，请稍后重试。'
    })
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(savePreferences).not.toHaveBeenCalled()
  })

  it('handles ledger-enabled broadcasts through the prebuilt index without invalidating remote status', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
    const effect = source.slice(
      source.indexOf('return window.bilimiDesktop?.onFavoriteLedgerEnabledChanged'),
      source.indexOf('}, [])', source.indexOf('return window.bilimiDesktop?.onFavoriteLedgerEnabledChanged'))
    )

    expect(effect).toContain('applyIndexedFavoriteLedgerEnabledPatch')
    expect(effect).not.toContain('applyFavoriteLedgerEnabledPatch')
    expect(effect).not.toContain('favoriteLedgerStatusCacheRef.current = null')
    expect(effect).not.toContain('setPreferences')
  })

  it('does not pass deleted recommendation remote ids through the single-ledger backup path', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
    const ensureStart = source.indexOf(
      'buildEnsureFavoriteLedgersScript(',
      source.indexOf('const ledgersAfterDirectRename')
    )
    const ensureEnd = source.indexOf('\n      ) as AssistantAutomationResult', ensureStart)
    const ensureCall = source.slice(ensureStart, ensureEnd)

    expect(ensureCall).not.toContain('deletedRecommendationRemoteFolderIds')
  })

  it('suppresses remote-only draft projection for a single-ledger backup', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
    const ensureStart = source.indexOf(
      'buildEnsureFavoriteLedgersScript(',
      source.indexOf('const ledgersAfterDirectRename')
    )
    const ensureEnd = source.indexOf('\n      ) as AssistantAutomationResult', ensureStart)
    const ensureCall = source.slice(ensureStart, ensureEnd)

    expect(ensureCall).toContain('includeRemoteOnlyDrafts: false')
  })

  it('updates a 30k-ledger runtime ref in constant work without rerendering the browser tree', async () => {
    let enabledReads = 0
    const ledgers = Array.from({ length: 30_000 }, (_, index) => {
      let enabled = true
      return {
        id: `ledger-${index}`,
        displayName: `Ledger ${index}`,
        keywords: [],
        priority: index,
        isDefault: false,
        get enabled() {
          enabledReads += 1
          return enabled
        },
        set enabled(next: boolean) {
          enabled = next
        }
      }
    })
    const target = ledgers[29_999]
    const accountMid = '100'
    const preferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: ledgers.map((ledger) => ({ ...ledger })),
          transcriptionModelId: 'whisper-small'
        }
      }
    })
    const { notifyFavoriteLedgerEnabledChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('')
    })
    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await waitFor(() => expect(window.bilimiDesktop.onFavoriteLedgerEnabledChanged).toHaveBeenCalled())
    const rendersBefore = biliWebviewRenderProbe.count
    enabledReads = 0

    notifyFavoriteLedgerEnabledChanged({ accountMid, ledgerId: target.id, enabled: !target.enabled })

    expect(biliWebviewRenderProbe.count).toBe(rendersBefore)
    expect(enabledReads).toBeLessThanOrEqual(2)
    const snapshot = await requestRuntime({ id: 'snapshot-ledger-enabled', type: 'snapshot' })
    expect(snapshot).toMatchObject({
      preferences: {
        favoriteAccountPreferences: {
          [accountMid]: {
            favoriteLedgers: expect.arrayContaining([
              expect.objectContaining({ id: target.id, enabled: !target.enabled })
            ])
          }
        }
      }
    })
  })

  it('pauses browser host resize repaint for the sidebar drag session', async () => {
    renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({ assistantSidebarWidthPx: 360 }))
    })
    const resizeHandle = await screen.findByRole('separator', { name: '调整侧边栏宽度' })

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 91 })
    expect(biliWebviewRenderProbe.hostResizePaused).toBe(true)

    fireEvent.pointerUp(window, { clientX: 100, pointerId: 91 })
    expect(biliWebviewRenderProbe.hostResizePaused).toBe(false)
  })

  it('opens the favorite library drawer inside the browser workspace without moving the assistant sidebar', async () => {
    let openDrawer: ((command: 'toggle' | 'reveal') => void) | undefined
    renderAppWithRuntimeBridge({
      onOpenFavoriteLibraryDrawer: vi.fn((callback: (command: 'toggle' | 'reveal') => void) => {
        openDrawer = callback
        return vi.fn()
      })
    })

    await act(async () => {
      openDrawer?.('reveal')
    })

    const drawer = await screen.findByTestId('favorite-library-drawer')
    expect(drawer.closest('.app-main')).not.toBeNull()
    expect(drawer.closest('.assistant-sidebar')).toBeNull()
  })

  it('toggles an expanded library closed but reveals a collapsed library expanded', async () => {
    let commandDrawer: ((command: 'toggle' | 'reveal') => void) | undefined
    renderAppWithRuntimeBridge({
      onOpenFavoriteLibraryDrawer: vi.fn((callback: (command: 'toggle' | 'reveal') => void) => {
        commandDrawer = callback
        return vi.fn()
      })
    })

    act(() => commandDrawer?.('reveal'))
    const drawer = await screen.findByTestId('favorite-library-drawer')
    expect(drawer).toHaveAttribute('data-collapsed', 'false')

    fireEvent.click(screen.getByRole('button', { name: '收起收藏库' }))
    await waitFor(() => expect(drawer).toHaveAttribute('data-collapsed', 'true'))

    act(() => commandDrawer?.('reveal'))
    expect(drawer).toHaveAttribute('data-collapsed', 'false')

    act(() => commandDrawer?.('toggle'))
    expect(drawer).toHaveAttribute('data-closing', 'true')

    act(() => commandDrawer?.('toggle'))
    expect(drawer).toBeVisible()
    expect(drawer).toHaveAttribute('data-collapsed', 'false')
  })

  it('keeps the real browser webview render boundary stable through drawer collapse transitions', async () => {
    let commandDrawer: ((command: 'toggle' | 'reveal') => void) | undefined
    try {
      renderAppWithRuntimeBridge({
        onOpenFavoriteLibraryDrawer: vi.fn((callback: (command: 'toggle' | 'reveal') => void) => {
          commandDrawer = callback
          return vi.fn()
        })
      })
      act(() => commandDrawer?.('reveal'))
      await screen.findByTestId('favorite-library-drawer')
      const browserRendersBeforeCollapse = biliWebviewRenderProbe.count
      vi.useFakeTimers()

      fireEvent.click(screen.getByRole('button', { name: '\u6536\u8d77\u6536\u85cf\u5e93' }))
      expect(biliWebviewRenderProbe.count).toBe(browserRendersBeforeCollapse)
      act(() => { vi.advanceTimersByTime(220) })
      expect(biliWebviewRenderProbe.count).toBe(browserRendersBeforeCollapse)

      fireEvent.click(screen.getByRole('button', { name: '\u5c55\u5f00\u6536\u85cf\u5e93' }))
      expect(biliWebviewRenderProbe.count).toBe(browserRendersBeforeCollapse)
      act(() => { vi.advanceTimersByTime(16) })
      expect(biliWebviewRenderProbe.count).toBe(browserRendersBeforeCollapse)

      fireEvent.click(screen.getByRole('button', { name: '\u6536\u8d77\u6536\u85cf\u5e93' }))
      fireEvent.click(screen.getByRole('button', { name: '\u6536\u8d77\u6536\u85cf\u5e93' }))
      act(() => { vi.advanceTimersByTime(220) })
      expect(biliWebviewRenderProbe.count).toBe(browserRendersBeforeCollapse)
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers only the production home webview until its initial activation', () => {
    expect(shouldMountBrowserTab('home', false, false)).toBe(false)
    expect(shouldMountBrowserTab('home', true, false)).toBe(true)
    expect(shouldMountBrowserTab('video-1', false, false)).toBe(true)
    expect(shouldMountBrowserTab('home', false, true)).toBe(true)
  })

  it('returns an explicit target descriptor only when binding the active Bilibili page', async () => {
    const app = renderAppWithRuntimeBridge()
    const webview = document.querySelector('webview') as Electron.WebviewTag
    Object.assign(webview, {
      getWebContentsId: () => 101,
      executeJavaScript: vi.fn().mockResolvedValue('100')
    })
    act(() => webview.dispatchEvent(new Event('did-start-navigation')))

    await expect(app.requestRuntime({
      id: 'bind-target', type: 'favorite-repository-bind-page-target', accountMid: '100', runId: 'run-1'
    })).resolves.toMatchObject({
      status: 'ok', observedAccountMid: '100', target: { webContentsId: 101, navigationEpoch: 1 }
    })
  })

  it('binds an already loaded active Bilibili page when dom-ready was missed', async () => {
    const app = renderAppWithRuntimeBridge()
    const webview = document.querySelector('webview') as Electron.WebviewTag
    Object.assign(webview, {
      getWebContentsId: () => 101,
      executeJavaScript: vi.fn().mockResolvedValue('100')
    })

    // Electron can finish loading before React attaches its dom-ready listener on app restart.
    act(() => webview.dispatchEvent(new Event('did-finish-load')))

    await expect(app.requestRuntime({
      id: 'bind-loaded-target', type: 'old-favorite-workspace-bind-scan-target', accountMid: '100'
    })).resolves.toMatchObject({
      status: 'ok', observedAccountMid: '100', target: { webContentsId: 101, navigationEpoch: 0 }
    })
  })

  it('rehydrates the active Bilibili page target when every load event was missed', async () => {
    const app = renderAppWithRuntimeBridge()
    const webview = document.querySelector('webview') as Electron.WebviewTag
    Object.assign(webview, {
      getWebContentsId: () => 101,
      executeJavaScript: vi.fn().mockResolvedValue('100')
    })

    // A restored guest can expose its id after the one-shot fallback and after
    // both load events have completed. Binding must still remain active-tab only.
    await expect(app.requestRuntime({
      id: 'rehydrate-missed-target', type: 'favorite-repository-bind-page-target', accountMid: '100', runId: 'run-1'
    })).resolves.toMatchObject({
      status: 'ok', observedAccountMid: '100', target: {
        webContentsId: 101,
        instanceId: webview.getAttribute('data-favorite-repository-instance-id'),
        navigationEpoch: 0
      }
    })
  })

  it('reports an unavailable bound Bilibili target as unknown without selecting another tab', async () => {
    const app = renderAppWithRuntimeBridge()

    await expect(app.requestRuntime({
      id: 'page-operation',
      type: 'favorite-repository-page-operation',
      accountMid: '100',
      runId: 'run-1',
      target: { webContentsId: 101, instanceId: 'missing', navigationEpoch: 0 },
      action: 'append',
      input: { accountMid: '100', operationKey: 'append-1', aid: 1, folderIds: ['11'] }
    })).resolves.toMatchObject({ status: 'unknown', reason: 'target-unavailable' })
  })

  it('runs only the fixed inventory command against the explicitly bound active target', async () => {
    const app = renderAppWithRuntimeBridge()
    const webview = document.querySelector('webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce({
        status: 'ok', observedAccountMid: '100',
        folders: [{ id: '11', title: 'Bilimi Inbox', mediaCount: 0 }]
      })
    Object.assign(webview, { getWebContentsId: () => 101, executeJavaScript })
    act(() => webview.dispatchEvent(new Event('did-start-navigation')))
    const binding = await app.requestRuntime({
      id: 'bind-scan', type: 'old-favorite-workspace-bind-scan-target', accountMid: '100'
    })
    if (!binding || typeof binding !== 'object' || !('target' in binding) || !binding.target) throw new Error('missing scan target')

    await expect(app.requestRuntime({
      id: 'inventory', type: 'old-favorite-workspace-inventory', accountMid: '100', target: binding.target
    })).resolves.toMatchObject({ status: 'ok', folders: [{ id: '11', mediaCount: 0 }] })
    expect(executeJavaScript.mock.calls[1][0]).toContain('scan-workspace-inventory')
  })

  it('runs one bounded source-page command against the already bound active target', async () => {
    const app = renderAppWithRuntimeBridge()
    const webview = document.querySelector('webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce({
        status: 'ok', observedAccountMid: '100',
        items: [{ aid: 1, title: 'Video', upperName: 'UP', cover: '', addedAt: 0, unavailable: false }], hasMore: false
      })
    Object.assign(webview, { getWebContentsId: () => 101, executeJavaScript })
    act(() => webview.dispatchEvent(new Event('did-start-navigation')))
    const binding = await app.requestRuntime({
      id: 'bind-source-page', type: 'old-favorite-workspace-bind-scan-target', accountMid: '100'
    })
    if (!binding || typeof binding !== 'object' || !('target' in binding) || !binding.target) throw new Error('missing scan target')

    await expect(app.requestRuntime({
      id: 'source-page', type: 'old-favorite-workspace-read-source-page', accountMid: '100',
      target: binding.target, folderId: '11', page: 1, pageSize: 50
    })).resolves.toMatchObject({ status: 'ok', items: [{ aid: 1 }], hasMore: false })
    expect(executeJavaScript.mock.calls[1][0]).toContain('scan-workspace-source-page')
  })

  it('keeps scanning through the explicitly bound Bilibili tab after the user switches tabs', async () => {
    const app = renderAppWithRuntimeBridge()
    const homeWebview = document.querySelector('webview') as Electron.WebviewTag
    const homeExecute = vi.fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce({
        status: 'ok', observedAccountMid: '100', items: [], hasMore: false
      })
    Object.assign(homeWebview, { getWebContentsId: () => 101, executeJavaScript: homeExecute, isLoading: () => false })
    act(() => homeWebview.dispatchEvent(new Event('did-start-navigation')))
    const binding = await app.requestRuntime({
      id: 'bind-background-scan', type: 'old-favorite-workspace-bind-scan-target', accountMid: '100'
    })
    if (!binding || typeof binding !== 'object' || !('target' in binding) || !binding.target) throw new Error('missing scan target')

    act(() => homeWebview.dispatchEvent(new CustomEvent('new-window', {
      detail: { url: 'https://www.bilibili.com/video/BV1active' }
    })))
    const activeWebview = document.querySelector('webview[data-active="true"]') as Electron.WebviewTag
    Object.assign(activeWebview, {
      getWebContentsId: () => 202,
      executeJavaScript: vi.fn().mockResolvedValue('100'),
      isLoading: () => false
    })
    act(() => activeWebview.dispatchEvent(new Event('did-start-navigation')))

    await expect(app.requestRuntime({
      id: 'background-source-page', type: 'old-favorite-workspace-read-source-page', accountMid: '100',
      target: binding.target, folderId: '11', page: 1, pageSize: 20
    })).resolves.toMatchObject({ status: 'ok', items: [], hasMore: false })
    expect(homeExecute.mock.calls[1][0]).toContain('scan-workspace-source-page')
  })

  it('shows first-launch permission guidance without running diagnostics', async () => {
    const firstRunPreferences = createAppPreferences({ permissionOnboardingCompleted: false })
    const runStartupDiagnostics = vi.fn()
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)

    renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(firstRunPreferences),
      runStartupDiagnostics,
      savePreferences
    })

    expect(await screen.findByRole('heading', { name: '启动前权限检查' })).toBeInTheDocument()
    expect(document.querySelector('webview')).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: '打开 bilimi' })).not.toBeDisabled()
    expect(screen.queryByText('权限说明')).not.toBeInTheDocument()
    expect(screen.queryByText('网络检测')).not.toBeInTheDocument()
    expect(screen.queryByText('进入应用')).not.toBeInTheDocument()
    expect(screen.queryByText('检测中')).not.toBeInTheDocument()
    expect(screen.queryByText(/开始检测会尝试访问网络/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '启动诊断结果' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开 bilimi' }))

    expect(runStartupDiagnostics).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ permissionOnboardingCompleted: true })
      )
    )
    expect(await screen.findByRole('tablist', { name: '网页标签' })).toBeInTheDocument()
  })

  it('renders the browser shell with the in-window assistant sidebar', async () => {
    renderAppWithRuntimeBridge()

    expect(document.querySelector('.seal-button')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '札记' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '掌库' })).toBeInTheDocument()
    expect(window.bilimiDesktop.registerAssistantRuntime).toHaveBeenCalled()
  })

  it('shows the browser operation bar even when there is only one tab', async () => {
    renderAppWithRuntimeBridge()

    expect(screen.getByRole('tablist', { name: '网页标签' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '首页' })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-tabs-visible', 'true')
    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
  })

  it('refreshes the active browser webview from the fixed toolbar control', async () => {
    renderAppWithRuntimeBridge()
    await screen.findByRole('tab', { name: '批阅' })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      reload?: () => void
    }
    const reload = vi.fn()
    Object.assign(webview, { reload })

    fireEvent.click(screen.getByRole('button', { name: '刷新当前网页' }))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('refreshes only the bound favorite status when the active page is this account’s B站收藏夹', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const { desktopApi } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [game] }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh: vi.fn().mockResolvedValue({ status: 'idle' as const })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      reload?: () => void
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const reload = vi.fn()
    const executeJavaScript = vi.fn(async (script: string) => {
      if (!isLedgerStatusScript(script)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      expect(script).toContain('"includeRemoteOnlyDrafts":true')
      return { ...emptyLedgerStatus(), ledgers: [game] }
    })
    Object.assign(webview, { reload, executeJavaScript })
    await act(async () => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: `https://space.bilibili.com/${accountMid}/favlist` }
      }))
      await Promise.resolve()
    })
    ;(desktopApi.notifyAssistantSnapshotChanged as ReturnType<typeof vi.fn>).mockClear()

    fireEvent.click(screen.getByRole('button', { name: '刷新当前网页' }))

    expect(reload).not.toHaveBeenCalled()
    await waitFor(() => expect(desktopApi.retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith(accountMid))
    await waitFor(() => expect(executeJavaScript).toHaveBeenCalled())
    expect(executeJavaScript.mock.calls.some(([script]) => String(script).includes('api:ledger:create:'))).toBe(false)
    expect(executeJavaScript.mock.calls.some(([script]) => String(script).includes('已绑定收藏夹改名预检'))).toBe(false)
    await waitFor(() => expect(desktopApi.notifyAssistantSnapshotChanged).toHaveBeenCalled())
  })

  it('hydrates an active video snapshot with its page author only until the cache is complete', async () => {
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue('')
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 1,
          cid: 2,
          bvid: 'BV1cached',
          title: '缓存中的活动视频',
          author: '林簌SUSU'
        }
      }

      return null
    })
    Object.assign(webview, { executeJavaScript })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1cached' }
        })
      )
      webview.dispatchEvent(
        new CustomEvent('page-title-updated', {
          detail: { title: '缓存中的活动视频 - 哔哩哔哩' }
        })
      )
    })

    const snapshot = await requestRuntime({ id: 'snapshot-1', type: 'snapshot' })

    expect(snapshot).toEqual(
      expect.objectContaining({
        activeTabUrl: 'https://www.bilibili.com/video/BV1cached',
        videoTitle: '缓存中的活动视频',
        videoContentContext: expect.objectContaining({
          title: '缓存中的活动视频',
          author: '林簌SUSU'
        })
      })
    )

    await requestRuntime({ id: 'snapshot-2', type: 'snapshot' })

    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER),
      true
    )
  })

  it('refreshes the assistant snapshot account from the authoritative desktop cookie reader', async () => {
    const readBilibiliAccountMid = vi.fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('200')
    const { requestRuntime } = renderAppWithRuntimeBridge({ readBilibiliAccountMid })

    await expect(requestRuntime({ id: 'snapshot-login', type: 'snapshot' }))
      .resolves.toEqual(expect.objectContaining({ accountMid: '100' }))
    await expect(requestRuntime({ id: 'snapshot-logout', type: 'snapshot' }))
      .resolves.toEqual(expect.objectContaining({ accountMid: '' }))
    await expect(requestRuntime({ id: 'snapshot-switch', type: 'snapshot' }))
      .resolves.toEqual(expect.objectContaining({ accountMid: '200' }))
    expect(readBilibiliAccountMid).toHaveBeenCalledTimes(3)
  })

  it('keeps the assistant snapshot signed out when B站 has no current account', async () => {
    const loadPreferences = vi.fn().mockResolvedValue(createAppPreferences({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [{
            id: 'custom-unbacked', displayName: 'bilimi·本地', keywords: [], enabled: false,
            priority: 10, isDefault: false, ruleOrigin: 'saved-rule', bindingState: 'unbacked'
          }]
        }
      }
    }))
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue('')
    })

    await waitFor(() => expect(loadPreferences).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('设置')).toBeInTheDocument())

    await expect(requestRuntime({ id: 'snapshot-signed-out-sole-local-account', type: 'snapshot' }))
      .resolves.toEqual(expect.objectContaining({ accountMid: '', localFavoriteToggleAccountMid: '100' }))
  })

  it('does not guess a local favorite account after B站 signs out when multiple accounts exist', async () => {
    const loadPreferences = vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] },
          '200': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] }
        }
      }))
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue('')
    })

    await waitFor(() => expect(loadPreferences).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('设置')).toBeInTheDocument())

    await expect(requestRuntime({ id: 'snapshot-signed-out-multiple-local-accounts', type: 'snapshot' }))
      .resolves.toEqual(expect.objectContaining({ accountMid: '' }))
  })

  it('clears a stale snapshot account when the authoritative reader rejects', async () => {
    const readBilibiliAccountMid = vi.fn()
      .mockResolvedValueOnce('100')
      .mockRejectedValueOnce(new Error('cookie unavailable'))
    const { requestRuntime } = renderAppWithRuntimeBridge({ readBilibiliAccountMid })

    await requestRuntime({ id: 'snapshot-before-reader-failure', type: 'snapshot' })
    await expect(requestRuntime({ id: 'snapshot-after-reader-failure', type: 'snapshot' }))
      .resolves.toEqual(expect.objectContaining({ accountMid: '' }))
  })

  it('prefers the active browser tab title when page extraction returns a stale video title', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) {
          return emptyLedgerStatus()
        }

        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            title: '你已经是一个成熟的玩家了，要学会自己更新游戏',
            pageText: '当前页面文字仍然来自旧视频。'
          }
        }

        return null
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('page-title-updated', {
          detail: {
            title: '【怒九】这是我玩过最恐怖的小游戏！！ - 哔哩哔哩'
          }
        })
      )
    })

    const snapshot = await requestRuntime({ id: 'snapshot-title-1', type: 'snapshot' })

    expect(snapshot).toEqual(
      expect.objectContaining({
        videoTitle: '【怒九】这是我玩过最恐怖的小游戏！！',
        videoContentContext: expect.objectContaining({
          title: '【怒九】这是我玩过最恐怖的小游戏！！'
        })
      })
    )
  })

  it('returns the new active tab title when the assistant reloads immediately after a title event', async () => {
    const { desktopApi, requestRuntimeDirect } = renderAppWithRuntimeBridge()
    await act(async () => undefined)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) {
          throw new Error('skip ledger status in immediate snapshot test')
        }

        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            title: '上一条视频标题',
            pageText: '页面提取结果还没有跟上标题变化。'
          }
        }

        return null
      })
    })

    let snapshotFromImmediateReload: AssistantRuntimeResponsePayload | undefined
    let immediateReload: Promise<void> | undefined
    ;(desktopApi.notifyAssistantSnapshotChanged as ReturnType<typeof vi.fn>).mockImplementation(() => {
      immediateReload = requestRuntimeDirect({
        id: 'snapshot-title-immediate',
        type: 'snapshot'
      }).then((snapshot) => {
        snapshotFromImmediateReload = snapshot
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('page-title-updated', {
          detail: {
            title: '我们成立团队了！ - 哔哩哔哩'
          }
        })
      )
    })
    await immediateReload

    expect(snapshotFromImmediateReload).toEqual(
      expect.objectContaining({
        videoTitle: '我们成立团队了！',
        videoContentContext: expect.objectContaining({
          title: '我们成立团队了！'
        })
      })
    )
  })

  it('reads the current video time through the assistant runtime', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn().mockResolvedValueOnce(42.5)
    Object.assign(webview, { executeJavaScript })

    await expect(
      requestRuntime({
        id: 'time-1',
        type: 'get-current-video-time'
      } as AssistantRuntimeRequest)
    ).resolves.toBe(42.5)
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('currentTime'), true)
  })

  it('seeks the current video through the assistant runtime', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn().mockResolvedValueOnce(true)
    Object.assign(webview, { executeJavaScript })

    await expect(
      requestRuntime({
        id: 'seek-1',
        type: 'seek-video-time',
        seconds: 88
      } as AssistantRuntimeRequest)
    ).resolves.toBe(true)
    expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('currentTime = 88'),
      true
    )
  })

  it('runs floating assistant actions through the active webview and saves preferences', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const commitFavoriteRepositoryCommand = vi.fn()
    const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge({
      savePreferences,
      commitFavoriteRepositoryCommand
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      sendInputEvent?: (event: Record<string, unknown>) => void
    }
    const sentEvents: Record<string, unknown>[] = []
    const visualFrames = [
      [{ text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 }],
      [{ text: '+ 新建收藏夹', x: 120, y: 420, width: 140, height: 32 }],
      [{ text: '收藏夹名称', x: 120, y: 260, width: 180, height: 36 }],
      [{ text: '创建', x: 240, y: 340, width: 80, height: 32 }],
      [
        { text: 'bilimi·见闻增广', x: 120, y: 470, width: 180, height: 32 },
        { text: '确定', x: 250, y: 620, width: 120, height: 40 }
      ]
    ]
    let visualFrameIndex = 0
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 101,
          bvid: 'BV1action',
          author: '识别到的 UP 主',
          tags: ['动作'],
          title: '三分钟讲清机器学习科普教程',
          pageText: '从原理到入门路线，适合学习收藏。'
        }
      }

      if (script.includes('/x/v3/fav/resource/deal')) {
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          message: '已用 B 站接口归入 bilimi 收藏夹。'
        }
      }

      if (script.includes('modalClassName') && script.includes('containers')) {
        return { containers: [], moved: false }
      }

      if (script.includes('__bilimiFavoriteFocusPoint')) {
        return true
      }

      if (script.includes('__bilimiVisualTextBoxes')) {
        const boxes = visualFrames[Math.min(visualFrameIndex, visualFrames.length - 1)]
        visualFrameIndex += 1
        return { boxes }
      }

      return {
        ok: true,
        steps: ['favorite:open', 'favorite:folder', 'favorite'],
        missingTargets: [],
        message: '已按内容归入内库。'
      }
    })
    Object.assign(webview, {
      executeJavaScript,
      sendInputEvent: vi.fn((event: Record<string, unknown>) => {
        sentEvents.push(event)
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1action'
          }
        })
      )
    })

    const result = await requestRuntime({
      id: 'run-1',
      type: 'run-action',
      action: '藏',
      options: { pageClickOnly: true }
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(result).toEqual(
      expect.objectContaining({
        steps: expect.arrayContaining(['favorite:open', 'favorite:folder', 'favorite'])
      })
    )
    desktopApi.transcribeCurrentVideoAudio = vi.fn().mockResolvedValue({
      transcriptSource: 'audio', transcript: [{ start: 0, end: 1, text: 'shared context transcript' }]
    })
    const note = await requestRuntime({ id: 'note-shared-context', type: 'generate-video-note-from-audio' })
    expect(note).toEqual(expect.objectContaining({ source: expect.objectContaining({ author: '识别到的 UP 主', bvid: 'BV1action' }) }))
    expect(executeJavaScript.mock.calls.filter(([script]) => String(script).includes('looksLikeSubtitleUrl'))).toHaveLength(0)
    await waitFor(() =>
      expect(executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('"targetLedgerId":"knowledge"')
      )
    )
    expect(
      executeJavaScript.mock.calls.some(([script]) =>
        script.includes('/x/v3/fav/resource/deal') && script.includes('bilimi·见闻增广')
      )
    ).toBe(false)
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ keyCode: 'e', type: 'keyDown' }))
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        preferenceCounts: expect.objectContaining({
          knowledge: 1
        })
      })
    )
    expect(commitFavoriteRepositoryCommand).not.toHaveBeenCalled()
  })

  it('keeps unprovisioned review favorites local to the current action and never backfills them after provisioning', async () => {
    const commitFavoriteRepositoryCommand = vi.fn().mockResolvedValue(undefined)
    const preferences = createAppPreferences()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      commitFavoriteRepositoryCommand
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 700,
          bvid: 'BV1review700',
          title: '尚未备册的视频',
          pageText: '游戏攻略'
        }
      }

      if (script.includes('/x/v3/fav/resource/deal') || script.includes('/x/v3/fav/folder/add')) {
        return {
          ok: true,
          steps: ['unexpected:favorite-write'],
          missingTargets: [],
          message: '不应执行收藏写入。'
        }
      }

      return {
        ok: true,
        steps: script.includes('"action":"赐"')
          ? ['like', 'coin:open', 'coin:1', 'coin:confirm']
          : ['like'],
        missingTargets: [],
        message: '非收藏动作已完成。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1review700' }
        })
      )
    })

    await expect(
      requestRuntime({ id: 'unprovisioned-reward', type: 'run-action', action: '赏' })
    ).resolves.toMatchObject({ ok: true, steps: expect.arrayContaining(['like']) })
    await expect(
      requestRuntime({ id: 'unprovisioned-grant', type: 'run-action', action: '赐' })
    ).resolves.toMatchObject({ ok: true, steps: expect.arrayContaining(['coin:confirm']) })

    expect(
      executeJavaScript.mock.calls.some(([script]) =>
        String(script).includes('/x/v3/fav/resource/deal') || String(script).includes('/x/v3/fav/folder/add')
      )
    ).toBe(false)
    expect(commitFavoriteRepositoryCommand).not.toHaveBeenCalled()

    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)
    expect(commitFavoriteRepositoryCommand).not.toHaveBeenCalled()
    expect(
      executeJavaScript.mock.calls.some(([script]) => String(script).includes('/x/v3/fav/resource/deal'))
    ).toBe(false)
  })

  it('keeps a locally unbound target out of Bilibili even when the cached status was provisioned', async () => {
    const preferences = createAppPreferences({
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) =>
        ledger.id === 'knowledge'
          ? { ...ledger, keywords: ['国际尬聊'], bilibiliFolderId: '91000001', bindingState: 'unbound' }
          : ledger
      )
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100')
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        return {
          ok: true,
          verified: true,
          ledgers: preferences.favoriteLedgers,
          missingLedgerIds: [],
          backupConflictLedgerIds: [],
          unboundLedgerIds: [],
          message: '缓存状态仍显示已备册。'
        }
      }
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 709,
          bvid: 'BV1review709',
          title: '国际尬聊观察',
          pageText: '国际尬聊',
          tags: ['国际尬聊']
        }
      }
      if (script.includes('/x/v3/fav/resource/deal') || script.includes('/x/v3/fav/folder/add')) {
        return {
          ok: true,
          steps: ['unexpected:favorite-write'],
          missingTargets: [],
          message: '不应执行收藏写入。'
        }
      }
      return { ok: true, steps: ['like'], missingTargets: [], message: '点赞已完成。' }
    })
    Object.assign(webview, { executeJavaScript })

    await requestRuntime({ id: 'stale-provisioned-snapshot', type: 'snapshot' })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1review709' }
      }))
    })

    await expect(
      requestRuntime({ id: 'unbound-target-review', type: 'run-action', action: '赏' })
    ).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining('当前收藏夹尚未备册或未绑定，本次仅完成预分类')
    })
    expect(
      executeJavaScript.mock.calls.some(([script]) =>
        String(script).includes('/x/v3/fav/resource/deal') || String(script).includes('/x/v3/fav/folder/add')
      )
    ).toBe(false)
  })

  it('writes a review to the best matching bound rule when the best local suggestion is unbacked', async () => {
    const checkpointConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const commitConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'movie-tv'
        ? { ...ledger, keywords: ['游戏'], bilibiliFolderId: 'remote-movie', bindingState: 'bound' as const }
        : ledger.id === 'inbox'
          ? { ...ledger, bilibiliFolderId: 'remote-inbox', bindingState: 'bound' as const }
          : { ...ledger, bindingState: 'unbacked' as const }
    )
    const preferences = createAppPreferences({ favoriteLedgers: ledgers })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      checkpointConfirmedFavoriteReview,
      commitConfirmedFavoriteReview
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        return {
          ok: false,
          verified: true,
          ledgers,
          missingLedgerIds: ['game'],
          backupConflictLedgerIds: [],
          unboundLedgerIds: [],
          message: '游戏攻略尚未备册。'
        }
      }
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return { aid: 711, bvid: 'BV1review711', title: '游戏攻略', pageText: '游戏攻略', tags: ['游戏'] }
      }
      if (script.includes('/x/v3/fav/resource/deal')) {
        expect(script).toContain('"targetLedgerIds":["movie-tv"]')
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          favoriteFolderIdsByLedgerId: { 'movie-tv': 'remote-movie' },
          message: '已用 B 站接口归入 bilimi 收藏夹。'
        }
      }
      if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
      return { ok: true, steps: [], missingTargets: [], message: '操作完成。' }
    })
    Object.assign(webview, { executeJavaScript })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1review711' }
      }))
    })

    await expect(requestRuntime({ id: 'unbacked-suggestion-bound-write', type: 'run-action', action: '藏' })).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining('预分类建议：bilimi·游戏专区（未备册）')
    })
    expect(commitConfirmedFavoriteReview).toHaveBeenCalledWith('100', expect.objectContaining({
      targets: [expect.objectContaining({ logicalFolderId: 'bilimi-logical:movie-tv', remoteFolderId: 'remote-movie' })]
    }))
    expect(executeJavaScript.mock.calls.some(([script]) => String(script).includes('/x/v3/fav/resource/deal'))).toBe(true)
  })

  it('writes to backed 暂存 and reports both targets when no matching rule is remotely writable', async () => {
    const checkpointConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const commitConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'inbox'
        ? { ...ledger, bilibiliFolderId: 'remote-inbox', bindingState: 'bound' as const }
        : { ...ledger, bindingState: 'unbacked' as const }
    )
    const preferences = createAppPreferences({ favoriteLedgers: ledgers })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      checkpointConfirmedFavoriteReview,
      commitConfirmedFavoriteReview
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        return {
          ok: false,
          verified: true,
          ledgers,
          missingLedgerIds: ['game'],
          backupConflictLedgerIds: [],
          unboundLedgerIds: [],
          message: '游戏攻略尚未备册。'
        }
      }
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return { aid: 712, bvid: 'BV1review712', title: '游戏攻略', pageText: '游戏攻略', tags: ['游戏'] }
      }
      if (script.includes('/x/v3/fav/resource/deal')) {
        expect(script).toContain('"targetLedgerIds":["inbox"]')
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          favoriteFolderIdsByLedgerId: { inbox: 'remote-inbox' },
          message: '已用 B 站接口归入 bilimi 收藏夹。'
        }
      }
      if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
      return { ok: true, steps: [], missingTargets: [], message: '操作完成。' }
    })
    Object.assign(webview, { executeJavaScript })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1review712' }
      }))
    })

    await expect(requestRuntime({ id: 'unbacked-suggestion-inbox-write', type: 'run-action', action: '藏' })).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining('预分类建议：bilimi·游戏专区（未备册）\n已写入：暂存')
    })
    expect(commitConfirmedFavoriteReview).toHaveBeenCalledWith('100', expect.objectContaining({
      targets: [expect.objectContaining({ logicalFolderId: 'bilimi-logical:inbox', remoteFolderId: 'remote-inbox' })]
    }))
  })

  it('preflights a rediscovered remote draft and writes only to bound 暂存', async () => {
    const provisionedLedgers = createDefaultFavoriteLedgers().map((ledger, index) =>
      ledger.id === 'knowledge'
        ? { ...ledger, keywords: ['国际尬聊'], bilibiliFolderId: String(9_100 + index), bindingState: 'bound' as const }
        : { ...ledger, bilibiliFolderId: String(9_100 + index), bindingState: 'bound' as const }
    )
    const localDraftLedgers = provisionedLedgers.map((ledger) =>
      ledger.id === 'knowledge'
        ? {
            ...ledger,
            bilibiliFolderId: undefined,
            bindingState: 'unbacked' as const,
            syncState: 'local-draft' as const
          }
        : ledger
    )
    const preferences = createAppPreferences({ favoriteLedgers: provisionedLedgers })
    const commitConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      commitConfirmedFavoriteReview
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    let statusReadCount = 0
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        statusReadCount += 1
        return statusReadCount === 1
          ? {
              ok: true,
              verified: true,
              ledgers: provisionedLedgers,
              missingLedgerIds: [],
              backupConflictLedgerIds: [],
              unboundLedgerIds: [],
              message: '首次快照仍显示已备册。'
            }
          : {
              ok: true,
              verified: true,
              ledgers: localDraftLedgers,
              missingLedgerIds: [],
              backupConflictLedgerIds: [],
              unboundLedgerIds: [],
              message: '动作预检发现知识学习尚未绑定。'
            }
      }
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 710,
          bvid: 'BV1review710',
          title: '国际尬聊观察',
          pageText: '国际尬聊',
          tags: ['国际尬聊']
        }
      }
      if (script.includes('/x/v3/fav/resource/deal')) {
        expect(script).toContain('"targetLedgerIds":["inbox"]')
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          favoriteFolderIdsByLedgerId: { inbox: provisionedLedgers.find((ledger) => ledger.id === 'inbox')!.bilibiliFolderId! },
          message: '已用 B 站接口归入 bilimi 收藏夹。'
        }
      }
      return { ok: true, steps: [], missingTargets: [], message: '操作完成。' }
    })
    Object.assign(webview, { executeJavaScript })

    await requestRuntime({ id: 'preflight-initial-snapshot', type: 'snapshot' })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1review710' }
      }))
    })

    await expect(
      requestRuntime({ id: 'preflight-unbound-review', type: 'run-action', action: '藏' })
    ).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining('已归类存入 bilimi·暂存')
    })
    expect(statusReadCount).toBe(3)
    expect(executeJavaScript.mock.calls.filter(([script]) => String(script).includes('/x/v3/fav/resource/deal'))).toHaveLength(1)
    expect(commitConfirmedFavoriteReview).toHaveBeenCalledWith('100', expect.objectContaining({
      targets: [expect.objectContaining({ logicalFolderId: 'bilimi-logical:inbox' })]
    }))
  })

  it('asks before creating a new physical shard and only writes after its binding succeeds', async () => {
    const gameLedger = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      keywords: ['单机游戏'],
      bilibiliFolderId: '9200',
      bilibiliFolderIds: ['9200'],
      bindingState: 'bound' as const
    }
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game' ? gameLedger : {
        ...ledger,
        bilibiliFolderId: '9300',
        bindingState: 'bound' as const
      }
    )
    const events: string[] = []
    const retryBilibiliFavoriteSpaceRefresh = vi.fn(async () => {
      events.push('refresh')
      return { status: 'idle' as const }
    })
    let finishBinding: (() => void) | undefined
    const binding = new Promise<void>((resolve) => { finishBinding = resolve })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn(async () => {
      events.push('bind:start')
      await binding
      events.push('bind:done')
    })
    const { notifyPreferencesChanged, requestRuntime, requestRuntimeDirect } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({ favoriteLedgers: ledgers })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      adoptFavoriteRepositoryLedgerBinding,
      retryBilibiliFavoriteSpaceRefresh
    })
    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    notifyPreferencesChanged(createAppPreferences({ favoriteLedgers: ledgers }))
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 9200, bvid: 'BV1shard9200', title: '单机游戏 Boss 速通路线',
            pageText: '单机游戏 Boss 速通路线', tags: ['单机游戏']
          }
        }
        if (script.includes('api:favorite:capacity-list') && script.includes('fullLedgerIds')) {
          return {
            ok: false, fullLedgerIds: ['game'],
            missingTargets: ['favorite-shard-confirmation:game'],
            steps: ['api:favorite:capacity-list'],
            message: 'The bound shard is full.'
          }
        }
        if (isLedgerStatusScript(script)) {
          return {
            ok: true, verified: true, ledgers, missingLedgerIds: [], backupConflictLedgerIds: [],
            unboundLedgerIds: [], message: 'Favorite ledgers are bound.'
          }
        }
        if (script.includes('favorite physical shard create')) {
          events.push('create')
          webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
            detail: { url: 'https://space.bilibili.com/100/favlist' }
          }))
          webview.dispatchEvent(new CustomEvent('page-title-updated', {
            detail: {
              title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid: '100', kind: 'create', nonce: 2 }))}`
            }
          }))
          webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
            detail: { url: 'https://www.bilibili.com/video/BV1shard9200' }
          }))
          return {
            ok: true, steps: ['api:favorite:shard-create'], missingTargets: [],
            folder: { id: '9201', title: 'bilimi·游戏专区②', shardNumber: 2 },
            message: 'Created.'
          }
        }
        if (script.includes('/x/v3/fav/resource/deal')) {
          events.push('write')
          return { ok: true, steps: ['api:favorite:add'], missingTargets: [], message: 'Written.' }
        }
        return { ok: true, steps: [], missingTargets: [], message: 'Complete.' }
      })
    })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1shard9200' }
      }))
    })

    await expect(
      requestRuntime({ id: 'shard-capacity-confirmation', type: 'run-action', action: '藏' })
    ).resolves.toMatchObject({
      ok: false,
      missingTargets: ['favorite-shard-confirmation:game']
    })
    expect(events).toEqual([])

    let completion!: Promise<AssistantRuntimeResponsePayload>
    await act(async () => {
      completion = requestRuntimeDirect({
        id: 'shard-capacity-confirmed-write',
        type: 'run-action',
        action: '藏',
        options: { confirmNewFavoriteShards: true }
      })
      await vi.waitFor(() => expect(events).toEqual(['create', 'bind:start']))
      await Promise.resolve()
      await Promise.resolve()
      expect(retryBilibiliFavoriteSpaceRefresh).not.toHaveBeenCalled()
    })

    await act(async () => {
      finishBinding?.()
      await expect(completion).resolves.toMatchObject({ ok: true })
    })
    expect(events).toEqual(['create', 'bind:start', 'bind:done', 'refresh', 'write'])
    expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith('100')
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        logicalLedgerId: 'game',
        remoteFolderId: '9201',
        shardNumber: 2
      })
    )
  })

  it('retries a created pending shard instead of creating the same shard again', async () => {
    const gameLedger = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      keywords: ['单机游戏'],
      bilibiliFolderId: '9200',
      bilibiliFolderIds: ['9200'],
      bindingState: 'bound' as const
    }
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game' ? gameLedger : { ...ledger, bilibiliFolderId: `93${ledger.priority}`, bindingState: 'bound' as const }
    )
    let currentLedgers = ledgers
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockRejectedValue(new Error('remote shard is absent from inventory'))
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({ favoriteLedgers: ledgers })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      savePreferences: vi.fn(async (preferences) => {
        currentLedgers = preferences.favoriteLedgers
        return preferences
      }),
      adoptFavoriteRepositoryLedgerBinding
    })
    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    notifyPreferencesChanged(createAppPreferences({ favoriteLedgers: ledgers }))
    const webview = document.getElementById('bilimi-webview') as HTMLElement & { executeJavaScript?: (script: string) => Promise<unknown> }
    const createdFolders: string[] = []
    Object.assign(webview, { executeJavaScript: vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) return { aid: 9200, bvid: 'BV1pending9200', title: '\u5355\u673a\u6e38\u620f Boss', pageText: '\u5355\u673a\u6e38\u620f', tags: ['\u5355\u673a\u6e38\u620f'] }
      if (script.includes('api:favorite:capacity-list') && script.includes('fullLedgerIds')) {
        return { ok: false, fullLedgerIds: ['game'], missingTargets: ['favorite-shard-confirmation:game'], steps: [], message: 'full' }
      }
      if (isLedgerStatusScript(script)) return { ok: true, verified: true, ledgers: currentLedgers, missingLedgerIds: [], backupConflictLedgerIds: [], unboundLedgerIds: [], message: 'bound' }
      if (script.includes('favorite physical shard create')) {
        createdFolders.push('9201')
        return { ok: true, steps: ['api:favorite:shard-create'], missingTargets: [], folder: { id: '9201', title: 'bilimi·游戏专区②', shardNumber: 2 } }
      }
      if (script.includes('/x/v3/fav/resource/deal')) return { ok: true, steps: [], missingTargets: [] }
      return { ok: true, steps: [], missingTargets: [] }
    }) })
    act(() => webview.dispatchEvent(new CustomEvent('did-navigate-in-page', { detail: { url: 'https://www.bilibili.com/video/BV1pending9200' } })))

    await expect(requestRuntime({ id: 'pending-first', type: 'run-action', action: '\u85cf', options: { confirmNewFavoriteShards: true } })).resolves.toMatchObject({ ok: false })
    await expect(requestRuntime({ id: 'pending-second', type: 'run-action', action: '\u85cf', options: { confirmNewFavoriteShards: true } })).resolves.toMatchObject({ ok: false })

    expect(createdFolders).toEqual(['9201'])
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledTimes(2)
  })

  it('skips DeepSeek daily review when the target favorite is not provisioned', async () => {
    const generateDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-daily-classify-review',
      targetLedgerIds: ['knowledge'],
      corrected: false,
      confidence: 0.9,
      keywordSuggestions: []
    })
    const provisionedLedgers = createDefaultFavoriteLedgers().map((ledger, index) =>
      ledger.id === 'knowledge'
        ? { ...ledger, keywords: ['预检知识'], bilibiliFolderId: String(9_150 + index), bindingState: 'bound' as const }
        : { ...ledger, bilibiliFolderId: String(9_150 + index), bindingState: 'bound' as const }
    )
    const localDraftLedgers = provisionedLedgers.map((ledger) =>
      ledger.id === 'knowledge'
        ? {
            ...ledger,
            bilibiliFolderId: undefined,
            bindingState: 'unbacked' as const,
            syncState: 'local-draft' as const
          }
        : ledger
    )
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      deepseekDailyClassificationMode: 'all',
      favoriteLedgers: provisionedLedgers
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100')
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        return {
          ok: true,
          verified: true,
          ledgers: localDraftLedgers,
          missingLedgerIds: [],
          backupConflictLedgerIds: [],
          unboundLedgerIds: [],
          message: '预检保留本地草稿状态。'
        }
      }
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 715,
          bvid: 'BV1review715',
          title: '预检知识视频',
          pageText: '预检知识',
          tags: ['预检知识']
        }
      }
      return { ok: true, steps: ['like'], missingTargets: [], message: '点赞已完成。' }
    })
    Object.assign(webview, { executeJavaScript })

    await requestRuntime({ id: 'deepseek-unprovisioned-snapshot', type: 'snapshot' })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1review715' }
      }))
    })

    await requestRuntime({ id: 'deepseek-unprovisioned-review', type: 'run-action', action: '赏' })

    expect(generateDeepSeek).not.toHaveBeenCalled()
  })

  it('skips a delayed DeepSeek review until the favorite ledgers are provisioned', async () => {
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(() => new Promise((resolve) => {
      setTimeout(() => resolve({
        kind: 'favorite-daily-classify-review',
        targetLedgerIds: ['game'],
        corrected: true,
        reason: 'DeepSeek 建议归入游戏专区。',
        confidence: 0.8,
        keywordSuggestions: []
      }), 5)
    }))
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off',
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) => {
        if (ledger.id === 'game') return { ...ledger, keywords: ['地铁攻略'] }
        if (ledger.id === 'life-interest') return { ...ledger, keywords: ['大阪生活'] }
        return ledger
      })
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      generateDeepSeek
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        return {
          ok: false,
          verified: true,
          ledgers: preferences.favoriteLedgers,
          missingLedgerIds: ['game'],
          backupConflictLedgerIds: [],
          unboundLedgerIds: [],
          message: '尚未备册。'
        }
      }
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 708,
          bvid: 'BV1review708',
          title: '大阪地铁换乘攻略',
          pageText: '大阪生活',
          tags: ['地铁攻略']
        }
      }
      if (script.includes('/x/v3/fav/resource/deal') || script.includes('/x/v3/fav/folder/add')) {
        return {
          ok: true,
          steps: ['unexpected:favorite-write'],
          missingTargets: [],
          message: '不应执行收藏写入。'
        }
      }
      return { ok: true, steps: ['like'], missingTargets: [], message: '点赞已完成。' }
    })
    Object.assign(webview, { executeJavaScript })

    await requestRuntime({ id: 'unprovisioned-deepseek-snapshot', type: 'snapshot' })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1review708' }
      }))
    })

    await expect(
      requestRuntime({ id: 'unprovisioned-delayed-review', type: 'run-action', action: '赏' })
    ).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining('当前收藏夹尚未备册或未绑定，本次仅完成预分类')
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    expect(generateDeepSeek).not.toHaveBeenCalled()
    expect(
      executeJavaScript.mock.calls.some(([script]) =>
        String(script).includes('/x/v3/fav/resource/deal') || String(script).includes('/x/v3/fav/folder/add')
      )
    ).toBe(false)
  })

  it('persists confirmed review favorites with the stable ledger identity after its display name is edited', async () => {
    const commitFavoriteRepositoryCommand = vi.fn().mockResolvedValue(undefined)
    const commitConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const preferences = createAppPreferences({
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) =>
        ledger.id === 'game'
          ? {
              ...ledger,
              displayName: '我的游戏归档'
            }
          : ledger
      )
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      commitFavoriteRepositoryCommand,
      commitConfirmedFavoriteReview
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 701,
            bvid: 'BV1review701',
            cid: 702,
            title: '游戏机制解析',
            author: '测试UP',
            description: '测试简介',
            tags: ['游戏', '攻略']
          }
        }

        if (script.includes('/x/v3/fav/resource/deal')) {
          return {
            ok: true,
            steps: ['api:favorite:list', 'api:favorite:add'],
            missingTargets: [],
            favoriteFolderIdsByLedgerId: { game: '91000002' },
            message: '已用 B 站接口归入 bilimi 收藏夹。'
          }
        }

        if (script.includes('document.cookie')) {
          return { hasUserId: true, hasCsrf: true }
        }

        return {
          ok: true,
          steps: ['favorite:open', 'favorite:folder', 'favorite'],
          missingTargets: [],
          message: '已按内容归入内库。'
        }
      })
    })

    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1review701' }
        })
      )
      webview.dispatchEvent(
        new CustomEvent('page-title-updated', {
          detail: { title: '游戏机制解析 - 哔哩哔哩' }
        })
      )
    })

    await expect(
      requestRuntime({ id: 'review-favorite-701', type: 'run-action', action: '藏' })
    ).resolves.toMatchObject({ ok: true })

    expect(commitConfirmedFavoriteReview).toHaveBeenCalledTimes(1)
    expect(commitConfirmedFavoriteReview).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        aid: 701,
        video: expect.objectContaining({
          aid: 701,
          bvid: 'BV1review701',
          cid: 702,
          title: '游戏机制解析',
          author: '测试UP',
          description: '测试简介',
          tags: ['游戏', '攻略']
        })
      })
    )
    expect(commitConfirmedFavoriteReview).toHaveBeenCalledWith('100', expect.objectContaining({
      targets: [{ logicalFolderId: 'bilimi-logical:game', remoteFolderId: '91000002', title: '我的游戏归档' }],
      event: expect.objectContaining({ kind: 'entered', titleAtTime: '游戏机制解析', folderTitlesAtTime: ['我的游戏归档'] })
    }))
    expect(commitFavoriteRepositoryCommand).not.toHaveBeenCalled()
  })

  it('keeps the confirmed Bilibili favorite result when checkpointed local registration rejects', async () => {
    const checkpointConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const commitConfirmedFavoriteReview = vi.fn().mockRejectedValue(new Error('local storage is temporarily unavailable'))
    const commitFavoriteRepositoryCommand = vi.fn().mockResolvedValue(undefined)
    const preferences = createAppPreferences()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      checkpointConfirmedFavoriteReview,
      commitConfirmedFavoriteReview,
      commitFavoriteRepositoryCommand
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 702,
            bvid: 'BV1review702',
            cid: 703,
            title: '本地登记失败仍保持远端结果',
            author: '测试UP',
            description: '测试简介',
            tags: ['游戏']
          }
        }
        if (script.includes('/x/v3/fav/resource/deal')) {
          return {
            ok: true,
            steps: ['api:favorite:list', 'api:favorite:add'],
            missingTargets: [],
            favoriteFolderIdsByLedgerId: { game: '91000002' },
            message: '已用 B 站接口归入 bilimi 收藏夹。'
          }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        return { ok: true, steps: ['favorite:open'], missingTargets: [], message: '已完成。' }
      })
    })
    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1review702' }
      }))
      webview.dispatchEvent(new CustomEvent('page-title-updated', {
        detail: { title: '本地登记失败仍保持远端结果 - 哔哩哔哩' }
      }))
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(requestRuntime({ id: 'review-favorite-702', type: 'run-action', action: '藏' })).resolves.toMatchObject({
        ok: true,
        message: expect.not.stringContaining('待核对')
      })
    } finally {
      consoleError.mockRestore()
    }

    expect(checkpointConfirmedFavoriteReview).toHaveBeenCalledTimes(1)
    expect(checkpointConfirmedFavoriteReview).toHaveBeenCalledBefore(commitConfirmedFavoriteReview)
    expect(commitConfirmedFavoriteReview).toHaveBeenCalledTimes(1)
    expect(commitFavoriteRepositoryCommand).not.toHaveBeenCalled()
    const feedback = (await requestRuntime({ id: 'review-favorite-702-feedback', type: 'snapshot' }))?.runtimeFeedback ?? ''
    expect(feedback).not.toContain('待核对')
    expect(feedback).not.toContain('Frozen favorite workspace plans')
  })

  it('persists existing Bilibili folder ids returned by backup before the next assistant snapshot', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100')
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const backedUpLedgers = createDefaultFavoriteLedgers().map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: String(9000 + index)
    }))
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('/x/v3/fav/folder/add')) {
          return {
            ok: true,
            verified: true,
            ledgers: backedUpLedgers,
            steps: ['api:ledger:list'],
            missingTargets: [],
            message: '册目已备齐。'
          }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await expect(requestRuntime({ id: 'backup-ledgers', type: 'ensure-ledgers' })).resolves.toMatchObject({ ok: true })
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith('100', expect.objectContaining({
      logicalLedgerId: 'knowledge', remoteFolderId: '9000', remoteTitle: expect.any(String)
    }))
    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        '100': expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([
            expect.objectContaining({ id: 'music', bilibiliFolderId: expect.any(String) })
          ])
        })
      })
    }))
  })

  it('publishes only the final remote-discovery projection after full ensure backup', async () => {
    const accountMid = '100'
    const music = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!
    const remoteDraft = {
      id: 'custom-remote-880',
      displayName: 'bilimi·临时远端夹',
      keywords: [],
      enabled: false,
      priority: 99,
      bilibiliFolderId: '880',
      bilibiliFolderIds: ['880'],
      bindingState: 'unbound' as const,
      syncState: 'local-draft' as const,
      isDefault: false
    }
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const backedUpLedgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === music.id ? { ...ledger, bilibiliFolderId: '9001' } : ledger
    )
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(LEDGER_SAVE_SCRIPT_MARKER)) {
          return {
            ok: true,
            verified: true,
            ledgers: [...backedUpLedgers, remoteDraft],
            remoteOnlyDraftLedgerIds: [remoteDraft.id],
            steps: ['api:ledger:list', 'api:ledger:create:music'],
            missingTargets: [],
            message: '册目已备齐。'
          }
        }
        if (script.includes(LEDGER_STATUS_SCRIPT_MARKER)) {
          return {
            ...emptyLedgerStatus(),
            ledgers: backedUpLedgers,
            remoteOnlyDraftLedgerIds: []
          }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    const result = await requestRuntime({ id: 'full-ensure-final-discovery', type: 'ensure-ledgers' })

    expect(result).toMatchObject({ ok: true, remoteOnlyDraftLedgerIds: [] })
    expect(result?.ledgers).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: remoteDraft.id })]))
    expect(savePreferences).toHaveBeenCalled()
    const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(savedLedgers).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: remoteDraft.id })]))
    expect(webview.executeJavaScript.mock.calls.some(([script]) =>
      String(script).includes('"includeRemoteOnlyDrafts":true')
    )).toBe(true)
  })

  it('keeps a newly bound ledger backed while the post-backup Bilibili inventory is briefly stale', async () => {
    const accountMid = '100'
    const music = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const repositorySummary = {
      version: 1, accountMid, revision: 1, updatedAt: '2026-08-29T00:00:00.000Z',
      videoCount: 0, folderCount: 1,
      folders: [{ id: `bilimi-logical:${music.id}`, title: music.displayName, kind: 'bilimi-logical', logicalLedgerId: music.id, remoteFolderId: 'new-music', syncState: 'bound' }],
      folderCounts: { [`bilimi-logical:${music.id}`]: 0 }, scopeCounts: { all: 0, pending: 0, protected: 0, unsynced: 0, recycle: 0 },
      physicalShardCount: 1,
      physicalShards: [{ logicalLedgerId: music.id, folderId: `bilimi:${music.id}:001`, shardNumber: 1, remoteFolderId: 'new-music', remoteTitle: music.displayName, bindingState: 'bound' as const }],
      syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0, remoteReconciliations: []
    }
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [music] }
        }
      })),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue(repositorySummary),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (script.includes('已绑定收藏夹改名预检')) {
          return {
            ok: true,
            verified: true,
            observedShards: [{
              logicalLedgerId: music.id, shardNumber: 1, remoteFolderId: 'new-music',
              currentRemoteTitle: music.displayName, remoteMemberCount: 0
            }]
          }
        }
        if (isLedgerStatusScript(script)) {
          return {
            ok: false,
            verified: true,
            ledgers: [{ ...music, bilibiliFolderId: undefined, bilibiliFolderIds: undefined, bindingState: 'unbacked' as const }],
            missingLedgerIds: [music.id],
            unboundLedgerIds: [],
            backupConflictLedgerIds: [],
            message: 'B 站清单尚未同步。'
          }
        }
        if (script.includes('/x/v3/fav/folder/add')) {
          return {
            ok: true,
            verified: true,
            ledgers: [{ ...music, bilibiliFolderId: 'new-music', bilibiliFolderIds: ['new-music'], bindingState: 'bound' as const }],
            steps: ['api:ledger:list'],
            missingTargets: [],
            message: '册目已备齐。'
          }
        }
        return { hasUserId: true, hasCsrf: true }
      })
    })

    await expect(requestRuntime({
      id: 'backup-stale-inventory', type: 'save-ledgers', ledgers: [music],
      options: { backupTargetLedgerIds: [music.id] }
    })).resolves.toMatchObject({ ok: true })

    const savedMusic = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers
      ?.find((ledger) => ledger.id === music.id)
    expect(savedMusic).toMatchObject({ bilibiliFolderId: 'new-music', bindingState: 'bound' })
  })

  it('persists an ordinary local favorite-rule save without requiring a Bilibili page script', async () => {
    const accountMid = '100'
    const initialLedgers = createDefaultFavoriteLedgers()
    const localLedger = {
      id: 'custom-local-save', displayName: 'bilimi·本地规则', keywords: ['本地'], ruleType: 'keyword' as const,
      enabled: false, priority: 90, bindingState: 'unbacked' as const, ruleOrigin: 'saved-rule' as const, isDefault: false
    }
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: initialLedgers }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      savePreferences
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn().mockRejectedValue(new Error('Bilibili page is unavailable'))
    Object.assign(webview, { executeJavaScript })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await expect(requestRuntime({
      id: 'local-rule-save-without-page', type: 'save-ledgers', ledgers: [...initialLedgers, localLedger],
      options: { deleteDisabled: false }
    })).resolves.toMatchObject({ ok: true, ledgers: expect.arrayContaining([
      expect.objectContaining({ id: 'custom-local-save', displayName: 'bilimi·本地规则' })
    ]) })

    const persistedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers
    expect(persistedLedgers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-local-save', displayName: 'bilimi·本地规则', bindingState: 'unbacked' })
    ]))
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('saves a selected recommendation locally without executing any Bilibili write path', async () => {
    const accountMid = '100'
    const initialLedgers = createDefaultFavoriteLedgers()
    const recommendation = {
      id: 'recommended-local-only', displayName: 'bilimi·本地推荐', keywords: ['本地推荐'], ruleType: 'author' as const,
      enabled: true, priority: 90, ruleOrigin: 'saved-rule' as const, isDefault: false
    }
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: initialLedgers }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      savePreferences
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: ReturnType<typeof vi.fn>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      throw new Error(`Recommendation save must not execute Bilibili script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await expect(requestRuntime({
      id: 'recommendation-local-only', type: 'save-ledgers', ledgers: [...initialLedgers, recommendation],
      options: { deleteDisabled: false }
    })).resolves.toMatchObject({
      ok: true,
      steps: ['favorite-ledgers:local-save'],
      ledgers: expect.arrayContaining([expect.objectContaining({ id: recommendation.id, enabled: true })])
    })
    expect(executeJavaScript).not.toHaveBeenCalled()
    const persistedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers
    expect(persistedLedgers).toEqual(expect.arrayContaining([expect.objectContaining({
      id: recommendation.id, ruleOrigin: 'saved-rule', enabled: true
    })]))
  })

  it('fails closed when the repository summary does not identify the active account', async () => {
    const accountMid = '100'
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(LEDGER_STATUS_SCRIPT_MARKER)) {
        throw new Error(`Unexpected unverified repository script: ${script.slice(0, 80)}`)
      }
      if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
      throw new Error(`Unexpected unverified repository script: ${script.slice(0, 80)}`)
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: {
            defaultFavoriteSystemEnabled: true,
            favoriteLedgers: createDefaultFavoriteLedgers()
          }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1,
        revision: 1,
        updatedAt: '2026-09-04T00:00:00.000Z',
        videoCount: 0,
        folderCount: 0,
        folders: [],
        folderCounts: {},
        scopeCounts: {},
        physicalShardCount: 0,
        physicalShards: [],
        syncRecordCount: 0,
        syncCounts: {},
        pendingAidCount: 0,
        remoteReconciliations: []
      }),
      executeJavaScript
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: typeof executeJavaScript
    }
    Object.assign(webview, { executeJavaScript })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await expect(requestRuntime({ id: 'missing-summary-account', type: 'ensure-ledgers' }))
      .resolves.toMatchObject({ ok: false })
    expect(executeJavaScript.mock.calls.filter(([script]) => script.includes(LEDGER_STATUS_SCRIPT_MARKER))).toHaveLength(0)
  })

  it('keeps locally deleted and manually dismissed remote drafts suppressed during the pet full backup', async () => {
    const accountMid = '100'
    const getFavoriteLedgerRemoteDraftReminderDismissals = vi.fn().mockResolvedValue(['manual-dismissal'])
    const getFavoriteLedgerRemoteDraftRediscoveryPending = vi.fn().mockResolvedValue(['88'])
    const consumeFavoriteLedgerRemoteDraftRediscoveryPending = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      getFavoriteLedgerRemoteDraftReminderDismissals,
      getFavoriteLedgerRemoteDraftRediscoveryPending,
      consumeFavoriteLedgerRemoteDraftRediscoveryPending
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (script.includes(LEDGER_SAVE_SCRIPT_MARKER)) {
        return { ok: true, verified: true, ledgers: createDefaultFavoriteLedgers(), steps: ['api:ledger:list'], missingTargets: [], message: '册目已备齐。' }
      }
      if (isLedgerStatusScript(script)) return emptyLedgerStatus()
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({ id: 'pet-backup-keeps-remote-drafts-suppressed', type: 'ensure-ledgers' }))
      .resolves.toMatchObject({ ok: true })

    const [ensureScript] = executeJavaScript.mock.calls.find(([script]) =>
      typeof script === 'string' && script.includes(LEDGER_SAVE_SCRIPT_MARKER)
    ) ?? []
    expect(ensureScript).toContain('manual-dismissal')
    expect(ensureScript).toContain('88')
    expect(consumeFavoriteLedgerRemoteDraftRediscoveryPending).not.toHaveBeenCalled()
  })

  it('clears a default deletion marker when formal backup binding succeeds', async () => {
    const accountMid = '100'
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const ledgers = createDefaultFavoriteLedgers().map((ledger, index) => ({
      ...ledger,
      ...(ledger.id === 'music' ? { managedFolderDeletedByUser: true, bindingState: 'unbound' as const } : {}),
      enabled: true
    }))
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: ledgers }
        }
      })),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const returnedLedgers = ledgers.map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: String(9800 + index),
      bindingState: 'bound' as const
    }))
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('/x/v3/fav/folder/add')) {
          return { ok: true, verified: true, ledgers: returnedLedgers, steps: ['api:ledger:list'], missingTargets: [], message: '册目已备齐。' }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await expect(requestRuntime({ id: 'backup-clears-deletion-marker', type: 'ensure-ledgers' })).resolves.toMatchObject({ ok: true })

    const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).not.toHaveProperty('managedFolderDeletedByUser')
  })

  it('formally binds a newly created folder from the right-side batch backup after local deletion', async () => {
    const accountMid = '100'
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => ({
      ...ledger,
      ...(ledger.id === 'music'
        ? {
            bilibiliFolderId: 'old-music', managedFolderDeletedByUser: true, bindingState: 'unbound' as const,
            confirmedDeletedRemoteFolderIds: ['old-music']
          }
        : {}),
      enabled: true
    }))
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: ledgers }
        }
      })),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const returnedLedgers = ledgers.map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: ledger.id === 'music' ? 'new-music' : String(9900 + index),
      bindingState: 'bound' as const
    }))
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('/x/v3/fav/folder/add')) {
          return { ok: true, verified: true, ledgers: returnedLedgers, steps: ['api:ledger:list'], missingTargets: [], message: '册目已备齐。' }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())

    await expect(requestRuntime({
      id: 'backup-replaces-deleted-default-folder', type: 'save-ledgers',
      ledgers: [ledgers.find((ledger) => ledger.id === 'music')!],
      options: { backupTargetLedgerIds: ['music'], rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: true })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'music', remoteFolderId: 'new-music'
    }))
    const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).toMatchObject({
      bilibiliFolderId: 'new-music', bindingState: 'bound'
    })
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).not.toHaveProperty('managedFolderDeletedByUser')
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).not.toHaveProperty('confirmedDeletedRemoteFolderIds')
  })

  it('creates and formally binds after deletion confirmed both the bound and same-name unbound folders', async () => {
    const accountMid = '100'
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => ({
      ...ledger,
      ...(ledger.id === 'music'
        ? {
            bilibiliFolderId: 'bound-music',
            bilibiliFolderIds: ['bound-music'],
            managedFolderDeletedByUser: true,
            bindingState: 'unbacked' as const,
            confirmedDeletedRemoteFolderIds: ['bound-music', 'unbound-music']
          }
        : {}),
      enabled: true
    }))
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: ledgers }
        }
      })),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const returnedLedgers = ledgers.map((ledger, index) => ({
      ...ledger,
      ...(ledger.id === 'music'
        ? { bilibiliFolderId: 'new-music', bilibiliFolderIds: ['new-music'] }
        : { bilibiliFolderId: String(9_900 + index), bilibiliFolderIds: [String(9_900 + index)] }),
      bindingState: 'bound' as const
    }))
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('/x/v3/fav/folder/add')) {
          expect(script).toContain('bound-music')
          expect(script).toContain('unbound-music')
          return { ok: true, verified: true, ledgers: returnedLedgers, steps: ['api:ledger:list', 'api:ledger:create:music'], missingTargets: [], message: '收藏夹已备册。' }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await expect(requestRuntime({
      id: 'backup-after-all-deletion-candidates-succeeded', type: 'save-ledgers',
      ledgers: [ledgers.find((ledger) => ledger.id === 'music')!],
      options: { backupTargetLedgerIds: ['music'], rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: true })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'music', remoteFolderId: 'new-music'
    }))
    const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).toMatchObject({
      bilibiliFolderId: 'new-music', bindingState: 'bound'
    })
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).not.toHaveProperty('managedFolderDeletedByUser')
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).not.toHaveProperty('confirmedDeletedRemoteFolderIds')
  })

  it('retains a newly created replacement id as pending when its formal binding inventory has not caught up', async () => {
    const accountMid = '100'
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockRejectedValue(new Error('Favorite repository remote shard is absent from inventory.'))
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => ({
      ...ledger,
      ...(ledger.id === 'music'
        ? { bilibiliFolderId: 'old-music', managedFolderDeletedByUser: true, bindingState: 'unbound' as const }
        : {}),
      enabled: true
    }))
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: ledgers }
        }
      })),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const returnedLedgers = [{
      ...ledgers.find((ledger) => ledger.id === 'music')!,
      bilibiliFolderId: 'new-music',
      bindingState: 'bound' as const
    }]
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('/x/v3/fav/folder/add')) {
          return { ok: true, verified: true, ledgers: returnedLedgers, steps: ['api:ledger:list'], missingTargets: [], message: '册目已备齐。' }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await expect(requestRuntime({
      id: 'backup-keeps-created-replacement-pending', type: 'save-ledgers',
      ledgers: [ledgers.find((ledger) => ledger.id === 'music')!],
      options: { backupTargetLedgerIds: ['music'], rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({
      ok: false,
      unboundCandidates: [],
      message: expect.stringContaining('已创建'),
      ledgers: expect.arrayContaining([expect.objectContaining({
        id: 'music',
        bindingState: 'unbound',
        pendingRemoteBinding: true,
        pendingRemoteFolderId: 'new-music',
        pendingRemoteBindingCreatedByBackup: true
      })])
    })

    const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).toMatchObject({
      bilibiliFolderId: 'new-music',
      pendingRemoteBinding: true,
      pendingRemoteFolderId: 'new-music',
      pendingRemoteBindingCreatedByBackup: true
    })
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).toHaveProperty('managedFolderDeletedByUser', true)
  })

  it('formally registers the exact pending backup-created id when it becomes visible without asking for a same-name rebind', async () => {
    const accountMid = '100'
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const music = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!,
      bilibiliFolderId: 'new-music',
      bilibiliFolderIds: ['new-music'],
      bilibiliFolderTitle: 'bilimi·音乐舞台',
      bindingState: 'unbound' as const,
      managedFolderDeletedByUser: true,
      pendingRemoteBinding: true,
      pendingRemoteBindingCreatedByBackup: true,
      pendingRemoteFolderId: 'new-music',
      pendingRemoteFolderTitle: 'bilimi·音乐舞台',
      enabled: true
    }
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [music] }
        }
      })),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('/x/v3/fav/folder/created/list-all')) {
          return {
            ok: true,
            verified: true,
            ledgers: [{ ...music, bindingState: 'bound' as const }],
            steps: ['api:ledger:list'],
            missingTargets: [],
            message: '收藏夹已备册。'
          }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await expect(requestRuntime({
      id: 'backup-registers-pending-created-id', type: 'save-ledgers', ledgers: [music],
      options: { backupTargetLedgerIds: ['music'], rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: true })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'music', remoteFolderId: 'new-music'
    }))
    const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    const savedMusic = savedLedgers.find((ledger) => ledger.id === 'music')
    expect(savedMusic).toMatchObject({ id: 'music', bilibiliFolderId: 'new-music', bindingState: 'bound' })
    expect(savedMusic).not.toHaveProperty('pendingRemoteBinding')
    expect(savedMusic).not.toHaveProperty('pendingRemoteBindingCreatedByBackup')
    expect(savedMusic).not.toHaveProperty('managedFolderDeletedByUser')
  })

  it('does not treat a legacy preference folder id as a formal remote binding during backup', async () => {
    const accountMid = '100'
    const legacyLedger = {
      ...createDefaultFavoriteLedgers()[0],
      bilibiliFolderId: '9000',
      bindingState: 'bound' as const
    }
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [legacyLedger]
        }
      }
    })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    let resolveLoadedPreferences: ((preferences: AssistantPreferences) => void) | undefined
    const loadPreferences = vi.fn(() => new Promise<AssistantPreferences>((resolve) => {
      resolveLoadedPreferences = resolve
    }))
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences,
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 0, updatedAt: '2026-08-09T00:00:00.000Z',
        videoCount: 0, folderCount: 0, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 0, syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0,
        remoteReconciliations: []
      }),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        expect(script).toContain('"remoteDraftKnownFolderIds":["9000"]')
        expect(script).not.toContain('"remoteDraftBoundFolderIds":["9000"]')
        return {
          ok: false,
          verified: true,
          ledgers: [{ ...legacyLedger, bilibiliFolderId: undefined, bindingState: 'unbound' }],
          steps: ['api:ledger:list'],
          missingLedgerIds: [legacyLedger.id],
          missingTargets: [legacyLedger.id],
          unboundLedgerIds: [legacyLedger.id],
          unboundCandidates: [{ ledgerId: legacyLedger.id, candidates: [{ id: '9000', title: legacyLedger.displayName, memberCount: 0 }] }],
          message: '发现未绑定的 bilimi 收藏夹。'
        }
      })
    })

    await waitFor(() => expect(loadPreferences).toHaveBeenCalled())
    await act(async () => {
      resolveLoadedPreferences?.(initialPreferences)
      await Promise.resolve()
    })
    await expect(requestRuntime({ id: 'legacy-backup', type: 'ensure-ledgers' })).resolves.toMatchObject({
      ok: false,
      unboundLedgerIds: [legacyLedger.id]
    })
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
    const savedLedger = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers?.find((ledger) => ledger.id === legacyLedger.id)
    expect(savedLedger).toMatchObject({ bindingState: 'unbound', historicalBilibiliFolderIds: ['9000'] })
  })

  it('preserves an unbound physical shard id as deletion-only history without making backup treat it as bound', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bindingState: 'unbound' as const
    }
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [game]
        }
      }
    })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    let resolveInitialPreferences: ((preferences: AssistantPreferences) => void) | undefined
    const initialPreferencesLoaded = new Promise<AssistantPreferences>((resolve) => {
      resolveInitialPreferences = resolve
    })
    const loadPreferences = vi.fn(() => initialPreferencesLoaded)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences,
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-08-23T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [{ id: 'bilimi-logical:game', title: '游戏专区', kind: 'bilimi-logical', logicalLedgerId: 'game', syncState: 'pending-reconcile' }],
        folderCounts: {}, scopeCounts: {}, physicalShardCount: 1, syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0,
        remoteReconciliations: [], physicalShards: [{ logicalLedgerId: 'game', shardNumber: 2, remoteFolderId: 'unbound-game-2', remoteTitle: 'bilimi·游戏专区②', bindingState: 'pending-reconcile' }]
      }),
      adoptFavoriteRepositoryLedgerBinding: vi.fn()
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        expect(script).toContain('"remoteDraftKnownFolderIds":["unbound-game-2"]')
        expect(script).not.toContain('"remoteDraftBoundFolderIds":["unbound-game-2"]')
        return {
          ok: false,
          verified: true,
          ledgers: [{ ...game, bindingState: 'unbound' }],
          steps: ['api:ledger:list'], missingLedgerIds: ['game'], missingTargets: ['game'], unboundLedgerIds: ['game'],
          unboundCandidates: [{ ledgerId: 'game', candidates: [{ id: 'unbound-game-2', title: 'bilimi·游戏专区②', memberCount: 1000 }] }],
          message: '发现未绑定的 bilimi 收藏夹。'
        }
      })
    })

    await waitFor(() => expect(loadPreferences).toHaveBeenCalled())
    await act(async () => {
      resolveInitialPreferences?.(initialPreferences)
      await initialPreferencesLoaded
    })
    await expect(requestRuntime({ id: 'preserve-unbound-shard-history', type: 'ensure-ledgers' })).resolves.toMatchObject({ ok: false, unboundLedgerIds: ['game'] })
    const savedLedger = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers?.find((ledger) => ledger.id === 'game')
    expect(savedLedger).toMatchObject({ bindingState: 'unbound', historicalBilibiliFolderIds: ['unbound-game-2'], historicalBilibiliFolderTitle: 'bilimi·游戏专区②' })
  })

  it('preserves a physical shard id when status projects the rule as unbacked', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bindingState: 'unbacked' as const
    }
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [game]
        }
      }
    })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-08-23T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [{ id: 'bilimi-logical:game', title: '游戏专区', kind: 'bilimi-logical', logicalLedgerId: 'game', syncState: 'pending-reconcile' }],
        folderCounts: {}, scopeCounts: {}, physicalShardCount: 1, syncRecordCount: 0, pendingAidCount: 0,
        remoteReconciliations: [], physicalShards: [{ logicalLedgerId: 'game', shardNumber: 2, remoteFolderId: 'unbound-game-2', remoteTitle: 'bilimi·游戏专区②', bindingState: 'pending-reconcile' }]
      }),
      adoptFavoriteRepositoryLedgerBinding: vi.fn()
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        expect(script).toContain('"remoteDraftKnownFolderIds":["unbound-game-2"]')
        expect(script).not.toContain('"remoteDraftBoundFolderIds":["unbound-game-2"]')
        return {
          ok: false,
          verified: true,
          ledgers: [{ ...game, bindingState: 'unbacked' as const }], steps: ['api:ledger:list'],
          missingLedgerIds: ['game'], missingTargets: ['game'], unboundLedgerIds: ['game'],
          unboundCandidates: [{ ledgerId: 'game', candidates: [{ id: 'unbound-game-2', title: 'bilimi·游戏专区②', memberCount: 1000 }] }],
          message: '发现未绑定的 bilimi 收藏夹。'
        }
      })
    })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await expect(requestRuntime({ id: 'preserve-unbacked-shard-history', type: 'ensure-ledgers' })).resolves.toMatchObject({ ok: false, unboundLedgerIds: ['game'] })
    const savedLedger = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers?.find((ledger) => ledger.id === 'game')
    expect(savedLedger).toMatchObject({ bindingState: 'unbacked', historicalBilibiliFolderIds: ['unbound-game-2'], historicalBilibiliFolderTitle: 'bilimi·游戏专区②' })
  })

  it('returns an observed shard as an explicit rebind candidate when no formal shard exists', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: '4115311554',
      bilibiliFolderIds: ['4115311554'],
      bilibiliFolderTitle: 'bilimi·游戏专区②',
      bilibiliFolderVideoCount: 2,
      bindingState: 'unbound' as const
    }
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [game]
        }
      }
    })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 0, updatedAt: '2026-08-22T00:00:00.000Z',
        videoCount: 0, folderCount: 0, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 0, syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0,
        remoteReconciliations: [], physicalShards: []
      }),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture && script.includes('const hasUserId =')) return { hasUserId: true, hasCsrf: true }
        const payloadMatch = script.match(/const payload = (.*?);/s)
        expect(payloadMatch).not.toBeNull()
        const payload = JSON.parse(payloadMatch?.[1] ?? '{}')
        expect(payload.nextLedgers).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ bilibiliFolderId: '4115311554' })
        ]))
        expect(payload.options.rebindRemoteFolderIds).toBeUndefined()
        expect(payload.remoteDraftKnownFolderIds).toContain('4115311554')
        return {
          ok: false,
          ledgers: [{ ...game, bilibiliFolderId: '4115311554', bilibiliFolderIds: ['4115311554'], bindingState: 'unbound' as const }],
          steps: ['api:ledger:list'],
          missingTargets: ['game'],
          unboundLedgerIds: ['game'],
          unboundCandidates: [{
            ledgerId: 'game',
            candidates: [{ id: '4115311554', title: 'bilimi·游戏专区②', memberCount: 2 }]
          }],
          message: '发现未绑定的 bilimi 收藏夹，请确认要重新绑定的候选收藏夹。'
        }
      })
    })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    await expect(requestRuntime({
      id: 'backup-observed-unbound-game-shard',
      type: 'save-ledgers',
      ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({
      ok: false,
      unboundLedgerIds: ['game'],
      unboundCandidates: [{
        ledgerId: 'game',
        candidates: [{ id: '4115311554', title: 'bilimi·游戏专区②', memberCount: 2 }]
      }]
    })
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
  })

  it('does not adopt an unbound remote candidate before the user confirms rebinding', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: false,
        ledgers: [{ ...game, bilibiliFolderId: '88', bindingState: 'unbound' }],
        steps: ['api:ledger:list'],
        missingTargets: ['game'],
        unboundLedgerIds: ['game'],
        unboundCandidates: [{ ledgerId: 'game', candidates: [{ id: '88', title: game.displayName, memberCount: 1000 }] }],
        message: '发现未绑定的 bilimi 收藏夹。'
      }))
    })

    await expect(requestRuntime({ id: 'unconfirmed-rebind', type: 'ensure-ledgers' })).resolves.toMatchObject({
      ok: false,
      unboundLedgerIds: ['game']
    })
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
  })

  it('does not authorize a remote rename when registering an explicitly confirmed binding candidate', async () => {
    const accountMid = '100'
    const meilin = {
      id: 'meilin', displayName: 'bilimi·梅林FIT', keywords: ['梅林'], enabled: true, priority: 1,
      isDefault: false, ruleOrigin: 'saved-rule' as const, bindingState: 'unbacked' as const
    }
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [meilin] }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...meilin, bilibiliFolderId: 'xiaomi-id', bindingState: 'bound' as const }],
        steps: ['api:ledger:list'], missingTargets: [], message: '收藏夹已备册。'
      }))
    })

    await expect(requestRuntime({
      id: 'confirm-differently-named-rebind', type: 'save-ledgers', ledgers: [meilin],
      options: {
        backupTargetLedgerIds: ['meilin'],
        rebindRemoteFolderIds: { meilin: 'xiaomi-id' },
        rebindRemoteFolders: {
          meilin: [{ id: 'xiaomi-id', title: 'bilimi·小咪的收藏夹', memberCount: 1 }]
        }
      }
    })).resolves.toMatchObject({ ok: true })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'meilin',
      logicalTitle: 'bilimi·梅林FIT',
      remoteFolderId: 'xiaomi-id',
      remoteTitle: 'bilimi·小咪的收藏夹'
    }))
    expect(adoptFavoriteRepositoryLedgerBinding.mock.calls[0]?.[1]).not.toHaveProperty('allowRemoteRename')
  })

  it('refuses to register a remote folder whose title is missing', async () => {
    const accountMid = '100'
    const meilin = {
      id: 'meilin', displayName: 'bilimi·梅林FIT', keywords: ['梅林'], enabled: true, priority: 1,
      isDefault: false, ruleOrigin: 'saved-rule' as const, bindingState: 'unbacked' as const
    }
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [meilin] }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...meilin, bilibiliFolderId: 'unknown-title', bindingState: 'bound' as const }],
        steps: ['api:ledger:list'], missingTargets: [], message: '收藏夹已备册。'
      }))
    })

    await expect(requestRuntime({
      id: 'reject-missing-base-title-rebind', type: 'save-ledgers', ledgers: [meilin],
      options: {
        backupTargetLedgerIds: ['meilin'],
        rebindRemoteFolderIds: { meilin: 'unknown-title' },
        rebindRemoteFolders: {
          meilin: [{ id: 'unknown-title', title: '   ', memberCount: 1 }]
        }
      }
    })).resolves.toMatchObject({ ok: false, unboundLedgerIds: ['meilin'] })

    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
  })

  it('confirms every selected unbound candidate for one light backup without touching other ledgers', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        expect(script).toContain('"id":"game"')
        expect(script).not.toContain('"id":"knowledge"')
        expect(script).toContain('"rebindRemoteFolderIds":{"game":"88"}')
        return {
          ok: true,
          verified: true,
          ledgers: [{ ...game, bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'bound' as const }],
          steps: ['api:ledger:list'], missingTargets: [], message: '已备册'
        }
      })
    })

    const lightBackupResult = await requestRuntime({
      id: 'confirmed-light-rebind', type: 'ensure-ledger', logicalFolderId: 'bilimi-logical:game',
      options: {
        rebindRemoteFolderIds: { game: '88' },
        rebindRemoteFolders: {
          game: [
            { id: '88', title: game.displayName, memberCount: 100 },
            { id: '89', title: `${game.displayName}②`, memberCount: 20 }
          ]
        }
      }
    })
    expect(lightBackupResult).toMatchObject({
      ok: true,
      verified: true,
      ledgers: [expect.objectContaining({ id: 'game', bilibiliFolderIds: ['88', '89'], bindingState: 'bound' })]
    })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenNthCalledWith(1, accountMid, expect.objectContaining({
      logicalLedgerId: 'game', remoteFolderId: '88', shardNumber: 1
    }))
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenNthCalledWith(2, accountMid, expect.objectContaining({
      logicalLedgerId: 'game', remoteFolderId: '89', shardNumber: 2
    }))
  })

  it('passes full formal remote coverage to a single-ledger confirmation without widening its write target', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const knowledge = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'knowledge')!
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [game, knowledge] }
      }
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-03T00:00:00.000Z',
        videoCount: 0, folderCount: 2, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 2, syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: [],
        physicalShards: [
          { logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: 'game-88', remoteTitle: game.displayName, bindingState: 'bound' },
          { logicalLedgerId: 'knowledge', shardNumber: 1, remoteFolderId: 'knowledge-99', remoteTitle: knowledge.displayName, bindingState: 'bound' }
        ]
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        const payloadMatch = script.match(/const payload = (.*?);/s)
        expect(payloadMatch).not.toBeNull()
        const payload = JSON.parse(payloadMatch?.[1] ?? '{}')
        expect(payload.remoteDraftKnownFolderIds).toEqual(['game-88', 'knowledge-99'])
        expect(payload.remoteDraftBoundFolderIds).toEqual(['game-88', 'knowledge-99'])
        expect(payload.options.remoteDraftKnownFolderIds).toBeUndefined()
        expect(payload.options.includeRemoteOnlyDrafts).toBe(false)
        expect(script).toContain('"id":"game"')
        expect(script).not.toContain('"id":"knowledge"')
        return { ok: true, verified: true, ledgers: [{ ...game, bilibiliFolderId: 'game-88', bilibiliFolderIds: ['game-88'], bindingState: 'bound' as const }], steps: ['api:ledger:list'], missingTargets: [], message: '已备册' }
      })
    })

    await expect(requestRuntime({
      id: 'single-ledger-complete-observation-coverage', type: 'ensure-ledger', logicalFolderId: 'bilimi-logical:game'
    })).resolves.toMatchObject({ ok: true })
  })

  it('runs the confirmed creation path instead of repeating an empty binding preview', async () => {
    const accountMid = '100'
    const music = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      // A successful backup now performs a separate authoritative status
      // refresh. Only the save script carries the creation-consent option;
      // the follow-up inventory is intentionally read-only.
      if (script.includes(LEDGER_SAVE_SCRIPT_MARKER)) {
        expect(script).toContain('"confirmCreateAndBind":true')
      }
      return {
        ok: true,
        verified: true,
        ledgers: [{ ...music, bilibiliFolderId: '9001', bindingState: 'bound' as const }],
        steps: ['api:ledger:list', 'api:ledger:create:music'], missingTargets: [],
        missingLedgerIds: [], message: '册目已备齐。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'confirmed-empty-candidate-create', type: 'save-ledgers', ledgers: [music],
      options: { deleteDisabled: false, confirmCreateAndBind: true }
    })).resolves.toMatchObject({ ok: true, verified: true, ledgers: [expect.objectContaining({ id: 'music', bindingState: 'bound' })] })

    expect(executeJavaScript).toHaveBeenCalled()
  })

  it('does not refresh the current Bilibili favorite space when formal binding after a confirmed create fails', async () => {
    const accountMid = '100'
    const music = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh,
      // A page reload would invalidate the page target needed by this
      // separate repository registration, so it must not happen first.
      adoptFavoriteRepositoryLedgerBinding: vi.fn().mockRejectedValue(new Error('remote shard is absent from inventory'))
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (!script.includes(LEDGER_SAVE_SCRIPT_MARKER)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
        return {
          ok: true,
          verified: true,
          ledgers: [{ ...music, bilibiliFolderId: '9001', bilibiliFolderIds: ['9001'], bindingState: 'bound' as const }],
          steps: ['api:ledger:list', 'api:ledger:create:music'],
          missingTargets: [],
          message: '收藏夹已创建，等待正式绑定。'
        }
      })
    })

    await expect(requestRuntime({
      id: 'skip-refresh-when-confirmed-created-folder-binding-fails', type: 'save-ledgers', ledgers: [music],
      options: { deleteDisabled: false, confirmCreateAndBind: true }
    })).resolves.toMatchObject({ ok: false })

    expect(retryBilibiliFavoriteSpaceRefresh).not.toHaveBeenCalled()
  })

  it('defers a page create signal until the programmatic folder has formally bound', async () => {
    const accountMid = '100'
    const music = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!
    const events: string[] = []
    let finishBinding: (() => void) | undefined
    const binding = new Promise<void>((resolve) => { finishBinding = resolve })
    const retryBilibiliFavoriteSpaceRefresh = vi.fn(async () => {
      events.push('refresh')
      return { status: 'idle' as const }
    })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn(async () => {
      events.push('bind:start')
      await binding
      events.push('bind:done')
    })
    const { requestRuntimeDirect } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh,
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (isLedgerStatusScript(script)) return {
          ...emptyLedgerStatus(),
          ledgers: [{ ...music, bilibiliFolderId: '9001', bilibiliFolderIds: ['9001'], bindingState: 'bound' as const }]
        }
        if (!script.includes(LEDGER_SAVE_SCRIPT_MARKER)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
        webview.dispatchEvent(new CustomEvent('page-title-updated', {
          detail: {
            title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid, kind: 'create', nonce: 7 }))}`
          }
        }))
        return {
          ok: true,
          verified: true,
          ledgers: [{ ...music, bilibiliFolderId: '9001', bilibiliFolderIds: ['9001'], bindingState: 'bound' as const }],
          steps: ['api:ledger:list', 'api:ledger:create:music'],
          missingTargets: []
        }
      })
    })
    await act(async () => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://space.bilibili.com/100/favlist' }
      }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const completion = requestRuntimeDirect({
      id: 'defer-page-create-signal-until-formal-binding', type: 'save-ledgers', ledgers: [music],
      options: { deleteDisabled: false, confirmCreateAndBind: true }
    })
    await waitFor(() => expect(events).toEqual(['bind:start']))
    await Promise.resolve()
    expect(retryBilibiliFavoriteSpaceRefresh).not.toHaveBeenCalled()

    finishBinding?.()
    await expect(completion).resolves.toMatchObject({ ok: true })
    expect(events).toEqual(['bind:start', 'bind:done', 'refresh'])
  })

  it('defers managed deletion observer refresh until the matching run ends', async () => {
    const observation = { folderId: '91', title: 'bilimi·删除完成发现', memberCount: 1 }
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const app = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      retryBilibiliFavoriteSpaceRefresh
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      getWebContentsId: () => 101,
      executeJavaScript: vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) return { ...emptyLedgerStatus(), remoteObservations: [observation] }
        return '100'
      })
    })
    act(() => webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
      detail: { url: 'https://space.bilibili.com/100/favlist' }
    })))
    const binding = await app.requestRuntime({
      id: 'bind-delete-target', type: 'favorite-repository-bind-page-target', accountMid: '100', runId: 'delete-run'
    })
    if (!binding || typeof binding !== 'object' || !('target' in binding) || !binding.target) throw new Error('missing delete target')
    await expect(app.requestRuntime({
      id: 'begin-delete-deferral', type: 'begin-managed-folder-deletion-refresh-deferral', accountMid: '100', runId: 'delete-run',
      target: binding.target
    } as AssistantRuntimeRequest)).resolves.toMatchObject({ status: 'ok' })

    act(() => webview.dispatchEvent(new CustomEvent('page-title-updated', {
      detail: { title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid: '100', kind: 'delete', nonce: 91 }))}` }
    })))
    await Promise.resolve()
    expect(retryBilibiliFavoriteSpaceRefresh).not.toHaveBeenCalled()

    await expect(app.requestRuntime({
      id: 'end-delete-deferral', type: 'end-managed-folder-deletion-refresh-deferral', accountMid: '100', runId: 'delete-run'
    } as AssistantRuntimeRequest)).resolves.toMatchObject({ refreshDeferred: true })

    app.notifyFavoriteSpaceRefreshStatusChanged({ accountMid: '100', status: 'idle' })
    await waitFor(() => expect(webview.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"includeRemoteOnlyDrafts":true')
    ))
    await expect(app.requestRuntime({ id: 'deferred-delete-discovery-snapshot', type: 'snapshot' })).resolves.toMatchObject({
      favoriteLedgerStatus: expect.objectContaining({ remoteObservations: [observation] })
    })

    act(() => webview.dispatchEvent(new CustomEvent('page-title-updated', {
      detail: { title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid: '100', kind: 'delete', nonce: 92 }))}` }
    })))
    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith('100'))
  })

  it('reconciles remote discovery after a confirmed favorite-space mutation', async () => {
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const remoteDraft = {
      id: 'custom-remote-78', displayName: 'bilimi·远端草稿', keywords: [], enabled: false, priority: 99,
      bilibiliFolderId: '78', bilibiliFolderIds: ['78'], bindingState: 'unbound' as const,
      syncState: 'local-draft' as const, isDefault: false
    }
    const { desktopApi } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      retryBilibiliFavoriteSpaceRefresh,
      savePreferences
    })
    await waitFor(() => expect(desktopApi.loadPreferences).toHaveBeenCalled())
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (!isLedgerStatusScript(script)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
        return {
          ...emptyLedgerStatus(),
          ledgers: [...createDefaultFavoriteLedgers(), remoteDraft],
          remoteOnlyDraftLedgerIds: [remoteDraft.id]
        }
      })
    })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://space.bilibili.com/100/favlist' }
      }))
      webview.dispatchEvent(new CustomEvent('page-title-updated', {
        detail: {
          title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid: '100', kind: 'create', nonce: 1 }))}`
        }
      }))
    })
    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith('100'))
    expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(webview.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"includeRemoteOnlyDrafts":true')
    ))
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        100: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([expect.objectContaining({ id: remoteDraft.id })])
        })
      })
    })))
  })

  it('publishes manual favorite rename observations to the assistant snapshot without a B站 write', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: '4106106611', bilibiliFolderIds: ['4106106611'], bindingState: 'bound' as const
    }
    const observation = { folderId: '88', title: 'bilimi·远端观察', memberCount: 2 }
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const { desktopApi, notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-08T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·旧游戏', remoteMemberCount: 2, bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    await waitFor(() => expect(desktopApi.loadPreferences).toHaveBeenCalled())
    notifyPreferencesChanged(createAppPreferences({ favoriteLedgers: [game] }))
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) return { ...emptyLedgerStatus(), ledgers: [game], remoteObservations: [observation] }
      if (script.includes('已绑定收藏夹改名预检')) return {
        ok: true, verified: true,
        observedShards: [{
          logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
          currentRemoteTitle: 'bilimi·旧游戏', remoteMemberCount: 2
        }]
      }
      throw new Error(`Unexpected B站 write script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })
    await act(async () => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://space.bilibili.com/100/favlist' }
      }))
      await Promise.resolve()
      await Promise.resolve()
    })
    ;(desktopApi.notifyAssistantSnapshotChanged as ReturnType<typeof vi.fn>).mockClear()

    act(() => {
      webview.dispatchEvent(new CustomEvent('page-title-updated', {
        detail: {
          title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid, kind: 'rename', nonce: 4 }))}`
        }
      }))
    })

    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith(accountMid))
    await waitFor(() => expect(executeJavaScript.mock.calls.some(([script]) => String(script).includes('已绑定收藏夹改名预检'))).toBe(true))
    await waitFor(() => expect(desktopApi.notifyAssistantSnapshotChanged).toHaveBeenCalled())
    await expect(requestRuntime({ id: 'manual-rename-observation-snapshot', type: 'snapshot' })).resolves.toMatchObject({
      favoriteLedgerStatus: expect.objectContaining({
        remoteObservations: [observation],
        boundRenameCandidates: [expect.objectContaining({
          ledgerId: 'game',
          shards: [expect.objectContaining({ currentRemoteTitle: 'bilimi·旧游戏', targetTitle: game.displayName })]
        })]
      })
    })
    expect(executeJavaScript.mock.calls.map(([script]) => String(script))).not.toContain(
      expect.stringContaining(LEDGER_SAVE_SCRIPT_MARKER)
    )
  })

  it.each(['create', 'rename'] as const)('retries a pending manual favorite %s discovery when the same account refresh later becomes idle', async (kind) => {
    const accountMid = '100'
    const observation = { folderId: '88', title: 'bilimi·刷新后发现', memberCount: 2 }
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'pending' as const })
    const { desktopApi, notifyFavoriteSpaceRefreshStatusChanged, requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh
    })
    await waitFor(() => expect(desktopApi.loadPreferences).toHaveBeenCalled())
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (!isLedgerStatusScript(script)) throw new Error(`Unexpected B站 write script: ${script.slice(0, 80)}`)
      return { ...emptyLedgerStatus(), remoteObservations: [observation] }
    })
    Object.assign(webview, { executeJavaScript })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://space.bilibili.com/100/favlist' }
      }))
      webview.dispatchEvent(new CustomEvent('page-title-updated', {
        detail: {
          title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid, kind, nonce: 5 }))}`
        }
      }))
    })

    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith(accountMid))
    expect(executeJavaScript.mock.calls.some(([script]) => isLedgerStatusScript(String(script)))).toBe(false)

    notifyFavoriteSpaceRefreshStatusChanged({ accountMid, status: 'idle' })

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"includeRemoteOnlyDrafts":true')
    ))
    await waitFor(() => expect(desktopApi.notifyAssistantSnapshotChanged).toHaveBeenCalled())
    await expect(requestRuntime({ id: 'pending-manual-rename-observation-snapshot', type: 'snapshot' })).resolves.toMatchObject({
      favoriteLedgerStatus: expect.objectContaining({ remoteObservations: [observation] })
    })
    expect(executeJavaScript.mock.calls.map(([script]) => String(script))).not.toContain(
      expect.stringContaining(LEDGER_SAVE_SCRIPT_MARKER)
    )
  })

  it('does not discover remote drafts until a confirmed favorite-space refresh is idle', async () => {
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'pending' as const })
    const { desktopApi } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      retryBilibiliFavoriteSpaceRefresh
    })
    await waitFor(() => expect(desktopApi.loadPreferences).toHaveBeenCalled())
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (!isLedgerStatusScript(script)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      return emptyLedgerStatus()
    })
    Object.assign(webview, { executeJavaScript })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://space.bilibili.com/100/favlist' }
      }))
      webview.dispatchEvent(new CustomEvent('page-title-updated', {
        detail: {
          title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid: '100', kind: 'rename', nonce: 2 }))}`
        }
      }))
    })

    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith('100'))
    expect(executeJavaScript.mock.calls.some(([script]) => isLedgerStatusScript(String(script)))).toBe(false)
  })

  it('does not discover remote drafts when a confirmed favorite-space refresh fails', async () => {
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockRejectedValue(new Error('favorite page reload failed'))
    const { desktopApi } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      retryBilibiliFavoriteSpaceRefresh
    })
    await waitFor(() => expect(desktopApi.loadPreferences).toHaveBeenCalled())
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (!isLedgerStatusScript(script)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      return emptyLedgerStatus()
    })
    Object.assign(webview, { executeJavaScript })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://space.bilibili.com/100/favlist' }
      }))
      webview.dispatchEvent(new CustomEvent('page-title-updated', {
        detail: {
          title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid: '100', kind: 'delete', nonce: 3 }))}`
        }
      }))
    })

    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith('100'))
    expect(executeJavaScript.mock.calls.some(([script]) => isLedgerStatusScript(String(script)))).toBe(false)
  })

  it('publishes manual favorite discovery after a confirmed delete refresh', async () => {
    const accountMid = '100'
    const observation = { folderId: '88', title: 'bilimi·删除后发现', memberCount: 2 }
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (!isLedgerStatusScript(script)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      return { ...emptyLedgerStatus(), remoteObservations: [observation] }
    })
    Object.assign(webview, { executeJavaScript })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: `https://space.bilibili.com/${accountMid}/favlist` }
      }))
      webview.dispatchEvent(new CustomEvent('page-title-updated', {
        detail: {
          title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid, kind: 'delete', nonce: 7 }))}`
        }
      }))
    })

    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith(accountMid))
    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"includeRemoteOnlyDrafts":true')
    ))
    await expect(requestRuntime({ id: 'manual-delete-observation-snapshot', type: 'snapshot' })).resolves.toMatchObject({
      favoriteLedgerStatus: expect.objectContaining({ remoteObservations: [observation] })
    })
  })

  it('publishes manual favorite discovery after an ordinary favorite-space refresh', async () => {
    const accountMid = '100'
    const observation = { folderId: '89', title: 'bilimi·刷新后发现', memberCount: 1 }
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      reload?: () => void
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const reload = vi.fn()
    const executeJavaScript = vi.fn(async (script: string) => {
      if (!isLedgerStatusScript(script)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      return { ...emptyLedgerStatus(), remoteObservations: [observation] }
    })
    Object.assign(webview, { reload, executeJavaScript })
    await act(async () => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: `https://space.bilibili.com/${accountMid}/favlist` }
      }))
      await Promise.resolve()
    })
    ;(desktopApi.notifyAssistantSnapshotChanged as ReturnType<typeof vi.fn>).mockClear()

    fireEvent.click(screen.getByRole('button', { name: '刷新当前网页' }))

    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith(accountMid))
    expect(reload).not.toHaveBeenCalled()
    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"includeRemoteOnlyDrafts":true')
    ))
    await waitFor(() => expect(desktopApi.notifyAssistantSnapshotChanged).toHaveBeenCalled())
    await expect(requestRuntime({ id: 'ordinary-refresh-observation-snapshot', type: 'snapshot' })).resolves.toMatchObject({
      favoriteLedgerStatus: expect.objectContaining({ remoteObservations: [observation] })
    })
  })

  it('clears a dismissed discovery notice only after a verified manual discovery refresh', async () => {
    const accountMid = '100'
    const observation = { folderId: '901', title: 'bilimi·唤醒发现', memberCount: 1 }
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const patchPreferences = vi.fn(async (patch: Partial<AssistantPreferences>) => createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: createDefaultFavoriteLedgers(),
          ...(patch.favoriteAccountPreferences?.[accountMid] ?? {})
        }
      }
    }))
    const loadPreferences = vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: {
            defaultFavoriteSystemEnabled: true,
            favoriteLedgers: createDefaultFavoriteLedgers(),
            favoriteDiscoveryNoticeDismissed: true
          }
        }
      }))
    const { desktopApi } = renderAppWithRuntimeBridge({
      loadPreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh,
      patchPreferences
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (!isLedgerStatusScript(script)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
        return { ...emptyLedgerStatus(), remoteObservations: [observation] }
      })
    })
    await waitFor(() => expect(loadPreferences).toHaveBeenCalled())
    await act(async () => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: `https://space.bilibili.com/${accountMid}/favlist` }
      }))
      await Promise.resolve()
    })
    await waitFor(() => expect(desktopApi.loadPreferences).toHaveBeenCalled())

    act(() => webview.dispatchEvent(new CustomEvent('page-title-updated', {
      detail: {
        title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid, kind: 'rename', nonce: 901 }))}`
      }
    })))

    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith(accountMid))
    await waitFor(() => expect(patchPreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.not.objectContaining({ favoriteDiscoveryNoticeDismissed: true })
      })
    })))
  })

  it('keeps pending discovery when the favorite-space reload navigates and clears the cached account', async () => {
    const accountMid = '100'
    const observation = { folderId: '90', title: 'bilimi·导航后发现', memberCount: 1 }
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'pending' as const })
    const { desktopApi, requestRuntime, notifyFavoriteSpaceRefreshStatusChanged } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (!isLedgerStatusScript(script)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      return { ...emptyLedgerStatus(), remoteObservations: [observation] }
    })
    Object.assign(webview, { executeJavaScript })
    await act(async () => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: `https://space.bilibili.com/${accountMid}/favlist` }
      }))
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: '刷新当前网页' }))
    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith(accountMid))

    // A real reload emits a navigation event before the main-process refresh
    // coordinator reports idle. This currently clears the account cache and
    // causes the idle listener to discard the pending discovery.
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: `https://space.bilibili.com/${accountMid}/favlist` }
      }))
    })
    act(() => notifyFavoriteSpaceRefreshStatusChanged({ accountMid, status: 'idle' }))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"includeRemoteOnlyDrafts":true')
    ))
    await waitFor(() => expect(desktopApi.notifyAssistantSnapshotChanged).toHaveBeenCalled())
    await expect(requestRuntime({ id: 'navigation-refresh-observation-snapshot', type: 'snapshot' })).resolves.toMatchObject({
      favoriteLedgerStatus: expect.objectContaining({ remoteObservations: [observation] })
    })
  })

  it('keeps the latest verified discovery notice when switching away from the favorite page', async () => {
    const accountMid = '100'
    const observation = { folderId: '902', title: 'bilimi·跨网页发现', memberCount: 1 }
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    let onFavoritePage = true
    const executeJavaScript = vi.fn(async (script: string) => {
      if (!isLedgerStatusScript(script)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      return onFavoritePage ? { ...emptyLedgerStatus(), remoteObservations: [observation] } : emptyLedgerStatus()
    })
    Object.assign(webview, { executeJavaScript })

    await act(async () => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: `https://space.bilibili.com/${accountMid}/favlist` }
      }))
      await Promise.resolve()
    })
    act(() => webview.dispatchEvent(new CustomEvent('page-title-updated', {
      detail: {
        title: `__BILIMI_FAVORITE_SPACE_MUTATION__:${encodeURIComponent(JSON.stringify({ accountMid, kind: 'rename', nonce: 902 }))}`
      }
    })))
    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith(accountMid))
    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('"includeRemoteOnlyDrafts":true')))
    await expect(requestRuntime({ id: 'favorite-page-discovery-before-switch', type: 'snapshot' })).resolves.toMatchObject({
      favoriteLedgerStatus: expect.objectContaining({ remoteObservations: [observation] })
    })

    onFavoritePage = false
    act(() => webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
      detail: { url: `https://www.bilibili.com/video/BV1crosspage` }
    })))
    await expect(requestRuntime({ id: 'ordinary-page-discovery-after-switch', type: 'snapshot' })).resolves.toMatchObject({
      favoriteLedgerStatus: expect.objectContaining({ remoteObservations: [observation] })
    })
  })

  it('does not publish manual favorite discovery for an ordinary non-favorite refresh', async () => {
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const { desktopApi } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      retryBilibiliFavoriteSpaceRefresh
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      reload?: () => void
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const reload = vi.fn()
    const executeJavaScript = vi.fn()
    Object.assign(webview, { reload, executeJavaScript })
    fireEvent.click(screen.getByRole('button', { name: '刷新当前网页' }))

    expect(reload).toHaveBeenCalledTimes(1)
    expect(desktopApi.retryBilibiliFavoriteSpaceRefresh).not.toHaveBeenCalled()
    expect(executeJavaScript).not.toHaveBeenCalled()
    expect(desktopApi.notifyAssistantSnapshotChanged).not.toHaveBeenCalled()
  })

  it('does not publish manual favorite discovery when an ordinary favorite-space refresh fails', async () => {
    const accountMid = '100'
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockRejectedValue(new Error('favorite page reload failed'))
    const { desktopApi } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async () => true)
    Object.assign(webview, { executeJavaScript })
    await act(async () => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: `https://space.bilibili.com/${accountMid}/favlist` }
      }))
      await Promise.resolve()
    })
    executeJavaScript.mockClear()
    ;(desktopApi.notifyAssistantSnapshotChanged as ReturnType<typeof vi.fn>).mockClear()

    fireEvent.click(screen.getByRole('button', { name: '刷新当前网页' }))

    await waitFor(() => expect(retryBilibiliFavoriteSpaceRefresh).toHaveBeenCalledWith(accountMid))
    expect(executeJavaScript.mock.calls.some(([script]) => isLedgerStatusScript(String(script)))).toBe(false)
    expect(desktopApi.notifyAssistantSnapshotChanged).not.toHaveBeenCalled()
  })

  it('does not refresh the Bilibili favorite space when backup reports no created folder', async () => {
    const accountMid = '100'
    const music = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!
    const retryBilibiliFavoriteSpaceRefresh = vi.fn().mockResolvedValue({ status: 'idle' as const })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      retryBilibiliFavoriteSpaceRefresh
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (!script.includes(LEDGER_SAVE_SCRIPT_MARKER)) throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
        return {
          ok: true,
          verified: true,
          ledgers: [{ ...music, bilibiliFolderId: '9001', bilibiliFolderIds: ['9001'], bindingState: 'bound' as const }],
          steps: ['api:ledger:list'],
          missingTargets: [],
          message: '仅完成目录读取。'
        }
      })
    })

    await expect(requestRuntime({
      id: 'skip-refresh-without-created-folder', type: 'save-ledgers', ledgers: [music],
      options: { deleteDisabled: false }
    })).resolves.toMatchObject({ ok: false })

    expect(retryBilibiliFavoriteSpaceRefresh).not.toHaveBeenCalled()
  })

  it('does not persist an intermediate remote-only draft alongside an all-batch binding candidate', async () => {
    const accountMid = '100'
    const music = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!
    const remoteDraft = {
      id: 'custom-remote-78', displayName: 'bilimi·远端草稿', keywords: [], enabled: false, priority: 99,
      bilibiliFolderId: '78', bilibiliFolderIds: ['78'], bindingState: 'unbound' as const,
      syncState: 'local-draft' as const, isDefault: false
    }
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      savePreferences
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      expect(script).toContain('/x/v3/fav/folder/created/list-all')
      return {
        ok: false,
        ledgers: [{ ...music, bindingState: 'unbound' as const }, remoteDraft],
        steps: ['api:ledger:list'],
        missingTargets: [music.id],
        unboundLedgerIds: [music.id],
        unboundCandidates: [{ ledgerId: music.id, candidates: [{ id: '77', title: music.displayName, memberCount: 0 }] }],
        remoteOnlyDraftLedgerIds: [remoteDraft.id],
        message: '发现未绑定的 bilimi 收藏夹，请确认要重新绑定的候选收藏夹。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'candidate-backup-persists-remote-draft', type: 'save-ledgers', ledgers: [music],
      options: { deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({
      ok: false,
      unboundCandidates: [{ ledgerId: music.id }]
    })

    expect(executeJavaScript).toHaveBeenCalled()
    expect(savePreferences).not.toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([expect.objectContaining({ id: remoteDraft.id, syncState: 'local-draft' })])
        })
      })
    }))
  })

  it('publishes only the final remote-discovery projection after backup', async () => {
    const accountMid = '100'
    const music = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!
    const remoteDraft = {
      id: 'custom-remote-78', displayName: 'bilimi·远端草稿', keywords: [], enabled: false, priority: 99,
      bilibiliFolderId: '78', bilibiliFolderIds: ['78'], bindingState: 'unbound' as const,
      syncState: 'local-draft' as const, isDefault: false
    }
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      savePreferences
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (script.includes(LEDGER_SAVE_SCRIPT_MARKER)) {
          expect(script).toContain('"includeRemoteOnlyDrafts":false')
          return {
            ok: true,
            verified: true,
            ledgers: [{ ...music, bilibiliFolderId: '9001', bindingState: 'bound' as const }, remoteDraft],
            steps: ['api:ledger:list', 'api:ledger:create:music'],
            missingTargets: [],
            remoteOnlyDraftLedgerIds: [remoteDraft.id],
            message: '收藏夹已备册。'
          }
        }
        if (isLedgerStatusScript(script)) {
          expect(script).toContain('"includeRemoteOnlyDrafts":true')
          return {
            ...emptyLedgerStatus(),
            ledgers: [{ ...music, bilibiliFolderId: '9001', bindingState: 'bound' as const }],
            remoteOnlyDraftLedgerIds: []
          }
        }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await expect(requestRuntime({
      id: 'created-backup-persists-remote-draft', type: 'save-ledgers', ledgers: [music],
      options: { backupTargetLedgerIds: [music.id], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({
      ok: true,
      verified: true,
      remoteOnlyDraftLedgerIds: [],
      ledgers: expect.not.arrayContaining([expect.objectContaining({ id: remoteDraft.id })])
    })

    expect(savePreferences).not.toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([expect.objectContaining({ id: remoteDraft.id })])
        })
      })
    }))
  })

  it('returns remote observations from a read-only backup preflight without running a B站 write script', async () => {
    const accountMid = '100'
    const music = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!
    const observation = { folderId: '88', title: 'bilimi·远端观察', memberCount: 2 }
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) {
        expect(script).toContain('"includeRemoteOnlyDrafts":true')
        return { ...emptyLedgerStatus(), remoteObservations: [observation] }
      }
      throw new Error(`Unexpected write script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'remote-observation-preflight', type: 'save-ledgers', ledgers: [music],
      options: {
        backupTargetLedgerIds: [music.id],
        deleteDisabled: false,
        rediscoverDeletedRemoteDrafts: true,
        remoteObservationPreflight: true
      }
    })).resolves.toMatchObject({
      ok: true,
      steps: ['favorite:remote-observation-preflight'],
      remoteObservations: [observation]
    })
    expect(executeJavaScript.mock.calls.map(([script]) => String(script))).not.toContain(
      expect.stringContaining(LEDGER_SAVE_SCRIPT_MARKER)
    )
  })

  it('does not turn an unbacked backup target into a create-confirmation candidate', async () => {
    const accountMid = '100'
    const meilin = {
      id: 'meilin', displayName: 'bilimi·梅林FIT', keywords: ['梅林'], enabled: true, priority: 1,
      isDefault: false, ruleOrigin: 'saved-rule' as const, bindingState: 'unbacked' as const
    }
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: { [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [meilin] } }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (isLedgerStatusScript(script)) {
          return {
            ...emptyLedgerStatus(), ledgers: [meilin], missingLedgerIds: ['meilin'],
            message: '发现尚未备册的 bilimi 收藏夹。'
          }
        }
        throw new Error(`Unexpected write script: ${script.slice(0, 80)}`)
      })
    })

    await expect(requestRuntime({
      id: 'unbacked-backup-preflight', type: 'save-ledgers', ledgers: [meilin],
      options: {
        backupTargetLedgerIds: ['meilin'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true,
        remoteObservationPreflight: true
      }
    })).resolves.toMatchObject({
      ok: true,
      unboundCandidates: [],
      remoteObservations: []
    })
  })

  it('returns remote observations and bound rename candidates together during backup discovery', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bindingState: 'bound' as const
    }
    const observation = { folderId: '88', title: 'bilimi·远端观察', memberCount: 2 }
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-04T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·旧游戏专区', remoteMemberCount: 0, bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) {
        expect(script).toContain('"includeRemoteOnlyDrafts":true')
        return { ...emptyLedgerStatus(), ledgers: [game], remoteObservations: [observation] }
      }
      if (script.includes('已绑定收藏夹改名预检')) {
        return {
          ok: true,
          verified: true,
          observedShards: [{
            logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
            currentRemoteTitle: 'bilimi·旧游戏专区', remoteMemberCount: 0
          }]
        }
      }
      throw new Error(`Unexpected non-status preflight: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'remote-observation-before-bound-rename', type: 'save-ledgers', ledgers: [game],
      options: {
        backupTargetLedgerIds: [game.id], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true,
        remoteObservationPreflight: true
      }
    })).resolves.toMatchObject({
      ok: true,
      steps: ['favorite:remote-observation-preflight'],
      remoteObservations: [observation],
      boundRenameCandidates: [{
        ledgerId: 'game', logicalTitle: game.displayName, logicalVideoCount: 0,
        shards: [{
          remoteFolderId: '4106106611', shardNumber: 1, currentRemoteTitle: 'bilimi·旧游戏专区',
          remoteMemberCount: 0, targetTitle: game.displayName
        }]
      }]
    })
    expect(executeJavaScript.mock.calls.map(([script]) => String(script))).not.toContain(
      expect.stringContaining(LEDGER_SAVE_SCRIPT_MARKER)
    )
  })

  it('registers rebinding shards from their explicit numeric titles instead of selection order', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'bound' }],
        steps: ['api:ledger:list'], missingTargets: [], message: 'ok'
      }))
    })

    await expect(requestRuntime({
      id: 'rebind-out-of-order', type: 'save-ledgers', ledgers: [game],
      options: {
        rebindRemoteFolderIds: { game: '88' },
        rebindRemoteFolders: { game: [
          { id: '89', title: 'bilimi·游戏专区②' },
          { id: '88', title: 'bilimi·游戏专区' }
        ] }
      }
    })).resolves.toMatchObject({ ok: true })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenNthCalledWith(1, accountMid, expect.objectContaining({
      remoteFolderId: '89', shardNumber: 2
    }))
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenNthCalledWith(2, accountMid, expect.objectContaining({
      remoteFolderId: '88', shardNumber: 1
    }))
  })

  it('registers manual circled rebind shards with their shared physical numbers', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'bound' }],
        steps: ['api:ledger:list'], missingTargets: [], message: 'ok'
      }))
    })

    await expect(requestRuntime({
      id: 'rebind-circled-shards', type: 'save-ledgers', ledgers: [game],
      options: {
        rebindRemoteFolderIds: { game: '88' },
        rebindRemoteFolders: { game: [
          { id: '89', title: 'bilimi·游戏专区②' },
          { id: '88', title: 'bilimi·游戏专区' }
        ] }
      }
    })).resolves.toMatchObject({ ok: true })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenNthCalledWith(1, accountMid, expect.objectContaining({
      remoteFolderId: '89', shardNumber: 2
    }))
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenNthCalledWith(2, accountMid, expect.objectContaining({
      remoteFolderId: '88', shardNumber: 1
    }))
  })

  it('forwards an explicitly selected remote folder for binding without rename authority', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈'
    }
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue({
      shards: [{
        logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
        remoteFolderId: '88', remoteTitle: 'bilimi·游戏专区哈哈', bindingState: 'bound'
      }]
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'bound' as const }],
        steps: ['api:ledger:list'], missingTargets: [], message: '已备册'
      }))
    })

    await expect(requestRuntime({
      id: 'rename-on-explicit-rebind', type: 'save-ledgers', ledgers: [game],
      options: {
        rebindRemoteFolderIds: { game: '88' },
        rebindRemoteFolders: { game: [{ id: '88', title: 'bilimi·旧游戏专区', memberCount: 0 }] }
      }
    })).resolves.toMatchObject({
      ok: true
    })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'game', remoteFolderId: '88', remoteTitle: 'bilimi·旧游戏专区'
    }))
    expect(adoptFavoriteRepositoryLedgerBinding.mock.calls.at(-1)?.[1]).not.toHaveProperty('allowRemoteRename')
  })

  it('renames an already formal bound shard without running a backup when renameBoundOnly is confirmed', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn().mockResolvedValue({
      shards: [{
        logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
        remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区哈哈',
        bindingState: 'bound', remoteMemberCount: 0
      }]
    })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      renameFavoriteRepositoryBoundLedgerShard,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-04T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
        if (script.includes('已绑定收藏夹改名预检')) {
          return {
            ok: true,
            verified: true,
            observedShards: [{
              logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
              currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0
            }]
          }
        }
        return {
          ok: true,
          verified: true,
          ledgers: [{ ...game, bilibiliFolderTitle: 'bilimi·游戏专区哈哈' }],
          steps: ['api:ledger:list'], missingTargets: [], message: '已备册'
        }
      })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'rename-existing-bound-game', type: 'save-ledgers', ledgers: [game],
      options: {
        backupTargetLedgerIds: ['game'],
        rediscoverDeletedRemoteDrafts: true,
        renameBoundOnly: true,
        confirmBoundRename: true,
        boundRenameShards: { game: [{ remoteFolderId: '4106106611', shardNumber: 1 }] }
      }
    })).resolves.toMatchObject({
      ok: true,
      ledgers: expect.arrayContaining([expect.objectContaining({
        id: 'game', bindingState: 'bound', bilibiliFolderId: '4106106611',
        bilibiliFolderTitle: 'bilimi·游戏专区哈哈'
      })])
    })

    expect(renameFavoriteRepositoryBoundLedgerShard).toHaveBeenCalledWith(accountMid, {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', remoteFolderId: '4106106611', shardNumber: 1,
      currentRemoteTitle: 'bilimi·游戏专区', targetTitle: 'bilimi·游戏专区哈哈'
    })
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
    expect(executeJavaScript.mock.calls.some(([script]) => String(script).includes(LEDGER_SAVE_SCRIPT_MARKER))).toBe(false)
    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([
            expect.objectContaining({ id: 'game', bindingState: 'bound', bilibiliFolderTitle: 'bilimi·游戏专区哈哈' })
          ])
        })
      })
    }))
  })

  it('continues a confirmed bound rename when the authority snapshot confirms an incomplete IPC receipt', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const repositorySummary = (remoteTitle: string) => ({
      version: 1,
      accountMid,
      revision: 1,
      updatedAt: '2026-09-07T00:00:00.000Z',
      videoCount: 0,
      folderCount: 1,
      folders: [],
      folderCounts: {},
      scopeCounts: {},
      physicalShardCount: 1,
      physicalShards: [{
        logicalLedgerId: 'game',
        folderId: 'bilimi:game:001',
        shardNumber: 1,
        remoteFolderId: '4106106611',
        remoteTitle,
        remoteMemberCount: 0,
        bindingState: 'bound' as const
      }],
      syncRecordCount: 0,
      syncCounts: {},
      pendingAidCount: 0,
      remoteReconciliations: []
    })
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn().mockResolvedValue({ shards: [] })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const openFavoriteRepositoryAccount = vi.fn(async () => {
      const renamed = renameFavoriteRepositoryBoundLedgerShard.mock.calls.length > 0
      return repositorySummary(renamed ? 'bilimi·游戏专区哈哈' : 'bilimi·游戏专区')
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) {
        return {
          ok: false,
          verified: true,
          ledgers: [{ ...game, bindingState: 'unbacked' as const }],
          missingLedgerIds: ['game'],
          unboundLedgerIds: [],
          backupConflictLedgerIds: [],
          message: '发现尚未备册的 bilimi 收藏夹，请在备册时完成确认。'
        }
      }
      if (script.includes('已绑定收藏夹改名预检')) {
        return {
          ok: true,
          verified: true,
          observedShards: [{
            logicalLedgerId: 'game',
            shardNumber: 1,
            remoteFolderId: '4106106611',
            currentRemoteTitle: 'bilimi·游戏专区',
            remoteMemberCount: 0
          }]
        }
      }
      return {
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderTitle: 'bilimi·游戏专区哈哈' }],
        steps: ['api:ledger:list'],
        missingTargets: [],
        message: '已备册'
      }
    })
    Object.assign(webview, { executeJavaScript })

    const result = await requestRuntime({
      id: 'confirmed-bound-rename-incomplete-receipt',
      type: 'save-ledgers',
      ledgers: [game],
      options: {
        backupTargetLedgerIds: ['game'],
        rediscoverDeletedRemoteDrafts: true,
        confirmBoundRename: true,
        boundRenameShards: { game: [{ remoteFolderId: '4106106611', shardNumber: 1 }] }
      }
    })
    expect(result).toMatchObject({
      ok: true,
      ledgers: expect.arrayContaining([expect.objectContaining({
        id: 'game',
        bindingState: 'bound',
        bilibiliFolderId: '4106106611',
        bilibiliFolderTitle: 'bilimi·游戏专区哈哈'
      })])
    })
    expect(result.steps).not.toContain('api:ledger:create:game')

    expect(renameFavoriteRepositoryBoundLedgerShard).toHaveBeenCalledTimes(1)
    expect(renameFavoriteRepositoryBoundLedgerShard).toHaveBeenCalledWith(accountMid, {
      logicalLedgerId: 'game',
      logicalTitle: 'bilimi·游戏专区哈哈',
      remoteFolderId: '4106106611',
      shardNumber: 1,
      currentRemoteTitle: 'bilimi·游戏专区',
      targetTitle: 'bilimi·游戏专区哈哈'
    })
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
  })

  it('continues a dialog-confirmed rename without reading an authority snapshot', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn().mockResolvedValue({ shards: [] })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const openFavoriteRepositoryAccount = vi.fn().mockResolvedValue({
      version: 1, accountMid, revision: 1, updatedAt: '2026-09-07T00:00:00.000Z',
      videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
      physicalShardCount: 1,
      physicalShards: [{
        logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
        remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0,
        bindingState: 'bound' as const
      }],
      syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) {
        return {
          ok: false,
          verified: true,
          ledgers: [{ ...game, bindingState: 'unbacked' as const }],
          missingLedgerIds: ['game'],
          unboundLedgerIds: [],
          backupConflictLedgerIds: [],
          message: '发现尚未备册的 bilimi 收藏夹，请在备册时完成确认。'
        }
      }
      if (script.includes('已绑定收藏夹改名预检')) {
        return {
          ok: true,
          verified: true,
          observedShards: [{
            logicalLedgerId: 'game',
            shardNumber: 1,
            remoteFolderId: '4106106611',
            currentRemoteTitle: 'bilimi·游戏专区',
            remoteMemberCount: 0
          }]
        }
      }
      return {
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderTitle: 'bilimi·游戏专区哈哈' }],
        steps: ['api:ledger:list'], missingTargets: [], message: '已备册'
      }
    })
    Object.assign(webview, { executeJavaScript })
    await expect(requestRuntime({
      id: 'confirmed-bound-rename-unconfirmed-receipt',
      type: 'save-ledgers',
      ledgers: [game],
      options: {
        backupTargetLedgerIds: ['game'],
        rediscoverDeletedRemoteDrafts: true,
        confirmBoundRename: true,
        boundRenameShards: { game: [{
          remoteFolderId: '4106106611', shardNumber: 1,
          currentRemoteTitle: 'bilimi·游戏专区', targetTitle: 'bilimi·游戏专区哈哈'
        }] }
      }
    })).resolves.toMatchObject({ ok: true })

    expect(renameFavoriteRepositoryBoundLedgerShard).toHaveBeenCalledTimes(1)
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
    expect(executeJavaScript.mock.calls.filter(([script]) =>
      typeof script === 'string' && script.includes('已绑定收藏夹改名预检')
    )).toHaveLength(1)
    expect(openFavoriteRepositoryAccount).toHaveBeenCalledTimes(2)
  })

  it('returns a no-write confirmation preflight before renaming a title-different formal bound shard', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn()
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-04T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => script.includes('已绑定收藏夹改名预检')
      ? {
          ok: true,
          verified: true,
          observedShards: [{
            logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
            currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0
          }]
        }
      : { ok: true, verified: true, ledgers: [game], steps: ['api:ledger:add'], missingTargets: [], message: '已备册' })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'bound-rename-confirmation-preflight', type: 'save-ledgers', ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({
      ok: false,
      steps: ['favorite:bound-shard-rename-preflight'],
      boundRenameCandidates: [{
        ledgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', logicalVideoCount: 0,
        shards: [{ remoteFolderId: '4106106611', shardNumber: 1, currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, targetTitle: 'bilimi·游戏专区哈哈' }]
      }]
    })

    expect(renameFavoriteRepositoryBoundLedgerShard).not.toHaveBeenCalled()
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/folder/edit'))).toBe(false)
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/folder/add'))).toBe(false)
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/resource/deal'))).toBe(false)
  })

  it('does not rename an unchanged circled capacity shard when continuing a confirmed backup', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611', '4106106612'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-07T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 2,
        physicalShards: [
          { logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1, remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, bindingState: 'bound' },
          { logicalLedgerId: 'game', folderId: 'bilimi:game:002', shardNumber: 2, remoteFolderId: '4106106612', remoteTitle: 'bilimi·游戏专区②', remoteMemberCount: 0, bindingState: 'bound' }
        ],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (script.includes('已绑定收藏夹改名预检')) {
          return {
            ok: true,
            verified: true,
            observedShards: [
              { logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611', currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0 },
              { logicalLedgerId: 'game', shardNumber: 2, remoteFolderId: '4106106612', currentRemoteTitle: 'bilimi·游戏专区②', remoteMemberCount: 0 }
            ]
          }
        }
        return { ok: true, verified: true, ledgers: [game], steps: ['api:ledger:list'], missingTargets: [], message: '已备册' }
      })
    })

    await expect(requestRuntime({
      id: 'unchanged-circled-shard', type: 'save-ledgers', ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: true })

    expect(renameFavoriteRepositoryBoundLedgerShard).not.toHaveBeenCalled()
  })

  it('does not read an unchanged bound id during a name-based remote observation preflight', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn()
        .mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-08T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
        .mockResolvedValue({
          version: 1, accountMid, revision: 2, updatedAt: '2026-09-09T00:00:01.000Z',
          videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
          physicalShardCount: 2,
          physicalShards: [
            { logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1, remoteFolderId: 'new-main', remoteTitle: game.displayName, remoteMemberCount: 4, bindingState: 'bound' },
            { logicalLedgerId: 'game', folderId: 'bilimi:game:002', shardNumber: 2, remoteFolderId: 'bound-second', remoteTitle: `${game.displayName}②`, remoteMemberCount: 6, bindingState: 'bound' }
          ],
          syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
        })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (script.includes('已绑定收藏夹改名预检')) return { ok: false, verified: false }
      if (isLedgerStatusScript(script)) {
        return { ok: true, verified: true, ledgers: [game], missingLedgerIds: [], unboundLedgerIds: [], backupConflictLedgerIds: [], message: '册目查验已毕。' }
      }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'name-status-with-stale-bound-id', type: 'save-ledgers', ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], remoteObservationPreflight: true }
    })).resolves.toMatchObject({
      ok: true,
      verified: true,
      steps: ['favorite:remote-observation-preflight'],
      missingTargets: [],
      unboundLedgerIds: []
    })

    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('已绑定收藏夹改名预检'))).toBe(false)
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes(LEDGER_SAVE_SCRIPT_MARKER))).toBe(false)
  })

  it('fails closed when the exact bound-shard rename preflight cannot be verified', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn()
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-07T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (script.includes('已绑定收藏夹改名预检')) return { ok: false, verified: false }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'bound-rename-preflight-fails-closed', type: 'save-ledgers', ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({
      ok: false,
      steps: ['favorite:bound-shard-rename-preflight'],
      missingTargets: ['game'],
      message: '已绑定收藏夹名称核验失败，本次不执行 B 站收藏写入。'
    })

    expect(renameFavoriteRepositoryBoundLedgerShard).not.toHaveBeenCalled()
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/folder/edit'))).toBe(false)
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/folder/add'))).toBe(false)
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/resource/deal'))).toBe(false)
  })

  it('routes a missing formal id back to the existing unbound rebind flow', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: 'old-game',
      bilibiliFolderIds: ['old-game'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-12T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: 'old-game', remoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (script.includes('已绑定收藏夹改名预检')) {
        return {
          ok: false,
          verified: true,
          observedShards: [],
          missingRemoteFolderIds: ['old-game'],
          message: '已绑定的 B 站收藏夹未出现在当前清单中，请刷新后重试。'
        }
      }
      if (isLedgerStatusScript(script)) {
        return {
          ok: false,
          verified: true,
          ledgers: [{ ...game, bilibiliFolderId: 'new-game', bilibiliFolderIds: ['new-game'], bindingState: 'unbound' as const }],
          missingLedgerIds: ['game'],
          unboundLedgerIds: ['game'],
          unboundCandidates: [{ ledgerId: 'game', candidates: [{ id: 'new-game', title: 'bilimi·游戏专区', memberCount: 4 }] }],
          remoteOnlyDraftLedgerIds: [],
          remoteObservations: [],
          message: '发现未绑定的 bilimi 收藏夹，请确认要重新绑定的候选收藏夹。'
        }
      }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'missing-formal-id-rebind-flow',
      type: 'save-ledgers',
      ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], remoteObservationPreflight: true }
    })).resolves.toMatchObject({
      ok: false,
      verified: true,
      steps: ['favorite:remote-observation-preflight'],
      unboundLedgerIds: ['game'],
      unboundCandidates: [{ ledgerId: 'game', candidates: [{ id: 'new-game' }] }],
      message: '发现未绑定的 bilimi 收藏夹，请确认要重新绑定的候选收藏夹。'
    })

    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/folder/add'))).toBe(false)
  })

  it('preflights a Bilibili-renamed formal shard for one confirmed backup rename', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn().mockResolvedValue({
      shards: [{
        logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
        remoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, bindingState: 'bound'
      }]
    })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [game] }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-07T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) {
        return {
          ok: false,
          verified: true,
          ledgers: [{ ...game, bindingState: 'unbacked' as const }],
          missingLedgerIds: ['game'],
          unboundLedgerIds: [],
          backupConflictLedgerIds: [],
          message: '发现尚未备册的 bilimi 收藏夹，请在备册时完成确认。'
        }
      }
      if (script.includes('已绑定收藏夹改名预检')) {
        return {
          ok: true,
          verified: true,
          observedShards: [{
            logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
            currentRemoteTitle: '用户改过的名称', remoteMemberCount: 0
          }]
        }
      }
      if (script.includes('/x/v3/fav/folder/add')) {
        return { ok: true, verified: true, ledgers: [game], steps: ['api:ledger:list'], missingTargets: [], message: '已备册' }
      }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'manual-bilibili-rename-first-backup', type: 'ensure-ledger', logicalFolderId: 'game',
      options: { lightweightBackup: true }
    })).resolves.toMatchObject({
      ok: false,
      steps: ['favorite:bound-shard-rename-preflight'],
      boundRenameCandidates: [{
        ledgerId: 'game',
        shards: [{
          remoteFolderId: '4106106611', shardNumber: 1,
          currentRemoteTitle: '用户改过的名称', targetTitle: 'bilimi·游戏专区'
        }]
      }]
    })

    expect(renameFavoriteRepositoryBoundLedgerShard).not.toHaveBeenCalled()
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/folder/add'))).toBe(false)

    await expect(requestRuntime({
      id: 'manual-bilibili-rename-confirmed-backup', type: 'ensure-ledger', logicalFolderId: 'game',
      options: {
        lightweightBackup: true,
        confirmBoundRename: true,
        boundRenameShards: { game: [{ remoteFolderId: '4106106611', shardNumber: 1 }] }
      }
    })).resolves.toMatchObject({ ok: true })

    expect(renameFavoriteRepositoryBoundLedgerShard).toHaveBeenCalledTimes(1)
    expect(renameFavoriteRepositoryBoundLedgerShard).toHaveBeenCalledWith(accountMid, {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteFolderId: '4106106611', shardNumber: 1,
      currentRemoteTitle: '用户改过的名称', targetTitle: 'bilimi·游戏专区'
    })
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
  })

  it('requires the same exact formal shard tuple that the bound-rename preflight displayed', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn()
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-04T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => script.includes('已绑定收藏夹改名预检')
      ? {
          ok: true,
          verified: true,
          observedShards: [{
            logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
            currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0
          }]
        }
      : { ok: true, verified: true, ledgers: [game], steps: ['api:ledger:add'], missingTargets: [], message: '已备册' })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'bound-rename-confirmation-stale-exact-id', type: 'save-ledgers', ledgers: [game],
      options: {
        backupTargetLedgerIds: ['game'],
        rediscoverDeletedRemoteDrafts: true,
        confirmBoundRename: true,
        boundRenameShards: { game: [{ remoteFolderId: '4106106612', shardNumber: 1 }] }
      }
    })).resolves.toMatchObject({
      ok: false,
      steps: ['favorite:bound-shard-rename-preflight'],
      boundRenameCandidates: [{
        ledgerId: 'game',
        shards: [expect.objectContaining({ remoteFolderId: '4106106611', shardNumber: 1 })]
      }]
    })

    expect(renameFavoriteRepositoryBoundLedgerShard).not.toHaveBeenCalled()
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/folder/edit'))).toBe(false)
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/folder/add'))).toBe(false)
    expect(executeJavaScript.mock.calls.some(([script]) => typeof script === 'string' && script.includes('/x/v3/fav/resource/deal'))).toBe(false)
  })

  it('stops an explicit bound backup before scripts, adoption, or creation when its formal shard is absent', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn()
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => userGesture === true
        ? { hasUserId: true, hasCsrf: true }
        : script.includes('已绑定收藏夹改名预检')
          ? {
              ok: true,
              verified: true,
              observedShards: [{
                logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
                currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0
              }]
            }
          : { ok: true, verified: true, ledgers: [game], steps: ['api:ledger:add'], missingTargets: [], message: '已备册' })
    })

    await expect(requestRuntime({
      id: 'bound-rename-formal-shard-absent', type: 'save-ledgers', ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], confirmCreateAndBind: true, confirmBoundRename: true, boundRenameShards: { game: [{ remoteFolderId: '4106106611', shardNumber: 1 }] } }
    })).resolves.toMatchObject({ ok: true, steps: ['api:ledger:add'] })

    expect(renameFavoriteRepositoryBoundLedgerShard).not.toHaveBeenCalled()
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'game', remoteFolderId: '4106106611', shardNumber: 1
    }))
  })

  it('fails closed instead of falling back when the direct bound-rename bridge is unavailable', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding,
      renameFavoriteRepositoryBoundLedgerShard: undefined,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-04T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => userGesture === true
        ? { hasUserId: true, hasCsrf: true }
        : script.includes('已绑定收藏夹改名预检')
          ? {
              ok: true,
              verified: true,
              observedShards: [{
                logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
                currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0
              }]
            }
          : { ok: true, verified: true, ledgers: [game], steps: ['api:ledger:add'], missingTargets: [], message: '已备册' })
    })

    await expect(requestRuntime({
      id: 'bound-rename-bridge-absent', type: 'save-ledgers', ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], confirmCreateAndBind: true, confirmBoundRename: true, boundRenameShards: { game: [{ remoteFolderId: '4106106611', shardNumber: 1 }] } }
    })).resolves.toMatchObject({
      ok: false,
      steps: ['favorite:bound-shard-rename'],
      message: expect.stringContaining('改名服务不可用')
    })

    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
    expect(webview.executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('keeps an unrelated post-rename script failure failed instead of reporting the rename as full success', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn().mockResolvedValue({
      shards: [{
        logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
        remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区哈哈',
        bindingState: 'bound', remoteMemberCount: 0
      }]
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-04T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => script.includes('已绑定收藏夹改名预检')
        ? {
            ok: true,
            verified: true,
            observedShards: [{
              logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
              currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0
            }]
          }
        : {
            ok: false, verified: false, steps: ['api:ledger:list'],
            missingTargets: [], unboundLedgerIds: [], unboundCandidates: [],
            message: 'B 站目录读取失败。'
          })
    })

    await expect(requestRuntime({
      id: 'bound-rename-keeps-generic-script-failure', type: 'save-ledgers', ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], rediscoverDeletedRemoteDrafts: true, confirmBoundRename: true, boundRenameShards: { game: [{ remoteFolderId: '4106106611', shardNumber: 1 }] } }
    })).resolves.toMatchObject({ ok: false, message: 'B 站目录读取失败。' })

    expect(renameFavoriteRepositoryBoundLedgerShard).toHaveBeenCalledTimes(1)
  })

  it('replaces only a stale direct-rename target failure with the committed rename success message', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn().mockResolvedValue({
      shards: [{
        logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
        remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区哈哈',
        bindingState: 'bound', remoteMemberCount: 0
      }]
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      renameFavoriteRepositoryBoundLedgerShard,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-04T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', bindingState: 'bound'
        }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => script.includes('已绑定收藏夹改名预检')
        ? {
            ok: true,
            verified: true,
            observedShards: [{
              logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
              currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0
            }]
          }
        : {
            ok: false, verified: true, ledgers: [{ ...game, bindingState: 'unbound' as const }],
            steps: ['api:ledger:list'], missingTargets: [], unboundLedgerIds: ['game'],
            unboundCandidates: [{ ledgerId: 'game', candidates: [] }],
            message: '发现 1 个未绑定收藏夹。'
          })
    })

    await expect(requestRuntime({
      id: 'bound-rename-replaces-stale-target-result', type: 'save-ledgers', ledgers: [game],
      options: { backupTargetLedgerIds: ['game'], rediscoverDeletedRemoteDrafts: true, confirmBoundRename: true, boundRenameShards: { game: [{ remoteFolderId: '4106106611', shardNumber: 1 }] } }
    })).resolves.toMatchObject({
      ok: true,
      message: '已按掌库当前名称完成已绑定收藏夹改名。',
      unboundLedgerIds: [],
      unboundCandidates: []
    })
  })

  it('does not rename a bound shard during a local-only rule save', async () => {
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn()
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: createDefaultFavoriteLedgers() }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      renameFavoriteRepositoryBoundLedgerShard
    })

    const nextLedgers = createDefaultFavoriteLedgers().map((ledger) => ledger.id === game.id
      ? { ...ledger, displayName: 'bilimi·游戏专区哈哈', bindingState: 'bound' as const,
          bilibiliFolderId: '4106106611', bilibiliFolderIds: ['4106106611'] }
      : ledger)
    await expect(requestRuntime({
      id: 'local-save-does-not-rename-bound-shard', type: 'save-ledgers', ledgers: nextLedgers
    })).resolves.toMatchObject({ ok: true })

    expect(renameFavoriteRepositoryBoundLedgerShard).not.toHaveBeenCalled()
  })

  it('uses the direct rename transaction for an explicit single-ledger backup', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      displayName: 'bilimi·游戏专区哈哈',
      bilibiliFolderId: '4106106611',
      bilibiliFolderIds: ['4106106611'],
      bilibiliFolderTitle: 'bilimi·游戏专区',
      bindingState: 'bound' as const
    }
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [game]
        }
      }
    })
    const renameFavoriteRepositoryBoundLedgerShard = vi.fn().mockResolvedValue({
      shards: [{
        logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
        remoteTitle: 'bilimi·游戏专区哈哈', bindingState: 'bound', remoteMemberCount: 0
      }]
    })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn()
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    let resolveInitialPreferences: ((preferences: AssistantPreferences) => void) | undefined
    const initialPreferencesLoaded = new Promise<AssistantPreferences>((resolve) => {
      resolveInitialPreferences = resolve
    })
    const loadPreferences = vi.fn(() => initialPreferencesLoaded)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      savePreferences,
      renameFavoriteRepositoryBoundLedgerShard,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-04T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1,
        physicalShards: [{ logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
          remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区', bindingState: 'bound' }],
        syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    await waitFor(() => expect(loadPreferences).toHaveBeenCalled())
    await act(async () => {
      resolveInitialPreferences?.(initialPreferences)
      await initialPreferencesLoaded
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => script.includes('已绑定收藏夹改名预检')
        ? {
            ok: true,
            verified: true,
            observedShards: [{
              logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
              currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0
            }]
          }
        : { ok: true, verified: true, ledgers: [game], steps: ['api:ledger:list'], missingTargets: [], message: '已备册' })
    })

    await expect(requestRuntime({
      id: 'rename-single-bound-game', type: 'ensure-ledger', logicalFolderId: 'bilimi-logical:game',
      options: { lightweightBackup: true, confirmBoundRename: true, boundRenameShards: { game: [{ remoteFolderId: '4106106611', shardNumber: 1 }] } }
    })).resolves.toMatchObject({ ok: true })
    expect(renameFavoriteRepositoryBoundLedgerShard).toHaveBeenCalledWith(accountMid, {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', remoteFolderId: '4106106611', shardNumber: 1,
      currentRemoteTitle: 'bilimi·游戏专区', targetTitle: 'bilimi·游戏专区哈哈'
    })
    expect(adoptFavoriteRepositoryLedgerBinding).not.toHaveBeenCalled()
    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([
            expect.objectContaining({ id: 'game', bindingState: 'bound', bilibiliFolderTitle: 'bilimi·游戏专区哈哈' })
          ])
        })
      })
    }))
  })

  it('registers an explicitly confirmed circled recovery folder after the formally bound main shard', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-08-13T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1, syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0,
        remoteReconciliations: [],
        physicalShards: [{ logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: 'bound-main', bindingState: 'bound' }]
      }),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: 'recovered-second', bindingState: 'bound' }],
        steps: ['api:ledger:list'], missingTargets: [], message: '册目已备齐。'
      }))
    })

    await expect(requestRuntime({
      id: 'recover-same-title-after-bound-main', type: 'save-ledgers', ledgers: [game],
      options: {
        rebindRemoteFolderIds: { game: 'recovered-second' },
        rebindRemoteFolders: { game: [{
          id: 'recovered-second', title: `${game.displayName}②`, memberCount: 1000
        }] }
      }
    })).resolves.toMatchObject({
      ok: true,
      verified: true,
      ledgers: [expect.objectContaining({
        id: 'game',
        bindingState: 'bound',
        bilibiliFolderId: 'bound-main',
        bilibiliFolderIds: ['bound-main', 'recovered-second'],
        bilibiliFolderVideoCount: 1000
      })]
    })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'game', remoteFolderId: 'recovered-second', shardNumber: 2
    }))
  })

  it('returns the rejected recovery shard and its reason without losing successful sibling bindings', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const adoptFavoriteRepositoryLedgerBinding = vi.fn(async (_accountMid: string, input: { remoteFolderId: string }) => {
      if (input.remoteFolderId === '89') throw new Error('Favorite repository remote shard is absent from inventory.')
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'bound' }],
        steps: ['api:ledger:list'], missingTargets: [], message: 'ok'
      }))
    })

    await expect(requestRuntime({
      id: 'rebind-one-rejected-shard', type: 'save-ledgers', ledgers: [game],
      options: {
        rebindRemoteFolderIds: { game: '88' },
        rebindRemoteFolders: { game: [
          { id: '88', title: 'bilimi·游戏专区' },
          { id: '89', title: 'bilimi·游戏专区②' }
        ] }
      }
    })).resolves.toMatchObject({
      ok: false,
      unboundLedgerIds: ['game'],
      unboundCandidates: [{
        ledgerId: 'game',
        candidates: [{
          id: '89',
          title: 'bilimi·游戏专区②',
          bindingFailureReason: '远端收藏夹已不在本次清单中，请刷新 B 站收藏夹后重新确认。'
        }]
      }]
    })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      remoteFolderId: '88', shardNumber: 1
    }))
  })

  it('persists successful sibling shards as bound when another recovery shard is rejected', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const adoptFavoriteRepositoryLedgerBinding = vi.fn(async (_accountMid: string, input: { remoteFolderId: string }) => {
      if (input.remoteFolderId === '89') throw new Error('Favorite repository remote shard is absent from inventory.')
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'bound' }],
        steps: ['api:ledger:list'], missingTargets: [], message: 'ok'
      }))
    })

    const result = await requestRuntime({
      id: 'persist-partial-rebind', type: 'save-ledgers', ledgers: [game],
      options: {
        rebindRemoteFolderIds: { game: '88' },
        rebindRemoteFolders: { game: [
          { id: '88', title: 'bilimi·游戏专区' },
          { id: '89', title: 'bilimi·游戏专区②' }
        ] }
      }
    })

    expect(result).toMatchObject({ ok: false, unboundLedgerIds: ['game'] })
    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([expect.objectContaining({
            id: 'game',
            bindingState: 'bound',
            bilibiliFolderId: '88',
            bilibiliFolderIds: ['88']
          })])
        })
      })
    }))
  })

  it('adopts every confirmed recovery shard for one logical ledger', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const adoptFavoriteRepositoryLedgerBinding = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'bound' }],
        steps: ['api:ledger:list'], missingTargets: [], message: '备册完成。'
      }))
    })

    await expect(requestRuntime({
      id: 'recover-game', type: 'save-ledgers', ledgers: [game],
      options: {
        rebindRemoteFolderIds: { game: '88' },
        rebindRemoteFolders: { game: [
          { id: '88', title: 'bilimi·游戏专区' },
          { id: '89', title: 'bilimi·游戏专区②' }
        ] }
      }
    })).resolves.toMatchObject({
      ok: true,
      verified: true,
      ledgers: [expect.objectContaining({ bilibiliFolderId: '88', bilibiliFolderIds: ['88', '89'] })]
    })

    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'game', remoteFolderId: '88', remoteTitle: 'bilimi·游戏专区'
    }))
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'game', remoteFolderId: '89', remoteTitle: 'bilimi·游戏专区②'
    }))
  })

  it('replaces only the confirmed stale main binding while retaining its bound circled shard', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: 'old-main', bilibiliFolderIds: ['old-main', 'bound-second'], bindingState: 'bound' as const
    }
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const adoptFavoriteRepositoryLedgerBinding = vi.fn(async (_accountMid: string, input: { logicalLedgerId: string; shardNumber: number; remoteFolderId: string; remoteTitle: string }) => ({
      shards: [{
        logicalLedgerId: input.logicalLedgerId,
        shardNumber: input.shardNumber,
        remoteFolderId: input.remoteFolderId,
        remoteTitle: input.remoteTitle,
        remoteMemberCount: input.remoteFolderId === 'new-main' ? 4 : 6
      }]
    }))
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [game] }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount: vi.fn()
        .mockResolvedValueOnce({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-09T00:00:00.000Z',
        videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 2,
        physicalShards: [
          { logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1, remoteFolderId: 'old-main', remoteTitle: game.displayName, remoteMemberCount: 4, bindingState: 'bound' },
          { logicalLedgerId: 'game', folderId: 'bilimi:game:002', shardNumber: 2, remoteFolderId: 'bound-second', remoteTitle: `${game.displayName}②`, remoteMemberCount: 6, bindingState: 'bound' }
        ],
          syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
        })
        .mockResolvedValue({
          version: 1, accountMid, revision: 2, updatedAt: '2026-09-09T00:00:01.000Z',
          videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
          physicalShardCount: 2,
          physicalShards: [
            { logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1, remoteFolderId: 'new-main', remoteTitle: game.displayName, remoteMemberCount: 4, bindingState: 'bound' },
            { logicalLedgerId: 'game', folderId: 'bilimi:game:002', shardNumber: 2, remoteFolderId: 'bound-second', remoteTitle: `${game.displayName}②`, remoteMemberCount: 6, bindingState: 'bound' }
          ],
          syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
        })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: 'new-main', bilibiliFolderIds: ['new-main', 'bound-second'], bindingState: 'bound' as const }],
        steps: ['api:ledger:list'], missingTargets: [], message: '备册完成。'
      }))
    })

    await expect(requestRuntime({
      id: 'replace-stale-main-binding', type: 'save-ledgers', ledgers: [game],
      options: {
        rebindRemoteFolderIds: { game: 'new-main' },
        rebindRemoteFolders: { game: [
          { id: 'new-main', title: game.displayName, memberCount: 4 },
          { id: 'bound-second', title: `${game.displayName}②`, memberCount: 6 }
        ] }
      }
    })).resolves.toMatchObject({
      ok: true,
      ledgers: [expect.objectContaining({ bilibiliFolderId: 'new-main', bilibiliFolderIds: ['new-main', 'bound-second'] })]
    })
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'game', remoteFolderId: 'new-main', shardNumber: 1, replaceExistingRemoteBinding: true
    }))
    const persistedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(persistedLedgers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'game', bilibiliFolderId: 'new-main', bilibiliFolderIds: ['new-main', 'bound-second'] })
    ]))
  })

  it('replaces only the confirmed stale circled shard binding while retaining its bound main shard', async () => {
    const accountMid = '100'
    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: 'bound-main', bilibiliFolderIds: ['bound-main', 'old-second'], bindingState: 'bound' as const
    }
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const repositorySnapshot = (revision: number, secondId: string) => ({
      version: 1, accountMid, revision, updatedAt: '2026-09-09T00:00:00.000Z',
      videoCount: 0, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
      physicalShardCount: 2,
      physicalShards: [
        { logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1, remoteFolderId: 'bound-main', remoteTitle: game.displayName, remoteMemberCount: 4, bindingState: 'bound' },
        { logicalLedgerId: 'game', folderId: 'bilimi:game:002', shardNumber: 2, remoteFolderId: secondId, remoteTitle: `${game.displayName}②`, remoteMemberCount: 6, bindingState: 'bound' }
      ],
      syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
    })
    const adoptFavoriteRepositoryLedgerBinding = vi.fn(async (_accountMid: string, input: { logicalLedgerId: string; shardNumber: number; remoteFolderId: string; remoteTitle: string }) => ({
      shards: [{
        logicalLedgerId: input.logicalLedgerId,
        shardNumber: input.shardNumber,
        remoteFolderId: input.remoteFolderId,
        remoteTitle: input.remoteTitle,
        remoteMemberCount: input.shardNumber === 1 ? 4 : 6
      }]
    }))
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [game] }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      savePreferences,
      adoptFavoriteRepositoryLedgerBinding,
      openFavoriteRepositoryAccount: vi.fn()
        .mockResolvedValueOnce(repositorySnapshot(1, 'old-second'))
        .mockResolvedValue(repositorySnapshot(2, 'new-second'))
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async () => ({
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: 'bound-main', bilibiliFolderIds: ['bound-main', 'new-second'], bindingState: 'bound' as const }],
        steps: ['api:ledger:list'], missingTargets: [], message: '备册完成。'
      }))
    })

    await expect(requestRuntime({
      id: 'replace-stale-circled-binding', type: 'save-ledgers', ledgers: [game],
      options: {
        rebindRemoteFolderIds: { game: 'new-second' },
        rebindRemoteFolders: { game: [
          { id: 'bound-main', title: game.displayName, memberCount: 4 },
          { id: 'new-second', title: `${game.displayName}②`, memberCount: 6 }
        ] }
      }
    })).resolves.toMatchObject({
      ok: true,
      ledgers: [expect.objectContaining({ bilibiliFolderId: 'bound-main', bilibiliFolderIds: ['bound-main', 'new-second'] })]
    })
    expect(adoptFavoriteRepositoryLedgerBinding).toHaveBeenCalledWith(accountMid, expect.objectContaining({
      logicalLedgerId: 'game', remoteFolderId: 'new-second', shardNumber: 2, replaceExistingRemoteBinding: true
    }))
    const persistedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(persistedLedgers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'game', bilibiliFolderId: 'bound-main', bilibiliFolderIds: ['bound-main', 'new-second'] })
    ]))
  })

  it('releases remote-draft rediscovery only after an explicit successful backup and then forces a status check', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const consumeFavoriteLedgerRemoteDraftRediscoveryPending = vi.fn().mockResolvedValue(['88'])
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      consumeFavoriteLedgerRemoteDraftRediscoveryPending
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) {
        return {
          ok: true,
          verified: true,
          ledgers: [{
            id: 'custom-remote-88', displayName: 'bilimi·待恢复', keywords: [], enabled: false, priority: 99,
            bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'unbound', syncState: 'local-draft', isDefault: false
          }],
          missingLedgerIds: [],
          remoteOnlyDraftLedgerIds: ['custom-remote-88'],
          message: '册目查验已毕。'
        }
      }
      return {
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: '77', bindingState: 'bound' }],
        steps: ['api:ledger:list'], missingTargets: [], message: '收藏夹已备册。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'backup-rediscover-remote-draft', type: 'save-ledgers', ledgers: [game],
      options: { rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: true })

    expect(consumeFavoriteLedgerRemoteDraftRediscoveryPending).toHaveBeenCalledWith(accountMid)
    expect(executeJavaScript.mock.calls.filter(([script]) => typeof script === 'string' && isLedgerStatusScript(script))).toHaveLength(1)
  })

  it('does not release remote-draft rediscovery when the backup fails before observing any remote-only draft', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const consumeFavoriteLedgerRemoteDraftRediscoveryPending = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      consumeFavoriteLedgerRemoteDraftRediscoveryPending
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (_script: string, userGesture?: boolean) => userGesture
        ? { hasUserId: true, hasCsrf: true }
        : { ok: false, ledgers: [game], steps: ['api:ledger:list'], missingTargets: ['game'], message: '备册失败。' })
    })

    await expect(requestRuntime({
      id: 'failed-backup-keeps-remote-draft-pending', type: 'save-ledgers', ledgers: [game],
      options: { rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: false })

    expect(consumeFavoriteLedgerRemoteDraftRediscoveryPending).not.toHaveBeenCalled()
  })

  it('releases remote-draft rediscovery after a failed backup that observed a remote-only draft', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const consumeFavoriteLedgerRemoteDraftRediscoveryPending = vi.fn().mockResolvedValue(['88'])
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      consumeFavoriteLedgerRemoteDraftRediscoveryPending
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) return emptyLedgerStatus()
      return {
        ok: false,
        ledgers: [game, {
          id: 'custom-remote-88', displayName: 'bilimi·待恢复', keywords: [], enabled: false, priority: 99,
          bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'unbound', syncState: 'local-draft', isDefault: false
        }],
        steps: ['api:ledger:list'],
        missingTargets: [game.id],
        remoteOnlyDraftLedgerIds: ['custom-remote-88'],
        message: '创建 B 站收藏夹失败。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'failed-backup-rediscovers-remote-draft', type: 'save-ledgers', ledgers: [game],
      options: { rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: false, remoteOnlyDraftLedgerIds: [] })

    expect(consumeFavoriteLedgerRemoteDraftRediscoveryPending).toHaveBeenCalledWith(accountMid)
    expect(executeJavaScript.mock.calls.filter(([script]) => typeof script === 'string' && isLedgerStatusScript(script))).toHaveLength(1)
  })

  it('releases remote-draft rediscovery after an observed draft survives a binding-registration failure', async () => {
    const accountMid = '100'
    const game = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!
    const consumeFavoriteLedgerRemoteDraftRediscoveryPending = vi.fn().mockResolvedValue(['88'])
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      consumeFavoriteLedgerRemoteDraftRediscoveryPending,
      adoptFavoriteRepositoryLedgerBinding: vi.fn().mockRejectedValue(new Error('remote shard is absent from inventory'))
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) return emptyLedgerStatus()
      return {
        ok: true,
        verified: true,
        ledgers: [{ ...game, bilibiliFolderId: '77', bilibiliFolderIds: ['77'], bindingState: 'bound' }, {
          id: 'custom-remote-88', displayName: 'bilimi·待恢复', keywords: [], enabled: false, priority: 99,
          bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'unbound', syncState: 'local-draft', isDefault: false
        }],
        steps: ['api:ledger:list'],
        missingTargets: [],
        remoteOnlyDraftLedgerIds: ['custom-remote-88'],
        message: '收藏夹已备册。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({
      id: 'binding-registration-failure-rediscovers-remote-draft', type: 'save-ledgers', ledgers: [game],
      options: { rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: false, unboundLedgerIds: [game.id] })

    expect(consumeFavoriteLedgerRemoteDraftRediscoveryPending).toHaveBeenCalledWith(accountMid)
    expect(executeJavaScript.mock.calls.filter(([script]) => typeof script === 'string' && isLedgerStatusScript(script))).toHaveLength(1)
  })

  it('keeps locally deleted remote drafts out of ordinary status reads until an explicit backup releases them', async () => {
    const accountMid = '100'
    const getFavoriteLedgerRemoteDraftReminderDismissals = vi.fn().mockResolvedValue(['manual-dismissal'])
    const getFavoriteLedgerRemoteDraftRediscoveryPending = vi.fn().mockResolvedValue(['88'])
    const { requestRuntime } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      getFavoriteLedgerRemoteDraftReminderDismissals,
      getFavoriteLedgerRemoteDraftRediscoveryPending
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (isLedgerStatusScript(script)) return emptyLedgerStatus()
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({ id: 'ordinary-status-hides-deleted-remote-draft', type: 'snapshot' }))
      .resolves.toMatchObject({ favoriteLedgerStatus: { ok: true } })

    expect(getFavoriteLedgerRemoteDraftReminderDismissals).toHaveBeenCalledWith(accountMid)
    expect(getFavoriteLedgerRemoteDraftRediscoveryPending).toHaveBeenCalledWith(accountMid)
    const [statusScript] = executeJavaScript.mock.calls.find(([script]) => typeof script === 'string' && isLedgerStatusScript(script)) ?? []
    expect(statusScript).toContain('manual-dismissal')
    expect(statusScript).toContain('88')
  })

  it('provisions one requested ledger while retaining every other account ledger', async () => {
    const accountMid = '100'
    const ledgers = createDefaultFavoriteLedgers()
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: ledgers
        }
      }
    })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    notifyPreferencesChanged(initialPreferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const music = ledgers.find((ledger) => ledger.id === 'music')!
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('/x/v3/fav/folder/add')) {
          expect(script).toContain('"id":"music"')
          expect(script).not.toContain('"id":"knowledge"')
          return {
            ok: true,
            verified: true,
            ledgers: [{ ...music, bilibiliFolderId: '9901', syncState: 'bound' }],
            steps: ['api:ledger:list'],
            missingTargets: [],
            message: '当前册目已备齐。'
          }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await expect(requestRuntime({ id: 'backup-one-ledger', type: 'ensure-ledger', logicalFolderId: 'bilimi-logical:music' }))
      .resolves.toMatchObject({ ok: true })

    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([
            expect.objectContaining({ id: 'music', bilibiliFolderId: '9901' }),
            expect.objectContaining({ id: 'knowledge' })
          ])
        })
      })
    }))
  })

  it('keeps unchecked rules and local drafts out of backup writes while preserving them locally', async () => {
    const accountMid = '100'
    const enabled = { id: 'enabled', displayName: 'bilimi·已勾选', keywords: [], enabled: true, priority: 10, isDefault: false }
    const unchecked = { id: 'unchecked', displayName: 'bilimi·未勾选', keywords: [], enabled: false, priority: 20, isDefault: false }
    const draft = { id: 'draft', displayName: 'bilimi·草稿', keywords: [], enabled: true, priority: 30, syncState: 'local-draft' as const, ruleOrigin: 'recommendation-draft' as const, isDefault: false }
    const ledgers = [enabled, unchecked, draft]
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: ledgers }
      }
    })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    notifyPreferencesChanged(initialPreferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (script.includes('/x/v3/fav/folder/add')) {
          const payloadMatch = script.match(/const payload = (.*?);/s)
          const payload = JSON.parse(payloadMatch?.[1] ?? '{}')
          expect(payload.nextLedgers).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'unchecked' }),
            expect.objectContaining({ id: 'draft' })
          ]))
          expect(payload.options.backupTargetLedgerIds).toEqual(['enabled'])
        }
        return {
          ok: true,
          verified: true,
          ledgers: [
            { ...enabled, bilibiliFolderId: '9901', bindingState: 'bound' as const },
            unchecked,
            draft
          ],
          steps: ['api:ledger:list'],
          missingTargets: [],
          message: '册目已备齐。'
        }
      })
    })

    await expect(requestRuntime({
      id: 'backup-preserves-local-ledgers', type: 'save-ledgers', ledgers,
      options: { backupTargetLedgerIds: ['enabled'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: true })

    const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(savedLedgers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'enabled', bilibiliFolderId: '9901' }),
      expect.objectContaining({ id: 'unchecked', enabled: false }),
      expect.objectContaining({ id: 'draft', syncState: 'local-draft' })
    ]))
  })

  it('does not merge a deleted recommendation back into account ledgers from a backup result', async () => {
    const accountMid = '100'
    const deletedRecommendation = {
      id: 'deleted-recommendation', displayName: 'bilimi·已删除推荐', keywords: ['已删除推荐'],
      enabled: true, priority: 30, isDefault: false, ruleOrigin: 'recommendation-draft' as const,
      bindingState: 'unbacked' as const, bilibiliFolderId: '77'
    }
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [],
          deletedFavoriteLedgerRecords: [{
            logicalLedgerId: deletedRecommendation.id,
            deletedAt: '2026-09-05T00:00:00.000Z',
            ledger: deletedRecommendation
          }]
        }
      }
    })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn()
        .mockResolvedValueOnce({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-05T00:00:00.000Z',
        videoCount: 0, folderCount: 0, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 0, syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (script.includes(LEDGER_SAVE_SCRIPT_MARKER)) {
          return { ok: true, verified: true, ledgers: [{ ...deletedRecommendation, bindingState: 'bound' as const, bilibiliFolderId: '77' }], steps: ['api:ledger:list'], missingTargets: [], message: '已备册' }
        }
        if (isLedgerStatusScript(script)) return { ...emptyLedgerStatus(), ledgers: [] }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await waitFor(() => expect(window.bilimiDesktop.loadPreferences).toHaveBeenCalled())
    // The backup must observe the persisted deletion record, rather than the
    // initial React default while the async preference load is still settling.
    notifyPreferencesChanged(initialPreferences)
    const backupResult = await requestRuntime({
      id: 'deleted-recommendation-merge-guard', type: 'save-ledgers', ledgers: [deletedRecommendation],
      options: { backupTargetLedgerIds: [deletedRecommendation.id], confirmCreateAndBind: true, rediscoverDeletedRemoteDrafts: true }
    })
    expect(backupResult).toMatchObject({ ok: true })
    expect(backupResult?.ledgers ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: deletedRecommendation.id })]))

    expect(savePreferences).toHaveBeenCalled()
    const persistedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(persistedLedgers).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: deletedRecommendation.id })]))
  })

  it('passes complete repository coverage into a single-target backup without widening its write target', async () => {
    const accountMid = '100'
    const life = {
      id: 'life', displayName: 'bilimi·生活日常', keywords: [], enabled: true, priority: 10,
      isDefault: false, bilibiliFolderId: 'life-1', bilibiliFolderIds: ['life-1'], bindingState: 'bound' as const
    }
    const other = {
      id: 'other', displayName: 'bilimi·知识学习', keywords: [], enabled: true, priority: 20,
      isDefault: false, bilibiliFolderId: 'bound-other', bilibiliFolderIds: ['bound-other'], bindingState: 'bound' as const
    }
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [life, other] }
      }
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 1, updatedAt: '2026-09-03T00:00:00.000Z',
        videoCount: 0, folderCount: 3, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 3, syncRecordCount: 0, syncCounts: {}, pendingAidCount: 0, remoteReconciliations: [],
        physicalShards: [
          { logicalLedgerId: 'life', shardNumber: 1, remoteFolderId: 'life-1', remoteTitle: life.displayName, bindingState: 'bound' },
          { logicalLedgerId: 'other', shardNumber: 1, remoteFolderId: 'bound-other', remoteTitle: other.displayName, bindingState: 'bound' },
          { logicalLedgerId: 'pending', shardNumber: 1, remoteTitle: 'bilimi·影视动漫', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['pending-other'] }
        ]
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
        if (userGesture) return { hasUserId: true, hasCsrf: true }
        if (script.includes('已绑定收藏夹改名预检')) {
          return {
            ok: true,
            verified: true,
            observedShards: [{
              logicalLedgerId: 'life', shardNumber: 1, remoteFolderId: 'life-1',
              currentRemoteTitle: life.displayName, remoteMemberCount: 0
            }]
          }
        }
        if (script.includes(LEDGER_SAVE_SCRIPT_MARKER)) {
          const payloadMatch = script.match(/const payload = (.*?);/s)
          expect(payloadMatch).not.toBeNull()
          const payload = JSON.parse(payloadMatch?.[1] ?? '{}')
          expect(payload.remoteDraftKnownFolderIds).toEqual(['bound-other', 'life-1', 'pending-other'])
          expect(payload.remoteDraftBoundFolderIds).toEqual(['bound-other', 'life-1'])
          expect(payload.options.remoteDraftKnownFolderIds).toBeUndefined()
          expect(script).toContain('"id":"life"')
          expect(script).toContain('"id":"other"')
          expect(payload.options.backupTargetLedgerIds).toEqual(['life'])
          return { ok: true, verified: true, ledgers: [life, other], steps: ['api:ledger:list'], missingTargets: [], message: '收藏夹已备册。' }
        }
        if (isLedgerStatusScript(script)) return { ...emptyLedgerStatus(), ledgers: [life, other] }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await expect(requestRuntime({
      id: 'single-target-complete-observation-coverage', type: 'save-ledgers', ledgers: [life, other],
      options: { backupTargetLedgerIds: ['life'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }
    })).resolves.toMatchObject({ ok: true })
  })

  it('clears a default deletion marker when one ledger is formally backed up', async () => {
    const accountMid = '100'
    const music = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!,
      enabled: true,
      bindingState: 'unbound' as const,
      managedFolderDeletedByUser: true
    }
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [music] }
        }
      })),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      adoptFavoriteRepositoryLedgerBinding: vi.fn().mockResolvedValue(undefined)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('/x/v3/fav/folder/add')) {
          return {
            ok: true,
            verified: true,
            ledgers: [{ ...music, bilibiliFolderId: '9901', bindingState: 'bound' as const }],
            steps: ['api:ledger:list'], missingTargets: [], message: '当前册目已备齐。'
          }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await expect(requestRuntime({ id: 'backup-one-ledger-clears-marker', type: 'ensure-ledger', logicalFolderId: 'bilimi-logical:music' }))
      .resolves.toMatchObject({ ok: true })

    const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(savedLedgers.find((ledger) => ledger.id === 'music')).not.toHaveProperty('managedFolderDeletedByUser')
  })

  it('restores default backup targets when the master system is enabled after cancel all', async () => {
    const accountMid = '100'
    const disabledLedgers = createDefaultFavoriteLedgers().map((ledger) => ({
      ...ledger,
      enabled: false
    }))
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: disabledLedgers
        }
      }
    })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const patchPreferences = vi.fn(async () => initialPreferences)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      savePreferences,
      patchPreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    notifyPreferencesChanged(initialPreferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const backedUpLedgers = disabledLedgers.map((ledger, index) => ({
      ...ledger,
      enabled: true,
      bilibiliFolderId: String(9200 + index)
    }))
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('/x/v3/fav/folder/add')) {
        expect(script).toContain('"enabled":true')
        return {
          ok: true,
          verified: true,
          ledgers: backedUpLedgers,
          steps: ['api:ledger:list'],
          missingTargets: [],
          message: 'Default folders backed up.'
        }
      }
      if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({ id: 'backup-after-cancel-all', type: 'ensure-ledgers' }))
      .resolves.toMatchObject({ ok: true })

    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([
            expect.objectContaining({ id: 'knowledge', enabled: true, bilibiliFolderId: expect.any(String) })
          ])
        })
      })
    }))
    expect(patchPreferences).not.toHaveBeenCalled()
  })

  it('does not rewrite preferences when backup returns unchanged ledger bindings', async () => {
    const accountMid = '100'
    const ledgers = createDefaultFavoriteLedgers().map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: String(9000 + index)
    }))
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: ledgers
        }
      }
    })
    const patchPreferences = vi.fn(async () => initialPreferences)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      patchPreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    notifyPreferencesChanged(initialPreferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('/x/v3/fav/folder/add')) {
          return {
            ok: true,
            ledgers,
            steps: ['api:ledger:list'],
            missingTargets: [],
            message: '册目已备齐。'
          }
        }
        if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    await expect(requestRuntime({ id: 'backup-unchanged-ledgers', type: 'ensure-ledgers' }))
      .resolves.toMatchObject({ ok: true })

    expect(patchPreferences).not.toHaveBeenCalled()
  })

  it('refreshes and persists unique existing Bilibili folder bindings when an assistant snapshot is requested', async () => {
    const accountMid = '100'
    const ledgers = createDefaultFavoriteLedgers().slice(0, 2)
    const recoveredLedgers = ledgers.map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: String(9001 + index)
    }))
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: ledgers
        }
      }
    })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const patchPreferences = vi.fn(async () => initialPreferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      savePreferences,
      patchPreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) {
          return {
            ok: true,
            verified: true,
            ledgers: recoveredLedgers,
            missingLedgerIds: [],
            backupConflictLedgerIds: [],
            message: '册目查验已毕。'
          }
        }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    const snapshot = await requestRuntime({ id: 'snapshot-with-bindings', type: 'snapshot' })

    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([
            expect.objectContaining({ id: recoveredLedgers[0].id, bilibiliFolderId: '9001' }),
            expect.objectContaining({ id: recoveredLedgers[1].id, bilibiliFolderId: '9002' })
          ])
        })
      })
    }))
    expect(patchPreferences).not.toHaveBeenCalled()
    expect(snapshot).toMatchObject({
      favoriteLedgerStatus: { ok: true, missingLedgerIds: [] },
      preferences: {
        favoriteAccountPreferences: {
          [accountMid]: {
            favoriteLedgers: expect.arrayContaining([
              expect.objectContaining({ id: recoveredLedgers[0].id, bilibiliFolderId: '9001' }),
              expect.objectContaining({ id: recoveredLedgers[1].id, bilibiliFolderId: '9002' })
            ])
          }
        }
      }
    })
  })

  it('keeps an explicitly reset default ledger unbound while an older repository shard still exists', async () => {
    const accountMid = '100'
    const ledger = {
      ...createDefaultFavoriteLedgers()[0],
      bindingState: 'unbound' as const,
      managedFolderDeletedByUser: true
    }
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [ledger]
        }
      }
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1,
        accountMid,
        revision: 4,
        updatedAt: '2026-08-16T00:00:00.000Z',
        videoCount: 0,
        folderCount: 1,
        folders: [],
        folderCounts: {},
        scopeCounts: {},
        physicalShardCount: 1,
        syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 },
        pendingAidCount: 0,
        remoteReconciliations: [],
        physicalShards: [{
          logicalLedgerId: ledger.id,
          shardNumber: 1,
          remoteFolderId: 'older-bound-folder',
          bindingState: 'bound'
        }]
      })
    })
    notifyPreferencesChanged(initialPreferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) {
          const oldBindingWasReintroduced = script.includes('older-bound-folder')
          return oldBindingWasReintroduced
            ? {
                ok: true,
                verified: true,
                ledgers: [{ ...ledger, bilibiliFolderId: 'older-bound-folder', bindingState: 'bound' as const }],
                missingLedgerIds: [],
                backupConflictLedgerIds: [],
                unboundLedgerIds: [],
                message: '旧绑定被错误恢复。'
              }
            : {
                ok: false,
                verified: true,
                ledgers: [ledger],
                missingLedgerIds: [],
                backupConflictLedgerIds: [],
                unboundLedgerIds: [ledger.id],
                message: '等待主人主动备册确认。'
              }
        }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    const snapshot = await requestRuntime({ id: 'snapshot-with-explicit-local-reset', type: 'snapshot' })

    expect(snapshot).toMatchObject({
      favoriteLedgerStatus: { ok: false, unboundLedgerIds: [ledger.id] },
      preferences: {
        favoriteAccountPreferences: {
        [accountMid]: {
            favoriteLedgers: expect.arrayContaining([expect.objectContaining({ id: ledger.id, bindingState: 'unbound' })])
          }
        }
      }
    })
  })

  it('does not treat a stale logical binding as formal when the repository has no physical shards', async () => {
    const accountMid = '100'
    const ledger = {
      ...createDefaultFavoriteLedgers()[0],
      bilibiliFolderId: 'stale-folder',
      bilibiliFolderIds: ['stale-folder'],
      bindingState: 'bound' as const,
      managedFolderDeletedByUser: true
    }
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [ledger] }
        }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 9, updatedAt: '2026-08-20T00:00:00.000Z',
        videoCount: 0, folderCount: 1,
        folders: [{ id: `bilimi-logical:${ledger.id}`, title: ledger.displayName, kind: 'bilimi-logical', logicalLedgerId: ledger.id, remoteFolderId: 'stale-folder', syncState: 'bound' }],
        physicalShardCount: 0, physicalShards: [], folderCounts: {}, scopeCounts: {}, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & { executeJavaScript?: (script: string) => Promise<unknown> }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) {
          const staleBindingWasTrusted = script.includes('stale-folder')
          return staleBindingWasTrusted
            ? { ok: true, verified: true, ledgers: [{ ...ledger, bindingState: 'bound' as const }], missingLedgerIds: [], unboundLedgerIds: [], unboundCandidates: [] }
            : { ok: false, verified: true, ledgers: [{ ...ledger, bindingState: 'unbound' as const }], missingLedgerIds: [ledger.id], unboundLedgerIds: [ledger.id], unboundCandidates: [{ ledgerId: ledger.id, candidates: [{ id: 'stale-folder', title: ledger.displayName, memberCount: 0 }] }] }
        }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    const snapshot = await requestRuntime({ id: 'snapshot-without-formal-shard', type: 'snapshot' })

    expect(snapshot).toMatchObject({ favoriteLedgerStatus: { ok: false, unboundLedgerIds: [ledger.id] } })
  })

  it('uses trusted repository bindings when the page ledger check temporarily misses an already scanned folder', async () => {
    const accountMid = '100'
    const ledger = createDefaultFavoriteLedgers()[0]
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [ledger]
        }
      }
    })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1,
        accountMid,
        revision: 4,
        updatedAt: '2026-08-05T00:00:00.000Z',
        videoCount: 0,
        folderCount: 1,
        folders: [{
          id: `bilimi-logical:${ledger.id}`,
          title: ledger.displayName,
          kind: 'bilimi-logical',
          logicalLedgerId: ledger.id,
          remoteFolderId: '9001',
          syncState: 'bound'
        }],
        folderCounts: { [`bilimi-logical:${ledger.id}`]: 0 },
        scopeCounts: { all: 0, pending: 0, protected: 0, unsynced: 0, recycle: 0 },
        physicalShardCount: 1,
        syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 },
        pendingAidCount: 0,
        remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) {
          expect(script).toContain('"bilibiliFolderId":"9001"')
          expect(script).toContain('"remoteDraftKnownFolderIds":["9001"]')
          expect(script).toContain('"remoteDraftBoundFolderIds":["9001"]')
          return {
            ok: true,
            verified: true,
            ledgers: [{ ...ledger, bilibiliFolderId: '9001' }],
            missingLedgerIds: [],
            backupConflictLedgerIds: [],
            message: '册目查验已毕。'
          }
        }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    const snapshot = await requestRuntime({ id: 'snapshot-with-repository-bindings', type: 'snapshot' })

    expect(snapshot).toMatchObject({
      favoriteLedgerStatus: { ok: true, missingLedgerIds: [] },
      preferences: {
        favoriteAccountPreferences: {
          [accountMid]: {
            favoriteLedgers: expect.arrayContaining([expect.objectContaining({ id: ledger.id, bilibiliFolderId: '9001' })])
          }
        }
      }
    })
    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([expect.objectContaining({ id: ledger.id, bilibiliFolderId: '9001' })])
        })
      })
    }))
  })

  it('clears a stale repository binding when the current Bilibili folder list no longer contains it', async () => {
    const accountMid = '100'
    const ledger = { ...createDefaultFavoriteLedgers()[0], bilibiliFolderId: '9001' }
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [ledger]
        }
      }
    })
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 4, updatedAt: '2026-08-05T00:00:00.000Z', videoCount: 0, folderCount: 1,
        folders: [{ id: `bilimi-logical:${ledger.id}`, title: ledger.displayName, kind: 'bilimi-logical', logicalLedgerId: ledger.id, remoteFolderId: '9001', syncState: 'bound' }],
        folderCounts: { [`bilimi-logical:${ledger.id}`]: 0 }, scopeCounts: { all: 0, pending: 0, protected: 0, unsynced: 0, recycle: 0 },
        physicalShardCount: 1, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0, remoteReconciliations: []
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & { executeJavaScript?: (script: string) => Promise<unknown> }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) {
          expect(script).toContain('"bilibiliFolderId":"9001"')
          const { bilibiliFolderId: _removed, ...unboundLedger } = ledger
          return { ok: false, verified: true, ledgers: [unboundLedger], missingLedgerIds: [ledger.id], backupConflictLedgerIds: [], message: '册目查验已毕。' }
        }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    const snapshot = await requestRuntime({ id: 'snapshot-with-stale-repository-binding', type: 'snapshot' })

    expect(snapshot).toMatchObject({ favoriteLedgerStatus: { ok: false, missingLedgerIds: [ledger.id] } })
    const savedLedgers = savePreferences.mock.calls.at(-1)?.[0].favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? []
    expect(savedLedgers.find((item) => item.id === ledger.id)).not.toHaveProperty('bilibiliFolderId')
  })

  it('projects a renamed formally bound folder as an unbound candidate in the App snapshot', async () => {
    const accountMid = '100'
    const ledger = {
      ...createDefaultFavoriteLedgers().find((item) => item.id === 'music')!,
      bilibiliFolderId: '4065561111',
      bilibiliFolderIds: ['4065561111'],
      bilibiliFolderTitle: 'bilimi·音乐舞台',
      bindingState: 'bound' as const,
      enabled: true
    }
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: {
          [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [ledger] }
        }
      })),
      savePreferences,
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid, revision: 12, updatedAt: '2026-09-02T00:00:00.000Z',
        videoCount: 7, folderCount: 1, folders: [], folderCounts: {}, scopeCounts: {},
        physicalShardCount: 1, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0,
        remoteReconciliations: [],
        physicalShards: [{
          logicalLedgerId: ledger.id, shardNumber: 1, remoteFolderId: '4065561111',
          remoteTitle: 'bilimi·音乐舞台哈哈', bindingState: 'bound'
        }]
      })
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) {
          return {
            ok: false,
            verified: true,
            ledgers: [{ ...ledger, bilibiliFolderTitle: 'bilimi·音乐舞台哈哈', bindingState: 'unbound' as const }],
            missingLedgerIds: [ledger.id],
            backupConflictLedgerIds: [],
            unboundLedgerIds: [ledger.id],
            unboundCandidates: [{
              ledgerId: ledger.id,
              candidates: [{ id: '4065561111', title: 'bilimi·音乐舞台哈哈', memberCount: 7 }]
            }],
            message: '发现未绑定的 bilimi 收藏夹。'
          }
        }
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      })
    })

    const snapshot = await requestRuntime({ id: 'renamed-formal-binding-snapshot', type: 'snapshot' })

    expect(snapshot).toMatchObject({
      favoriteLedgerStatus: { ok: false, unboundLedgerIds: [ledger.id] },
      preferences: {
        favoriteAccountPreferences: {
          [accountMid]: {
            favoriteLedgers: expect.arrayContaining([expect.objectContaining({
              id: ledger.id, bindingState: 'unbound', bilibiliFolderId: '4065561111'
            })])
          }
        }
      }
    })
    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        [accountMid]: expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([expect.objectContaining({ id: ledger.id, bindingState: 'unbound' })])
        })
      })
    }))
  })

  it('does not restore a deleted remote draft when an older status check finishes afterward', async () => {
    const accountMid = '100'
    const remoteDraft = {
      id: 'custom-remote-88',
      displayName: 'bilimi·待恢复',
      keywords: [],
      enabled: false,
      priority: 99,
      bilibiliFolderId: '88',
      bilibiliFolderIds: ['88'],
      bindingState: 'unbound' as const,
      syncState: 'local-draft' as const,
      isDefault: false
    }
    const currentLedgers = [...createDefaultFavoriteLedgers(), remoteDraft]
    const initialPreferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: currentLedgers }
      }
    })
    const preferencesAfterDraftDeletion = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: currentLedgers.filter((ledger) => ledger.id !== remoteDraft.id)
        }
      }
    })
    const { notifyPreferencesChanged, requestRuntime, requestRuntimeDirect } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(initialPreferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    notifyPreferencesChanged(initialPreferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    let resolveOlderStatus: ((status: unknown) => void) | undefined
    let statusReadCount = 0
    const executeJavaScript = vi.fn((script: string) => {
      if (script.includes('__bilimiRepaintVideoAfterHostResize')) {
        return Promise.resolve(true)
      }
      if (!isLedgerStatusScript(script)) {
        throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
      }
      statusReadCount += 1
      if (statusReadCount === 1) {
        return new Promise((resolve) => {
          resolveOlderStatus = resolve
        })
      }
      return Promise.resolve({
        ok: true,
        verified: true,
        ledgers: preferencesAfterDraftDeletion.favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? [],
        missingLedgerIds: [],
        backupConflictLedgerIds: [],
        message: '册目查验已毕。'
      })
    })
    Object.assign(webview, { executeJavaScript })

    let staleSnapshot!: Promise<AssistantRuntimeResponsePayload>
    await act(async () => {
      staleSnapshot = requestRuntimeDirect({ id: 'stale-remote-draft-status', type: 'snapshot' })
      await vi.waitFor(() => expect(resolveOlderStatus).toBeTypeOf('function'))
    })

    notifyPreferencesChanged(preferencesAfterDraftDeletion)
    await act(async () => {
      resolveOlderStatus?.({
        ok: true,
        verified: true,
        ledgers: currentLedgers,
        missingLedgerIds: [],
        remoteOnlyDraftLedgerIds: [remoteDraft.id],
        message: '册目查验已毕。'
      })
    })

    await expect(staleSnapshot).resolves.toMatchObject({
      preferences: {
        favoriteAccountPreferences: {
          [accountMid]: {
            favoriteLedgers: expect.not.arrayContaining([expect.objectContaining({ id: remoteDraft.id })])
          }
        }
      },
      favoriteLedgerStatus: {
        ledgers: expect.not.arrayContaining([expect.objectContaining({ id: remoteDraft.id })])
      }
    })

    await expect(requestRuntime({ id: 'fresh-status-after-draft-deletion', type: 'snapshot' })).resolves.toMatchObject({
      preferences: {
        favoriteAccountPreferences: {
          [accountMid]: {
            favoriteLedgers: expect.not.arrayContaining([expect.objectContaining({ id: remoteDraft.id })])
          }
        }
      },
      favoriteLedgerStatus: {
        ledgers: expect.not.arrayContaining([expect.objectContaining({ id: remoteDraft.id })])
      }
    })
    expect(statusReadCount).toBe(2)
  })

  it('reuses a recent read-only ledger status instead of rerunning the page script for repeated snapshots', async () => {
    const accountMid = '100'
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1)
    const preferences = createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: ledgers
        }
      }
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        return {
          ok: true,
          verified: true,
          ledgers,
          missingLedgerIds: [],
          backupConflictLedgerIds: [],
          message: '册目查验已毕。'
        }
      }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await requestRuntime({ id: 'snapshot-status-1', type: 'snapshot' })
    executeJavaScript.mockClear()
    await requestRuntime({ id: 'snapshot-status-2', type: 'snapshot' })

    expect(executeJavaScript.mock.calls.filter(([script]) => isLedgerStatusScript(String(script)))).toHaveLength(0)
  })

  it('invalidates the recent status cache when the local repository revision changes', async () => {
    const accountMid = '100'
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1)
    let revision = 1
    const repositorySummary = () => ({
      version: 1, accountMid, revision, updatedAt: '2026-08-31T00:00:00.000Z',
      videoCount: 0, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0,
      syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, physicalShards: []
    })
    const { requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        favoriteAccountPreferences: { [accountMid]: { defaultFavoriteSystemEnabled: true, favoriteLedgers: ledgers } }
      })),
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid),
      openFavoriteRepositoryAccount: vi.fn().mockImplementation(async () => repositorySummary()),
      getFavoriteRepositorySnapshot: vi.fn().mockImplementation(async () => repositorySummary())
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) return { ok: true, ledgers, missingLedgerIds: [], message: '册目查验已毕。' }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await requestRuntime({ id: 'revision-status-1', type: 'snapshot' })
    executeJavaScript.mockClear()
    revision = 2
    await requestRuntime({ id: 'revision-status-2', type: 'snapshot' })

    expect(executeJavaScript.mock.calls.filter(([script]) => isLedgerStatusScript(String(script)))).toHaveLength(1)
  })

  it('shares an in-flight backup for concurrent requests from the same account', async () => {
    let resolveBackup: ((result: unknown) => void) | undefined
    const readBilibiliAccountMid = vi.fn().mockResolvedValue('100')
    const { requestRuntimeDirect } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn((script: string) => {
      if (script.includes('/x/v3/fav/folder/add')) {
        return new Promise((resolve) => {
          resolveBackup = resolve
        })
      }
      if (script.includes('document.cookie')) return Promise.resolve({ hasUserId: true, hasCsrf: true })
      if (script.includes('__bilimiRepaintVideoAfterHostResize')) return Promise.resolve(true)
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    let first!: Promise<AssistantRuntimeResponsePayload>
    await act(async () => {
      first = requestRuntimeDirect({ id: 'backup-one', type: 'ensure-ledgers' })
      await vi.waitFor(() => expect(resolveBackup).toBeTypeOf('function'))
    })
    let second!: Promise<AssistantRuntimeResponsePayload>
    await act(async () => {
      second = requestRuntimeDirect({ id: 'backup-two', type: 'ensure-ledgers' })
      await vi.waitFor(() => expect(readBilibiliAccountMid).toHaveBeenCalledTimes(2))
      await Promise.resolve()
    })
    await act(async () => {
      resolveBackup?.({
      ok: true,
      verified: true,
      ledgers: createDefaultFavoriteLedgers(),
      steps: ['api:ledger:list'],
      missingTargets: [],
      message: '册目已备齐。'
      })
    })

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true })
    ])
    expect(executeJavaScript.mock.calls.filter(([script]) => script.includes('/x/v3/fav/folder/add'))).toHaveLength(1)
  })

  it('backs up only the special inbox when the active account disabled the default favorite system', async () => {
    const { requestRuntime, notifyPreferencesChanged } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100')
    })
    const accountLedgers = createDefaultFavoriteLedgers()
    const inbox = accountLedgers.find((ledger) => ledger.id === 'inbox')!
    const ordinaryDefault = accountLedgers.find((ledger) => ledger.isDefault && ledger.id !== 'inbox')!
    notifyPreferencesChanged(createAppPreferences({
      favoriteAccountPreferences: {
        '100': { defaultFavoriteSystemEnabled: false, favoriteLedgers: accountLedgers }
      }
    }))
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('/x/v3/fav/folder/add')) {
        return {
          ok: true,
          verified: true,
          ledgers: [{ ...inbox, bilibiliFolderId: '9001', bindingState: 'bound' as const }],
          steps: ['api:ledger:list', 'api:ledger:create:inbox'], missingTargets: [], message: '已备册'
        }
      }
      if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({ id: 'backup-disabled', type: 'ensure-ledgers' })).resolves.toMatchObject({ ok: true })
    const createScript = executeJavaScript.mock.calls.map(([script]) => String(script)).find((script) => script.includes('/x/v3/fav/folder/add'))
    expect(createScript).toContain('inbox')
    const payloadMatch = createScript?.match(/const payload = (.+?);\s*\n/u)
    expect(payloadMatch?.[1]).toBeTruthy()
    const backupPayload = JSON.parse(payloadMatch![1]) as { ledgers: Array<{ id: string; enabled: boolean }> }
    expect(backupPayload.ledgers.find((ledger) => ledger.id === ordinaryDefault.id)).toMatchObject({ enabled: false })
    expect(backupPayload.ledgers.find((ledger) => ledger.id === inbox.id)).toMatchObject({ enabled: true })
  })

  it('does not back up one default folder when the active account disabled the default favorite system', async () => {
    const accountMid = '100'
    const accountLedgers = createDefaultFavoriteLedgers().map((ledger) => ledger.id === 'music'
      ? { ...ledger, enabled: true, bindingState: 'unbound' as const, managedFolderDeletedByUser: true }
      : ledger)
    const music = accountLedgers.find((ledger) => ledger.id === 'music')!
    const { requestRuntime, notifyPreferencesChanged } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    notifyPreferencesChanged(createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: { defaultFavoriteSystemEnabled: false, favoriteLedgers: accountLedgers }
      }
    }))
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (script.includes('/x/v3/fav/folder/add')) {
        return {
          ok: true,
          verified: true,
          ledgers: [{ ...music, bilibiliFolderId: '9001', bindingState: 'bound' as const }],
          steps: ['api:ledger:list', 'api:ledger:create:music'],
          missingTargets: [],
          message: '已备册'
        }
      }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({ id: 'backup-one-disabled', type: 'ensure-ledger', logicalFolderId: 'bilimi-logical:music' }))
      .resolves.toMatchObject({ ok: false, missingTargets: ['music'] })
    expect(executeJavaScript.mock.calls.some(([script]) => script.includes('/x/v3/fav/folder/add'))).toBe(false)
  })

  it('still backs up a saved custom ledger when the active account disabled the default favorite system', async () => {
    const accountMid = '100'
    const custom = {
      id: 'custom-music',
      displayName: 'bilimi·自建音乐',
      keywords: ['音乐'],
      enabled: true,
      priority: 20,
      isDefault: false
    }
    const { requestRuntime, notifyPreferencesChanged } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    notifyPreferencesChanged(createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: { defaultFavoriteSystemEnabled: false, favoriteLedgers: [custom] }
      }
    }))
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (script.includes('/x/v3/fav/folder/add')) {
        return {
          ok: true,
          verified: true,
          ledgers: [{ ...custom, bilibiliFolderId: '9001', bindingState: 'bound' as const }],
          steps: ['api:ledger:list', 'api:ledger:create:custom-music'], missingTargets: [], message: '已备册'
        }
      }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({ id: 'backup-custom-when-defaults-disabled', type: 'ensure-ledger', logicalFolderId: 'bilimi-logical:custom-music' }))
      .resolves.toMatchObject({ ok: true })
    expect(executeJavaScript.mock.calls.some(([script]) => script.includes('/x/v3/fav/folder/add'))).toBe(true)
  })

  it('still backs up the special inbox when the active account disabled the default favorite system', async () => {
    const accountMid = '100'
    const inbox = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'inbox')!
    const { requestRuntime, notifyPreferencesChanged } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue(accountMid)
    })
    notifyPreferencesChanged(createAppPreferences({
      favoriteAccountPreferences: {
        [accountMid]: { defaultFavoriteSystemEnabled: false, favoriteLedgers: [inbox] }
      }
    }))
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string, userGesture?: boolean) => {
      if (userGesture) return { hasUserId: true, hasCsrf: true }
      if (script.includes('/x/v3/fav/folder/add')) {
        return {
          ok: true,
          verified: true,
          ledgers: [{ ...inbox, bilibiliFolderId: '9001', bindingState: 'bound' as const }],
          steps: ['api:ledger:list', 'api:ledger:create:inbox'], missingTargets: [], message: '已备册'
        }
      }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({ id: 'backup-special-inbox-when-disabled', type: 'ensure-ledger', logicalFolderId: 'bilimi-logical:inbox' }))
      .resolves.toMatchObject({ ok: true })
    expect(executeJavaScript.mock.calls.some(([script]) => script.includes('/x/v3/fav/folder/add'))).toBe(true)
  })

  it('asks the user to log in before running Bilibili page actions', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('document.cookie')) {
        return ''
      }

      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: '三分钟讲清机器学习科普教程',
          pageText: '从原理到入门路线，适合学习收藏。'
        }
      }

      throw new Error('Bilibili operation should not run while logged out')
    })
    Object.assign(webview, { executeJavaScript })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1login'
          }
        })
      )
    })

    const result = await requestRuntime({
      id: 'run-logged-out',
      type: 'run-action',
      action: '藏'
    })

    expect(result).toEqual({
      ok: false,
      steps: ['auth:check'],
      missingTargets: ['bilibili-login'],
      message: '请先登录 Bilibili 后再操作。'
    })
    expect(executeJavaScript).not.toHaveBeenCalledWith(
      expect.stringContaining('/x/v3/fav/resource/deal')
    )
  })

  it('returns a Chinese no-video message before running page actions outside a video page', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('document.cookie')) {
        return 'DedeUserID=42; bili_jct=csrf'
      }

      throw new Error('Bilibili operation should not run without a current video')
    })
    Object.assign(webview, { executeJavaScript })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/'
          }
        })
      )
    })

    const result = await requestRuntime({
      id: 'run-no-video',
      type: 'run-action',
      action: '赏'
    })

    expect(result).toEqual({
      ok: false,
      steps: [],
      missingTargets: ['current-video'],
      message: '暂无视频，请先打开一个视频。'
    })
    expect(executeJavaScript).not.toHaveBeenCalledWith(
      expect.stringContaining(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER),
      true
    )
  })

  it('suppresses page interaction hints caused by assistant actions, then restores manual hints', async () => {
    vi.useFakeTimers()

    try {
      let resolveAction:
        | ((result: AssistantAutomationResult) => void)
        | undefined
      const { desktopApi, requestRuntimeDirect } = renderAppWithRuntimeBridge()
      const webview = document.getElementById('bilimi-webview') as HTMLElement & {
        executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      }
      const executeJavaScript = vi.fn(async (script: string) => {
        if (isLedgerStatusScript(script)) {
          return emptyLedgerStatus()
        }

        if (script.includes('document.cookie')) {
          return 'DedeUserID=42; bili_jct=csrf'
        }

        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            title: '自动点赞提示去重测试',
            pageText: '小咪执行赏时会自动点赞并收藏。'
          }
        }

        return new Promise<AssistantAutomationResult>((resolve) => {
          resolveAction = resolve
        })
      })
      Object.assign(webview, { executeJavaScript })

      act(() => {
        webview.dispatchEvent(
          new CustomEvent('did-navigate-in-page', {
            detail: {
              url: 'https://www.bilibili.com/video/BV1automatedhint'
            }
          })
        )
      })
      ;(desktopApi.setAssistantPetHint as ReturnType<typeof vi.fn>).mockClear()

      let actionPromise: Promise<AssistantRuntimeResponsePayload> | undefined
      await act(async () => {
        actionPromise = requestRuntimeDirect({
          id: 'run-action-with-page-hints',
          type: 'run-action',
          action: '赏',
          options: { pageClickOnly: true }
        })
        for (let index = 0; index < 10 && !resolveAction; index += 1) {
          await Promise.resolve()
        }
      })
      expect(resolveAction).toBeTypeOf('function')

      act(() => {
        webview.dispatchEvent(
          new CustomEvent('page-title-updated', {
            detail: {
              title: `__BILIMI_PET_HINT__:${encodeURIComponent(
                '小咪看到主人点赞啦，喜欢就要亮出来～'
              )}`
            }
          })
        )
      })
      expect(desktopApi.setAssistantPetHint).not.toHaveBeenCalled()

      await act(async () => {
        resolveAction?.({
          ok: true,
          steps: ['like', 'favorite'],
          missingTargets: [],
          message: '点赞归册已完成。'
        })
        await actionPromise
      })

      act(() => {
        webview.dispatchEvent(
          new CustomEvent('page-title-updated', {
            detail: {
              title: `__BILIMI_PET_HINT__:${encodeURIComponent('小咪帮主人记着：好东西要收好。')}`
            }
          })
        )
      })
      expect(desktopApi.setAssistantPetHint).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1_000)
        webview.dispatchEvent(
          new CustomEvent('page-title-updated', {
            detail: {
              title: `__BILIMI_PET_HINT__:${encodeURIComponent(
                '小咪看到主人点赞啦，喜欢就要亮出来～'
              )}`
            }
          })
        )
      })
      expect(desktopApi.setAssistantPetHint).toHaveBeenCalledWith({
        tone: 'hint',
        message: '小咪看到主人点赞啦，喜欢就要亮出来～'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens danmaku composer with Enter before pasting through the visible player bar', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      sendInputEvent?: (event: Record<string, unknown>) => void
    }
    const sentEvents: Record<string, unknown>[] = []
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('document.cookie')) {
        return 'DedeUserID=42; bili_jct=csrf'
      }

      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: 'danmaku fallback video',
          pageText: 'testing trusted input fallback'
        }
      }

      if (script.includes('__bilimiDanmakuDraftPresence')) {
        return {
          ok: true,
          steps: ['danmaku:paste-confirm'],
          missingTargets: [],
          message: '弹幕文案已写入。'
        }
      }

      if (script.includes('__bilimiTrustedPlayerActivation')) {
        return {
          ok: true,
          steps: ['player:locate'],
          missingTargets: [],
          message: '播放器已定位。',
          clickPoint: { x: 300, y: 220 },
          paused: false
        }
      }

      if (script.includes('__bilimiRestorePlayerPlaybackState')) {
        return {
          ok: true,
          steps: ['player:playback:stable'],
          missingTargets: [],
          message: '播放状态未改变。'
        }
      }

      if (script.includes('__bilimiDanmakuFieldFocus')) {
        return {
          ok: true,
          steps: ['danmaku:focus'],
          missingTargets: [],
          message: '弹幕栏已聚焦。',
          sendButtonPoint: { x: 620, y: 452 }
        }
      }

      if (script.includes('__bilimiDanmakuSubmitConfirmation')) {
        return {
          ok: true,
          steps: ['danmaku:submit'],
          missingTargets: [],
          message: '弹幕已发送，没有看到请检查弹幕开关是否开启'
        }
      }

      return {
        ok: false,
        steps: [],
        missingTargets: ['unexpected-page-script'],
        message: '不应先运行页面自动化脚本。'
      }
    })
    Object.assign(webview, {
      executeJavaScript,
      sendInputEvent: vi.fn((event: Record<string, unknown>) => {
        sentEvents.push(event)
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1danmaku'
          }
        })
      )
    })

    const result = (await requestRuntime({
      id: 'run-danmaku-trusted-input',
      type: 'run-action',
      action: '表',
      options: {
        commentDraft: 'typed',
        submitComment: true
      }
    })) as AssistantAutomationResult

    expect(writeText).toHaveBeenCalledWith('typed')
    expect(writeText.mock.invocationCallOrder[0]).toBeLessThan(
      (webview.sendInputEvent as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    )
    expect(sentEvents).toEqual([
      { type: 'mouseMove', x: 300, y: 220 },
      { button: 'left', clickCount: 1, type: 'mouseDown', x: 300, y: 220 },
      { button: 'left', clickCount: 1, type: 'mouseUp', x: 300, y: 220 },
      { keyCode: 'Enter', type: 'keyDown' },
      { keyCode: 'Enter', type: 'keyUp' },
      { keyCode: 'v', modifiers: ['control'], type: 'keyDown' },
      { keyCode: 'v', modifiers: ['control'], type: 'keyUp' },
      { keyCode: 'Enter', type: 'keyDown' },
      { keyCode: 'Enter', type: 'keyUp' }
    ])
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ keyCode: 'd' }))
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ keyCode: 'a' }))
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ keyCode: 'Backspace' }))
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ keyCode: 'Space' }))
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ button: 'left', x: 620, y: 452 }))
    const executedScripts = executeJavaScript.mock.calls.map(([script]) => String(script))
    const playbackRestoreCallIndexes = executedScripts
      .map((script, index) => (script.includes('__bilimiRestorePlayerPlaybackState') ? index : -1))
      .filter((index) => index >= 0)
    expect(playbackRestoreCallIndexes).toHaveLength(2)
    expect(executeJavaScript.mock.invocationCallOrder[playbackRestoreCallIndexes[1]]).toBeGreaterThan(
      (webview.sendInputEvent as ReturnType<typeof vi.fn>).mock.invocationCallOrder[8]
    )
    expect(executedScripts.some((script) => script.includes('__bilimiDanmakuFieldFocus'))).toBe(false)
    expect(executedScripts.some((script) => script.includes('__bilimiDanmakuDraftPresence'))).toBe(false)
    expect(executedScripts.some((script) => script.includes('__bilimiDanmakuSubmitConfirmation'))).toBe(false)
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        steps: expect.arrayContaining([
          'danmaku:trusted-paste',
          'danmaku:trusted-enter',
          'player:playback:stable'
        ])
      })
    )
    expect((result.steps ?? []).filter((step) => step === 'player:playback:stable')).toHaveLength(2)
  })

  it('generates and sends a random danmaku when a direct 表 action overrides choose mode', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      sendInputEvent?: (event: Record<string, unknown>) => void
    }
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('document.cookie')) {
        return 'DedeUserID=42; bili_jct=csrf'
      }

      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: '三分钟讲清机器学习科普教程',
          author: '李老师',
          pageText: '从原理到入门路线，适合学习收藏。'
        }
      }

      if (script.includes('__bilimiTrustedPlayerActivation')) {
        return {
          ok: true,
          steps: ['player:locate'],
          missingTargets: [],
          message: '播放器已定位。',
          clickPoint: { x: 300, y: 220 },
          paused: false
        }
      }

      if (script.includes('__bilimiRestorePlayerPlaybackState')) {
        return {
          ok: true,
          steps: ['player:playback:stable'],
          missingTargets: [],
          message: '播放状态未改变。'
        }
      }

      return {
        ok: false,
        steps: [],
        missingTargets: ['unexpected-page-script'],
        message: '随机弹幕直发不应进入普通页面脚本。'
      }
    })
    Object.assign(webview, {
      executeJavaScript,
      sendInputEvent: vi.fn()
    })

    try {
      notifyPreferencesChanged(createAppPreferences({ commentSubmitMode: 'choose' }))
      act(() => {
        webview.dispatchEvent(
          new CustomEvent('did-navigate-in-page', {
            detail: {
              url: 'https://www.bilibili.com/video/BV1random'
            }
          })
        )
      })

      const result = await requestRuntime({
        id: 'run-random-danmaku',
        type: 'run-action',
        action: '表',
        options: { submitComment: true }
      })

      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('李老师'))
      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          steps: expect.arrayContaining(['danmaku:trusted-paste', 'danmaku:trusted-enter'])
        })
      )
    } finally {
      random.mockRestore()
    }
  })

  it('returns a structured danmaku clipboard error instead of throwing through the runtime bridge', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      sendInputEvent?: (event: Record<string, unknown>) => void
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Document is not focused.')) }
    })
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('document.cookie')) {
        return 'DedeUserID=42; bili_jct=csrf'
      }

      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: 'danmaku clipboard failure video',
          pageText: 'testing clipboard failure handling'
        }
      }

      if (script.includes('__bilimiDanmakuDraftPresence')) {
        return {
          ok: true,
          steps: ['danmaku:paste-confirm'],
          missingTargets: [],
          message: '弹幕文案已写入。'
        }
      }

      return {
        ok: false,
        steps: [],
        missingTargets: ['unexpected-page-script'],
        message: 'Clipboard failure should stop before page automation.'
      }
    })
    Object.assign(webview, {
      executeJavaScript,
      sendInputEvent: vi.fn()
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1clipboard'
          }
        })
      )
    })

    await expect(
      requestRuntime({
        id: 'run-danmaku-clipboard-error',
        type: 'run-action',
        action: '表',
        options: {
          commentDraft: 'typed',
          submitComment: true
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        missingTargets: ['trusted-danmaku-clipboard']
      })
    )
    expect(webview.sendInputEvent).not.toHaveBeenCalled()
  })

  it('falls back to the desktop clipboard when the Web Clipboard API is not focused', async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      writeClipboardText
    })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      sendInputEvent?: (event: Record<string, unknown>) => void
    }
    const writeText = vi.fn().mockRejectedValue(new Error('Document is not focused.'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('document.cookie')) {
        return 'DedeUserID=42; bili_jct=csrf'
      }

      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: 'clipboard fallback video',
          pageText: 'testing clipboard fallback'
        }
      }

      if (script.includes('__bilimiTrustedPlayerActivation')) {
        return {
          ok: true,
          steps: ['player:locate'],
          missingTargets: [],
          message: '播放器已定位。',
          clickPoint: { x: 300, y: 220 },
          paused: false
        }
      }

      if (script.includes('__bilimiRestorePlayerPlaybackState')) {
        return {
          ok: true,
          steps: ['player:playback:stable'],
          missingTargets: [],
          message: '播放状态未改变。'
        }
      }

      return {
        ok: false,
        steps: [],
        missingTargets: ['unexpected-page-script'],
        message: '桌面剪贴板兜底不应进入普通页面脚本。'
      }
    })
    Object.assign(webview, {
      executeJavaScript,
      sendInputEvent: vi.fn()
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1desktopclipboard'
          }
        })
      )
    })

    const result = await requestRuntime({
      id: 'run-danmaku-desktop-clipboard',
      type: 'run-action',
      action: '表',
      options: {
        commentDraft: 'typed',
        submitComment: true
      }
    })

    expect(writeText).toHaveBeenCalledWith('typed')
    expect(writeClipboardText).toHaveBeenCalledWith('typed')
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        steps: expect.arrayContaining(['danmaku:trusted-paste', 'danmaku:trusted-enter'])
      })
    )
  })

  it('opens the composer without pressing d even when the player reports danmaku off', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      paste?: () => void
      sendInputEvent?: (event: Record<string, unknown>) => void
    }
    const sentEvents: Record<string, unknown>[] = []
    const paste = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('document.cookie')) {
        return 'DedeUserID=42; bili_jct=csrf'
      }

      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: 'danmaku off video',
          pageText: 'testing conditional d shortcut'
        }
      }

      if (script.includes('__bilimiDanmakuDraftPresence')) {
        return {
          ok: true,
          steps: ['danmaku:paste-confirm'],
          missingTargets: [],
          message: '弹幕文案已写入。'
        }
      }

      if (script.includes('__bilimiTrustedPlayerActivation')) {
        return {
          ok: true,
          steps: ['player:locate'],
          missingTargets: [],
          message: '播放器已定位。',
          clickPoint: { x: 320, y: 240 },
          paused: false
        }
      }

      if (script.includes('__bilimiRestorePlayerPlaybackState')) {
        return {
          ok: true,
          steps: ['player:playback:stable'],
          missingTargets: [],
          message: '播放状态未改变。'
        }
      }

      if (script.includes('__bilimiDanmakuFieldFocus')) {
        return {
          ok: true,
          steps: ['danmaku:focus'],
          missingTargets: [],
          message: '弹幕栏已聚焦。',
          sendButtonPoint: { x: 620, y: 452 }
        }
      }

      if (script.includes('__bilimiDanmakuSubmitConfirmation')) {
        return {
          ok: true,
          steps: ['danmaku:submit'],
          missingTargets: [],
          message: '弹幕已发送，没有看到请检查弹幕开关是否开启'
        }
      }

      return {
        ok: false,
        steps: [],
        missingTargets: ['unexpected-page-script'],
        message: '不应先运行页面自动化脚本。'
      }
    })
    Object.assign(webview, {
      executeJavaScript,
      paste,
      sendInputEvent: vi.fn((event: Record<string, unknown>) => {
        sentEvents.push(event)
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1danmakuoff'
          }
        })
      )
    })

    await requestRuntime({
      id: 'run-danmaku-off-trusted-input',
      type: 'run-action',
      action: '表',
      options: {
        commentDraft: 'typed',
        submitComment: true
      }
    })

    expect(sentEvents.slice(0, 3)).toEqual([
      { type: 'mouseMove', x: 320, y: 240 },
      { button: 'left', clickCount: 1, type: 'mouseDown', x: 320, y: 240 },
      { button: 'left', clickCount: 1, type: 'mouseUp', x: 320, y: 240 }
    ])
    expect(sentEvents).toEqual(
      expect.arrayContaining([
        { keyCode: 'v', modifiers: ['control'], type: 'keyDown' },
        { keyCode: 'v', modifiers: ['control'], type: 'keyUp' }
      ])
    )
    expect(paste).not.toHaveBeenCalled()
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ keyCode: 'd' }))
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ keyCode: 'a' }))
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ keyCode: 'Backspace' }))
  })

  it('restores a manually deselected default ledger for automatic review collection', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const preferences = createAppPreferences({
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) =>
        ledger.id === 'music' ? { ...ledger, enabled: false } : ledger
      )
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      savePreferences
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: '大阪地铁自动扶梯现场音乐',
          pageText: '演奏 音乐 现场',
          tags: ['音乐现场']
        }
      }

      return {
        ok: true,
        steps: ['favorite:open', 'favorite:folder', 'favorite'],
        missingTargets: [],
        message: '已按内容归入内库。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1suggested'
          }
        })
      )
    })

    const result = await requestRuntime({
      id: 'run-suggested-default',
      type: 'run-action',
      action: '藏',
      options: { pageClickOnly: true }
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    await waitFor(() =>
      expect(executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('"targetLedgerId":"music"')
      )
    )
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        preferenceCounts: expect.objectContaining({
          music: 1
        })
      })
    )
    expect(savePreferences).not.toHaveBeenCalledWith(
      expect.objectContaining({
        preferenceCounts: expect.objectContaining({
          inbox: 1
        })
      })
    )
  })

  it('does not add local diagnostic keyword suggestions after a successful favorite action', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const preferences = createAppPreferences({
      favoriteLedgers: createDefaultFavoriteLedgers()
        .filter((ledger) => ['game', 'inbox'].includes(ledger.id))
        .map((ledger) =>
          ledger.id === 'game'
            ? { ...ledger, keywords: ['攻略'], bilibiliFolderId: '9002' }
            : ledger
        )
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      savePreferences
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 706,
          title: '攻略',
          pageText: '攻略',
          tags: ['攻略']
        }
      }

      return {
        ok: true,
        steps: ['favorite:open', 'favorite:folder', 'favorite'],
        missingTargets: [],
        message: '已按内容归入内库。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1localsuggestion'
          }
        })
      )
    })

    const result = await requestRuntime({
      id: 'run-local-suggestion',
      type: 'run-action',
      action: '藏',
      options: { pageClickOnly: true }
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    await waitFor(() => expect(savePreferences).toHaveBeenCalled())
    expect(savePreferences).not.toHaveBeenCalledWith(
      expect.objectContaining({
        favoriteKeywordSuggestions: expect.arrayContaining([
          expect.objectContaining({
            source: 'classifier'
          })
        ])
      })
    )
  })

  it('uses DeepSeek daily classification review before executing a corrected favorite action', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const generateDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-daily-classify-review',
      targetLedgerIds: ['game'],
      corrected: true,
      reason: 'DeepSeek 认为地铁攻略先进入游戏攻略测试册。',
      confidence: 0.84,
      keywordSuggestions: [
        {
          id: 'deepseek:game:replace-with-combination:攻略:游戏攻略:new',
          action: 'replace-with-combination',
          ledgerId: 'game',
          keyword: '攻略',
          replacement: '游戏攻略',
          reason: '裸攻略容易误判旅行内容',
          source: 'deepseek',
          status: 'pending',
          createdAt: '2026-07-06T00:00:00.000Z'
        }
      ]
    })
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off',
      favoriteKeywordSuggestions: [
        {
          id: 'existing-accepted-game-guide',
          action: 'replace-with-combination',
          ledgerId: 'game',
          keyword: '攻略',
          replacement: '游戏攻略',
          reason: '已采纳过的同签名建议不应重复加入。',
          source: 'deepseek',
          status: 'accepted',
          createdAt: '2026-07-05T00:00:00.000Z'
        }
      ],
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) => {
        if (ledger.id === 'game') {
          return { ...ledger, keywords: ['地铁攻略'], bilibiliFolderId: '9002', isDefault: false }
        }
        if (ledger.id === 'life-interest') {
          return {
            ...ledger,
            keywords: ['大阪生活', '【DeepSeek约束】', '只收真实出行经验，不收游戏攻略。'],
            bilibiliFolderId: '9005'
          }
        }
        return ledger
      })
    })
    const { desktopApi, notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      savePreferences,
      commitFavoriteRepositoryCommand: vi.fn().mockResolvedValue(undefined)
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 701,
          title: '大阪地铁换乘攻略',
          author: '旅行研究所',
          pageText: '大阪地铁换乘攻略',
          tags: ['地铁攻略'],
          category: ''
        }
      }

      if (script.includes('/x/v3/fav/resource/deal')) {
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          message: '已用 B 站接口归入 bilimi 收藏夹。'
        }
      }

      return {
        ok: true,
        steps: ['favorite:open', 'favorite:folder', 'favorite'],
        missingTargets: [],
        message: '已按内容归入内库。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1dailydeepseek'
          }
        })
      )
    })

    const result = await requestRuntime({
      id: 'run-daily-deepseek',
      type: 'run-action',
      action: '藏'
    })

    expect(generateDeepSeek).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'favorite-daily-classify-review',
        video: expect.objectContaining({ aid: 701, title: '大阪地铁换乘攻略' }),
        localClassification: expect.objectContaining({
          targetLedgerIds: ['life-interest']
        }),
        ledgers: expect.arrayContaining([
          expect.objectContaining({
            id: 'life-interest',
            keywords: ['大阪生活'],
            deepSeekConstraint: '只收真实出行经验，不收游戏攻略。'
          })
        ])
      })
    )
    const apiScript = executeJavaScript.mock.calls
      .map(([script]) => String(script))
      .find((script) => script.includes('/x/v3/fav/resource/deal')) ?? ''
    expect(apiScript).toContain('"targetLedgerIds":["game"]')
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining(
          'DeepSeek 二判完成：建议从「bilimi·生活日常」改归「bilimi·游戏专区」，已按二判结果执行。'
        )
      })
    )
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        preferenceCounts: expect.objectContaining({
          game: 1
        }),
        favoriteCorrectionRecords: expect.arrayContaining([
          expect.objectContaining({
            aid: 701,
            originalLedgerId: 'life-interest',
            userLedgerIds: ['game'],
            source: 'user-confirmed-deepseek',
            sourceScene: 'daily-favorite'
          })
        ]),
        favoriteKeywordSuggestions: [
          expect.objectContaining({
            id: 'existing-accepted-game-guide',
            source: 'deepseek',
            status: 'accepted'
          })
        ]
      })
    )
  })

  it('adjusts an already-favorited local target when DeepSeek daily review returns after the action', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                kind: 'favorite-daily-classify-review',
                targetLedgerIds: ['game'],
                corrected: true,
                reason: 'DeepSeek 延迟判断后认为应移入游戏攻略。',
                confidence: 0.8,
                keywordSuggestions: []
              }),
            5
          )
        })
    )
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off',
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) => {
        if (ledger.id === 'game') {
          return { ...ledger, keywords: ['地铁攻略'], bilibiliFolderId: '9002' }
        }
        if (ledger.id === 'life-interest') {
          return { ...ledger, keywords: ['大阪生活'], bilibiliFolderId: '9005' }
        }
        return ledger
      })
    })
    const { desktopApi, notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      savePreferences,
      commitFavoriteRepositoryCommand: vi.fn().mockResolvedValue(undefined)
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 702,
          title: '大阪地铁换乘攻略',
          author: '旅行研究所',
          pageText: '大阪地铁换乘攻略',
          tags: ['地铁攻略'],
          category: ''
        }
      }

      if (script.includes('/x/v3/fav/resource/deal')) {
        const isAdjustment = script.includes('api:favorite:adjust')
        return {
          ok: true,
          steps: isAdjustment
            ? ['api:favorite:adjust-list', 'api:favorite:adjust']
            : ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          favoriteFolderIdsByLedgerId: isAdjustment
            ? { game: '9002', 'life-interest': '9005' }
            : { 'life-interest': '9005' },
          message: isAdjustment
            ? 'DeepSeek 后台归类调整已完成。'
            : '已用 B 站接口归入 bilimi 收藏夹。'
        }
      }

      return {
        ok: true,
        steps: ['favorite:open', 'favorite:folder', 'favorite'],
        missingTargets: [],
        message: '已按内容归入内库。'
      }
    })
    Object.assign(webview, { executeJavaScript })

    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1dailydeepseeklate'
          }
        })
      )
    })

    const result = await requestRuntime({
      id: 'run-daily-deepseek-late',
      type: 'run-action',
      action: '藏'
    })
    await waitFor(() =>
      expect(
        executeJavaScript.mock.calls
          .map(([script]) => String(script))
          .filter((script) => script.includes('/x/v3/fav/resource/deal'))
      ).toHaveLength(2)
    )
    const apiScripts = executeJavaScript.mock.calls
      .map(([script]) => String(script))
      .filter((script) => script.includes('/x/v3/fav/resource/deal'))

    expect(apiScripts[0]).toContain('"targetLedgerIds":["life-interest"]')
    expect(apiScripts[1]).toContain('"addLedgerIds":["game"]')
    expect(apiScripts[1]).toContain('"removeLedgerIds":["life-interest"]')
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('已归类存入 bilimi·生活日常')
      })
    )
    await waitFor(() =>
      expect(desktopApi.setAssistantPetHint).toHaveBeenCalledWith({
        tone: 'happy',
        message:
          '主人，DeepSeek重新判断有调整哦～已从「bilimi·生活日常」改存到「bilimi·游戏专区」。'
      })
    )
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          favoriteCorrectionRecords: expect.arrayContaining([
            expect.objectContaining({
              aid: 702,
              originalLedgerId: 'life-interest',
              userLedgerIds: ['game'],
              source: 'user-confirmed-deepseek'
            })
          ])
        })
      )
    )
    expect(
      await requestRuntime({ id: 'snapshot-daily-deepseek-late', type: 'snapshot' })
    ).toEqual(
      expect.objectContaining({
        runtimeFeedback:
          'DeepSeek 二判完成：建议从「bilimi·生活日常」改归「bilimi·游戏专区」，已完成调整。'
      })
    )
  })

  it('does not adjust a delayed DeepSeek review into a locally unbound target', async () => {
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(() => new Promise((resolve) => {
      setTimeout(() => resolve({
        kind: 'favorite-daily-classify-review',
        targetLedgerIds: ['game'],
        corrected: true,
        reason: 'DeepSeek 建议归入游戏专区。',
        confidence: 0.8,
        keywordSuggestions: []
      }), 5)
    }))
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off',
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) => {
        if (ledger.id === 'game') return { ...ledger, keywords: ['游戏专用'], bindingState: 'unbound' }
        if (ledger.id === 'life-interest') return { ...ledger, keywords: ['大阪生活'] }
        return ledger
      })
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100')
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 711,
          bvid: 'BV1review711',
          title: '大阪地铁换乘攻略',
          pageText: '大阪生活 地铁攻略',
          tags: ['地铁攻略']
        }
      }
      if (script.includes('/x/v3/fav/resource/deal') || script.includes('/x/v3/fav/folder/add')) {
        return {
          ok: true,
          steps: ['unexpected:favorite-write'],
          missingTargets: [],
          message: '不应执行收藏写入。'
        }
      }
      return { ok: true, steps: ['like'], missingTargets: [], message: '点赞已完成。' }
    })
    Object.assign(webview, { executeJavaScript })

    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)
    await expect(requestRuntime({ id: 'delayed-unbound-target-snapshot', type: 'snapshot' })).resolves.toMatchObject({
      preferences: {
        favoriteAccountPreferences: {
          '100': {
            favoriteLedgers: expect.arrayContaining([
              expect.objectContaining({ id: 'game', bindingState: 'unbound' })
            ])
          }
        }
      }
    })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1review711' }
      }))
    })
    await requestRuntime({ id: 'delayed-unbound-target-review', type: 'run-action', action: '赏' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    expect(generateDeepSeek).toHaveBeenCalledOnce()
    expect(
      executeJavaScript.mock.calls.some(([script]) =>
        String(script).includes('"addLedgerIds":["game"]')
      )
    ).toBe(false)
    await expect(requestRuntime({ id: 'delayed-unbound-target-feedback', type: 'snapshot' })).resolves.toEqual(
      expect.objectContaining({
        runtimeFeedback: expect.stringContaining('掌库收藏夹备册或重新绑定')
      })
    )
  })

  it('rechecks favorite bindings before a delayed DeepSeek adjustment writes to Bilibili', async () => {
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(() => new Promise((resolve) => {
      setTimeout(() => resolve({
        kind: 'favorite-daily-classify-review',
        targetLedgerIds: ['game'],
        corrected: true,
        reason: 'DeepSeek 建议归入游戏专区。',
        confidence: 0.8,
        keywordSuggestions: []
      }), 5)
    }))
    const provisionedLedgers = createDefaultFavoriteLedgers().map((ledger, index) => {
      if (ledger.id === 'game') return { ...ledger, keywords: ['游戏专用'], bilibiliFolderId: String(9_200 + index), bindingState: 'bound' as const }
      if (ledger.id === 'life-interest') return { ...ledger, keywords: ['大阪生活'], bilibiliFolderId: String(9_200 + index), bindingState: 'bound' as const }
      return { ...ledger, bilibiliFolderId: String(9_200 + index), bindingState: 'bound' as const }
    })
    const localDraftLedgers = provisionedLedgers.map((ledger) =>
      ledger.id === 'game'
        ? {
            ...ledger,
            bilibiliFolderId: undefined,
            bindingState: 'unbacked' as const,
            syncState: 'local-draft' as const
          }
        : ledger
    )
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off',
      favoriteLedgers: provisionedLedgers
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100')
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    let statusReadCount = 0
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        statusReadCount += 1
        return statusReadCount < 3
          ? {
              ok: true,
              verified: true,
              ledgers: provisionedLedgers,
              missingLedgerIds: [],
              backupConflictLedgerIds: [],
              unboundLedgerIds: [],
              message: '收藏夹已可用。'
            }
          : {
              ok: true,
              verified: true,
              ledgers: localDraftLedgers,
              missingLedgerIds: [],
              backupConflictLedgerIds: [],
              unboundLedgerIds: [],
              message: '延迟调整预检发现游戏专区尚未绑定。'
            }
      }
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 712,
          bvid: 'BV1review712',
          title: '大阪地铁换乘攻略',
          pageText: '大阪生活',
          tags: ['大阪生活']
        }
      }
      if (script.includes('/x/v3/fav/resource/deal')) {
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          message: '已归类到生活日常。'
        }
      }
      return { ok: true, steps: [], missingTargets: [], message: '操作完成。' }
    })
    Object.assign(webview, { executeJavaScript })

    await requestRuntime({ id: 'delayed-preflight-snapshot', type: 'snapshot' })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1review712' }
      }))
    })
    await requestRuntime({ id: 'delayed-preflight-review', type: 'run-action', action: '藏' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    // The final action also reads the bound shard capacity before any write.
    expect(statusReadCount).toBe(4)
    expect(
      executeJavaScript.mock.calls.some(([script]) =>
        String(script).includes('"addLedgerIds":["game"]')
      )
    ).toBe(false)
    await expect(requestRuntime({ id: 'delayed-preflight-feedback', type: 'snapshot' })).resolves.toEqual(
      expect.objectContaining({
        runtimeFeedback: expect.stringContaining('掌库收藏夹备册或重新绑定')
      })
    )
  })

  it('replaces an initial inbox favorite with the DeepSeek knowledge correction', async () => {
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                kind: 'favorite-daily-classify-review',
                targetLedgerIds: ['knowledge'],
                corrected: true,
                reason: 'DeepSeek review found durable learning value.',
                confidence: 0.8,
                keywordSuggestions: []
              }),
            5
          )
        })
    )
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off'
    })
    const commitFavoriteRepositoryCommand = vi.fn().mockResolvedValue(undefined)
    const commitConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      commitFavoriteRepositoryCommand,
      commitConfirmedFavoriteReview
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 712,
          title: 'A video pending classification',
          pageText: 'Save this for later review.',
          tags: [],
          category: ''
        }
      }

      if (script.includes('api:favorite:adjust-list')) {
        return {
          ok: true,
          steps: ['api:favorite:adjust-list', 'api:favorite:adjust'],
          missingTargets: [],
          favoriteFolderIdsByLedgerId: { inbox: '9008', knowledge: '9001' },
          message: 'DeepSeek adjustment completed.'
        }
      }

      if (script.includes('/x/v3/fav/resource/deal')) {
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          favoriteFolderIdsByLedgerId: { inbox: '9008' },
          message: 'Saved to bilimi temporary.'
        }
      }

      return { ok: true, steps: ['favorite'], missingTargets: [], message: 'Favorite completed.' }
    })
    Object.assign(webview, { executeJavaScript })
    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)
    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1dailyinboxknowledge' }
        })
      )
    })

    await requestRuntime({ id: 'run-daily-inbox-knowledge', type: 'run-action', action: '藏' })
    await waitFor(async () =>
      expect(
        executeJavaScript.mock.calls
          .map(([script]) => String(script))
          .filter((script) => script.includes('api:favorite:adjust'))
      ).toHaveLength(1)
    )
    const adjustmentScript = executeJavaScript.mock.calls
      .map(([script]) => String(script))
      .find((script) => script.includes('api:favorite:adjust'))

    expect(adjustmentScript).toContain('"addLedgerIds":["knowledge"]')
    expect(adjustmentScript).toContain('"removeLedgerIds":["inbox"]')
    expect(commitConfirmedFavoriteReview).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        aid: 712,
        targets: [{ logicalFolderId: 'bilimi-logical:knowledge', remoteFolderId: '9001', title: 'bilimi·知识学习' }],
        event: expect.objectContaining({ kind: 'daily-review' })
      })
    )
  })

  it('persists a result-unknown daily-review position without removal evidence', async () => {
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                kind: 'favorite-daily-classify-review',
                targetLedgerIds: ['knowledge'],
                corrected: true,
                reason: 'DeepSeek review found durable learning value.',
                confidence: 0.8,
                keywordSuggestions: []
              }),
            5
          )
        })
    )
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off'
    })
    const commitFavoriteRepositoryCommand = vi.fn().mockResolvedValue(undefined)
    const commitConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      commitFavoriteRepositoryCommand,
      commitConfirmedFavoriteReview
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 713,
            title: 'A video pending classification',
            pageText: 'Save this for later review.',
            tags: [],
            category: ''
          }
        }

        if (script.includes('api:favorite:adjust-list')) {
          return {
            ok: true,
            steps: ['api:favorite:adjust-list', 'api:favorite:adjust'],
            missingTargets: [],
            favoriteFolderIdsByLedgerId: { knowledge: '9001' },
            message: 'DeepSeek adjustment completed without removal evidence.'
          }
        }

        if (script.includes('/x/v3/fav/resource/deal')) {
          return {
            ok: true,
            steps: ['api:favorite:list', 'api:favorite:add'],
            missingTargets: [],
            favoriteFolderIdsByLedgerId: { inbox: '9008' },
            message: 'Saved to bilimi temporary.'
          }
        }

        return { ok: true, steps: ['favorite'], missingTargets: [], message: 'Favorite completed.' }
      })
    })
    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)
    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1dailyincomplete' }
        })
      )
    })

    await requestRuntime({ id: 'run-daily-incomplete', type: 'run-action', action: '藏' })
    await waitFor(() => expect(generateDeepSeek).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(commitFavoriteRepositoryCommand).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        type: 'set-favorite-position',
        payload: expect.objectContaining({
          aid: 713,
          localDesiredFolderIds: ['bilimi-logical:knowledge'],
          remoteObservedPhysicalFolderIds: ['9001', '9008'],
          remoteObservedLogicalFolderIds: [
            'bilimi-logical:knowledge',
            'bilimi-logical:inbox'
          ],
          positionState: 'result-unknown'
        })
      })
    )
    expect(commitFavoriteRepositoryCommand).not.toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        type: 'set-favorite-position',
        payload: expect.objectContaining({
          aid: 713,
          localDesiredFolderIds: ['bilimi-logical:knowledge'],
          positionState: 'aligned'
        })
      })
    )
    await waitFor(async () =>
      expect(
        await requestRuntime({ id: 'snapshot-daily-incomplete', type: 'snapshot' })
      ).toEqual(
        expect.objectContaining({
          runtimeFeedback: expect.stringContaining('待核对')
        })
      )
    )
    const incompleteFeedback = (
      await requestRuntime({ id: 'snapshot-daily-incomplete-copy', type: 'snapshot' })
    )?.runtimeFeedback
    expect(incompleteFeedback).not.toContain('已完成调整')
    expect(window.bilimiDesktop.setAssistantPetHint).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'error',
        message: expect.stringContaining('待核对')
      })
    )
    expect(window.bilimiDesktop.setAssistantPetHint).not.toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'happy',
        message: expect.stringContaining('改存到')
      })
    )
  })

  it('continues a delayed DeepSeek adjustment for the frozen video after the active tab changes', async () => {
    let resolveReview: ((result: DeepSeekGenerateResult) => void) | undefined
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(
      () =>
        new Promise((resolve) => {
          resolveReview = resolve
        })
    )
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off',
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) => {
        if (ledger.id === 'game') {
          return { ...ledger, keywords: ['地铁攻略'], bilibiliFolderId: '9002' }
        }
        if (ledger.id === 'life-interest') {
          return { ...ledger, keywords: ['大阪生活'], bilibiliFolderId: '9005' }
        }
        return ledger
      })
    })
    const commitFavoriteRepositoryCommand = vi.fn().mockResolvedValue(undefined)
    const commitConfirmedFavoriteReview = vi.fn().mockResolvedValue(undefined)
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      commitFavoriteRepositoryCommand,
      commitConfirmedFavoriteReview
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 710,
          title: '大阪地铁换乘攻略',
          author: '旅行研究所',
          pageText: '大阪地铁换乘攻略',
          tags: ['地铁攻略'],
          category: ''
        }
      }

      if (script.includes('api:favorite:adjust-list')) {
        return {
          ok: true,
          steps: ['api:favorite:adjust-list', 'api:favorite:adjust'],
          missingTargets: [],
          favoriteFolderIdsByLedgerId: { game: '9002', 'life-interest': '9005' },
          message: 'DeepSeek 后台归类调整已完成。'
        }
      }

      if (script.includes('/x/v3/fav/resource/deal')) {
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          favoriteFolderIdsByLedgerId: { 'life-interest': '9005' },
          message: '已用 B 站接口归入 bilimi 收藏夹。'
        }
      }

      return { ok: true, steps: ['favorite'], missingTargets: [], message: '已完成收藏。' }
    })
    Object.assign(webview, { executeJavaScript })
    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)
    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1dailybeforechange' }
        })
      )
    })

    await requestRuntime({ id: 'run-daily-before-tab-change', type: 'run-action', action: '藏' })
    await waitFor(() => expect(generateDeepSeek).toHaveBeenCalledTimes(1))

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1differentvideo' }
        })
      )
    })
    resolveReview?.({
      kind: 'favorite-daily-classify-review',
      targetLedgerIds: ['game'],
      corrected: true,
      reason: 'DeepSeek 延迟判断后认为应移入游戏攻略。',
      confidence: 0.8,
      keywordSuggestions: []
    })

    await waitFor(async () =>
      expect(
        await requestRuntime({ id: 'snapshot-after-tab-change', type: 'snapshot' })
      ).toEqual(
        expect.objectContaining({
          runtimeFeedback:
            'DeepSeek 二判完成：建议从「bilimi·生活日常」改归「bilimi·游戏专区」，已完成调整。'
        })
      )
    )
    const adjustmentScripts = executeJavaScript.mock.calls
      .map(([script]) => String(script))
      .filter((script) => script.includes('api:favorite:adjust'))
    expect(adjustmentScripts).toHaveLength(1)
    expect(adjustmentScripts[0]).toContain('"aid":710')
    expect(adjustmentScripts[0]).toContain('"accountMid":"100"')
    expect(commitConfirmedFavoriteReview).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        aid: 710,
        targets: [{ logicalFolderId: 'bilimi-logical:game', remoteFolderId: '9002', title: 'bilimi·游戏专区' }],
        event: expect.objectContaining({ kind: 'daily-review', folderTitlesAtTime: ['bilimi·游戏专区'] })
      })
    )
    expect(commitFavoriteRepositoryCommand).not.toHaveBeenCalled()
  })

  it('does not run the main action when the active tab changes while context is loading', async () => {
    let resolveVideoContext: ((context: unknown) => void) | undefined
    const { requestRuntimeDirect } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn((script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return new Promise((resolve) => {
          resolveVideoContext = resolve
        })
      }

      return Promise.resolve({
        ok: true,
        steps: ['favorite'],
        missingTargets: [],
        message: '已完成收藏。'
      })
    })
    Object.assign(webview, { executeJavaScript })
    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1contextloading' }
        })
      )
    })

    const actionPromise = requestRuntimeDirect({
      id: 'run-action-before-tab-change',
      type: 'run-action',
      action: '藏'
    })
    await waitFor(() => expect(resolveVideoContext).toBeTypeOf('function'))
    act(() => {
      webview.dispatchEvent(
        new CustomEvent('new-window', {
          detail: { url: 'https://www.bilibili.com/video/BV1changedwhileloading' }
        })
      )
    })
    let result: AssistantRuntimeResponsePayload | undefined
    await act(async () => {
      resolveVideoContext?.({
        aid: 711,
        title: '加载中的原视频',
        pageText: '加载中的原视频',
        tags: []
      })
      result = await actionPromise
    })

    expect(result).toEqual({
      ok: false,
      steps: [],
      missingTargets: ['active-video-changed'],
      message: '页面已切换，本次操作未执行。'
    })
    expect(
      executeJavaScript.mock.calls
        .map(([script]) => String(script))
        .filter(
          (script) =>
            script.includes('/x/v3/fav/resource/deal') ||
            script.includes('api:favorite:adjust') ||
            script.includes('favorite:open')
        )
    ).toHaveLength(0)
  })

  it('reports an agreeing DeepSeek daily review in the runtime feedback', async () => {
    const generateDeepSeek = vi.fn(async (): Promise<DeepSeekGenerateResult> => ({
      kind: 'favorite-daily-classify-review',
      targetLedgerIds: ['life-interest'],
      appliedConstraintLedgerIds: ['life-interest'],
      corrected: false,
      reason: '本地判断正确。',
      confidence: 0.9,
      keywordSuggestions: []
    }))
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) =>
        ledger.id === 'life-interest'
          ? { ...ledger, keywords: ['大阪生活'], bilibiliFolderId: '9005' }
          : ledger
      )
    })
    const { desktopApi, notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) =>
        script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)
          ? { aid: 709, title: '大阪生活记录', pageText: '大阪生活记录', tags: ['大阪生活'] }
          : isLedgerStatusScript(script)
            ? {
                ok: true,
                verified: true,
                ledgers: preferences.favoriteLedgers,
                missingLedgerIds: [],
                backupConflictLedgerIds: [],
                unboundLedgerIds: []
              }
            : { ok: true, steps: ['favorite'], missingTargets: [], message: '已完成收藏。' }
      )
    })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1dailyagree' }
      }))
    })

    const result = await requestRuntime({ id: 'run-daily-agree', type: 'run-action', action: '藏' })

    expect(result).toEqual(expect.objectContaining({
      message: expect.stringContaining('DeepSeek 二判完成：DeepSeek 约束生效：「bilimi·生活日常」；与本地判断一致，保留在「bilimi·生活日常」')
    }))
    expect(await requestRuntime({ id: 'snapshot-daily-agree', type: 'snapshot' })).toEqual(
      expect.objectContaining({
        runtimeFeedback: 'DeepSeek 二判完成：DeepSeek 约束生效：「bilimi·生活日常」；与本地判断一致，保留在「bilimi·生活日常」。'
      })
    )
    expect(desktopApi.setAssistantPetHint).toHaveBeenCalledWith({
      tone: 'happy',
      message: '主人，DeepSeek复核过啦～与原建议一致，存入「bilimi·生活日常」。'
    })
  })

  it('places an unmatched favorite constraint after the agreeing DeepSeek daily review conclusion', async () => {
    const generateDeepSeek = vi.fn(async (): Promise<DeepSeekGenerateResult> => ({
      kind: 'favorite-daily-classify-review',
      targetLedgerIds: ['life-interest'],
      appliedConstraintLedgerIds: [],
      corrected: false,
      reason: '本地判断正确。',
      confidence: 0.9,
      keywordSuggestions: []
    }))
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) =>
        ledger.id === 'life-interest'
          ? { ...ledger, keywords: ['大陸生活'], bilibiliFolderId: '9005' }
          : ledger
      )
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({ generateDeepSeek })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) =>
        script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)
          ? { aid: 710, title: '大陸生活記錄', pageText: '大陸生活記錄', tags: ['大陸生活'] }
          : isLedgerStatusScript(script)
            ? {
                ok: true,
                verified: true,
                ledgers: preferences.favoriteLedgers,
                missingLedgerIds: [],
                backupConflictLedgerIds: [],
                unboundLedgerIds: []
              }
            : { ok: true, steps: ['favorite'], missingTargets: [], message: '已完成收藏。' }
      )
    })
    act(() => {
      webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
        detail: { url: 'https://www.bilibili.com/video/BV1dailyunmatched' }
      }))
    })

    const result = await requestRuntime({ id: 'run-daily-unmatched', type: 'run-action', action: '藏' })

    expect(result).toEqual(expect.objectContaining({
      message: expect.stringContaining('DeepSeek 二判完成：与本地判断一致，保留在「bilimi·生活日常」；本次未命中收藏夹约束。')
    }))
  })

  it('keeps local favorite state and skips confirmed learning when delayed DeepSeek adjustment fails', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                kind: 'favorite-daily-classify-review',
                targetLedgerIds: ['game'],
                corrected: true,
                reason: 'DeepSeek 延迟判断后认为应移入游戏攻略。',
                confidence: 0.8,
                keywordSuggestions: []
              }),
            5
          )
        })
    )
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off',
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) => {
        if (ledger.id === 'game') {
          return { ...ledger, keywords: ['地铁攻略'], bilibiliFolderId: '9002' }
        }
        if (ledger.id === 'life-interest') {
          return { ...ledger, keywords: ['大阪生活'], bilibiliFolderId: '9005' }
        }
        return ledger
      })
    })
    const { desktopApi, notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      savePreferences
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 703,
            title: '大阪地铁换乘攻略',
            author: '旅行研究所',
            pageText: '大阪地铁换乘攻略',
            tags: ['地铁攻略'],
            category: ''
          }
        }

        if (script.includes('/x/v3/fav/resource/deal')) {
          const isAdjustment = script.includes('api:favorite:adjust')
          return {
            ok: !isAdjustment,
            steps: isAdjustment
              ? ['api:favorite:adjust-list']
              : ['api:favorite:list', 'api:favorite:add'],
            missingTargets: isAdjustment ? ['favorite-api-adjust'] : [],
            message: isAdjustment
              ? 'DeepSeek 后台归类调整未能完成：网络错误'
              : '已用 B 站接口归入 bilimi 收藏夹。'
          }
        }

        return {
          ok: true,
          steps: ['favorite:open', 'favorite:folder', 'favorite'],
          missingTargets: [],
          message: '已按内容归入内库。'
        }
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1dailydeepseekfail'
          }
        })
      )
    })

    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)

    const result = await requestRuntime({
      id: 'run-daily-deepseek-fail',
      type: 'run-action',
      action: '藏'
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('已归类存入 bilimi·生活日常')
      })
    )
    await waitFor(() =>
      expect(desktopApi.setAssistantPetHint).toHaveBeenCalledWith({
        tone: 'error',
        message:
          '主人，DeepSeek重新判断建议改存到「bilimi·游戏专区」，但调整没有成功，目前仍在「bilimi·生活日常」。'
      })
    )
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        preferenceCounts: expect.objectContaining({
          'life-interest': 1
        }),
        favoriteCorrectionRecords: []
      })
    )
    expect(
      await requestRuntime({ id: 'snapshot-daily-deepseek-adjust-failed', type: 'snapshot' })
    ).toEqual(
      expect.objectContaining({
        runtimeFeedback:
          'DeepSeek 二判完成：建议从「bilimi·生活日常」改归「bilimi·游戏专区」，但后台调整失败。'
      })
    )
  })

  it('reports delayed DeepSeek adjustment script errors without confirmed learning', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                kind: 'favorite-daily-classify-review',
                targetLedgerIds: ['game'],
                corrected: true,
                reason: 'DeepSeek 延迟判断后认为应移入游戏攻略。',
                confidence: 0.8,
                keywordSuggestions: []
              }),
            5
          )
        })
    )
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off',
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) => {
        if (ledger.id === 'game') {
          return { ...ledger, keywords: ['地铁攻略'], bilibiliFolderId: '9002' }
        }
        if (ledger.id === 'life-interest') {
          return { ...ledger, keywords: ['大阪生活'], bilibiliFolderId: '9005' }
        }
        return ledger
      })
    })
    const { desktopApi, notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      savePreferences
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 704,
            title: '大阪地铁换乘攻略',
            author: '旅行研究所',
            pageText: '大阪地铁换乘攻略',
            tags: ['地铁攻略'],
            category: ''
          }
        }

        if (script.includes('/x/v3/fav/resource/deal')) {
          if (script.includes('api:favorite:adjust')) {
            throw new Error('webview gone')
          }

          return {
            ok: true,
            steps: ['api:favorite:list', 'api:favorite:add'],
            missingTargets: [],
            message: '已用 B 站接口归入 bilimi 收藏夹。'
          }
        }

        return {
          ok: true,
          steps: ['favorite:open', 'favorite:folder', 'favorite'],
          missingTargets: [],
          message: '已按内容归入内库。'
        }
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1dailydeepseekreject'
          }
        })
      )
    })

    await primeProvisionedFavoriteStatus(requestRuntime, preferences.favoriteLedgers)

    const result = await requestRuntime({
      id: 'run-daily-deepseek-reject',
      type: 'run-action',
      action: '藏'
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('已归类存入 bilimi·生活日常')
      })
    )
    await waitFor(() =>
      expect(desktopApi.setAssistantPetHint).toHaveBeenCalledWith({
        tone: 'error',
        message:
          '主人，DeepSeek重新判断建议改存到「bilimi·游戏专区」，但调整没有成功，目前仍在「bilimi·生活日常」。'
      })
    )
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        favoriteCorrectionRecords: []
      })
    )
  })

  it('returns the local favorite result without waiting for a hanging delayed DeepSeek review', async () => {
    let resolveDeepSeek!: (result: DeepSeekGenerateResult) => void
    const generateDeepSeek = vi.fn<
      (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
    >(() => new Promise((resolve) => {
      resolveDeepSeek = resolve
    }))
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      favoriteArchiveMultiMode: 'off',
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) =>
        ledger.id === 'life-interest'
          ? { ...ledger, keywords: ['大阪生活'], bilibiliFolderId: '9005' }
          : ledger
      )
    })
    const { notifyPreferencesChanged, requestRuntimeDirect } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences)
    })
    notifyPreferencesChanged(preferences)
    await screen.findByRole('tab', { name: '批阅' })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 705,
            title: '大阪生活记录',
            pageText: '大阪生活记录',
            tags: ['大阪生活']
          }
        }

        if (script.includes('/x/v3/fav/resource/deal')) {
          return {
            ok: true,
            steps: ['api:favorite:list', 'api:favorite:add'],
            missingTargets: [],
            message: '已用 B 站接口归入 bilimi 收藏夹。'
          }
        }

        return {
          ok: true,
          steps: ['favorite:open', 'favorite:folder', 'favorite'],
          missingTargets: [],
          message: '已按内容归入内库。'
        }
      })
    })

    await primeProvisionedFavoriteStatus(requestRuntimeDirect, preferences.favoriteLedgers)

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1dailydeepseekhang'
          }
        })
      )
    })

    let actionPromise!: Promise<AssistantRuntimeResponsePayload>
    const result = await act(async () => {
      actionPromise = requestRuntimeDirect({
        id: 'run-daily-deepseek-hang',
        type: 'run-action',
        action: '藏'
      })
      return Promise.race([
        actionPromise,
        new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50))
      ])
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining('已归类存入 bilimi·生活日常')
      })
    )
    await act(async () => {
      resolveDeepSeek({
        kind: 'favorite-daily-classify-review',
        targetLedgerIds: ['life-interest'],
        corrected: false,
        reason: '测试结束前收敛后台二判。',
        confidence: 0.9,
        keywordSuggestions: []
      })
      await actionPromise
    })
  })

  it('does not run DeepSeek daily classification for non-favorite actions', async () => {
    const generateDeepSeek = vi.fn()
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences)
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 704,
            title: '大阪地铁换乘攻略',
            pageText: '大阪地铁换乘攻略',
            tags: ['地铁攻略']
          }
        }

        return {
          ok: true,
          steps: ['comment:open', 'comment:submit'],
          missingTargets: [],
          message: '评论已发送。'
        }
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1dailydeepseekcomment'
          }
        })
      )
    })

    await requestRuntime({
      id: 'run-daily-deepseek-comment',
      type: 'run-action',
      action: '表',
      options: {
        submitComment: true,
        commentDraft: '很好看'
      }
    })

    expect(generateDeepSeek).not.toHaveBeenCalled()
  })

  it('skips DeepSeek daily review in low-confidence-only mode for confident local matches', async () => {
    const generateDeepSeek = vi.fn()
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekDailyClassificationEnabled: true,
      deepseekDailyClassificationMode: 'low-confidence-only',
      favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) =>
        ledger.id === 'knowledge'
          ? { ...ledger, keywords: ['机器学习', '教程', 'AI', '科普'], bilibiliFolderId: '9001' }
          : ledger
      )
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences)
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 801,
            title: '机器学习 AI 科普教程',
            pageText: '机器学习 AI 科普教程',
            tags: ['机器学习', 'AI', '教程'],
            category: '科技'
          }
        }

        return {
          ok: true,
          steps: ['favorite:open', 'favorite:folder', 'favorite'],
          missingTargets: [],
          message: '已按内容归入内库。'
        }
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1confident' }
        })
      )
    })

    await requestRuntime({ id: 'run-low-confidence-skip', type: 'run-action', action: '藏' })

    expect(generateDeepSeek).not.toHaveBeenCalled()
  })

  it('adds successful new favorite inbox fallback to the pending queue', async () => {
    const upsertPendingFavoriteQueueItems = vi.fn().mockResolvedValue([])
    const { requestRuntime } = renderAppWithRuntimeBridge({ upsertPendingFavoriteQueueItems })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 3001,
            title: '没有分类线索的新收藏',
            pageText: '随手收藏，稍后再看',
            tags: []
          }
        }

        if (script.includes('/x/v3/fav/resource/deal')) {
          return {
            ok: true,
            steps: ['api:favorite:list', 'api:favorite:add'],
            missingTargets: [],
            message: '已用 B 站接口归入 bilimi 收藏夹。'
          }
        }

        return {
          ok: true,
          steps: ['favorite:open', 'favorite:folder', 'favorite'],
          missingTargets: [],
          message: '已按内容归入内库。'
        }
      })
    })

    await primeProvisionedFavoriteStatus(requestRuntime)

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1pending'
          }
        })
      )
    })

    await requestRuntime({ id: 'run-inbox-pending', type: 'run-action', action: '藏' })

    expect(upsertPendingFavoriteQueueItems).toHaveBeenCalledWith([
      expect.objectContaining({
        aid: 3001,
        title: '没有分类线索的新收藏',
        source: 'new-favorite',
        originalTargetLedgerId: 'inbox',
        status: 'pending'
      })
    ])
  })

  it('does not add a queue item when inbox favorite fallback fails', async () => {
    const upsertPendingFavoriteQueueItems = vi.fn().mockResolvedValue([])
    const { requestRuntime } = renderAppWithRuntimeBridge({ upsertPendingFavoriteQueueItems })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
          return {
            aid: 3002,
            title: '暂存失败的新收藏',
            pageText: '随手收藏，稍后再看',
            tags: []
          }
        }

        return {
          ok: false,
          steps: ['api:favorite:list'],
          missingTargets: ['favorite-inbox'],
          message: '暂存收藏失败。'
        }
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1pendingfail'
          }
        })
      )
    })

    await requestRuntime({ id: 'run-inbox-failed', type: 'run-action', action: '藏' })

    expect(upsertPendingFavoriteQueueItems).not.toHaveBeenCalled()
  })

  it('keeps successful 赐 page-click-only actions on the page automation path', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      sendInputEvent?: (event: Record<string, unknown>) => void
    }
    const sentEvents: Record<string, unknown>[] = []
    const visualFrames = [
      [{ text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 }],
      [{ text: '+ 新建收藏夹', x: 120, y: 420, width: 140, height: 32 }],
      [{ text: '收藏夹名称', x: 120, y: 260, width: 180, height: 36 }],
      [{ text: '创建', x: 240, y: 340, width: 80, height: 32 }],
      [
        { text: 'bilimi·见闻增广', x: 120, y: 470, width: 180, height: 32 },
        { text: '确定', x: 250, y: 620, width: 120, height: 40 }
      ]
    ]
    let visualFrameIndex = 0
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: '三分钟讲清机器学习科普教程',
          pageText: '从原理到入门路线，适合学习收藏。'
        }
      }

      if (script.includes('/x/v3/fav/resource/deal')) {
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          message: '已用 B 站接口归入 bilimi 收藏夹。'
        }
      }

      if (script.includes('modalClassName') && script.includes('containers')) {
        return { containers: [], moved: false }
      }

      if (script.includes('__bilimiFavoriteFocusPoint')) {
        return true
      }

      if (script.includes('__bilimiVisualTextBoxes')) {
        const boxes = visualFrames[Math.min(visualFrameIndex, visualFrames.length - 1)]
        visualFrameIndex += 1
        return { boxes }
      }

      return {
        ok: true,
        steps: ['like', 'favorite:open', 'favorite:folder', 'favorite', 'coin:open', 'coin:2', 'coin:confirm'],
        missingTargets: [],
        message: '厚赐已成。'
      }
    })
    Object.assign(webview, {
      executeJavaScript,
      sendInputEvent: vi.fn((event: Record<string, unknown>) => {
        sentEvents.push(event)
      })
    })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1gift'
          }
        })
      )
    })

    const result = await requestRuntime({
      id: 'run-gift',
      type: 'run-action',
      action: '赐',
      options: { pageClickOnly: true, coinCount: 2 }
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        steps: expect.arrayContaining(['favorite', 'coin:confirm'])
      })
    )
    expect(executeJavaScript.mock.calls.some(([script]) => script.includes('"coinCount":2'))).toBe(true)
    expect(
      executeJavaScript.mock.calls.some(([script]) =>
        script.includes('/x/v3/fav/resource/deal') && script.includes('bilimi·见闻增广')
      )
    ).toBe(false)
    expect(sentEvents).not.toContainEqual(expect.objectContaining({ keyCode: 'e', type: 'keyDown' }))
  })

  it('generates default notes from audio for the floating assistant runtime', async () => {
    const saveVideoNote = vi.fn().mockResolvedValue([])
    const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge({ saveVideoNote })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn().mockResolvedValue({
        title: '机器学习入门教程',
        bvid: 'BV1note',
        url: 'https://www.bilibili.com/video/BV1note',
        tags: ['教程'],
        transcript: [{ start: 0, end: 8, text: '机器学习需要数据和模型。' }]
      })
    })

    desktopApi.transcribeCurrentVideoAudio = vi.fn().mockResolvedValue({
      transcriptSource: 'audio',
      transcript: [{ start: 0, end: 2, text: 'audio generated transcript' }]
    })

    const note = await requestRuntime({ id: 'note-1', type: 'generate-video-note' })

    expect(desktopApi.transcribeCurrentVideoAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.bilibili.com/video/BV1note',
        bvid: 'BV1note'
      })
    )
    expect(note).toEqual(
      expect.objectContaining({
        id: 'bvid:BV1note',
        transcriptSource: 'audio',
        transcript: [{ start: 0, end: 2, text: 'audio generated transcript' }]
      })
    )

    await requestRuntime({
      id: 'save-note-1',
      type: 'save-video-note',
      note: note as Awaited<ReturnType<typeof requestRuntime>> & never
    })

    expect(saveVideoNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'bvid:BV1note' }))
  })

  it('generates a video note from audio through the assistant runtime', async () => {
    const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn().mockResolvedValue({
        title: 'Audio demo',
        bvid: 'BV1demo',
        url: 'https://www.bilibili.com/video/BV1demo',
        tags: [],
        transcript: []
      })
    })
    desktopApi.transcribeCurrentVideoAudio = vi.fn().mockResolvedValue({
      transcriptSource: 'audio',
      transcript: [{ start: 0, end: 2, text: 'audio transcript text' }]
    })

    const note = await requestRuntime({ id: 'audio-note-1', type: 'generate-video-note-from-audio' })

    expect(desktopApi.transcribeCurrentVideoAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.bilibili.com/video/BV1demo',
        title: 'Audio demo',
        bvid: 'BV1demo'
      })
    )
    expect(note).toEqual(
      expect.objectContaining({
        transcriptSource: 'audio',
        transcript: [{ start: 0, end: 2, text: 'audio transcript text' }]
      })
    )
  })

  it('passes automatic DeepSeek summary preference into queued audio transcription', async () => {
    const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn().mockResolvedValue({
        title: 'Queued audio demo',
        bvid: 'BV1queue',
        url: 'https://www.bilibili.com/video/BV1queue',
        tags: [],
        transcript: []
      })
    })
    desktopApi.enqueueVideoAudioTranscription = vi.fn().mockResolvedValue({ items: [] })
    desktopApi.readBilibiliAccountMid = vi.fn().mockResolvedValue('100')

    await requestRuntime({
      id: 'queue-audio-1',
      type: 'enqueue-current-video-audio',
      summarizeWithDeepSeek: true
    })

    expect(desktopApi.enqueueVideoAudioTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.bilibili.com/video/BV1queue',
        title: 'Queued audio demo',
        bvid: 'BV1queue',
        accountMid: '100',
        summarizeWithDeepSeek: true
      })
    )
  })

  it('reuses one current-video extraction for note creation and queued transcription', async () => {
    const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    const executeJavaScript = vi.fn().mockResolvedValue({
      title: '共享识别视频',
      author: '共享 UP',
      bvid: 'BV1shared',
      url: 'https://www.bilibili.com/video/BV1shared',
      tags: ['共享'],
      transcript: []
    })
    Object.assign(webview, { executeJavaScript })
    desktopApi.transcribeCurrentVideoAudio = vi.fn().mockResolvedValue({ transcriptSource: 'audio', transcript: [] })
    desktopApi.enqueueVideoAudioTranscription = vi.fn().mockResolvedValue({ items: [] })
    desktopApi.readBilibiliAccountMid = vi.fn().mockResolvedValue('100')

    await requestRuntime({ id: 'shared-note', type: 'generate-video-note-from-audio' })
    await requestRuntime({ id: 'shared-queue', type: 'enqueue-current-video-audio' })

    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(desktopApi.enqueueVideoAudioTranscription).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://www.bilibili.com/video/BV1shared', author: '共享 UP', bvid: 'BV1shared'
    }))
  })

  it('does not enqueue audio transcription before the Bilibili account is available', async () => {
    const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('document.cookie')) {
          return ''
        }

        return {
          title: 'Queued audio demo',
          bvid: 'BV1queue',
          url: 'https://www.bilibili.com/video/BV1queue',
          tags: [],
          transcript: []
        }
      })
    })
    desktopApi.enqueueVideoAudioTranscription = vi.fn().mockResolvedValue({ items: [] })

    const result = await requestRuntime({
      id: 'queue-audio-logged-out',
      type: 'enqueue-current-video-audio',
      summarizeWithDeepSeek: true
    })

    expect(result).toBeNull()
    expect(desktopApi.setAssistantPetHint).not.toHaveBeenCalled()
    expect(desktopApi.enqueueVideoAudioTranscription).not.toHaveBeenCalled()
  })

  it('generates a video note from audio without requiring Bilibili login', async () => {
    const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('document.cookie')) {
          return ''
        }

        return {
          title: 'Logged out audio demo',
          bvid: 'BV1public',
          url: 'https://www.bilibili.com/video/BV1public',
          tags: [],
          transcript: []
        }
      })
    })
    desktopApi.transcribeCurrentVideoAudio = vi.fn().mockResolvedValue({
      transcriptSource: 'audio',
      transcript: [{ start: 0, end: 2, text: 'public audio transcript' }]
    })

    const note = await requestRuntime({
      id: 'audio-note-logged-out',
      type: 'generate-video-note-from-audio'
    })

    expect(desktopApi.setAssistantPetHint).not.toHaveBeenCalled()
    expect(desktopApi.transcribeCurrentVideoAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.bilibili.com/video/BV1public',
        title: 'Logged out audio demo',
        bvid: 'BV1public'
      })
    )
    expect(note).toEqual(
      expect.objectContaining({
        id: 'bvid:BV1public',
        transcriptSource: 'audio',
        transcript: [{ start: 0, end: 2, text: 'public audio transcript' }]
      })
    )
  })

  it('keeps pasted transcript generation local without audio transcription', async () => {
    const { desktopApi, requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn().mockResolvedValue({
        title: 'Manual demo',
        bvid: 'BVmanual',
        url: 'https://www.bilibili.com/video/BVmanual',
        tags: []
      })
    })
    desktopApi.transcribeCurrentVideoAudio = vi.fn()

    const note = await requestRuntime({
      id: 'manual-note-1',
      type: 'generate-video-note',
      manualTranscript: '00:01 pasted transcript text'
    })

    expect(desktopApi.transcribeCurrentVideoAudio).not.toHaveBeenCalled()
    expect(note).toEqual(
      expect.objectContaining({
        id: 'bvid:BVmanual',
        transcriptSource: 'manual',
        transcript: [{ start: 1, end: null, text: 'pasted transcript text' }]
      })
    )
  })

  it('opens an archived timeline source in a selected tab, selects its CID before seeking, and starts playback', async () => {
    let openArchiveSource:
      | ((request: { url: string; seconds?: number; aid?: number; cid?: number }) => void)
      | undefined
    renderAppWithRuntimeBridge({
      onOpenVideoNoteArchiveSource: vi.fn((callback) => {
        openArchiveSource = callback
        return vi.fn()
      })
    })

    act(() => {
      openArchiveSource?.({
        url: 'https://www.bilibili.com/video/BV1archive',
        seconds: 95,
        aid: 123,
        cid: 456
      })
    })

    expect(screen.getByRole('tab', { name: /BV1archive/ })).toHaveAttribute('aria-selected', 'true')
    const archiveWebview = document.querySelector('webview[data-tab-id]:not([data-tab-id="home"])') as Electron.WebviewTag
    const executeJavaScript = vi.fn((script: string) => Promise.resolve(
      script.includes('__bilimiSelectArchivedVideoPart') ? { status: 'ready' } : true
    ))
    Object.assign(archiveWebview, { executeJavaScript })

    act(() => archiveWebview.dispatchEvent(new Event('did-finish-load')))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('__bilimiSelectArchivedVideoPart'),
      true
    ))
    const scripts = executeJavaScript.mock.calls.map(([script]) => String(script))
    const partSelectionIndex = scripts.findIndex((script) => script.includes('__bilimiSelectArchivedVideoPart'))
    const timestampSeekIndex = scripts.findIndex((script) => script.includes('currentTime = 95'))

    expect(timestampSeekIndex).toBeGreaterThan(partSelectionIndex)
    expect(scripts[timestampSeekIndex]).toContain('const playResult = video.play?.()')
    expect(scripts[timestampSeekIndex]).not.toContain('const wasPaused = video.paused')
  })

  it('reuses one loaded internal video tab and seeks each archived timeline timestamp', async () => {
    let openArchiveSource:
      | ((request: { url: string; seconds?: number; aid?: number; cid?: number }) => void)
      | undefined
    renderAppWithRuntimeBridge({
      onOpenVideoNoteArchiveSource: vi.fn((callback) => {
        openArchiveSource = callback
        return vi.fn()
      })
    })

    act(() => {
      openArchiveSource?.({ url: 'https://www.bilibili.com/video/BV1reuse?p=1', seconds: 12, aid: 7, cid: 71 })
    })

    const archiveWebview = document.querySelector('webview[data-tab-id]:not([data-tab-id="home"])') as Electron.WebviewTag
    const executeJavaScript = vi.fn((script: string) => Promise.resolve(
      script.includes('__bilimiSelectArchivedVideoPart') ? { status: 'ready' } : true
    ))
    Object.assign(archiveWebview, { executeJavaScript })
    act(() => archiveWebview.dispatchEvent(new Event('did-finish-load')))
    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('currentTime = 12'), true))

    act(() => {
      openArchiveSource?.({ url: 'https://www.bilibili.com/video/BV1reuse?p=2', seconds: 48, aid: 7, cid: 72 })
    })

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('currentTime = 48'), true))
    expect(document.querySelectorAll('webview[data-tab-id]:not([data-tab-id="home"])')).toHaveLength(1)
    expect(screen.getAllByRole('tab', { name: /BV1reuse/ })).toHaveLength(1)
  })

  it('opens webview popup URLs as internal browser tabs', async () => {
    renderAppWithRuntimeBridge()

    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

    act(() => {
      homeWebview.dispatchEvent(
        new CustomEvent('new-window', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1demo'
          }
        })
      )
    })

    expect(await screen.findByRole('tablist', { name: '网页标签' })).toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: /BV1demo/ })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelectorAll('webview')).toHaveLength(2)
    expect(document.querySelector('webview[data-active="true"]')).toHaveAttribute(
      'src',
      'https://www.bilibili.com/video/BV1demo'
    )
  })

  it('reloads every existing Bilibili webview after the session connection mode changes', async () => {
    let reloadRequested: (() => void) | undefined
    renderAppWithRuntimeBridge({
      onBilibiliSessionReloadRequested: vi.fn((callback: () => void) => {
        reloadRequested = callback
        return vi.fn()
      })
    })
    await act(async () => {
      await Promise.resolve()
    })
    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement & { reload?: () => void }
    act(() => {
      homeWebview.dispatchEvent(new CustomEvent('new-window', {
        detail: { url: 'https://www.bilibili.com/video/BV1proxy' }
      }))
    })
    const webviews = [...document.querySelectorAll('webview')] as Array<HTMLElement & { reload?: () => void }>
    const reloads = webviews.map(() => vi.fn())
    webviews.forEach((webview, index) => Object.assign(webview, { reload: reloads[index] }))

    act(() => reloadRequested?.())

    expect(reloads).toHaveLength(2)
    for (const reload of reloads) expect(reload).toHaveBeenCalledOnce()
  })

  it('opens the same video URL in independent tabs and closes only the selected instance', async () => {
    renderAppWithRuntimeBridge()

    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement
    const openSameVideo = () => {
      homeWebview.dispatchEvent(
        new CustomEvent('new-window', {
          detail: { url: 'https://www.bilibili.com/video/BV1duplicate' }
        })
      )
    }

    act(openSameVideo)
    act(openSameVideo)

    expect(await screen.findAllByRole('tab', { name: /BV1duplicate/ })).toHaveLength(2)
    expect(document.querySelectorAll('webview')).toHaveLength(3)

    const closeButtons = screen.getAllByRole('button', { name: /关闭 BV1duplicate/ })
    fireEvent.click(closeButtons[1])

    expect(screen.getAllByRole('tab', { name: /BV1duplicate/ })).toHaveLength(1)
    expect(document.querySelectorAll('webview')).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /BV1duplicate/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps tabs independent after different URLs navigate to the same video', async () => {
    renderAppWithRuntimeBridge()
    await screen.findByRole('tab', { name: '批阅' })
    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

    act(() => {
      homeWebview.dispatchEvent(new CustomEvent('new-window', {
        detail: { url: 'https://www.bilibili.com/video/BV1first?from=one' }
      }))
      homeWebview.dispatchEvent(new CustomEvent('new-window', {
        detail: { url: 'https://www.bilibili.com/video/BV1second?from=two' }
      }))
    })
    const videoWebviews = Array.from(document.querySelectorAll('webview')).slice(1) as HTMLElement[]
    act(() => {
      for (const webview of videoWebviews) {
        webview.dispatchEvent(new CustomEvent('did-navigate-in-page', {
          detail: { url: 'https://www.bilibili.com/video/BV1samefinal' }
        }))
      }
    })

    expect(screen.getAllByRole('tab', { name: /BV1/ })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: /关闭 BV1/ })[0])
    expect(screen.getAllByRole('tab', { name: /BV1/ })).toHaveLength(1)
    expect(document.querySelectorAll('webview')).toHaveLength(2)
  })

  it('notifies the floating assistant when the active webview navigates to another video', async () => {
    const { desktopApi } = renderAppWithRuntimeBridge()

    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

    act(() => {
      homeWebview.dispatchEvent(
        new CustomEvent('did-navigate-in-page', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1fresh'
          }
        })
      )
    })

    await waitFor(() => expect(desktopApi.notifyAssistantSnapshotChanged).toHaveBeenCalled())
  })

  it('lets 小咪 react once when a fresh video opens', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const { desktopApi } = renderAppWithRuntimeBridge()

    try {
      const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

      act(() => {
        homeWebview.dispatchEvent(
          new CustomEvent('did-navigate-in-page', {
            detail: {
              url: 'https://www.bilibili.com/video/BV1fresh'
            }
          })
        )
      })

      await waitFor(() =>
        expect(desktopApi.setAssistantPetHint).toHaveBeenCalledWith({
          tone: 'hint',
          message: '小咪好期待呀，这个视频会不会很有意思～'
        })
      )

      act(() => {
        homeWebview.dispatchEvent(
          new CustomEvent('did-navigate-in-page', {
            detail: {
              url: 'https://www.bilibili.com/video/BV1fresh'
            }
          })
        )
      })

      expect(desktopApi.setAssistantPetHint).toHaveBeenCalledTimes(1)
    } finally {
      random.mockRestore()
    }
  })

  it('does not wake a default-disabled 小咪 when video fullscreen ends', async () => {
    vi.useFakeTimers()
    const preferences = createAppPreferences({
      autoShowPetOnStartup: false,
      hidePetDuringVideoFullscreen: true
    })
    const wakeAssistantPet = vi.fn().mockResolvedValue(undefined)
    renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      wakeAssistantPet
    })

    try {
      await act(async () => undefined)
      const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

      act(() => {
        homeWebview.dispatchEvent(new Event('enter-html-full-screen'))
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS)
        homeWebview.dispatchEvent(new Event('leave-html-full-screen'))
        await Promise.resolve()
      })

      expect(wakeAssistantPet).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not request fullscreen restoration when no visible 小咪 was temporarily hidden', async () => {
    vi.useFakeTimers()
    const closeAssistantPet = vi.fn().mockResolvedValue(false)
    const wakeAssistantPet = vi.fn().mockResolvedValue(undefined)
    renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({
        autoShowPetOnStartup: false,
        hidePetDuringVideoFullscreen: true
      })),
      closeAssistantPet,
      wakeAssistantPet
    })

    try {
      await act(async () => undefined)
      const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

      act(() => homeWebview.dispatchEvent(new Event('enter-html-full-screen')))
      await act(async () => vi.advanceTimersByTimeAsync(VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS))
      act(() => homeWebview.dispatchEvent(new Event('leave-html-full-screen')))

      expect(closeAssistantPet).toHaveBeenCalledWith({ temporarilyForVideoFullscreen: true })
      expect(wakeAssistantPet).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores only a 小咪 whose fullscreen close confirmed that it was visible', async () => {
    vi.useFakeTimers()
    const closeAssistantPet = vi.fn().mockResolvedValue(true)
    const wakeAssistantPet = vi.fn().mockResolvedValue(undefined)
    renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(createAppPreferences({ hidePetDuringVideoFullscreen: true })),
      closeAssistantPet,
      wakeAssistantPet
    })

    try {
      await act(async () => undefined)
      const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

      act(() => homeWebview.dispatchEvent(new Event('enter-html-full-screen')))
      await act(async () => vi.advanceTimersByTimeAsync(VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS))
      await act(async () => undefined)
      act(() => homeWebview.dispatchEvent(new Event('leave-html-full-screen')))
      await act(async () => undefined)

      expect(wakeAssistantPet).toHaveBeenCalledWith({ restoreAfterVideoFullscreen: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores a fullscreen-hidden 小咪 when fullscreen exits before the hide request settles', async () => {
    vi.useFakeTimers()
    const preferences = createAppPreferences({ hidePetDuringVideoFullscreen: true })
    let settleCloseRequest: ((hidden: boolean) => void) | undefined
    const closeAssistantPet = vi.fn(
      () => new Promise<boolean>((resolve) => {
        settleCloseRequest = resolve
      })
    )
    const wakeAssistantPet = vi.fn().mockResolvedValue(true)
    renderAppWithRuntimeBridge({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      closeAssistantPet,
      wakeAssistantPet
    })

    try {
      await act(async () => undefined)
      const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

      act(() => {
        homeWebview.dispatchEvent(new Event('enter-html-full-screen'))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS)
      })

      expect(closeAssistantPet).toHaveBeenCalledWith({ temporarilyForVideoFullscreen: true })

      act(() => {
        homeWebview.dispatchEvent(new Event('leave-html-full-screen'))
      })
      expect(wakeAssistantPet).not.toHaveBeenCalled()

      await act(async () => {
        settleCloseRequest?.(true)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(wakeAssistantPet).toHaveBeenCalledWith({ restoreAfterVideoFullscreen: true })
      expect(wakeAssistantPet).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides and restores an already visible 小咪 around active video fullscreen when enabled', async () => {
    vi.useFakeTimers()
    const preferences = createAppPreferences({ hidePetDuringVideoFullscreen: true })
    const closeAssistantPet = vi.fn().mockResolvedValue(true)
    const wakeAssistantPet = vi.fn().mockResolvedValue(true)
    const { desktopApi } = renderAppWithRuntimeBridge({
      closeAssistantPet,
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      wakeAssistantPet
    })

    try {
      await act(async () => undefined)
      const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

      act(() => {
        homeWebview.dispatchEvent(new Event('enter-html-full-screen'))
      })

      expect(desktopApi.setAssistantPetHint).toHaveBeenCalledWith({
        tone: 'sleepy',
        message: '主人先安心全屏看，小咪不挡画面，待会儿回来找你～'
      })
      expect(closeAssistantPet).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS)
      })

      expect(closeAssistantPet).toHaveBeenCalledWith({ temporarilyForVideoFullscreen: true })

      await act(async () => {
        homeWebview.dispatchEvent(new Event('leave-html-full-screen'))
        await Promise.resolve()
      })

      expect(wakeAssistantPet).toHaveBeenCalledWith({ restoreAfterVideoFullscreen: true })
      expect(desktopApi.setAssistantPetHint).toHaveBeenCalledWith({
        tone: 'hint',
        message: '全屏看完感觉怎么样？要不要和小咪互动一下？'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps 小咪 resident around video fullscreen when the setting is disabled', async () => {
    vi.useFakeTimers()
    const closeAssistantPet = vi.fn()
    const wakeAssistantPet = vi.fn().mockResolvedValue(undefined)
    renderAppWithRuntimeBridge({ closeAssistantPet, wakeAssistantPet })

    try {
      const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

      await act(async () => {
        homeWebview.dispatchEvent(new Event('enter-html-full-screen'))
        await vi.advanceTimersByTimeAsync(VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS)
        homeWebview.dispatchEvent(new Event('leave-html-full-screen'))
      })

      expect(closeAssistantPet).not.toHaveBeenCalled()
      expect(wakeAssistantPet).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses externally changed assistant preferences in runtime snapshots', async () => {
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge()

    notifyPreferencesChanged(createAppPreferences({ favoritesFolderName: 'Bilimi', petStyle: 'classic' }))

    const snapshot = await requestRuntime({ id: 'snapshot-preferences-1', type: 'snapshot' })

    expect(snapshot).toEqual(
      expect.objectContaining({
        preferences: expect.objectContaining({
          petStyle: 'classic'
        })
      })
    )
  })
})

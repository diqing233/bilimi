import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type {
  AssistantAutomationResult,
  AssistantPreferences,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult
} from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import App, { VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS } from './App'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload
} from './features/assistant/assistantRuntimeTypes'
import type { FavoriteLedgerPreview } from './features/favorites/favoriteLedgerPreview'

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
    ledgers: createDefaultFavoriteLedgers(),
    missingLedgerIds: [],
    message: '册目查验已毕。'
  }
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
    setAssistantPetHint: vi.fn(),
    savePreferences: vi.fn(async (preferences: AssistantPreferences) => preferences),
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
        items: [{ aid: 1, title: 'Video', upperName: 'UP', cover: '', addedAt: 0, tags: [], category: '' }], hasMore: false
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

  it('returns the active tab snapshot without reading the webview', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(() => new Promise<never>(() => undefined))
    Object.assign(webview, { executeJavaScript })

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
          title: '缓存中的活动视频'
        })
      })
    )
    expect(executeJavaScript).not.toHaveBeenCalled()
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
    const { requestRuntime } = renderAppWithRuntimeBridge({
      savePreferences
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
  })

  it('persists existing Bilibili folder ids returned by backup before the next assistant snapshot', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({
      savePreferences,
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

  it('does not create remote folders when the active account disabled the default favorite system', async () => {
    const { requestRuntime, notifyPreferencesChanged } = renderAppWithRuntimeBridge({
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100')
    })
    const accountLedgers = createDefaultFavoriteLedgers()
    notifyPreferencesChanged(createAppPreferences({
      favoriteAccountPreferences: {
        '100': { defaultFavoriteSystemEnabled: false, favoriteLedgers: accountLedgers }
      }
    }))
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('document.cookie')) return { hasUserId: true, hasCsrf: true }
      throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
    })
    Object.assign(webview, { executeJavaScript })

    await expect(requestRuntime({ id: 'backup-disabled', type: 'ensure-ledgers' })).resolves.toMatchObject({ ok: false })
    expect(executeJavaScript.mock.calls.some(([script]) => script.includes('/x/v3/fav/folder/add'))).toBe(false)
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

  it('collects to inbox when an unsynced default ledger is only a stronger suggestion', async () => {
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
        expect.stringContaining('"targetLedgerId":"inbox"')
      )
    )
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        preferenceCounts: expect.objectContaining({
          inbox: 1
        })
      })
    )
    expect(savePreferences).not.toHaveBeenCalledWith(
      expect.objectContaining({
        preferenceCounts: expect.objectContaining({
          travel: 1
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
      savePreferences
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
      savePreferences
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
        return {
          ok: true,
          steps: script.includes('api:favorite:adjust')
            ? ['api:favorite:adjust-list', 'api:favorite:adjust']
            : ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          message: script.includes('api:favorite:adjust')
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

  it('does not apply a delayed DeepSeek adjustment after the active tab changes', async () => {
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
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek,
      loadPreferences: vi.fn().mockResolvedValue(preferences)
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

      if (script.includes('/x/v3/fav/resource/deal')) {
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          message: '已用 B 站接口归入 bilimi 收藏夹。'
        }
      }

      return { ok: true, steps: ['favorite'], missingTargets: [], message: '已完成收藏。' }
    })
    Object.assign(webview, { executeJavaScript })
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
        new CustomEvent('new-window', {
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
            'DeepSeek 二判完成：建议从「bilimi·生活日常」改归「bilimi·游戏专区」，但页面已切换，本次未调整。'
        })
      )
    )
    expect(
      executeJavaScript.mock.calls
        .map(([script]) => String(script))
        .filter((script) => script.includes('api:favorite:adjust'))
    ).toHaveLength(0)
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
        summarizeWithDeepSeek: true
      })
    )
  })

  it('enqueues audio transcription without requiring Bilibili login', async () => {
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

    expect(result).toEqual({ items: [] })
    expect(desktopApi.setAssistantPetHint).not.toHaveBeenCalled()
    expect(desktopApi.enqueueVideoAudioTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://www.bilibili.com/video/BV1queue',
        title: 'Queued audio demo',
        bvid: 'BV1queue',
        summarizeWithDeepSeek: true
      })
    )
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

  it('hides and restores 小咪 around active video fullscreen when enabled', async () => {
    vi.useFakeTimers()
    const preferences = createAppPreferences({ hidePetDuringVideoFullscreen: true })
    const closeAssistantPet = vi.fn()
    const wakeAssistantPet = vi.fn().mockResolvedValue(undefined)
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

      expect(closeAssistantPet).toHaveBeenCalledOnce()

      await act(async () => {
        homeWebview.dispatchEvent(new Event('leave-html-full-screen'))
        await Promise.resolve()
      })

      expect(wakeAssistantPet).toHaveBeenCalledOnce()
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

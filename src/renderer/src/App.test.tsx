import { act, render, screen, waitFor } from '@testing-library/react'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type { AssistantPreferences } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import App, { VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS } from './App'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload
} from './features/assistant/assistantRuntimeTypes'

const LEDGER_STATUS_SCRIPT_MARKER = '/x/v3/fav/folder/created/list-all'
const LEDGER_SAVE_SCRIPT_MARKER = '/x/v3/fav/folder/add'
const OLD_FAVORITE_SCAN_SCRIPT_MARKER = '/x/v3/fav/resource/list'
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
    favoritesFolderName: 'Bilimi 内库',
    favoriteLedgers: createDefaultFavoriteLedgers(),
    ledgerPromptDismissed: true,
    preferenceCounts: {},
    petStyle: 'big-head',
    petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
    hidePetDuringVideoFullscreen: false,
    bilibiliOperationMode: 'api-assisted',
    favoriteArchiveMultiMode: 'off',
    deepseekEnabled: false,
    deepseekApiKeyStored: false,
    deepseekOldFavoriteAssistanceEnabled: false,
    deepseekAutoSummaryEnabled: false,
    deepseekModel: 'deepseek-v4-flash',
    deepseekBaseUrl: 'https://api.deepseek.com',
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
  it('renders the browser shell with the in-window assistant sidebar', async () => {
    renderAppWithRuntimeBridge()

    expect(document.querySelector('.seal-button')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toBeInTheDocument()
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

  it('returns a floating assistant snapshot from the active webview', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        return emptyLedgerStatus()
      }

      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: '三分钟讲清机器学习科普教程',
          pageText: '从原理到入门路线，适合学习收藏。'
        }
      }

      return null
    })
    Object.assign(webview, { executeJavaScript })

    const snapshot = await requestRuntime({ id: 'snapshot-1', type: 'snapshot' })

    expect(snapshot).toEqual(
      expect.objectContaining({
        videoTitle: '三分钟讲清机器学习科普教程',
        videoContentContext: expect.objectContaining({
          title: '三分钟讲清机器学习科普教程'
        }),
        favoriteLedgerStatus: expect.objectContaining({
          ok: true,
          missingLedgerIds: []
        })
      })
    )
    expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER),
      true
    )
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
    desktopApi.notifyAssistantSnapshotChanged.mockImplementation(() => {
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
        { text: 'Bilimi·见闻增广', x: 120, y: 470, width: 180, height: 32 },
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
          message: '已用 B 站接口归入 Bilimi 收藏夹。'
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
        script.includes('/x/v3/fav/resource/deal') && script.includes('Bilimi·见闻增广')
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
        { text: 'Bilimi·见闻增广', x: 120, y: 470, width: 180, height: 32 },
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
          message: '已用 B 站接口归入 Bilimi 收藏夹。'
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
        script.includes('/x/v3/fav/resource/deal') && script.includes('Bilimi·见闻增广')
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

  it('asks the user to log in before enqueuing audio transcription', async () => {
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
    expect(desktopApi.setAssistantPetHint).toHaveBeenCalledWith({
      tone: 'error',
      message: '请先登录 Bilibili 后再操作。'
    })
    expect(desktopApi.enqueueVideoAudioTranscription).not.toHaveBeenCalled()
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

  it('scans old favorites through the runtime bridge', async () => {
    const generateDeepSeek = vi.fn()
    const { requestRuntime } = renderAppWithRuntimeBridge({ generateDeepSeek })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(OLD_FAVORITE_SCAN_SCRIPT_MARKER)) {
        return {
          ok: true,
          sourceFolders: [
            {
              id: '101',
              title: '默认收藏夹',
              videos: [
                {
                  aid: 123,
                  title: '机器学习入门教程',
                  description: '适合学习收藏的科普教程'
                }
              ]
            }
          ],
          targetMembership: {},
          skippedSourceFolderTitles: ['Login Redirect Favorites'],
          steps: ['api:favorite:list'],
          missingTargets: [],
          message: 'old favorites scanned'
        }
      }

      return emptyLedgerStatus()
    })
    Object.assign(webview, { executeJavaScript })

    const preview = await requestRuntime({ id: 'scan-1', type: 'scan-old-favorites' })

    expect(preview).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            title: '机器学习入门教程'
          })
        ],
        insights: expect.objectContaining({
          totalVideos: 1
        }),
        skippedSourceFolderTitles: ['Login Redirect Favorites']
      })
    )
    expect(generateDeepSeek).not.toHaveBeenCalled()
    expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(OLD_FAVORITE_SCAN_SCRIPT_MARKER)
    )
  })

  it('keeps old favorite scans local until DeepSeek enhancement is requested', async () => {
    const preferences = createAppPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekOldFavoriteAssistanceEnabled: true
    })
    const generateDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-ledger-insights',
      suggestions: [
        {
          sourceKind: 'tag-cluster',
          sourceName: 'AI',
          displayName: 'Bilimi·AI效率工坊',
          keywords: ['AI', '效率', '工具'],
          reason: 'AI、效率、工具共现明显，适合合并成一个工作流册目。'
        }
      ]
    })
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge({
      generateDeepSeek
    })
    notifyPreferencesChanged(preferences)
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes(OLD_FAVORITE_SCAN_SCRIPT_MARKER)) {
          return {
            ok: true,
            sourceFolders: [
              {
                id: '101',
                title: '默认收藏夹',
                videos: [
                  {
                    aid: 123,
                    title: 'AI工具效率教程：第1期',
                    author: '效率研究所',
                    description: '适合学习收藏的科普教程',
                    tags: ['AI', '效率', '工具'],
                    category: '科技'
                  },
                  {
                    aid: 124,
                    title: 'AI工具效率教程：第2期',
                    author: '效率研究所',
                    description: '提示词',
                    tags: ['AI', '效率', '工具'],
                    category: '科技'
                  },
                  {
                    aid: 125,
                    title: 'AI工具效率教程：第3期',
                    author: '效率研究所',
                    description: '自动化',
                    tags: ['AI', '工具', '自动化'],
                    category: '科技'
                  }
                ]
              }
            ],
            targetMembership: {},
            steps: ['api:favorite:list'],
            missingTargets: [],
            message: 'old favorites scanned'
          }
        }

        return emptyLedgerStatus()
      })
    })

    const preview = await requestRuntime({ id: 'scan-ai-1', type: 'scan-old-favorites' })

    expect(generateDeepSeek).not.toHaveBeenCalled()
    expect(preview).toEqual(
      expect.objectContaining({
        insights: expect.objectContaining({
          candidateLedgers: expect.arrayContaining([
            expect.objectContaining({
              sourceName: 'AI',
              displayName: 'Bilimi·AI',
              aiEnhanced: false
            })
          ])
        })
      })
    )

    const enhancedPreview = await requestRuntime({
      id: 'scan-ai-2',
      type: 'scan-old-favorites',
      enhanceWithDeepSeek: true
    })

    expect(generateDeepSeek).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'favorite-ledger-insights',
        totalVideos: 3,
        candidates: expect.arrayContaining([
          expect.objectContaining({
            sourceName: 'AI',
            displayName: 'Bilimi·AI'
          })
        ])
      })
    )
    expect(enhancedPreview).toEqual(
      expect.objectContaining({
        insights: expect.objectContaining({
          candidateLedgers: expect.arrayContaining([
            expect.objectContaining({
              sourceName: 'AI',
              displayName: 'Bilimi·AI效率工坊',
              aiEnhanced: true
            })
          ])
        })
      })
    )
  })

  it('saves favorite ledgers through the runtime bridge and persists synced ids', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    const { requestRuntime } = renderAppWithRuntimeBridge({ savePreferences })
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    const nextLedgers = [
      {
        ...createDefaultFavoriteLedgers()[0],
        id: 'custom-bilimi',
        displayName: 'Bilimi Custom',
        isDefault: false,
        bilibiliFolderId: undefined
      }
    ]
    const syncedLedgers = [{ ...nextLedgers[0], bilibiliFolderId: '9001' }]
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes(LEDGER_SAVE_SCRIPT_MARKER)) {
        return {
          ok: true,
          ledgers: syncedLedgers,
          steps: ['api:ledger:list', 'api:ledger:create:custom-bilimi'],
          missingTargets: [],
          message: 'saved'
        }
      }

      return emptyLedgerStatus()
    })
    Object.assign(webview, { executeJavaScript })

    const result = await requestRuntime({
      id: 'save-ledgers-1',
      type: 'save-ledgers',
      ledgers: nextLedgers
    })

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(LEDGER_SAVE_SCRIPT_MARKER)
    )
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('Bilimi Custom'))
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        favoriteLedgers: expect.arrayContaining([
          expect.objectContaining({ id: 'custom-bilimi', bilibiliFolderId: '9001' })
        ])
      })
    )
  })

  it('opens the active Bilibili favorites page in a new browser tab through the runtime bridge', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
      loadURL?: (url: string) => Promise<void>
    }
    const loadURL = vi.fn().mockResolvedValue(undefined)
    const executeJavaScript = vi.fn(async (script: string) => {
      if (script.includes('DedeUserID')) {
        return '12345'
      }

      return emptyLedgerStatus()
    })
    Object.assign(webview, { executeJavaScript, loadURL })

    const result = await requestRuntime({
      id: 'open-favorites-1',
      type: 'open-bilibili-favorites'
    } as AssistantRuntimeRequest)

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        steps: expect.arrayContaining(['favorite-page:open'])
      })
    )
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('DedeUserID'), true)
    expect(loadURL).not.toHaveBeenCalled()
    expect(document.querySelectorAll('webview')).toHaveLength(2)
    expect(screen.getByRole('tab', { name: 'favlist' })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('webview[data-active="true"]')).toHaveAttribute(
      'src',
      'https://space.bilibili.com/12345/favlist'
    )
  })

  it('asks the user to log in before opening Bilibili favorites', async () => {
    const { requestRuntime } = renderAppWithRuntimeBridge()
    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async () => '')
    Object.assign(webview, { executeJavaScript })

    const result = await requestRuntime({
      id: 'open-favorites-logged-out',
      type: 'open-bilibili-favorites'
    } as AssistantRuntimeRequest)

    expect(result).toEqual({
      ok: false,
      steps: ['auth:check'],
      missingTargets: ['bilibili-login'],
      message: '请先登录 Bilibili 后再操作。'
    })
    expect(document.querySelectorAll('webview')).toHaveLength(1)
  })
})

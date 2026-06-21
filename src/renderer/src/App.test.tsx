import { act, render, screen, waitFor } from '@testing-library/react'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type { AssistantPreferences } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload
} from './features/assistant/assistantRuntimeTypes'

const LEDGER_STATUS_SCRIPT_MARKER = '/x/v3/fav/folder/created/list-all'
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

  it('uses externally changed assistant preferences in runtime snapshots', async () => {
    const { notifyPreferencesChanged, requestRuntime } = renderAppWithRuntimeBridge()

    notifyPreferencesChanged({
      favoritesFolderName: 'Bilimi',
      favoriteLedgers: createDefaultFavoriteLedgers(),
      ledgerPromptDismissed: true,
      preferenceCounts: {},
      petStyle: 'classic'
    })

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
    const { requestRuntime } = renderAppWithRuntimeBridge()
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
        ]
      })
    )
    expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(OLD_FAVORITE_SCAN_SCRIPT_MARKER)
    )
  })
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

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

function ledgerStatusWithFolderIds() {
  return {
    ok: true,
    ledgers: createDefaultFavoriteLedgers().map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: String(9001 + index)
    })),
    missingLedgerIds: [],
    message: '册目查验已毕。'
  }
}

describe('App integration', () => {
  it('opens the memorial panel and shows the recommendation summary', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
    expect(screen.getByText(/此条暂存待阅/)).toBeInTheDocument()
  })

  it('keeps compact video title, category, and assistant evaluation in the panel', () => {
    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('page-title-updated', {
          detail: {
            title: '真实视频标题 - 哔哩哔哩'
          }
        })
      )
    })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByText('真实视频标题')).toBeInTheDocument()
    expect(screen.getByText('暂存待阅')).toBeInTheDocument()
    expect(screen.getByText(/此条暂存待阅/)).toBeInTheDocument()
  })

  it('runs assistant actions through the webview bridge and saves updated preferences', async () => {
    const loadPreferences = vi.fn().mockResolvedValue({
      favoritesFolderName: 'Bilimi 内库',
      preferenceCounts: {
        funny: 1,
        knowledge: 0,
        story: 0,
        suspicious: 0
      }
    })
    const savePreferences = vi.fn().mockImplementation(async (preferences) => preferences)

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        loadPreferences,
        savePreferences
      }
    })

    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) =>
      isLedgerStatusScript(script)
        ? emptyLedgerStatus()
        : {
            ok: true,
            steps: ['like', 'favorite'],
            missingTargets: [],
            message: '轻赏已入内库。'
          }
    )

    Object.assign(webview, { executeJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"action":"赏"')
    ))
    await waitFor(() => expect(savePreferences).toHaveBeenCalled())

    expect(loadPreferences).toHaveBeenCalled()
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        favoritesFolderName: 'Bilimi 内库',
        favoriteLedgers: expect.arrayContaining([
          expect.objectContaining({
            id: 'inbox',
            displayName: 'Bilimi·暂存待阅'
          })
        ]),
        ledgerPromptDismissed: false,
        preferenceCounts: expect.objectContaining({
          funny: 1,
          inbox: 1,
          knowledge: 0,
          story: 0,
          suspicious: 0
        })
      })
    )
  })

  it('checks ledger status through the active webview and opens 掌库 setup', async () => {
    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    const executeJavaScript = vi.fn().mockResolvedValueOnce({
      ok: true,
      ledgers: [],
      missingLedgerIds: ['knowledge'],
      message: '册目缺失。'
    })

    Object.assign(webview, { executeJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(await screen.findByText('Bilimi 专用册目尚未备齐，可请掌库先行备册。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '请掌库' }))

    expect(screen.getByRole('dialog', { name: '掌库' })).toBeInTheDocument()
    expect(executeJavaScript.mock.calls[0][0]).toContain('/x/v3/fav/folder/created/list-all')
  })

  it('scans old favorites through the active webview before showing ledger preview', async () => {
    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        return ledgerStatusWithFolderIds()
      }

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
          steps: ['api:favorite:list', 'api:favorite:scan-source:101'],
          missingTargets: [],
          message: 'old favorites scanned'
        }
      }

      throw new Error(`Unexpected script: ${script}`)
    })

    Object.assign(webview, { executeJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '掌库' }))
    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByText('机器学习入门教程')).toBeInTheDocument()
    expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('/x/v3/fav/resource/list')
    )
  })

  it('classifies active webview content before running favorite automation', async () => {
    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
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

      return {
        ok: true,
        steps: ['favorite:open', 'favorite:folder', 'favorite'],
        missingTargets: [],
        message: '已按内容归入内库。'
      }
    })

    Object.assign(webview, { executeJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '藏' }))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"targetLedgerId":"knowledge"')
    ))
    expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER),
      true
    )
  })

  it('opens webview popup URLs as internal browser tabs', async () => {
    render(<App />)

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

    expect(await screen.findByRole('tab', { name: /BV1demo/ })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelectorAll('webview')).toHaveLength(2)
    expect(document.querySelector('webview[data-active="true"]')).toHaveAttribute(
      'src',
      'https://www.bilibili.com/video/BV1demo'
    )
    expect(screen.getByRole('button', { name: '开折批阅' })).toBeInTheDocument()
  })

  it('opens main-process window-open URLs as internal browser tabs', async () => {
    let openInTabCallback: ((url: string) => void) | undefined

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        loadPreferences: vi.fn(),
        savePreferences: vi.fn(),
        onOpenInTab: vi.fn((callback: (url: string) => void) => {
          openInTabCallback = callback
          return vi.fn()
        })
      }
    })

    render(<App />)

    act(() => {
      openInTabCallback?.('https://www.bilibili.com/video/BV1ipc')
    })

    expect(await screen.findByRole('tab', { name: /BV1ipc/ })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('webview[data-active="true"]')).toHaveAttribute(
      'src',
      'https://www.bilibili.com/video/BV1ipc'
    )
  })

  it('opens injected video click signals as internal browser tabs', async () => {
    render(<App />)

    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

    act(() => {
      homeWebview.dispatchEvent(
        new CustomEvent('page-title-updated', {
          detail: {
            title: `__BILIMI_OPEN_IN_TAB__:${encodeURIComponent(
              'https://www.bilibili.com/video/BV1signal'
            )}`
          }
        })
      )
    })

    expect(await screen.findByRole('tab', { name: /BV1signal/ })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('webview[data-active="true"]')).toHaveAttribute(
      'src',
      'https://www.bilibili.com/video/BV1signal'
    )
    expect(document.querySelector('.seal-button')).toBeInTheDocument()
  })

  it('runs assistant actions against the active internal tab', async () => {
    render(<App />)

    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement
    const homeExecuteJavaScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['home'],
      missingTargets: [],
      message: 'home'
    })
    Object.assign(homeWebview, { executeJavaScript: homeExecuteJavaScript })

    act(() => {
      homeWebview.dispatchEvent(
        new CustomEvent('new-window', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1active'
          }
        })
      )
    })

    await screen.findByRole('tab', { name: /BV1active/ })

    let activeWebview: (HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }) | null = null

    await waitFor(() => {
      activeWebview = document.querySelector(
        'webview[data-active="true"][src="https://www.bilibili.com/video/BV1active"]'
      ) as HTMLElement & {
        executeJavaScript?: (script: string) => Promise<unknown>
      }
      expect(activeWebview).not.toBeNull()
    })

    const activeExecuteJavaScript = vi.fn(async (script: string) =>
      isLedgerStatusScript(script)
        ? emptyLedgerStatus()
        : {
            ok: true,
            steps: ['active'],
            missingTargets: [],
            message: 'active'
          }
    )
    Object.assign(activeWebview!, { executeJavaScript: activeExecuteJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() => expect(activeExecuteJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"action":"赏"')
    ))
    expect(homeExecuteJavaScript).not.toHaveBeenCalled()
  })

  it('uses visual keyboard and mouse fallback when favorite creation is not found by DOM automation', async () => {
    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      capturePage?: () => Promise<{ toDataURL: () => string }>
      executeJavaScript?: (script: string) => Promise<unknown>
      sendInputEvent?: (event: unknown) => void
    }
    const executeJavaScript = vi.fn(async (script: string) => {
      if (isLedgerStatusScript(script)) {
        return emptyLedgerStatus()
      }

      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          title: '爆笑整活合集',
          tags: ['搞笑']
        }
      }

      if (script.includes('/x/v3/fav/resource/deal')) {
        return {
          ok: false,
          steps: ['api:favorite:list'],
          missingTargets: ['favorite-api'],
          message: 'B 站收藏接口未能完成。'
        }
      }

      if (script.includes('visualTextBoxes')) {
        return {
          boxes: [
            { text: '新建收藏夹', x: 120, y: 360, width: 120, height: 32 },
            { text: '收藏夹名称', x: 180, y: 420, width: 180, height: 36 },
            { text: '创建', x: 300, y: 470, width: 80, height: 32 }
          ]
        }
      }

      if (script.includes('__bilimiFavoriteFocusPoint')) {
        return true
      }

      if (script.includes('modalClassName')) {
        return {
          containers: [],
          modalClassName: 'fav-dialog',
          moved: false
        }
      }

      return {
        ok: false,
        steps: ['like', 'favorite:open'],
        missingTargets: ['favorite-create-button'],
        message: '尚有 favorite-create-button 未能寻见。'
      }
    })
    const sendInputEvent = vi.fn()

    Object.assign(webview, {
      capturePage: vi.fn().mockResolvedValue({ toDataURL: () => 'data:image/png;base64,screen' }),
      executeJavaScript,
      sendInputEvent
    })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() =>
      expect(sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'char', keyCode: 'B' }))
    )

    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('visualTextBoxes'), true)
    expect(sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouseDown' }))
    expect(sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'char', keyCode: 'B' }))
  })

  it('closes an internal browser tab and returns to the home tab', async () => {
    render(<App />)

    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

    act(() => {
      homeWebview.dispatchEvent(
        new CustomEvent('new-window', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1close'
          }
        })
      )
    })

    const internalTab = await screen.findByRole('tab', { name: /BV1close/ })

    expect(internalTab).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: /关闭 BV1close/ }))

    expect(screen.queryByRole('tab', { name: /BV1close/ })).not.toBeInTheDocument()
    expect(document.querySelectorAll('webview')).toHaveLength(1)
    expect(document.querySelector('webview[data-active="true"]')).toHaveAttribute(
      'src',
      'https://www.bilibili.com'
    )
  })

  it('extracts the active video page and renders local video notes', async () => {
    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    const executeJavaScript = vi.fn().mockResolvedValue({
      title: '机器学习入门教程 - 哔哩哔哩',
      author: 'UP 主',
      description: '从模型、训练、数据讲清楚机器学习',
      tags: ['教程', '机器学习'],
      bvid: 'BV1note',
      url: 'https://www.bilibili.com/video/BV1note',
      transcript: [
        { start: 0, end: 8, text: '机器学习需要数据和模型。' },
        { start: 10, end: 18, text: '训练过程会不断调整参数。' }
      ]
    })
    Object.assign(webview, { executeJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('subtitle'), true))
    await waitFor(() => expect(screen.getAllByText('机器学习需要数据和模型。').length).toBeGreaterThan(0))
  })

  it('saves a generated video note through the desktop API', async () => {
    const saveVideoNote = vi.fn().mockResolvedValue([])

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        loadPreferences: vi.fn(),
        savePreferences: vi.fn(),
        saveVideoNote
      }
    })

    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
    }
    Object.assign(webview, {
      executeJavaScript: vi.fn().mockResolvedValue({
        title: '机器学习入门教程',
        bvid: 'BV1note',
        url: 'https://www.bilibili.com/video/BV1note',
        tags: [],
        transcript: [{ start: 0, end: 8, text: '机器学习需要数据和模型。' }]
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))
    fireEvent.click(await screen.findByRole('tab', { name: '归档' }))
    fireEvent.click(await screen.findByRole('button', { name: '保存札记' }))

    await waitFor(() => expect(saveVideoNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'bvid:BV1note' })))
  })

})

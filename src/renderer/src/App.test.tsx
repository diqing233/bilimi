import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

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
    const executeJavaScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['like', 'favorite'],
      missingTargets: [],
      message: '轻赏已入内库。'
    })

    Object.assign(webview, { executeJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledOnce())
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

  it('classifies active webview content before running favorite automation', async () => {
    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    const executeJavaScript = vi
      .fn()
      .mockResolvedValueOnce({
        title: '三分钟讲清机器学习科普教程',
        pageText: '从原理到入门路线，适合学习收藏。'
      })
      .mockResolvedValueOnce({
        ok: true,
        steps: ['favorite:open', 'favorite:folder', 'favorite'],
        missingTargets: [],
        message: '已按内容归入内库。'
      })

    Object.assign(webview, { executeJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '藏' }))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledTimes(2))
    expect(executeJavaScript.mock.calls[0][0]).toContain('readMeta')
    expect(executeJavaScript.mock.calls[1][0]).toContain('"recommendationKind":"knowledge"')
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

    const activeExecuteJavaScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['active'],
      missingTargets: [],
      message: 'active'
    })
    Object.assign(activeWebview!, { executeJavaScript: activeExecuteJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() => expect(activeExecuteJavaScript).toHaveBeenCalledOnce())
    expect(homeExecuteJavaScript).not.toHaveBeenCalled()
  })

  it('uses visual keyboard and mouse fallback when favorite creation is not found by DOM automation', async () => {
    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      capturePage?: () => Promise<{ toDataURL: () => string }>
      executeJavaScript?: (script: string) => Promise<unknown>
      sendInputEvent?: (event: unknown) => void
    }
    const executeJavaScript = vi
      .fn()
      .mockResolvedValueOnce({
        title: '爆笑整活合集',
        tags: ['搞笑']
      })
      .mockResolvedValueOnce({
        ok: false,
        steps: ['like', 'favorite:open'],
        missingTargets: ['favorite-create-button'],
        message: '尚有 favorite-create-button 未能寻见。'
      })
      .mockResolvedValueOnce({
        ok: false,
        steps: ['api:favorite:list'],
        missingTargets: ['favorite-api'],
        message: 'B 站收藏接口未能完成。'
      })
      .mockResolvedValue({
        boxes: [
          { text: '新建收藏夹', x: 120, y: 360, width: 120, height: 32 },
          { text: '收藏夹名称', x: 180, y: 420, width: 180, height: 36 },
          { text: '创建', x: 300, y: 470, width: 80, height: 32 }
        ]
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
})

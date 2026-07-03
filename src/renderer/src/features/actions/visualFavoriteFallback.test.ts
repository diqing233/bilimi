import { describe, expect, it, vi } from 'vitest'
import { runVisualFavoriteFallback } from './visualFavoriteFallback'

function createWebview(boxFrames: Array<Array<Record<string, unknown>>>) {
  const sentEvents: Record<string, unknown>[] = []
  const scripts: string[] = []
  let frameIndex = 0

  const webview = {
    capturePage: vi.fn().mockResolvedValue({ toDataURL: vi.fn(() => 'data:image/png;base64,') }),
    executeJavaScript: vi.fn().mockImplementation((script: string) => {
      scripts.push(script)

      if (script.includes('scrollTop')) {
        return Promise.resolve({
          containers: [
            {
              after: 420,
              before: 0,
              changed: true,
              className: 'fav-list',
              clientHeight: 420,
              scrollHeight: 1200,
              tagName: 'DIV',
              x: 80,
              y: 100
            }
          ],
          modalClassName: 'bili-dialog-bomb',
          moved: true
        })
      }

      if (script.includes('__bilimiFavoriteFocusPoint')) {
        return Promise.resolve(true)
      }

      const boxes = boxFrames[Math.min(frameIndex, boxFrames.length - 1)]
      frameIndex += 1
      return Promise.resolve({ boxes })
    }),
    sendInputEvent: vi.fn((event: Record<string, unknown>) => {
      sentEvents.push(event)
    })
  } as unknown as Electron.WebviewTag & {
    sendInputEvent: (event: Record<string, unknown>) => void
  }

  return { scripts, sentEvents, webview }
}

function createWebviewWithPostCreateScroll() {
  const sentEvents: Record<string, unknown>[] = []
  const scripts: string[] = []
  let frameIndex = 0
  let scrolledAfterCreate = false

  const setupFrames = [
    [{ text: '收藏', x: 10, y: 20, width: 80, height: 32 }],
    [{ text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 }],
    [{ text: '+ 新建收藏夹', x: 120, y: 420, width: 140, height: 32 }],
    [{ text: '收藏夹名称', x: 120, y: 260, width: 180, height: 36 }],
    [{ text: '创建', x: 240, y: 340, width: 80, height: 32 }]
  ]
  const beforePostCreateScroll = [
    { text: '默认收藏夹 [私密]', x: 120, y: 170, width: 190, height: 44 },
    { text: '确定', x: 250, y: 620, width: 120, height: 40 }
  ]
  const afterPostCreateScroll = [
    { text: 'bilimi·影视动漫', x: 120, y: 470, width: 180, height: 32 },
    { text: '确定', x: 250, y: 620, width: 120, height: 40 }
  ]

  const webview = {
    capturePage: vi.fn().mockResolvedValue({ toDataURL: vi.fn(() => 'data:image/png;base64,') }),
    executeJavaScript: vi.fn().mockImplementation((script: string) => {
      scripts.push(script)

      if (script.includes('scrollTop')) {
        return Promise.resolve({
          containers: [
            {
              after: 840,
              before: 420,
              changed: true,
              className: 'fav-list',
              clientHeight: 420,
              scrollHeight: 1400,
              tagName: 'DIV',
              x: 80,
              y: 100
            }
          ],
          modalClassName: 'bili-dialog-bomb',
          moved: true
        })
      }

      if (script.includes('__bilimiFavoriteFocusPoint')) {
        return Promise.resolve(true)
      }

      const boxes =
        setupFrames[frameIndex] ?? (scrolledAfterCreate ? afterPostCreateScroll : beforePostCreateScroll)
      frameIndex += 1
      return Promise.resolve({ boxes })
    }),
    sendInputEvent: vi.fn((event: Record<string, unknown>) => {
      sentEvents.push(event)

      if (event.keyCode === 'PageDown') {
        scrolledAfterCreate = true
      }
    })
  } as unknown as Electron.WebviewTag & {
    sendInputEvent: (event: Record<string, unknown>) => void
  }

  return { scripts, sentEvents, webview }
}

function createWebviewWithInlineCreateForm() {
  const sentEvents: Record<string, unknown>[] = []
  const scripts: string[] = []
  let frameIndex = 0

  const boxFrames = [
    [{ text: '收藏', x: 10, y: 20, width: 80, height: 32 }],
    [{ text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 }],
    [{ text: '+ 新建收藏夹', x: 120, y: 420, width: 140, height: 32 }],
    [
      { text: '最多可输入20个字', x: 118, y: 416, width: 322, height: 44 },
      { text: '新建', x: 440, y: 416, width: 112, height: 44 },
      { text: '确定', x: 236, y: 484, width: 280, height: 50 }
    ],
    [
      { text: '最多可输入20个字', x: 118, y: 416, width: 322, height: 44 },
      { text: '新建', x: 440, y: 416, width: 112, height: 44 },
      { text: '确定', x: 236, y: 484, width: 280, height: 50 }
    ],
    [{ text: '确定', x: 236, y: 484, width: 280, height: 50 }]
  ]

  const webview = {
    capturePage: vi.fn().mockResolvedValue({ toDataURL: vi.fn(() => 'data:image/png;base64,') }),
    executeJavaScript: vi.fn().mockImplementation((script: string) => {
      scripts.push(script)

      if (script.includes('scrollTop')) {
        return Promise.resolve({ containers: [], moved: false })
      }

      if (script.includes('__bilimiFavoriteFocusPoint')) {
        return Promise.resolve(true)
      }

      const boxes = boxFrames[Math.min(frameIndex, boxFrames.length - 1)]
      frameIndex += 1
      return Promise.resolve({ boxes })
    }),
    sendInputEvent: vi.fn((event: Record<string, unknown>) => {
      sentEvents.push(event)
    })
  } as unknown as Electron.WebviewTag & {
    sendInputEvent: (event: Record<string, unknown>) => void
  }

  return { scripts, sentEvents, webview }
}

function createWebviewWithOffscreenCreateEntry() {
  const sentEvents: Record<string, unknown>[] = []
  const scripts: string[] = []
  let frameIndex = 0
  let scrolledToCreate = false

  const openFrames = [
    [{ text: '收藏', x: 10, y: 20, width: 80, height: 32 }],
    [{ text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 }]
  ]
  const beforeScrollBoxes = [
    {
      text: '添加到收藏夹 默认收藏夹 [私密] 1 ai [私密] 学吧你就 可爱 音乐 + 新建收藏夹',
      x: 462,
      y: 245,
      width: 524,
      height: 532
    },
    { text: '默认收藏夹 [私密]', x: 560, y: 340, width: 190, height: 44 },
    { text: '音乐', x: 560, y: 630, width: 190, height: 44 },
    { text: '+ 新建收藏夹', visible: false, x: 570, y: 820, width: 140, height: 32 }
  ]
  const createBoxes = [{ text: '+ 新建收藏夹', x: 570, y: 700, width: 140, height: 32 }]
  const formBoxes = [
    { text: '最多可输入20个字', x: 118, y: 416, width: 322, height: 44 },
    { text: '新建', x: 440, y: 416, width: 112, height: 44 },
    { text: '确定', x: 236, y: 484, width: 280, height: 50 }
  ]
  const confirmBoxes = [{ text: '确定', x: 236, y: 484, width: 280, height: 50 }]

  const webview = {
    capturePage: vi.fn().mockResolvedValue({ toDataURL: vi.fn(() => 'data:image/png;base64,') }),
    executeJavaScript: vi.fn().mockImplementation((script: string) => {
      scripts.push(script)

      if (script.includes('scrollTop')) {
        return Promise.resolve({
          containers: [
            {
              after: 420,
              before: 0,
              changed: true,
              className: 'fav-list',
              clientHeight: 420,
              scrollHeight: 1200,
              tagName: 'DIV',
              x: 462,
              y: 245
            }
          ],
          modalClassName: 'bili-dialog-bomb',
          moved: true
        })
      }

      if (script.includes('__bilimiFavoriteFocusPoint')) {
        return Promise.resolve(true)
      }

      let boxes: Array<Record<string, unknown>>

      if (frameIndex < openFrames.length) {
        boxes = openFrames[frameIndex]
      } else if (!scrolledToCreate) {
        boxes = beforeScrollBoxes
      } else if (
        sentEvents.some((event) => event.type === 'mouseDown' && event.x === 496 && event.y === 438)
      ) {
        boxes = confirmBoxes
      } else if (
        sentEvents.some((event) => event.type === 'mouseDown' && event.x === 640 && event.y === 716)
      ) {
        boxes = formBoxes
      } else {
        boxes = createBoxes
      }

      frameIndex += 1
      return Promise.resolve({ boxes })
    }),
    sendInputEvent: vi.fn((event: Record<string, unknown>) => {
      sentEvents.push(event)

      if (event.keyCode === 'PageDown') {
        scrolledToCreate = true
      }
    })
  } as unknown as Electron.WebviewTag & {
    sendInputEvent: (event: Record<string, unknown>) => void
  }

  return { scripts, sentEvents, webview }
}

const context = {
  favoriteFolders: {
    'movie-tv': 'bilimi·影视动漫',
    knowledge: 'bilimi·知识学习',
    entertainment: 'bilimi·搞笑杂谈'
  },
  favoritesFolderName: 'bilimi 内库',
  targetLedgerId: 'movie-tv'
}

describe('runVisualFavoriteFallback', () => {
  it('keeps the Electron webview receiver when sending shortcut and mouse events', async () => {
    const sentEvents: Record<string, unknown>[] = []
    const webview = {
      capturePage: vi.fn().mockResolvedValue({ toDataURL: vi.fn(() => 'data:image/png;base64,') }),
      executeJavaScript: vi.fn().mockResolvedValue({
        boxes: [
          { text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 },
          { text: '+ 新建收藏夹', x: 120, y: 420, width: 140, height: 32 }
        ]
      }),
      getWebContentsId: vi.fn(() => 42),
      sendInputEvent(this: { getWebContentsId?: () => number }, event: Record<string, unknown>) {
        if (!this.getWebContentsId) {
          throw new Error("Cannot read properties of undefined (reading 'getWebContentsId')")
        }

        this.getWebContentsId()
        sentEvents.push(event)
      }
    } as unknown as Electron.WebviewTag & {
      sendInputEvent: (event: Record<string, unknown>) => void
    }

    const result = await runVisualFavoriteFallback(webview, context, {
      openWithShortcut: true
    })

    expect(result.ok).toBe(false)
    expect(result.missingTargets).toContain('visual-create-name')
    expect(sentEvents).toContainEqual(expect.objectContaining({ keyCode: 'e', type: 'keyDown' }))
  })

  it('presses the Bilibili favorite shortcut before reading the favorite dialog', async () => {
    const { sentEvents, webview } = createWebview([
      [{ text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 }],
      [{ text: '+ 新建收藏夹', x: 120, y: 420, width: 140, height: 32 }],
      [{ text: '收藏夹名称', x: 120, y: 260, width: 180, height: 36 }],
      [{ text: '创建', x: 240, y: 340, width: 80, height: 32 }],
      [
        { text: 'bilimi·影视动漫', x: 120, y: 470, width: 180, height: 32 },
        { text: '确定', x: 250, y: 620, width: 120, height: 40 }
      ]
    ])

    const result = await runVisualFavoriteFallback(webview, context, {
      openWithShortcut: true
    })

    expect(result.ok).toBe(true)
    expect(result.steps[0]).toBe('visual:favorite:shortcut:e')
    expect(sentEvents[0]).toMatchObject({ keyCode: 'e', type: 'keyDown' })
    expect(sentEvents[1]).toMatchObject({ keyCode: 'e', type: 'keyUp' })
    expect(sentEvents).not.toContainEqual(
      expect.objectContaining({ type: 'mouseDown', x: 50, y: 36 })
    )
  })

  it('clicks the visible favorite button before scrolling the favorite panel', async () => {
    const { scripts, sentEvents, webview } = createWebview([
      [{ text: '收藏', x: 10, y: 20, width: 80, height: 32 }],
      [{ text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 }],
      [
        { text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 },
        { text: '默认收藏夹 [私密]', x: 120, y: 160, width: 190, height: 44 }
      ],
      [{ text: '+ 新建收藏夹', x: 120, y: 420, width: 140, height: 32 }],
      [{ text: '收藏夹名称', x: 120, y: 260, width: 180, height: 36 }],
      [{ text: '创建', x: 240, y: 340, width: 80, height: 32 }],
      [
        { text: 'bilimi·影视动漫', x: 120, y: 470, width: 180, height: 32 },
        { text: '确定', x: 250, y: 620, width: 120, height: 40 }
      ]
    ])

    const result = await runVisualFavoriteFallback(webview, context)

    expect(result.ok).toBe(true)
    expect(result.steps.indexOf('visual:favorite:open')).toBeLessThan(
      result.steps.indexOf('visual:favorite:focus-first-folder')
    )
    expect(result.steps.indexOf('visual:favorite:focus-first-folder')).toBeLessThan(
      result.steps.indexOf('visual:favorite:scroll')
    )
    expect(sentEvents[0]).toMatchObject({ type: 'mouseMove', x: 50, y: 36 })
    expect(
      sentEvents.filter(
        (event) => event.type === 'mouseDown' && event.x === 215 && event.y === 182
      )
    ).toHaveLength(2)
    expect(sentEvents).toContainEqual(
      expect.objectContaining({ type: 'mouseDown', x: 215, y: 182, clickCount: 2 })
    )
    expect(sentEvents.some((event) => event.keyCode === 'PageDown')).toBe(true)
    expect(result.steps.some((step) => step.startsWith('visual:favorite:diagnostic:'))).toBe(
      true
    )
    expect(scripts.some((script) => script.includes('scrollTop'))).toBe(true)
  })

  it('selects the created Bilimi folder and confirms the favorite dialog', async () => {
    const { sentEvents, webview } = createWebview([
      [{ text: '收藏', x: 10, y: 20, width: 80, height: 32 }],
      [{ text: '添加到收藏夹', x: 100, y: 80, width: 180, height: 32 }],
      [{ text: '+ 新建收藏夹', x: 120, y: 420, width: 140, height: 32 }],
      [{ text: '收藏夹名称', x: 120, y: 260, width: 180, height: 36 }],
      [{ text: '创建', x: 240, y: 340, width: 80, height: 32 }],
      [
        { text: 'bilimi·影视动漫', x: 120, y: 470, width: 180, height: 32 },
        { text: '确定', x: 250, y: 620, width: 120, height: 40 }
      ],
      [
        { text: 'bilimi·影视动漫', x: 120, y: 470, width: 180, height: 32 },
        { text: '确定', x: 250, y: 620, width: 120, height: 40 }
      ]
    ])

    const result = await runVisualFavoriteFallback(webview, context)

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'visual:favorite:create',
        'visual:favorite:select-folder',
        'visual:favorite:confirm'
      ])
    )
    expect(sentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'mouseDown', x: 210, y: 486 }),
        expect.objectContaining({ type: 'mouseDown', x: 310, y: 640 })
      ])
    )
  })

  it('focuses the favorite list and scrolls after creating when the target folder is offscreen', async () => {
    const { scripts, sentEvents, webview } = createWebviewWithPostCreateScroll()

    const result = await runVisualFavoriteFallback(webview, context)

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'visual:favorite:create',
        'visual:favorite:post-create:focus-first-folder',
        'visual:favorite:post-create:scroll',
        'visual:favorite:select-folder',
        'visual:favorite:confirm'
      ])
    )
    expect(
      result.steps.some((step) => step.startsWith('visual:favorite:post-create:diagnostic:'))
    ).toBe(true)
    expect(sentEvents).toContainEqual(
      expect.objectContaining({ type: 'mouseDown', x: 215, y: 192, clickCount: 2 })
    )
    expect(sentEvents.some((event) => event.keyCode === 'PageDown')).toBe(true)
    expect(scripts.some((script) => script.includes('scrollTop'))).toBe(true)
  })

  it('inputs the folder name, clicks inline create, then confirms when the Bilibili inline form is open', async () => {
    const { sentEvents, webview } = createWebviewWithInlineCreateForm()

    const result = await runVisualFavoriteFallback(webview, context)

    const inputClickIndex = sentEvents.findIndex(
      (event) => event.type === 'mouseDown' && event.x === 279 && event.y === 438
    )
    const firstCharIndex = sentEvents.findIndex(
      (event) => event.type === 'char' && event.keyCode === 'b'
    )
    const inlineCreateClickIndex = sentEvents.findIndex(
      (event) => event.type === 'mouseDown' && event.x === 496 && event.y === 438
    )
    const finalConfirmClickIndex = sentEvents.findIndex(
      (event) => event.type === 'mouseDown' && event.x === 376 && event.y === 509
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'visual:favorite:create-open',
        'visual:favorite:create-name:bilimi·影视动漫',
        'visual:favorite:create',
        'visual:favorite:confirm'
      ])
    )
    expect(inputClickIndex).toBeGreaterThan(-1)
    expect(firstCharIndex).toBeGreaterThan(inputClickIndex)
    expect(inlineCreateClickIndex).toBeGreaterThan(firstCharIndex)
    expect(finalConfirmClickIndex).toBeGreaterThan(inlineCreateClickIndex)
  })

  it('keeps scrolling when the create-folder row is present in the DOM but below the visible dialog', async () => {
    const { scripts, sentEvents, webview } = createWebviewWithOffscreenCreateEntry()

    const result = await runVisualFavoriteFallback(webview, context)

    expect(result.ok).toBe(true)
    expect(result.steps.indexOf('visual:favorite:scroll')).toBeLessThan(
      result.steps.indexOf('visual:favorite:create-open')
    )
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'visual:favorite:focus-first-folder',
        'visual:favorite:create-open',
        'visual:favorite:create-name-input',
        'visual:favorite:create',
        'visual:favorite:confirm'
      ])
    )
    expect(sentEvents).not.toContainEqual(
      expect.objectContaining({ type: 'mouseDown', x: 640, y: 836 })
    )
    expect(sentEvents).toContainEqual(
      expect.objectContaining({ type: 'mouseDown', x: 640, y: 716 })
    )
    expect(sentEvents.some((event) => event.keyCode === 'PageDown')).toBe(true)
    expect(scripts.some((script) => script.includes('scrollTop'))).toBe(true)
  })

  it('does not scroll when clicking favorite fails to reveal the favorite panel', async () => {
    const { sentEvents, webview } = createWebview([
      [{ text: '收藏', x: 10, y: 20, width: 80, height: 32 }],
      [{ text: '收藏', x: 10, y: 20, width: 80, height: 32 }],
      [{ text: '收藏', x: 10, y: 20, width: 80, height: 32 }]
    ])

    const result = await runVisualFavoriteFallback(webview, context)

    expect(result.ok).toBe(false)
    expect(result.steps).toEqual(['visual:favorite:open'])
    expect(result.missingTargets).toEqual(['visual-favorite-panel'])
    expect(sentEvents.some((event) => event.keyCode === 'PageDown')).toBe(false)
  })

  it('does not create the legacy Bilimi folder when the target ledger is missing', async () => {
    const { sentEvents, webview } = createWebview([
      [{ text: '鏀惰棌', x: 10, y: 20, width: 80, height: 32 }]
    ])

    const result = await runVisualFavoriteFallback(webview, {
      favoriteFolders: {},
      favoritesFolderName: 'Bilimi Legacy Vault',
      targetLedgerId: 'missing-ledger'
    })

    expect(result.ok).toBe(false)
    expect(result.missingTargets).toContain('target-ledger')
    expect(sentEvents).toHaveLength(0)
  })
})

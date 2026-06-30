import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantSidebar } from './AssistantSidebar'

function installDesktopApi() {
  let openAssistantCallback: (() => void) | undefined
  const openWorkspaceCallbacks: Array<
    Parameters<NonNullable<Window['bilimiDesktop']['onOpenFloatingAssistantWorkspace']>>[0]
  > = []
  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: {
      version: '0.1.0',
      loadPreferences: vi.fn(),
      onOpenAssistant: vi.fn((callback) => {
        openAssistantCallback = callback
        return vi.fn()
      }),
      onOpenFloatingAssistantWorkspace: vi.fn((callback) => {
        openWorkspaceCallbacks.push(callback)
        return vi.fn()
      }),
      onAssistantSnapshotChanged: vi.fn(),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(undefined),
      savePreferences: vi.fn(),
      setAssistantPetHint: vi.fn(),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
        activeItemId: 'bvid:BV1note',
        items: [
          {
            id: 'bvid:BV1note',
            url: 'https://www.bilibili.com/video/BV1note',
            title: '机器学习入门教程',
            bvid: 'BV1note',
            status: 'running',
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:00:00.000Z'
          }
        ]
      }),
      onVideoAudioTranscriptionQueueChanged: vi.fn(() => vi.fn()),
      loadVideoNoteArchives: vi.fn().mockResolvedValue([])
    }
  })

  return {
    openAssistant: () => openAssistantCallback?.(),
    openWorkspace: (
      payload: Parameters<
        NonNullable<Window['bilimiDesktop']['onOpenFloatingAssistantWorkspace']>
      >[0] extends (payload: infer Payload) => void
        ? Payload
        : never
    ) => {
      for (const callback of openWorkspaceCallbacks) {
        callback(payload)
      }
    },
    setAssistantPetHint: window.bilimiDesktop.setAssistantPetHint as ReturnType<typeof vi.fn>
  }
}

describe('AssistantSidebar', () => {
  it('opens by default with the 批阅 tab selected', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'false'
    )
    expect(await screen.findByRole('tab', { name: '批阅' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('uses the left boundary collapse control without rendering a rail column', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    expect(screen.queryByRole('navigation', { name: '侧边栏收合控制' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠侧边栏' })).toHaveClass(
      'assistant-sidebar__collapse-button'
    )
    expect(screen.getByText('折叠')).toHaveClass('assistant-sidebar__collapse-label')
    expect(screen.getByRole('img', { name: '小咪收起侧栏' })).toHaveClass(
      'assistant-sidebar__collapse-pet'
    )
    expect(screen.queryByRole('button', { name: '打开批阅' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开札记' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开掌库' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    expect(screen.queryByRole('tab', { name: '批阅' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '小咪展开侧栏' })).toHaveClass(
      'assistant-sidebar__collapse-pet'
    )

    expect(screen.getByText('展开')).toHaveClass('assistant-sidebar__collapse-label')

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(await screen.findByRole('tab', { name: '批阅' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('expands the sidebar when the floating pet asks to open the assistant', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )

    act(() => {
      api.openAssistant()
    })

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'false'
    )
  })

  it('expands and syncs to a pet workspace request while collapsed', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )

    act(() => {
      api.openWorkspace({ tab: 'ledger', organizeOldFavorites: true })
    })

    expect(await screen.findByRole('tab', { name: '掌库' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'false'
    )
  })

  it('keeps the notes workspace mounted while the sidebar is collapsed', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    expect(await screen.findByRole('region', { name: '转写状态' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('tab', { name: '札记', hidden: true })).not.toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(await screen.findByRole('tab', { name: '札记' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('region', { name: '转写状态' })).toBeInTheDocument()
  })

  it('lets XiaoMi ask what to do when the sidebar expands', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }))
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(api.setAssistantPetHint).toHaveBeenLastCalledWith({
      tone: 'hint',
      message: '主人想要做些什么呢~'
    })
  })

  it('does not nudge when the sidebar stays collapsed for a while', async () => {
    vi.useFakeTimers()
    const api = installDesktopApi()

    try {
      render(<AssistantSidebar />)

      await act(async () => undefined)
      fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

      act(() => {
        vi.advanceTimersByTime(60_000)
      })

      expect(api.setAssistantPetHint).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says goodbye when the sidebar is collapsed', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)

    await act(async () => undefined)
    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

    expect(api.setAssistantPetHint).toHaveBeenCalledWith({
      tone: 'sleepy',
      message: '主人先专心享受，有需要随时呼唤小咪'
    })
  })
})

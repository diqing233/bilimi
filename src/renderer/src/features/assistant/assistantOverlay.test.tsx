import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantOverlay } from './AssistantOverlay'
import { createInitialAssistantPreferences } from '../state/assistantState'

const ACTION_BUTTON_NAMES = {
  赏: /赏.*轻赏此条/,
  藏: /藏.*归入内库/,
  赐: /赐.*投币厚赏/,
  表: /表.*拟奏短评/
} as const

function getActionButton(action: keyof typeof ACTION_BUTTON_NAMES) {
  return screen.getByRole('button', { name: ACTION_BUTTON_NAMES[action] })
}

describe('AssistantOverlay', () => {
  it('starts the folded seal inside the left safe area instead of hugging the right edge', () => {
    render(<AssistantOverlay />)

    const overlay = screen.getByRole('button', { name: '开折批阅' }).closest('.assistant-overlay')

    expect(overlay).toHaveStyle({ left: '24px', top: '54px' })
    expect((overlay as HTMLElement).style.right).toBe('')
  })

  it('drags the folded seal to a new position without opening the panel', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })

    render(<AssistantOverlay />)

    const seal = screen.getByRole('button', { name: '开折批阅' })
    const overlay = seal.closest('.assistant-overlay')

    fireEvent.mouseDown(seal, { clientX: 50, clientY: 70 })
    fireEvent.mouseMove(seal, { clientX: 240, clientY: 220 })
    fireEvent.mouseUp(seal, { clientX: 240, clientY: 220 })
    fireEvent.click(seal)

    expect(overlay).toHaveStyle({ left: '214px', top: '204px' })
    expect(screen.queryByLabelText('案头奏折')).not.toBeInTheDocument()
  })

  it('opens on a deliberate click after the drag-release suppression window expires', async () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })

    try {
      render(<AssistantOverlay />)

      const seal = screen.getByRole('button', { name: '开折批阅' })

      fireEvent.mouseDown(seal, { clientX: 50, clientY: 70 })
      fireEvent.mouseMove(seal, { clientX: 240, clientY: 220 })
      fireEvent.mouseUp(seal, { clientX: 240, clientY: 220 })

      await vi.runOnlyPendingTimersAsync()
      fireEvent.click(seal)

      expect(screen.getByLabelText('案头奏折')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the open panel inside the viewport after the seal is dragged near the right edge', async () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 280 })

    try {
      render(<AssistantOverlay />)

      const seal = screen.getByRole('button', { name: '开折批阅' })
      const overlay = seal.closest('.assistant-overlay')

      fireEvent.mouseDown(seal, { clientX: 50, clientY: 70 })
      fireEvent.mouseMove(seal, { clientX: 300, clientY: 220 })
      fireEvent.mouseUp(seal, { clientX: 300, clientY: 220 })

      await vi.runOnlyPendingTimersAsync()
      fireEvent.click(seal)

      expect(screen.getByLabelText('案头奏折')).toBeInTheDocument()
      expect(overlay).toHaveStyle({ left: '72px', top: '56px' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores the dragged seal position after closing a clamped open panel', async () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 280 })

    try {
      render(<AssistantOverlay />)

      const seal = screen.getByRole('button', { name: '开折批阅' })
      const overlay = seal.closest('.assistant-overlay')

      fireEvent.mouseDown(seal, { clientX: 50, clientY: 70 })
      fireEvent.mouseMove(seal, { clientX: 300, clientY: 220 })
      fireEvent.mouseUp(seal, { clientX: 300, clientY: 220 })

      expect(overlay).toHaveStyle({ left: '264px', top: '204px' })

      await vi.runOnlyPendingTimersAsync()
      fireEvent.click(seal)
      fireEvent.click(screen.getByRole('button', { name: '合折' }))

      expect(overlay).toHaveStyle({ left: '264px', top: '204px' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the memorial panel from the folded seal', () => {
    render(<AssistantOverlay />)

    expect(screen.getByRole('button', { name: '开折批阅' })).toBeInTheDocument()
    expect(screen.queryByLabelText('案头奏折')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByLabelText('案头奏折')).toBeInTheDocument()
    expect(screen.queryByText('今日所陈')).not.toBeInTheDocument()
    expect(screen.queryByText('御前待阅折')).not.toBeInTheDocument()
    expect(screen.queryByText('司礼监掌印官谨呈')).not.toBeInTheDocument()
    expect(getActionButton('赏')).toBeInTheDocument()
    expect(getActionButton('藏')).toBeInTheDocument()
    expect(getActionButton('赐')).toBeInTheDocument()
    expect(getActionButton('表')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /阅.*本条已阅/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /打开掌库/ })).not.toBeInTheDocument()
  })

  it('runs an externally requested assistant action through the existing action path', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite'],
      missingTargets: [],
      message: '此折已阅。'
    })

    const { rerender } = render(
      <AssistantOverlay runActionSignal={0} runRequestedAction={undefined} runScript={runScript} />
    )

    rerender(
      <AssistantOverlay runActionSignal={1} runRequestedAction="藏" runScript={runScript} />
    )

    await waitFor(() =>
      expect(runScript).toHaveBeenCalledWith(expect.stringContaining('"action":"藏"'))
    )
  })

  it('asks for coin count before executing 赐', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['like', 'favorite', 'coin:2'],
      missingTargets: [],
      message: '厚赐已成。'
    })
    const onRecordFeedback = vi.fn()

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        onRecordFeedback={onRecordFeedback}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('赐'))

    expect(screen.getByText('陛下意欲赐几枚铜钱？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '赐两枚' }))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain('"coinCount":2')
    expect(onRecordFeedback).toHaveBeenCalledWith('inbox', '赐')
  })

  it('shows progress and result feedback after an action runs', async () => {
    let resolveRunScript: (value: {
      ok: boolean
      steps: string[]
      missingTargets: string[]
      message: string
    }) => void
    const runScript = vi
      .fn()
      .mockImplementationOnce(() =>
        new Promise((resolve) => {
          resolveRunScript = resolve
        })
      )

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        storedPreferences={{
          favoritesFolderName: 'Bilimi 内库',
          favoriteLedgers: [],
          ledgerPromptDismissed: true,
          petStyle: 'big-head',
          petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
          hidePetDuringVideoFullscreen: false,
          bilibiliOperationMode: 'page-visual',
          favoriteArchiveMultiMode: 'off',
          deepseekEnabled: false,
          deepseekApiKeyStored: false,
          deepseekAutoSummaryEnabled: false,
          deepseekModel: 'deepseek-v4-flash',
          deepseekBaseUrl: 'https://api.deepseek.com',
          preferenceCounts: {}
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('赏'))

    expect(screen.getByRole('status')).toHaveTextContent('正在代批')

    resolveRunScript!({
      ok: true,
      steps: ['like', 'favorite'],
      missingTargets: [],
      message: '轻赏已入内库。'
    })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('轻赏已入内库。'))
  })

  it('lets the user confirm create-and-favorite without triggering a like action', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite:open', 'favorite:create-defaults', 'favorite:folder', 'favorite'],
      missingTargets: [],
      message: '已创建并收藏。'
    })
    const onRecordFeedback = vi.fn()

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        onRecordFeedback={onRecordFeedback}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('藏'))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain('"action":"藏"')
    expect(runScript.mock.calls[0][0]).not.toContain('"action":"赏"')
    expect(onRecordFeedback).toHaveBeenCalledWith('inbox', '藏')
  })

  it('classifies the current video content before choosing a Bilimi favorite folder', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite:open', 'favorite:folder', 'favorite'],
      missingTargets: [],
      message: '已按内容归入内库。'
    })
    const onRecordFeedback = vi.fn()

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        onRecordFeedback={onRecordFeedback}
        videoContentContext={{
          title: '三分钟讲清机器学习科普教程',
          pageText: '从原理到入门路线，适合学习收藏。'
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('藏'))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain('"targetLedgerId":"knowledge"')
    expect(runScript.mock.calls[0][0]).toContain('"favoriteLedgers"')
    expect(onRecordFeedback).toHaveBeenCalledWith('knowledge', '藏')
  })

  it('passes a classified custom ledger id to automation and feedback', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite:open', 'favorite:folder', 'favorite'],
      missingTargets: [],
      message: '已按内容归入内库。'
    })
    const onRecordFeedback = vi.fn()

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        onRecordFeedback={onRecordFeedback}
        storedPreferences={{
          favoritesFolderName: 'Bilimi 内库',
          ledgerPromptDismissed: false,
          petStyle: 'big-head',
          petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
          hidePetDuringVideoFullscreen: false,
          bilibiliOperationMode: 'api-assisted',
          favoriteArchiveMultiMode: 'off',
          deepseekEnabled: false,
          deepseekApiKeyStored: false,
          deepseekAutoSummaryEnabled: false,
          deepseekModel: 'deepseek-v4-flash',
          deepseekBaseUrl: 'https://api.deepseek.com',
          preferenceCounts: {},
          favoriteLedgers: [
            {
              id: 'watch-later',
              displayName: 'Bilimi·暂存待阅',
              keywords: ['稍后'],
              enabled: true,
              priority: 1,
              isDefault: false
            }
          ]
        }}
        videoContentContext={{
          title: '稍后仔细看的视频'
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('藏'))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain('"targetLedgerId":"watch-later"')
    expect(runScript.mock.calls[0][0]).not.toContain('"ledgerId"')
    expect(onRecordFeedback).toHaveBeenCalledWith('watch-later', '藏')
  })

  it('minimizes the panel while page automation is running', async () => {
    const runScript = vi.fn(
      () =>
        new Promise<{
          ok: boolean
          steps: string[]
          missingTargets: string[]
          message: string
        }>(() => {})
    )

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('赏'))

    expect(screen.queryByLabelText('案头奏折')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开助手状态' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在代批')
  })

  it('keeps the panel open and explains missing targets when an action cannot finish', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: false,
      steps: ['like'],
      missingTargets: ['favorite'],
      message: '尚有 favorite 未能寻见。'
    })

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('赏'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('尚有 收藏按钮 未能寻见。'))
    expect(screen.getByLabelText('案头奏折')).toBeInTheDocument()
  })

  it('uses page-visual preferences for visual fallback and shows the automation log', async () => {
    const runScript = vi.fn().mockResolvedValueOnce({
      ok: false,
      steps: ['favorite:open'],
      missingTargets: ['favorite-create-button'],
      message: '尚有 favorite-create-button 未能寻见。'
    })
    const runVisualFallback = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['visual:favorite:create'],
      missingTargets: [],
      message: '已用页面点击兜底。'
    })

    render(
      <AssistantOverlay
        runScript={runScript}
        runVisualFallback={runVisualFallback}
        favoritesFolderName="Bilimi 内库"
        storedPreferences={{
          favoritesFolderName: 'Bilimi 内库',
          favoriteLedgers: [],
          ledgerPromptDismissed: true,
          petStyle: 'big-head',
          petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
          hidePetDuringVideoFullscreen: false,
          bilibiliOperationMode: 'page-visual',
          favoriteArchiveMultiMode: 'off',
          deepseekEnabled: false,
          deepseekApiKeyStored: false,
          deepseekAutoSummaryEnabled: false,
          deepseekModel: 'deepseek-v4-flash',
          deepseekBaseUrl: 'https://api.deepseek.com',
          preferenceCounts: {}
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    expect(screen.queryByRole('switch', { name: '仅页面点击' })).not.toBeInTheDocument()

    fireEvent.click(getActionButton('藏'))

    await waitFor(() => expect(runVisualFallback).toHaveBeenCalledOnce())
    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runVisualFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        favoritesFolderName: 'Bilimi 内库'
      }),
      expect.objectContaining({ openWithShortcut: true })
    )
    fireEvent.click(screen.getByRole('button', { name: '展开助手状态' }))
    expect(screen.getByText('执行日志')).toBeInTheDocument()
    expect(screen.getByText('visual:favorite:create')).toBeInTheDocument()
  })

  it('keeps action buttons locked before a coin action is submitted', () => {
    render(<AssistantOverlay favoritesFolderName="Bilimi 内库" />)

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('赐'))

    expect(getActionButton('赏')).toBeDisabled()
    expect(getActionButton('藏')).toBeDisabled()
    expect(getActionButton('赐')).toBeDisabled()
    expect(getActionButton('表')).toBeDisabled()
    expect(screen.getByRole('button', { name: '赐一枚' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '赐两枚' })).toBeEnabled()
  })

  it('cancels comment choices before running a different review action', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite:done'],
      missingTargets: [],
      message: '已归入内库。'
    })

    render(
      <AssistantOverlay
        favoritesFolderName="Bilimi 内库"
        videoContentContext={{
          title: '早八生存实录',
          author: '早八观察员'
        }}
        storedPreferences={createInitialAssistantPreferences({ commentSubmitMode: 'choose' })}
        runScript={runScript}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('表'))

    expect(screen.getByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()
    expect(screen.getAllByRole('button').some((button) => button.textContent?.includes('早八观察员'))).toBe(true)

    fireEvent.click(getActionButton('藏'))

    expect(screen.queryByText('小咪拟好三条，主人点一条就发送。')).not.toBeInTheDocument()
    await waitFor(() => expect(runScript).toHaveBeenCalled())
  })

  it('prevents duplicate coin choice submissions', async () => {
    const runScript = vi.fn(
      () =>
        new Promise<{
          ok: boolean
          steps: string[]
          missingTargets: string[]
          message: string
        }>(() => {})
    )

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('赐'))
    const twoCoinButton = screen.getByRole('button', { name: '赐两枚' })
    fireEvent.click(twoCoinButton)
    fireEvent.click(twoCoinButton)

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
  })

  it('asks the user to choose one memorial-style comment before 表 sends', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['comment:fill', 'comment:submit'],
      missingTargets: [],
      message: '拟表已递。'
    })
    const onRecordFeedback = vi.fn()

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        onRecordFeedback={onRecordFeedback}
        storedPreferences={createInitialAssistantPreferences({ commentSubmitMode: 'choose' })}
        videoContentContext={{
          title: '早八生存实录',
          author: '早八观察员'
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('表'))

    const draft =
      '小咪替我家主人来夸早八观察员的《早八生存实录》：看得很入戏，像不小心点开了快乐开关。UP主请再接再厉，更新更多精彩视频！'

    expect(screen.getByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: draft }))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain(draft)
    expect(onRecordFeedback).toHaveBeenCalledWith('inbox', '表')
  })

  it('publishes the chosen memorial-style comment even when legacy manual comment mode is stored', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['comment:fill', 'comment:submit'],
      missingTargets: [],
      message: '拟表已递。'
    })

    render(
      <AssistantOverlay
        runScript={runScript}
        favoritesFolderName="Bilimi 内库"
        storedPreferences={{
          favoritesFolderName: 'Bilimi 内库',
          favoriteLedgers: [],
          ledgerPromptDismissed: true,
          petStyle: 'big-head',
          petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
          hidePetDuringVideoFullscreen: false,
          bilibiliOperationMode: 'page',
          favoriteArchiveMultiMode: 'off',
          commentSubmitMode: 'manual' as never,
          deepseekEnabled: false,
          deepseekApiKeyStored: false,
          deepseekAutoSummaryEnabled: false,
          deepseekModel: 'deepseek-v4-flash',
          deepseekBaseUrl: 'https://api.deepseek.com',
          preferenceCounts: {}
        }}
        videoContentContext={{
          title: '早八生存实录',
          author: '早八观察员'
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('表'))

    const draft =
      '小咪替我家主人来夸早八观察员的《早八生存实录》：看得很入戏，像不小心点开了快乐开关。UP主请再接再厉，更新更多精彩视频！'
    fireEvent.click(screen.getByRole('button', { name: draft }))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain('"submitComment":true')
  })

  it('randomly publishes one memorial-style comment when random comment mode is stored', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.4)
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['comment:fill', 'comment:submit'],
      missingTargets: [],
      message: '拟表已递。'
    })

    try {
      render(
        <AssistantOverlay
          runScript={runScript}
          favoritesFolderName="Bilimi 内库"
          storedPreferences={{
            favoritesFolderName: 'Bilimi 内库',
            favoriteLedgers: [],
            ledgerPromptDismissed: true,
            petStyle: 'big-head',
            petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
            hidePetDuringVideoFullscreen: false,
            bilibiliOperationMode: 'page-visual',
            favoriteArchiveMultiMode: 'off',
            defaultCoinCount: 1,
            commentSubmitMode: 'random',
            deepseekEnabled: false,
            deepseekApiKeyStored: false,
            deepseekCommentEnabled: false,
            deepseekAutoSummaryEnabled: false,
            deepseekPetChatEnabled: false,
            deepseekModel: 'deepseek-v4-flash',
            deepseekBaseUrl: 'https://api.deepseek.com',
            preferenceCounts: {}
          }}
          videoContentContext={{
            title: '早八生存实录',
            author: '早八观察员'
          }}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
      fireEvent.click(getActionButton('表'))

      await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
      expect(screen.queryByText('小咪拟好三条，主人点一条就发送。')).not.toBeInTheDocument()
      expect(runScript.mock.calls[0][0]).toContain('"submitComment":true')
      expect(runScript.mock.calls[0][0]).toContain('早八生存实录')
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('prompts first-time users to ask 掌库 when enabled ledgers are missing', async () => {
    const readFavoriteLedgerStatus = vi.fn().mockResolvedValue({
      ok: true,
      ledgers: [],
      missingLedgerIds: ['knowledge'],
      message: '册目缺失。'
    })

    render(<AssistantOverlay readFavoriteLedgerStatus={readFavoriteLedgerStatus} />)

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(await screen.findByText('Bilimi 专用册目尚未备齐，可请掌库先行备册。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '请掌库' }))

    expect(screen.getByRole('dialog', { name: '掌库' })).toBeInTheDocument()
  })
})


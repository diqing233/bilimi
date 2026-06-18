import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantOverlay } from './AssistantOverlay'

const ACTION_BUTTON_NAMES = {
  赏: /赏.*轻赏此条/,
  藏: /藏.*归入内库/,
  赐: /赐.*投币厚赏/,
  表: /表.*拟奏短评/,
  阅: /阅.*本条已阅/
} as const

function getActionButton(action: keyof typeof ACTION_BUTTON_NAMES) {
  return screen.getByRole('button', { name: ACTION_BUTTON_NAMES[action] })
}

function getLedgerButton() {
  return screen.getByRole('button', { name: /打开掌库/ })
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
    expect(screen.queryByText('御前待阅折')).not.toBeInTheDocument()
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

      expect(screen.getByText('御前待阅折')).toBeInTheDocument()
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

      expect(screen.getByText('御前待阅折')).toBeInTheDocument()
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
    expect(screen.queryByText('御前待阅折')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
    expect(getActionButton('赏')).toBeInTheDocument()
    expect(getActionButton('藏')).toBeInTheDocument()
    expect(getActionButton('赐')).toBeInTheDocument()
    expect(getActionButton('表')).toBeInTheDocument()
    expect(getActionButton('阅')).toBeInTheDocument()
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

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('尚有 favorite 未能寻见。'))
    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
  })

  it('defaults to page-click-only fallback and shows the automation log', async () => {
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
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByRole('switch', { name: '仅页面点击' })).toBeChecked()

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
    expect(getActionButton('阅')).toBeDisabled()
    expect(getLedgerButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: '赐一枚' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '赐两枚' })).toBeEnabled()
  })

  it('keeps action buttons locked before a comment draft is submitted', () => {
    render(<AssistantOverlay favoritesFolderName="Bilimi 内库" />)

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('表'))

    expect(getActionButton('赏')).toBeDisabled()
    expect(getActionButton('藏')).toBeDisabled()
    expect(getActionButton('赐')).toBeDisabled()
    expect(getActionButton('表')).toBeDisabled()
    expect(getActionButton('阅')).toBeDisabled()
    expect(getLedgerButton()).toBeDisabled()
    expect(screen.getAllByRole('button').some((button) => button.textContent?.includes('亲览'))).toBe(true)
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
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getActionButton('表'))

    const draft = '《早八生存实录》铺陈渐稳，臣不敢泄机，谨请陛下亲览。'

    expect(screen.getByText('臣已拟好三条，请陛下择其一。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: draft }))

    await waitFor(() => expect(runScript).toHaveBeenCalledOnce())
    expect(runScript.mock.calls[0][0]).toContain(draft)
    expect(onRecordFeedback).toHaveBeenCalledWith('inbox', '表')
  })

  it('opens ledger panel from the memorial panel', () => {
    render(<AssistantOverlay />)

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(getLedgerButton())

    expect(screen.getByRole('dialog', { name: '掌库' })).toBeInTheDocument()
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


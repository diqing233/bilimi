import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialAssistantPreferences } from '../state/assistantState'

let ledgerRenderCount = 0
let settingsRenderCount = 0
const deepSeekTaskSignal = vi.hoisted(() => ({
  listener: undefined as undefined | ((tasks: Array<{ id: string; kind: string }>) => void)
}))

vi.mock('./ControlledFavoriteLedgerPanel', () => ({
  ControlledFavoriteLedgerPanel: () => {
    ledgerRenderCount += 1
    return <div aria-label="掌库渲染探针" />
  }
}))

vi.mock('./PanelMotionTuningSettings', () => ({
  PanelMotionTuningSettings: () => {
    settingsRenderCount += 1
    return <div aria-label="设置渲染探针" />
  }
}))

vi.mock('./deepSeekTaskSignal', () => ({
  publishDeepSeekTask: vi.fn(() => vi.fn()),
  subscribeDeepSeekTasks: vi.fn((listener: (tasks: Array<{ id: string; kind: string }>) => void) => {
    deepSeekTaskSignal.listener = listener
    return vi.fn()
  })
}))

vi.mock('./MemorialPanel', () => ({
  MemorialPanel: ({ initialTab }: { initialTab: 'review' | 'notes' }) => (
    <div aria-label={initialTab === 'notes' ? '札记渲染探针' : '批阅渲染探针'} />
  )
}))
vi.mock('../notes/VideoNoteArchivePanel', () => ({ VideoNoteArchivePanel: () => null }))

import { FloatingAssistantApp } from './FloatingAssistantApp'

function installDesktopApi(preferences = createInitialAssistantPreferences()) {
  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: {
      version: '0.1.0',
      requestAssistantSnapshot: vi.fn(async () => ({
        accountMid: '100',
        preferences,
        favoriteLedgerStatus: null,
        videoContentContext: { title: 'Current video' },
        videoTitle: 'Current video',
        activeTabUrl: ''
      })),
      loadVideoNoteArchives: vi.fn(async () => []),
      loadVideoAudioTranscriptionQueue: vi.fn(async () => ({ items: [], sessionCompletedCount: 0 })),
      loadTranscriptionModels: vi.fn(async () => []),
      loadCurrentTranscriptionModelInstallProgress: vi.fn(async () => undefined),
      onAssistantSnapshotChanged: vi.fn(() => vi.fn()),
      onAssistantPreferencesChanged: vi.fn(() => vi.fn()),
      onAssistantPreferencePatchChanged: vi.fn(() => vi.fn()),
      onFavoriteLedgerEnabledChanged: vi.fn(() => vi.fn()),
      onBilibiliAccountChanged: vi.fn(() => vi.fn()),
      onVideoAudioTranscriptionQueueChanged: vi.fn(() => vi.fn()),
      onTranscriptionModelInstallProgress: vi.fn(() => vi.fn()),
      getLocalDataInfo: vi.fn(async () => ({ path: 'C:\\test\\bilimi', accounts: [] })),
      setAssistantPetHint: vi.fn()
    }
  })
}

describe('FloatingAssistantApp render isolation', () => {
  beforeEach(() => {
    ledgerRenderCount = 0
    settingsRenderCount = 0
    deepSeekTaskSignal.listener = undefined
    installDesktopApi()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'bilimiDesktop')
  })

  it('does not rerender an opened ledger workspace when switching to Settings', async () => {
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '掌库' }))
    await screen.findByLabelText('掌库渲染探针')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const rendersBeforeSwitch = ledgerRenderCount

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(ledgerRenderCount).toBe(rendersBeforeSwitch)
  })

  it('does not rerender an opened settings workspace while switching tabs', async () => {
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await screen.findByLabelText('设置渲染探针')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const rendersBeforeSwitch = settingsRenderCount

    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))
    await screen.findByLabelText('掌库渲染探针')
    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(settingsRenderCount).toBe(rendersBeforeSwitch)
  })

  it('keeps the active tab and workspace visibility synchronized across all four tabs', async () => {
    render(<FloatingAssistantApp mode="sidebar" />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByLabelText('批阅渲染探针')

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    const settingsWorkspace = await screen.findByLabelText('助手设置')
    expect(screen.getByRole('tab', { name: '设置' })).toHaveAttribute('aria-selected', 'true')
    expect(settingsWorkspace).not.toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))
    const ledgerProbe = await screen.findByLabelText('掌库渲染探针')
    expect(screen.getByRole('tab', { name: '掌库' })).toHaveAttribute('aria-selected', 'true')
    expect(ledgerProbe.closest('.floating-assistant-view')).not.toHaveAttribute('hidden')
    expect(settingsWorkspace).toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('tab', { name: '札记' }))
    expect(screen.getByRole('tab', { name: '札记' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByLabelText('札记渲染探针')
    expect(settingsWorkspace).toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('tab', { name: '批阅' }))
    expect(screen.getByRole('tab', { name: '批阅' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByLabelText('批阅渲染探针')
    expect(settingsWorkspace).toHaveAttribute('hidden')
  })

  it('does not rerender settings for an unrelated DeepSeek task update', async () => {
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await screen.findByLabelText('设置渲染探针')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const rendersBeforeTaskUpdate = settingsRenderCount

    act(() => {
      deepSeekTaskSignal.listener?.([{ id: 'summary:background', kind: 'summary' }])
    })

    expect(settingsRenderCount).toBe(rendersBeforeTaskUpdate)
  })

  it('updates only the DeepSeek connection controls for a connection test task', async () => {
    installDesktopApi(createInitialAssistantPreferences({ deepseekEnabled: true }))
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await screen.findByLabelText('设置渲染探针')

    act(() => {
      deepSeekTaskSignal.listener?.([{ id: 'connection:active', kind: 'connection-test' }])
    })

    expect(screen.getByRole('button', { name: '保存测试中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重置 DeepSeek' })).toBeDisabled()

    act(() => {
      deepSeekTaskSignal.listener?.([])
    })

    expect(screen.getByRole('button', { name: '保存并测试' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重置 DeepSeek' })).toBeEnabled()
  })
})

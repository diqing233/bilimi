import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialAssistantPreferences } from '../state/assistantState'

let ledgerRenderCount = 0
let settingsRenderCount = 0
const deepSeekTaskSignal = vi.hoisted(() => ({
  listeners: new Set<(tasks: Array<{ id: string; kind: string }>) => void>(),
  localListeners: new Set<() => void>(),
  localTasks: [] as Array<{ id: string; kind: string }>
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
  publishDeepSeekTask: vi.fn((task: { id: string; kind: string }) => {
    deepSeekTaskSignal.localTasks = [
      ...deepSeekTaskSignal.localTasks.filter((current) => current.id !== task.id),
      task
    ]
    deepSeekTaskSignal.localListeners.forEach((listener) => listener())
    return vi.fn(() => {
      deepSeekTaskSignal.localTasks = deepSeekTaskSignal.localTasks.filter((current) => current.id !== task.id)
      deepSeekTaskSignal.localListeners.forEach((listener) => listener())
    })
  }),
  startLocalDeepSeekTask: vi.fn((task: { id: string; kind: string }) => {
    deepSeekTaskSignal.localTasks = [
      ...deepSeekTaskSignal.localTasks.filter((current) => current.id !== task.id),
      task
    ]
    deepSeekTaskSignal.localListeners.forEach((listener) => listener())
    return vi.fn(() => {
      deepSeekTaskSignal.localTasks = deepSeekTaskSignal.localTasks.filter((current) => current.id !== task.id)
      deepSeekTaskSignal.localListeners.forEach((listener) => listener())
    })
  }),
  subscribeLocalDeepSeekTasks: vi.fn((listener: () => void) => {
    deepSeekTaskSignal.localListeners.add(listener)
    return vi.fn(() => deepSeekTaskSignal.localListeners.delete(listener))
  }),
  getLocalDeepSeekTasks: vi.fn(() => deepSeekTaskSignal.localTasks),
  subscribeDeepSeekTasks: vi.fn((listener: (tasks: Array<{ id: string; kind: string }>) => void) => {
    deepSeekTaskSignal.listeners.add(listener)
    return vi.fn(() => deepSeekTaskSignal.listeners.delete(listener))
  })
}))

vi.mock('./MemorialPanel', () => ({
  MemorialPanel: ({ initialTab }: { initialTab: 'review' | 'notes' }) => (
    <div aria-label={initialTab === 'notes' ? '札记渲染探针' : '批阅渲染探针'} />
  )
}))
vi.mock('../notes/VideoNoteArchivePanel', () => ({ VideoNoteArchivePanel: () => null }))

import { FloatingAssistantApp } from './FloatingAssistantApp'

function installDesktopApi(preferences = createInitialAssistantPreferences(), patch: Record<string, unknown> = {}) {
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
      setAssistantPetHint: vi.fn(),
      ...patch
    }
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function publishDeepSeekTasks(tasks: Array<{ id: string; kind: string }>) {
  deepSeekTaskSignal.listeners.forEach((listener) => listener(tasks))
}

describe('FloatingAssistantApp render isolation', () => {
  beforeEach(() => {
    ledgerRenderCount = 0
    settingsRenderCount = 0
    deepSeekTaskSignal.listeners.clear()
    deepSeekTaskSignal.localListeners.clear()
    deepSeekTaskSignal.localTasks = []
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
      publishDeepSeekTasks([{ id: 'summary:background', kind: 'summary' }])
    })

    expect(settingsRenderCount).toBe(rendersBeforeTaskUpdate)
  })

  it('updates only the DeepSeek connection controls for a connection test task', async () => {
    installDesktopApi(createInitialAssistantPreferences({ deepseekEnabled: true }))
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await screen.findByLabelText('设置渲染探针')

    act(() => {
      publishDeepSeekTasks([{ id: 'connection:active', kind: 'connection-test' }])
    })

    expect(screen.getByRole('button', { name: '保存测试中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重置 DeepSeek' })).toBeDisabled()

    act(() => {
      publishDeepSeekTasks([])
    })

    expect(screen.getByRole('button', { name: '保存并测试' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重置 DeepSeek' })).toBeEnabled()
  })

  it('does not rerender the settings workspace while a manual DeepSeek test is pending', async () => {
    const result = deferred<{ ok: boolean; message: string }>()
    installDesktopApi(createInitialAssistantPreferences({ deepseekEnabled: true }), {
      testDeepSeekConnection: vi.fn(() => result.promise),
      patchPreferences: vi.fn(async (patch) => createInitialAssistantPreferences({
        deepseekEnabled: true,
        ...patch
      }))
    })
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await screen.findByLabelText('设置渲染探针')
    const rendersBeforeClick = settingsRenderCount

    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    expect(await screen.findByRole('button', { name: '保存测试中' })).toBeDisabled()
    expect(settingsRenderCount).toBe(rendersBeforeClick)

    await act(async () => {
      result.resolve({ ok: true, message: 'DeepSeek connection succeeded.' })
      await result.promise
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '保存并测试' })).toBeEnabled())
    expect(settingsRenderCount).toBe(rendersBeforeClick)
  })

  it('does not rerender the settings workspace while diagnostics are pending', async () => {
    const result = deferred<{ ok: boolean; items: [] }>()
    installDesktopApi(createInitialAssistantPreferences(), {
      runStartupDiagnostics: vi.fn(() => result.promise)
    })
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await screen.findByLabelText('设置渲染探针')
    const rendersBeforeClick = settingsRenderCount

    fireEvent.click(screen.getByRole('button', { name: '运行诊断' }))

    expect(await screen.findByRole('button', { name: '诊断中' })).toBeDisabled()
    expect(settingsRenderCount).toBe(rendersBeforeClick)

    await act(async () => {
      result.resolve({ ok: true, items: [] })
      await result.promise
    })
    expect(await screen.findByRole('button', { name: '运行诊断' })).toBeEnabled()
    expect(settingsRenderCount).toBe(rendersBeforeClick)
  })

  it('updates the default favorite toggle without rerendering the settings workspace', async () => {
    const reclassification = deferred<unknown>()
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] }
      }
    })
    installDesktopApi(preferences, {
      writeDefaultFavoriteSystemEnabled: vi.fn(async () => false),
      patchPreferences: vi.fn(async (patch) => createInitialAssistantPreferences({ ...preferences, ...patch })),
      commandOldFavoriteWorkspaceV1: vi.fn(() => reclassification.promise)
    })
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await screen.findByLabelText('设置渲染探针')
    const rendersBeforeClick = settingsRenderCount
    const toggle = screen.getByRole('checkbox', { name: '启用默认收藏夹' })

    fireEvent.click(toggle)

    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(settingsRenderCount).toBe(rendersBeforeClick)

    await act(async () => {
      reclassification.resolve(undefined)
      await reclassification.promise
    })
    expect(settingsRenderCount).toBe(rendersBeforeClick)
  })

  it('updates the Bilibili connection choice without rerendering the settings workspace', async () => {
    const saved = deferred<ReturnType<typeof createInitialAssistantPreferences>>()
    const preferences = createInitialAssistantPreferences({ bilibiliConnectionMode: 'auto' })
    installDesktopApi(preferences, {
      patchPreferences: vi.fn(() => saved.promise)
    })
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await screen.findByLabelText('设置渲染探针')
    const rendersBeforeClick = settingsRenderCount
    const direct = screen.getByRole('radio', { name: /始终直连/ })

    fireEvent.click(direct)

    await waitFor(() => expect(direct).toBeChecked())
    expect(settingsRenderCount).toBe(rendersBeforeClick)

    await act(async () => {
      saved.resolve(createInitialAssistantPreferences({ bilibiliConnectionMode: 'direct' }))
      await saved.promise
    })
    expect(settingsRenderCount).toBe(rendersBeforeClick)
  })

  it('shows only the pet wake action as busy while the ready signal is pending', async () => {
    let resolveWake: (() => void) | undefined
    const wakeAssistantPet = vi.fn(() => new Promise<void>((resolve) => { resolveWake = resolve }))
    installDesktopApi(createInitialAssistantPreferences(), { wakeAssistantPet })
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(await screen.findByRole('button', { name: '唤醒宠物' }))

    expect(screen.getByRole('button', { name: '正在唤醒…' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: '掌库' })).toBeEnabled()
    expect(wakeAssistantPet).toHaveBeenCalledOnce()

    await act(async () => { resolveWake?.(); await Promise.resolve() })
    expect(screen.getByRole('button', { name: '唤醒宠物' })).toBeEnabled()
  })
})

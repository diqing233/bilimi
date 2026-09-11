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
  ControlledFavoriteLedgerPanel: ({
    onFavoriteLibraryOpened,
    remoteDiscoveryNoticeDismissed,
    onDismissRemoteDiscoveryNotice
  }: {
    onFavoriteLibraryOpened?: () => void
    remoteDiscoveryNoticeDismissed?: boolean
    onDismissRemoteDiscoveryNotice?: () => void
  }) => {
    ledgerRenderCount += 1
    return <div aria-label="掌库渲染探针">
      <button type="button" onClick={onFavoriteLibraryOpened}>模拟打开收藏库</button>
      <span data-testid="remote-discovery-dismissed">{remoteDiscoveryNoticeDismissed ? 'hidden' : 'visible'}</span>
      <button type="button" onClick={onDismissRemoteDiscoveryNotice}>暂不提醒</button>
    </div>
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

  it('shows automatic pet startup enabled by default and persists an explicit opt-out', async () => {
    const patchPreferences = vi.fn(async (patch: Record<string, unknown>) => patch)
    installDesktopApi(createInitialAssistantPreferences(), { patchPreferences })
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    const toggle = await screen.findByRole('checkbox', { name: '应用启动时自动唤醒小咪' })

    expect(toggle).toBeChecked()
    fireEvent.click(toggle)

    await waitFor(() => expect(patchPreferences).toHaveBeenCalledWith({ autoShowPetOnStartup: false }))
  })

  it('publishes approved guidance to the global prompt and pet only for a changed top-level tab', async () => {
    const setAssistantPetHint = vi.fn()
    installDesktopApi(createInitialAssistantPreferences(), { setAssistantPetHint })
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))

    await waitFor(() => expect(screen.getByLabelText('全局提示')).toHaveTextContent(
      '札记：通过转写音频输出视频文稿；建议在设置页下载并启用识别率更高的转写模型。启用 DeepSeek 后可总结笔记。'
    ))
    expect(setAssistantPetHint).toHaveBeenLastCalledWith({
      tone: 'happy',
      message: '小咪切到札记啦，点击转写音频就能输出视频文稿，还可以用 DeepSeek 总结笔记哦～'
    })

    const callsAfterChange = setAssistantPetHint.mock.calls.length
    fireEvent.click(screen.getByRole('tab', { name: '札记' }))
    expect(setAssistantPetHint).toHaveBeenCalledTimes(callsAfterChange)
  })

  it('replaces archive loading feedback with archive guidance after an explicit archive request succeeds', async () => {
    let openWorkspace: ((payload: { tab: 'notes'; openNoteArchive: true }) => void) | undefined
    const setAssistantPetHint = vi.fn()
    installDesktopApi(createInitialAssistantPreferences(), {
      setAssistantPetHint,
      onOpenFloatingAssistantWorkspace: vi.fn((callback) => {
        openWorkspace = callback
        return vi.fn()
      })
    })
    render(<FloatingAssistantApp mode="sidebar" />)

    await waitFor(() => expect(openWorkspace).toBeTypeOf('function'))
    act(() => openWorkspace?.({ tab: 'notes', openNoteArchive: true }))

    await waitFor(() => expect(screen.getByLabelText('全局提示')).toHaveTextContent(
      '档案库：可以查看已转写成功的视频文稿，支持搜索、备注和批量导出。'
    ))
    expect(setAssistantPetHint).toHaveBeenLastCalledWith({
      tone: 'happy',
      message: '主人，档案库已经打开啦，想看整理好的文稿，随时来找小咪哦～'
    })
  })

  it('adds only the global review guidance when the floating assistant opens on its default tab', async () => {
    let openWorkspace: ((payload: { tab: 'review' }) => void) | undefined
    const setAssistantPetHint = vi.fn()
    installDesktopApi(createInitialAssistantPreferences(), {
      setAssistantPetHint,
      onOpenFloatingAssistantWorkspace: vi.fn((callback) => {
        openWorkspace = callback
        return vi.fn()
      })
    })
    render(<FloatingAssistantApp mode="floating" />)

    await waitFor(() => expect(openWorkspace).toBeTypeOf('function'))
    const petHintsBeforeOpen = setAssistantPetHint.mock.calls.length
    act(() => openWorkspace?.({ tab: 'review' }))

    await waitFor(() => expect(screen.getByLabelText('全局提示')).toHaveTextContent(
      '批阅：可以一键三连、自动分类收藏（需先在掌库完成备册），发送弹幕（建议开启 DeepSeek 生成）。'
    ))
    expect(setAssistantPetHint).toHaveBeenCalledTimes(petHintsBeforeOpen)
  })

  it('publishes local favorite-library guidance when the ledger panel confirms opening', async () => {
    const setAssistantPetHint = vi.fn()
    installDesktopApi(createInitialAssistantPreferences(), { setAssistantPetHint })
    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('tab', { name: '掌库' }))
    fireEvent.click(await screen.findByRole('button', { name: '模拟打开收藏库' }))

    await waitFor(() => expect(screen.getByLabelText('全局提示')).toHaveTextContent(
      '收藏库：bilimi 本地收藏库，支持批量管理所有已整理的视频。'
    ))
    expect(setAssistantPetHint).toHaveBeenLastCalledWith({
      tone: 'happy',
      message: '主人，收藏库已经打开啦，快看看小咪整理得怎么样呀！'
    })
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

  it('updates the global DeepSeek status when the saved-key patch arrives without a full preference reload', async () => {
    let emitPreferencePatch: Parameters<NonNullable<Window['bilimiDesktop']['onAssistantPreferencePatchChanged']>>[0] | undefined
    const preferences = createInitialAssistantPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: false,
      deepseekArchiveOrganizationEnabled: true
    })
    installDesktopApi(preferences, {
      onAssistantPreferencePatchChanged: vi.fn((callback) => {
        emitPreferencePatch = callback
        return () => {}
      })
    })

    render(<FloatingAssistantApp mode="sidebar" />)
    expect(await screen.findByText('DeepSeek 待配置')).toBeInTheDocument()

    act(() => {
      emitPreferencePatch?.({ deepseekApiKeyStored: true })
    })

    await waitFor(() => expect(screen.getByText('DeepSeek 待测试')).toBeInTheDocument())
  })

  it('hides the discovery notice immediately when dismissed from the ledger workspace', async () => {
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: createInitialAssistantPreferences().favoriteLedgers
        }
      }
    })
    const patchPreferences = vi.fn(async (patch: Record<string, unknown>) =>
      createInitialAssistantPreferences({ ...preferences, ...patch })
    )
    installDesktopApi(preferences, { patchPreferences })

    render(<FloatingAssistantApp mode="sidebar" />)
    fireEvent.click(await screen.findByRole('tab', { name: '掌库' }))

    expect(await screen.findByTestId('remote-discovery-dismissed')).toHaveTextContent('visible')
    fireEvent.click(screen.getByRole('button', { name: '暂不提醒' }))

    await waitFor(() => expect(screen.getByTestId('remote-discovery-dismissed')).toHaveTextContent('hidden'))
    await waitFor(() => expect(patchPreferences).toHaveBeenCalledWith(expect.objectContaining({
      favoriteAccountPreferences: expect.objectContaining({
        '100': expect.objectContaining({ favoriteDiscoveryNoticeDismissed: true })
      })
    })))
  })

  it('reconciles the global DeepSeek status with the persisted key status on startup', async () => {
    const preferences = createInitialAssistantPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: false,
      deepseekArchiveOrganizationEnabled: true
    })
    installDesktopApi(preferences, {
      loadDeepSeekApiKeyStatus: vi.fn(async () => ({ configured: true, protection: 'encrypted' }))
    })

    render(<FloatingAssistantApp mode="sidebar" />)

    await waitFor(() => expect(screen.getByText('DeepSeek 待测试')).toBeInTheDocument())
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
    const direct = screen.getByRole('radio', { name: /直接连接 B 站/ })

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

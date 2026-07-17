import { afterEach, describe, expect, it, vi } from 'vitest'

describe('oldFavoriteRuntimeSession', () => {
  it('keeps large workspace snapshots in renderer memory instead of synchronous main runtime IPC', async () => {
    const setMain = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        getOldFavoriteRuntimeSnapshot: vi.fn(),
        setOldFavoriteRuntimeValue: setMain
      }
    })
    const session = await import('./oldFavoriteRuntimeSession')

    session.setOldFavoriteRuntimeValue('preview', { items: [{ aid: 1 }] })
    session.setOldFavoriteRuntimeValue('baseScanPreview', { items: [{ aid: 1 }] })
    session.setOldFavoriteRuntimeValue('archiveEditorState', { archivePlanState: { items: [] } })
    session.setOldFavoriteRuntimeValue('oldFavoriteUserBatches', [{ id: 'batch-1' }])

    expect(setMain).not.toHaveBeenCalled()
    expect(session.getOldFavoriteRuntimeValue<any>('preview', null).items[0].aid).toBe(1)
  })

  const originalDesktopApi = Object.getOwnPropertyDescriptor(window, 'bilimiDesktop')

  afterEach(async () => {
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
    if (originalDesktopApi) {
      Object.defineProperty(window, 'bilimiDesktop', originalDesktopApi)
    } else {
      delete window.bilimiDesktop
    }
  })

  it('reuses the same store after the module is reloaded', async () => {
    const first = await import('./oldFavoriteRuntimeSession')
    first.resetOldFavoriteRuntimeSession()
    first.setOldFavoriteRuntimeValue('deepSeekArchiveStatus', 'DeepSeek 正在整理旧藏...')

    vi.resetModules()

    const reloaded = await import('./oldFavoriteRuntimeSession')
    expect(reloaded.getOldFavoriteRuntimeValue('deepSeekArchiveStatus', '')).toBe(
      'DeepSeek 正在整理旧藏...'
    )
  })

  it('clears a session when the account changes', async () => {
    const session = await import('./oldFavoriteRuntimeSession')
    const feedbackHandler = vi.fn()
    session.resetOldFavoriteRuntimeSession()

    session.registerOldFavoriteRuntimeHandler('feedback', feedbackHandler)
    expect(session.bindOldFavoriteRuntimeAccount('42')).toBe(false)
    session.setOldFavoriteRuntimeValue('preview', { items: [] })

    expect(session.bindOldFavoriteRuntimeAccount('99')).toBe(true)
    expect(session.getOldFavoriteRuntimeValue('preview', null)).toBeNull()
    session.invokeOldFavoriteRuntimeHandler('feedback', '新账户扫描完成')
    expect(feedbackHandler).toHaveBeenCalledWith('新账户扫描完成')
  })

  it('clears visible account state when the user logs out', async () => {
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: { bindOldFavoriteRuntimeAccount: vi.fn().mockReturnValue(true) }
    })
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
    session.bindOldFavoriteRuntimeAccount('42')
    session.setOldFavoriteRuntimeValue('preview', { items: [{ aid: 1 }] })

    expect(session.bindOldFavoriteRuntimeAccount('')).toBe(true)
    expect(session.getOldFavoriteRuntimeValue('preview', null)).toBeNull()
  })

  it('keeps the latest handler when a stale registration is cleaned up', async () => {
    const session = await import('./oldFavoriteRuntimeSession')
    const firstHandler = vi.fn()
    const latestHandler = vi.fn()

    const cleanUpFirst = session.registerOldFavoriteRuntimeHandler('feedback', firstHandler)
    session.registerOldFavoriteRuntimeHandler('feedback', latestHandler)
    cleanUpFirst()
    session.invokeOldFavoriteRuntimeHandler('feedback', '整理完成')

    expect(firstHandler).not.toHaveBeenCalled()
    expect(latestHandler).toHaveBeenCalledOnce()
    expect(latestHandler).toHaveBeenCalledWith('整理完成')
  })

  it('keeps small runtime writes in renderer memory without consulting the main process', async () => {
    const setOldFavoriteRuntimeValue = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        getOldFavoriteRuntimeSnapshot: vi.fn().mockReturnValue({
          key: 'deepSeekArchiveRunning',
          revision: 0,
          value: false,
          accountMid: '42'
        }),
        setOldFavoriteRuntimeValue
      }
    })
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
    expect(session.getOldFavoriteRuntimeValue('deepSeekArchiveRunning', false)).toBe(false)

    expect(session.setOldFavoriteRuntimeValue('deepSeekArchiveRunning', true)).toBe(true)
    expect(session.getOldFavoriteRuntimeValue('deepSeekArchiveRunning', false)).toBe(true)
    expect(setOldFavoriteRuntimeValue).not.toHaveBeenCalled()
  })

  it('keeps global DeepSeek connection state when the account binding resets old favorites', async () => {
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        bindOldFavoriteRuntimeAccount: vi.fn()
      }
    })
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
    session.setOldFavoriteRuntimeValue('deepSeekConnectionStatus', 'connected')
    session.setOldFavoriteRuntimeValue('oldFavoriteRuntimeStatus', {
      label: '旧藏待整理 3'
    })

    expect(session.bindOldFavoriteRuntimeAccount('42')).toBe(false)
    expect(session.bindOldFavoriteRuntimeAccount('99')).toBe(true)
    expect(session.getOldFavoriteRuntimeValue('deepSeekConnectionStatus', 'pending')).toBe(
      'connected'
    )
    expect(session.getOldFavoriteRuntimeValue('oldFavoriteRuntimeStatus', null)).toBeNull()
  })

  it('keeps global DeepSeek connection state when another window broadcasts an account reset', async () => {
    let runtimeChanged: Parameters<
      NonNullable<Window['bilimiDesktop']['onOldFavoriteRuntimeChanged']>
    >[0] | undefined
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        onOldFavoriteRuntimeChanged: vi.fn((callback) => {
          runtimeChanged = callback
          return vi.fn()
        })
      }
    })
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
    session.setOldFavoriteRuntimeValue('deepSeekConnectionStatus', 'connected')
    session.setOldFavoriteRuntimeValue('oldFavoriteRuntimeStatus', {
      label: '旧藏待整理 3'
    })

    runtimeChanged?.({ type: 'reset', accountMid: '99' })

    expect(session.getOldFavoriteRuntimeValue('deepSeekConnectionStatus', 'pending')).toBe(
      'connected'
    )
    expect(session.getOldFavoriteRuntimeValue('oldFavoriteRuntimeStatus', null)).toBeNull()
  })

  it('notifies only listeners subscribed to the changed runtime key', async () => {
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
    const previewListener = vi.fn()
    const progressListener = vi.fn()
    session.subscribeOldFavoriteRuntimeKey('preview', previewListener)
    session.subscribeOldFavoriteRuntimeKey('scanProgress', progressListener)

    session.setOldFavoriteRuntimeValue('scanProgress', { completed: 26 })

    expect(progressListener).toHaveBeenCalledOnce()
    expect(previewListener).not.toHaveBeenCalled()
  })

  it('notifies every key subscriber when the runtime is reset', async () => {
    const session = await import('./oldFavoriteRuntimeSession')
    const previewListener = vi.fn()
    const progressListener = vi.fn()
    session.subscribeOldFavoriteRuntimeKey('preview', previewListener)
    session.subscribeOldFavoriteRuntimeKey('scanProgress', progressListener)

    session.resetOldFavoriteRuntimeSession()

    expect(previewListener).toHaveBeenCalledOnce()
    expect(progressListener).toHaveBeenCalledOnce()
  })

  it('detaches reset subscribers so later tests and remounts cannot receive stale updates', async () => {
    const session = await import('./oldFavoriteRuntimeSession')
    const listener = vi.fn()
    session.subscribeOldFavoriteRuntimeKey('preview', listener)

    session.resetOldFavoriteRuntimeSession()
    session.setOldFavoriteRuntimeValue('preview', { items: [{ aid: 1 }] })

    expect(listener).toHaveBeenCalledOnce()
  })

  it('unsubscribes the old desktop bridge and can attach to a replacement after reset', async () => {
    const firstUnsubscribe = vi.fn()
    const firstSubscribe = vi.fn().mockReturnValue(firstUnsubscribe)
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: { onOldFavoriteRuntimeChanged: firstSubscribe }
    })
    const session = await import('./oldFavoriteRuntimeSession')
    session.getOldFavoriteRuntimeValue('preview', null)

    session.resetOldFavoriteRuntimeSession()
    const secondSubscribe = vi.fn().mockReturnValue(vi.fn())
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: { onOldFavoriteRuntimeChanged: secondSubscribe }
    })
    session.getOldFavoriteRuntimeValue('preview', null)

    expect(firstUnsubscribe).toHaveBeenCalledOnce()
    expect(secondSubscribe).toHaveBeenCalledOnce()
  })

  it('sends lightweight progress through the async transient bridge without writing preview', async () => {
    const setTransient = vi.fn().mockResolvedValue({
      key: 'scanProgress', revision: 1, value: { completed: 26 }, accountMid: '42', accepted: true
    })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: { setOldFavoriteRuntimeTransientValue: setTransient }
    })
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()

    session.setOldFavoriteTransientRuntimeValue('scanProgress', { completed: 26 })
    await Promise.resolve()

    expect(setTransient).toHaveBeenCalledWith('scanProgress', { completed: 26 }, 0)
    expect(session.getOldFavoriteRuntimeValue('scanProgress', null)).toEqual({ completed: 26 })
  })
})

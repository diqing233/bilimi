import { afterEach, describe, expect, it, vi } from 'vitest'

describe('oldFavoriteRuntimeSession', () => {
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

  it('returns false and refreshes local state when the main process rejects a stale write', async () => {
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        getOldFavoriteRuntimeSnapshot: vi.fn().mockReturnValue({
          key: 'deepSeekArchiveRunning',
          revision: 0,
          value: false,
          accountMid: '42'
        }),
        setOldFavoriteRuntimeValue: vi.fn().mockReturnValue({
          key: 'deepSeekArchiveRunning',
          revision: 1,
          value: true,
          accountMid: '42',
          accepted: false
        })
      }
    })
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
    expect(session.getOldFavoriteRuntimeValue('deepSeekArchiveRunning', false)).toBe(false)

    expect(session.setOldFavoriteRuntimeValue('deepSeekArchiveRunning', true)).toBe(false)
    expect(session.getOldFavoriteRuntimeValue('deepSeekArchiveRunning', false)).toBe(true)
  })

  it('keeps global DeepSeek connection state when the account binding resets old favorites', async () => {
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        bindOldFavoriteRuntimeAccount: vi.fn().mockReturnValue(true)
      }
    })
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
    session.setOldFavoriteRuntimeValue('deepSeekConnectionStatus', 'connected')
    session.setOldFavoriteRuntimeValue('oldFavoriteRuntimeStatus', {
      label: '旧藏待整理 3'
    })

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
})

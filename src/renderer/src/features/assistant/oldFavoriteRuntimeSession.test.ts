import { afterEach, describe, expect, it, vi } from 'vitest'

describe('oldFavoriteRuntimeSession', () => {
  afterEach(async () => {
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
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
})

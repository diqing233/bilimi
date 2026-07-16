import { describe, expect, it, vi } from 'vitest'
import { BilibiliSessionProxy } from './bilibiliSessionProxy'

describe('BilibiliSessionProxy', () => {
  it('follows the system network settings until the user explicitly retries direct', async () => {
    const session = { setProxy: vi.fn().mockResolvedValue(undefined) }
    const proxy = new BilibiliSessionProxy(() => session)

    expect(proxy.snapshot()).toEqual({ mode: 'system' })
    expect(session.setProxy).not.toHaveBeenCalled()

    await proxy.retryDirect()

    expect(session.setProxy).toHaveBeenCalledOnce()
    expect(session.setProxy).toHaveBeenCalledWith({ mode: 'direct' })
    expect(proxy.snapshot()).toEqual({ mode: 'direct' })
  })

  it('shares one direct mode across tabs in the Bilibili partition', async () => {
    const session = { setProxy: vi.fn().mockResolvedValue(undefined) }
    const getBilibiliSession = vi.fn(() => session)
    const proxy = new BilibiliSessionProxy(getBilibiliSession)

    await proxy.retryDirect()
    await proxy.retryDirect()

    expect(getBilibiliSession).toHaveBeenCalledOnce()
    expect(session.setProxy).toHaveBeenCalledOnce()
  })

  it('starts in system mode again after an application restart', async () => {
    const session = { setProxy: vi.fn().mockResolvedValue(undefined) }
    const firstRun = new BilibiliSessionProxy(() => session)
    await firstRun.retryDirect()

    const restartedRun = new BilibiliSessionProxy(() => session)

    expect(restartedRun.snapshot()).toEqual({ mode: 'system' })
  })
})

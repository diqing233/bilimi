import { describe, expect, it, vi } from 'vitest'
import { BilibiliSessionProxy } from './bilibiliSessionProxy'

describe('BilibiliSessionProxy', () => {
  it('applies auto as Electron system proxy mode and closes old pooled connections', async () => {
    const session = { setProxy: vi.fn().mockResolvedValue(undefined), closeAllConnections: vi.fn().mockResolvedValue(undefined) }
    const proxy = new BilibiliSessionProxy(() => session)

    expect(proxy.snapshot()).toEqual({ mode: 'auto', effectiveMode: 'system', temporaryDirect: false })

    await proxy.applyPreference('auto')

    expect(session.setProxy).toHaveBeenCalledWith({ mode: 'system' })
    expect(session.closeAllConnections).toHaveBeenCalledOnce()
    expect(proxy.snapshot()).toEqual({ mode: 'auto', effectiveMode: 'system', temporaryDirect: false })
  })

  it('keeps a durable direct preference separate from a one-time direct retry', async () => {
    const session = { setProxy: vi.fn().mockResolvedValue(undefined), closeAllConnections: vi.fn().mockResolvedValue(undefined) }
    const proxy = new BilibiliSessionProxy(() => session)

    await proxy.applyPreference('auto')
    await proxy.retryDirect()

    expect(session.setProxy).toHaveBeenLastCalledWith({ mode: 'direct' })
    expect(proxy.snapshot()).toEqual({ mode: 'auto', effectiveMode: 'direct', temporaryDirect: true })
  })

  it('clears a one-time direct retry when the user explicitly reapplies auto', async () => {
    const session = { setProxy: vi.fn().mockResolvedValue(undefined), closeAllConnections: vi.fn().mockResolvedValue(undefined) }
    const proxy = new BilibiliSessionProxy(() => session)

    await proxy.retryDirect()
    await proxy.applyPreference('auto')

    expect(session.setProxy).toHaveBeenLastCalledWith({ mode: 'system' })
    expect(proxy.snapshot()).toEqual({ mode: 'auto', effectiveMode: 'system', temporaryDirect: false })
  })

  it('does not reconnect when retrying direct under an already-direct preference', async () => {
    const session = { setProxy: vi.fn().mockResolvedValue(undefined), closeAllConnections: vi.fn().mockResolvedValue(undefined) }
    const proxy = new BilibiliSessionProxy(() => session)

    await proxy.applyPreference('direct')
    session.setProxy.mockClear()
    session.closeAllConnections.mockClear()
    await proxy.retryDirect()

    expect(session.setProxy).not.toHaveBeenCalled()
    expect(session.closeAllConnections).not.toHaveBeenCalled()
    expect(proxy.snapshot()).toEqual({ mode: 'direct', effectiveMode: 'direct', temporaryDirect: false })
  })

  it('does not change state or close connections when applying the next mode fails', async () => {
    const session = {
      setProxy: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('proxy unavailable')),
      closeAllConnections: vi.fn().mockResolvedValue(undefined)
    }
    const getBilibiliSession = vi.fn(() => session)
    const proxy = new BilibiliSessionProxy(getBilibiliSession)

    await proxy.applyPreference('auto')
    await expect(proxy.applyPreference('direct')).rejects.toThrow('proxy unavailable')

    expect(getBilibiliSession).toHaveBeenCalledOnce()
    expect(session.closeAllConnections).toHaveBeenCalledOnce()
    expect(proxy.snapshot()).toEqual({ mode: 'auto', effectiveMode: 'system', temporaryDirect: false })
  })

  it('restores the previous Electron proxy mode if closing old connections fails', async () => {
    const session = {
      setProxy: vi.fn().mockResolvedValue(undefined),
      closeAllConnections: vi.fn().mockRejectedValueOnce(new Error('close failed')).mockResolvedValue(undefined)
    }
    const proxy = new BilibiliSessionProxy(() => session)

    await expect(proxy.applyPreference('direct')).rejects.toThrow('close failed')

    expect(session.setProxy.mock.calls).toEqual([[{ mode: 'direct' }], [{ mode: 'system' }]])
    expect(proxy.snapshot()).toEqual({ mode: 'auto', effectiveMode: 'system', temporaryDirect: false })
  })

  it('starts in auto mode again after an application restart', async () => {
    const session = { setProxy: vi.fn().mockResolvedValue(undefined), closeAllConnections: vi.fn().mockResolvedValue(undefined) }
    const firstRun = new BilibiliSessionProxy(() => session)
    await firstRun.retryDirect()

    const restartedRun = new BilibiliSessionProxy(() => session)

    expect(restartedRun.snapshot()).toEqual({ mode: 'auto', effectiveMode: 'system', temporaryDirect: false })
  })
})

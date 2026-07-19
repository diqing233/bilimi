import { describe, expect, it, vi } from 'vitest'
import { resetOldFavoriteAccount } from './oldFavoriteAccountReset'

describe('resetOldFavoriteAccount', () => {
  it('finishes the persistence mutation only after every reset layer succeeds', async () => {
    const beginMutation = vi.fn().mockReturnValue(Symbol('reset-mutation'))
    const finishMutation = vi.fn()

    await resetOldFavoriteAccount({
      loadSessions: () => ({ version: 1 as const, batches: [], lease: null }),
      resetRuntime: () => null,
      restoreRuntime: vi.fn(),
      resetSessions: () => ({ version: 1 as const, batches: [], lease: null }),
      restoreSessions: vi.fn(),
      flushSessions: vi.fn().mockResolvedValue(undefined),
      resetWorkspace: vi.fn().mockResolvedValue(undefined),
      onMutation: { begin: beginMutation, finish: finishMutation }
    }, '42')

    expect(beginMutation).toHaveBeenCalledOnce()
    expect(finishMutation).toHaveBeenCalledWith(beginMutation.mock.results[0].value)
  })

  it('restores runtime and sessions when workspace deletion fails', async () => {
    const previousSessions = { version: 1 as const, batches: [], lease: null }
    const previousRuntime = { oldFavoriteExecutionPhase: { revision: 2, value: 'paused' } }
    const resetRuntime = vi.fn()
    const restoreRuntime = vi.fn()
    const resetSessions = vi.fn().mockReturnValue({ version: 1, batches: [], lease: null })
    const restoreSessions = vi.fn()
    const flushSessions = vi.fn().mockResolvedValue(undefined)
    const resetWorkspace = vi.fn().mockRejectedValue(new Error('workspace reset failed'))

    await expect(resetOldFavoriteAccount({
      loadSessions: () => previousSessions,
      resetRuntime: (accountMid) => { resetRuntime(accountMid); return previousRuntime },
      restoreRuntime,
      resetSessions,
      restoreSessions,
      flushSessions,
      resetWorkspace
    }, '42')).rejects.toThrow('workspace reset failed')

    expect(resetRuntime).toHaveBeenCalledWith('42')
    expect(resetSessions).toHaveBeenCalledWith('42')
    expect(resetWorkspace).toHaveBeenCalledWith('42')
    expect(restoreRuntime).toHaveBeenCalledWith('42', previousRuntime)
    expect(restoreSessions).toHaveBeenCalledWith(previousSessions)
    expect(flushSessions).toHaveBeenCalledTimes(2)
  })

  it('writes a durable reset intent before clearing sessions and completes it last', async () => {
    const order: string[] = []
    const operations = {
      loadSessions: () => ({ version: 1 as const, batches: [], lease: null }),
      beginReset: vi.fn(async () => { order.push('begin-reset') }),
      resetRuntime: vi.fn(() => { order.push('runtime'); return null }),
      restoreRuntime: vi.fn(),
      resetSessions: vi.fn(() => { order.push('sessions'); return { version: 1 as const, batches: [], lease: null } }),
      restoreSessions: vi.fn(),
      flushSessions: vi.fn(async () => { order.push('flush') }),
      resetWorkspace: vi.fn(async () => { order.push('workspace') }),
      completeReset: vi.fn(async () => { order.push('complete-reset') })
    } as never

    await resetOldFavoriteAccount(operations, '42')

    expect(order).toEqual(['begin-reset', 'runtime', 'sessions', 'flush', 'workspace', 'complete-reset'])
  })

  it('aborts a reset intent when runtime clearing fails before workspace reset', async () => {
    const beginReset = vi.fn()
    const abortReset = vi.fn()
    await expect(resetOldFavoriteAccount({
      loadSessions: () => ({ version: 1 as const, batches: [], lease: null }),
      beginReset,
      abortReset,
      resetRuntime: () => { throw new Error('runtime reset failed') },
      restoreRuntime: vi.fn(),
      resetSessions: vi.fn(),
      restoreSessions: vi.fn(),
      flushSessions: vi.fn().mockResolvedValue(undefined),
      resetWorkspace: vi.fn().mockResolvedValue(undefined)
    }, '42')).rejects.toThrow('runtime reset failed')

    expect(beginReset).toHaveBeenCalledWith('42')
    expect(abortReset).toHaveBeenCalledWith('42')
  })
})

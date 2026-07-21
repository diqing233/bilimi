import { describe, expect, it, vi } from 'vitest'
import { createFavoriteRepositoryPageBridge } from './favoriteRepositoryPageBridge'

describe('favorite repository page bridge', () => {
  const input = {
    accountMid: '100',
    operationKey: 'run-1:append-1',
    aid: 42,
    folderIds: ['11', '12']
  }

  it('runs append as one self-validating Bilibili page script', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '100'
    })
    const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript })

    await expect(bridge.append(input)).resolves.toEqual({
      status: 'ok', observedAccountMid: '100'
    })

    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    const [script, userGesture] = executeJavaScript.mock.calls[0]
    expect(userGesture).toBe(true)
    expect(script).toContain('DedeUserID')
    expect(script).toContain('bili_jct')
    expect(script).toContain('add_media_ids')
    expect(script).toContain('https://api.bilibili.com/x/v3/fav/resource/deal')
    expect(script).toContain(JSON.stringify(input))
  })

  it('treats an account mismatch as unknown so the main process reconciles before retrying', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      status: 'unknown', observedAccountMid: '200', reason: 'account-mismatch'
    })
    const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript })

    await expect(bridge.remove(input)).resolves.toEqual({
      status: 'unknown', observedAccountMid: '200', reason: 'account-mismatch'
    })

    expect(executeJavaScript.mock.calls[0][0]).toContain('del_media_ids')
  })

  it('reads only requested folder members without requiring csrf', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      status: 'ok',
      observedAccountMid: '100',
      members: { '11': [42, 9], '12': [] }
    })
    const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript })

    await expect(bridge.readMembers(input)).resolves.toEqual({
      status: 'ok',
      observedAccountMid: '100',
      members: { '11': [42, 9], '12': [] }
    })

    const script = executeJavaScript.mock.calls[0][0]
    expect(script).toContain('/x/v3/fav/resource/ids')
    expect(script).not.toContain('bili_jct')
    expect(script).toContain(JSON.stringify(input))
  })

  it('reads the account-scoped remote folder inventory through a fixed page primitive', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '100', folders: [{ id: '11', title: 'B-music-001-a1b2c3', memberCount: 2 }]
    })
    const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript })

    await expect(bridge.readFolderInventory({ accountMid: '100', operationKey: 'bind:inventory' })).resolves.toEqual({
      status: 'ok', observedAccountMid: '100', folders: [{ id: '11', title: 'B-music-001-a1b2c3', memberCount: 2 }]
    })
    const script = executeJavaScript.mock.calls[0][0]
    expect(script).toContain('/x/v3/fav/folder/created/list-all')
    expect(script).not.toContain('bili_jct')
  })

  it('creates only a bounded explicit folder title through the page primitive', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '100', folder: { id: '11', title: 'B-music-001-a1b2c3', memberCount: 0 }
    })
    const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript })

    await expect(bridge.createFolder({ accountMid: '100', operationKey: 'bind:create', title: 'B-music-001-a1b2c3' })).resolves.toMatchObject({
      status: 'ok', folder: { id: '11', title: 'B-music-001-a1b2c3' }
    })
    const script = executeJavaScript.mock.calls[0][0]
    expect(script).toContain('/x/v3/fav/folder/add')
    expect(script).toContain('bili_jct')
    expect(script).toContain('B-music-001-a1b2c3')
  })

  it('turns a page execution failure into an unknown result for reconciliation', async () => {
    const executeJavaScript = vi.fn().mockRejectedValue(new Error('webContents gone'))
    const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript })

    await expect(bridge.append(input)).resolves.toEqual({
      status: 'unknown', observedAccountMid: '', reason: 'page-execution-failed'
    })
  })

  it('ends a hanging page operation as unknown so remote queues can recover', async () => {
    vi.useFakeTimers()
    try {
      const executeJavaScript = vi.fn(() => new Promise(() => undefined))
      const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript, timeoutMs: 15 })

      const pending = bridge.append(input)
      await vi.advanceTimersByTimeAsync(15)

      await expect(pending).resolves.toEqual({
        status: 'unknown', observedAccountMid: '', reason: 'page-execution-timeout'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends a hanging membership read as unknown so reconciliation does not remain pending', async () => {
    vi.useFakeTimers()
    try {
      const executeJavaScript = vi.fn(() => new Promise(() => undefined))
      const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript, timeoutMs: 15 })

      const pending = bridge.readMembers(input)
      await vi.advanceTimersByTimeAsync(15)

      await expect(pending).resolves.toEqual({
        status: 'unknown', observedAccountMid: '', reason: 'page-execution-timeout'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('places a request timeout inside Bilibili write and membership-read scripts', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100' })
    const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript })

    await bridge.append(input)
    await bridge.readMembers(input)

    for (const [script] of executeJavaScript.mock.calls) {
      expect(script).toContain('AbortController')
      expect(script).toContain('15000')
      expect(script).toContain("Error('remote-timeout')")
    }
  })

  it('keeps an unclassified Bilibili API rejection unknown for reconciliation', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      status: 'unknown', observedAccountMid: '100', reason: 'remote-ambiguous'
    })
    const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript })

    await expect(bridge.append(input)).resolves.toEqual({
      status: 'unknown', observedAccountMid: '100', reason: 'remote-ambiguous'
    })
  })

  it('fails closed when the page returns an invalid bridge result', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100', unexpected: true })
    const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript })

    await expect(bridge.append(input)).resolves.toEqual({
      status: 'unknown', observedAccountMid: '', reason: 'invalid-page-result'
    })
  })
})

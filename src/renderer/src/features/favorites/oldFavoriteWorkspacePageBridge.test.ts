import { describe, expect, it, vi } from 'vitest'
import { createOldFavoriteWorkspacePageBridge } from './oldFavoriteWorkspacePageBridge'

describe('old favorite workspace page bridge', () => {
  const target = {
    webContentsId: 7,
    instanceId: 'bili-tab-1',
    navigationEpoch: 3
  }

  it('runs the fixed inventory script and preserves an empty Bilimi work folder', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok',
      observedAccountMid: '100',
      folders: [
        { id: '11', title: 'Source', mediaCount: 3 },
        { id: '12', title: 'Bilimi work', mediaCount: 0 }
      ]
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, { type: 'inventory', accountMid: '100' })).resolves.toEqual({
      status: 'ok',
      observedAccountMid: '100',
      folders: [
        { id: '11', title: 'Source', mediaCount: 3 },
        { id: '12', title: 'Bilimi work', mediaCount: 0 }
      ]
    })

    expect(execute).toHaveBeenCalledWith(target, expect.stringContaining('/x/v3/fav/folder/created/list-all'))
    expect(execute.mock.calls[0][1]).toContain('DedeUserID')
    expect(execute.mock.calls[0][1]).toContain('scan-workspace-inventory')
  })

  it('runs only the requested managed membership reads', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok',
      observedAccountMid: '100',
      members: { '12': [42, 9], '13': [] }
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-managed-members',
      accountMid: '100',
      folderIds: ['12', '13']
    })).resolves.toEqual({
      status: 'ok',
      observedAccountMid: '100',
      members: { '12': [42, 9], '13': [] }
    })

    expect(execute.mock.calls[0][1]).toContain('/x/v3/fav/resource/ids')
    expect(execute.mock.calls[0][1]).toContain('scan-workspace-managed-members')
  })

  it('reads one bounded source page and returns only lightweight item fields', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok',
      observedAccountMid: '100',
      items: [{ aid: 42, title: 'Video', upperName: 'UP', cover: 'https://i0.hdslb.com/a.jpg', addedAt: 123 }],
      hasMore: true
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-source-page',
      accountMid: '100',
      folderId: '11',
      page: 2,
      pageSize: 20
    })).resolves.toEqual({
      status: 'ok',
      observedAccountMid: '100',
      items: [{ aid: 42, title: 'Video', upperName: 'UP', cover: 'https://i0.hdslb.com/a.jpg', addedAt: 123 }],
      hasMore: true
    })

    const script = execute.mock.calls[0][1]
    expect(script).toContain('/x/v3/fav/resource/list')
    expect(script).toContain('"page":2')
    expect(script).toContain('"pageSize":20')
    expect(script).toContain('scan-workspace-source-page')
  })

  it('rejects an invalid target without running a page script', async () => {
    const execute = vi.fn()
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run({ ...target, navigationEpoch: -1 }, {
      type: 'inventory', accountMid: '100'
    })).resolves.toEqual({ status: 'unknown', observedAccountMid: '', reason: 'invalid-page-target' })

    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an invalid command page parameter without running a page script', async () => {
    const execute = vi.fn()
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-source-page', accountMid: '100', folderId: '11', page: 0, pageSize: 101
    })).resolves.toEqual({ status: 'unknown', observedAccountMid: '', reason: 'invalid-scan-command' })

    expect(execute).not.toHaveBeenCalled()
  })

  it('passes through an explicit lightweight unknown result without requiring a success payload', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'unknown', observedAccountMid: '100', reason: 'remote-ambiguous'
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-source-page', accountMid: '100', folderId: '11', page: 1, pageSize: 20
    })).resolves.toEqual({
      status: 'unknown', observedAccountMid: '100', reason: 'remote-ambiguous'
    })
  })

  it('fails closed when a successful result reports another account', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '200', folders: []
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, { type: 'inventory', accountMid: '100' })).resolves.toEqual({
      status: 'unknown', observedAccountMid: '200', reason: 'account-mismatch'
    })
  })

  it('fails closed when managed membership includes an unrequested folder', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '100', members: { '12': [42], '99': [7] }
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-managed-members', accountMid: '100', folderIds: ['12']
    })).resolves.toEqual({ status: 'unknown', observedAccountMid: '', reason: 'invalid-page-result' })
  })

  it('fails closed when a requested managed folder is omitted', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '100', members: { '12': [42] }
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-managed-members', accountMid: '100', folderIds: ['12', '13']
    })).resolves.toEqual({ status: 'unknown', observedAccountMid: '', reason: 'invalid-page-result' })
  })

  it('checks the account again after each controlled page fetch', async () => {
    const execute = vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100', folders: [] })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await bridge.run(target, { type: 'inventory', accountMid: '100' })

    expect(execute.mock.calls[0][1]).toContain('account-mismatch')
    expect(execute.mock.calls[0][1]).toContain("normalizeMid(readCookie('DedeUserID')) !== observedAccountMid")
  })

  it('fails closed when a scan result includes fields outside the lightweight command contract', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok',
      observedAccountMid: '100',
      items: [{ aid: 42, title: 'Video', upperName: 'UP', cover: '', addedAt: 0, workspace: { all: 'items' } }],
      hasMore: false
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-source-page', accountMid: '100', folderId: '11', page: 1, pageSize: 20
    })).resolves.toEqual({ status: 'unknown', observedAccountMid: '', reason: 'invalid-page-result' })
  })

  it('does not permit unrecognised commands at runtime', async () => {
    const execute = vi.fn()
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, { type: 'execute-anything', script: 'document.body.innerHTML' } as never)).resolves.toEqual({
      status: 'unknown', observedAccountMid: '', reason: 'invalid-scan-command'
    })

    expect(execute).not.toHaveBeenCalled()
  })
})

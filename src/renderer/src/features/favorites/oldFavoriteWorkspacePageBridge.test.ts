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
    expect(execute.mock.calls[0][1]).toContain("type=2")
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

  it('reads one bounded source page without requesting per-video tags', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok',
      observedAccountMid: '100',
      items: [{
        aid: 42, title: 'Video', upperName: 'UP', cover: 'https://i0.hdslb.com/a.jpg', addedAt: 123,
        unavailable: false
      }],
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
      items: [{
        aid: 42, title: 'Video', upperName: 'UP', cover: 'https://i0.hdslb.com/a.jpg', addedAt: 123,
        unavailable: false
      }],
      hasMore: true
    })

    const script = execute.mock.calls[0][1]
    expect(script).toContain('/x/v3/fav/resource/list')
    expect(script).toContain('"page":2')
    expect(script).toContain('"pageSize":20')
    expect(script).toContain("url.searchParams.set('platform', 'web')")
    expect(script).not.toContain("url.searchParams.set('keyword'")
    expect(script).not.toContain("url.searchParams.set('tid'")
    expect(script).toContain('scan-workspace-source-page')
    expect(script).not.toContain('media?.tags')
    expect(script).not.toContain('media?.tname')
    expect(script).not.toContain('media?.category')
    expect(script).not.toContain('/x/tag/archive/tags')
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('marks unavailable videos from the source-page metadata', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '100',
      items: [
        { aid: 41, title: '已失效视频', upperName: 'UP', cover: '', addedAt: 0, unavailable: true },
        { aid: 42, title: 'Video', upperName: '账号已注销', cover: '', addedAt: 0, unavailable: true },
        { aid: 43, title: 'Video', upperName: 'UP', cover: '', addedAt: 0, unavailable: false }
      ],
      hasMore: false
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-source-page', accountMid: '100', folderId: '11', page: 1, pageSize: 20
    })).resolves.toMatchObject({
      items: [
        { aid: 41, unavailable: true },
        { aid: 42, unavailable: true },
        { aid: 43, unavailable: false }
      ]
    })

    const script = execute.mock.calls[0][1]
    expect(script).toContain("title.trim() === '已失效视频'")
    expect(script).toContain("upperName.trim() === '账号已注销'")
  })

  it('reads tags for one already-scanned video without returning page inventory data', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '100', aid: 42, tags: ['TypeScript']
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-video-tags', accountMid: '100', aid: 42
    })).resolves.toEqual({ status: 'ok', observedAccountMid: '100', aid: 42, tags: ['TypeScript'] })
    expect(execute.mock.calls[0][1]).toContain('/x/tag/archive/tags')
    expect(execute.mock.calls[0][1]).toContain('scan-workspace-video-tags')
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

  it('preserves remote HTTP and Bilibili API codes in the controlled diagnostic reason', async () => {
    const execute = vi.fn(async (_target, script: string) => {
      const pageDocument = { cookie: 'DedeUserID=100; bili_jct=secret-cookie' }
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: -352, message: 'risk control' }), {
        status: 412,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }))
      return new Function('document', 'fetch', `return ${script}`)(pageDocument, fetch)
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, {
      type: 'read-source-page', accountMid: '100', folderId: '11', page: 1, pageSize: 20
    })).resolves.toEqual({
      status: 'unknown', observedAccountMid: '100', reason: 'remote-api-412--352',
      httpStatus: 412, contentType: 'application/json; charset=utf-8', bilibiliCode: -352,
      responseCategory: 'precondition-failed'
    })

    expect(JSON.stringify(await execute.mock.results[0].value)).not.toContain('secret-cookie')
  })

  it('returns sanitized diagnostics for a non-JSON inventory response without retaining its body or cookies', async () => {
    const execute = vi.fn(async (_target, script: string) => {
      const pageDocument = { cookie: 'DedeUserID=100; SESSDATA=private-session' }
      const fetch = vi.fn().mockResolvedValue(new Response('<html>private challenge body</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      }))
      return new Function('document', 'fetch', `return ${script}`)(pageDocument, fetch)
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    const result = await bridge.run(target, { type: 'inventory', accountMid: '100' })

    expect(result).toEqual({
      status: 'unknown', observedAccountMid: '100', reason: 'invalid-response',
      httpStatus: 200, contentType: 'text/html; charset=utf-8', responseCategory: 'non-json'
    })
    expect(JSON.stringify(result)).not.toContain('private challenge body')
    expect(JSON.stringify(result)).not.toContain('private-session')
  })

  it('rejects diagnostic categories and content types outside the sanitized contract', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'unknown', observedAccountMid: '100', reason: 'invalid-response',
      httpStatus: 200, contentType: 'text/html\r\nset-cookie: private', responseCategory: 'cookie-dump'
    })
    const bridge = createOldFavoriteWorkspacePageBridge({ execute })

    await expect(bridge.run(target, { type: 'inventory', accountMid: '100' })).resolves.toEqual({
      status: 'unknown', observedAccountMid: '', reason: 'invalid-page-result'
    })
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

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { registerFavoriteLibraryBridgeIpc } from './favoriteLibraryBridge'

type Handler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown
const mainPreloadSource = readFileSync(resolve(process.cwd(), 'electron/preload/index.ts'), 'utf8')
const mainProcessSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')
const mainRendererSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/main.tsx'), 'utf8')

function createHarness() {
  const handlers = new Map<string, Handler>()
  const openMainUrl = vi.fn()
  const updateArchiveVersion = vi.fn()
  registerFavoriteLibraryBridgeIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isTrustedLibrarySender: (senderId) => senderId === 7,
    readAccount: vi.fn().mockResolvedValue({ mid: '42', nickname: '小咪' }),
    getCurrentAccountMid: vi.fn().mockResolvedValue('42'),
    getSnapshot: vi.fn().mockResolvedValue({
      folders: [{ id: 'source-folder', title: '来源收藏夹', kind: 'bilibili', remoteFolderId: '9988', syncState: 'bound' }],
      physicalShards: []
    }),
    loadArchives: vi.fn().mockReturnValue([{ id: 'archive-7', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7', tags: [] }, createdAt: '', updatedAt: '', versions: [{ id: 'version-7', createdAt: '', plainTranscript: '', summaryText: '', note: { id: 'note-7', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7', tags: [] }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', starred: false, createdAt: '', updatedAt: '' } }] }]),
    updateArchiveVersion,
    openMainUrl
  })
  return { handlers, openMainUrl, updateArchiveVersion }
}

describe('favorite library bridge IPC', () => {
  it('routes drawer workspace requests to the main sidebar without opening the floating assistant', () => {
    expect(mainProcessSource).toMatch(/function openAssistantWorkspace\(payload: FloatingAssistantWorkspaceRequest\) \{\s*if \(payload\.sidebar\) \{\s*const mainAssistant = ensureMainWindowForAssistantRuntime\(\)\s*sendFloatingAssistantWorkspaceWhenReady\(mainAssistant, payload\)\s*return\s*}\s*const assistant = floatingAssistantController\.open\(\)/)
    expect(mainProcessSource).toMatch(/'floating-assistant:open-workspace',\s*\(_event, payload: FloatingAssistantWorkspaceRequest\) => \{\s*openAssistantWorkspace\(payload\)/)
  })

  it('exposes the embedded-library bridge from the main preload and opens only the main-window drawer', () => {
    expect(mainPreloadSource).toContain('getFavoriteRepositoryLibraryVideoDetail')
    expect(mainPreloadSource).toContain('syncFavoriteLibrarySelection')
    expect(mainPreloadSource).toContain('onFavoriteLibraryTranscriptionChanged')
    expect(mainPreloadSource).toContain('onOpenFavoriteLibraryDrawer')
    expect(mainProcessSource).toContain('handleFavoriteLibraryEntry')
    expect(mainProcessSource).toMatch(/function isTrustedFavoriteLibraryReader\(senderId: number\): boolean \{\s*return senderId === mainWindow\?\.webContents\.id/)
    expect(mainProcessSource).not.toContain("from './favoriteLibraryWindow'")
    expect(mainProcessSource).not.toContain('createFavoriteLibraryWindow')
    expect(mainProcessSource).not.toContain('FavoriteLibrarySideBySideLayout')
    expect(mainProcessSource).not.toContain('createFavoriteLibraryPreloadScriptPath')
    expect(mainProcessSource).not.toContain("window: 'favorite-library'")
    expect(mainRendererSource).not.toContain("from './features/favorites/FavoriteLibraryApp'")
    expect(mainRendererSource).not.toContain("route.get('window') === 'favorite-library'")
  })

  it('returns the current nickname and UID only to the library window', async () => {
    const { handlers } = createHarness()

    await expect(handlers.get('favorite-library:read-account')?.({ sender: { id: 7 } })).resolves.toEqual({
      mid: '42', nickname: '小咪'
    })
    await expect(handlers.get('favorite-library:read-account')?.({ sender: { id: 8 } })).rejects.toThrow('不受信任')
  })

  it('derives the selected video URL in the main process', async () => {
    const { handlers, openMainUrl } = createHarness()

    await handlers.get('favorite-library:open-video')?.({ sender: { id: 7 } }, '42', 170001)

    expect(openMainUrl).toHaveBeenCalledWith('https://www.bilibili.com/video/av170001')
  })

  it('does not open a video after the account has changed', async () => {
    const handlers = new Map<string, Handler>()
    const openMainUrl = vi.fn()
    registerFavoriteLibraryBridgeIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      isTrustedLibrarySender: () => true,
      readAccount: vi.fn().mockResolvedValue({ mid: '99' }),
      getCurrentAccountMid: vi.fn().mockResolvedValue('99'),
      getSnapshot: vi.fn(),
      openMainUrl
    })

    await expect(handlers.get('favorite-library:open-video')?.({ sender: { id: 7 } }, '42', 170001)).rejects.toThrow(
      '当前账号已切换'
    )
    expect(openMainUrl).not.toHaveBeenCalled()
  })

  it('derives a source favorite URL from repository folder metadata', async () => {
    const { handlers, openMainUrl } = createHarness()

    await handlers.get('favorite-library:open-source')?.({ sender: { id: 7 } }, '42', 'source-folder')

    expect(openMainUrl).toHaveBeenCalledWith('https://space.bilibili.com/42/favlist?fid=9988&ftype=create')
  })

  it('requires an explicit shard when a canonical logical folder has multiple bound shards', async () => {
    const handlers = new Map<string, Handler>()
    const openMainUrl = vi.fn()
    registerFavoriteLibraryBridgeIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      isTrustedLibrarySender: () => true,
      readAccount: vi.fn().mockResolvedValue({ mid: '42' }),
      getCurrentAccountMid: vi.fn().mockResolvedValue('42'),
      getSnapshot: vi.fn().mockResolvedValue({
        folders: [{ id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }],
        physicalShards: [
          { logicalLedgerId: 'music', folderId: 'bilimi:music:002', shardNumber: 2, remoteTitle: 'Music 2', bindingState: 'bound', remoteFolderId: '200' },
          { logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: '100' }
        ]
      }),
      loadArchives: vi.fn().mockReturnValue([]), updateArchiveVersion: vi.fn(), openMainUrl
    })

    await expect(handlers.get('favorite-library:open-source')?.({ sender: { id: 7 } }, '42', 'bilimi-logical:music')).rejects.toThrow(
      'Multiple physical folders require an explicit selection'
    )

    expect(openMainUrl).not.toHaveBeenCalled()
  })

  it('opens a canonical logical folder only when it resolves to one bound shard', async () => {
    const handlers = new Map<string, Handler>()
    const openMainUrl = vi.fn()
    registerFavoriteLibraryBridgeIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      isTrustedLibrarySender: () => true,
      readAccount: vi.fn().mockResolvedValue({ mid: '42' }),
      getCurrentAccountMid: vi.fn().mockResolvedValue('42'),
      getSnapshot: vi.fn().mockResolvedValue({
        folders: [{ id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }],
        physicalShards: [
          { logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: '100' }
        ]
      }),
      loadArchives: vi.fn().mockReturnValue([]), updateArchiveVersion: vi.fn(), openMainUrl
    })

    await handlers.get('favorite-library:open-source')?.({ sender: { id: 7 } }, '42', 'bilimi-logical:music')

    expect(openMainUrl).toHaveBeenCalledWith('https://space.bilibili.com/42/favlist?fid=100&ftype=create')
  })

  it('opens an explicitly selected bound physical shard', async () => {
    const handlers = new Map<string, Handler>()
    const openMainUrl = vi.fn()
    registerFavoriteLibraryBridgeIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      isTrustedLibrarySender: () => true,
      readAccount: vi.fn().mockResolvedValue({ mid: '42' }),
      getCurrentAccountMid: vi.fn().mockResolvedValue('42'),
      getSnapshot: vi.fn().mockResolvedValue({
        folders: [],
        physicalShards: [
          { logicalLedgerId: 'music', folderId: 'bilimi:music:002', shardNumber: 2, remoteTitle: 'Music 2', bindingState: 'bound', remoteFolderId: '200' }
        ]
      }),
      loadArchives: vi.fn().mockReturnValue([]), updateArchiveVersion: vi.fn(), openMainUrl
    })

    await handlers.get('favorite-library:open-source')?.({ sender: { id: 7 } }, '42', 'bilimi:music:002')

    expect(openMainUrl).toHaveBeenCalledWith('https://space.bilibili.com/42/favlist?fid=200&ftype=create')
  })

  it('refuses a canonical logical folder whose only shard is pending or unbound', async () => {
    const handlers = new Map<string, Handler>()
    const openMainUrl = vi.fn()
    registerFavoriteLibraryBridgeIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      isTrustedLibrarySender: () => true,
      readAccount: vi.fn().mockResolvedValue({ mid: '42' }),
      getCurrentAccountMid: vi.fn().mockResolvedValue('42'),
      getSnapshot: vi.fn().mockResolvedValue({
        folders: [{ id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'pending-reconcile' }],
        physicalShards: [
          { logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteTitle: 'Music', bindingState: 'pending-reconcile' }
        ]
      }),
      loadArchives: vi.fn().mockReturnValue([]), updateArchiveVersion: vi.fn(), openMainUrl
    })

    await expect(handlers.get('favorite-library:open-source')?.({ sender: { id: 7 } }, '42', 'bilimi-logical:music')).rejects.toThrow('来源收藏夹不可打开')
    expect(openMainUrl).not.toHaveBeenCalled()
  })

  it('does not silently skip a pending shard while opening a canonical logical folder', async () => {
    const handlers = new Map<string, Handler>()
    const openMainUrl = vi.fn()
    registerFavoriteLibraryBridgeIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      isTrustedLibrarySender: () => true,
      readAccount: vi.fn().mockResolvedValue({ mid: '42' }),
      getCurrentAccountMid: vi.fn().mockResolvedValue('42'),
      getSnapshot: vi.fn().mockResolvedValue({
        folders: [{ id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'pending-reconcile' }],
        physicalShards: [
          { logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: '100' },
          { logicalLedgerId: 'music', folderId: 'bilimi:music:002', shardNumber: 2, remoteTitle: 'Music 2', bindingState: 'pending-reconcile' }
        ]
      }),
      loadArchives: vi.fn().mockReturnValue([]), updateArchiveVersion: vi.fn(), openMainUrl
    })

    await expect(handlers.get('favorite-library:open-source')?.({ sender: { id: 7 } }, '42', 'bilimi-logical:music')).rejects.toThrow('来源收藏夹不可打开')
    expect(openMainUrl).not.toHaveBeenCalled()
  })

  it('refuses a source folder that has no remote Bilibili favorite', async () => {
    const { handlers, openMainUrl } = createHarness()

    await expect(handlers.get('favorite-library:open-source')?.({ sender: { id: 7 } }, '42', 'missing')).rejects.toThrow(
      '来源收藏夹不可打开'
    )
    expect(openMainUrl).not.toHaveBeenCalled()
  })

  it('updates the matching archive version without trusting renderer archive IDs', async () => {
    const { handlers, updateArchiveVersion } = createHarness()

    await handlers.get('favorite-library:toggle-archive-star')?.({ sender: { id: 7 } }, '42', 7)
    await handlers.get('favorite-library:save-archive-memo')?.({ sender: { id: 7 } }, '42', 7, '稍后复习')

    expect(updateArchiveVersion).toHaveBeenNthCalledWith(1, 'archive-7', 'version-7', expect.objectContaining({ starred: true }))
    expect(updateArchiveVersion).toHaveBeenNthCalledWith(2, 'archive-7', 'version-7', expect.objectContaining({ userMemo: '稍后复习' }))
  })

  it('edits the selected multi-P archive by cid and refuses an ambiguous aid-only edit', async () => {
    const handlers = new Map<string, Handler>()
    const updateArchiveVersion = vi.fn()
    registerFavoriteLibraryBridgeIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      isTrustedLibrarySender: () => true,
      readAccount: vi.fn().mockResolvedValue({ mid: '42' }), getCurrentAccountMid: vi.fn().mockResolvedValue('42'), getSnapshot: vi.fn(),
      loadArchives: vi.fn().mockReturnValue([
        { id: 'archive-p1', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7', tags: [] }, createdAt: '', updatedAt: '', versions: [{ id: 'version-p1', createdAt: '', plainTranscript: '', summaryText: '', note: { id: 'account:42:aid:7:cid:70', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=1', tags: [] }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', starred: false, createdAt: '', updatedAt: '' } }] },
        { id: 'archive-p2', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7', tags: [] }, createdAt: '', updatedAt: '', versions: [{ id: 'version-p2', createdAt: '', plainTranscript: '', summaryText: '', note: { id: 'account:42:aid:7:cid:71', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=2', tags: [] }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', starred: false, createdAt: '', updatedAt: '' } }] }
      ]), updateArchiveVersion, openMainUrl: vi.fn()
    })

    await handlers.get('favorite-library:toggle-archive-star')?.({ sender: { id: 7 } }, '42', 7, 71)
    await handlers.get('favorite-library:save-archive-memo')?.({ sender: { id: 7 } }, '42', 7, 'page 1 memo', 70)
    await expect(handlers.get('favorite-library:toggle-archive-star')?.({ sender: { id: 7 } }, '42', 7)).rejects.toThrow('请选择具体分P')
    expect(updateArchiveVersion).toHaveBeenCalledWith('archive-p2', 'version-p2', expect.objectContaining({ starred: true }))
    expect(updateArchiveVersion).toHaveBeenCalledWith('archive-p1', 'version-p1', expect.objectContaining({ userMemo: 'page 1 memo' }))
  })

  it('resolves an archive navigation target by account, aid, and cid without renderer archive IDs', async () => {
    const handlers = new Map<string, Handler>()
    registerFavoriteLibraryBridgeIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      isTrustedLibrarySender: () => true,
      readAccount: vi.fn().mockResolvedValue({ mid: '42' }),
      getCurrentAccountMid: vi.fn().mockResolvedValue('42'),
      getSnapshot: vi.fn(),
      loadArchives: vi.fn().mockReturnValue([
        {
          id: 'archive-p1', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7', tags: [] }, createdAt: '', updatedAt: '',
          versions: [{ id: 'version-p1', createdAt: '', plainTranscript: '', summaryText: '', note: { id: 'account:42:aid:7:cid:70', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=1', tags: [] }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', createdAt: '', updatedAt: '' } }]
        },
        {
          id: 'archive-p2', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7', tags: [] }, createdAt: '', updatedAt: '',
          versions: [{ id: 'version-p2', createdAt: '', plainTranscript: '', summaryText: '', note: { id: 'account:42:aid:7:cid:71', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=2', tags: [] }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', createdAt: '', updatedAt: '' } }]
        }
      ]),
      updateArchiveVersion: vi.fn(), openMainUrl: vi.fn()
    })

    await expect(handlers.get('favorite-library:resolve-archive')?.({ sender: { id: 7 } }, '42', 7, 71)).resolves.toEqual({
      archiveId: 'archive-p2', versionId: 'version-p2'
    })
    await expect(handlers.get('favorite-library:resolve-archive')?.({ sender: { id: 7 } }, '42', 7)).rejects.toThrow('请选择具体分P')
  })

  it('resolves a multi-part transcription by the complete account, aid, and cid identity', async () => {
    const handlers = new Map<string, Handler>()
    registerFavoriteLibraryBridgeIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      isTrustedLibrarySender: () => true,
      readAccount: vi.fn().mockResolvedValue({ mid: '42' }),
      getCurrentAccountMid: vi.fn().mockResolvedValue('42'),
      getSnapshot: vi.fn(),
      loadArchives: vi.fn().mockReturnValue([
        {
          id: 'other-account-page', source: { accountMid: '99', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=2', tags: [] }, createdAt: '', updatedAt: '2026-07-24T00:02:00.000Z',
          versions: [{ id: 'other-account-version', createdAt: '', plainTranscript: '', summaryText: '', note: { id: 'account:99:aid:7:cid:71', source: { accountMid: '99', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=2', tags: [] }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', createdAt: '', updatedAt: '' } }]
        },
        {
          id: 'current-account-page', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=2', tags: [] }, createdAt: '', updatedAt: '2026-07-24T00:01:00.000Z',
          versions: [{ id: 'current-account-version', createdAt: '', plainTranscript: '', summaryText: '', note: { id: 'account:42:aid:7:cid:71', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=2', tags: [] }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', createdAt: '', updatedAt: '' } }]
        },
        {
          id: 'current-account-other-page', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=1', tags: [] }, createdAt: '', updatedAt: '2026-07-24T00:03:00.000Z',
          versions: [{ id: 'current-account-other-version', createdAt: '', plainTranscript: '', summaryText: '', note: { id: 'account:42:aid:7:cid:70', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7?p=1', tags: [] }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', createdAt: '', updatedAt: '' } }]
        }
      ]),
      updateArchiveVersion: vi.fn(), openMainUrl: vi.fn()
    })

    await expect(handlers.get('favorite-library:resolve-archive')?.({ sender: { id: 7 } }, '42', 7, 71)).resolves.toEqual({
      archiveId: 'current-account-page', versionId: 'current-account-version'
    })
  })

  it('keeps a legacy account and aid archive reachable when no page is requested', async () => {
    const { handlers } = createHarness()

    await expect(handlers.get('favorite-library:resolve-archive')?.({ sender: { id: 7 } }, '42', 7)).resolves.toEqual({
      archiveId: 'archive-7', versionId: 'version-7'
    })
    await expect(handlers.get('favorite-library:resolve-archive')?.({ sender: { id: 7 } }, '42', 7, 70)).rejects.toThrow('暂无本地档案')
  })
})

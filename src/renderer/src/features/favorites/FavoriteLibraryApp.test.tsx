import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryApp } from './FavoriteLibraryApp'
import { FavoriteLibraryDialogs } from './FavoriteLibraryDialogs'

const text = {
  library: '\u6536\u85cf\u5e93',
  all: '\u5168\u90e8\u6536\u85cf',
  pending: '\u5f85\u5904\u7406',
  videoList: '\u6536\u85cf\u5e93\u89c6\u9891\u5217\u8868',
  detail: '\u89c6\u9891\u8be6\u60c5',
  hideDetail: '\u6536\u8d77\u8be6\u60c5',
  localFolder: '\u672c\u5730\u6574\u7406',
  nextPage: '\u4e0b\u4e00\u9875'
} as const

const favoriteLibraryStyles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'),
  'utf8'
)

afterEach(() => {
  cleanup()
  window.bilimiDesktop = undefined
})

describe('FavoriteLibraryApp', () => {
  it('shows managed-folder remote-delete preview diagnostics before its second dangerous confirmation', () => {
    render(<FavoriteLibraryDialogs managedFolder={{
      title: '音乐',
      canDeleteRemotely: true,
      preview: {
        currentRevision: 7,
        localMemberCount: 12,
        unmatchedFallbackCount: 3,
        extraRemoteMemberCount: 2,
        remoteOnlyMemberCount: 4
      }
    }} />)

    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('版本 7')
    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('受影响本地视频 12')
    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('未匹配回退 3')
    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('额外远端成员 2')
    expect(screen.getByRole('dialog', { name: '删除 音乐' })).toHaveTextContent('仅远端成员 4')
  })
  it('keeps the compact detail placement picker without rendering normal descriptions', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__placement-picker')
    expect(favoriteLibraryStyles).toContain('.favorite-library__placement-preview')
    expect(favoriteLibraryStyles).toContain('.favorite-library__delete-confirmation')
  })
  it('keeps archive export, import preview, and server-scanned safe restore in a compact library entry', async () => {
    const exportFavoriteRepositoryArchive = vi.fn().mockResolvedValue({ accountMid: '100', schemaVersion: 1 })
    const previewFavoriteRepositoryArchiveImport = vi.fn().mockResolvedValue({
      accountMatches: true, canApply: true, canRestoreRemotely: true, videoCount: 1, eventCount: 0
    })
    const createFavoriteRepositoryArchiveRestorePlan = vi.fn().mockResolvedValue({
      mode: 'safe', accountMid: '100', operations: [{ aid: 1, appendLogicalFolderIds: ['bilimi-logical:music'], removeLogicalFolderIds: [], desiredLogicalFolderIds: ['bilimi-logical:music'] }], executionToken: 'scan-token', confirmationRequired: false
    })
    const executeFavoriteRepositoryArchiveRestore = vi.fn().mockResolvedValue({ id: 'restore-1', accountMid: '100', status: 'result-unknown', completedOperationCount: 0, totalOperationCount: 1, items: [{ aid: 1, status: 'result-unknown' }] })
    const reconcileFavoriteRepositoryArchiveRestore = vi.fn().mockResolvedValue({ id: 'restore-1', accountMid: '100', status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, items: [{ aid: 1, status: 'succeeded' }] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 0, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [] }),
      exportFavoriteRepositoryArchive,
      previewFavoriteRepositoryArchiveImport,
      createFavoriteRepositoryArchiveRestorePlan,
      executeFavoriteRepositoryArchiveRestore,
      reconcileFavoriteRepositoryArchiveRestore,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '收藏存档' }))
    fireEvent.click(screen.getByRole('button', { name: '导出收藏存档' }))
    await waitFor(() => expect(exportFavoriteRepositoryArchive).toHaveBeenCalledWith('100'))
    fireEvent.click(screen.getByRole('button', { name: '检查存档' }))
    await waitFor(() => expect(previewFavoriteRepositoryArchiveImport).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '预览安全恢复到B站' }))
    await waitFor(() => expect(createFavoriteRepositoryArchiveRestorePlan).toHaveBeenCalledWith('100', expect.any(String), 'safe', { kind: 'all' }))
    expect(screen.getByText('将补齐 1 个 B 站受管归属，不会移除远端额外归属。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '执行安全恢复到B站' }))
    await waitFor(() => expect(executeFavoriteRepositoryArchiveRestore).toHaveBeenCalledWith('100', expect.objectContaining({ accountMid: '100' }), 'scan-token', undefined))
    expect(screen.getByText('远程结果待确认：请先对账，不能直接重试。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '执行安全恢复到B站' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '对账恢复结果' }))
    await waitFor(() => expect(reconcileFavoriteRepositoryArchiveRestore).toHaveBeenCalledWith('100', expect.objectContaining({ accountMid: '100' }), 'scan-token'))
  })
  it('scopes archive recovery to selected aids or the current logical folder and displays each aid result', async () => {
    const createFavoriteRepositoryArchiveRestorePlan = vi.fn().mockResolvedValue({
      mode: 'safe', accountMid: '100', operations: [{ aid: 1, appendLogicalFolderIds: ['bilimi-logical:music'], removeLogicalFolderIds: [], desiredLogicalFolderIds: ['bilimi-logical:music'] }], executionToken: 'scope-token', confirmationRequired: false
    })
    const executeFavoriteRepositoryArchiveRestore = vi.fn().mockResolvedValue({
      id: 'restore-scopes', accountMid: '100', status: 'failed', completedOperationCount: 1, totalOperationCount: 2,
      items: [{ aid: 1, status: 'succeeded' }, { aid: 2, status: 'failed', reason: 'managed target is unbound' }]
    })
    const getFavoriteRepositoryLibraryPage = vi.fn().mockImplementation(async (_account, scope) => ({
      version: 1, accountMid: '100', revision: 1,
      items: scope.kind === 'folder' ? [
        { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] },
        { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }
      ] : [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z', videoCount: 2, folderCount: 1, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 1, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage,
      previewFavoriteRepositoryArchiveImport: vi.fn().mockResolvedValue({ accountMatches: true, canApply: true, canRestoreRemotely: true, videoCount: 2, eventCount: 0 }),
      createFavoriteRepositoryArchiveRestorePlan,
      executeFavoriteRepositoryArchiveRestore,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('button', { name: '收藏存档' }))
    fireEvent.change(screen.getByRole('textbox', { name: '存档 JSON' }), { target: { value: '{"archive":true}' } })
    fireEvent.click(screen.getByRole('button', { name: '检查存档' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '恢复范围' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.change(screen.getByRole('combobox', { name: '恢复范围' }), { target: { value: 'selected' } })
    fireEvent.click(screen.getByRole('button', { name: '预览安全恢复到B站' }))
    await waitFor(() => expect(createFavoriteRepositoryArchiveRestorePlan).toHaveBeenLastCalledWith('100', expect.any(String), 'safe', { kind: 'aids', aids: [1] }))

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    await waitFor(() => expect(screen.getByText('视频二')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('combobox', { name: '恢复范围' }), { target: { value: 'current-folder' } })
    fireEvent.click(screen.getByRole('button', { name: '预览安全恢复到B站' }))
    await waitFor(() => expect(createFavoriteRepositoryArchiveRestorePlan).toHaveBeenLastCalledWith('100', expect.any(String), 'safe', { kind: 'logical-folder', folderId: 'bilimi-logical:music' }))
    fireEvent.click(screen.getByRole('button', { name: '执行安全恢复到B站' }))
    await waitFor(() => expect(screen.getByText('视频 #1：已完成')).toBeInTheDocument())
    expect(screen.getByText('视频 #2：失败（managed target is unbound）')).toBeInTheDocument()
  })
  it('sets one final local placement for every selected video from the compact batch picker', async () => {
    const setFavoriteLibraryLocalPlacements = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 2, folderCount: 2, folders: [{ id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }, { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 2, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, items: [
        { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] },
        { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:games'], pendingStates: [] }
      ] }),
      setFavoriteLibraryLocalPlacements,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频二' }))
    fireEvent.click(screen.getByRole('button', { name: '调整所选本地归属（2）' }))

    expect(screen.getByText(/将调整 2 个所选视频/)).toBeInTheDocument()
    expect(screen.getByText('最终本地归属：未匹配分类')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '游戏' }))
    expect(screen.getByText('最终本地归属：游戏')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存本地归属' }))

    await waitFor(() => expect(setFavoriteLibraryLocalPlacements).toHaveBeenCalledWith('100', [
      { aid: 1, folderIds: ['bilimi-logical:games'] },
      { aid: 2, folderIds: ['bilimi-logical:games'] }
    ], 3, false))
  })
  it('previews final multi-folder local placement and submits optional remote sync only when checked', async () => {
    const setFavoriteLibraryLocalPlacements = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 2, folders: [{ id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }, { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 2, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [], position: { state: 'aligned', localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['9'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'], updatedAt: '2026-07-23T00:00:00.000Z' }, mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      setFavoriteLibraryLocalPlacements, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop
    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    fireEvent.click(await screen.findByRole('button', { name: '调整本地归属' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '游戏' }))
    expect(screen.getByText('新增：游戏')).toBeInTheDocument()
    expect(screen.getByText('保留：音乐')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '同时同步到B站' }))
    fireEvent.click(screen.getByRole('button', { name: '保存本地归属' }))
    await waitFor(() => expect(setFavoriteLibraryLocalPlacements).toHaveBeenCalledWith('100', [{ aid: 1, folderIds: ['bilimi-logical:games', 'bilimi-logical:music'] }], 3, true))
  })
  it('keeps detail status dimensions explanatory without rendering descriptions', async () => {
    const syncFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const description = '这是一段很长的简介。'.repeat(40)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, items: [{ video: { aid: 1, title: 'Video + ID', description, tags: ['测试标签'], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: ['protected'] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 3, video: { aid: 1, title: 'Video + ID', description, tags: ['测试标签'], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: ['protected'], protected: true, position: { state: 'failed', localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:00:00.000Z' }, mirror: { status: 'failed' }, transcription: { status: '转写失败' }, archive: { status: '登记异常', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      syncFavoriteLibrarySelection, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Video + ID'))
    expect(await screen.findByText(/标签: 测试标签/)).toBeInTheDocument()
    expect(screen.queryByText(description)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '展开简介' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '资料状态说明' }))
    expect(screen.getByRole('status')).toHaveTextContent('资料状态')
    fireEvent.click(screen.getByRole('button', { name: '刷新资料' }))
    await waitFor(() => expect(syncFavoriteLibrarySelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1] }))
    expect(screen.getByRole('button', { name: '整理状态说明' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保护状态说明' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '位置状态说明' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转写状态说明' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '档案状态说明' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消B站收藏' })).toBeDisabled()
    expect(screen.getByText('仅取消当前视频在 B 站的全部收藏；不会删除收藏库本地记录、转写或档案。')).toBeInTheDocument()
  })
  it('requires a local-only confirmation before deleting a library record', async () => {
    const deleteFavoriteLibraryVideo = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'synced' }, transcription: { status: '转写完成' }, archive: { status: '已入档', versionCount: 1, starred: false, hasMemo: false, hasSummary: true } }),
      deleteFavoriteLibraryVideo, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    fireEvent.click(await screen.findByRole('button', { name: '从收藏库删除' }))
    expect(screen.getByText('不会取消 B 站收藏，也不会删除已有转写和档案。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认仅从收藏库删除' }))
    await waitFor(() => expect(deleteFavoriteLibraryVideo).toHaveBeenCalledWith('100', 1, 4))
  })
  it('requires a separate second confirmation before cancelling the selected video on Bilibili', async () => {
    const previewFavoriteLibraryBilibiliUnfavorite = vi.fn().mockResolvedValue({
      accountMid: '100', aids: [1], executionToken: 'preview-token', expiresAt: Date.now() + 60_000
    })
    const confirmFavoriteLibraryBilibiliUnfavorite = vi.fn().mockResolvedValue({ confirmationToken: 'confirm-token' })
    const executeFavoriteLibraryBilibiliUnfavorite = vi.fn().mockResolvedValue({
      status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, affectedAids: [1]
    })
    const deleteFavoriteLibraryVideo = vi.fn()
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'synced' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      previewFavoriteLibraryBilibiliUnfavorite, confirmFavoriteLibraryBilibiliUnfavorite, executeFavoriteLibraryBilibiliUnfavorite,
      deleteFavoriteLibraryVideo, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    fireEvent.click(await screen.findByRole('button', { name: '取消B站收藏' }))
    await waitFor(() => expect(previewFavoriteLibraryBilibiliUnfavorite).toHaveBeenCalledWith('100', [1]))
    expect(screen.getByRole('alertdialog', { name: '确认取消B站收藏' })).toHaveTextContent('视频一')
    fireEvent.click(screen.getByRole('button', { name: '确认取消 B 站收藏' }))
    await waitFor(() => expect(confirmFavoriteLibraryBilibiliUnfavorite).toHaveBeenCalledWith('100', [1], 'preview-token'))
    expect(executeFavoriteLibraryBilibiliUnfavorite).toHaveBeenCalledWith('100', [1], 'preview-token', 'confirm-token')
    expect(deleteFavoriteLibraryVideo).not.toHaveBeenCalled()
  })
  it('holds batch remote-unfavorite at a visible preview until the dangerous confirmation is clicked', async () => {
    const previewFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({
      executionToken: 'batch-preview', baselineRevision: 4, aids: [1, 2], removesAllBilibiliMembership: true
    })
    const confirmFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({ confirmationToken: 'batch-confirm' })
    const executeFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({ status: 'result-unknown', operationId: 'batch-operation' })
    const reconcileFavoriteLibraryRemoteUnfavoriteOperation = vi.fn().mockResolvedValue({ status: 'reconciliation-required' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 2, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [
        { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] },
        { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }
      ] }),
      previewFavoriteLibraryRemoteUnfavoriteOperation,
      confirmFavoriteLibraryRemoteUnfavoriteOperation,
      executeFavoriteLibraryRemoteUnfavoriteOperation,
      reconcileFavoriteLibraryRemoteUnfavoriteOperation,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频二' }))
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }))
    fireEvent.click(screen.getByRole('button', { name: '取消B站收藏' }))
    await waitFor(() => expect(previewFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', [1, 2], 4))
    expect(executeFavoriteLibraryRemoteUnfavoriteOperation).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '确认批量取消B站收藏' })).toHaveTextContent('2 个视频')
    fireEvent.click(screen.getByRole('button', { name: '确认取消所选 B 站收藏' }))
    await waitFor(() => expect(confirmFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', 'batch-preview'))
    expect(executeFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', 'batch-preview', 'batch-confirm')
    expect(await screen.findByRole('status')).toHaveTextContent('远程结果待确认')
    fireEvent.click(screen.getByRole('button', { name: '对账取消收藏结果' }))
    await waitFor(() => expect(reconcileFavoriteLibraryRemoteUnfavoriteOperation).toHaveBeenCalledWith('100', 'batch-operation'))
  })
  it('uses the additive copy and current-work-folder-only move contracts for batch placement', async () => {
    const copyFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const moveFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 2, folders: [
        { id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' },
        { id: 'bilimi-logical:games', title: '游戏', kind: 'bilimi-logical', logicalLedgerId: 'games', syncState: 'bound' }
      ], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 6, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }] }),
      copyFavoriteLibrarySelection,
      moveFavoriteLibrarySelection,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }))
    fireEvent.click(screen.getByRole('button', { name: '复制至' }))
    expect(screen.getByText(/原有归属会保留/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '保存本地归属' }))
    await waitFor(() => expect(copyFavoriteLibrarySelection).toHaveBeenCalledWith('100', [1], ['bilimi-logical:games'], 6))

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '选择 视频一' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }))
    fireEvent.click(screen.getByRole('button', { name: '移动至' }))
    expect(screen.getByText(/只移除当前工作夹归属/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '保存本地归属' }))
    await waitFor(() => expect(moveFavoriteLibrarySelection).toHaveBeenCalledWith('100', [1], 'bilimi-logical:music', ['bilimi-logical:games'], 6))
  })
  it('resolves a registered archive by stable video identity before opening the archive host', async () => {
    const resolveFavoriteLibraryArchive = vi.fn().mockResolvedValue({ archiveId: 'private-id', versionId: 'private-version' })
    const openFloatingAssistantWorkspace = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 2, items: [{ video: { aid: 1, cid: 70, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 2, video: { aid: 1, cid: 70, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'never' }, transcription: { status: '转写完成' }, archive: { status: '已入档', versionCount: 1, starred: false, hasMemo: false, hasSummary: true } }),
      resolveFavoriteLibraryArchive,
      openFloatingAssistantWorkspace,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    fireEvent.click(await screen.findByRole('button', { name: '查看档案详情' }))
    await waitFor(() => expect(resolveFavoriteLibraryArchive).toHaveBeenCalledWith('100', 1, 70))
    expect(openFloatingAssistantWorkspace).toHaveBeenCalledWith({ tab: 'notes', openNoteArchive: true })
  })
  it('keeps placement actions local by default and lets the user adopt the observed Bilibili position', async () => {
    const setFavoriteLibraryLocalPlacements = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const adoptFavoriteLibraryRemotePlacement = vi.fn().mockResolvedValue({ status: 'succeeded' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 7, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 1, folders: [{ id: 'bilimi-logical:music', title: '音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }], physicalShardCount: 1, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 7, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 7, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['bilimi-logical:music'], pendingStates: [], position: { state: 'local-only-change', localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['9'], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:00:00.000Z' }, mirror: { status: 'never' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      setFavoriteLibraryLocalPlacements,
      adoptFavoriteLibraryRemotePlacement,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    fireEvent.click(await screen.findByRole('button', { name: '移出所有本地仓库' }))
    await waitFor(() => expect(setFavoriteLibraryLocalPlacements).toHaveBeenCalledWith('100', [{ aid: 1, folderIds: [] }], 7, false))
    fireEvent.click(screen.getByRole('button', { name: '采用B站位置' }))
    await waitFor(() => expect(adoptFavoriteLibraryRemotePlacement).toHaveBeenCalledWith('100', 1, 7))
  })
  it('loads the user timeline only after it is explicitly requested', async () => {
    const getFavoriteRepositoryVideoEvents = vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [
      { id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:00:00.000Z' }
    ] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'never' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      getFavoriteRepositoryVideoEvents,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    expect(getFavoriteRepositoryVideoEvents).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: '查看完整处理记录' }))
    await waitFor(() => expect(getFavoriteRepositoryVideoEvents).toHaveBeenCalledWith('100', 1, { limit: 20 }))
    expect(screen.getAllByText(/manual-move/)).not.toHaveLength(0)
  })
  it('loads a subsequent event page without replaying the first page', async () => {
    const getFavoriteRepositoryVideoEvents = vi.fn()
      .mockResolvedValueOnce({ version: 1, accountMid: '100', revision: 1, items: [{ id: 'event-2', sequence: 2, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:00:00.000Z' }], nextCursor: '2:event-2' })
      .mockResolvedValueOnce({ version: 1, accountMid: '100', revision: 1, items: [{ id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'entered', occurredAt: '2026-07-22T00:00:00.000Z' } ] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: [], pendingStates: [], mirror: { status: 'never' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      getFavoriteRepositoryVideoEvents, subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop
    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('视频一'))
    fireEvent.click(await screen.findByRole('button', { name: '查看完整处理记录' }))
    fireEvent.click(await screen.findByRole('button', { name: '加载更早记录' }))
    await waitFor(() => expect(getFavoriteRepositoryVideoEvents).toHaveBeenLastCalledWith('100', 1, { limit: 20, cursor: '2:event-2' }))
    expect(screen.getByText(/entered/)).toBeInTheDocument()
  })
  it('places the no-error embedded layout in the flexible row with a bounded result list', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-22T00:00:00.000Z', videoCount: 0, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, items: []
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp embedded />)

    const root = await screen.findByRole('main', { name: text.library })
    expect(root).toHaveAttribute('data-embedded', 'true')
    expect(root.querySelector('.favorite-library__header')).not.toBeInTheDocument()
    expect(root.querySelector('.favorite-library__layout')).toHaveAttribute('data-embedded-layout', 'true')
    expect(root.querySelector('.favorite-library__error')).not.toBeInTheDocument()
    expect(root.children[0]).toHaveClass('favorite-library__layout')
    expect(favoriteLibraryStyles).toMatch(/\.favorite-library\[data-embedded='true'\]\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s)
    expect(favoriteLibraryStyles).toContain(
      ".favorite-library[data-embedded='true'] .favorite-library__layout { grid-row: 3; height: 100%; min-height: 0; }"
    )
    expect(favoriteLibraryStyles).toContain(
      ".favorite-library[data-embedded='true'] .favorite-library__results { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; overflow: hidden; }"
    )
    expect(favoriteLibraryStyles).toContain(
      ".favorite-library[data-embedded='true'] .favorite-library__list { height: 100% !important; min-height: 0; }"
    )
    expect(favoriteLibraryStyles).toContain(
      ".favorite-library[data-embedded='true'] { container-type: inline-size; }"
    )
    expect(favoriteLibraryStyles).toMatch(
      /@container\s+\(max-width: 760px\)\s*\{\s*\.favorite-library\[data-embedded='true'\]\s+\.favorite-library__layout\[data-embedded-layout='true'\]\s*\{/
    )
    expect(favoriteLibraryStyles).toContain(
      "@media (max-width: 760px) { .favorite-library:not([data-embedded='true']) .favorite-library__layout"
    )
  })

  it('keeps internal action failures out of the user-facing alert', async () => {
    const syncFavoriteLibrarySelection = vi.fn().mockRejectedValue(new Error('Error invoking remote method favorite-library:sync-selection'))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1,
        items: [{ video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: ['unsynced'] }]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      syncFavoriteLibrarySelection
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 视频一' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新所选信息（1）' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('收藏库操作失败。')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Error invoking remote method')
  })

  it('shows independent placement and metadata labels for an unavailable video', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 1, folderCount: 1,
        folders: [{ id: 'local:inbox', title: 'inbox', kind: 'local', syncState: 'local-only' }], physicalShardCount: 0,
        syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        items: [{ video: { aid: 1, title: 'Video + ID', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local:inbox'], pendingStates: ['protected'] }]
      }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        video: { aid: 1, title: 'Video + ID', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local:inbox'], pendingStates: ['protected'], protected: true,
        position: { state: 'failed', localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:00:00.000Z' },
        mirror: { status: 'failed' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false }
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('Video + ID'))
    const detail = await screen.findByRole('complementary')
    expect(detail).toHaveTextContent('资料待刷新')
    expect(detail).toHaveTextContent('同步失败')
    expect(detail).toHaveTextContent('已保护')
    expect(detail).toHaveTextContent('未匹配分类')
  })

  it('uses Chinese controls, selects the current page, and identifies the signed-in account', async () => {
    const syncFavoriteLibrarySelection = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const desktop = {
      readBilibiliAccount: vi.fn().mockResolvedValue({ mid: '100', nickname: '小咪' }),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        items: [
          { video: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: ['unsynced'] },
          { video: { aid: 2, title: '视频二', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }
        ]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      syncFavoriteLibrarySelection
    }
    window.bilimiDesktop = desktop as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('当前账号：小咪（UID：100）')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '全选当前页' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前页' }))
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新所选信息（2）' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新所选信息（2）' }))
    await waitFor(() => expect(syncFavoriteLibrarySelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1, 2] }))
  })

  it('loads the selected video detail snapshot and exposes its source and archive facts', async () => {
    const getFavoriteRepositoryLibraryVideoDetail = vi.fn().mockResolvedValue({
      video: { aid: 1, cid: 70, title: '已扫描视频', author: 'UP 主', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
      folderIds: ['source'], pendingStates: [],
      mirror: { status: '已同步', lastSyncedAt: '2026-07-20T10:00:00.000Z' },
      transcription: { status: '转写完成' },
      archive: { status: '已入档', versionCount: 2, starred: true, hasMemo: true, memoPreview: '已备注', hasSummary: true }
    })
    const toggleFavoriteLibraryArchiveStar = vi.fn().mockResolvedValue(undefined)
    const saveFavoriteLibraryArchiveMemo = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 1, folders: [{ id: 'source', title: '默认收藏夹', kind: 'bilibili', syncState: 'bound' }], physicalShardCount: 0, syncRecordCount: 0, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '已扫描视频', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['source'], pendingStates: [] }] }),
      getFavoriteRepositoryLibraryVideoDetail,
      toggleFavoriteLibraryArchiveStar,
      saveFavoriteLibraryArchiveMemo,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('已扫描视频'))
    const detail = await screen.findByRole('complementary')
    expect(detail).toHaveTextContent('本地镜像')
    expect(detail).toHaveTextContent('已同步')
    expect(detail).toHaveTextContent('转写完成')
    expect(detail).toHaveTextContent('已入档')
    expect(getFavoriteRepositoryLibraryVideoDetail).toHaveBeenCalledWith('100', 1)
    fireEvent.click(screen.getByRole('button', { name: '取消星标' }))
    await waitFor(() => expect(toggleFavoriteLibraryArchiveStar).toHaveBeenCalledWith('100', 1, 70))
    fireEvent.change(screen.getByRole('textbox', { name: '档案备注' }), { target: { value: '新备注' } })
    fireEvent.click(screen.getByRole('button', { name: '保存备注' }))
    await waitFor(() => expect(saveFavoriteLibraryArchiveMemo).toHaveBeenCalledWith('100', 1, '新备注', 70))
  })

  it('renders pending reasons in Chinese instead of repository enum values', async () => {
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0, folders: [], physicalShardCount: 0, syncRecordCount: 1, syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 1 } }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, items: [{ video: { aid: 1, title: '等待确认', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: ['result-unknown'] }] }),
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({ video: { aid: 1, title: '等待确认', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: ['result-unknown'], mirror: { status: '已同步' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false } }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByText('等待确认'))
    const detail = await screen.findByRole('complementary')
    expect(detail).toHaveTextContent('同步状态待确认')
    expect(detail).not.toHaveTextContent('result-unknown')
  })

  it('renders account-scoped navigation, one paged virtual list, and a collapsible detail pane', async () => {
    const getPage = vi.fn(async (_accountMid: string, scope: { kind: string; folderId?: string }) => ({
      version: 1 as const, accountMid: '100', revision: 2,
      items: scope.kind === 'folder'
        ? [{ video: { aid: 2, title: 'Folder video', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
        : [{ video: { aid: 1, title: 'All video', author: 'UP', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local', 'remote'], pendingStates: ['failed'] }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 2,
        folders: [
          { id: 'remote', title: 'B \u7ad9\u539f\u6536\u85cf', kind: 'bilibili', syncState: 'bound' },
          { id: 'local', title: text.localFolder, kind: 'local', syncState: 'local-only' }
        ], physicalShardCount: 0, syncRecordCount: 1,
        syncCounts: { pending: 0, succeeded: 0, failed: 1, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByRole('heading', { name: text.library })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.all })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${text.pending} 1` })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: text.videoList })
    expect(list).toHaveAttribute('data-virtualized', 'true')
    fireEvent.click(screen.getByText('All video'))
    expect(await screen.findByRole('complementary')).toHaveTextContent('UP')
    expect(screen.getByRole('complementary')).toHaveTextContent(text.localFolder)

    fireEvent.click(screen.getByText(text.hideDetail))
    expect(screen.getByRole('complementary')).toHaveAttribute('aria-label', '视频详情已收起')
    expect(screen.getByRole('button', { name: '恢复视频详情' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: text.localFolder }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'folder', folderId: 'local' }, { limit: 50 }))
    expect(await screen.findByText('Folder video')).toBeInTheDocument()
  })

  it('replaces the visible page when advancing instead of accumulating repository rows', async () => {
    const getPage = vi.fn(async (_accountMid: string, _scope: { kind: string }, options: { cursor?: string }) => ({
      version: 1 as const, accountMid: '100', revision: 2,
      items: options.cursor
        ? [{ video: { aid: 2, title: 'Second page', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
        : [{ video: { aid: 1, title: 'First page', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }],
      ...(options.cursor ? {} : { nextCursor: '100' })
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('First page')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: text.nextPage }))
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, { limit: 50, cursor: '100' }))
    expect(await screen.findByText('Second page')).toBeInTheDocument()
    expect(screen.queryByText('First page')).not.toBeInTheDocument()
  })

  it('sends only selected aids or the current local folder to narrow library actions', async () => {
    const syncFavoriteLibrarySelection = vi.fn().mockResolvedValue({ runId: 'library-1', status: 'succeeded' })
    const enqueueFavoriteLibraryTranscription = vi.fn().mockResolvedValue({ status: 'queued' })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 2, folderCount: 1,
        folders: [{ id: 'local', title: text.localFolder, kind: 'local', syncState: 'local-only' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2,
        items: [
          { video: { aid: 1, title: 'One', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] },
          { video: { aid: 2, title: 'Two', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }
        ]
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      syncFavoriteLibrarySelection,
      enqueueFavoriteLibraryTranscription
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await screen.findByText('One')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 One' }))
    fireEvent.click(screen.getByRole('button', { name: '加入转写队列（1）' }))
    await waitFor(() => expect(enqueueFavoriteLibraryTranscription).toHaveBeenCalledWith('100', { aids: [1] }))
    fireEvent.click(screen.getByRole('button', { name: '重新刷新所选信息（1）' }))
    await waitFor(() => expect(syncFavoriteLibrarySelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1] }))
  })

  it('clears selection and detail when changing scope while naming refresh actions accurately', async () => {
    const getPage = vi.fn(async (_accountMid: string, scope: { kind: string }) => ({
      version: 1 as const, accountMid: '100', revision: 2,
      items: scope.kind === 'folder'
        ? [{ video: { aid: 2, title: 'Folder video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
        : [{ video: { aid: 1, title: 'All video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-23T00:00:00.000Z', videoCount: 2, folderCount: 1,
        folders: [{ id: 'local', title: text.localFolder, kind: 'local', syncState: 'local-only' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 0
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      getFavoriteRepositoryLibraryVideoDetail: vi.fn().mockResolvedValue({
        video: { aid: 1, title: 'All video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [],
        mirror: { status: '已同步' }, transcription: { status: '未转写' }, archive: { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false }
      }),
      subscribeFavoriteRepository: vi.fn(() => () => undefined),
      syncFavoriteLibrarySelection: vi.fn().mockResolvedValue({ status: 'succeeded' })
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    fireEvent.click(await screen.findByRole('checkbox', { name: /All video/ }))
    expect(screen.getByRole('button', { name: /刷新所选信息/ })).toBeInTheDocument()
    fireEvent.click(screen.getByText('All video'))
    expect(await screen.findByRole('complementary')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: text.localFolder }))

    expect(await screen.findByText('Folder video')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /刷新所选信息/ })).toBeDisabled()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('clears the prior account and rebinds when a repository revision observes an account switch', async () => {
    let notify: (() => void) | undefined
    const getPage = vi.fn(async (accountMid: string) => ({
      version: 1 as const, accountMid, revision: 1,
      items: [{
        video: { aid: Number(accountMid), title: `Video ${accountMid}`, tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
        folderIds: [], pendingStates: []
      }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValueOnce('100').mockResolvedValue('101'),
      openFavoriteRepositoryAccount: vi.fn(async (accountMid: string) => ({
        version: 1, accountMid, revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      })),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn((_accountMid, _folderId, callback) => {
        notify = () => callback({})
        return () => undefined
      })
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('Video 100')).toBeInTheDocument()
    await act(async () => { notify?.() })
    expect(await screen.findByText('Video 101')).toBeInTheDocument()
    expect(screen.queryByText('Video 100')).not.toBeInTheDocument()
  })

  it('clears the prior account when the desktop account-change signal arrives without a repository revision', async () => {
    let notifyAccountChange: (() => void) | undefined
    const getPage = vi.fn(async (accountMid: string) => ({
      version: 1 as const, accountMid, revision: 1,
      items: [{
        video: { aid: Number(accountMid), title: `Video ${accountMid}`, tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
        folderIds: [], pendingStates: []
      }]
    }))
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValueOnce('100').mockResolvedValue('101'),
      onBilibiliAccountChanged: vi.fn((callback) => { notifyAccountChange = callback; return () => undefined }),
      openFavoriteRepositoryAccount: vi.fn(async (accountMid: string) => ({
        version: 1, accountMid, revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      })),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('Video 100')).toBeInTheDocument()
    await act(async () => { notifyAccountChange?.() })
    expect(await screen.findByText('Video 101')).toBeInTheDocument()
    expect(screen.queryByText('Video 100')).not.toBeInTheDocument()
  })

  it('clears the account identity and its subscription after logout', async () => {
    let notifyAccountChange: (() => void) | undefined
    const unsubscribe = vi.fn()
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValueOnce('100').mockResolvedValue(''),
      onBilibiliAccountChanged: vi.fn((callback) => { notifyAccountChange = callback; return () => undefined }),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 0,
        folders: [], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1,
        items: [{ video: { aid: 100, title: 'Video 100', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: [], pendingStates: [] }]
      }),
      subscribeFavoriteRepository: vi.fn(() => unsubscribe)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)

    expect(await screen.findByText('Video 100')).toBeInTheDocument()
    await act(async () => { notifyAccountChange?.() })
    expect(await screen.findByRole('alert')).toHaveTextContent('\u8bf7\u5148\u767b\u5f55 B \u7ad9\u8d26\u53f7\u3002')
    expect(screen.queryByText('Video 100')).not.toBeInTheDocument()
    expect(screen.queryByText('\u8d26\u53f7 100')).not.toBeInTheDocument()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('keeps the newest folder page when an older request resolves last', async () => {
    let resolveAll: ((value: { version: 1; accountMid: string; revision: number; items: never[] }) => void) | undefined
    const getPage = vi.fn((_accountMid: string, scope: { kind: string; folderId?: string }) => {
      if (scope.kind === 'all') return new Promise((resolve) => { resolveAll = resolve })
      return Promise.resolve({
        version: 1 as const, accountMid: '100', revision: 1,
        items: [{ video: { aid: 2, title: 'Folder wins', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }, folderIds: ['local'], pendingStates: [] }]
      })
    })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      openFavoriteRepositoryAccount: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', videoCount: 1, folderCount: 1,
        folders: [{ id: 'local', title: text.localFolder, kind: 'local', syncState: 'local-only' }], physicalShardCount: 0, syncRecordCount: 0,
        syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }
      }),
      getFavoriteRepositoryLibraryPage: getPage,
      subscribeFavoriteRepository: vi.fn(() => () => undefined)
    } as typeof window.bilimiDesktop

    render(<FavoriteLibraryApp />)
    await waitFor(() => expect(resolveAll).toBeTypeOf('function'))
    fireEvent.click(screen.getByRole('button', { name: text.localFolder }))
    expect(await screen.findByText('Folder wins')).toBeInTheDocument()
    resolveAll?.({ version: 1, accountMid: '100', revision: 1, items: [] })
    await Promise.resolve()
    expect(screen.getByText('Folder wins')).toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import {
  applyFavoriteRepositoryCommand,
  createAccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryWorkspaceRef
} from './favoriteRepository'

const WORKSPACE_CHECKSUM = 'a'.repeat(64)

function workspaceRef(overrides: Partial<FavoriteRepositoryWorkspaceRef> = {}): FavoriteRepositoryWorkspaceRef {
  return {
    workspaceId: 'workspace-1',
    accountMid: '100',
    status: 'scanning',
    baselineRevision: 0,
    currentSegmentId: '',
    overlayRevision: 0,
    journalCursor: 0,
    checksum: WORKSPACE_CHECKSUM,
    ...overrides
  }
}

describe('account favorite repository contracts', () => {
  it('rejects a command for another account before changing the snapshot', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    expect(() => applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1',
      accountMid: '200',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: {} }
    }, '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository account mismatch.')

    expect(snapshot.revision).toBe(0)
  })

  it('advances the revision once for an account-scoped local plan command', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1',
      accountMid: '100',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'local:inbox': [1, 2] }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(result).toMatchObject({ accountMid: '100', revision: 1 })
    expect(result.updatedAt).toBe('2026-07-19T00:00:01.000Z')
    expect(result.affectedFolderIds).toEqual(['local:inbox'])
    expect(result.affectedAids).toEqual([1, 2])
  })

  it('creates local library folders and their members in one local-only plan', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-20T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'local-plan', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'local:music': [1, 2] },
        folders: [{ id: 'local:music', title: 'Music', kind: 'local', syncState: 'local-only' }]
      }
    }, '2026-07-20T00:00:01.000Z')

    expect(result.folders).toContainEqual({ id: 'local:music', title: 'Music', kind: 'local', syncState: 'local-only' })
    expect(result.memberships['local:music']).toEqual([1, 2])
  })

  it('removes formally classified or protected videos from the local inbox without removing unmatched videos', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      memberships: { 'local:inbox': [1, 2, 3] }
    }

    const locallyClassified = applyFavoriteRepositoryCommand(snapshot, {
      id: 'classify-local', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'local:music': [1] },
        organizationRecords: [{ accountMid: '100', aid: 2, targetFolderIds: ['remote-music'], completedAt: '2026-07-23T00:01:00.000Z' }]
      }
    }, '2026-07-23T00:01:00.000Z')

    expect(locallyClassified.memberships).toMatchObject({ 'local:inbox': [3], 'local:music': [1] })
    expect(locallyClassified.organizationRecords).toEqual([expect.objectContaining({ aid: 2 })])
  })

  it('stores local-plan video records with their local membership indexes', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-20T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'local-plan-with-video', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'local:music': [1] },
        videos: [{ aid: 1, title: 'Saved locally', author: 'UP', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }]
      }
    }, '2026-07-20T00:00:01.000Z')

    expect(result.videos['1']).toMatchObject({ aid: 1, title: 'Saved locally', author: 'UP' })
    expect(result.memberships['local:music']).toEqual([1])
  })

  it('clears every local repository namespace for an explicit full reset', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' })
    const seeded = applyFavoriteRepositoryCommand(snapshot, {
      id: 'seed', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: { 'local:inbox': [1] },
        folders: [{ id: 'local:inbox', title: 'Inbox', kind: 'local', syncState: 'local-only' }],
        videos: [{ aid: 1, title: 'Stale', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }] }
    }, '2026-07-20T00:00:01.000Z')
    const reset = applyFavoriteRepositoryCommand(seeded, {
      id: 'reset', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'clear-local-repository', payload: {}
    }, '2026-07-20T00:00:02.000Z')

    expect(reset).toMatchObject({ videos: {}, libraryMirrors: {}, folders: [], memberships: {}, physicalShards: [], syncRecords: [], organizationRecords: [] })
    expect(reset.workspace).toBeUndefined()
  })

  it('replaces only the Bilibili mirror namespace on a later source scan', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' })
    const first = applyFavoriteRepositoryCommand(snapshot, {
      id: 'mirror-1', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'bilibili:old': [1], 'bilibili:keep': [2] },
        folders: [
          { id: 'bilibili:old', title: '已删除收藏夹', remoteFolderId: 'old' },
          { id: 'bilibili:keep', title: '保留收藏夹', remoteFolderId: 'keep' }
        ],
        videos: [
          { aid: 1, title: '过期视频', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' },
          { aid: 2, title: '保留视频', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }
        ]
      }
    }, '2026-07-20T00:00:01.000Z')

    const second = applyFavoriteRepositoryCommand(first, {
      id: 'mirror-2', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-2', memberAidsByFolderId: { 'bilibili:keep': [2] },
        folders: [{ id: 'bilibili:keep', title: '保留收藏夹', remoteFolderId: 'keep' }],
        videos: [{ aid: 2, title: '保留视频', tags: [], updatedAt: '2026-07-20T00:00:02.000Z' }]
      }
    }, '2026-07-20T00:00:02.000Z')

    expect(second.folders.map((folder) => folder.id)).toEqual(['bilibili:keep'])
    expect(second.memberships).toEqual({ 'bilibili:keep': [2] })
    expect(second.videos).not.toHaveProperty('1')
  })

  it('keeps rich existing metadata when a sparse Bilibili scan refreshes a video', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' })
    const rich = applyFavoriteRepositoryCommand(snapshot, {
      id: 'rich-video', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 1, title: '旧标题', author: '原 UP', description: '完整简介', tags: ['音乐'], updatedAt: '2026-07-19T00:00:00.000Z' }
    }, '2026-07-20T00:00:01.000Z')

    const mirrored = applyFavoriteRepositoryCommand(rich, {
      id: 'sparse-mirror', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1', memberAidsByFolderId: { 'bilibili:source': [1] },
        folders: [{ id: 'bilibili:source', title: '来源', remoteFolderId: 'source' }],
        videos: [{ aid: 1, title: '扫描标题', tags: [], updatedAt: '2026-07-20T00:00:02.000Z' }]
      }
    }, '2026-07-20T00:00:02.000Z')

    expect(mirrored.videos['1']).toEqual({
      aid: 1, title: '扫描标题', author: '原 UP', description: '完整简介', tags: ['音乐'], updatedAt: '2026-07-19T00:00:00.000Z'
    })
  })

  it('uses one positive account identity despite leading zeroes', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '00100',
      now: '2026-07-19T00:00:00.000Z'
    })

    expect(snapshot.accountMid).toBe('100')
    expect(() => createAccountFavoriteRepositorySnapshot({
      accountMid: '0',
      now: '2026-07-19T00:00:00.000Z'
    })).toThrow('Favorite repository account is invalid.')
    expect(() => createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: 'not-a-date'
    })).toThrow('Favorite repository timestamp is invalid.')
  })

  it('merges trimmed folder ids without dropping their member aids', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1',
      accountMid: '100',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { ' local:inbox ': [1], 'local:inbox': [2, 1] }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(result.affectedFolderIds).toEqual(['local:inbox'])
    expect(result.affectedAids).toEqual([1, 2])
  })

  it('adds local-plan members without replacing existing local members', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' }),
      memberships: { 'local:music': [9] }
    }

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'add-local-member', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: { 'local:music': [1] } }
    }, '2026-07-19T00:00:01.000Z')

    expect(result.memberships['local:music']).toEqual([1, 9])
  })

  it('merges multiple completed formal targets for the same protected aid', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-20T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'protections', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [
        { accountMid: '100', aid: 1, targetFolderIds: ['remote-music'], completedAt: '2026-07-20T00:00:00.000Z' },
        { accountMid: '100', aid: 1, targetFolderIds: ['remote-knowledge'], completedAt: '2026-07-20T00:00:00.000Z' }
      ] }
    }, '2026-07-20T00:00:00.000Z')

    expect(result.organizationRecords).toEqual([
      expect.objectContaining({ aid: 1, targetFolderIds: ['remote-knowledge', 'remote-music'] })
    ])
  })

  it('removes a deleted shard binding while retaining local videos and other formal protection targets', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' }),
      videos: { '1': { aid: 1, title: 'Kept local', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' } },
      memberships: { 'bilimi:music:001': [1], 'bilimi:knowledge:001': [1] },
      physicalShards: [
        { logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId: 'remote-music', remoteTitle: 'Music', bindingState: 'bound' as const },
        { logicalLedgerId: 'knowledge', folderId: 'bilimi:knowledge:001', shardNumber: 1, remoteFolderId: 'remote-knowledge', remoteTitle: 'Knowledge', bindingState: 'bound' as const }
      ],
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-knowledge', 'remote-music'], completedAt: '2026-07-20T00:00:00.000Z' }]
    }

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-music', accountMid: '100', issuedAt: '2026-07-20T00:01:00.000Z', type: 'remove-physical-shard-binding',
      payload: { remoteFolderId: 'remote-music' }
    }, '2026-07-20T00:01:00.000Z')

    expect(result.videos['1']).toMatchObject({ title: 'Kept local' })
    expect(result.organizationRecords).toEqual([expect.objectContaining({ targetFolderIds: ['remote-knowledge'] })])
    expect(result.physicalShards).toEqual([expect.objectContaining({ remoteFolderId: 'remote-knowledge' })])
  })

  it('keeps each organization recovery record immutable and projects a confirmed remove from logical membership', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' }),
      memberships: { 'bilimi:music:001': [1], 'bilimi-logical:music': [1] },
      physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId: 'remote-music', remoteTitle: 'Music', bindingState: 'bound' as const }]
    }
    const first = applyFavoriteRepositoryCommand(snapshot, {
      id: 'change-1', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'record-organization-change',
      payload: { change: {
        id: 'run-1:remove-1:succeeded', runId: 'run-1', workspaceId: 'workspace-1', accountMid: '100', aid: 1,
        beforeFolderIds: ['remote-music'], afterFolderIds: [], addedFolderIds: [], removedFolderIds: ['remote-music'],
        status: 'succeeded', recordedAt: '2026-07-20T00:00:01.000Z'
      } }
    }, '2026-07-20T00:00:01.000Z')
    const second = applyFavoriteRepositoryCommand(first, {
      id: 'change-2', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'record-organization-change',
      payload: { change: {
        id: 'run-2:append-2:result-unknown', runId: 'run-2', workspaceId: 'workspace-2', accountMid: '100', aid: 2,
        beforeFolderIds: [], afterFolderIds: [], addedFolderIds: [], removedFolderIds: [],
        status: 'result-unknown', recordedAt: '2026-07-20T00:00:02.000Z'
      } }
    }, '2026-07-20T00:00:02.000Z')

    expect(first.memberships).toMatchObject({ 'bilimi:music:001': [], 'bilimi-logical:music': [] })
    expect(second.organizationBatches).toEqual([
      expect.objectContaining({ id: 'run-1:remove-1:succeeded', beforeFolderIds: ['remote-music'], removedFolderIds: ['remote-music'] }),
      expect.objectContaining({ id: 'run-2:append-2:result-unknown', status: 'result-unknown' })
    ])
  })

  it('rejects malformed command data at the shared IPC boundary', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    expect(() => applyFavoriteRepositoryCommand(snapshot, {
      id: '',
      accountMid: '100',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'commit-local-plan',
      payload: { workspaceId: '', memberAidsByFolderId: { 'local:inbox': [1] } }
    }, '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
  })

  it('requires workspaces to identify their account', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    expect(() => applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1',
      accountMid: '100',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'set-workspace',
      payload: {
        id: 'workspace-1',
        status: 'scanning',
        baselineRevision: 0,
        continuationAids: []
      }
    } as never, '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
  })

  it('normalizes an updated video by aid instead of increasing its count', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })
    const first = applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'first', tags: [], updatedAt: '2026-07-19T00:00:01.000Z' }
    }, '2026-07-19T00:00:02.000Z')
    const second = applyFavoriteRepositoryCommand(first, {
      id: 'command-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'updated', tags: ['tag'], updatedAt: '2026-07-19T00:00:02.000Z' }
    }, '2026-07-19T00:00:02.000Z')

    expect(Object.keys(second.videos)).toEqual(['1'])
    expect(second.videos['1']).toMatchObject({ title: 'updated', tags: ['tag'] })
  })

  it('normalizes nested workspace accounts and keeps accepted time monotonic', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:10.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '00100', status: 'scanning', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ accountMid: '00100' })
      }
    }, '2026-07-19T00:00:20.000Z')

    expect(result.workspace?.accountMid).toBe('100')
    expect(result.workspace?.workspaceRef.accountMid).toBe('100')
    expect(result.updatedAt).toBe('2026-07-19T00:00:20.000Z')
  })

  it('stores only a validated lightweight workspace reference in the repository snapshot', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-19T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-ref', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 7, continuationAids: [],
        workspaceRef: workspaceRef({
          status: 'previewing', baselineRevision: 7, currentSegmentId: 'segment-2',
          overlayRevision: 4, journalCursor: 812
        })
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(result.workspace?.workspaceRef).toEqual({
      workspaceId: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 7,
      currentSegmentId: 'segment-2', overlayRevision: 4, journalCursor: 812, checksum: WORKSPACE_CHECKSUM
    })
    expect(result.workspace).not.toHaveProperty('baseline')
    expect(result.workspace).not.toHaveProperty('classifications')
    expect(result.workspace).not.toHaveProperty('history')
    expect(result.workspace).not.toHaveProperty('segments')
  })

  it('rejects malformed or overloaded workspace references at the shared command boundary', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-19T00:00:00.000Z'
    })
    const command = (ref: unknown, extra: Record<string, unknown> = {}) => ({
      id: 'workspace-ref', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 7, continuationAids: [],
        workspaceRef: ref,
        ...extra
      }
    })

    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef({ checksum: 'bad' })),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef({ journalCursor: -1 })),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef({ workspaceId: 'other' })),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef({ status: 'frozen' })),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef(), { history: [{ changes: [] }] }),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
  })

  it('rejects replacing a persisted frozen sync plan through a later workspace command', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-19T00:00:00.000Z'
    })
    const frozen = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'frozen', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z',
          operations: [{ operationKey: 'append-1', aid: 1, kind: 'append', folderIds: ['remote-a'] }]
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(() => applyFavoriteRepositoryCommand(frozen, {
      id: 'workspace-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'executing', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'executing', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z',
          operations: [{ operationKey: 'append-2', aid: 1, kind: 'append', folderIds: ['remote-b'] }]
        }
      }
    }, '2026-07-19T00:00:02.000Z')).toThrow('Favorite sync plan is immutable.')

    expect(() => applyFavoriteRepositoryCommand(frozen, {
      id: 'workspace-3', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: 'different-workspace', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ workspaceId: 'different-workspace' })
      }
    }, '2026-07-19T00:00:02.000Z')).toThrow('Favorite sync plan is immutable.')
  })

  it('clears an unfinished frozen workspace only through an exact explicit abandon command', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const frozen = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'frozen', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z', operations: []
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(applyFavoriteRepositoryCommand(frozen, {
      id: 'abandon-1', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z',
      type: 'abandon-frozen-workspace', payload: { workspaceId: 'workspace-1', frozenPlanId: 'run-1' }
    }, '2026-07-19T00:00:02.000Z').workspace).toBeUndefined()
  })

  it('abandons only the matching preview workspace without changing saved library data', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const previewing = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1' })
      }
    }, '2026-07-19T00:00:01.000Z')
    const seeded = applyFavoriteRepositoryCommand(previewing, {
      id: 'saved-video', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Saved video', author: 'UP', tags: [], updatedAt: '2026-07-19T00:00:02.000Z' }
    }, '2026-07-19T00:00:02.000Z')

    const abandoned = applyFavoriteRepositoryCommand(seeded, {
      id: 'abandon-preview-1', accountMid: '100', issuedAt: '2026-07-19T00:00:03.000Z',
      type: 'abandon-workspace', payload: { workspaceId: 'workspace-1' }
    }, '2026-07-19T00:00:03.000Z')

    expect(abandoned.workspace).toBeUndefined()
    expect(abandoned.videos['1']).toMatchObject({ title: 'Saved video' })
    expect(() => applyFavoriteRepositoryCommand(seeded, {
      id: 'wrong-workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:03.000Z',
      type: 'abandon-workspace', payload: { workspaceId: 'workspace-2' }
    }, '2026-07-19T00:00:03.000Z')).toThrow('Favorite workspace cannot be abandoned.')
  })

  it('allows a completed frozen plan to advance the account pointer to a new scanning workspace', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const completed = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'completed', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z', operations: []
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(applyFavoriteRepositoryCommand(completed, {
      id: 'workspace-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-2', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ workspaceId: 'workspace-2' })
      }
    }, '2026-07-19T00:00:02.000Z').workspace).toMatchObject({ id: 'workspace-2', status: 'scanning' })
  })

  it('rejects replacing a completed frozen plan with a non-scanning workspace', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const completed = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'completed', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z', operations: []
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(() => applyFavoriteRepositoryCommand(completed, {
      id: 'workspace-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-2', accountMid: '100', status: 'previewing', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ workspaceId: 'workspace-2', status: 'previewing' })
      }
    }, '2026-07-19T00:00:02.000Z')).toThrow('Favorite sync plan is immutable.')
  })

  it('rejects a whitespace-padded completed workspace id as a new scan pointer', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const completed = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'completed', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z', operations: []
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(() => applyFavoriteRepositoryCommand(completed, {
      id: 'workspace-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: ' workspace-1 ', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ workspaceId: 'workspace-1' })
      }
    }, '2026-07-19T00:00:02.000Z')).toThrow('Favorite sync plan is immutable.')
  })
})

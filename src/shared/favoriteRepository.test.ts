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

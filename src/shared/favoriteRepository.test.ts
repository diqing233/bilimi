import { describe, expect, it } from 'vitest'
import {
  applyFavoriteRepositoryCommand,
  createAccountFavoriteRepositorySnapshot
} from './favoriteRepository'

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
        id: 'workspace-1', accountMid: '00100', status: 'scanning', baselineRevision: 0, continuationAids: []
      }
    }, '2026-07-19T00:00:20.000Z')

    expect(result.workspace?.accountMid).toBe('100')
    expect(result.updatedAt).toBe('2026-07-19T00:00:20.000Z')
  })
})

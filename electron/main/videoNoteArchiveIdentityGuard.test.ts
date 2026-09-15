import { describe, expect, it } from 'vitest'
import {
  assertCurrentAccountOwnsArchiveEntry,
  assertCurrentAccountOwnsArchiveVersion,
  assertCurrentAccountOwnsVerifiedArchiveNote,
  assertArchiveVersionMatchesReplacementNote,
  filterVideoNoteArchivesForAccount
} from './videoNoteArchiveIdentityGuard'
import type { VideoNote, VideoNoteArchiveEntry } from '../../src/shared/types'

function note(source: Partial<VideoNote['source']> = {}): VideoNote {
  return {
    id: 'bvid:BV1verified',
    source: {
      accountMid: '42',
      aid: 7,
      cid: 70,
      bvid: 'BV1verified',
      title: 'Verified archive',
      url: 'https://www.bilibili.com/video/BV1verified',
      tags: [],
      ...source
    },
    transcriptSource: 'audio',
    transcript: [{ start: 0, end: 1, text: 'verified transcript' }],
    chapters: [],
    overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
    annotations: [], userMemo: '', starred: false,
    createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
  }
}

describe('verified video-note archive identity guard', () => {
  it('rejects a note captured by an account before the user switches accounts', () => {
    expect(() => assertCurrentAccountOwnsVerifiedArchiveNote('99', note())).toThrow('当前账号已切换')
  })

  it.each([
    ['accountMid', undefined],
    ['aid', undefined],
    ['cid', undefined],
    ['bvid', undefined]
  ] as const)('rejects verified archive writes without %s', (field, value) => {
    expect(() => assertCurrentAccountOwnsVerifiedArchiveNote('42', note({ [field]: value }))).toThrow('完整视频身份')
  })

  it('filters archive reads by version identity and rejects a foreign update or whole-entry delete', () => {
    const own = note()
    const foreign = note({ accountMid: '99', aid: 8, cid: 80, bvid: 'BV1foreign' })
    const archives = [{
      id: 'mixed', source: foreign.source, createdAt: own.createdAt, updatedAt: own.updatedAt,
      versions: [
        { id: 'own-version', createdAt: own.createdAt, note: own, plainTranscript: '', summaryText: '' },
        { id: 'foreign-version', createdAt: foreign.createdAt, note: foreign, plainTranscript: '', summaryText: '' }
      ]
    }] as VideoNoteArchiveEntry[]

    expect(filterVideoNoteArchivesForAccount(archives, '42')).toEqual([
      expect.objectContaining({ id: 'mixed', source: own.source, versions: [expect.objectContaining({ id: 'own-version' })] })
    ])
    expect(() => assertCurrentAccountOwnsArchiveVersion(archives, '42', 'mixed', 'foreign-version')).toThrow('当前账号')
    expect(() => assertCurrentAccountOwnsArchiveEntry(archives, '42', 'mixed')).toThrow('其他账号')
  })

  it('rejects replacing an owned archive version with a different video identity', () => {
    const existing = {
      id: 'version-1',
      createdAt: '2026-07-28T00:00:00.000Z',
      note: note(),
      plainTranscript: '',
      summaryText: ''
    }

    expect(() => assertArchiveVersionMatchesReplacementNote(existing, note({
      aid: 8,
      cid: 80,
      bvid: 'BV1different'
    }))).toThrow('同一视频')
    expect(() => assertArchiveVersionMatchesReplacementNote(existing, {
      ...note({ title: 'Edited title' }),
      userMemo: 'Edited memo'
    })).not.toThrow()
  })
})

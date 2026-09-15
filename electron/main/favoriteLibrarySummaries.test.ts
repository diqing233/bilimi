import { describe, expect, it } from 'vitest'
import { createFavoriteLibraryArchiveSummary, createFavoriteLibraryTranscriptionSummary } from './favoriteLibrarySummaries'

describe('favorite library summaries', () => {
  it('derives a compact archive summary from the matching stable video source', () => {
    expect(createFavoriteLibraryArchiveSummary('42', 7, [{
      id: 'archive-7', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7', tags: [] },
      createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T01:00:00.000Z',
      versions: [{
        id: 'v1', createdAt: '2026-07-20T01:00:00.000Z', plainTranscript: '', summaryText: '总结',
        note: { id: 'note', source: { accountMid: '42', title: 'Video', url: 'https://www.bilibili.com/video/av7', tags: [] },
          transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
          annotations: [], userMemo: '  稍后复习  ', starred: true, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T01:00:00.000Z' }
      }]
    }])).toEqual({
      status: '已入档', versionCount: 1, starred: true, hasMemo: true, memoPreview: '稍后复习',
      hasSummary: true, updatedAt: '2026-07-20T01:00:00.000Z'
    })
  })

  it('derives the current Chinese transcription status from the main-process queue', () => {
    expect(createFavoriteLibraryTranscriptionSummary('42', 7, [
      { id: 'old', accountMid: '999', aid: 7, url: 'https://www.bilibili.com/video/av7', title: 'Video', status: 'failed', createdAt: '', updatedAt: '' },
      { id: 'active', accountMid: '42', aid: '7', url: 'https://www.bilibili.com/video/av7', title: 'Video', status: 'running', createdAt: '', updatedAt: '' }
    ])).toEqual({ status: '正在转写' })
  })

  it('keeps a completed transcript distinct from a retryable archive registration failure', () => {
    expect(createFavoriteLibraryTranscriptionSummary('42', 7, [
      {
        id: 'account:42:aid:7:cid:70', accountMid: '42', aid: 7, cid: 70,
        url: 'https://www.bilibili.com/video/av7', title: 'Video', status: 'completed',
        createdAt: '', updatedAt: '', archiveRegistrationStatus: 'failed'
      } as never
    ])).toEqual({ status: '转写完成', archiveRegistrationFailed: true })
  })

  it('reports no archive after the matching archive is removed', () => {
    expect(createFavoriteLibraryArchiveSummary('42', 7, [])).toEqual({
      status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false
    })
  })
})

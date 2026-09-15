import { describe, expect, it } from 'vitest'
import type { VideoAudioTranscriptionQueueItem } from '../../src/shared/types'
import { assertCurrentAccountOwnsTranscriptionQueueItems, assertCurrentAccountOwnsTranscriptionRequest, filterTranscriptionQueueSnapshotForAccount } from './transcriptionQueueAccountGuard'

const item = (id: string, accountMid: string): VideoAudioTranscriptionQueueItem => ({
  id,
  accountMid,
  url: 'https://www.bilibili.com/video/BV1guard',
  title: 'Guarded video',
  bvid: 'BV1guard',
  aid: 7,
  cid: 70,
  status: 'completed',
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z'
})

describe('assertCurrentAccountOwnsTranscriptionQueueItems', () => {
  it('rejects an old-account queue item after an account switch', () => {
    expect(() => assertCurrentAccountOwnsTranscriptionQueueItems('200', [item('old', '100')], ['old']))
      .toThrow('当前账号已切换，无法操作原账号的转写任务。')
  })

  it('rejects a stale queue id instead of accepting an empty selection', () => {
    expect(() => assertCurrentAccountOwnsTranscriptionQueueItems('100', [item('current', '100')], ['missing']))
      .toThrow('转写任务已过期，请刷新后重试。')
  })

  it('accepts only ids owned by the current account', () => {
    expect(() => assertCurrentAccountOwnsTranscriptionQueueItems('100', [item('current', '100')], ['current']))
      .not.toThrow()
  })

  it('rejects a direct-transcription request captured before an account switch', () => {
    expect(() => assertCurrentAccountOwnsTranscriptionRequest('200', { accountMid: '100' }))
      .toThrow('当前账号已切换，无法创建原账号的转写任务。')
  })

  it('returns an account-scoped queue snapshot without an old account active id or completion count', () => {
    expect(filterTranscriptionQueueSnapshotForAccount({
      activeItemId: 'old', sessionCompletedCount: 4, items: [item('old', '100'), item('current', '200')]
    }, '200')).toMatchObject({ activeItemId: undefined, sessionCompletedCount: 0, items: [expect.objectContaining({ id: 'current' })] })
  })
})

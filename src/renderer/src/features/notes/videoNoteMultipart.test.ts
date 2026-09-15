import { describe, expect, it } from 'vitest'
import { normalizeMultipartVideoSnapshot } from './videoNoteMultipart'

const pages = [
  { page: 1, cid: 70, part: '开场说明', duration: 95 },
  { page: 2, cid: 71, part: '第二部分', duration: 125 }
]

describe('multipart video page parsing', () => {
  it('uses the URL p value instead of the page default CID', () => {
    expect(normalizeMultipartVideoSnapshot({
      url: 'https://www.bilibili.com/video/BV1part?p=2',
      aid: 7,
      bvid: 'BV1part',
      title: '分 P 测试视频',
      author: '测试 UP',
      pages
    })).toEqual({
      aid: 7,
      bvid: 'BV1part',
      title: '分 P 测试视频',
      author: '测试 UP',
      url: 'https://www.bilibili.com/video/BV1part?p=2',
      currentPart: { number: 2, cid: 71, title: '第二部分', durationSeconds: 125 },
      parts: [
        { number: 1, cid: 70, title: '开场说明', durationSeconds: 95 },
        { number: 2, cid: 71, title: '第二部分', durationSeconds: 125 }
      ]
    })
  })

  it('uses P1 only when the URL does not specify a P value', () => {
    expect(normalizeMultipartVideoSnapshot({
      url: 'https://www.bilibili.com/video/BV1part',
      aid: 7,
      bvid: 'BV1part',
      title: '分 P 测试视频',
      pages
    }).currentPart).toEqual({ number: 1, cid: 70, title: '开场说明', durationSeconds: 95 })
  })

  it('rejects an invalid requested part rather than silently enqueuing P1', () => {
    expect(() => normalizeMultipartVideoSnapshot({
      url: 'https://www.bilibili.com/video/BV1part?p=3',
      aid: 7,
      bvid: 'BV1part',
      title: '分 P 测试视频',
      pages
    })).toThrow('当前分 P 无效，请返回视频页面后重试。')
  })

  it('rejects a multipart selection when any part lacks a reliable CID', () => {
    expect(() => normalizeMultipartVideoSnapshot({
      url: 'https://www.bilibili.com/video/BV1part',
      aid: 7,
      bvid: 'BV1part',
      title: '分 P 测试视频',
      pages: [{ page: 1, cid: 70, part: '开场说明', duration: 95 }, { page: 2, part: '第二部分', duration: 125 }]
    })).toThrow('分 P 信息不完整，请刷新视频页面后重试。')
  })
})

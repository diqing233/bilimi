import { describe, expect, it, vi } from 'vitest'
import { fetchFavoriteVideoMetadata } from './favoriteVideoMetadata'

describe('fetchFavoriteVideoMetadata', () => {
  it('loads the description and confirmed tags for the requested aid', async () => {
    const fetch = vi.fn(async (url: URL | string) => {
      const value = String(url)
      if (value.includes('/x/web-interface/view')) {
        return Response.json({
          code: 0,
          data: {
            title: '完整标题',
            desc: '完整简介',
            bvid: 'BV1metadata',
            duration: 123,
            tname: '知识',
            pic: 'https://example.com/cover.jpg',
            owner: { name: '测试 UP' },
            pages: [{ cid: 711 }]
          }
        })
      }
      if (value.includes('/x/tag/archive/tags')) {
        return Response.json({
          code: 0,
          data: [{ tag_name: '教程' }, { tag_name: ' 知识 ' }, { tag_name: '教程' }]
        })
      }
      throw new Error(`Unexpected request: ${value}`)
    })
    const readCurrentAccountMid = vi.fn().mockResolvedValue('42')

    await expect(fetchFavoriteVideoMetadata({
      accountMid: '42',
      aid: 710,
      fetch,
      readCurrentAccountMid,
      now: () => '2026-07-31T00:00:00.000Z'
    })).resolves.toEqual({
      aid: 710,
      title: '完整标题',
      author: '测试 UP',
      description: '完整简介',
      tags: ['教程', '知识'],
      tagEvidence: 'confirmed',
      bvid: 'BV1metadata',
      cid: 711,
      durationSeconds: 123,
      category: '知识',
      coverUrl: 'https://example.com/cover.jpg',
      updatedAt: '2026-07-31T00:00:00.000Z'
    })
    expect(fetch).toHaveBeenNthCalledWith(1, expect.objectContaining({ pathname: '/x/web-interface/view' }))
    expect(fetch).toHaveBeenNthCalledWith(2, expect.objectContaining({ pathname: '/x/tag/archive/tags' }))
    expect(String((fetch.mock.calls[1] as unknown[])[0])).toContain('aid=710')
  })

  it('keeps the refresh usable without claiming empty tag evidence when the tag endpoint fails', async () => {
    const fetch = vi.fn(async (url: URL | string) => String(url).includes('/x/web-interface/view')
      ? Response.json({ code: 0, data: { title: '仍可刷新', owner: { name: '测试 UP' } } })
      : Response.json({ code: -1, message: 'tag unavailable' }, { status: 503 }))

    const result = await fetchFavoriteVideoMetadata({
      accountMid: '42',
      aid: 710,
      fetch,
      readCurrentAccountMid: vi.fn().mockResolvedValue('42'),
      now: () => '2026-07-31T00:00:00.000Z'
    })

    expect(result.tags).toEqual([])
    expect(result).not.toHaveProperty('tagEvidence')
  })
})

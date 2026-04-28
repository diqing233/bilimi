import { describe, expect, it, vi } from 'vitest'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { buildFavoriteApiFallbackScript } from './favoriteApiAutomation'

function installBilibiliPageState() {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    value: 'bili_jct=csrf-token; DedeUserID=32922854'
  })
  Object.defineProperty(window, '__INITIAL_STATE__', {
    configurable: true,
    value: {
      aid: 2,
      bvid: 'BV1xx411c7mD'
    }
  })
}

describe('buildFavoriteApiFallbackScript', () => {
  const favoriteLedgers = createDefaultFavoriteLedgers()

  it('creates the missing Bilimi category folder and favorites the current video through Bilibili APIs', async () => {
    installBilibiliPageState()

    const requests: Array<{ body?: string; method?: string; url: string }> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        body: init?.body?.toString(),
        method: init?.method,
        url
      })

      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: {
            list: [
              { id: 88459354, title: '默认收藏夹' },
              { id: 302454154, title: '科普相关' }
            ]
          },
          message: 'OK'
        })
      }

      if (url.includes('/x/v3/fav/folder/add')) {
        return Response.json({
          code: 0,
          data: {
            id: 91000001,
            title: 'Bilimi·见闻增广'
          },
          message: 'OK'
        })
      }

      if (url.includes('/x/v3/fav/resource/deal')) {
        return Response.json({ code: 0, data: {}, message: 'OK' })
      }

      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await window.eval(
      buildFavoriteApiFallbackScript(favoriteLedgers, 'knowledge')
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual([
      'api:favorite:list',
      'api:favorite:create-folder',
      'api:favorite:add'
    ])
    expect(requests[0].url).toContain('rid=2')
    expect(requests[1].body).toContain('title=Bilimi%C2%B7%E8%A7%81%E9%97%BB%E5%A2%9E%E5%B9%BF')
    expect(requests[2].body).toContain('rid=2')
    expect(requests[2].body).toContain('add_media_ids=91000001')
    expect(requests[2].body).toContain('csrf=csrf-token')
  })

  it('reuses an existing Bilimi category folder without creating another folder', async () => {
    installBilibiliPageState()

    const requests: Array<{ body?: string; method?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({
          body: init?.body?.toString(),
          method: init?.method,
          url
        })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 91000001, title: 'Bilimi·茶余解颐' },
                { id: 88459354, title: '默认收藏夹' }
              ]
            },
            message: 'OK'
          })
        }

        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: 0, data: {}, message: 'OK' })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildFavoriteApiFallbackScript(favoriteLedgers, 'humor'))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:favorite:list', 'api:favorite:add'])
    expect(requests.map((request) => request.url)).not.toContain(
      expect.stringContaining('/x/v3/fav/folder/add')
    )
    expect(requests[1].body).toContain('add_media_ids=91000001')
  })
})

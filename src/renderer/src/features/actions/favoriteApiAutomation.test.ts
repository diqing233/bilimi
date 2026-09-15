import { describe, expect, it, vi } from 'vitest'
import { afterEach } from 'vitest'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import {
  buildFavoriteApiAdjustmentScript,
  buildFavoriteApiFallbackScript
} from './favoriteApiAutomation'
import {
  buildCreateFavoriteLedgerPhysicalShardScript,
  buildFavoriteLedgerWriteCapacityScript
} from '../favorites/favoriteLedgerApi'

function installBilibiliPageState() {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    value: 'bili_jct=csrf-token; DedeUserID=42'
  })
  Object.defineProperty(window, '__INITIAL_STATE__', {
    configurable: true,
    value: {
      aid: 2,
      bvid: 'BV1xx411c7mD'
    }
  })
}

afterEach(() => {
  Reflect.deleteProperty(document, 'cookie')
  Reflect.deleteProperty(window, '__INITIAL_STATE__')
})

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
            title: 'bilimi·知识学习'
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
    expect(result.favoriteFolderIdsByLedgerId).toEqual({
      knowledge: '91000001'
    })
    expect(requests[0].url).toContain('rid=2')
    expect(requests[1].body).toContain(`title=${encodeURIComponent('bilimi·知识学习')}`)
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
                { id: 91000001, title: 'bilimi·影视动漫' },
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

    const result = await window.eval(buildFavoriteApiFallbackScript(favoriteLedgers, 'movie-tv'))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:favorite:list', 'api:favorite:add'])
    expect(result.favoriteFolderIdsByLedgerId).toEqual({
      'movie-tv': '91000001'
    })
    expect(requests.map((request) => request.url)).not.toContain(
      expect.stringContaining('/x/v3/fav/folder/add')
    )
    expect(requests[1].body).toContain('add_media_ids=91000001')
  })

  it('writes a review favorite to the available bound physical shard when the first shard is full', async () => {
    installBilibiliPageState()

    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game'
        ? {
            ...ledger,
            bilibiliFolderId: '91000001',
            bilibiliFolderIds: ['91000001', '91000002'],
            bindingState: 'bound' as const
          }
        : ledger
    )
    const requests: Array<{ body?: string; method?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), method: init?.method, url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 91000001, title: 'bilimi·游戏专区', media_count: 1000 },
                { id: 91000002, title: 'bilimi·游戏专区·2', media_count: 23 }
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

    const result = await window.eval(buildFavoriteApiFallbackScript(ledgers, 'game'))

    expect(result).toMatchObject({
      ok: true,
      favoriteFolderIdsByLedgerId: { game: '91000002' }
    })
    expect(requests[1].body).toContain('add_media_ids=91000002')
    expect(requests[1].body).not.toContain('add_media_ids=91000001')
  })

  it('requires explicit confirmation before creating the next bound physical shard', async () => {
    installBilibiliPageState()

    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: '91000001',
      bilibiliFolderIds: ['91000001'],
      bindingState: 'bound' as const
    }
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ body: init?.body?.toString(), url })
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({ code: 0, data: { list: [{ id: 91000001, title: 'bilimi·游戏专区', media_count: 1000 }] }, message: 'OK' })
      }
      if (url.includes('/x/v3/fav/folder/add')) {
        return Response.json({ code: 0, data: { id: 91000002 }, message: 'OK' })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const capacity = await window.eval(buildFavoriteLedgerWriteCapacityScript([game], ['game']))

    expect(capacity).toMatchObject({ ok: false, fullLedgerIds: ['game'] })
    expect(requests).toHaveLength(1)

    const creation = await window.eval(buildCreateFavoriteLedgerPhysicalShardScript(game))

    expect(creation).toMatchObject({
      ok: true,
      folder: { id: '91000002', title: 'bilimi·游戏专区②', shardNumber: 2 }
    })
    expect(requests.at(-1)?.body).toContain(`title=${encodeURIComponent('bilimi·游戏专区②')}`)
  })

  it('reports a missing formal bound shard instead of allowing a title-based fallback', async () => {
    installBilibiliPageState()

    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: '91000001',
      bilibiliFolderIds: ['91000001'],
      bindingState: 'bound' as const
    }
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ code: 0, data: { list: [] }, message: 'OK' })
    ))

    const result = await window.eval(buildFavoriteLedgerWriteCapacityScript([game], ['game']))

    expect(result).toMatchObject({
      ok: false,
      missingTargets: ['game']
    })
  })

  it('adds the current video to multiple planned Bilimi folders in one API deal request', async () => {
    installBilibiliPageState()

    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game'
        ? { ...ledger, bilibiliFolderId: '91000002' }
        : ledger.id === 'movie-tv'
          ? { ...ledger, bilibiliFolderId: '91000001' }
          : ledger
    )
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
                { id: 91000001, title: 'bilimi·影视动漫' },
                { id: 91000002, title: 'bilimi·游戏专区' }
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

    const result = await window.eval(
      buildFavoriteApiFallbackScript(ledgers, 'movie-tv', ['movie-tv', 'game'])
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:favorite:list', 'api:favorite:add'])
    expect(result.favoriteFolderIdsByLedgerId).toEqual({
      game: '91000002',
      'movie-tv': '91000001'
    })
    expect(requests[1].body).toContain('add_media_ids=91000001%2C91000002')
    expect(requests[1].body).toContain('del_media_ids=')
  })

  it('replaces the bilimi temporary folder while preserving ordinary user favorites', async () => {
    installBilibiliPageState()

    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge'
        ? { ...ledger, bilibiliFolderId: '91000001', bindingState: 'bound' as const }
        : ledger.id === 'inbox'
          ? { ...ledger, bilibiliFolderId: '91000008', bindingState: 'bound' as const }
          : ledger
    )
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
                { id: 91000001, title: 'bilimi·知识学习' },
                { id: 91000008, title: 'bilimi·暂存' },
                { id: 92000000, title: 'My personal favorites' }
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

    const result = await window.eval(
      buildFavoriteApiAdjustmentScript(ledgers, {
        addLedgerIds: ['knowledge'],
        removeLedgerIds: ['inbox'],
        aid: 710,
        accountMid: '42'
      })
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:favorite:adjust-list', 'api:favorite:adjust'])
    expect(result.favoriteFolderIdsByLedgerId).toEqual({
      inbox: '91000008',
      knowledge: '91000001'
    })
    expect(requests[1].body).toContain('rid=710')
    expect(requests[1].body).toContain('add_media_ids=91000001')
    expect(requests[1].body).toContain('del_media_ids=91000008')
    expect(requests[1].body).not.toContain('92000000')
  })

  it('uses only the formally bound shard id when a same-named ordinary folder exists', async () => {
    installBilibiliPageState()

    const game = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')!,
      bilibiliFolderId: 'bound-game-main',
      bilibiliFolderIds: ['bound-game-main', 'bound-game-2'],
      bindingState: 'bound' as const
    }
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ body: init?.body?.toString(), url })
      if (url.includes('/x/v3/fav/folder/created/list-all')) {
        return Response.json({
          code: 0,
          data: {
            list: [
              { id: 'ordinary-same-name', title: 'bilimi·游戏专区', media_count: 7 },
              { id: 'bound-game-main', title: 'bilimi·游戏专区', media_count: 1000 },
              { id: 'bound-game-2', title: 'bilimi·游戏专区·2', media_count: 7 }
            ]
          },
          message: 'OK'
        })
      }
      if (url.includes('/x/v3/fav/resource/deal')) {
        return Response.json({ code: 0, data: {}, message: 'OK' })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))

    const result = await window.eval(buildFavoriteApiAdjustmentScript([game], {
      addLedgerIds: ['game'],
      removeLedgerIds: [],
      aid: 710,
      accountMid: '42'
    }))

    expect(result).toMatchObject({
      ok: true,
      favoriteFolderIdsByLedgerId: { game: 'bound-game-2' }
    })
    expect(requests[1].body).toContain('add_media_ids=bound-game-2')
    expect(requests[1].body).not.toContain('ordinary-same-name')
    expect(requests.map((request) => request.url)).not.toContain(
      expect.stringContaining('/x/v3/fav/folder/add')
    )
  })

  it('marks the Bilibili toolbar favorite button active after API favorite succeeds', async () => {
    installBilibiliPageState()
    document.body.innerHTML = `
      <button class="video-fav" aria-label="收藏" title="收藏">
        <svg><path></path></svg>
        <span>1.5万</span>
      </button>
    `

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 91000001, title: 'bilimi·影视动漫' }]
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

    const result = await window.eval(buildFavoriteApiFallbackScript(favoriteLedgers, 'movie-tv'))
    const favoriteButton = document.querySelector('.video-fav') as HTMLElement
    const favoriteIcon = favoriteButton.querySelector('svg') as SVGElement

    expect(result.steps).toEqual(['api:favorite:list', 'api:favorite:add', 'api:favorite:sync-toolbar'])
    expect(favoriteButton).toHaveClass('active')
    expect(favoriteButton).toHaveAttribute('aria-label', '已收藏')
    expect(favoriteButton).toHaveAttribute('aria-pressed', 'true')
    expect(favoriteIcon.style.color).toBe('rgb(0, 174, 236)')
  })
})

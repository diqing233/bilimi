import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it, vi } from 'vitest'
import {
  buildEnsureFavoriteLedgersScript,
  buildExecuteFavoriteLedgerPlanScript,
  buildFavoriteLedgerStatusScript,
  buildSaveFavoriteLedgersScript,
  buildScanOldFavoritesScript
} from './favoriteLedgerApi'

function installCookies() {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    value: 'bili_jct=csrf-token; DedeUserID=32922854'
  })
}

describe('favorite ledger API scripts', () => {
  it('reports missing enabled Bilimi ledgers without creating them', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 1, title: ledgers[0].displayName }]
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildFavoriteLedgerStatusScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.missingLedgerIds).toEqual(
      ledgers
        .filter((ledger) => ledger.id !== 'animation' && ledger.enabled)
        .map((ledger) => ledger.id)
    )
    expect(result.ledgers.find((ledger) => ledger.id === 'animation')?.bilibiliFolderId).toBe('1')
  })

  it('creates only missing enabled ledgers', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 2)
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [{ id: 1, title: ledgers[0].displayName }] } })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: { id: 2, title: 'created' } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildEnsureFavoriteLedgersScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:game'])
    expect(requests.filter((request) => request.url.includes('/folder/add'))).toHaveLength(1)
    expect(requests[1].body).toContain('csrf=csrf-token')
    expect(requests[1].body).toContain('privacy=0')
    expect(requests[1].body).toContain(`title=${encodeURIComponent(ledgers[1].displayName)}`)
  })

  it('reports setup as incomplete when created ledgers still lack folder ids', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 2)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [{ id: 1, title: ledgers[0].displayName }] } })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildEnsureFavoriteLedgersScript(ledgers))

    expect(result.ok).toBe(false)
    expect(result.missingTargets).toEqual(['game'])
  })

  it('saves edited ledgers by creating missing enabled folders', async () => {
    installCookies()
    const previousLedgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))
    const nextLedgers = [
      previousLedgers[0],
      {
        ...createDefaultFavoriteLedgers()[1],
        id: 'custom-bilimi',
        displayName: 'Bilimi Custom',
        bilibiliFolderId: undefined,
        isDefault: false
      }
    ]
    const requests: Array<{ body?: string; url: string }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 9001, title: previousLedgers[0].displayName }]
            }
          })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: { id: 9002 } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildSaveFavoriteLedgersScript(nextLedgers, previousLedgers))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:custom-bilimi'])
    expect(requests.filter((request) => request.url.includes('/folder/add'))).toHaveLength(1)
    expect(requests[1].body).toContain('csrf=csrf-token')
    expect(requests[1].body).toContain('title=Bilimi+Custom')
    expect(result.ledgers.find((ledger) => ledger.id === 'custom-bilimi')?.bilibiliFolderId).toBe(
      '9002'
    )
  })

  it('only deletes removed Bilimi-managed folders when saving edited ledgers', async () => {
    installCookies()
    const baseLedgers = createDefaultFavoriteLedgers()
    const nextLedgers = [baseLedgers[0]]
    const previousLedgers = [
      baseLedgers[0],
      {
        ...baseLedgers[1],
        id: 'removed-bilimi',
        displayName: 'Bilimi Old',
        bilibiliFolderId: '9002',
        isDefault: false
      },
      {
        ...baseLedgers[2],
        id: 'removed-personal',
        displayName: 'Personal Old',
        bilibiliFolderId: '9003',
        isDefault: false
      },
      {
        ...baseLedgers[3],
        id: 'removed-default',
        displayName: 'Bilimi Default',
        bilibiliFolderId: '9004',
        isDefault: true
      }
    ]
    const requests: Array<{ body?: string; url: string }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 9001, title: baseLedgers[0].displayName },
                { id: 9002, title: 'Bilimi Old' },
                { id: 9003, title: 'Personal Old' },
                { id: 9004, title: 'Bilimi Default' }
              ]
            }
          })
        }

        if (url.includes('/x/v3/fav/folder/del')) {
          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildSaveFavoriteLedgersScript(nextLedgers, previousLedgers))

    const deleteRequests = requests.filter((request) => request.url.includes('/folder/del'))
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:delete:removed-bilimi'])
    expect(deleteRequests).toHaveLength(1)
    const body = new URLSearchParams(deleteRequests[0].body)
    expect(body.get('csrf')).toBe('csrf-token')
    expect(body.get('media_ids')).toBe('9002')
  })

  it('appends old favorites without passing delete media ids', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi路瑙侀椈澧炲箍',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 456,
          title: '已归册',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi路瑙侀椈澧炲箍',
          reviewRequired: false,
          alreadyInTarget: true,
          selected: true
        }
      ])
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:append:123'])
    expect(requests).toHaveLength(1)
    const body = new URLSearchParams(requests[0].body)
    expect(body.get('add_media_ids')).toBe('9001')
    expect(body.get('csrf')).toBe('csrf-token')
    expect(body.get('del_media_ids')).toBe('')
    expect(body.get('rid')).toBe('123')
    expect(body.get('type')).toBe('2')
    expect(body.get('platform')).toBe('web')
    expect(body.get('from_spmid')).toBe('')
    expect(body.get('spmid')).toBe('333.788.0.0')
    expect(body.get('statistics')).toBeTruthy()
  })

  it('returns structured failure when appending a favorite fails', async () => {
    installCookies()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: -101, message: '账号未登录', data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·见闻增广',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: [],
      missingTargets: ['favorite-ledger-api'],
      message: expect.stringContaining('账号未登录')
    })
  })

  it('scans old favorites without moving items from their source folders', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 2).map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: String(9001 + index)
    }))
    const requests: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requests.push(url)

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 101, title: 'Default Favorites' },
                { id: 9001, title: ledgers[0].displayName }
              ]
            }
          })
        }

        if (url.includes('media_id=101') && url.includes('pn=1')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 123,
                  title: 'Machine learning tutorial',
                  intro: 'A practical lesson',
                  upper: { name: 'AI Teacher' },
                  cnt_info: { collect: 42 },
                  ugc: { first_cid: 11 },
                  bvid: 'BV123',
                  page: 1,
                  attr: 0,
                  type: 2,
                  link: 'https://www.bilibili.com/video/BV123',
                  cover: 'https://i0.hdslb.com/bfs/archive/demo.jpg',
                  pubtime: 1710000000,
                  fav_time: 1720000000,
                  tags: ['AI', 'Tutorial'],
                  tname: 'Knowledge'
                }
              ],
              has_more: true
            }
          })
        }

        if (url.includes('media_id=101') && url.includes('pn=2')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 124,
                  title: 'Comedy sketch',
                  intro: 'Funny moment',
                  author: 'Comedy UP',
                  tags: [{ name: 'Funny' }, 'Sketch'],
                  category: 'Entertainment'
                }
              ],
              has_more: false
            }
          })
        }

        if (url.includes('media_id=9001')) {
          return Response.json({
            code: 0,
            data: {
              medias: [{ id: 123, title: 'Machine learning tutorial', intro: '' }],
              has_more: false
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.sourceFolders).toEqual([
      {
        id: '101',
        title: 'Default Favorites',
        videos: [
          {
            aid: 123,
            title: 'Machine learning tutorial',
            description: 'A practical lesson',
            author: 'AI Teacher',
            tags: ['AI', 'Tutorial'],
            category: 'Knowledge'
          },
          {
            aid: 124,
            title: 'Comedy sketch',
            description: 'Funny moment',
            author: 'Comedy UP',
            tags: ['Funny', 'Sketch'],
            category: 'Entertainment'
          }
        ]
      }
    ])
    expect(result.targetMembership).toEqual({ '9001': [123] })
    expect(result.steps).toEqual([
      'api:favorite:list',
      'api:favorite:scan-source:101',
      'api:favorite:scan-target:9001'
    ])
    expect(requests.some((url) => url.includes('/x/v3/fav/resource/deal'))).toBe(false)
  })

  it('reports a readable error when old favorite scan receives html instead of json', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return new Response('<!DOCTYPE html><html><body>login</body></html>', {
            headers: { 'content-type': 'text/html;charset=utf-8' },
            status: 200
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result).toMatchObject({
      ok: false,
      sourceFolders: [],
      targetMembership: {},
      missingTargets: ['favorite-ledger-api']
    })
    expect(result.message).toContain('favorite folder list returned HTML instead of JSON')
    expect(result.message).not.toContain('Unexpected token')
  })
})

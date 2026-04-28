import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it, vi } from 'vitest'
import {
  buildEnsureFavoriteLedgersScript,
  buildExecuteFavoriteLedgerPlanScript,
  buildFavoriteLedgerStatusScript
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
    expect(result.missingLedgerIds).toEqual(['humor', 'story', 'play', 'life', 'craft', 'music', 'inbox'])
    expect(result.ledgers.find((ledger) => ledger.id === 'knowledge')?.bilibiliFolderId).toBe('1')
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
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:humor'])
    expect(requests.filter((request) => request.url.includes('/folder/add'))).toHaveLength(1)
    expect(requests[1].body).toContain('csrf=csrf-token')
    expect(requests[1].body).toContain('privacy=0')
    expect(requests[1].body).toContain(`title=${encodeURIComponent(ledgers[1].displayName)}`)
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
    expect(requests[0].body).toContain('add_media_ids=9001')
    expect(requests[0].body).toContain('csrf=csrf-token')
    expect(requests[0].body).toContain('del_media_ids=')
    expect(requests[0].body).toContain('rid=123')
    expect(requests[0].body).toContain('type=2')
    expect(requests[0].body).toContain('platform=web')
    expect(requests[0].body).toContain('from_spmid=')
    expect(requests[0].body).toContain('spmid=333.788.0.0')
    expect(requests[0].body).toContain('statistics=')
    expect(requests[0].body).not.toContain('del_media_ids=9001')
  })
})

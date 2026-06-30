import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it, vi } from 'vitest'
import {
  buildEnsureFavoriteLedgersScript,
  buildExecuteFavoriteLedgerPlanScript,
  buildFavoriteLedgerStatusScript,
  buildSaveFavoriteLedgersScript,
  buildScanOldFavoriteVideoScript,
  buildScanOldFavoritesScript
} from './favoriteLedgerApi'

function installCookies() {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    value: 'bili_jct=csrf-token; DedeUserID=42'
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
        .filter((ledger) => ledger.id !== 'knowledge' && ledger.enabled)
        .map((ledger) => ledger.id)
    )
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

  it('recreates an enabled ledger when its stored folder id no longer exists during setup', async () => {
    installCookies()
    const inboxLedger = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'inbox')!,
      bilibiliFolderId: '9001'
    }
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: { id: 9002 } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildEnsureFavoriteLedgersScript([inboxLedger]))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:inbox'])
    expect(result.ledgers.find((ledger) => ledger.id === 'inbox')?.bilibiliFolderId).toBe('9002')
    const createRequest = requests.find((request) => request.url.includes('/folder/add'))
    expect(createRequest?.body).toContain(`title=${encodeURIComponent(inboxLedger.displayName)}`)
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

  it('recreates an enabled ledger when its stored folder id no longer exists while saving', async () => {
    installCookies()
    const inboxLedger = {
      ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'inbox')!,
      bilibiliFolderId: '9001'
    }
    const requests: Array<{ body?: string; url: string }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        if (url.includes('/x/v3/fav/folder/add')) {
          return Response.json({ code: 0, data: { id: 9002 } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildSaveFavoriteLedgersScript([inboxLedger], [inboxLedger]))

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:create:inbox'])
    expect(result.ledgers.find((ledger) => ledger.id === 'inbox')?.bilibiliFolderId).toBe('9002')
    const createRequest = requests.find((request) => request.url.includes('/folder/add'))
    expect(createRequest?.body).toContain(`title=${encodeURIComponent(inboxLedger.displayName)}`)
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

  it('deletes disabled Bilimi-managed folders while keeping them in preferences', async () => {
    installCookies()
    const baseLedgers = createDefaultFavoriteLedgers()
    const nextLedgers = [
      {
        ...baseLedgers[0],
        enabled: false,
        bilibiliFolderId: '9001'
      },
      {
        ...baseLedgers[1],
        displayName: '个人收藏夹',
        enabled: false,
        bilibiliFolderId: '9002',
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
              list: [
                { id: 9001, title: baseLedgers[0].displayName },
                { id: 9002, title: '个人收藏夹' }
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

    const result = await window.eval(buildSaveFavoriteLedgersScript(nextLedgers, nextLedgers))

    const deleteRequests = requests.filter((request) => request.url.includes('/folder/del'))
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list', 'api:ledger:delete:knowledge'])
    expect(deleteRequests).toHaveLength(1)
    expect(new URLSearchParams(deleteRequests[0].body).get('media_ids')).toBe('9001')
    const disabledLedger = result.ledgers.find((ledger) => ledger.id === 'knowledge')
    expect(disabledLedger).toEqual(
      expect.objectContaining({
        id: 'knowledge',
        enabled: false
      })
    )
    expect(disabledLedger).not.toHaveProperty('bilibiliFolderId')
    expect(result.ledgers.find((ledger) => ledger.id === 'game')?.bilibiliFolderId).toBe('9002')
  })

  it('keeps disabled Bilimi-managed folders when saving without disabled deletion', async () => {
    installCookies()
    const baseLedgers = createDefaultFavoriteLedgers()
    const nextLedgers = [
      {
        ...baseLedgers[0],
        enabled: false,
        bilibiliFolderId: '9001'
      },
      {
        ...baseLedgers[1],
        enabled: true,
        bilibiliFolderId: '9002'
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
                { id: 9002, title: baseLedgers[1].displayName }
              ]
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildSaveFavoriteLedgersScript(nextLedgers, nextLedgers, { deleteDisabled: false })
    )

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['api:ledger:list'])
    expect(requests.some((request) => request.url.includes('/folder/del'))).toBe(false)
    expect(result.ledgers.find((ledger) => ledger.id === 'knowledge')?.bilibiliFolderId).toBe('9001')
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

  it('paces repeated old favorite appends to avoid Bilibili protection', async () => {
    installCookies()
    const delays: number[] = []
    const originalSetTimeout = window.setTimeout
    vi.stubGlobal('setTimeout', ((callback: TimerHandler, delay?: number) => {
      delays.push(Number(delay ?? 0))
      if (typeof callback === 'function') {
        callback()
      }
      return 0
    }) as typeof setTimeout)
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
      buildExecuteFavoriteLedgerPlanScript(
        [
          {
            aid: 123,
            title: 'old favorite one',
            sourceFolderTitle: 'Default Favorites',
            targetLedgerId: 'knowledge',
            targetFolderId: '9001',
            targetDisplayName: 'Bilimi Knowledge',
            reviewRequired: false,
            alreadyInTarget: false,
            selected: true
          },
          {
            aid: 456,
            title: 'old favorite two',
            sourceFolderTitle: 'Default Favorites',
            targetLedgerId: 'knowledge',
            targetFolderId: '9001',
            targetDisplayName: 'Bilimi Knowledge',
            reviewRequired: false,
            alreadyInTarget: false,
            selected: true
          }
        ],
        {
          appendDelayMs: { min: 2500, max: 2500 },
          cooldownEvery: 99,
          cooldownDelayMs: { min: 30000, max: 30000 }
        }
      )
    )

    vi.stubGlobal('setTimeout', originalSetTimeout)

    expect(result.ok).toBe(true)
    expect(result.steps).toEqual([
      'api:ledger:append:123',
      'api:ledger:pace:2500',
      'api:ledger:append:456'
    ])
    expect(delays).toEqual([2500])
    expect(requests.filter((request) => request.url.includes('/x/v3/fav/resource/deal'))).toHaveLength(2)
  })

  it('pauses old favorite execution when Bilibili protection is detected', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: -509, message: 'request too fast', data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: 'old favorite one',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 456,
          title: 'old favorite two',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: ['api:ledger:protection-paused:123'],
      missingTargets: ['favorite-ledger-protection'],
      paused: true,
      completedCount: 0,
      failedCount: 1,
      remainingCount: 1
    })
    expect(result.message).toContain('paused')
    expect(requests.filter((request) => request.url.includes('/x/v3/fav/resource/deal'))).toHaveLength(1)
  })

  it('asks the user to sync when confirming old favorites without a target folder id', async () => {
    installCookies()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '待分类旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetDisplayName: 'Bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: [],
      missingTargets: ['inbox']
    })
    expect(result.message).toContain('掌库和 B 站收藏夹不一致')
    expect(result.message).toContain('请先同步掌库')
  })

  it('refreshes a newly synced generated ledger folder id before appending old favorites', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 9010, title: 'Bilimi·摄影' }]
            }
          })
        }

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
          title: '光影构图入门',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'custom-tag-cluster-摄影',
          targetDisplayName: 'Bilimi·摄影',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          selectedCandidateTarget: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: true,
      steps: ['api:ledger:append-refresh:123', 'api:ledger:append:123'],
      missingTargets: []
    })
    const appendBody = new URLSearchParams(
      requests.find((request) => request.url.includes('/x/v3/fav/resource/deal'))?.body
    )
    expect(appendBody.get('add_media_ids')).toBe('9010')
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
      steps: ['api:ledger:append-failed:123'],
      missingTargets: ['favorite-ledger-append:123'],
      message: expect.stringContaining('账号未登录')
    })
  })

  it('asks the user to sync when a stale target folder id cannot be refreshed before retry', async () => {
    installCookies()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/x/v3/fav/resource/deal')) {
          return Response.json({ code: 62002, message: '目标收藏夹不存在', data: {} })
        }

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        throw new Error(`Unexpected request: ${url} ${init?.body?.toString() ?? ''}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '待分类旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: ['api:ledger:append-failed:123'],
      missingTargets: ['favorite-ledger-append:123']
    })
    expect(result.message).toContain('掌库和 B 站收藏夹不一致')
    expect(result.message).toContain('请先同步掌库')
  })

  it('continues appending old favorites when one selected item no longer exists', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/resource/deal')) {
          const body = new URLSearchParams(init?.body?.toString())
          if (body.get('rid') === '123') {
            return Response.json({ code: 62002, message: '您访问的内容不存在', data: {} })
          }

          return Response.json({ code: 0, data: {} })
        }

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '失效旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 456,
          title: '可归册旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: ['api:ledger:append-failed:123', 'api:ledger:append:456'],
      missingTargets: ['favorite-ledger-append:123']
    })
    expect(result.message).toContain('partially completed')
    expect(result.message).toContain('1 appended')
    expect(result.message).toContain('1 failed')
    expect(requests.filter((request) => request.url.includes('/x/v3/fav/resource/deal'))).toHaveLength(2)
  })

  it('summarizes repeated html append failures with one login hint', async () => {
    installCookies()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/resource/deal')) {
          return new Response('<!DOCTYPE html><html><body>login</body></html>', {
            headers: { 'content-type': 'text/html;charset=utf-8' },
            status: 200
          })
        }

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({ code: 0, data: { list: [] } })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '旧藏甲',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 456,
          title: '旧藏乙',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: false,
      steps: ['api:ledger:append-failed:123', 'api:ledger:append-failed:456'],
      missingTargets: ['favorite-ledger-append:123', 'favorite-ledger-append:456']
    })
    expect(result.message).toContain('0 appended, 2 failed')
    expect(result.message).toContain('旧藏甲')
    expect(result.message).toContain('旧藏乙')
    expect(result.message.match(/Please log in to Bilibili again/g)).toBeNull()
    expect(result.message.match(/请重新登录 Bilibili/g)).toHaveLength(1)
  })

  it('refreshes a stale target folder id and retries an old favorite append once', async () => {
    installCookies()
    const requests: Array<{ body?: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ body: init?.body?.toString(), url })

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 9009, title: 'Bilimi·知识' }]
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/deal')) {
          const body = new URLSearchParams(init?.body?.toString())
          if (body.get('add_media_ids') === '9001') {
            return Response.json({ code: 62002, message: '您访问的内容不存在', data: {} })
          }

          return Response.json({ code: 0, data: {} })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(
      buildExecuteFavoriteLedgerPlanScript([
        {
          aid: 123,
          title: '可归册旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ])
    )

    expect(result).toMatchObject({
      ok: true,
      steps: ['api:ledger:append-retry:123', 'api:ledger:append:123'],
      missingTargets: []
    })
    const appendBodies = requests
      .filter((request) => request.url.includes('/x/v3/fav/resource/deal'))
      .map((request) => new URLSearchParams(request.body))
    expect(appendBodies.map((body) => body.get('add_media_ids'))).toEqual(['9001', '9009'])
    expect(appendBodies[1].get('del_media_ids')).toBe('')
  })

  it('scans old favorites and Bilimi target folders without moving source items', async () => {
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
                  category: 'Entertainment',
                  type: 2
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
              medias: [{ id: 123, title: 'Machine learning tutorial', intro: '', type: 2 }],
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
      },
      {
        id: '9001',
        title: ledgers[0].displayName,
        videos: [
          {
            aid: 123,
            title: 'Machine learning tutorial',
            description: '',
            author: '',
            tags: [],
            category: ''
          }
        ]
      }
    ])
    expect(result.targetMembership).toEqual({ '9001': [123] })
    expect(result.steps).toEqual([
      'api:favorite:list',
      'api:favorite:scan-source:101',
      'api:favorite:scan-target:9001',
      'api:favorite:scan-source:9001'
    ])
    expect(requests.some((url) => url.includes('/x/v3/fav/resource/deal'))).toBe(false)
  })

  it('fills missing old favorite tags from the Bilibili tag detail API', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1)
    const requests: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requests.push(url)

        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 101, title: 'Default Favorites' }]
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/list')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 123,
                  title: '角色配队',
                  intro: '深渊配队记录',
                  upper: { name: 'Genshin UP' },
                  type: 2
                }
              ],
              has_more: false
            }
          })
        }

        if (url.includes('/x/tag/archive/tags') && url.includes('aid=123')) {
          return Response.json({
            code: 0,
            data: [{ tag_name: '原神' }, { name: '攻略' }]
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.sourceFolders[0].videos[0]).toMatchObject({
      aid: 123,
      title: '角色配队',
      tags: ['原神', '攻略']
    })
    expect(requests.some((url) => url.includes('/x/tag/archive/tags') && url.includes('aid=123'))).toBe(true)
  })

  it('reports tag detail failures so scans do not silently lose high-frequency tags', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 101, title: 'Default Favorites' }]
            }
          })
        }

        if (url.includes('/x/v3/fav/resource/list')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 123,
                  title: 'Tag limited video',
                  intro: '',
                  upper: { name: 'Limited UP' },
                  type: 2
                }
              ],
              has_more: false
            }
          })
        }

        if (url.includes('/x/tag/archive/tags') && url.includes('aid=123')) {
          return new Response('<!DOCTYPE html><html><body>risk control</body></html>', {
            headers: { 'content-type': 'text/html;charset=utf-8' },
            status: 200
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.sourceFolders[0].videos[0]).toMatchObject({
      aid: 123,
      tags: []
    })
    expect(result.scanDiagnostics).toMatchObject({
      tagDetailRequests: 1,
      tagDetailFailures: 1,
      taggedVideos: 0,
      untaggedVideos: 1
    })
  })

  it('refreshes one old favorite video with latest tags and target membership without appending favorites', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game' ? { ...ledger, bilibiliFolderId: '9002' } : ledger
    )
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
                { id: 101, title: 'Default Favorites' },
                { id: 9002, title: 'Bilimi·游戏专区' }
              ]
            }
          })
        }

        if (url.includes('media_id=101')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                {
                  id: 250,
                  title: '用户刚补了标签',
                  intro: '新补标签后应该进游戏区',
                  upper: { name: '游戏 UP' },
                  type: 2
                }
              ],
              has_more: false
            }
          })
        }

        if (url.includes('media_id=9002')) {
          return Response.json({
            code: 0,
            data: {
              medias: [{ id: 250, title: '用户刚补了标签', type: 2 }],
              has_more: false
            }
          })
        }

        if (url.includes('/x/tag/archive/tags') && url.includes('aid=250')) {
          return Response.json({
            code: 0,
            data: [{ name: '原神' }, { tag_name: '攻略' }]
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoriteVideoScript(ledgers, 250))

    expect(result.ok).toBe(true)
    expect(result.sourceFolders).toEqual([
      {
        id: '101',
        title: 'Default Favorites',
        videos: [
          {
            aid: 250,
            title: '用户刚补了标签',
            description: '新补标签后应该进游戏区',
            author: '游戏 UP',
            tags: ['原神', '攻略'],
            category: ''
          }
        ]
      }
    ])
    expect(result.targetMembership).toEqual({ '9002': [250] })
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'api:favorite:list',
        'api:favorite:scan-video-source:101',
        'api:favorite:scan-video-target:9002'
      ])
    )
    expect(requests.some((request) => request.url.includes('/x/v3/fav/resource/deal'))).toBe(false)
  })

  it('scans Bilimi ledgers as both target membership folders and old favorite sources', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      if (ledger.id === 'knowledge') {
        return { ...ledger, bilibiliFolderId: '9001' }
      }
      return ledger
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 101, title: 'Default Favorites' },
                { id: 9001, title: 'Bilimi·知识' },
                { id: 9008, title: 'Bilimi·待分类' }
              ]
            }
          })
        }

        if (url.includes('media_id=101')) {
          return Response.json({
            code: 0,
            data: {
              medias: [{ id: 123, title: 'Machine learning tutorial', type: 2 }],
              has_more: false
            }
          })
        }

        if (url.includes('media_id=9001')) {
          return Response.json({
            code: 0,
            data: {
              medias: [{ id: 789, title: 'Knowledge archive tutorial', type: 2 }],
              has_more: false
            }
          })
        }

        if (url.includes('media_id=9008')) {
          return Response.json({
            code: 0,
            data: {
              medias: [{ id: 456, title: 'Inbox tutorial', tags: ['学习'], type: 2 }],
              has_more: false
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.sourceFolders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: '101', title: 'Default Favorites' }),
        expect.objectContaining({
          id: '9001',
          title: 'Bilimi·知识',
          videos: [expect.objectContaining({ aid: 789, title: 'Knowledge archive tutorial' })]
        }),
        expect.objectContaining({
          id: '9008',
          title: 'Bilimi·待分类',
          videos: [expect.objectContaining({ aid: 456, title: 'Inbox tutorial' })]
        })
      ])
    )
    expect(result.targetMembership).toMatchObject({
      '9001': [789],
      '9008': [456]
    })
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'api:favorite:scan-source:9001',
        'api:favorite:scan-source:9008',
        'api:favorite:scan-target:9008'
      ])
    )
  })

  it('scans only video resources from old favorite folders', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [{ id: 101, title: 'Default Favorites' }]
            }
          })
        }

        if (url.includes('media_id=101')) {
          return Response.json({
            code: 0,
            data: {
              medias: [
                { id: 123, title: 'Video tutorial', intro: 'video', type: 2 },
                { id: 223, title: 'Bangumi episode', intro: 'episode', type: 24 },
                { id: 323, title: 'Article note', intro: 'article', type: 12 },
                { id: 423, title: 'Missing video', intro: 'missing', type: 2, attr: 9 },
                { id: 523, title: 'Link video', intro: 'video by link', link: 'https://www.bilibili.com/video/BV123' }
              ],
              has_more: false
            }
          })
        }

        throw new Error(`Unexpected request: ${url}`)
      })
    )

    const result = await window.eval(buildScanOldFavoritesScript(ledgers))

    expect(result.ok).toBe(true)
    expect(result.sourceFolders[0].videos.map((video) => video.title)).toEqual([
      'Video tutorial',
      'Link video'
    ])
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

  it('continues scanning old favorites when one resource folder returns html', async () => {
    installCookies()
    const ledgers = createDefaultFavoriteLedgers().slice(0, 1).map((ledger) => ({
      ...ledger,
      bilibiliFolderId: '9001'
    }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/x/v3/fav/folder/created/list-all')) {
          return Response.json({
            code: 0,
            data: {
              list: [
                { id: 101, title: 'Default Favorites' },
                { id: 102, title: 'Login Redirect Favorites' }
              ]
            }
          })
        }

        if (url.includes('media_id=101')) {
          return Response.json({
            code: 0,
            data: {
              medias: [{ id: 123, title: 'Video tutorial', intro: 'video', type: 2 }],
              has_more: false
            }
          })
        }

        if (url.includes('media_id=102')) {
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
      ok: true,
      skippedSourceFolderTitles: ['Login Redirect Favorites'],
      sourceFolders: [
        {
          id: '101',
          title: 'Default Favorites',
          videos: [expect.objectContaining({ aid: 123, title: 'Video tutorial' })]
        }
      ],
      missingTargets: []
    })
    expect(result.steps).toEqual([
      'api:favorite:list',
      'api:favorite:scan-source:101',
      'api:favorite:scan-source-failed:102'
    ])
    expect(result.message).toContain('skipped 1 folder')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { executeAssistantAction } from './actionExecutor'

describe('executeAssistantAction', () => {
  const favoriteLedgers = createDefaultFavoriteLedgers()

  it('uses the Bilibili favorite API directly for 藏 in api-assisted mode', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:favorite:list', 'api:favorite:add'],
      missingTargets: [],
      message: '已用 B 站接口归入 bilimi 收藏夹。'
    })

    const result = await executeAssistantAction({
      action: '藏',
      runScript,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv'
    })

    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runScript.mock.calls[0][0]).toContain('/x/v3/fav/resource/deal')
    expect(runScript.mock.calls[0][0]).not.toContain('favorite:open')
    expect(result).toEqual(expect.objectContaining({ ok: true }))
  })

  it('keeps page actions for 赏 but skips the page favorite dialog in api-assisted mode', async () => {
    const runScript = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        steps: ['like'],
        missingTargets: [],
        message: '点赞已完成。'
      })
      .mockResolvedValueOnce({
        ok: true,
        steps: ['api:favorite:list', 'api:favorite:add'],
        missingTargets: [],
        message: '已用 B 站接口归入 bilimi 收藏夹。'
      })

    const result = await executeAssistantAction({
      action: '赏',
      runScript,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv'
    })

    expect(runScript).toHaveBeenCalledTimes(2)
    expect(runScript.mock.calls[0][0]).toContain('"skipFavorite":true')
    expect(runScript.mock.calls[0][0]).not.toContain('favorite:open')
    expect(runScript.mock.calls[1][0]).toContain('/x/v3/fav/resource/deal')
    expect(result).toEqual(expect.objectContaining({ ok: true }))
  })

  it('does not call the favorite API when the selected rules are not provisioned', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['like'],
      missingTargets: [],
      message: '点赞已完成。'
    })

    const result = await executeAssistantAction({
      action: '赏',
      runScript,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv',
      favoriteProvisioned: false
    })

    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runScript.mock.calls[0][0]).toContain('"skipFavorite":true')
    expect(runScript.mock.calls[0][0]).not.toContain('/x/v3/fav/resource/deal')
    expect(result.message).toContain('备册或重新绑定')
  })

  it('runs favorite-only automation for 藏', async () => {
    const runScript = vi.fn().mockResolvedValueOnce({
      ok: true,
      steps: ['api:favorite:list', 'api:favorite:add'],
      missingTargets: [],
      message: '已用 B 站接口归入 bilimi 收藏夹。'
    })

    const result = await executeAssistantAction({
      action: '藏',
      runScript,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv'
    })

    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runScript.mock.calls[0][0]).toContain('/x/v3/fav/resource/deal')
    expect(runScript.mock.calls[0][0]).toContain('bilimi·影视动漫')
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['api:favorite:list', 'api:favorite:add'])
    )
    expect(result.message).toBe('已归类存入 bilimi·影视动漫。')
  })

  it('passes multiple planned Bilimi archive targets to the API confirmation layer', async () => {
    const runScript = vi.fn().mockResolvedValueOnce({
      ok: true,
      steps: ['api:favorite:list', 'api:favorite:add'],
      missingTargets: [],
      message: '已用 B 站接口归入 bilimi 收藏夹。'
    })

    const result = await executeAssistantAction({
      action: '藏',
      runScript,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv',
      targetLedgerIds: ['movie-tv', 'game']
    })

    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runScript.mock.calls[0][0]).toContain('"targetLedgerIds":["movie-tv","game"]')
    expect(result.ok).toBe(true)
  })

  it('prefixes the automation result message when a pre-action review adjusted the target', async () => {
    const runScript = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        steps: ['favorite:open', 'favorite:folder', 'favorite'],
        missingTargets: [],
        message: '收藏已入库。'
      })
      .mockResolvedValueOnce({
        ok: true,
        steps: ['api:favorite:list', 'api:favorite:add'],
        missingTargets: [],
        message: '已用 B 站接口归入 bilimi 收藏夹。'
      })

    const result = await executeAssistantAction({
      action: '藏',
      runScript,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'life-interest',
      targetLedgerIds: ['life-interest'],
      resultMessagePrefix: 'DeepSeek 建议改归 bilimi·生活日常：旅行攻略更匹配。'
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: 'DeepSeek 建议改归 bilimi·生活日常：旅行攻略更匹配。\n已归类存入 bilimi·生活日常。'
      })
    )
  })

  it('runs 点赞 + 收藏 for 赏', async () => {
    const runScript = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        steps: ['like', 'favorite'],
        missingTargets: [],
        message: '轻赏已入库。'
      })
      .mockResolvedValueOnce({
        ok: true,
        steps: ['api:favorite:list', 'api:favorite:add'],
        missingTargets: [],
        message: '已用 B 站接口归入 bilimi 收藏夹。'
      })

    const result = await executeAssistantAction({
      action: '赏',
      runScript,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv'
    })

    expect(runScript).toHaveBeenCalledTimes(2)
    expect(runScript.mock.calls[1][0]).toContain('/x/v3/fav/resource/deal')
    expect(runScript.mock.calls[1][0]).toContain('bilimi·影视动漫')
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like', 'favorite', 'api:favorite:list', 'api:favorite:add'])
    )
    expect(result.message).toBe('已点赞，归类存入 bilimi·影视动漫。')
  })

  it('falls back to visual favorite automation when DOM creation cannot find targets', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: false,
      steps: ['like', 'favorite:open'],
      missingTargets: ['favorite-create-button'],
      message: '尚有 favorite-create-button 未能寻见。'
    })
    const runVisualFallback = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['visual:favorite:open', 'visual:favorite:create'],
      missingTargets: [],
      message: '已用屏幕识别创建收藏夹。'
    })

    const result = await executeAssistantAction({
      action: '赏',
      runScript,
      runVisualFallback,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv',
      favoriteApiFallbackEnabled: false
    })

    expect(runVisualFallback).toHaveBeenCalledWith(
      {
        favoritesFolderName: 'bilimi 内库',
        targetLedgerId: 'movie-tv',
        favoriteFolders: expect.objectContaining({
          'movie-tv': 'bilimi·影视动漫'
        })
      },
      { openWithShortcut: true }
    )
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like', 'favorite:open', 'visual:favorite:create'])
    )
  })

  it('uses the Bilibili API directly without visual automation for 藏', async () => {
    const runScript = vi.fn().mockResolvedValueOnce({
      ok: true,
      steps: ['api:favorite:list', 'api:favorite:create-folder', 'api:favorite:add'],
      missingTargets: [],
      message: '已用 B 站接口归入 bilimi 收藏夹。'
    })
    const runVisualFallback = vi.fn()

    const result = await executeAssistantAction({
      action: '藏',
      runScript,
      runVisualFallback,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'knowledge'
    })

    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runScript.mock.calls[0][0]).toContain('/x/v3/fav/resource/deal')
    expect(runScript.mock.calls[0][0]).toContain('bilimi·知识学习')
    expect(runVisualFallback).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['api:favorite:create-folder', 'api:favorite:add'])
    )
  })

  it('uses the Bilibili API fallback for 赐 when the page reports an already-collected video', async () => {
    const runScript = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        steps: ['like', 'favorite:already-collected', 'coin:open', 'coin:2', 'coin:confirm'],
        missingTargets: ['favorite-api-required'],
        message: '当前视频已收藏，需用接口确认 Bilimi 分组。'
      })
      .mockResolvedValueOnce({
        ok: true,
        steps: ['api:favorite:list', 'api:favorite:add'],
        missingTargets: [],
        message: '已用 B 站接口归入 bilimi 收藏夹。'
      })
    const runVisualFallback = vi.fn()

    const result = await executeAssistantAction({
      action: '赐',
      runScript,
      runVisualFallback,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv',
      coinCount: 2
    })

    expect(runScript).toHaveBeenCalledTimes(2)
    expect(runScript.mock.calls[1][0]).toContain('/x/v3/fav/resource/deal')
    expect(runScript.mock.calls[1][0]).toContain('bilimi·影视动漫')
    expect(runVisualFallback).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'favorite:already-collected',
        'coin:confirm',
        'api:favorite:list',
        'api:favorite:add'
      ])
    )
  })

  it('confirms the target Bilimi folder through the API after a successful 赐 DOM flow', async () => {
    const runScript = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        steps: ['like', 'favorite:open', 'favorite:folder', 'favorite', 'coin:open', 'coin:2', 'coin:confirm'],
        missingTargets: [],
        message: '厚赐已成。'
      })
      .mockResolvedValueOnce({
        ok: true,
        steps: ['api:favorite:list', 'api:favorite:add'],
        missingTargets: [],
        message: '已用 B 站接口归入 bilimi 收藏夹。'
      })
    const runVisualFallback = vi.fn()

    const result = await executeAssistantAction({
      action: '赐',
      runScript,
      runVisualFallback,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv',
      coinCount: 2
    })

    expect(runScript).toHaveBeenCalledTimes(2)
    expect(runScript.mock.calls[1][0]).toContain('/x/v3/fav/resource/deal')
    expect(runScript.mock.calls[1][0]).toContain('bilimi·影视动漫')
    expect(runVisualFallback).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite', 'coin:confirm', 'api:favorite:list', 'api:favorite:add'])
    )
    expect(result.message).toBe('已一键三连，归类存入 bilimi·影视动漫。')
  })

  it('uses shortcut-driven visual favorite automation instead of the API when page clicks only are requested', async () => {
    const runScript = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        steps: ['favorite:open'],
        missingTargets: ['favorite-create-button'],
        message: '尚有 favorite-create-button 未能寻见。'
      })
      .mockResolvedValueOnce({
        ok: true,
        steps: ['api:favorite:list', 'api:favorite:add'],
        missingTargets: [],
        message: '已用 B 站接口归入 bilimi 收藏夹。'
      })
    const runVisualFallback = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['visual:favorite:shortcut:e', 'visual:favorite:select-folder', 'visual:favorite:confirm'],
      missingTargets: [],
      message: '已用屏幕识别和键鼠操作处理收藏夹。'
    })

    const result = await executeAssistantAction({
      action: '藏',
      runScript,
      runVisualFallback,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'knowledge',
      favoriteApiFallbackEnabled: false
    })

    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runScript.mock.calls[0][0]).toContain('"action":"藏"')
    expect(runScript.mock.calls[0][0]).not.toContain('/x/v3/fav/resource/deal')
    expect(runVisualFallback).toHaveBeenCalledWith(
      {
        favoriteFolders: expect.objectContaining({
          knowledge: 'bilimi·知识学习'
        }),
        favoritesFolderName: 'bilimi 内库',
        targetLedgerId: 'knowledge'
      },
      expect.objectContaining({ openWithShortcut: true })
    )
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:open', 'visual:favorite:shortcut:e', 'visual:favorite:confirm'])
    )
  })

  it('does not run visual favorite fallback when page-click-only DOM automation already succeeds', async () => {
    const runScript = vi.fn().mockResolvedValueOnce({
      ok: true,
      steps: ['like', 'favorite:open', 'favorite:folder', 'favorite'],
      missingTargets: [],
      message: '轻赏已入内库。'
    })
    const runVisualFallback = vi.fn()

    const result = await executeAssistantAction({
      action: '赏',
      runScript,
      runVisualFallback,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv',
      favoriteApiFallbackEnabled: false
    })

    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runVisualFallback).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      steps: ['like', 'favorite:open', 'favorite:folder', 'favorite'],
      missingTargets: [],
      message: '已点赞，归类存入 bilimi·影视动漫。'
    })
  })

  it('uses the trusted visible danmaku bar path before page automation for direct publish', async () => {
    const runScript = vi.fn()
    const runTrustedDanmakuSubmitFallback = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['player:activate-click', 'danmaku:trusted-enter-open', 'danmaku:trusted-paste', 'danmaku:trusted-enter'],
      missingTargets: [],
      message: '弹幕已发送，没有看到请检查弹幕开关是否开启'
    })

    const result = await executeAssistantAction({
      action: '表',
      runScript,
      runTrustedDanmakuSubmitFallback,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv',
      commentDraft: 'trusted enter fallback',
      submitComment: true
    })

    expect(runScript).not.toHaveBeenCalled()
    expect(runTrustedDanmakuSubmitFallback).toHaveBeenCalledWith('trusted enter fallback')
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'danmaku:trusted-enter-open',
        'danmaku:trusted-paste',
        'danmaku:trusted-enter'
      ])
    )
    expect(result.missingTargets).toEqual([])
  })

  it('does not run page automation when direct danmaku has a trusted visible-bar fallback', async () => {
    const runScript = vi.fn()
    const runTrustedDanmakuSubmitFallback = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['danmaku:trusted-enter-open', 'danmaku:trusted-paste', 'danmaku:trusted-enter'],
      missingTargets: [],
      message: '弹幕已发送，没有看到请检查弹幕开关是否开启'
    })

    const result = await executeAssistantAction({
      action: '表',
      runScript,
      runTrustedDanmakuSubmitFallback,
      favoritesFolderName: 'bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'movie-tv',
      commentDraft: 'keyboard danmaku fallback',
      submitComment: true
    })

    expect(runScript).not.toHaveBeenCalled()
    expect(runTrustedDanmakuSubmitFallback).toHaveBeenCalledWith('keyboard danmaku fallback')
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining([
        'danmaku:trusted-enter-open',
        'danmaku:trusted-paste',
        'danmaku:trusted-enter'
      ])
    )
    expect(result.missingTargets).toEqual([])
  })

  it('times out a hung favorite API without disturbing the page through visual fallback', async () => {
    vi.useFakeTimers()

    const runScript = vi.fn(
      () =>
        new Promise<never>(() => {
          // Simulates Bilibili navigating while executeJavaScript is pending.
        })
    )
    const runVisualFallback = vi.fn().mockResolvedValue({
      ok: false,
      steps: ['visual:favorite:open'],
      missingTargets: ['visual-create-folder'],
      message: '视觉兜底继续定位收藏夹。'
    })

    try {
      const resultPromise = executeAssistantAction({
        action: '藏',
        runScript,
        runVisualFallback,
        favoritesFolderName: 'bilimi 内库',
        favoriteLedgers,
        targetLedgerId: 'movie-tv'
      })

      await vi.advanceTimersByTimeAsync(15_001)
      const result = await resultPromise

      expect(runScript).toHaveBeenCalledTimes(1)
      expect(runVisualFallback).not.toHaveBeenCalled()
      expect(result.ok).toBe(false)
      expect(result.steps).toEqual(expect.arrayContaining(['dom:timeout']))
      expect(result.missingTargets).toEqual(['favorite-timeout'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the 15-second page fallback threshold and reports a friendly message', async () => {
    vi.useFakeTimers()

    const runScript = vi.fn(
      () =>
        new Promise<never>(() => {
          // Simulates a page script that never settles.
        })
    )

    try {
      let settled = false
      const resultPromise = executeAssistantAction({
        action: '表',
        runScript,
        favoritesFolderName: 'bilimi 内库',
        favoriteLedgers,
        targetLedgerId: 'movie-tv'
      }).then((result) => {
        settled = true
        return result
      })

      await vi.advanceTimersByTimeAsync(14_999)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        steps: ['dom:timeout'],
        message: '页面响应较慢，已尝试屏幕操作。'
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

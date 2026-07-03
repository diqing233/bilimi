import { describe, expect, it, vi } from 'vitest'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { executeAssistantAction } from './actionExecutor'

describe('executeAssistantAction', () => {
  const favoriteLedgers = createDefaultFavoriteLedgers()

  it('runs favorite-only automation for 藏', async () => {
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
      targetLedgerId: 'movie-tv'
    })

    expect(runScript).toHaveBeenCalledTimes(2)
    expect(runScript.mock.calls[0][0]).toContain('"action":"藏"')
    expect(runScript.mock.calls[1][0]).toContain('/x/v3/fav/resource/deal')
    expect(runScript.mock.calls[1][0]).toContain('bilimi·影视动漫')
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:open', 'favorite', 'api:favorite:list', 'api:favorite:add'])
    )
  })

  it('passes multiple planned Bilimi archive targets to the API confirmation layer', async () => {
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
      targetLedgerId: 'movie-tv',
      targetLedgerIds: ['movie-tv', 'game']
    })

    expect(runScript).toHaveBeenCalledTimes(2)
    expect(runScript.mock.calls[1][0]).toContain('"targetLedgerIds":["movie-tv","game"]')
    expect(result.ok).toBe(true)
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
      targetLedgerId: 'movie-tv'
    })

    expect(runVisualFallback).toHaveBeenCalledWith({
      favoritesFolderName: 'bilimi 内库',
      targetLedgerId: 'movie-tv',
      favoriteFolders: expect.objectContaining({
        'movie-tv': 'bilimi·影视动漫'
      })
    })
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['like', 'favorite:open', 'visual:favorite:create'])
    )
  })

  it('uses the Bilibili API fallback before visual automation when DOM favorite creation fails', async () => {
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

    expect(runScript).toHaveBeenCalledTimes(2)
    expect(runScript.mock.calls[1][0]).toContain('/x/v3/fav/resource/deal')
    expect(runScript.mock.calls[1][0]).toContain('bilimi·知识学习')
    expect(runVisualFallback).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:open', 'api:favorite:create-folder', 'api:favorite:add'])
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
      message: '轻赏已入内库。'
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

  it('times out hung page scripts and uses the visual favorite fallback', async () => {
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
      await vi.advanceTimersByTimeAsync(15_001)
      const result = await resultPromise

      expect(runScript).toHaveBeenCalledTimes(2)
      expect(runVisualFallback).toHaveBeenCalledOnce()
      expect(result.ok).toBe(false)
      expect(result.steps).toEqual(
        expect.arrayContaining(['dom:timeout', 'visual:favorite:open'])
      )
      expect(result.missingTargets).toEqual(['visual-create-folder'])
    } finally {
      vi.useRealTimers()
    }
  })
})

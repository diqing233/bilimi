import { describe, expect, it, vi } from 'vitest'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { executeAssistantAction } from './actionExecutor'

describe('executeAssistantAction', () => {
  const favoriteLedgers = createDefaultFavoriteLedgers()

  it('runs favorite-only automation for 藏', async () => {
    const runScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite:open', 'favorite:folder', 'favorite'],
      missingTargets: [],
      message: '收藏已入库。'
    })

    const result = await executeAssistantAction({
      action: '藏',
      runScript,
      favoritesFolderName: 'Bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'humor'
    })

    expect(runScript).toHaveBeenCalledOnce()
    expect(runScript.mock.calls[0][0]).toContain('"action":"藏"')
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['favorite:open', 'favorite:folder', 'favorite'])
  })

  it('runs 点赞 + 收藏 for 赏', async () => {
    const runScript = vi.fn().mockResolvedValue({ ok: true, steps: ['like', 'favorite'] })

    const result = await executeAssistantAction({
      action: '赏',
      runScript,
      favoritesFolderName: 'Bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'humor'
    })

    expect(runScript).toHaveBeenCalledOnce()
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['like', 'favorite'])
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
      favoritesFolderName: 'Bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'humor'
    })

    expect(runVisualFallback).toHaveBeenCalledWith({
      favoritesFolderName: 'Bilimi 内库',
      targetLedgerId: 'humor',
      favoriteFolders: expect.objectContaining({
        humor: 'Bilimi·茶余解颐'
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
        message: '已用 B 站接口归入 Bilimi 收藏夹。'
      })
    const runVisualFallback = vi.fn()

    const result = await executeAssistantAction({
      action: '藏',
      runScript,
      runVisualFallback,
      favoritesFolderName: 'Bilimi 内库',
      favoriteLedgers,
      targetLedgerId: 'knowledge'
    })

    expect(runScript).toHaveBeenCalledTimes(2)
    expect(runScript.mock.calls[1][0]).toContain('/x/v3/fav/resource/deal')
    expect(runScript.mock.calls[1][0]).toContain('Bilimi·见闻增广')
    expect(runVisualFallback).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(
      expect.arrayContaining(['favorite:open', 'api:favorite:create-folder', 'api:favorite:add'])
    )
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
        favoritesFolderName: 'Bilimi 内库',
        favoriteLedgers,
        targetLedgerId: 'story'
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

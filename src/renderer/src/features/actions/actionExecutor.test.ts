import { describe, expect, it, vi } from 'vitest'
import { executeAssistantAction } from './actionExecutor'

describe('executeAssistantAction', () => {
  it('runs 点赞 + 收藏 for 赏', async () => {
    const runScript = vi.fn().mockResolvedValue({ ok: true, steps: ['like', 'favorite'] })

    const result = await executeAssistantAction({
      action: '赏',
      runScript,
      favoritesFolderName: 'Bilimi 内库'
    })

    expect(runScript).toHaveBeenCalledOnce()
    expect(result.ok).toBe(true)
    expect(result.steps).toEqual(['like', 'favorite'])
  })
})

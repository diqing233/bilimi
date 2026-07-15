import { describe, expect, it, vi } from 'vitest'
import { prepareOldFavoriteScan } from './oldFavoriteScanPreparation'

describe('prepareOldFavoriteScan', () => {
  it('waits for the active Bilibili page to become ready', async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ status: 'waiting' as const })
      .mockResolvedValueOnce({ status: 'ready' as const })

    const result = await prepareOldFavoriteScan(probe, {
      intervalMs: 0,
      timeoutMs: 60_000
    })

    expect(result).toMatchObject({ ok: true })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('fails immediately for explicit authentication, HTML, or risk-control errors', async () => {
    const wait = vi.fn().mockResolvedValue(undefined)

    for (const message of [
      'B站登录状态已失效，请重新登录后重试。',
      'Bilibili returned HTML instead of JSON.',
      'B站风控限制了当前请求，请稍后重试。'
    ]) {
      const probe = vi.fn().mockResolvedValue({ status: 'fatal' as const, message })
      const result = await prepareOldFavoriteScan(probe, {
        intervalMs: 250,
        timeoutMs: 60_000,
        wait
      })

      expect(result).toMatchObject({ ok: false, message })
      expect(probe).toHaveBeenCalledTimes(1)
    }

    expect(wait).not.toHaveBeenCalled()
  })

  it('returns a normal failure after the 60-second preparation timeout', async () => {
    let elapsedMs = 0
    const result = await prepareOldFavoriteScan(
      vi.fn().mockResolvedValue({ status: 'waiting' as const }),
      {
        intervalMs: 20_000,
        timeoutMs: 60_000,
        now: () => elapsedMs,
        wait: async (delayMs) => {
          elapsedMs += delayMs
        }
      }
    )

    expect(result).toEqual({
      ok: false,
      steps: [],
      missingTargets: ['bilibili-runtime'],
      message: 'B站页面或登录状态尚未准备好，请确认登录后重试。'
    })
  })
})

import { describe, expect, it } from 'vitest'
import { formatUserVisibleErrorMessage } from './userVisibleErrorMessage'

describe('formatUserVisibleErrorMessage', () => {
  it('maps an IPC-wrapped unavailable remote favorite inventory to an actionable Chinese message', () => {
    const message = formatUserVisibleErrorMessage(
      new Error("Error invoking remote method 'old-favorite-workspace-v1:bilibili execution preflight': Error: Favorite repository remote folder inventory is unavailable."),
      '收藏夹同步失败，请重试。'
    )

    expect(message).toBe('无法读取 B 站收藏夹列表，请检查网络并保持已登录的 B 站页面打开后重试。')
    expect(message).not.toContain('Error invoking remote method')
  })

  it.each([
    'Error invoking remote method \'favorite-repository:list\': Error: fetch failed',
    'Network request failed',
    'net::ERR_INTERNET_DISCONNECTED'
  ])('maps network failure %s to a Chinese retry message', (detail) => {
    expect(formatUserVisibleErrorMessage(new Error(detail), '收藏夹同步失败，请重试。'))
      .toBe('网络连接失败，请检查网络并保持已登录的 B 站页面打开后重试。')
  })

  it('maps an HTML response to a Chinese login or verification message', () => {
    expect(formatUserVisibleErrorMessage(
      new Error('remote response-category=html http-status=200'),
      '收藏夹同步失败，请重试。'
    )).toBe('B 站返回了登录或验证页面，请确认已登录后重试。')
  })

  it('keeps an existing Chinese business error unchanged', () => {
    expect(formatUserVisibleErrorMessage(
      new Error('扫描检查点未能保存。'),
      '扫描启动失败，请重新扫描。'
    )).toBe('扫描检查点未能保存。')
  })

  it('uses the caller Chinese fallback for unknown English internals', () => {
    expect(formatUserVisibleErrorMessage(
      new Error('Unexpected worker handshake protocol violation'),
      '收藏夹同步失败，请重试。'
    )).toBe('收藏夹同步失败，请重试。')
  })
})

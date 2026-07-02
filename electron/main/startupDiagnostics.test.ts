import { describe, expect, it, vi } from 'vitest'
import { runStartupDiagnostics } from './startupDiagnostics'

describe('runStartupDiagnostics', () => {
  it('reports core startup checks with DeepSeek as optional when it is not configured', async () => {
    const report = await runStartupDiagnostics({
      now: () => new Date('2026-07-03T00:00:00.000Z'),
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      resolveMediaToolPaths: vi.fn(() => ({
        ytdlpPath: 'tools/yt-dlp.exe',
        ffmpegPath: 'tools/ffmpeg.exe',
        whisperCliPath: 'tools/whisper-cli.exe',
        whisperModelPath: 'tools/ggml-small.bin'
      })),
      loadDeepSeekApiKeyStatus: vi.fn(() => ({ configured: false })),
      testDeepSeekConnection: vi.fn()
    })

    expect(report).toEqual({
      ok: true,
      checkedAt: '2026-07-03T00:00:00.000Z',
      items: [
        expect.objectContaining({ id: 'bilibili-network', status: 'ok' }),
        expect.objectContaining({ id: 'media-tools', status: 'ok' }),
        expect.objectContaining({ id: 'storage', status: 'ok' }),
        expect.objectContaining({ id: 'deepseek', status: 'warning' })
      ]
    })
  })

  it('marks Bilibili connectivity as an error when the network probe fails', async () => {
    const report = await runStartupDiagnostics({
      now: () => new Date('2026-07-03T00:00:00.000Z'),
      fetch: vi.fn().mockRejectedValue(new Error('network down')),
      resolveMediaToolPaths: vi.fn(() => ({
        ytdlpPath: 'tools/yt-dlp.exe',
        ffmpegPath: 'tools/ffmpeg.exe',
        whisperCliPath: 'tools/whisper-cli.exe',
        whisperModelPath: 'tools/ggml-small.bin'
      })),
      loadDeepSeekApiKeyStatus: vi.fn(() => ({ configured: false })),
      testDeepSeekConnection: vi.fn()
    })

    expect(report.ok).toBe(false)
    expect(report.items).toContainEqual(
      expect.objectContaining({
        id: 'bilibili-network',
        status: 'error',
        action: expect.stringContaining('Windows 防火墙')
      })
    )
  })
})

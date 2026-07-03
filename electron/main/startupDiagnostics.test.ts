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
      testDeepSeekConnection: vi.fn(),
      platform: 'win32',
      execPath: 'C:\\Program Files\\bilimi\\bilimi.exe',
      queryWindowsFirewallRules: vi.fn().mockResolvedValue([
        {
          action: 'Allow',
          direction: 'Inbound',
          enabled: true,
          profile: 'Private'
        }
      ])
    })

    expect(report).toEqual({
      ok: true,
      checkedAt: '2026-07-03T00:00:00.000Z',
      items: [
        expect.objectContaining({ id: 'bilibili-network', status: 'ok' }),
        expect.objectContaining({ id: 'windows-firewall', status: 'ok' }),
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
      testDeepSeekConnection: vi.fn(),
      platform: 'win32',
      execPath: 'C:\\Program Files\\bilimi\\bilimi.exe',
      queryWindowsFirewallRules: vi.fn().mockResolvedValue([])
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

  it('marks Windows security center permission as an error when bilimi is blocked', async () => {
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
      testDeepSeekConnection: vi.fn(),
      platform: 'win32',
      execPath: 'C:\\Program Files\\bilimi\\bilimi.exe',
      queryWindowsFirewallRules: vi.fn().mockResolvedValue([
        {
          action: 'Block',
          direction: 'Inbound',
          enabled: true,
          profile: 'Public'
        }
      ])
    })

    expect(report.ok).toBe(false)
    expect(report.items).toContainEqual(
      expect.objectContaining({
        id: 'windows-firewall',
        status: 'error',
        message: expect.stringContaining('阻止')
      })
    )
  })

  it('recognizes Windows firewall rules returned with numeric enum values', async () => {
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
      testDeepSeekConnection: vi.fn(),
      platform: 'win32',
      execPath: 'D:\\bilimi\\bilimi.exe',
      queryWindowsFirewallRules: vi.fn().mockResolvedValue([
        {
          action: 2,
          direction: 1,
          enabled: 1,
          profile: 4
        }
      ])
    })

    expect(report.items).toContainEqual(
      expect.objectContaining({
        id: 'windows-firewall',
        status: 'ok',
        message: expect.stringContaining('Public')
      })
    )
  })

  it('checks nearby bilimi.exe firewall rules when the current process path has no rule', async () => {
    const queryWindowsFirewallRules = vi.fn(async (programPath: string) =>
      programPath === 'C:\\Program Files\\bilimi\\bilimi.exe'
        ? [
            {
              action: 'Allow',
              direction: 'Inbound',
              enabled: true,
              profile: 'Private'
            }
          ]
        : []
    )

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
      testDeepSeekConnection: vi.fn(),
      platform: 'win32',
      execPath: 'C:\\Program Files\\bilimi\\resources\\app.asar.unpacked\\helper.exe',
      queryWindowsFirewallRules
    })

    expect(queryWindowsFirewallRules).toHaveBeenCalledWith(
      'C:\\Program Files\\bilimi\\resources\\app.asar.unpacked\\helper.exe'
    )
    expect(queryWindowsFirewallRules).toHaveBeenCalledWith('C:\\Program Files\\bilimi\\bilimi.exe')
    expect(report.items).toContainEqual(
      expect.objectContaining({
        id: 'windows-firewall',
        status: 'ok'
      })
    )
  })
})

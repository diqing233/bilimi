import { describe, expect, it, vi } from 'vitest'
import { runStartupDiagnostics } from './startupDiagnostics'

describe('runStartupDiagnostics', () => {
  it('probes storage by writing, reading, and deleting a temporary value', async () => {
    const values = new Map<string, unknown>()
    const storageProbe = {
      set: vi.fn((key: string, value: unknown) => values.set(key, value)),
      get: vi.fn((key: string) => values.get(key)),
      delete: vi.fn((key: string) => values.delete(key))
    }

    const report = await runStartupDiagnostics({
      resolveMediaToolPaths: () => ({
        ytdlpPath: 'tools/yt-dlp.exe',
        ffmpegPath: 'tools/ffmpeg.exe',
        whisperCliPath: 'tools/whisper-cli.exe',
        whisperModelPath: 'tools/ggml-small.bin'
      }),
      loadDeepSeekApiKeyStatus: () => ({ configured: false, protection: 'unavailable' }),
      testDeepSeekConnection: vi.fn(),
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      platform: 'linux',
      storageProbe
    })

    expect(report.items).toContainEqual(expect.objectContaining({ id: 'storage', status: 'ok' }))
    expect(storageProbe.set).toHaveBeenCalledOnce()
    expect(storageProbe.get).toHaveBeenCalledOnce()
    expect(storageProbe.delete).toHaveBeenCalledOnce()
  })

  it('reports core startup checks with DeepSeek as optional when it is not configured', async () => {
    let storedProbeValue: unknown
    const queryWindowsFirewallRules = vi.fn().mockResolvedValue([
      {
        action: 'Allow',
        direction: 'Inbound',
        enabled: true,
        profile: 'Private'
      }
    ])

    const report = await runStartupDiagnostics({
      now: () => new Date('2026-07-03T00:00:00.000Z'),
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      resolveMediaToolPaths: vi.fn(() => ({
        ytdlpPath: 'tools/yt-dlp.exe',
        ffmpegPath: 'tools/ffmpeg.exe',
        whisperCliPath: 'tools/whisper-cli.exe',
        whisperModelPath: 'tools/ggml-small.bin'
      })),
      loadDeepSeekApiKeyStatus: vi.fn(() => ({ configured: false, protection: 'unavailable' as const })),
      testDeepSeekConnection: vi.fn(),
      storageProbe: {
        set: vi.fn((_key, value) => {
          storedProbeValue = value
        }),
        get: vi.fn(() => storedProbeValue),
        delete: vi.fn(() => {
          storedProbeValue = undefined
        })
      },
      platform: 'win32',
      execPath: 'C:\\Program Files\\bilimi\\bilimi.exe',
      queryWindowsFirewallRules
    })

    expect(queryWindowsFirewallRules).toHaveBeenCalledTimes(1)
    expect(queryWindowsFirewallRules).toHaveBeenCalledWith()
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
      loadDeepSeekApiKeyStatus: vi.fn(() => ({ configured: false, protection: 'unavailable' as const })),
      testDeepSeekConnection: vi.fn(),
      storageProbe: {
        set: vi.fn(),
        get: vi.fn(() => 'bilimi-storage-probe'),
        delete: vi.fn()
      },
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

  it('keeps Windows security center diagnosis compact when no allow rule is found', async () => {
    const report = await runStartupDiagnostics({
      now: () => new Date('2026-07-03T00:00:00.000Z'),
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      resolveMediaToolPaths: vi.fn(() => ({
        ytdlpPath: 'tools/yt-dlp.exe',
        ffmpegPath: 'tools/ffmpeg.exe',
        whisperCliPath: 'tools/whisper-cli.exe',
        whisperModelPath: 'tools/ggml-small.bin'
      })),
      loadDeepSeekApiKeyStatus: vi.fn(() => ({ configured: false, protection: 'unavailable' as const })),
      testDeepSeekConnection: vi.fn(),
      platform: 'win32',
      execPath: 'C:\\Program Files\\bilimi\\bilimi.exe',
      queryWindowsFirewallRules: vi.fn().mockResolvedValue([])
    })

    expect(report.ok).toBe(true)
    expect(report.items).toContainEqual(
      expect.objectContaining({
        id: 'windows-firewall',
        status: 'warning',
        message: '未找到 bilimi 的防火墙允许规则。'
      })
    )
    expect(report.items.find((item) => item.id === 'windows-firewall')).not.toHaveProperty('action')
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
      loadDeepSeekApiKeyStatus: vi.fn(() => ({ configured: false, protection: 'unavailable' as const })),
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

  it('does not scan nearby executable paths when checking Windows firewall rules', async () => {
    const queryWindowsFirewallRules = vi.fn().mockResolvedValue([
      {
        action: 'Allow',
        direction: 'Inbound',
        enabled: true,
        profile: 'Private'
      }
    ])

    const report = await runStartupDiagnostics({
      now: () => new Date('2026-07-03T00:00:00.000Z'),
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      resolveMediaToolPaths: vi.fn(() => ({
        ytdlpPath: 'tools/yt-dlp.exe',
        ffmpegPath: 'tools/ffmpeg.exe',
        whisperCliPath: 'tools/whisper-cli.exe',
        whisperModelPath: 'tools/ggml-small.bin'
      })),
      loadDeepSeekApiKeyStatus: vi.fn(() => ({ configured: false, protection: 'unavailable' as const })),
      testDeepSeekConnection: vi.fn(),
      platform: 'win32',
      execPath: 'C:\\Program Files\\bilimi\\resources\\app.asar.unpacked\\helper.exe',
      queryWindowsFirewallRules
    })

    expect(queryWindowsFirewallRules).toHaveBeenCalledTimes(1)
    expect(queryWindowsFirewallRules).toHaveBeenCalledWith()
    expect(report.items).toContainEqual(
      expect.objectContaining({
        id: 'windows-firewall',
        status: 'ok'
      })
    )
  })

  it('checks bilimi display-name firewall rules directly when the current process path differs', async () => {
    const queryWindowsFirewallRules = vi.fn().mockResolvedValue([])

    const report = await runStartupDiagnostics({
      now: () => new Date('2026-07-03T00:00:00.000Z'),
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      resolveMediaToolPaths: vi.fn(() => ({
        ytdlpPath: 'tools/yt-dlp.exe',
        ffmpegPath: 'tools/ffmpeg.exe',
        whisperCliPath: 'tools/whisper-cli.exe',
        whisperModelPath: 'tools/ggml-small.bin'
      })),
      loadDeepSeekApiKeyStatus: vi.fn(() => ({ configured: false, protection: 'unavailable' as const })),
      testDeepSeekConnection: vi.fn(),
      platform: 'win32',
      execPath: 'C:\\Users\\diqing\\bilimi\\node_modules\\electron\\dist\\electron.exe',
      queryWindowsFirewallRules
    })

    expect(queryWindowsFirewallRules).toHaveBeenCalledTimes(1)
    expect(queryWindowsFirewallRules).toHaveBeenCalledWith()
    expect(report.items).toContainEqual(expect.objectContaining({ id: 'windows-firewall' }))
  })
})

import { describe, expect, it, vi } from 'vitest'
import { buildYtdlpAudioArgs, downloadVideoAudio } from './audioDownload'

describe('audio download', () => {
  it('builds conservative yt-dlp args for one current video', () => {
    expect(
      buildYtdlpAudioArgs({
        url: 'https://www.bilibili.com/video/BV1demo',
        cookiePath: 'C:/tmp/cookies.txt',
        outputTemplate: 'C:/tmp/audio.%(ext)s'
      })
    ).toEqual([
      '--no-playlist',
      '--cookies',
      'C:/tmp/cookies.txt',
      '-f',
      'bestaudio/best',
      '-o',
      'C:/tmp/audio.%(ext)s',
      '--print',
      'after_move:filepath',
      'https://www.bilibili.com/video/BV1demo'
    ])
  })

  it('returns the downloaded filepath from stdout', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      stdout: 'C:/tmp/audio.m4a\n',
      stderr: '',
      exitCode: 0
    })

    await expect(
      downloadVideoAudio({
        ytdlpPath: 'C:/tools/yt-dlp.exe',
        url: 'https://www.bilibili.com/video/BV1demo',
        cookiePath: 'C:/tmp/cookies.txt',
        outputTemplate: 'C:/tmp/audio.%(ext)s',
        runProcess
      })
    ).resolves.toEqual({ audioPath: 'C:/tmp/audio.m4a' })
  })

  it('sanitizes signed urls from failure messages', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'failed https://example.test/audio.m4a?token=secret',
      exitCode: 1
    })

    await expect(
      downloadVideoAudio({
        ytdlpPath: 'C:/tools/yt-dlp.exe',
        url: 'https://www.bilibili.com/video/BV1demo',
        cookiePath: 'C:/tmp/cookies.txt',
        outputTemplate: 'C:/tmp/audio.%(ext)s',
        runProcess
      })
    ).rejects.toThrow('Audio download failed')
  })
})

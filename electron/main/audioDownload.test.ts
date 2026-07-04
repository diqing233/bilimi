import { describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ default: { spawn }, spawn }))

import { EventEmitter } from 'node:events'
import { buildYtdlpAudioArgs, downloadVideoAudio, runProcess } from './audioDownload'

describe('audio download', () => {
  it('runs child processes with UTF-8 Python output enabled', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    spawn.mockReturnValue(child)

    const promise = runProcess('python', ['script.py'])
    child.emit('close', 0)

    await expect(promise).resolves.toEqual({ stdout: '', stderr: '', exitCode: 0 })
    expect(spawn).toHaveBeenCalledWith(
      'python',
      ['script.py'],
      expect.objectContaining({
        env: expect.objectContaining({
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8'
        })
      })
    )
  })

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
      '--add-header',
      'Referer:https://www.bilibili.com/',
      '--add-header',
      'Origin:https://www.bilibili.com',
      '--user-agent',
      expect.stringContaining('Mozilla/5.0'),
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
    const statFile = vi.fn().mockResolvedValue({ size: 1024 })

    await expect(
      downloadVideoAudio({
        ytdlpPath: 'C:/tools/yt-dlp.exe',
        url: 'https://www.bilibili.com/video/BV1demo',
        cookiePath: 'C:/tmp/cookies.txt',
        outputTemplate: 'C:/tmp/audio.%(ext)s',
        runProcess,
        statFile
      })
    ).resolves.toEqual({ audioPath: 'C:/tmp/audio.m4a' })
  })

  it('reports an empty downloaded file with its path and size', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      stdout: 'C:/tmp/audio.m4a\n',
      stderr: '',
      exitCode: 0
    })
    const statFile = vi.fn().mockResolvedValue({ size: 0 })

    await expect(
      downloadVideoAudio({
        ytdlpPath: 'C:/tools/yt-dlp.exe',
        url: 'https://www.bilibili.com/video/BV1demo',
        cookiePath: 'C:/tmp/cookies.txt',
        outputTemplate: 'C:/tmp/audio.%(ext)s',
        runProcess,
        statFile
      })
    ).rejects.toThrow('Audio download produced an empty file: C:/tmp/audio.m4a size=0')
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

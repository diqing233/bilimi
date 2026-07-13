import { describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ default: { spawn }, spawn }))

import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

  it('kills child processes when canceled by an AbortSignal', async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }
    child.pid = 12345
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    spawn.mockReturnValue(child)
    const controller = new AbortController()

    const promise = runProcess('python', ['script.py'], { signal: controller.signal })
    controller.abort()
    child.emit('close', null)

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.kill).toHaveBeenCalled()
    if (process.platform === 'win32') {
      expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid', '12345', '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
    }
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

  it('passes cancellation signals to yt-dlp', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      stdout: 'C:/tmp/audio.m4a\n',
      stderr: '',
      exitCode: 0
    })
    const statFile = vi.fn().mockResolvedValue({ size: 1024 })
    const controller = new AbortController()

    await downloadVideoAudio({
      ytdlpPath: 'C:/tools/yt-dlp.exe',
      url: 'https://www.bilibili.com/video/BV1demo',
      cookiePath: 'C:/tmp/cookies.txt',
      outputTemplate: 'C:/tmp/audio.%(ext)s',
      runProcess,
      statFile,
      signal: controller.signal
    })

    expect(runProcess).toHaveBeenCalledWith(
      'C:/tools/yt-dlp.exe',
      expect.any(Array),
      { signal: controller.signal }
    )
  })

  it('falls back to the actual non-empty source media file when printed filepath is missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'bilimi-audio-download-'))
    const actualPath = join(tempDir, 'source.webm')
    const printedPath = join(tempDir, 'source.m4a')
    await writeFile(actualPath, 'downloaded audio')

    try {
      const runProcess = vi.fn().mockResolvedValue({
        stdout: `${printedPath}\n`,
        stderr: '[download] Destination: source.webm\n',
        exitCode: 0
      })

      await expect(
        downloadVideoAudio({
          ytdlpPath: 'C:/tools/yt-dlp.exe',
          url: 'https://www.bilibili.com/video/BV1demo',
          cookiePath: join(tempDir, 'cookies.txt'),
          outputTemplate: join(tempDir, 'source.%(ext)s'),
          runProcess
        })
      ).resolves.toEqual({ audioPath: actualPath })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('reports directory entries and process output when no downloaded media file exists', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'bilimi-audio-download-'))
    const printedPath = join(tempDir, 'source.m4a')
    await writeFile(join(tempDir, 'cookies.txt'), 'cookie data')
    await writeFile(join(tempDir, 'source.webm.part'), '')

    try {
      const runProcess = vi.fn().mockResolvedValue({
        stdout: `${printedPath}\n`,
        stderr: '[download] failed after move\n',
        exitCode: 0
      })

      let error: unknown
      try {
        await downloadVideoAudio({
          ytdlpPath: 'C:/tools/yt-dlp.exe',
          url: 'https://www.bilibili.com/video/BV1demo',
          cookiePath: join(tempDir, 'cookies.txt'),
          outputTemplate: join(tempDir, 'source.%(ext)s'),
          runProcess
        })
      } catch (caughtError) {
        error = caughtError
      }

      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message

      expect(message).toMatch(/Audio download output file is missing/)
      expect(message).toMatch(/source\.webm\.part size=0/)
      expect(message).toMatch(new RegExp(`printedPath=${printedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
      expect(message).toMatch(/stdout=.*source\.m4a/)
      expect(message).toMatch(/stderr=\[download\] failed after move/)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
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

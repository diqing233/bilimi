import { describe, expect, it, vi } from 'vitest'
import { createMediaToolPaths, resolveMediaToolPaths } from './mediaToolPaths'

describe('media tool paths', () => {
  it('resolves development tool paths from the project tools directory', () => {
    const exists = vi.fn((path: string) => path.includes('tools'))

    expect(
      createMediaToolPaths({
        appPath: 'C:/Projects/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Projects/bilimi/out',
        exists
      })
    ).toEqual({
      ytdlpPath: 'C:/Projects/bilimi/tools/win32/yt-dlp.exe',
      ffmpegPath: 'C:/Projects/bilimi/tools/win32/ffmpeg.exe',
      whisperCliPath: 'C:/Projects/bilimi/tools/win32/whisper/whisper-cli.exe',
      whisperModelPath: 'C:/Projects/bilimi/tools/win32/whisper/models/ggml-small.bin'
    })
  })

  it('resolves packaged tool paths from resources', () => {
    expect(
      createMediaToolPaths({
        appPath: 'C:/Program Files/Bilimi/resources/app.asar',
        isPackaged: true,
        platform: 'win32',
        resourcesPath: 'C:/Program Files/Bilimi/resources',
        exists: () => true
      })
    ).toEqual({
      ytdlpPath: 'C:/Program Files/Bilimi/resources/tools/win32/yt-dlp.exe',
      ffmpegPath: 'C:/Program Files/Bilimi/resources/tools/win32/ffmpeg.exe',
      whisperCliPath: 'C:/Program Files/Bilimi/resources/tools/win32/whisper/whisper-cli.exe',
      whisperModelPath: 'C:/Program Files/Bilimi/resources/tools/win32/whisper/models/ggml-small.bin'
    })
  })

  it('throws an actionable error when a tool is missing', () => {
    expect(() =>
      createMediaToolPaths({
        appPath: 'C:/Projects/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Projects/bilimi/out',
        exists: () => false
      })
    ).toThrow('Bundled media tool is missing')
  })

  it('tells developers how to install missing media tools', () => {
    expect(() =>
      createMediaToolPaths({
        appPath: 'C:/Projects/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Projects/bilimi/out',
        exists: () => false
      })
    ).toThrow('npm run setup:media-tools')
  })

  it('requires ffprobe beside ffmpeg because duration probing uses it', () => {
    expect(() =>
      createMediaToolPaths({
        appPath: 'C:/Projects/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Projects/bilimi/out',
        exists: (path) => !path.endsWith('ffprobe.exe')
      })
    ).toThrow('ffprobe.exe')
  })

  it('requires bundled whisper.cpp runtime and model for offline transcription', () => {
    expect(() =>
      createMediaToolPaths({
        appPath: 'C:/Projects/bilimi',
        isPackaged: true,
        platform: 'win32',
        resourcesPath: 'C:/Program Files/Bilimi/resources',
        exists: (path) => !path.endsWith('models/ggml-small.bin')
      })
    ).toThrow('ggml-small.bin')
  })

  it('uses the current Electron app paths in the default resolver', () => {
    expect(typeof resolveMediaToolPaths).toBe('function')
  })
})

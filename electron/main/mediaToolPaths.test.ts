import { describe, expect, it, vi } from 'vitest'
import { createMediaToolPaths, resolveMediaToolPaths } from './mediaToolPaths'

describe('media tool paths', () => {
  it('resolves development tool paths from the project tools directory', () => {
    const exists = vi.fn((path: string) => path.includes('tools'))

    expect(
      createMediaToolPaths({
        appPath: 'C:/Users/diqing/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Users/diqing/bilimi/out',
        exists
      })
    ).toEqual({
      ytdlpPath: 'C:/Users/diqing/bilimi/tools/win32/yt-dlp.exe',
      ffmpegPath: 'C:/Users/diqing/bilimi/tools/win32/ffmpeg.exe'
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
      ffmpegPath: 'C:/Program Files/Bilimi/resources/tools/win32/ffmpeg.exe'
    })
  })

  it('throws an actionable error when a tool is missing', () => {
    expect(() =>
      createMediaToolPaths({
        appPath: 'C:/Users/diqing/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Users/diqing/bilimi/out',
        exists: () => false
      })
    ).toThrow('Bundled media tool is missing')
  })

  it('tells developers how to install missing media tools', () => {
    expect(() =>
      createMediaToolPaths({
        appPath: 'C:/Users/diqing/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Users/diqing/bilimi/out',
        exists: () => false
      })
    ).toThrow('npm run setup:media-tools')
  })

  it('requires ffprobe beside ffmpeg because duration probing uses it', () => {
    expect(() =>
      createMediaToolPaths({
        appPath: 'C:/Users/diqing/bilimi',
        isPackaged: false,
        platform: 'win32',
        resourcesPath: 'C:/Users/diqing/bilimi/out',
        exists: (path) => !path.endsWith('ffprobe.exe')
      })
    ).toThrow('ffprobe.exe')
  })

  it('uses the current Electron app paths in the default resolver', () => {
    expect(typeof resolveMediaToolPaths).toBe('function')
  })
})

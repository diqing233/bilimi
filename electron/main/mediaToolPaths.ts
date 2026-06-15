import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type MediaToolPaths = {
  ytdlpPath: string
  ffmpegPath: string
}

type MediaToolPathInput = {
  appPath: string
  isPackaged: boolean
  platform: NodeJS.Platform
  resourcesPath: string
  exists: (path: string) => boolean
}

function executableName(baseName: 'yt-dlp' | 'ffmpeg', platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${baseName}.exe` : baseName
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function createMediaToolPaths(input: MediaToolPathInput): MediaToolPaths {
  const root = input.isPackaged ? input.resourcesPath : input.appPath
  const toolRoot = join(root, 'tools', input.platform)
  const ytdlpPath = normalizePath(join(toolRoot, executableName('yt-dlp', input.platform)))
  const ffmpegPath = normalizePath(join(toolRoot, executableName('ffmpeg', input.platform)))

  for (const path of [ytdlpPath, ffmpegPath]) {
    if (!input.exists(path)) {
      throw new Error(`Bundled media tool is missing: ${path}`)
    }
  }

  return { ytdlpPath, ffmpegPath }
}

export function resolveMediaToolPaths(): MediaToolPaths {
  return createMediaToolPaths({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    exists: existsSync
  })
}

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type MediaToolPaths = {
  ytdlpPath: string
  ffmpegPath: string
  whisperCliPath: string
  whisperModelPath: string
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

function ffprobeName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
}

function whisperCliName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function createMediaToolPaths(input: MediaToolPathInput): MediaToolPaths {
  const root = input.isPackaged ? input.resourcesPath : input.appPath
  const toolRoot = join(root, 'tools', input.platform)
  const ytdlpPath = normalizePath(join(toolRoot, executableName('yt-dlp', input.platform)))
  const ffmpegPath = normalizePath(join(toolRoot, executableName('ffmpeg', input.platform)))
  const ffprobePath = normalizePath(join(toolRoot, ffprobeName(input.platform)))
  const whisperCliPath = normalizePath(join(toolRoot, 'whisper', whisperCliName(input.platform)))
  const whisperModelPath = normalizePath(join(toolRoot, 'whisper', 'models', 'ggml-small.bin'))

  for (const path of [ytdlpPath, ffmpegPath, ffprobePath, whisperCliPath, whisperModelPath]) {
    if (!input.exists(path)) {
      const setupHint = input.isPackaged
        ? 'Reinstall Bilimi or rebuild the package with bundled media tools.'
        : 'Run npm run setup:media-tools from the project root, then restart Bilimi.'

      throw new Error(`Bundled media tool is missing: ${path}. ${setupHint}`)
    }
  }

  return { ytdlpPath, ffmpegPath, whisperCliPath, whisperModelPath }
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

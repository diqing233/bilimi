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

  const requiredPaths = [ytdlpPath, ffmpegPath, ffprobePath, whisperCliPath, whisperModelPath]
  const missingPaths = requiredPaths.filter((path) => !input.exists(path))
  if (missingPaths.length > 0) {
    const setupHint = input.isPackaged
      ? 'Reinstall bilimi or rebuild the package with bundled media tools.'
      : 'Run npm run setup:media-tools from this development runtime root, then restart bilimi.'
    const runtimeLabel = input.isPackaged ? 'Packaged resources root' : 'Development runtime root'

    throw new Error(
      `Bundled media tool is missing; all missing paths:\n${missingPaths.join('\n')}\n${runtimeLabel}: ${normalizePath(root)}. ${setupHint}`
    )
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

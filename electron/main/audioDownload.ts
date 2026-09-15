import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export type ProcessResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type ProcessRunOptions = {
  signal?: AbortSignal
}

export type RunProcess = (
  command: string,
  args: string[],
  options?: ProcessRunOptions
) => Promise<ProcessResult>

export type AudioDownloadRetryDelay = (milliseconds: number, signal?: AbortSignal) => Promise<void>

const AUDIO_DOWNLOAD_RETRY_DELAYS_MS = [1000, 3000]

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

function isTransientAudioDownloadFailure(result: ProcessResult): boolean {
  if (result.exitCode === 0) return false
  const details = `${result.stderr}\n${result.stdout}`.toLowerCase()
  return [
    'eof occurred in violation of protocol',
    'connection reset',
    'connection aborted',
    'remote end closed connection',
    'timed out',
    'temporary failure in name resolution',
    'name resolution',
    'http error 408',
    'http error 429',
    'http error 500',
    'http error 502',
    'http error 503',
    'http error 504'
  ].some((marker) => details.includes(marker))
}

async function abortableRetryDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }, { once: true })
  })
}

function killProcessTree(pid?: number) {
  if (!pid) {
    return
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.on('error', () => {})
  }
}

export function runProcess(
  command: string,
  args: string[],
  options: ProcessRunOptions = {}
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8'
      },
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let aborted = false

    const removeAbortListener = () => {
      options.signal?.removeEventListener('abort', abortProcess)
    }

    const createAbortError = () => {
      const error = new Error('Process canceled.')
      error.name = 'AbortError'
      return error
    }

    const settle = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      removeAbortListener()
      callback()
    }

    const abortProcess = () => {
      aborted = true
      killProcessTree(child.pid)
      child.kill()
    }

    if (options.signal?.aborted) {
      abortProcess()
    } else {
      options.signal?.addEventListener('abort', abortProcess, { once: true })
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      settle(() => {
        reject(aborted ? createAbortError() : error)
      })
    })
    child.on('close', (exitCode) => {
      settle(() => {
        if (aborted) {
          reject(createAbortError())
          return
        }

        resolve({ stdout, stderr, exitCode: exitCode ?? 1 })
      })
    })
  })
}

export function buildYtdlpAudioArgs({
  url,
  cookiePath,
  outputTemplate
}: {
  url: string
  cookiePath: string
  outputTemplate: string
}): string[] {
  return [
    '--no-playlist',
    '--cookies',
    cookiePath,
    '--add-header',
    'Referer:https://www.bilibili.com/',
    '--add-header',
    'Origin:https://www.bilibili.com',
    '--user-agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    '-f',
    'bestaudio/best',
    '-o',
    outputTemplate,
    '--print',
    'after_move:filepath',
    url
  ]
}

function sanitizeProcessText(value: string): string {
  return value.replace(/https?:\/\/\S+/g, '[redacted-url]').slice(0, 500)
}

const MEDIA_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mka',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
  '.webm'
])

function getExtension(path: string): string {
  const fileName = basename(path).toLowerCase()
  const dotIndex = fileName.lastIndexOf('.')

  return dotIndex >= 0 ? fileName.slice(dotIndex) : ''
}

function isMediaFileName(fileName: string): boolean {
  const lowerName = fileName.toLowerCase()

  return !lowerName.endsWith('.part') && MEDIA_EXTENSIONS.has(getExtension(lowerName))
}

function getOutputSearchContext(outputTemplate: string, printedPath: string): { dir: string; sourcePrefix: string } {
  const templateDir = dirname(outputTemplate)
  const templateFileName = basename(outputTemplate)
  const extTokenIndex = templateFileName.indexOf('%(ext)s')
  const sourcePrefix =
    extTokenIndex >= 0
      ? templateFileName.slice(0, extTokenIndex)
      : `${basename(printedPath).replace(/\.[^.]*$/, '')}.`

  return {
    dir: templateDir,
    sourcePrefix
  }
}

async function describeDirectoryFiles(dir: string): Promise<string> {
  try {
    const names = await readdir(dir)
    if (names.length === 0) {
      return '(empty)'
    }

    const entries = await Promise.all(
      names.sort().map(async (name) => {
        const path = join(dir, name)
        try {
          const stats = await stat(path)
          return `${name} size=${stats.size}`
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          return `${name} statError=${detail}`
        }
      })
    )

    return entries.join(', ')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return `(failed to read directory: ${detail})`
  }
}

async function findFallbackAudioPath({
  dir,
  sourcePrefix
}: {
  dir: string
  sourcePrefix: string
}): Promise<string | null> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }

  const candidates = names
    .filter(isMediaFileName)
    .sort((a, b) => {
      const aSource = a.startsWith(sourcePrefix)
      const bSource = b.startsWith(sourcePrefix)
      if (aSource !== bSource) return aSource ? -1 : 1

      return a.localeCompare(b)
    })

  for (const name of candidates) {
    const path = join(dir, name)
    try {
      const stats = await stat(path)
      if (stats.size > 0) {
        return path
      }
    } catch {
      // Keep scanning; the diagnostic path below will describe unreadable entries.
    }
  }

  return null
}

async function createMissingOutputErrorMessage({
  printedPath,
  outputTemplate,
  result,
  statDetail
}: {
  printedPath: string
  outputTemplate: string
  result: ProcessResult
  statDetail: string
}): Promise<string> {
  const { dir } = getOutputSearchContext(outputTemplate, printedPath)
  const files = await describeDirectoryFiles(dir)

  return [
    `Audio download output file is missing: ${printedPath}. ${statDetail}`,
    `printedPath=${printedPath}`,
    `outputTemplate=${outputTemplate}`,
    `tempDir=${dir}`,
    `files=[${files}]`,
    `stdout=${sanitizeProcessText(result.stdout)}`,
    `stderr=${sanitizeProcessText(result.stderr)}`
  ].join(' ')
}

export async function downloadVideoAudio({
  ytdlpPath,
  url,
  cookiePath,
  outputTemplate,
  runProcess: run = runProcess,
  statFile = stat,
  signal,
  retryDelay = abortableRetryDelay
}: {
  ytdlpPath: string
  url: string
  cookiePath: string
  outputTemplate: string
  runProcess?: RunProcess
  statFile?: (path: string) => Promise<{ size: number }>
  signal?: AbortSignal
  retryDelay?: AudioDownloadRetryDelay
}): Promise<{ audioPath: string }> {
  let result: ProcessResult
  for (let attempt = 0; ; attempt += 1) {
    try {
      result = await run(ytdlpPath, buildYtdlpAudioArgs({ url, cookiePath, outputTemplate }), {
        signal
      })
    } catch (error) {
      if (isAbortError(error, signal)) throw error
      throw error
    }

    if (
      result.exitCode === 0 ||
      attempt >= AUDIO_DOWNLOAD_RETRY_DELAYS_MS.length ||
      !isTransientAudioDownloadFailure(result)
    ) break

    await retryDelay(AUDIO_DOWNLOAD_RETRY_DELAYS_MS[attempt], signal)
  }

  if (result.exitCode !== 0) {
    throw new Error(`Audio download failed: ${sanitizeProcessText(result.stderr || result.stdout)}`)
  }

  const audioPath = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)

  if (!audioPath) {
    throw new Error('Audio download failed: yt-dlp did not report an output file.')
  }

  let audioStats: { size: number }
  try {
    audioStats = await statFile(audioPath)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const searchContext = getOutputSearchContext(outputTemplate, audioPath)
    const fallbackAudioPath = await findFallbackAudioPath(searchContext)
    if (fallbackAudioPath) {
      return { audioPath: fallbackAudioPath }
    }

    throw new Error(
      await createMissingOutputErrorMessage({
        printedPath: audioPath,
        outputTemplate,
        result,
        statDetail: detail
      })
    )
  }

  if (audioStats.size <= 0) {
    throw new Error(`Audio download produced an empty file: ${audioPath} size=${audioStats.size}`)
  }

  return { audioPath }
}

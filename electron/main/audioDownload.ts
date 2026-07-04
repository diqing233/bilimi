import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'

export type ProcessResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type RunProcess = (command: string, args: string[]) => Promise<ProcessResult>

export function runProcess(command: string, args: string[]): Promise<ProcessResult> {
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

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      reject(error)
    })
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 })
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

export async function downloadVideoAudio({
  ytdlpPath,
  url,
  cookiePath,
  outputTemplate,
  runProcess: run = runProcess,
  statFile = stat
}: {
  ytdlpPath: string
  url: string
  cookiePath: string
  outputTemplate: string
  runProcess?: RunProcess
  statFile?: (path: string) => Promise<{ size: number }>
}): Promise<{ audioPath: string }> {
  const result = await run(ytdlpPath, buildYtdlpAudioArgs({ url, cookiePath, outputTemplate }))

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
    throw new Error(`Audio download output file is missing: ${audioPath}. ${detail}`)
  }

  if (audioStats.size <= 0) {
    throw new Error(`Audio download produced an empty file: ${audioPath} size=${audioStats.size}`)
  }

  return { audioPath }
}

import { mkdtemp as defaultMkdtemp } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { tmpdir as defaultTmpdir } from 'node:os'

const TRANSCRIPTION_TEMP_PREFIX = 'bilimi-transcribe-'
const FALLBACK_WINDOWS_TEMP_ROOT = 'C:\\Windows\\Temp'

type TranscriptionTempDirectoryDependencies = {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  tmpdir?: () => string
  mkdtemp?: typeof defaultMkdtemp
}

function isAsciiPath(value: string): boolean {
  return /^[\x00-\x7F]+$/u.test(value)
}

function windowsTempRoots(env: NodeJS.ProcessEnv): string[] {
  const candidates = [
    env.SystemRoot ? win32.join(env.SystemRoot, 'Temp') : undefined,
    env.SystemDrive ? win32.join(env.SystemDrive, 'Windows', 'Temp') : undefined,
    FALLBACK_WINDOWS_TEMP_ROOT
  ]
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate) && isAsciiPath(candidate)))]
}

/**
 * sherpa-onnx's Windows executable currently cannot open paths containing
 * non-ASCII characters. Keep every temporary transcription artifact in an
 * ASCII-only directory on Windows, while preserving the normal OS temp path
 * on other platforms.
 */
export async function createTranscriptionTempDirectory({
  platform = process.platform,
  env = process.env,
  tmpdir = defaultTmpdir,
  mkdtemp = defaultMkdtemp
}: TranscriptionTempDirectoryDependencies = {}): Promise<string> {
  const platformTempRoot = tmpdir()
  const roots = platform === 'win32'
    ? [...windowsTempRoots(env), ...(isAsciiPath(platformTempRoot) ? [platformTempRoot] : [])]
    : [platformTempRoot]
  let lastError: unknown

  for (const root of [...new Set(roots)]) {
    try {
      return await mkdtemp(platform === 'win32'
        ? win32.join(root, TRANSCRIPTION_TEMP_PREFIX)
        : posix.join(root, TRANSCRIPTION_TEMP_PREFIX))
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to create a temporary directory for transcription.')
}

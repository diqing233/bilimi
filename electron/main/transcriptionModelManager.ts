import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat, statfs as statFilesystem, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { TranscriptionModelId, TranscriptionModelInstallation } from '../../src/shared/types'
import { probeFasterWhisperCudaRuntime, type FasterWhisperGpuProbe } from './fasterWhisperGpu'
import {
  TRANSCRIPTION_MODEL_MANIFEST,
  type TranscriptionModelArtifact,
  type TranscriptionModelArtifactSource
} from './transcriptionModelManifest'

type GitHubSplitSource = Extract<TranscriptionModelArtifactSource, { parts: unknown }>
type DownloadInput = { source: string; destination: string; offset: number; onProgress?: (received: number, total: number) => void; signal?: AbortSignal }
type InstallPhase = 'connecting' | 'downloading' | 'downloading-part' | 'verifying' | 'merging-parts' | 'installing'
type InstallPhaseCallback = (phase: InstallPhase, details?: { source?: 'ModelScope' | 'GitHub Release' | 'Official source'; partIndex?: number; partCount?: number; sourceFallbackMessage?: string }) => void
const FASTER_WHISPER_RUNTIME = {
  path: 'bilimi-faster-whisper.exe',
  bytes: 1230066949,
  sha256: '79922ca2a61918bad0447d9327316f013072d7a7d8e07a0d3a75a29cc26c06ac',
  sources: [
    { label: 'ModelScope' as const, source: 'https://modelscope.cn/models/bilimi/transcription-models/resolve/master/faster-whisper-runtime/bilimi-faster-whisper.exe' },
    { label: 'GitHub Release' as const, source: 'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/bilimi-faster-whisper.exe' }
  ]
}
export type TranscriptionRuntimePaths = {
  modelDirectory: string
  helperPath?: string
  python?: { command: string; scriptPath: string }
}
type Dependencies = {
  root?: string
  /** Read-only model root shipped in the packaged resources. */
  bundledRoot?: string
  download?: (input: DownloadInput) => Promise<string>
  verify?: (path: string, sha256: string) => Promise<boolean>
  activate?: (partialDirectory: string, finalDirectory: string) => Promise<void>
  finalize?: (partialPath: string, finalPath: string) => Promise<void>
  hasFreeSpace?: (bytes: number) => Promise<boolean>
  statfs?: typeof statFilesystem
  remove?: (path: string) => Promise<void>
  exists?: (path: string) => boolean
  copy?: (source: string, destination: string) => Promise<void>
  legacyWhisperModelPath?: () => string | null
  /** The development runtime may explicitly provide the checked helper. */
  developmentFasterWhisperHelperPath?: () => string | null
  /** Development only: run the checked Python helper without presenting its script as an executable. */
  developmentFasterWhisperPython?: () => { command: string; scriptPath: string } | null
  isRuntimeValidated?: (id: TranscriptionModelId) => boolean
  markRuntimeValidated?: (id: TranscriptionModelId) => Promise<void>
  clearRuntimeValidated?: (id: TranscriptionModelId) => Promise<void>
  validateRuntime?: (
    id: TranscriptionModelId,
    paths: TranscriptionRuntimePaths
  ) => Promise<void>
  prepareSenseVoice?: (input: { partialDirectory: string; outputDirectory: string }) => Promise<void>
  probeFasterWhisperGpu?: typeof probeFasterWhisperCudaRuntime
}

export async function fetchToPartial({ source, destination, offset, onProgress, signal }: DownloadInput): Promise<string> {
  const response = await fetch(source, { headers: offset > 0 ? { Range: `bytes=${offset}-` } : {}, signal })
  if (!response.ok && response.status !== 206) throw new Error(`Model download failed: ${response.status}`)
  if (!response.body) throw new Error('Model download response has no body.')
  await mkdir(dirname(destination), { recursive: true })
  const resumed = offset > 0 && response.status === 206
  const output = createWriteStream(destination, { flags: resumed ? 'a' : 'w' })
  const total = Number(response.headers.get('content-length') ?? 0) + (resumed ? offset : 0)
  let received = resumed ? offset : 0
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.byteLength
      onProgress?.(received, total)
      callback(null, chunk)
    }
  })
  try {
    await pipeline(Readable.fromWeb(response.body as never), progress, output, { signal })
  } finally {
    if (!output.closed) output.destroy()
  }
  return destination
}

async function sha256Matches(path: string, expected: string): Promise<boolean> {
  const file = await import('node:fs').then(({ createReadStream }) => createReadStream(path))
  const hash = createHash('sha256')
  for await (const chunk of file) hash.update(chunk)
  return hash.digest('hex') === expected
}

async function existingFilesystemPath(path: string): Promise<string> {
  let candidate = resolve(path)
  while (true) {
    try {
      await stat(candidate)
      return candidate
    } catch {
      // Keep walking only within the configured model root's ancestor chain.
    }
    const parent = dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  return candidate
}

async function hasAvailableDiskSpace(path: string, bytes: number, getFilesystemStats: typeof statFilesystem): Promise<boolean> {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return false
  try {
    const filesystem = await getFilesystemStats(await existingFilesystemPath(path), { bigint: true })
    return filesystem.bavail * filesystem.bsize >= BigInt(bytes)
  } catch {
    return false
  }
}

async function concatenateFiles(partPaths: string[], destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })
  const output = createWriteStream(destination, { flags: 'w' })
  try {
    for (const partPath of partPaths) {
      for await (const chunk of createReadStream(partPath)) {
        if (!output.write(chunk)) await new Promise<void>((resolve) => output.once('drain', resolve))
      }
    }
    await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()))
  } catch (error) {
    output.destroy()
    throw error
  }
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw Object.assign(new Error('Model download canceled.'), { name: 'AbortError' })
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isGitHubSplitSource(source: TranscriptionModelArtifactSource): source is GitHubSplitSource {
  return 'parts' in source
}

function runTar(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('tar.exe', args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve(stdout)
    })
  })
}

function isSafeArchiveEntry(entry: string): boolean {
  const normalized = entry.replace(/\\/gu, '/')
  return Boolean(normalized) && !normalized.startsWith('/') && !/^[A-Za-z]:/u.test(normalized) && !normalized.split('/').includes('..')
}

async function extractVerifiedArchive(archivePath: string, destination: string): Promise<void> {
  const entries = (await runTar(['-tjf', archivePath])).split(/\r?\n/u).filter(Boolean)
  if (!entries.length || entries.some((entry) => !isSafeArchiveEntry(entry))) {
    throw new Error('Verified model archive has an unsafe or empty layout.')
  }
  await mkdir(destination, { recursive: true })
  await runTar(['-xjf', archivePath, '-C', destination])
}

async function prepareSenseVoiceInstall({ partialDirectory, outputDirectory }: { partialDirectory: string; outputDirectory: string }): Promise<void> {
  const runtimeExtract = join(partialDirectory, 'runtime-extract')
  const modelExtract = join(partialDirectory, 'model-extract')
  const runtimeArchive = join(partialDirectory, 'runtime', 'sherpa-onnx-v1.13.4-win-x64-shared-MD-Release-no-tts.tar.bz2')
  const modelArchive = join(partialDirectory, 'model', 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2')
  await extractVerifiedArchive(runtimeArchive, runtimeExtract)
  await extractVerifiedArchive(modelArchive, modelExtract)

  const runtimeSource = join(runtimeExtract, 'sherpa-onnx-v1.13.4-win-x64-shared-MD-Release-no-tts')
  const modelSource = join(modelExtract, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09')
  const required = [
    join(runtimeSource, 'bin', 'sherpa-onnx-offline.exe'),
    join(modelSource, 'model.int8.onnx'),
    join(modelSource, 'tokens.txt')
  ]
  if (required.some((path) => !existsSync(path))) throw new Error('SenseVoice archive layout is missing required files.')
  await mkdir(outputDirectory, { recursive: true })
  await rename(runtimeSource, join(outputDirectory, 'runtime'))
  await rename(modelSource, join(outputDirectory, 'model'))
}

export function createTranscriptionModelManager(deps: Dependencies = {}) {
  const root = deps.root ?? join(process.env.LOCALAPPDATA ?? process.cwd(), 'bilimi', 'transcription-models')
  const bundledRoot = deps.bundledRoot ? resolve(deps.bundledRoot) : null
  const download = deps.download ?? fetchToPartial
  const verify = deps.verify ?? sha256Matches
  const activate = deps.activate ?? (async (partialDirectory, finalDirectory) => {
    await mkdir(dirname(finalDirectory), { recursive: true })
    await rename(partialDirectory, finalDirectory)
  })
  const finalize = deps.finalize ?? (async (partialPath, finalPath) => rename(partialPath, finalPath))
  const remove = deps.remove ?? (async (path) => rm(path, { recursive: true, force: true }))
  const copy = deps.copy ?? copyFile
  const getFilesystemStats = deps.statfs ?? statFilesystem
  const hasFreeSpace = deps.hasFreeSpace ?? ((bytes: number) => hasAvailableDiskSpace(root, bytes, getFilesystemStats))
  const prepareSenseVoice = deps.prepareSenseVoice ?? prepareSenseVoiceInstall
  const legacyWhisperModelPath = deps.legacyWhisperModelPath ?? (() => null)
  const developmentFasterWhisperHelperPath = deps.developmentFasterWhisperHelperPath ?? (() => null)
  const developmentFasterWhisperPython = deps.developmentFasterWhisperPython ?? (() => null)
  const validationPath = join(root, 'runtime-validation.json')
  const persistedValidation = new Set<TranscriptionModelId>()
  try {
    const saved = JSON.parse(readFileSync(validationPath, 'utf8')) as unknown
    if (Array.isArray(saved)) {
      for (const id of saved) {
        if (typeof id === 'string' && id in TRANSCRIPTION_MODEL_MANIFEST) persistedValidation.add(id as TranscriptionModelId)
      }
    }
  } catch {
    // The first successful validation creates this machine-wide sidecar.
  }
  const isRuntimeValidated = deps.isRuntimeValidated ?? ((id: TranscriptionModelId) => persistedValidation.has(id))
  const markRuntimeValidated = deps.markRuntimeValidated ?? (async (id: TranscriptionModelId) => {
    persistedValidation.add(id)
    await mkdir(root, { recursive: true })
    await writeFile(validationPath, JSON.stringify([...persistedValidation].sort()), 'utf8')
  })
  const clearRuntimeValidated = deps.clearRuntimeValidated ?? (async (id: TranscriptionModelId) => {
    persistedValidation.delete(id)
    await mkdir(root, { recursive: true })
    await writeFile(validationPath, JSON.stringify([...persistedValidation].sort()), 'utf8')
  })
  const validateRuntime = deps.validateRuntime
  const exists = deps.exists ?? existsSync
  const probeFasterWhisperGpu = deps.probeFasterWhisperGpu ?? probeFasterWhisperCudaRuntime
  const artifactDownloadBytes = (id: TranscriptionModelId) => TRANSCRIPTION_MODEL_MANIFEST[id].artifacts.reduce((total, artifact) => total + artifact.bytes, 0)
  const needsSharedFasterWhisperRuntime = (id: TranscriptionModelId) =>
    TRANSCRIPTION_MODEL_MANIFEST[id].runtimeFamily === 'faster-whisper' && !exists(join(root, 'faster-whisper-runtime', FASTER_WHISPER_RUNTIME.path))
  const downloadBytes = (id: TranscriptionModelId) => artifactDownloadBytes(id) + (needsSharedFasterWhisperRuntime(id) ? FASTER_WHISPER_RUNTIME.bytes : 0)
  const requiredWorkspaceBytes = (id: TranscriptionModelId) => {
    const manifest = TRANSCRIPTION_MODEL_MANIFEST[id]
    const downloadedBytes = artifactDownloadBytes(id)
    const sharedRuntimeBytes = needsSharedFasterWhisperRuntime(id)
      ? FASTER_WHISPER_RUNTIME.bytes
      : 0
    return (id === 'sensevoice-small' ? downloadedBytes + manifest.installedBytes : Math.max(downloadedBytes, manifest.installedBytes)) + sharedRuntimeBytes
  }
  const resolveWhisperSmallPath = () => {
    const managedPath = join(root, 'whisper-small', 'ggml-small.bin')
    if (exists(managedPath)) return managedPath.replace(/\\/gu, '/')
    const legacyPath = legacyWhisperModelPath()
    return legacyPath && exists(legacyPath) ? legacyPath.replace(/\\/gu, '/') : null
  }
  const resolveFasterWhisperPaths = (id: Extract<TranscriptionModelId, `faster-whisper-${string}`>) => {
    const modelDirectory = join(root, id)
    const managedHelperPath = join(root, 'faster-whisper-runtime', 'bilimi-faster-whisper.exe')
    const helperPath = exists(managedHelperPath) ? managedHelperPath : developmentFasterWhisperHelperPath()
    const python = helperPath ? null : developmentFasterWhisperPython()
    return (helperPath || python) && hasFasterWhisperModelFiles(id)
      ? {
          modelDirectory: modelDirectory.replace(/\\/gu, '/'),
          ...(helperPath ? { helperPath: helperPath.replace(/\\/gu, '/') } : {}),
          ...(python ? { python: { command: python.command, scriptPath: python.scriptPath.replace(/\\/gu, '/') } } : {})
        }
      : null
  }
  const hasFasterWhisperModelFiles = (id: Extract<TranscriptionModelId, `faster-whisper-${string}`>) =>
    TRANSCRIPTION_MODEL_MANIFEST[id].artifacts.every((artifact) => exists(join(root, id, artifact.path)))
  const activateVerifiedPartial = async (id: TranscriptionModelId, partialDirectory: string) => {
    const finalDirectory = join(root, id)
    if (id === 'sensevoice-small') {
      const outputDirectory = join(partialDirectory, 'install')
      await prepareSenseVoice({ partialDirectory, outputDirectory })
      await activate(outputDirectory, finalDirectory)
    } else {
      await activate(partialDirectory, finalDirectory)
    }
  }
  const downloadSplitArtifact = async (
    artifact: TranscriptionModelArtifact,
    source: GitHubSplitSource,
    partialDirectory: string,
    partialPath: string,
    completedBytes: number,
    totalBytes: number,
    onProgress: ((received: number, total: number) => void) | undefined,
    signal: AbortSignal | undefined,
    onPhase: InstallPhaseCallback | undefined
  ) => {
    const partsDirectory = join(partialDirectory, '.github-parts', artifact.path)
    const partPaths: string[] = []
    let precedingBytes = 0
    for (const [index, part] of source.parts.entries()) {
      throwIfAborted(signal)
      const partPath = join(partsDirectory, `${String(index + 1).padStart(3, '0')}.partial`)
      partPaths.push(partPath)
      const existingBytes = await stat(partPath).then((entry) => entry.size).catch(() => 0)
      if (existingBytes !== part.bytes || !(await verify(partPath, part.sha256))) {
        if (existingBytes > 0) await remove(partPath)
        onPhase?.('downloading-part', { source: source.label, partIndex: index + 1, partCount: source.parts.length })
        await download({
          source: part.source,
          destination: partPath,
          offset: 0,
          onProgress: (received) => onProgress?.(completedBytes + precedingBytes + received, totalBytes),
          signal
        })
        throwIfAborted(signal)
        onPhase?.('verifying', { source: source.label, partIndex: index + 1, partCount: source.parts.length })
        if (!(await verify(partPath, part.sha256))) {
          await remove(partPath)
          throw new Error(`GitHub Release part verification failed: ${artifact.path} part ${index + 1}`)
        }
      }
      precedingBytes += part.bytes
    }
    throwIfAborted(signal)
    if (!(await hasFreeSpace(artifact.bytes))) {
      throw new Error('Insufficient free disk space to reassemble the model artifact.')
    }
    await remove(partialPath)
    onPhase?.('merging-parts', { source: source.label, partCount: source.parts.length })
    await concatenateFiles(partPaths, partialPath)
    throwIfAborted(signal)
    onPhase?.('verifying', { source: source.label, partCount: source.parts.length })
    if (!(await verify(partialPath, artifact.sha256))) {
      await remove(partialPath)
      throw new Error(`GitHub Release reassembly verification failed: ${artifact.path}`)
    }
    await remove(partsDirectory)
  }
  const resolveSenseVoicePathsAt = (base: string) => {
    const modelDirectory = join(base, 'sensevoice-small', 'model')
    const helperPath = join(base, 'sensevoice-small', 'runtime', 'bin', 'sherpa-onnx-offline.exe')
    return exists(helperPath) && exists(join(modelDirectory, 'model.int8.onnx')) && exists(join(modelDirectory, 'tokens.txt'))
      ? { helperPath: helperPath.replace(/\\/gu, '/'), modelDirectory: modelDirectory.replace(/\\/gu, '/') }
      : null
  }
  const bundledSenseVoicePaths = () => bundledRoot ? resolveSenseVoicePathsAt(bundledRoot) : null
  const resolveSenseVoicePaths = () => resolveSenseVoicePathsAt(root) ?? bundledSenseVoicePaths()
  const isAvailable = (id: TranscriptionModelId) => {
    if (id === 'sensevoice-small') return resolveSenseVoicePaths() !== null && (bundledSenseVoicePaths() !== null || isRuntimeValidated(id))
    if (id === 'whisper-small') return resolveWhisperSmallPath() !== null
    return resolveFasterWhisperPaths(id) !== null && isRuntimeValidated(id)
  }
  const managedModelDirectory = (id: TranscriptionModelId) => join(root, id)
  const isManagedInstallation = (id: TranscriptionModelId) => {
    if (id === 'sensevoice-small') return resolveSenseVoicePathsAt(root) !== null
    if (id === 'whisper-small') return exists(join(managedModelDirectory(id), 'ggml-small.bin'))
    return hasFasterWhisperModelFiles(id)
  }
  const removableModelPath = (id: unknown): { id: TranscriptionModelId; path: string } => {
    if (typeof id !== 'string' || !(id in TRANSCRIPTION_MODEL_MANIFEST)) {
      throw new Error('Only removable downloaded transcription models can be deleted.')
    }
    if (!isManagedInstallation(id as TranscriptionModelId)) {
      throw new Error('Only installed models in bilimi managed storage can be deleted.')
    }
    const resolvedRoot = resolve(root)
    const path = resolve(resolvedRoot, id)
    if (relative(resolvedRoot, path) !== id) {
      throw new Error('The model deletion path is outside the managed models directory.')
    }
    return { id: id as TranscriptionModelId, path }
  }

  return {
    list(): TranscriptionModelInstallation[] {
      return Object.values(TRANSCRIPTION_MODEL_MANIFEST).map((manifest) => ({
        id: manifest.id,
        bundled: manifest.bundled,
        installed: manifest.id === 'sensevoice-small'
          ? resolveSenseVoicePaths() !== null
          : manifest.id === 'whisper-small'
          ? resolveWhisperSmallPath() !== null
            : hasFasterWhisperModelFiles(manifest.id),
        resumable: exists(join(root, `${manifest.id}.partial`)),
        ...(isManagedInstallation(manifest.id) ? {
          removable: true,
          managedPath: managedModelDirectory(manifest.id).replace(/\\/gu, '/')
        } : {}),
        ...(manifest.id === 'whisper-small' && !isManagedInstallation(manifest.id) && resolveWhisperSmallPath() ? {
          migratable: true
        } : {}),
        available: isAvailable(manifest.id),
        version: manifest.version,
        runtimeFamily: manifest.runtimeFamily,
        hardware: manifest.hardware,
        license: manifest.license,
        attribution: manifest.attribution,
        downloadBytes: downloadBytes(manifest.id),
        installedBytes: manifest.installedBytes
      }))
    },
    resolveSenseVoicePaths,
    resolveWhisperSmallPath,
    resolveFasterWhisperPaths,
    async revalidate(id: TranscriptionModelId): Promise<void> {
      if (id === 'whisper-small') {
        if (!resolveWhisperSmallPath()) throw new Error('The verified local runtime is unavailable.')
        return
      }
      const paths = id === 'sensevoice-small' ? resolveSenseVoicePaths() : resolveFasterWhisperPaths(id)
      if (!paths) throw new Error('Controlled transcription runtime or model is not verified.')
      if (!validateRuntime) {
        throw new Error('Controlled faster-whisper runtime validation is unavailable in this build.')
      }
      await validateRuntime(id, paths)
      await markRuntimeValidated(id)
    },
    async probeFasterWhisperGpu(id: TranscriptionModelId): Promise<FasterWhisperGpuProbe & { modelId: TranscriptionModelId }> {
      if (id !== 'faster-whisper-large-v3' && id !== 'faster-whisper-large-v3-turbo') {
        return {
          modelId: id,
          status: 'cpu-only',
          reason: 'GPU acceleration only applies to faster-whisper large models.'
        }
      }
      const paths = resolveFasterWhisperPaths(id)
      if (!paths) {
        return {
          modelId: id,
          status: 'cpu-only',
          reason: 'Controlled faster-whisper runtime or model is not verified.'
        }
      }
      const helperPath = paths.helperPath ?? paths.python?.command
      if (!helperPath) return { modelId: id, status: 'cpu-only', reason: 'Controlled faster-whisper runtime is unavailable.' }
      return { ...await probeFasterWhisperGpu({
        helperPath,
        ...(paths.python ? { helperArgsPrefix: [paths.python.scriptPath] } : {}),
        modelDirectory: paths.modelDirectory
      }), modelId: id }
    },
    async install(
      id: TranscriptionModelId,
      onProgress?: (received: number, total: number) => void,
      signal?: AbortSignal,
      onPhase?: InstallPhaseCallback,
      restart = false
    ) {
      const manifest = TRANSCRIPTION_MODEL_MANIFEST[id]
      const requiredBytes = requiredWorkspaceBytes(id)
      if (!(await hasFreeSpace(requiredBytes))) throw new Error('Insufficient free disk space for model installation.')
      const partialDirectory = join(root, `${id}.partial`)
      if (restart) await remove(partialDirectory)
      let completedBytes = 0
      const needsSharedRuntime = needsSharedFasterWhisperRuntime(id)
      const totalBytes = downloadBytes(id)
      if (needsSharedRuntime) {
        const runtimePartialDirectory = join(root, 'faster-whisper-runtime.partial')
        const runtimePartialPath = join(runtimePartialDirectory, `${FASTER_WHISPER_RUNTIME.path}.partial`)
        const attempts: string[] = []
        let downloaded = false
        for (const source of FASTER_WHISPER_RUNTIME.sources) {
          try {
            throwIfAborted(signal)
            onPhase?.('connecting', { source: source.label })
            let offset = await stat(runtimePartialPath).then((entry) => entry.size).catch(() => 0)
            if (offset !== FASTER_WHISPER_RUNTIME.bytes || !(await verify(runtimePartialPath, FASTER_WHISPER_RUNTIME.sha256))) {
              if (offset >= FASTER_WHISPER_RUNTIME.bytes) { await remove(runtimePartialPath); offset = 0 }
              onPhase?.('downloading', { source: source.label })
              await download({ source: source.source, destination: runtimePartialPath, offset, onProgress: (received) => onProgress?.(received, totalBytes), signal })
              onPhase?.('verifying', { source: source.label })
              if (!(await verify(runtimePartialPath, FASTER_WHISPER_RUNTIME.sha256))) throw new Error('Shared faster-whisper runtime verification failed.')
            }
            await finalize(runtimePartialPath, join(runtimePartialDirectory, FASTER_WHISPER_RUNTIME.path))
            await activate(runtimePartialDirectory, join(root, 'faster-whisper-runtime'))
            downloaded = true
            break
          } catch (error) {
            if (isCancellation(error, signal)) throw error
            attempts.push(`${source.label}: ${errorDetail(error)}`)
            const nextSource = FASTER_WHISPER_RUNTIME.sources[FASTER_WHISPER_RUNTIME.sources.indexOf(source) + 1]
            if (nextSource) {
              onPhase?.('connecting', {
                source: nextSource.label,
                sourceFallbackMessage: `${source.label} 连接失败，正在尝试 ${nextSource.label}`
              })
            }
          }
        }
        if (!downloaded) throw new Error(`Shared faster-whisper runtime download failed. Attempted sources: ${attempts.join('; ')}`)
        completedBytes = FASTER_WHISPER_RUNTIME.bytes
      }
      for (const artifact of manifest.artifacts) {
        const partialPath = join(partialDirectory, `${artifact.path}.partial`)
        const attempts: string[] = []
        let downloaded = false
        for (const source of artifact.sources) {
          try {
            throwIfAborted(signal)
            onPhase?.('connecting', { source: source.label })
            if (isGitHubSplitSource(source)) {
              await downloadSplitArtifact(artifact, source, partialDirectory, partialPath, completedBytes, totalBytes, onProgress, signal, onPhase)
            } else {
              let offset = await stat(partialPath).then((entry) => entry.size).catch(() => 0)
              let verifiedCompletePartial = false
              if (offset >= artifact.bytes) {
                onPhase?.('verifying', { source: source.label })
                const isValid = await verify(partialPath, artifact.sha256)
                if (offset === artifact.bytes && isValid) {
                  verifiedCompletePartial = true
                } else {
                  await remove(partialPath)
                  offset = 0
                }
              }
              if (!verifiedCompletePartial) {
                onPhase?.('downloading', { source: source.label })
                await download({
                  source: source.source,
                  destination: partialPath,
                  offset,
                  onProgress: (received, _total) => onProgress?.(completedBytes + received, totalBytes),
                  signal
                })
                throwIfAborted(signal)
                onPhase?.('verifying', { source: source.label })
                if (!(await verify(partialPath, artifact.sha256))) {
                  await remove(partialPath)
                  throw new Error(`Model artifact verification failed: ${artifact.path}`)
                }
              }
            }
            throwIfAborted(signal)
            await finalize(partialPath, join(partialDirectory, artifact.path))
            downloaded = true
            break
          } catch (error) {
            if (isCancellation(error, signal)) throw error
            if (isGitHubSplitSource(source)) {
              await remove(join(partialDirectory, '.github-parts', artifact.path))
            }
            attempts.push(`${source.label}: ${errorDetail(error)}`)
            const nextSource = artifact.sources[artifact.sources.indexOf(source) + 1]
            if (nextSource) {
              onPhase?.('connecting', {
                source: nextSource.label,
                sourceFallbackMessage: `${source.label} 连接失败，正在尝试 ${nextSource.label}`
              })
            }
          }
        }
        if (!downloaded) throw new Error(`Model artifact download failed: ${artifact.path}. Attempted sources: ${attempts.join('; ')}`)
        completedBytes += artifact.bytes
      }
      onPhase?.('installing')
      await activateVerifiedPartial(id, partialDirectory)
    },
    async importFromDirectory(id: TranscriptionModelId, sourceDirectory: string) {
      const manifest = TRANSCRIPTION_MODEL_MANIFEST[id]
      const requiredBytes = requiredWorkspaceBytes(id)
      if (!(await hasFreeSpace(requiredBytes))) {
        throw new Error('Insufficient free disk space for model installation.')
      }
      const partialDirectory = join(root, `${id}.partial`)
      for (const artifact of manifest.artifacts) {
        const partialPath = join(partialDirectory, `${artifact.path}.partial`)
        await mkdir(dirname(partialPath), { recursive: true })
        await copy(join(sourceDirectory, artifact.path), partialPath)
        if (!(await verify(partialPath, artifact.sha256))) {
          await remove(partialPath)
          throw new Error(`Model artifact verification failed: ${artifact.path}`)
        }
        await finalize(partialPath, join(partialDirectory, artifact.path))
      }
      await activateVerifiedPartial(id, partialDirectory)
    },
    async migrateLegacyWhisperSmall() {
      const legacyPath = legacyWhisperModelPath()
      const managedPath = join(managedModelDirectory('whisper-small'), 'ggml-small.bin')
      const migrationPartialPath = join(root, 'whisper-small.migration.partial')
      if (!legacyPath || !exists(legacyPath)) throw new Error('The bundled Whisper small model is unavailable.')
      if (exists(managedPath)) throw new Error('Whisper small is already managed by bilimi.')
      if (!(await hasFreeSpace(TRANSCRIPTION_MODEL_MANIFEST['whisper-small'].installedBytes))) {
        throw new Error('Insufficient free disk space to migrate Whisper small.')
      }
      await mkdir(root, { recursive: true })
      await copy(legacyPath, migrationPartialPath)
      if (!(await verify(migrationPartialPath, TRANSCRIPTION_MODEL_MANIFEST['whisper-small'].artifacts[0].sha256))) {
        await remove(migrationPartialPath)
        throw new Error('Whisper small verification failed during migration.')
      }
      await mkdir(dirname(managedPath), { recursive: true })
      await finalize(migrationPartialPath, managedPath)
    },
    async remove(id: unknown, isInUse: (modelId: TranscriptionModelId) => boolean) {
      const removable = removableModelPath(id)
      if (isInUse(removable.id)) throw new Error(`The ${removable.id} model is currently used by a queued transcription job.`)
      await remove(removable.path)
      await clearRuntimeValidated(removable.id)
    }
  }
}

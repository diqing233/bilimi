import { describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTranscriptionModelManager, fetchToPartial } from './transcriptionModelManager'
import { TRANSCRIPTION_MODEL_MANIFEST } from './transcriptionModelManifest'

describe('transcription model manager', () => {
  it('fails closed before downloading when the default disk-space probe cannot determine available capacity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-default-space-test-'))
    const download = vi.fn(async ({ destination }: { destination: string }) => destination)
    const statfs = vi.fn(async () => { throw new Error('capacity unavailable') })
    const manager = createTranscriptionModelManager({ root, download, statfs })

    try {
      await expect(manager.install('whisper-small')).rejects.toThrow('Insufficient free disk space for model installation.')
      expect(statfs).toHaveBeenCalledWith(root, { bigint: true })
      expect(download).not.toHaveBeenCalled()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reserves both verified SenseVoice archives and extracted footprint before installation', async () => {
    const hasFreeSpace = vi.fn(async () => true)
    const manager = createTranscriptionModelManager({
      download: async ({ destination }) => destination,
      verify: async () => true,
      finalize: async () => undefined,
      prepareSenseVoice: async () => undefined,
      activate: async () => undefined,
      hasFreeSpace
    })

    await manager.install('sensevoice-small')

    expect(hasFreeSpace).toHaveBeenCalledWith(482798838)
  })

  it('verifies every artifact before atomically activating a downloaded model', async () => {
    const download = vi.fn(async ({ destination }: { destination: string }) => destination)
    const verify = vi.fn(async () => true)
    const activate = vi.fn(async () => undefined)
    const finalize = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({ download, verify, activate, finalize, hasFreeSpace: async () => true })

    await manager.install('whisper-small')

    expect(verify).toHaveBeenCalledWith(expect.stringContaining('ggml-small.bin.partial'), '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b')
    expect(activate).toHaveBeenCalledTimes(1)
    expect(finalize).toHaveBeenCalledWith(expect.stringContaining('ggml-small.bin.partial'), expect.stringContaining('ggml-small.bin'))
  })

  it('reports multi-artifact download progress against the complete model size', async () => {
    const reports: Array<[number, number]> = []
    const manager = createTranscriptionModelManager({
      download: async ({ onProgress }) => {
        onProgress?.(10, 10)
        return 'partial'
      },
      verify: async () => true,
      finalize: async () => undefined,
      prepareSenseVoice: async () => undefined,
      activate: async () => undefined,
      hasFreeSpace: async () => true
    })

    await manager.install('sensevoice-small', (received, total) => reports.push([received, total]))

    expect(reports.at(0)).toEqual([10, TRANSCRIPTION_MODEL_MANIFEST['sensevoice-small'].artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0)])
    expect(reports.at(-1)?.[0]).toBeGreaterThan(10)
  })

  it('never activates a model when an artifact hash is wrong', async () => {
    const activate = vi.fn()
    const manager = createTranscriptionModelManager({ download: async ({ destination }) => destination, verify: async () => false, activate, hasFreeSpace: async () => true })
    await expect(manager.install('whisper-small')).rejects.toThrow('verification failed')
    expect(activate).not.toHaveBeenCalled()
  })

  it('removes a checksum-failed partial artifact so the next download starts cleanly', async () => {
    const remove = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({
      download: async ({ destination }) => destination,
      verify: async () => false,
      remove,
      hasFreeSpace: async () => true
    })

    await expect(manager.install('whisper-small')).rejects.toThrow('verification failed')
    expect(remove).toHaveBeenCalledWith(expect.stringContaining('ggml-small.bin.partial'))
  })

  it('only discards a retained partial when an explicit restart is requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-explicit-restart-test-'))
    const partialDirectory = join(root, 'whisper-small.partial')
    const remove = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }))
    const manager = createTranscriptionModelManager({
      root,
      remove,
      download: async ({ destination }) => destination,
      verify: async () => true,
      finalize: async () => undefined,
      activate: async () => undefined,
      hasFreeSpace: async () => true
    })

    try {
      await mkdir(partialDirectory, { recursive: true })
      await writeFile(join(partialDirectory, 'retained.partial'), 'keep unless restarted', 'utf8')

      await manager.install('whisper-small', undefined, undefined, undefined, true)

      expect(remove).toHaveBeenCalledWith(partialDirectory)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to delete a model while a queued job is using it', async () => {
    const remove = vi.fn()
    const manager = createTranscriptionModelManager({ remove, exists: () => true, hasFreeSpace: async () => true })

    await expect(manager.remove('faster-whisper-large-v3', () => true)).rejects.toThrow('currently used')
    expect(remove).not.toHaveBeenCalled()
  })

  it('removes every managed downloaded model but never accepts an unsafe path', async () => {
    const remove = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({ root: 'C:/models', remove, exists: () => true })

    await expect(manager.remove('../../outside' as never, () => false)).rejects.toThrow('removable')
    await manager.remove('sensevoice-small', () => false)
    await manager.remove('whisper-small', () => false)

    expect(remove).toHaveBeenCalledWith(expect.stringMatching(/[\\/]models[\\/]sensevoice-small$/u))
    expect(remove).toHaveBeenCalledWith(expect.stringMatching(/[\\/]models[\\/]whisper-small$/u))
  })

  it('does not delete a legacy Whisper installation outside bilimi managed storage', async () => {
    const remove = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({
      root: 'C:/models',
      remove,
      legacyWhisperModelPath: () => 'D:/user-models/ggml-small.bin',
      exists: (path) => path === 'D:/user-models/ggml-small.bin'
    })

    const whisper = manager.list().find((model) => model.id === 'whisper-small')
    expect(whisper).toMatchObject({ installed: true })
    expect(whisper).not.toHaveProperty('removable')
    await expect(manager.remove('whisper-small', () => false)).rejects.toThrow('managed')
    expect(remove).not.toHaveBeenCalled()
  })

  it('copies a verified legacy Whisper model into managed storage without deleting the bundled source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-whisper-migration-root-'))
    const legacyDirectory = await mkdtemp(join(tmpdir(), 'bilimi-whisper-migration-legacy-'))
    const legacyPath = join(legacyDirectory, 'ggml-small.bin')
    await writeFile(legacyPath, 'legacy whisper model', 'utf8')
    const manager = createTranscriptionModelManager({
      root,
      legacyWhisperModelPath: () => legacyPath,
      verify: async () => true,
      hasFreeSpace: async () => true
    })

    try {
      await manager.migrateLegacyWhisperSmall()

      expect(existsSync(legacyPath)).toBe(true)
      expect(existsSync(join(root, 'whisper-small', 'ggml-small.bin'))).toBe(true)
      expect(manager.list()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'whisper-small', installed: true, removable: true })
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(legacyDirectory, { recursive: true, force: true })
    }
  })

  it('cleans up the migration partial when legacy Whisper verification fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-whisper-migration-failure-root-'))
    const legacyDirectory = await mkdtemp(join(tmpdir(), 'bilimi-whisper-migration-failure-legacy-'))
    const legacyPath = join(legacyDirectory, 'ggml-small.bin')
    await writeFile(legacyPath, 'legacy whisper model', 'utf8')
    const manager = createTranscriptionModelManager({
      root,
      legacyWhisperModelPath: () => legacyPath,
      verify: async () => false,
      hasFreeSpace: async () => true
    })

    try {
      await expect(manager.migrateLegacyWhisperSmall()).rejects.toThrow('verification failed')
      expect(existsSync(join(root, 'whisper-small.migration.partial'))).toBe(false)
      expect(existsSync(legacyPath)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(legacyDirectory, { recursive: true, force: true })
    }
  })

  it('clears persisted runtime validation when a managed model is removed', async () => {
    const clearRuntimeValidated = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({ clearRuntimeValidated, remove: async () => undefined, exists: () => true })

    await manager.remove('faster-whisper-large-v3', () => false)

    expect(clearRuntimeValidated).toHaveBeenCalledWith('faster-whisper-large-v3')
  })

  it('reports optional models as unavailable until their verified directory exists', () => {
    const manager = createTranscriptionModelManager({ exists: (path) => path.endsWith('whisper-small\\ggml-small.bin') })

    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'whisper-small', installed: true, available: true }),
      expect.objectContaining({ id: 'faster-whisper-large-v3', installed: false })
    ]))
  })

  it('reports a bundled SenseVoiceSmall runtime as available and non-removable', () => {
    const manager = createTranscriptionModelManager({
      root: 'C:/bilimi-test/transcription-models',
      bundledRoot: 'C:/bilimi-test/bundled-models',
      exists: (path) => [
        'C:/bilimi-test/bundled-models/sensevoice-small/runtime/bin/sherpa-onnx-offline.exe',
        'C:/bilimi-test/bundled-models/sensevoice-small/model/model.int8.onnx',
        'C:/bilimi-test/bundled-models/sensevoice-small/model/tokens.txt'
      ].includes(path.replace(/\\/gu, '/'))
    })

    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sensevoice-small', bundled: true, installed: true, available: true })
    ]))
    expect(manager.list().find((model) => model.id === 'sensevoice-small')).not.toHaveProperty('removable')
  })

  it('reports CPU-only until the controlled faster-whisper CUDA self-test succeeds', async () => {
    const probeFasterWhisperGpu = vi.fn().mockResolvedValue({ status: 'available', device: 'cuda', computeType: 'float16', memoryMiB: 12288 })
    const manager = createTranscriptionModelManager({
      exists: (path) => path.includes('faster-whisper-large-v3') || path.endsWith('bilimi-faster-whisper.exe'),
      probeFasterWhisperGpu
    })

    await expect(manager.probeFasterWhisperGpu('faster-whisper-large-v3')).resolves.toEqual({ modelId: 'faster-whisper-large-v3', status: 'available', device: 'cuda', computeType: 'float16', memoryMiB: 12288 })
    expect(probeFasterWhisperGpu).toHaveBeenCalledWith({
      helperPath: expect.stringContaining('bilimi-faster-whisper.exe'),
      modelDirectory: expect.stringContaining('faster-whisper-large-v3')
    })
    await expect(manager.probeFasterWhisperGpu('whisper-small')).resolves.toEqual({ modelId: 'whisper-small', status: 'cpu-only', reason: 'GPU acceleration only applies to faster-whisper large models.' })
  })

  it('treats a verified pre-existing whisper.cpp model as installed without managing its file', () => {
    const manager = createTranscriptionModelManager({
      exists: (path) => path.endsWith('ggml-small.bin'),
      legacyWhisperModelPath: () => 'C:/app/tools/win32/whisper/models/ggml-small.bin'
    })

    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'whisper-small', installed: true, available: true })
    ]))
  })

  it('prefers the verified machine-wide Whisper download over the legacy bundled path', () => {
    const manager = createTranscriptionModelManager({
      root: 'C:/models',
      exists: (path) => path.replace(/\\/gu, '/') === 'C:/models/whisper-small/ggml-small.bin',
      legacyWhisperModelPath: () => 'C:/app/tools/win32/whisper/models/ggml-small.bin'
    })

    expect(manager.resolveWhisperSmallPath()).toBe('C:/models/whisper-small/ggml-small.bin')
  })

  it('exposes a large faster-whisper model only when the shared helper and every required file exist', () => {
    const root = 'C:/models'
    const modelId = 'faster-whisper-large-v3'
    const required = ['model.bin', 'config.json', 'preprocessor_config.json', 'tokenizer.json', 'vocabulary.json']
    const paths = new Set([
      `${root}/faster-whisper-runtime/bilimi-faster-whisper.exe`,
      ...required.map((file) => `${root}/${modelId}/${file}`)
    ])
    const manager = createTranscriptionModelManager({ root, exists: (path) => paths.has(path.replace(/\\/gu, '/')) })

    expect(manager.resolveFasterWhisperPaths(modelId)).toEqual({
      helperPath: `${root}/faster-whisper-runtime/bilimi-faster-whisper.exe`,
      modelDirectory: `${root}/${modelId}`
    })
    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: modelId, installed: true, available: false })
    ]))
  })

  it('uses an explicitly verified development helper when the packaged helper is not installed yet', () => {
    const root = 'C:/models'
    const modelId = 'faster-whisper-large-v3'
    const paths = new Set(TRANSCRIPTION_MODEL_MANIFEST[modelId].artifacts
      .map((artifact) => `${root}/${modelId}/${artifact.path}`))
    const manager = createTranscriptionModelManager({
      root,
      exists: (path) => paths.has(path.replace(/\\/gu, '/')),
      developmentFasterWhisperHelperPath: () => 'C:/workspace/tools/faster-whisper/bilimi-faster-whisper.exe'
    })

    expect(manager.resolveFasterWhisperPaths(modelId)).toEqual({
      helperPath: 'C:/workspace/tools/faster-whisper/bilimi-faster-whisper.exe',
      modelDirectory: `${root}/${modelId}`
    })
    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: modelId, installed: true, available: false })
    ]))
  })

  it('uses a controlled development Python command without presenting the script as an executable helper', () => {
    const root = 'C:/models'
    const modelId = 'faster-whisper-large-v3'
    const paths = new Set(TRANSCRIPTION_MODEL_MANIFEST[modelId].artifacts
      .map((artifact) => `${root}/${modelId}/${artifact.path}`))
    const manager = createTranscriptionModelManager({
      root,
      exists: (path) => paths.has(path.replace(/\\/gu, '/')),
      developmentFasterWhisperPython: () => ({ command: 'C:/Python/python.exe', scriptPath: 'C:/repo/tools/transcribe_faster_whisper.py' })
    })

    expect(manager.resolveFasterWhisperPaths(modelId)).toEqual({
      modelDirectory: `${root}/${modelId}`,
      python: { command: 'C:/Python/python.exe', scriptPath: 'C:/repo/tools/transcribe_faster_whisper.py' }
    })
  })

  it('reports downloaded large-model files as installed while the self-contained helper is still unavailable', () => {
    const root = 'C:/models'
    const modelId = 'faster-whisper-large-v3'
    const files = new Set(['model.bin', 'config.json', 'preprocessor_config.json', 'tokenizer.json', 'vocabulary.json']
      .map((file) => `${root}/${modelId}/${file}`))
    const manager = createTranscriptionModelManager({ root, exists: (path) => files.has(path.replace(/\\/gu, '/')) })

    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: modelId, installed: true, available: false })
    ]))
  })

  it('marks a complete managed faster-whisper model as removable without requiring a runtime helper', () => {
    const root = 'C:/models'
    const modelId = 'faster-whisper-large-v3-turbo'
    const files = new Set(TRANSCRIPTION_MODEL_MANIFEST[modelId].artifacts
      .map((artifact) => `${root}/${modelId}/${artifact.path}`))
    const manager = createTranscriptionModelManager({ root, exists: (path) => files.has(path.replace(/\\/gu, '/')) })

    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: modelId, installed: true, removable: true, managedPath: `${root}/${modelId}` })
    ]))
  })

  it('requires a persisted runtime validation before verified large-model files become available', async () => {
    const root = 'C:/models'
    const modelId = 'faster-whisper-large-v3'
    const paths = new Set([
      `${root}/faster-whisper-runtime/bilimi-faster-whisper.exe`,
      ...TRANSCRIPTION_MODEL_MANIFEST[modelId].artifacts.map((artifact) => `${root}/${modelId}/${artifact.path}`)
    ])
    let runtimeValidated = false
    const validateRuntime = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({
      root,
      exists: (path) => paths.has(path.replace(/\\/gu, '/')),
      isRuntimeValidated: () => runtimeValidated,
      markRuntimeValidated: async () => { runtimeValidated = true },
      validateRuntime
    })

    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: modelId, installed: true, available: false })
    ]))

    await manager.revalidate(modelId)

    expect(validateRuntime).toHaveBeenCalledWith(modelId, {
      helperPath: `${root}/faster-whisper-runtime/bilimi-faster-whisper.exe`,
      modelDirectory: `${root}/${modelId}`
    })
    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: modelId, installed: true, available: true })
    ]))
  })

  it('exposes SenseVoice only when both verified runtime and model files exist', () => {
    const paths = new Set([
      'C:/models/sensevoice-small/runtime/bin/sherpa-onnx-offline.exe',
      'C:/models/sensevoice-small/model/model.int8.onnx',
      'C:/models/sensevoice-small/model/tokens.txt'
    ])
    const manager = createTranscriptionModelManager({ root: 'C:/models', exists: (path) => paths.has(path.replace(/\\/gu, '/')) })

    expect(manager.resolveSenseVoicePaths()).toEqual({
      helperPath: 'C:/models/sensevoice-small/runtime/bin/sherpa-onnx-offline.exe',
      modelDirectory: 'C:/models/sensevoice-small/model'
    })
    expect(manager.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sensevoice-small', installed: true, available: false })
    ]))
  })

  it('prepares verified SenseVoice archives before atomically activating the runtime layout', async () => {
    const prepareSenseVoice = vi.fn<(input: { partialDirectory: string; outputDirectory: string }) => Promise<void>>(async () => undefined)
    const activate = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({
      download: async ({ destination }) => destination,
      verify: async () => true,
      prepareSenseVoice,
      activate,
      finalize: async () => undefined,
      hasFreeSpace: async () => true
    })

    await manager.install('sensevoice-small')

    expect(prepareSenseVoice).toHaveBeenCalledTimes(1)
    const preparedPaths = prepareSenseVoice.mock.calls[0]![0]
    expect(preparedPaths.partialDirectory.replace(/\\/gu, '/')).toContain('sensevoice-small.partial')
    expect(preparedPaths.outputDirectory.replace(/\\/gu, '/')).toContain('sensevoice-small.partial/install')
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('imports only locally supplied artifacts that pass the same hash verification before activation', async () => {
    const copy = vi.fn(async () => undefined)
    const verify = vi.fn(async () => true)
    const activate = vi.fn(async () => undefined)
    const finalize = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({ copy, verify, activate, finalize, hasFreeSpace: async () => true })

    await manager.importFromDirectory('whisper-small', 'D:/verified-models')

    expect(copy).toHaveBeenCalledWith(
      expect.stringMatching(/verified-models.*ggml-small\.bin$/u),
      expect.stringMatching(/whisper-small\.partial.*ggml-small\.bin\.partial$/u)
    )
    expect(verify).toHaveBeenCalledWith(expect.stringContaining('ggml-small.bin.partial'), '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b')
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('forwards cancellation to downloads and never activates a partial model', async () => {
    const controller = new AbortController()
    const download = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      expect(signal).toBe(controller.signal)
      throw Object.assign(new Error('canceled'), { name: 'AbortError' })
    })
    const activate = vi.fn()
    const manager = createTranscriptionModelManager({ download, activate, hasFreeSpace: async () => true })

    await expect(manager.install('whisper-small', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(activate).not.toHaveBeenCalled()
  })

  it('downloads from ModelScope before contacting a backup source', async () => {
    const sources: string[] = []
    const download = vi.fn(async ({ source, destination }: { source: string; destination: string }) => {
      sources.push(source)
      return destination
    })
    const manager = createTranscriptionModelManager({
      download,
      verify: async () => true,
      finalize: async () => undefined,
      activate: async () => undefined,
      hasFreeSpace: async () => true
    })

    await manager.install('whisper-small')

    expect(download).toHaveBeenCalledTimes(1)
    expect(sources).toEqual([
      'https://modelscope.cn/models/bilimi/transcription-models/resolve/master/whisper-small/ggml-small.bin'
    ])
  })

  it('downloads the shared faster-whisper runtime once when installing a large model', async () => {
    const downloads: string[] = []
    const finalized: string[] = []
    const manager = createTranscriptionModelManager({
      exists: () => false,
      download: async ({ source, destination }) => {
        downloads.push(source)
        if (source.includes('/faster-whisper-runtime/')) throw new Error('mirror unavailable')
        return destination
      },
      verify: async () => true,
      finalize: async (_source, destination) => { finalized.push(destination.replace(/\\/gu, '/')) },
      activate: async () => undefined,
      hasFreeSpace: async () => true
    })

    await manager.install('faster-whisper-large-v3-turbo')

    expect(downloads).toContain('https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/bilimi-faster-whisper.exe')
    expect(finalized.some((path) => /faster-whisper-runtime\.partial\/bilimi-faster-whisper\.exe$/u.test(path))).toBe(true)
  })

  it('reports a shared runtime source switch before using the GitHub Release fallback', async () => {
    const phases: Array<{ phase: string; source?: string; sourceFallbackMessage?: string }> = []
    const manager = createTranscriptionModelManager({
      exists: () => false,
      download: async ({ source, destination }) => {
        if (source.includes('/faster-whisper-runtime/')) throw new Error('mirror unavailable')
        return destination
      },
      verify: async () => true,
      finalize: async () => undefined,
      activate: async () => undefined,
      hasFreeSpace: async () => true
    })

    await manager.install('faster-whisper-large-v3-turbo', undefined, undefined, (phase, details) => phases.push({ phase, ...details }))

    expect(phases).toContainEqual({
      phase: 'connecting',
      source: 'GitHub Release',
      sourceFallbackMessage: 'ModelScope 连接失败，正在尝试 GitHub Release'
    })
  })

  it('falls back to the GitHub Release while retaining the artifact partial after a mirror error', async () => {
    const sources: string[] = []
    const download = vi.fn(async ({ source, destination }: { source: string; destination: string }) => {
      sources.push(source)
      if (source.startsWith('https://modelscope.cn/')) throw new Error('mirror timed out')
      return destination
    })
    const manager = createTranscriptionModelManager({
      download,
      verify: async () => true,
      finalize: async () => undefined,
      activate: async () => undefined,
      hasFreeSpace: async () => true
    })

    await manager.install('whisper-small')

    expect(sources).toEqual([
      'https://modelscope.cn/models/bilimi/transcription-models/resolve/master/whisper-small/ggml-small.bin',
      'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/whisper-small-ggml-small.bin'
    ])
  })

  it('reports a concise source-switch state without exposing a download URL', async () => {
    const phases: Array<{ phase: string; sourceFallbackMessage?: string; source?: string }> = []
    const manager = createTranscriptionModelManager({
      download: async ({ source, destination }) => {
        if (source.startsWith('https://modelscope.cn/')) throw new Error('mirror timed out')
        return destination
      },
      verify: async () => true,
      finalize: async () => undefined,
      activate: async () => undefined,
      hasFreeSpace: async () => true
    })

    await manager.install('whisper-small', undefined, undefined, (phase, details) => phases.push({ phase, ...details }))

    expect(phases).toContainEqual({
      phase: 'connecting',
      source: 'GitHub Release',
      sourceFallbackMessage: 'ModelScope 连接失败，正在尝试 GitHub Release'
    })
    expect(JSON.stringify(phases)).not.toContain('https://')
  })

  it('does not try a backup source after cancellation', async () => {
    const controller = new AbortController()
    const sources: string[] = []
    const download = vi.fn(async ({ source }: { source: string }) => {
      sources.push(source)
      throw Object.assign(new Error('canceled'), { name: 'AbortError' })
    })
    const manager = createTranscriptionModelManager({ download, hasFreeSpace: async () => true })

    await expect(manager.install('whisper-small', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })

    expect(sources).toEqual([
      'https://modelscope.cn/models/bilimi/transcription-models/resolve/master/whisper-small/ggml-small.bin'
    ])
  })

  it('does not activate when a download ignores an already aborted signal', async () => {
    const controller = new AbortController()
    const download = vi.fn(async ({ destination }: { destination: string }) => {
      controller.abort()
      return destination
    })
    const activate = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({
      download,
      verify: async () => true,
      finalize: async () => undefined,
      activate,
      hasFreeSpace: async () => true
    })

    await expect(manager.install('whisper-small', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })

    expect(download).toHaveBeenCalledTimes(1)
    expect(activate).not.toHaveBeenCalled()
  })

  it('verifies GitHub large-v3 parts and the reassembled official model hash before activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-split-model-test-'))
    const activate = vi.fn(async () => undefined)
    const observedWholeModels: string[] = []
    const download = vi.fn(async ({ source, destination }: { source: string; destination: string }) => {
      if (source.startsWith('https://modelscope.cn/')) throw new Error('mirror unavailable')
      if (source.includes('part-')) {
        await mkdir(join(destination, '..'), { recursive: true })
        await writeFile(destination, source.slice(-3), 'utf8')
        return destination
      }
      throw new Error('official source unavailable')
    })
    const verify = vi.fn(async (path: string, sha256: string) => {
      if (sha256 === '69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1') {
        observedWholeModels.push(await readFile(path, 'utf8'))
        return false
      }
      return true
    })
    const manager = createTranscriptionModelManager({ root, download, verify, activate, hasFreeSpace: async () => true,
      exists: (path) => path.replace(/\\/gu, '/') === `${root.replace(/\\/gu, '/')}/faster-whisper-runtime/bilimi-faster-whisper.exe` })

    try {
      await expect(manager.install('faster-whisper-large-v3')).rejects.toThrow('Attempted sources')
      expect(download.mock.calls.map(([input]) => input.source)).toEqual(expect.arrayContaining([
        'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/faster-whisper-large-v3-model.bin.part-001',
        'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/faster-whisper-large-v3-model.bin.part-002',
        'https://github.com/diqing233/bilimi/releases/download/transcription-models-2026-07-28/faster-whisper-large-v3-model.bin.part-003'
      ]))
      expect(observedWholeModels).toEqual(['001002003'])
      expect(activate).not.toHaveBeenCalled()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('checks free space for the final large-v3 artifact before reassembling retained GitHub parts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-split-space-test-'))
    const hasFreeSpace = vi.fn(async () => hasFreeSpace.mock.calls.length === 1)
    const verifiedHashes: string[] = []
    const download = vi.fn(async ({ source, destination }: { source: string; destination: string }) => {
      if (source.startsWith('https://modelscope.cn/')) throw new Error('mirror unavailable')
      if (source.includes('part-')) {
        await mkdir(join(destination, '..'), { recursive: true })
        await writeFile(destination, source.slice(-3), 'utf8')
        return destination
      }
      throw new Error('source unavailable')
    })
    const verify = vi.fn(async (_path: string, sha256: string) => {
      verifiedHashes.push(sha256)
      return true
    })
    const manager = createTranscriptionModelManager({ root, download, verify, hasFreeSpace,
      exists: (path) => path.replace(/\\/gu, '/') === `${root.replace(/\\/gu, '/')}/faster-whisper-runtime/bilimi-faster-whisper.exe` })

    try {
      await expect(manager.install('faster-whisper-large-v3')).rejects.toThrow('Attempted sources')
      expect(hasFreeSpace).toHaveBeenNthCalledWith(1, 3090835702)
      expect(hasFreeSpace).toHaveBeenNthCalledWith(2, 3087284237)
      expect(verifiedHashes).not.toContain('69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cleans failed GitHub split parts before falling back to the official source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-split-fallback-test-'))
    const hasFreeSpace = vi.fn(async () => hasFreeSpace.mock.calls.length !== 2)
    const download = vi.fn(async ({ source, destination }: { source: string; destination: string }) => {
      if (source.startsWith('https://modelscope.cn/') && destination.includes('model.bin')) throw new Error('mirror unavailable')
      await mkdir(join(destination, '..'), { recursive: true })
      await writeFile(destination, source.includes('part-') ? source.slice(-3) : 'official', 'utf8')
      return destination
    })
    let retainedParts = false
    const activate = vi.fn(async (partialDirectory: string) => {
      retainedParts = await stat(join(partialDirectory, '.github-parts', 'model.bin')).then(() => true).catch(() => false)
    })
    const manager = createTranscriptionModelManager({ root, download, verify: async () => true, activate, hasFreeSpace })

    try {
      await manager.install('faster-whisper-large-v3')
      expect(retainedParts).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('finalizes a complete valid generic artifact partial without issuing a range download', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-complete-partial-test-'))
    const artifact = TRANSCRIPTION_MODEL_MANIFEST['whisper-small'].artifacts[0]
    const partialPath = join(root, 'whisper-small.partial', `${artifact.path}.partial`)
    const download = vi.fn(async ({ destination }: { destination: string }) => destination)
    const finalize = vi.fn(async () => undefined)
    const manager = createTranscriptionModelManager({ root, download, verify: async () => true, finalize, activate: async () => undefined, hasFreeSpace: async () => true })

    try {
      await mkdir(join(partialPath, '..'), { recursive: true })
      await writeFile(partialPath, '')
      await truncate(partialPath, artifact.bytes)

      await manager.install('whisper-small')

      expect(download).not.toHaveBeenCalled()
      expect(finalize).toHaveBeenCalledWith(partialPath, join(root, 'whisper-small.partial', artifact.path))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes a corrupt complete generic artifact partial and restarts it at offset zero', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-corrupt-partial-test-'))
    const artifact = TRANSCRIPTION_MODEL_MANIFEST['whisper-small'].artifacts[0]
    const partialPath = join(root, 'whisper-small.partial', `${artifact.path}.partial`)
    const download = vi.fn(async ({ destination }: { destination: string }) => destination)
    const verify = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const manager = createTranscriptionModelManager({ root, download, verify, finalize: async () => undefined, activate: async () => undefined, hasFreeSpace: async () => true })

    try {
      await mkdir(join(partialPath, '..'), { recursive: true })
      await writeFile(partialPath, '')
      await truncate(partialPath, artifact.bytes + 1)

      await manager.install('whisper-small')

      expect(download).toHaveBeenCalledTimes(1)
      expect(download).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects promptly and releases the writer when fetch output fails', async () => {
    const originalFetch = globalThis.fetch
    const directory = await mkdtemp(join(tmpdir(), 'bilimi-output-error-test-'))
    const destination = join(directory, 'destination-is-a-directory')
    globalThis.fetch = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      }
    }), { status: 200, headers: { 'content-length': '3' } }))

    try {
      await mkdir(destination)
      const result = await Promise.race([
        fetchToPartial({ source: 'https://example.invalid/model', destination, offset: 0 })
          .then(() => 'resolved', () => 'rejected'),
        new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 250))
      ])

      expect(result).toBe('rejected')
      await writeFile(join(destination, 'released.txt'), 'writer closed', 'utf8')
    } finally {
      globalThis.fetch = originalFetch
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not create an output writer when the fetch response fails', async () => {
    const originalFetch = globalThis.fetch
    const directory = await mkdtemp(join(tmpdir(), 'bilimi-response-error-test-'))
    const destination = join(directory, 'model.partial')
    globalThis.fetch = vi.fn(async () => { throw new Error('network unavailable') })

    try {
      await expect(fetchToPartial({ source: 'https://example.invalid/model', destination, offset: 0 })).rejects.toThrow('network unavailable')
      await expect(readFile(destination)).rejects.toThrow()
    } finally {
      globalThis.fetch = originalFetch
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('aborts an active response pipeline without retaining its output writer', async () => {
    const originalFetch = globalThis.fetch
    const directory = await mkdtemp(join(tmpdir(), 'bilimi-abort-output-test-'))
    const destination = join(directory, 'model.partial')
    const controller = new AbortController()
    let responseStarted: (() => void) | undefined
    globalThis.fetch = vi.fn(async (_source: RequestInfo | URL, options?: RequestInit) => new Response(new ReadableStream({
      start(stream) {
        responseStarted = () => stream.error(Object.assign(new Error('canceled'), { name: 'AbortError' }))
        options?.signal?.addEventListener('abort', responseStarted, { once: true })
      }
    }), { status: 200, headers: { 'content-length': '3' } }))

    try {
      const pending = fetchToPartial({ source: 'https://example.invalid/model', destination, offset: 0, signal: controller.signal })
      await vi.waitFor(() => expect(responseStarted).toBeTypeOf('function'))
      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await writeFile(destination, 'writer closed', 'utf8')
    } finally {
      globalThis.fetch = originalFetch
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('restarts received progress at zero when a source ignores a range request', async () => {
    const originalFetch = globalThis.fetch
    const directory = await mkdtemp(join(tmpdir(), 'bilimi-model-test-'))
    const destination = join(directory, 'model.partial')
    const onProgress = vi.fn()
    globalThis.fetch = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      }
    }), { status: 200, headers: { 'content-length': '3' } }))

    try {
      await fetchToPartial({ source: 'https://example.invalid/model', destination, offset: 10, onProgress })
      expect(onProgress).toHaveBeenLastCalledWith(3, 3)
    } finally {
      globalThis.fetch = originalFetch
      await rm(directory, { recursive: true, force: true })
    }
  })

})

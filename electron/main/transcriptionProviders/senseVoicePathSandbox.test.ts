import { describe, expect, it, vi } from 'vitest'
import { resolveSenseVoiceRuntimePaths } from './senseVoicePathSandbox'

describe('SenseVoice path sandbox', () => {
  it('maps a Unicode SenseVoice root into the ASCII transcription workspace without copying model files', async () => {
    const createJunction = vi.fn().mockResolvedValue(undefined)

    await expect(resolveSenseVoiceRuntimePaths({
      helperPath: 'C:/Users/中文/AppData/Local/Programs/bilimi/resources/tools/win32/transcription-models/sensevoice-small/runtime/bin/sherpa-onnx-offline.exe',
      modelDirectory: 'C:/Users/中文/AppData/Local/Programs/bilimi/resources/tools/win32/transcription-models/sensevoice-small/model',
      workingDirectory: 'C:/Windows/Temp/bilimi-transcribe-a1b2',
      createJunction
    })).resolves.toEqual({
      helperPath: 'C:/Windows/Temp/bilimi-transcribe-a1b2/sensevoice-runtime/runtime/bin/sherpa-onnx-offline.exe',
      modelDirectory: 'C:/Windows/Temp/bilimi-transcribe-a1b2/sensevoice-runtime/model'
    })

    expect(createJunction).toHaveBeenCalledWith(
      'C:/Users/中文/AppData/Local/Programs/bilimi/resources/tools/win32/transcription-models/sensevoice-small',
      'C:/Windows/Temp/bilimi-transcribe-a1b2/sensevoice-runtime'
    )
  })

  it('keeps already ASCII helper and model paths unchanged', async () => {
    const createJunction = vi.fn()
    const paths = {
      helperPath: 'C:/Program Files/bilimi/resources/tools/win32/transcription-models/sensevoice-small/runtime/bin/sherpa-onnx-offline.exe',
      modelDirectory: 'C:/Program Files/bilimi/resources/tools/win32/transcription-models/sensevoice-small/model'
    }

    await expect(resolveSenseVoiceRuntimePaths({
      ...paths,
      workingDirectory: 'C:/Windows/Temp/bilimi-transcribe-a1b2',
      createJunction
    })).resolves.toEqual(paths)

    expect(createJunction).not.toHaveBeenCalled()
  })

  it('rejects mismatched helper and model layouts without exposing source paths', async () => {
    await expect(resolveSenseVoiceRuntimePaths({
      helperPath: 'C:/Users/中文/bilimi/runtime/bin/sherpa-onnx-offline.exe',
      modelDirectory: 'C:/Users/中文/other-model',
      workingDirectory: 'C:/Windows/Temp/bilimi-transcribe-a1b2',
      createJunction: vi.fn()
    })).rejects.toThrow('SenseVoiceSmall 运行文件布局无效，请重新安装 bilimi 后重试。')
  })

  it('turns junction creation failures into a concise setup error', async () => {
    await expect(resolveSenseVoiceRuntimePaths({
      helperPath: 'C:/Users/中文/bilimi/runtime/bin/sherpa-onnx-offline.exe',
      modelDirectory: 'C:/Users/中文/bilimi/model',
      workingDirectory: 'C:/Windows/Temp/bilimi-transcribe-a1b2',
      createJunction: vi.fn().mockRejectedValue(new Error('EPERM: operation not permitted, symlink'))
    })).rejects.toThrow('SenseVoiceSmall 无法创建兼容中文路径的临时运行入口，请确认系统临时目录可写后重试。')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { disposeFasterWhisperGpuProbes, probeFasterWhisperCudaRuntime } from './fasterWhisperGpu'

describe('probeFasterWhisperCudaRuntime', () => {
  it('requires NVIDIA driver evidence and a successful CUDA inference health check', async () => {
    const runProcess = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA GeForce RTX 4070, 551.23, 12288, 8192\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, device: 'cuda', computeType: 'float16' }), stderr: '' })

    await expect(probeFasterWhisperCudaRuntime({
      helperPath: 'C:/app/bilimi-faster-whisper.exe',
      modelDirectory: 'C:/models/large-v3',
      runProcess
    })).resolves.toEqual({ status: 'available', device: 'cuda', computeType: 'float16', gpuName: 'NVIDIA GeForce RTX 4070', driverVersion: '551.23', memoryMiB: 12288, freeMemoryMiB: 8192 })
    expect(runProcess).toHaveBeenNthCalledWith(1, 'nvidia-smi', ['--query-gpu=index,name,driver_version,memory.total,memory.free', '--format=csv,noheader,nounits'])
    expect(runProcess).toHaveBeenNthCalledWith(2, 'C:/app/bilimi-faster-whisper.exe', [
      '--health-check', '--model', 'C:/models/large-v3', '--device', 'cuda', '--compute-type', 'float16', '--vad-filter', 'true'
    ], expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('runs the same CUDA self-test through the controlled development Python helper', async () => {
    const runProcess = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA GeForce RTX 4060 Ti, 595.97, 8188, 6500\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, device: 'cuda', computeType: 'float16' }), stderr: '' })

    await expect(probeFasterWhisperCudaRuntime({
      helperPath: 'python', helperArgsPrefix: ['C:/repo/tools/transcribe_faster_whisper.py'], modelDirectory: 'C:/models/turbo', runProcess
    })).resolves.toMatchObject({ status: 'available', gpuName: 'NVIDIA GeForce RTX 4060 Ti' })
    expect(runProcess).toHaveBeenNthCalledWith(2, 'python', [
      'C:/repo/tools/transcribe_faster_whisper.py', '--health-check', '--model', 'C:/models/turbo', '--device', 'cuda', '--compute-type', 'float16', '--vad-filter', 'true'
    ], expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('returns an actionable missing CUDA library reason', async () => {
    const runProcess = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA GeForce RTX 4060 Ti, 595.97, 8188, 6500\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 4, stdout: '', stderr: 'Library cublas64_12.dll is not found or cannot be loaded' })
    await expect(probeFasterWhisperCudaRuntime({ helperPath: 'python', modelDirectory: 'model', runProcess }))
      .resolves.toEqual({ status: 'cpu-only', reason: '缺少 CUDA 12 cuBLAS 运行库。' })
  })

  it('does not claim GPU availability when NVIDIA detection or the inference self-test fails', async () => {
    const noNvidia = vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found' })
    await expect(probeFasterWhisperCudaRuntime({ helperPath: 'helper.exe', modelDirectory: 'model', runProcess: noNvidia })).resolves.toEqual({ status: 'cpu-only', reason: '未检测到 NVIDIA CUDA 运行环境。' })

    const selfTestFailure = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA RTX, 551.23, 12288, 8192\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 4, stdout: '', stderr: 'CUDA initialization failed' })
    await expect(probeFasterWhisperCudaRuntime({ helperPath: 'helper.exe', modelDirectory: 'model', runProcess: selfTestFailure })).resolves.toEqual({ status: 'cpu-only', reason: 'CUDA 推理自检失败。' })
  })

  it('rejects CUDA when no NVIDIA adapter has enough currently free memory', async () => {
    const runProcess = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '0, NVIDIA RTX, 551.23, 12288, 256\n1, NVIDIA RTX, 551.23, 8192, 512\n', stderr: '' })
    await expect(probeFasterWhisperCudaRuntime({ helperPath: 'helper.exe', modelDirectory: 'model', runProcess })).resolves.toEqual({
      status: 'cpu-only',
      reason: '可用 GPU 显存不足（当前 512 MiB，至少需要 1024 MiB）。请关闭占用 GPU 的程序后重新检测。',
      memoryMiB: 8192,
      freeMemoryMiB: 512,
      requiredFreeMemoryMiB: 1024
    })
    expect(runProcess).toHaveBeenCalledTimes(1)
  })

  it('cancels a timed-out CUDA health check so it cannot retain GPU memory', async () => {
    const runProcess = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA RTX, 551.23, 12288, 8192\n', stderr: '' })
      .mockImplementationOnce((_command, _args, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Process canceled.'), { name: 'AbortError' })), { once: true })
      }))

    await expect(probeFasterWhisperCudaRuntime({
      helperPath: 'helper.exe', modelDirectory: 'model', runProcess, selfTestTimeoutMs: 1
    })).resolves.toEqual({ status: 'cpu-only', reason: 'CUDA 推理自检超时。' })
  })

  it('cancels an in-flight CUDA health check when bilimi exits', async () => {
    let helperSignal: AbortSignal | undefined
    const runProcess = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA RTX, 551.23, 12288, 8192\n', stderr: '' })
      .mockImplementationOnce((_command, _args, options) => new Promise((_resolve, reject) => {
        helperSignal = options.signal
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Process canceled.'), { name: 'AbortError' })), { once: true })
      }))

    const pending = probeFasterWhisperCudaRuntime({ helperPath: 'helper.exe', modelDirectory: 'model', runProcess })
    await vi.waitFor(() => expect(helperSignal).toBeDefined())
    disposeFasterWhisperGpuProbes()
    expect(helperSignal?.aborted).toBe(true)
    await expect(pending).resolves.toEqual({ status: 'cpu-only', reason: 'CUDA 推理自检已取消。' })
  })
})

import { runProcess as defaultRunProcess, type RunProcess } from './audioDownload'

export type FasterWhisperGpuProbe =
  | { status: 'available'; device: 'cuda'; computeType: 'float16' | 'int8_float16'; gpuName: string; driverVersion: string; memoryMiB: number; freeMemoryMiB: number }
  | { status: 'cpu-only'; reason: string; memoryMiB?: number; freeMemoryMiB?: number; requiredFreeMemoryMiB?: number }

const MINIMUM_FREE_CUDA_MEMORY_MIB = 1024
const DEFAULT_CUDA_SELF_TEST_TIMEOUT_MS = 60_000
const activeCudaProbeControllers = new Set<AbortController>()

function readNvidiaMemoryMiB(stdout: string): { name: string; driverVersion: string; total: number; free: number } | null {
  const adapters = stdout.split(/\r?\n/gu).map((line) => line.trim().match(/^(\d+),\s*([^,]+),\s*([^,]+),\s*(\d+),\s*(\d+)$/u)).filter(Boolean)
    .map((match) => ({ name: match?.[2]?.trim() ?? 'NVIDIA GPU', driverVersion: match?.[3]?.trim() ?? '', total: Number(match?.[4]), free: Number(match?.[5]) }))
    .filter((adapter) => adapter.total > 0)
  return adapters.sort((left, right) => right.free - left.free)[0] ?? null
}

export function disposeFasterWhisperGpuProbes(): void {
  for (const controller of activeCudaProbeControllers) controller.abort()
}

export async function probeFasterWhisperCudaRuntime({
  helperPath,
  helperArgsPrefix = [],
  modelDirectory,
  runProcess = defaultRunProcess,
  selfTestTimeoutMs = DEFAULT_CUDA_SELF_TEST_TIMEOUT_MS
}: {
  helperPath: string
  helperArgsPrefix?: string[]
  modelDirectory: string
  runProcess?: RunProcess
  selfTestTimeoutMs?: number
}): Promise<FasterWhisperGpuProbe> {
  let nvidia
  try {
    nvidia = await runProcess('nvidia-smi', ['--query-gpu=index,name,driver_version,memory.total,memory.free', '--format=csv,noheader,nounits'])
  } catch {
    return { status: 'cpu-only', reason: 'NVIDIA CUDA runtime was not detected.' }
  }
  const memory = nvidia.exitCode === 0 ? readNvidiaMemoryMiB(nvidia.stdout) : null
  if (!memory) return nvidia.exitCode === 0
    ? { status: 'cpu-only', reason: '未检测到可用的 NVIDIA GPU。' }
    : { status: 'cpu-only', reason: '未检测到 NVIDIA CUDA 运行环境。' }
  if (memory.free < MINIMUM_FREE_CUDA_MEMORY_MIB) {
    return {
      status: 'cpu-only',
      reason: `可用 GPU 显存不足（当前 ${memory.free} MiB，至少需要 ${MINIMUM_FREE_CUDA_MEMORY_MIB} MiB）。请关闭占用 GPU 的程序后重新检测。`,
      memoryMiB: memory.total,
      freeMemoryMiB: memory.free,
      requiredFreeMemoryMiB: MINIMUM_FREE_CUDA_MEMORY_MIB
    }
  }

  const controller = new AbortController()
  activeCudaProbeControllers.add(controller)
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, selfTestTimeoutMs)
  let selfTest
  try {
    selfTest = await runProcess(helperPath, [
      ...helperArgsPrefix,
      '--health-check', '--model', modelDirectory, '--device', 'cuda', '--compute-type', 'float16', '--vad-filter', 'true'
    ], { signal: controller.signal })
  } catch {
    if (timedOut) return { status: 'cpu-only', reason: 'CUDA 推理自检超时。' }
    return { status: 'cpu-only', reason: controller.signal.aborted ? 'CUDA 推理自检已取消。' : 'CUDA 推理自检失败。' }
  } finally {
    clearTimeout(timeout)
    activeCudaProbeControllers.delete(controller)
  }
  if (selfTest.exitCode !== 0) {
    const failure = `${selfTest.stderr}\n${selfTest.stdout}`.toLowerCase()
    if (failure.includes('cublas64_12.dll')) return { status: 'cpu-only', reason: '缺少 CUDA 12 cuBLAS 运行库。' }
    if (failure.includes('cudnn') && /(not found|cannot be loaded|could not load|missing)/u.test(failure)) return { status: 'cpu-only', reason: '缺少 CUDA cuDNN 运行库。' }
    return { status: 'cpu-only', reason: 'CUDA 推理自检失败。' }
  }
  try {
    const payload = JSON.parse(selfTest.stdout) as { ok?: unknown; device?: unknown; computeType?: unknown }
    if (payload.ok === true && payload.device === 'cuda' && (payload.computeType === 'float16' || payload.computeType === 'int8_float16')) {
      return { status: 'available', device: 'cuda', computeType: payload.computeType, gpuName: memory.name, driverVersion: memory.driverVersion, memoryMiB: memory.total, freeMemoryMiB: memory.free }
    }
  } catch {
    // The controlled helper must return structured evidence of its actual runtime.
  }
  return { status: 'cpu-only', reason: 'CUDA 推理自检失败。' }
}

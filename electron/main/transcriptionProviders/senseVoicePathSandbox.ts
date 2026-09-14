import { symlink as defaultSymlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const SENSEVOICE_HELPER_NAME = 'sherpa-onnx-offline.exe'
const SANDBOX_DIRECTORY_NAME = 'sensevoice-runtime'

type CreateJunction = (target: string, path: string) => Promise<void>

function normalizePath(path: string): string {
  return path.replace(/\\/gu, '/')
}

function pathEquals(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(resolve(left))
  const normalizedRight = normalizePath(resolve(right))
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function isAsciiPath(path: string): boolean {
  return /^[\x00-\x7F]+$/u.test(path)
}

function invalidLayoutError(): Error {
  return new Error('SenseVoiceSmall 运行文件布局无效，请重新安装 bilimi 后重试。')
}

function sandboxSetupError(): Error {
  return new Error('SenseVoiceSmall 无法创建兼容中文路径的临时运行入口，请确认系统临时目录可写后重试。')
}

function resolveSenseVoiceRoot(helperPath: string, modelDirectory: string): string {
  if (basename(helperPath).toLowerCase() !== SENSEVOICE_HELPER_NAME) throw invalidLayoutError()
  const runtimeDirectory = dirname(dirname(helperPath))
  const root = dirname(runtimeDirectory)
  if (!pathEquals(helperPath, join(root, 'runtime', 'bin', SENSEVOICE_HELPER_NAME))) throw invalidLayoutError()
  if (!pathEquals(modelDirectory, join(root, 'model'))) throw invalidLayoutError()
  return root
}

export async function resolveSenseVoiceRuntimePaths({
  helperPath,
  modelDirectory,
  workingDirectory,
  createJunction = (target, path) => defaultSymlink(target, path, 'junction')
}: {
  helperPath: string
  modelDirectory: string
  workingDirectory: string
  createJunction?: CreateJunction
}): Promise<{ helperPath: string; modelDirectory: string }> {
  const root = resolveSenseVoiceRoot(helperPath, modelDirectory)
  if (isAsciiPath(helperPath) && isAsciiPath(modelDirectory)) {
    return { helperPath, modelDirectory }
  }
  if (!isAsciiPath(workingDirectory)) throw sandboxSetupError()

  const sandboxRoot = normalizePath(join(workingDirectory, SANDBOX_DIRECTORY_NAME))
  try {
    await createJunction(root, sandboxRoot)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw sandboxSetupError()
  }

  return {
    helperPath: normalizePath(join(sandboxRoot, 'runtime', 'bin', SENSEVOICE_HELPER_NAME)),
    modelDirectory: normalizePath(join(sandboxRoot, 'model'))
  }
}

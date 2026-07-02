import type {
  DeepSeekConnectionTestResult,
  DeepSeekKeyStatus,
  StartupDiagnosticItem,
  StartupDiagnosticReport
} from '../../src/shared/types'
import type { MediaToolPaths } from './mediaToolPaths'

type StartupDiagnosticsDependencies = {
  now?: () => Date
  fetch?: typeof fetch
  resolveMediaToolPaths: () => MediaToolPaths
  loadDeepSeekApiKeyStatus: () => DeepSeekKeyStatus
  testDeepSeekConnection: () => Promise<DeepSeekConnectionTestResult>
}

function createItem(item: StartupDiagnosticItem): StartupDiagnosticItem {
  return item
}

async function checkBilibiliNetwork(fetchImpl: typeof fetch): Promise<StartupDiagnosticItem> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetchImpl('https://www.bilibili.com', {
      method: 'HEAD',
      signal: controller.signal
    })

    if (response.ok || response.status < 500) {
      return createItem({
        id: 'bilibili-network',
        label: 'B 站网络',
        status: 'ok',
        message: '已能访问 B 站。'
      })
    }

    return createItem({
      id: 'bilibili-network',
      label: 'B 站网络',
      status: 'error',
      message: `B 站返回 ${response.status}，页面或接口可能暂时不可用。`,
      action: '稍后重试，或检查当前网络、代理/VPN 与 Windows 防火墙提示是否已允许。'
    })
  } catch (error) {
    return createItem({
      id: 'bilibili-network',
      label: 'B 站网络',
      status: 'error',
      message: error instanceof Error ? error.message : 'B 站网络检测失败。',
      action: '请检查网络连接、代理/VPN、DNS，以及 Windows 防火墙弹窗是否选择允许。'
    })
  } finally {
    clearTimeout(timeout)
  }
}

function checkMediaTools(resolveMediaToolPaths: () => MediaToolPaths): StartupDiagnosticItem {
  try {
    resolveMediaToolPaths()

    return createItem({
      id: 'media-tools',
      label: '本地媒体工具',
      status: 'ok',
      message: 'yt-dlp、ffmpeg、whisper 和模型文件已就绪。'
    })
  } catch (error) {
    return createItem({
      id: 'media-tools',
      label: '本地媒体工具',
      status: 'error',
      message: error instanceof Error ? error.message : '本地媒体工具缺失。',
      action: '请重新安装 Bilimi；开发环境可运行 npm run setup:media-tools 后重启。'
    })
  }
}

function localizeDeepSeekDiagnosticMessage(message: string): string {
  if (message === 'DeepSeek connection succeeded.') {
    return 'DeepSeek 连接成功。'
  }

  if (message === 'DeepSeek connection failed.') {
    return 'DeepSeek 连接失败。'
  }

  return message
}

async function checkDeepSeek(
  loadDeepSeekApiKeyStatus: () => DeepSeekKeyStatus,
  testDeepSeekConnection: () => Promise<DeepSeekConnectionTestResult>
): Promise<StartupDiagnosticItem> {
  if (!loadDeepSeekApiKeyStatus().configured) {
    return createItem({
      id: 'deepseek',
      label: 'DeepSeek',
      status: 'warning',
      message: '尚未配置 DeepSeek API Key，AI 总结、评论和宠物对话会保持关闭。',
      action: '需要 AI 功能时，可在设置里填写 API Key 后测试连接。'
    })
  }

  const result = await testDeepSeekConnection()

  return createItem({
    id: 'deepseek',
    label: 'DeepSeek',
    status: result.ok ? 'ok' : 'warning',
    message: localizeDeepSeekDiagnosticMessage(result.message),
    action: result.ok ? undefined : '检查 API Key、模型名、额度和网络连通性。'
  })
}

function checkStorage(): StartupDiagnosticItem {
  return createItem({
    id: 'storage',
    label: '本地存储',
    status: 'ok',
    message: '偏好设置与本地记录存储可用。'
  })
}

export async function runStartupDiagnostics(
  dependencies: StartupDiagnosticsDependencies
): Promise<StartupDiagnosticReport> {
  const fetchImpl = dependencies.fetch ?? fetch
  const [bilibiliNetwork, deepseek] = await Promise.all([
    checkBilibiliNetwork(fetchImpl),
    checkDeepSeek(dependencies.loadDeepSeekApiKeyStatus, dependencies.testDeepSeekConnection)
  ])
  const items = [
    bilibiliNetwork,
    checkMediaTools(dependencies.resolveMediaToolPaths),
    checkStorage(),
    deepseek
  ]

  return {
    ok: items.every((item) => item.status !== 'error'),
    checkedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    items
  }
}

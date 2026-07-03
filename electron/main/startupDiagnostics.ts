import type {
  DeepSeekConnectionTestResult,
  DeepSeekKeyStatus,
  StartupDiagnosticItem,
  StartupDiagnosticReport
} from '../../src/shared/types'
import type { MediaToolPaths } from './mediaToolPaths'
import { execFile } from 'node:child_process'

type StartupDiagnosticsDependencies = {
  now?: () => Date
  fetch?: typeof fetch
  platform?: NodeJS.Platform
  execPath?: string
  queryWindowsFirewallRules?: (programPath: string) => Promise<WindowsFirewallRule[]>
  resolveMediaToolPaths: () => MediaToolPaths
  loadDeepSeekApiKeyStatus: () => DeepSeekKeyStatus
  testDeepSeekConnection: () => Promise<DeepSeekConnectionTestResult>
}

type WindowsFirewallRule = {
  action?: string
  direction?: string
  enabled?: boolean | string
  profile?: string
}

function createItem(item: StartupDiagnosticItem): StartupDiagnosticItem {
  return item
}

function normalizeFirewallRule(raw: unknown): WindowsFirewallRule {
  const candidate = raw as Record<string, unknown>

  return {
    action: typeof candidate.Action === 'string' ? candidate.Action : String(candidate.action ?? ''),
    direction:
      typeof candidate.Direction === 'string' ? candidate.Direction : String(candidate.direction ?? ''),
    enabled:
      typeof candidate.Enabled === 'boolean' || typeof candidate.Enabled === 'string'
        ? candidate.Enabled
        : candidate.enabled as WindowsFirewallRule['enabled'],
    profile: typeof candidate.Profile === 'string' ? candidate.Profile : String(candidate.profile ?? '')
  }
}

function queryWindowsFirewallRules(programPath: string): Promise<WindowsFirewallRule[]> {
  const script = [
    '$program = [System.IO.Path]::GetFullPath($args[0])',
    '$filters = Get-NetFirewallApplicationFilter -Program $program -ErrorAction SilentlyContinue',
    '$rules = foreach ($filter in $filters) {',
    '  Get-NetFirewallRule -AssociatedNetFirewallApplicationFilter $filter | Select-Object DisplayName,Enabled,Direction,Action,Profile',
    '}',
    '$rules | ConvertTo-Json -Compress'
  ].join('; ')

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, programPath],
      { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }

        const output = stdout.trim()
        if (!output) {
          resolve([])
          return
        }

        const parsed = JSON.parse(output) as unknown
        const rules = Array.isArray(parsed) ? parsed : [parsed]
        resolve(rules.map(normalizeFirewallRule))
      }
    )
  })
}

function isEnabledFirewallRule(rule: WindowsFirewallRule): boolean {
  return rule.enabled === true || String(rule.enabled).toLowerCase() === 'true'
}

function checkWindowsFirewallRuleStatus(rules: WindowsFirewallRule[]): StartupDiagnosticItem {
  const enabledRules = rules.filter(isEnabledFirewallRule)
  const blockedRules = enabledRules.filter((rule) => String(rule.action).toLowerCase() === 'block')
  const allowedRules = enabledRules.filter((rule) => String(rule.action).toLowerCase() === 'allow')

  if (blockedRules.length > 0) {
    return createItem({
      id: 'windows-firewall',
      label: 'Windows 安全中心',
      status: 'error',
      message: 'Windows 防火墙规则正在阻止 bilimi 访问网络。',
      action: '打开 Windows 安全中心，在“允许应用通过防火墙”里允许 bilimi，建议至少勾选专用网络。'
    })
  }

  if (allowedRules.length > 0) {
    const profiles = Array.from(
      new Set(allowedRules.map((rule) => String(rule.profile || 'Any')).filter(Boolean))
    )

    return createItem({
      id: 'windows-firewall',
      label: 'Windows 安全中心',
      status: 'ok',
      message: `已找到 bilimi 的防火墙允许规则${profiles.length ? `（${profiles.join('、')}）` : '。'}`
    })
  }

  return createItem({
    id: 'windows-firewall',
    label: 'Windows 安全中心',
    status: 'warning',
    message: '未找到 bilimi 的防火墙允许规则。',
    action: '首次弹出 Windows 安全中心提示时请点击允许；若已经错过，请手动在“允许应用通过防火墙”里添加 bilimi。'
  })
}

async function checkWindowsFirewall(
  platform: NodeJS.Platform,
  programPath: string,
  queryRules: (programPath: string) => Promise<WindowsFirewallRule[]>
): Promise<StartupDiagnosticItem> {
  if (platform !== 'win32') {
    return createItem({
      id: 'windows-firewall',
      label: 'Windows 安全中心',
      status: 'ok',
      message: '当前不是 Windows 环境，无需检查 Windows 安全中心权限。'
    })
  }

  try {
    const rules = await queryRules(programPath)
    return checkWindowsFirewallRuleStatus(rules)
  } catch (error) {
    return createItem({
      id: 'windows-firewall',
      label: 'Windows 安全中心',
      status: 'warning',
      message:
        error instanceof Error
          ? `未能读取 Windows 防火墙规则：${error.message}`
          : '未能读取 Windows 防火墙规则。',
      action: '请打开 Windows 安全中心，确认 bilimi 已被允许通过防火墙。'
    })
  }
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
  const [bilibiliNetwork, windowsFirewall, deepseek] = await Promise.all([
    checkBilibiliNetwork(fetchImpl),
    checkWindowsFirewall(
      dependencies.platform ?? process.platform,
      dependencies.execPath ?? process.execPath,
      dependencies.queryWindowsFirewallRules ?? queryWindowsFirewallRules
    ),
    checkDeepSeek(dependencies.loadDeepSeekApiKeyStatus, dependencies.testDeepSeekConnection)
  ])
  const items = [
    bilibiliNetwork,
    windowsFirewall,
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

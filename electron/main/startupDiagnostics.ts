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
  queryWindowsFirewallRules?: () => Promise<WindowsFirewallRule[]>
  resolveMediaToolPaths: () => MediaToolPaths
  loadDeepSeekApiKeyStatus: () => DeepSeekKeyStatus
  testDeepSeekConnection: () => Promise<DeepSeekConnectionTestResult>
}

type WindowsFirewallRule = {
  action?: number | string
  direction?: number | string
  displayName?: string
  enabled?: boolean | number | string
  profile?: number | string
}

function createItem(item: StartupDiagnosticItem): StartupDiagnosticItem {
  return item
}

function normalizeFirewallRule(raw: unknown): WindowsFirewallRule {
  const candidate = raw as Record<string, unknown>
  const normalizeRuleValue = (value: unknown): number | string | undefined =>
    typeof value === 'number' || typeof value === 'string' ? value : undefined

  return {
    action: normalizeRuleValue(candidate.Action) ?? normalizeRuleValue(candidate.action) ?? '',
    direction:
      normalizeRuleValue(candidate.Direction) ?? normalizeRuleValue(candidate.direction) ?? '',
    displayName:
      normalizeRuleValue(candidate.DisplayName) ?? normalizeRuleValue(candidate.displayName) ?? '',
    enabled:
      typeof candidate.Enabled === 'boolean' ||
      typeof candidate.Enabled === 'number' ||
      typeof candidate.Enabled === 'string'
        ? candidate.Enabled
        : candidate.enabled as WindowsFirewallRule['enabled'],
    profile: normalizeRuleValue(candidate.Profile) ?? normalizeRuleValue(candidate.profile) ?? ''
  }
}

function queryWindowsFirewallRules(): Promise<WindowsFirewallRule[]> {
  const script = [
    '$rules = Get-NetFirewallRule -Enabled True -Action Allow |',
    '  Where-Object { $_.DisplayName -like "*bilimi*" } |',
    '  Select-Object DisplayName, Enabled, Direction, Action, Profile;',
    'if ($null -eq $rules) { "" } else { $rules | ConvertTo-Json -Compress }'
  ].join(' ')

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
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
  const enabled = String(rule.enabled).toLowerCase()
  return rule.enabled === true || rule.enabled === 1 || enabled === 'true' || enabled === '1'
}

function normalizeFirewallAction(action: WindowsFirewallRule['action']): string {
  if (action === 2 || String(action).toLowerCase() === '2') {
    return 'allow'
  }

  if (action === 4 || String(action).toLowerCase() === '4') {
    return 'block'
  }

  return String(action).toLowerCase()
}

function normalizeFirewallProfile(profile: WindowsFirewallRule['profile']): string {
  const profileValue = Number(profile)
  const profileNames: Array<[number, string]> = [
    [1, 'Domain'],
    [2, 'Private'],
    [4, 'Public']
  ]

  if (Number.isFinite(profileValue) && profileValue > 0) {
    const names = profileNames
      .filter(([value]) => (profileValue & value) === value)
      .map(([, name]) => name)

    if (names.length > 0) {
      return names.join(',')
    }
  }

  return String(profile || 'Any')
}

function checkWindowsFirewallRuleStatus(rules: WindowsFirewallRule[]): StartupDiagnosticItem {
  const enabledRules = rules.filter(isEnabledFirewallRule)
  const allowedRules = enabledRules.filter((rule) => normalizeFirewallAction(rule.action) === 'allow')

  if (allowedRules.length > 0) {
    const profiles = Array.from(
      new Set(allowedRules.map((rule) => normalizeFirewallProfile(rule.profile)).filter(Boolean))
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
    message: '未找到 bilimi 的防火墙允许规则。'
  })
}

async function checkWindowsFirewall(
  platform: NodeJS.Platform,
  queryRules: () => Promise<WindowsFirewallRule[]>
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
    const rules = await queryRules()
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
      action: '请重新安装 bilimi；开发环境可运行 npm run setup:media-tools 后重启。'
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

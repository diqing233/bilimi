import {
  createFavoriteRepositoryPageBridge,
  type FavoriteRepositoryPageBridgeInput,
  type FavoriteRepositoryPageBridgeReadResult
} from './favoriteRepositoryPageBridge'

type PageBridgeAction = 'append' | 'remove' | 'read-members'

export type FavoriteRepositoryPageTarget = {
  webContentsId: number
  instanceId: string
  navigationEpoch: number
}

type FavoriteRepositoryWebviewTarget = {
  getURL?: () => string
  isLoading?: () => boolean
  executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>
}

function onBilibiliPage(target: FavoriteRepositoryWebviewTarget) {
  try {
    const hostname = new URL(target.getURL?.() ?? '').hostname.toLowerCase()
    return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')
  } catch {
    return false
  }
}

export function createFavoriteRepositoryPageTarget(options: {
  findWebviewById: (webContentsId: number) => FavoriteRepositoryWebviewTarget | null | undefined
  getNavigationEpoch: (webContentsId: number, instanceId: string) => number | undefined
}) {
  return {
    async run(
      binding: FavoriteRepositoryPageTarget,
      action: PageBridgeAction,
      input: FavoriteRepositoryPageBridgeInput
    ): Promise<FavoriteRepositoryPageBridgeReadResult> {
      const target = options.findWebviewById(binding.webContentsId) ?? null
      if (!target?.executeJavaScript) {
        return { status: 'unknown', observedAccountMid: '', reason: 'target-unavailable' }
      }
      if (options.getNavigationEpoch(binding.webContentsId, binding.instanceId) !== binding.navigationEpoch || !onBilibiliPage(target)) {
        return { status: 'unknown', observedAccountMid: '', reason: 'target-navigated' }
      }
      if (target.isLoading?.()) {
        return { status: 'unknown', observedAccountMid: '', reason: 'target-loading' }
      }
      const bridge = createFavoriteRepositoryPageBridge({ executeJavaScript: target.executeJavaScript.bind(target) })
      const result = await (action === 'append'
        ? bridge.append(input)
        : action === 'remove'
          ? bridge.remove(input)
          : bridge.readMembers(input))
      if (options.getNavigationEpoch(binding.webContentsId, binding.instanceId) !== binding.navigationEpoch) {
        return { status: 'unknown', observedAccountMid: result.observedAccountMid, reason: 'target-navigated' }
      }
      return result
    }
  }
}

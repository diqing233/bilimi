import type { Session } from 'electron'

const ALLOWED_BILIBILI_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-sanitized-write'
])

export function isBilibiliOrigin(value: string): boolean {
  try {
    const hostname = new URL(value).hostname
    return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')
  } catch {
    return false
  }
}

export function isBrowserPermissionAllowed(origin: string, permission: string): boolean {
  return isBilibiliOrigin(origin) && ALLOWED_BILIBILI_PERMISSIONS.has(permission)
}

export function installBrowserSessionPolicy(browserSession: Session): void {
  browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    isBrowserPermissionAllowed(requestingOrigin, permission)
  )
  browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin =
      'requestingUrl' in details && typeof details.requestingUrl === 'string'
        ? details.requestingUrl
        : webContents.getURL()
    callback(isBrowserPermissionAllowed(origin, permission))
  })
}

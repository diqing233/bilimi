import type { Session } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type CookieLike = {
  domain?: string
  hostOnly?: boolean
  httpOnly?: boolean
  name: string
  path?: string
  secure?: boolean
  session?: boolean
  value: string
  expirationDate?: number
}

export type CookieSessionLike = {
  cookies: {
    get: (filter: { domain: string }) => Promise<readonly CookieLike[]>
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function isBilibiliCookie(cookie: CookieLike): cookie is CookieLike & { domain: string } {
  return cookie.domain === 'bilibili.com' || cookie.domain?.endsWith('.bilibili.com') === true
}

export function createBilibiliCookieExportText(cookies: readonly CookieLike[]): string {
  const lines = ['# Netscape HTTP Cookie File']

  for (const cookie of cookies.filter(isBilibiliCookie)) {
    const includeSubdomains = cookie.hostOnly ? 'FALSE' : 'TRUE'
    const path = cookie.path || '/'
    const secure = cookie.secure ? 'TRUE' : 'FALSE'
    const expires = cookie.session ? '0' : String(Math.floor(cookie.expirationDate ?? 0))
    lines.push(
      [
        cookie.domain,
        includeSubdomains,
        path,
        secure,
        expires,
        cookie.name,
        cookie.value
      ].join('\t')
    )
  }

  return `${lines.join('\n')}\n`
}

export async function exportBilibiliCookiesToFile({
  session,
  tempDir,
  writeFile: write = writeFile,
  mkdir: makeDir = mkdir,
  now = Date.now
}: {
  session: CookieSessionLike | Session
  tempDir: string
  writeFile?: typeof writeFile
  mkdir?: typeof mkdir
  now?: () => number
}): Promise<{ path: string; cookieCount: number }> {
  const cookies = await session.cookies.get({ domain: 'bilibili.com' })
  const text = createBilibiliCookieExportText(cookies)
  const cookieCount = cookies.filter(isBilibiliCookie).length
  const path = normalizePath(join(tempDir, `bilibili-cookies-${now()}.txt`))

  await makeDir(tempDir, { recursive: true })
  await write(path, text, 'utf8')

  return { path, cookieCount }
}

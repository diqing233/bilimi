import { describe, expect, it, vi } from 'vitest'
import {
  createBilibiliCookieExportText,
  exportBilibiliCookiesToFile
} from './bilibiliCookieExport'

describe('bilibili cookie export', () => {
  it('exports only bilibili cookies in Netscape format', () => {
    const text = createBilibiliCookieExportText([
      {
        domain: '.bilibili.com',
        hostOnly: false,
        httpOnly: true,
        name: 'SESSDATA',
        path: '/',
        secure: true,
        session: false,
        value: 'secret',
        expirationDate: 1780000000
      },
      {
        domain: '.example.com',
        hostOnly: false,
        httpOnly: false,
        name: 'ignored',
        path: '/',
        secure: false,
        session: true,
        value: 'nope'
      }
    ])

    expect(text).toContain('# Netscape HTTP Cookie File')
    expect(text).toContain('.bilibili.com\tTRUE\t/\tTRUE\t1780000000\tSESSDATA\tsecret')
    expect(text).not.toContain('example.com')
  })

  it('writes a temporary cookie file through injected dependencies', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const mkdir = vi.fn().mockResolvedValue(undefined)
    const session = {
      cookies: {
        get: vi.fn().mockResolvedValue([
          {
            domain: '.bilibili.com',
            hostOnly: false,
            httpOnly: false,
            name: 'DedeUserID',
            path: '/',
            secure: false,
            session: true,
            value: '123'
          }
        ])
      }
    }

    const result = await exportBilibiliCookiesToFile({
      session,
      tempDir: 'C:/tmp/bilimi-transcribe',
      writeFile,
      mkdir,
      now: () => 1780000000000
    })

    expect(session.cookies.get).toHaveBeenCalledWith({ domain: 'bilibili.com' })
    expect(mkdir).toHaveBeenCalledWith('C:/tmp/bilimi-transcribe', { recursive: true })
    expect(result.path).toBe('C:/tmp/bilimi-transcribe/bilibili-cookies-1780000000000.txt')
    expect(writeFile).toHaveBeenCalledWith(
      result.path,
      expect.stringContaining('DedeUserID\t123'),
      'utf8'
    )
  })
})

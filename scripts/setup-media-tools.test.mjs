import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { downloads, verifySha256 } from './setup-media-tools.mjs'

describe('media tool download integrity', () => {
  it('pins a SHA-256 digest for every Windows download', () => {
    expect(downloads.win32).toHaveLength(4)
    for (const item of downloads.win32) {
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('accepts a matching digest and removes a mismatched artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bilimi-media-tools-'))
    const fixture = join(directory, 'fixture.bin')
    const bytes = 'verified media artifact'
    const digest = createHash('sha256').update(bytes).digest('hex')
    await writeFile(fixture, bytes)

    await expect(verifySha256(fixture, digest)).resolves.toBeUndefined()
    await expect(verifySha256(fixture, '0'.repeat(64))).rejects.toThrow('SHA-256 mismatch')
    await expect(readFile(fixture)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

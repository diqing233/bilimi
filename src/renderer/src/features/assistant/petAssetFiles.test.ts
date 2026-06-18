import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const BIG_HEAD_ASSET_DIR = resolve(
  __dirname,
  '../../assets/pet/blue-white-maid/character/big-head'
)

function readPngMetadata(filename: string) {
  const bytes = readFileSync(resolve(BIG_HEAD_ASSET_DIR, filename))

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25]
  }
}

describe('big-head pet asset files', () => {
  it('uses compact transparent Q-version sprites for every state', () => {
    const stateFiles = ['idle.png', 'clicked.png', 'working.png', 'error.png', 'hint.png']

    for (const file of stateFiles) {
      const metadata = readPngMetadata(file)

      expect(metadata.width).toBeGreaterThanOrEqual(330)
      expect(metadata.width).toBeLessThanOrEqual(470)
      expect(metadata.height).toBeGreaterThanOrEqual(360)
      expect(metadata.height).toBeLessThanOrEqual(470)
      expect(metadata.colorType).toBe(6)
    }
  })
})

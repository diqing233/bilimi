import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const BIG_HEAD_ASSET_DIR = resolve(
  __dirname,
  '../../assets/pet/blue-white-maid/character/big-head'
)
const CLASSIC_ASSET_DIR = resolve(
  __dirname,
  '../../assets/pet/blue-white-maid/character/classic'
)
const LEGACY_ASSET_DIR = resolve(__dirname, '../../assets/pet/blue-white-maid/character')
const pngAlphaCache = new Map<string, ReturnType<typeof decodePngAlpha>>()

function readPngMetadata(filename: string, assetDir = BIG_HEAD_ASSET_DIR) {
  const bytes = readFileSync(resolve(assetDir, filename))

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25]
  }
}

function decodePngAlpha(bytes: Buffer) {
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const colorType = bytes[25]
  const idatChunks: Buffer[] = []
  let offset = 8

  expect(colorType).toBe(6)

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const dataStart = offset + 8

    if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(dataStart, dataStart + length))
    }

    offset = dataStart + length + 4
  }

  const inflated = inflateSync(Buffer.concat(idatChunks))
  const rowStride = width * 4
  const rows: Buffer[] = []
  let sourceOffset = 0

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset]
    const row = Buffer.from(inflated.subarray(sourceOffset + 1, sourceOffset + 1 + rowStride))
    const previous = rows[y - 1]

    for (let x = 0; x < rowStride; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0
      const up = previous ? previous[x] : 0
      const upLeft = previous && x >= 4 ? previous[x - 4] : 0

      if (filter === 1) {
        row[x] = (row[x] + left) & 0xff
      } else if (filter === 2) {
        row[x] = (row[x] + up) & 0xff
      } else if (filter === 3) {
        row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff
      } else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        row[x] = (row[x] + predictor) & 0xff
      } else {
        expect(filter).toBe(0)
      }
    }

    rows.push(row)
    sourceOffset += rowStride + 1
  }

  return { width, height, rows }
}

function readPngAlpha(filename: string, assetDir = BIG_HEAD_ASSET_DIR) {
  const path = resolve(assetDir, filename)
  const cached = pngAlphaCache.get(path)

  if (cached) {
    return cached
  }

  const decoded = decodePngAlpha(readFileSync(path))
  pngAlphaCache.set(path, decoded)
  return decoded
}

function countOpaquePixelsInBand(
  filename: string,
  containsPixel: (x: number, y: number, width: number, height: number) => boolean,
  assetDir = BIG_HEAD_ASSET_DIR
) {
  const png = readPngAlpha(filename, assetDir)
  let count = 0

  for (let y = 0; y < png.height; y += 1) {
    const row = png.rows[y]

    for (let x = 0; x < png.width; x += 1) {
      if (containsPixel(x, y, png.width, png.height) && row[x * 4 + 3] > 0) {
        count += 1
      }
    }
  }

  return count
}

function readOpaqueBounds(filename: string, assetDir: string) {
  const png = readPngAlpha(filename, assetDir)
  let minX = png.width
  let minY = png.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < png.height; y += 1) {
    const row = png.rows[y]

    for (let x = 0; x < png.width; x += 1) {
      if (row[x * 4 + 3] > 8) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  expect(maxX).toBeGreaterThanOrEqual(0)
  expect(maxY).toBeGreaterThanOrEqual(0)

  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centerX: (minX + maxX) / 2,
    bottomGap: png.height - 1 - maxY,
    canvasWidth: png.width
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

  it('keeps edited interaction sprites free of edge debris', () => {
    expect(countOpaquePixelsInBand('hint.png', (x) => x < 6)).toBe(0)
    expect(countOpaquePixelsInBand('clicked.png', (x) => x < 6)).toBe(0)
    expect(countOpaquePixelsInBand('error.png', (x, _y, width) => x >= width - 30)).toBe(0)
  })

  it(
    'adapts the new clicked illustration to every pet canvas without shifting its anchor',
    () => {
      const variants = [
        { assetDir: BIG_HEAD_ASSET_DIR, width: 434, height: 461, bottomGap: 16 },
        { assetDir: CLASSIC_ASSET_DIR, width: 512, height: 512, bottomGap: 23 },
        { assetDir: LEGACY_ASSET_DIR, width: 512, height: 512, bottomGap: 23 }
      ]

      for (const variant of variants) {
        expect(readPngMetadata('clicked.png', variant.assetDir)).toEqual({
          width: variant.width,
          height: variant.height,
          colorType: 6
        })

        const bounds = readOpaqueBounds('clicked.png', variant.assetDir)

        expect(bounds.width / bounds.height).toBeGreaterThan(0.78)
        expect(bounds.width / bounds.height).toBeLessThan(0.82)
        expect(Math.abs(bounds.centerX - (bounds.canvasWidth - 1) / 2)).toBeLessThanOrEqual(2)
        expect(bounds.bottomGap).toBe(variant.bottomGap)
      }

      expect(readFileSync(resolve(CLASSIC_ASSET_DIR, 'clicked.png'))).toEqual(
        readFileSync(resolve(LEGACY_ASSET_DIR, 'clicked.png'))
      )
    },
    10_000
  )
})

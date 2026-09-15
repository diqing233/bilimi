import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('crying pet assets', () => {
  it('uses the transparent wronged sprites that match the regular pet canvas', () => {
    for (const relativePath of [
      '../../assets/pet/blue-white-maid/character/big-head/error.png',
      '../../assets/pet/blue-white-maid/character/classic/error.png'
    ]) {
      const bytes = readFileSync(resolve(__dirname, relativePath))
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(bytes.readUInt32BE(16)).toBeGreaterThan(0)
      expect(bytes.readUInt32BE(20)).toBeGreaterThan(0)
      expect(bytes[25]).toBe(6)
    }
  })
})

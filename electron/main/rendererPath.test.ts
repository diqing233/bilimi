import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRendererFilePath } from './rendererPath'

describe('createRendererFilePath', () => {
  it('points from the built main output directory to the built renderer entry', () => {
    const mainOutputDir = join('C:', 'app', 'out', 'main')

    expect(createRendererFilePath(mainOutputDir)).toBe(
      join('C:', 'app', 'out', 'renderer', 'index.html')
    )
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesPath = resolve(process.cwd(), 'src/renderer/src/styles.css')
const styles = readFileSync(stylesPath, 'utf8')

describe('renderer porcelain theme styles', () => {
  it('removes the old brown-gold palette from global UI styles', () => {
    const retiredPalette = [
      '#1f140f',
      '#221914',
      '#fff1cf',
      '#8c4327',
      '#512416',
      '#a14d2a',
      '#642918',
      '#5f2c1a',
      '#743720',
      '#f4ead4',
      '#eadbc0',
      '#3f2a1a',
      '#6d4c2d',
      '113, 81, 48'
    ]

    for (const token of retiredPalette) {
      expect(styles).not.toContain(token)
    }
  })

  it('uses the approved porcelain palette tokens', () => {
    const porcelainPalette = [
      '#071a33',
      '#1f63b5',
      '#174577',
      '#2d86c7',
      '#74c7df',
      '#dceeff',
      '#f7fbff',
      '#18375f',
      '#54749b'
    ]

    for (const token of porcelainPalette) {
      expect(styles).toContain(token)
    }
  })
  it('uses a floating sidebar collapse control without reserving a rail column', () => {
    const sidebarStyles = styles.replace(/\r\n/g, '\n')

    expect(sidebarStyles).not.toContain('.assistant-sidebar__rail')
    expect(sidebarStyles).not.toContain('grid-template-columns: 46px minmax(0, 1fr);')
    expect(sidebarStyles).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(sidebarStyles).toContain('.assistant-sidebar[data-collapsed="true"] {\n  width: 0;')
    expect(sidebarStyles).toContain('.assistant-sidebar__collapse-button {\n  position: absolute;\n  top: 5px;\n  left: -40px;')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesPath = resolve(process.cwd(), 'src/renderer/src/styles.css')
const styles = readFileSync(stylesPath, 'utf8')
const normalizedStyles = styles.replace(/\r\n/g, '\n')

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

  it('keeps the main app shell clipped to the window instead of exposing horizontal page scroll', () => {
    expect(normalizedStyles).toContain('body {\n  overflow: hidden;')
    expect(normalizedStyles).toContain('.app-shell {\n  position: relative;\n  width: 100%;')
    expect(normalizedStyles).toContain('grid-template-columns: minmax(0, 1fr) auto;')
    expect(normalizedStyles).toContain('overflow: hidden;')
  })

  it('uses a left boundary sidebar collapse control without reserving a rail column', () => {
    const sidebarStyles = styles.replace(/\r\n/g, '\n')

    expect(sidebarStyles).not.toContain('.assistant-sidebar__rail')
    expect(sidebarStyles).not.toContain('grid-template-columns: 46px minmax(0, 1fr);')
    expect(sidebarStyles).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(sidebarStyles).toContain('.assistant-sidebar[data-collapsed="true"] {\n  width: 0;')
    expect(sidebarStyles).toContain('.assistant-sidebar__collapse-button {\n  position: absolute;\n  top: 5px;\n  left: -40px;')
    expect(sidebarStyles).toContain('width: 34px;\n  min-height: 34px;')
    expect(sidebarStyles).not.toContain('.assistant-sidebar[data-collapsed="true"] .assistant-sidebar__collapse-button {\n  right: 12px;\n  bottom: 12px;')
  })

  it('gives the floating pet enough transparent stage space for the chibi and speech bubble', () => {
    expect(normalizedStyles).toContain('.palace-maid-pet-shell {\n  width: 340px;\n  height: 220px;')
    expect(normalizedStyles).toContain('.palace-maid-pet {\n  width: 178px;\n  height: 178px;')
    expect(normalizedStyles).toContain('.palace-maid-pet {\n  width: 178px;\n  height: 178px;\n  border: none;')
    expect(normalizedStyles).toContain('.palace-maid-pet__bubble {\n  position: absolute;\n  right: 186px;')
    expect(normalizedStyles).toContain('width: 144px;')
    expect(normalizedStyles).not.toContain('-webkit-line-clamp: 2;')
  })

  it('uses compact spacing for the review panel', () => {
    expect(normalizedStyles).toContain(
      '.memorial-panel__paper {\n  border: 1px solid rgba(31, 99, 181, 0.3);'
    )
    expect(normalizedStyles).toContain('padding: 8px;\n  max-height: calc(100vh - 16px);')
    expect(normalizedStyles).toContain('display: grid;\n  gap: 6px;')
    expect(normalizedStyles).toContain('.memorial-panel__action {\n  min-height: 52px;')
    expect(normalizedStyles).toContain('grid-template-columns: 28px minmax(0, 1fr);')
    expect(normalizedStyles).toContain(
      '.memorial-panel__action strong {\n  grid-area: mark;\n  width: 24px;\n  height: 24px;'
    )
  })

  it('uses compact spacing for the notes panel', () => {
    expect(normalizedStyles).toContain(
      '.video-notes {\n  color: var(--porcelain-text);\n  display: grid;\n  gap: 6px;'
    )
    expect(normalizedStyles).toContain('.video-notes__source {\n  display: grid;\n  gap: 4px;')
    expect(normalizedStyles).toContain(
      '.video-notes__source h3 {\n  margin: 0;\n  color: var(--porcelain-text);\n  font-size: 14px;'
    )
    expect(normalizedStyles).toContain(
      '.video-notes__primary-actions button {\n  min-width: 76px;\n  min-height: 32px;'
    )
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 4px;'
    )
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs button {\n  display: grid;\n  gap: 2px;\n  min-height: 44px;'
    )
    expect(normalizedStyles).toContain('.video-notes__plain-text {\n  max-height: 160px;')
    expect(normalizedStyles).toContain('.video-notes textarea {\n  min-height: 60px;')
    expect(normalizedStyles).toContain(
      '.video-notes__memo textarea[readonly] {\n  min-height: 130px;'
    )
  })
})

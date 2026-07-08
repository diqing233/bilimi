import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesPath = resolve(process.cwd(), 'src/renderer/src/styles.css')
const styles = readFileSync(stylesPath, 'utf8').replace(/\r\n/g, '\n')

describe('VideoNoteArchivePanel layout styles', () => {
  it('makes the return-to-notes button visually prominent in the archive header', () => {
    expect(styles).toContain('.video-note-archive__return-button {\n  min-height: 38px;')
    expect(styles).toContain('background: var(--porcelain-primary);')
    expect(styles).toContain('color: var(--porcelain-surface);')
    expect(styles).toContain('font-weight: 800;')
    expect(styles).toContain(
      '.video-note-archive__return-button:hover:not(:disabled),\n.video-note-archive__return-button:focus-visible:not(:disabled) {'
    )
  })

  it('keeps search, memo filter and starred filter on one compact row', () => {
    expect(styles).toContain('.video-note-archive__header,\n.video-note-archive__toolbar,\n.video-note-archive__actions {\n  display: flex;')
    expect(styles).toContain('justify-content: flex-end;')
    expect(styles).toContain('.video-note-archive__toolbar,\n.video-note-archive__list {\n  border-top: 1px dashed rgba(31, 99, 181, 0.2);')
    expect(styles).toContain('.video-note-archive__toolbar {\n  padding: 8px 0;\n  justify-content: flex-end;\n  align-items: flex-end;')
    expect(styles).toContain('.video-note-archive__toolbar label:first-child {\n  flex: 1 1 180px;')
    expect(styles).toContain('.video-note-archive__toolbar label:first-child input {\n  width: 100%;\n  height: 42px;')
    expect(styles).toContain('.video-note-archive__star-filter,\n.video-note-archive__memo-filter {\n  height: 42px;')
  })

  it('keeps version controls, starred toggle and memo toggle on one row', () => {
    expect(styles).toContain('.video-note-archive__version-controls {\n  display: flex;')
    expect(styles).toContain('.video-note-archive__version-picker {\n  position: relative;\n  display: flex;\n  gap: 6px;\n  align-items: center;\n  flex: 1 1 180px;')
    expect(styles).toContain('.video-note-archive__version-picker > button {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;')
    expect(styles).toContain('.video-note-archive__version-controls .video-note-archive__star-button {\n  min-width: 30px;')
    expect(styles).toContain('.video-note-archive__version-controls button:not(.video-note-archive__star-button) {\n  min-height: 30px;')
  })

  it('keeps the detail top layout compact with the menu centered on the title row', () => {
    expect(styles).toContain('.video-note-archive__detail {\n  display: grid;\n  gap: 8px;')
    expect(styles).toContain('.video-note-archive__detail-title-row {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  gap: 8px;\n  align-items: center;')
    expect(styles).toContain('.video-note-archive__detail-meta {\n  margin: 0;\n  color: var(--porcelain-muted);\n  font-size: 12px;')
    expect(styles).toContain('.video-note-archive__version-controls {\n  display: flex;\n  gap: 6px;\n  align-items: center;')
  })

  it('fixes archive result tab dimensions and keeps selected and unselected tabs the same size', () => {
    expect(styles).toContain('.video-note-archive__result-tabs {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(104px, 1fr));\n  gap: 6px;')
    expect(styles).toContain('.video-note-archive__result-tabs button {\n  width: 100%;\n}')
    expect(styles).toContain('.video-notes__result-tabs button {\n  display: grid;\n  grid-template-rows: auto minmax(0, 1fr);')
    expect(styles).toContain('height: 78px;\n  min-height: 78px;')
    expect(styles).toContain('.video-note-archive__result-tabs button[aria-selected="true"],\n.memorial-panel__tabs button[aria-selected="true"],\n.video-notes [role="tab"][aria-selected="true"] {')
    expect(styles).not.toContain('min-height: 36px;\n  height: 36px;')
  })

  it('stacks the archive list above the detail pane', () => {
    expect(styles).toContain('grid-template-rows: minmax(0, 1fr) auto auto;')
    expect(styles).toContain(
      '.video-note-archive[data-result-expanded="true"] {\n  grid-template-rows: minmax(0, 1.05fr) minmax(0, 0.85fr) auto;'
    )
  })

  it('keeps archive detail content inside the visible pane by default', () => {
    expect(styles).toContain('.video-note-archive__detail {\n  display: grid;\n  gap: 8px;')
    expect(styles).toContain('overflow-x: hidden;')
    expect(styles).toContain('white-space: pre-wrap;')
    expect(styles).toContain('overflow-wrap: anywhere;')
  })

  it('lets every archive result tab use the detail pane scrollbar', () => {
    expect(styles).toContain(
      '.video-note-archive__result-panel .video-notes__plain-text,\n.video-note-archive__result-panel pre {\n  max-height: none;\n  overflow: visible;'
    )
    expect(styles).toContain(
      '.video-note-archive__detail section {\n  display: grid;\n  gap: 6px;\n  border-top: 1px dashed rgba(31, 99, 181, 0.18);'
    )
    expect(styles).toContain(
      '.video-note-archive__result-panel .video-notes__plain-text {\n  border-top: 0;\n  padding-top: 0;'
    )
  })
})

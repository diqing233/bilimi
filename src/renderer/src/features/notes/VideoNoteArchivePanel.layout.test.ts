import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesPath = resolve(process.cwd(), 'src/renderer/src/styles.css')
const styles = readFileSync(stylesPath, 'utf8').replace(/\r\n/g, '\n')
const archivePanelStylesPath = resolve(process.cwd(), 'src/renderer/src/features/notes/VideoNoteArchivePanel.css')
const archivePanelStyles = readFileSync(archivePanelStylesPath, 'utf8').replace(/\r\n/g, '\n')

describe('VideoNoteArchivePanel layout styles', () => {
  it('makes the return-to-notes button visually prominent in the archive header', () => {
    const returnButtonStyles = [...styles.matchAll(/\.video-note-archive__return-button \{[^}]+\}/g)].map((match) => match[0])
    const returnButtonStyle = returnButtonStyles.find((style) => style.includes('display: inline-grid;'))

    expect(returnButtonStyle).toContain('display: inline-grid;')
    expect(returnButtonStyle).toContain('grid-template-columns: auto 28px auto;')
    expect(returnButtonStyle).toContain('gap: 4px;')
    expect(returnButtonStyle).toContain('min-height: 42px;')
    expect(returnButtonStyle).toContain('padding: 6px 10px;')
    expect(returnButtonStyle).toContain('border-color: rgba(31, 99, 181, 0.32);')
    expect(returnButtonStyle).toContain('background: linear-gradient(180deg, rgba(255, 254, 253, 0.98), rgba(220, 238, 255, 0.98));')
    expect(returnButtonStyle).toContain('color: var(--porcelain-text);')
    expect(returnButtonStyle).toContain('font-size: 15px;')
    expect(returnButtonStyle).toContain('font-weight: 700;')
    expect(returnButtonStyle).toContain('line-height: 1.25;')
    expect(styles).toContain('.video-note-archive__return-pet {\n  width: 28px;\n  height: 28px;')
    expect(styles).toContain(
      '.video-note-archive__return-label {\n  color: var(--porcelain-text);\n  font-size: 18px;\n  font-weight: 700;\n  line-height: 1.25;\n  text-align: left;'
    )

    const hoverStyle = styles.match(
      /\.video-note-archive__return-button:hover:not\(:disabled\),\n\.video-note-archive__return-button:focus-visible:not\(:disabled\) \{[^}]+\}/
    )?.[0]
    expect(hoverStyle).toContain('background: linear-gradient(180deg, rgba(255, 254, 253, 1), rgba(220, 238, 255, 1));')
    expect(hoverStyle).toContain('color: var(--porcelain-text);')
  })

  it('keeps the bordered global archive surfaces rounded', () => {
    expect(styles).toContain(
      '.video-note-archive__history-card,\n.video-note-archive__detail {\n  width: 100%;\n  box-sizing: border-box;\n  min-width: 0;\n  min-height: 0;\n  overflow: auto;\n  border: 1px solid rgba(31, 99, 181, 0.16);\n  background: rgba(247, 251, 255, 0.64);\n  padding: 8px;\n  border-radius: var(--porcelain-radius-surface);'
    )
  })

  it('keeps search, memo filter and starred filter on one compact row', () => {
    expect(styles).toContain('.video-note-archive__header,\n.video-note-archive__toolbar,\n.video-note-archive__actions {\n  display: flex;')
    expect(styles).toContain('justify-content: flex-end;')
    expect(styles).toContain('.video-note-archive__toolbar,\n.video-note-archive__list {\n  box-sizing: border-box;\n  width: calc(100% + (var(--porcelain-card-padding) * 2));\n  margin-inline: calc(var(--porcelain-card-padding) * -1);\n  border-top: 1px dashed rgba(31, 99, 181, 0.2);')
    expect(styles).toContain('.video-note-archive__toolbar {\n  padding: 8px 0;\n  padding-inline: var(--porcelain-card-padding);\n  justify-content: flex-end;\n  align-items: flex-end;')
    expect(styles).toContain('.video-note-archive__toolbar label:first-child {\n  flex: 1 1 180px;')
    expect(styles).toContain('.video-note-archive__toolbar label:first-child input {\n  width: 100%;\n  height: 42px;')
    expect(styles).toContain('.video-note-archive__star-filter,\n.video-note-archive__memo-filter {\n  height: 42px;')
  })

  it('reserves visible scrollbar space inside the full-bleed archive list', () => {
    expect(styles).toMatch(/\.video-note-archive__list \{[\s\S]*?width: calc\(100% \+ var\(--porcelain-card-padding\)\);[\s\S]*?margin-left: calc\(var\(--porcelain-card-padding\) \* -1\);/)
    expect(styles).toMatch(/\.video-note-archive__list \{[\s\S]*?scrollbar-gutter: stable;/)
    expect(styles).toMatch(/\.video-note-archive__list \{[\s\S]*?padding-right: calc\(var\(--porcelain-card-padding\) \+ 8px\);/)
  })

  it('wraps archive batch actions without overflowing a narrow sidebar', () => {
    expect(styles).toMatch(/\.video-note-archive__batch-toolbar \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/)
    expect(styles).toMatch(/\.video-note-archive__batch-status \{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/)
    expect(styles).toMatch(/\.video-note-archive__batch-actions \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/)
    expect(styles).toContain('.video-note-archive__history-card[data-batch-mode="true"] {\n  grid-template-rows: auto auto auto minmax(0, 1fr);')
  })

  it('keeps normal archive cards full width and adds a checkbox column only in batch mode', () => {
    expect(styles).toContain('.video-note-archive__list-item {\n  display: block;')
    expect(styles).toContain('.video-note-archive__history-card[data-batch-mode="true"] .video-note-archive__list-item {\n  display: grid;\n  grid-template-columns: auto minmax(0, 1fr);')
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
    expect(styles).toContain('.video-notes__result-tabs button {\n  display: grid;\n  grid-template-rows: auto auto;')
    expect(styles).toContain('height: 66px;\n  min-height: 66px;')
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

  it('gives archive documents a stable readable viewport instead of the legacy 160px cap', () => {
    expect(styles).not.toContain('.video-notes__result-body {\n  max-height: 160px;')
    expect(styles).toContain(
      '.video-note-archive__result-panel .video-notes__result-body {\n  min-height: 240px;\n  max-height: none;\n  overflow-x: hidden;\n  overflow-y: auto;'
    )
    expect(styles).toContain(
      '.video-notes__result-body ol,\n.video-notes__result-body pre,\n.video-notes__result-body .video-notes__plain-text {\n  max-height: none;\n  overflow: visible;'
    )
    expect(styles).toContain('.video-notes__timeline {\n  display: grid;')
    expect(styles).toContain('.video-notes__timeline-row {\n  display: grid;')
    expect(styles).toContain('.video-notes__timeline-row {\n  display: grid;\n  grid-template-columns: max-content minmax(0, 1fr);\n  gap: 10px;\n  align-items: baseline;')
    expect(archivePanelStyles).toContain('.video-note-archive__timestamp-button {\n  appearance: none;')
    expect(archivePanelStyles).toContain('  line-height: 1.75;')
  })

  it('keeps feedback out of the document sizing flow', () => {
    expect(styles).toContain(
      '.video-notes__feedback {\n  position: absolute;\n  right: 0;\n  bottom: 0;\n  left: 0;'
    )
    expect(styles).toContain(
      '.video-notes__feedback p {\n  max-height: 3em;\n  margin: 0;\n  overflow: auto;'
    )
  })
})

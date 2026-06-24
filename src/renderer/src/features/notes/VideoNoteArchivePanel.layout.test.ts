import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesPath = resolve(process.cwd(), 'src/renderer/src/styles.css')
const styles = readFileSync(stylesPath, 'utf8').replace(/\r\n/g, '\n')

describe('VideoNoteArchivePanel layout styles', () => {
  it('keeps search, memo filter and starred filter on one compact row', () => {
    expect(styles).toContain('.video-note-archive__header,\n.video-note-archive__toolbar,\n.video-note-archive__actions {\n  display: flex;')
    expect(styles).toContain('justify-content: flex-end;')
    expect(styles).toContain('.video-note-archive__toolbar {\n  border: 1px solid rgba(31, 99, 181, 0.16);\n  background: rgba(247, 251, 255, 0.64);\n  padding: 8px;\n  justify-content: flex-end;\n  align-items: flex-end;')
    expect(styles).toContain('.video-note-archive__toolbar label:first-child {\n  flex: 1 1 180px;')
    expect(styles).toContain('.video-note-archive__toolbar label:first-child input {\n  width: 100%;\n  height: 42px;')
    expect(styles).toContain('.video-note-archive__star-filter,\n.video-note-archive__memo-filter {\n  height: 42px;')
  })

  it('keeps version controls, starred toggle and memo toggle on one row', () => {
    expect(styles).toContain('.video-note-archive__version-controls {\n  display: flex;')
    expect(styles).toContain('.video-note-archive__version-controls label {\n  flex: 1 1 180px;')
    expect(styles).toContain('.video-note-archive__version-controls .video-note-archive__star-button {\n  min-width: 30px;')
    expect(styles).toContain('.video-note-archive__version-controls button:not(.video-note-archive__star-button) {\n  min-height: 30px;')
  })

  it('stacks the archive list above the detail pane', () => {
    expect(styles).toContain('grid-template-rows: minmax(150px, 0.9fr) minmax(0, 1.1fr);')
  })

  it('keeps archive detail content inside the visible pane by default', () => {
    expect(styles).toContain('.video-note-archive__detail {\n  display: grid;\n  gap: 10px;')
    expect(styles).toContain('overflow-x: hidden;')
    expect(styles).toContain('white-space: pre-wrap;')
    expect(styles).toContain('overflow-wrap: anywhere;')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesPath = resolve(process.cwd(), 'src/renderer/src/styles.css')
const styles = readFileSync(stylesPath, 'utf8').replace(/\r\n/g, '\n')

describe('VideoNoteArchivePanel layout styles', () => {
  it('places memo and starred filters above the search field on the top right', () => {
    expect(styles).toContain('.video-note-archive__header,\n.video-note-archive__toolbar,\n.video-note-archive__actions {\n  display: flex;')
    expect(styles).toContain('justify-content: flex-end;')
    expect(styles).toContain('.video-note-archive__toolbar label:first-child {\n  order: 2;')
    expect(styles).toContain('flex: 1 0 100%;')
    expect(styles).toContain('.video-note-archive__toolbar label:not(:first-child),\n.video-note-archive__star-filter {\n  order: 1;')
    expect(styles).toContain('.video-note-archive__toolbar label:first-child input {\n  width: 100%;')
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

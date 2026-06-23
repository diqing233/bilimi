import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesPath = resolve(process.cwd(), 'src/renderer/src/styles.css')
const styles = readFileSync(stylesPath, 'utf8')
const normalizedStyles = styles.replace(/\r\n/g, '\n')
const compactStyles = normalizedStyles.replace(/\s+/g, ' ')

function expectStyleSnippet(snippet: string): void {
  expect(compactStyles).toContain(snippet.replace(/\s+/g, ' '))
}

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
    expect(sidebarStyles).not.toContain('.assistant-sidebar {\n  width: 46px;')
    expect(sidebarStyles).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(sidebarStyles).toContain('.assistant-sidebar[data-collapsed="true"] {\n  width: 0;')
    expect(sidebarStyles).toContain('.assistant-sidebar__collapse-button {\n  position: absolute;\n  top: 12px;\n  left: -82px;')
    expect(sidebarStyles).not.toContain('top: 5px;')
    expect(sidebarStyles).toContain('min-width: 66px;\n  min-height: 32px;')
    expect(sidebarStyles).toContain('grid-template-columns: 24px auto;')
    expect(sidebarStyles).toContain('.assistant-sidebar-workspace .floating-assistant-tabs {')
    expect(sidebarStyles).toContain('padding-left: 0;')
    expect(sidebarStyles).toContain('.assistant-sidebar__collapse-label {\n  line-height: 1;')
    expect(sidebarStyles).toContain('.assistant-sidebar__collapse-pet {\n  width: 24px;\n  height: 24px;')
    expect(sidebarStyles).not.toContain('.assistant-sidebar[data-collapsed="true"] .assistant-sidebar__collapse-button {\n  right: 12px;\n  bottom: 12px;')
  })

  it('keeps the four assistant tabs equally spaced with horizontal labels', () => {
    expect(normalizedStyles).toContain(
      '.floating-assistant-tabs {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));'
    )
    expect(normalizedStyles).toContain(
      '.floating-assistant-tabs button {\n  width: 100%;\n  min-width: 0;\n  min-height: 36px;'
    )
    expect(normalizedStyles).toContain('grid-template-columns: 28px max-content;')
    expect(normalizedStyles).toContain('white-space: nowrap;')
    expect(normalizedStyles).toContain(
      '.floating-assistant-tabs button span {\n  min-width: 0;\n  white-space: nowrap;\n  writing-mode: horizontal-tb;'
    )
    expect(normalizedStyles).toContain(
      '.assistant-sidebar-workspace .floating-assistant-tabs {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 6px;\n  padding-left: 0;'
    )
  })

  it('keeps the floating pet fixed-size inside its transparent stage', () => {
    expect(normalizedStyles).toContain('.palace-maid-pet-shell {\n  width: 336px;\n  height: 380px;')
    expectStyleSnippet(
      '.palace-maid-pet-shell { width: 336px; height: 380px; position: relative;'
    )
    expect(normalizedStyles).toContain('max-width: 100vw;\n  max-height: 100vh;')
    expect(normalizedStyles).toContain('--floating-pet-size: 148px;')
    expect(normalizedStyles).toContain('--floating-pet-host-width: 336px;')
    expect(normalizedStyles).toContain('--floating-pet-host-height: 380px;')
    expect(normalizedStyles).not.toContain('--floating-pet-size: clamp(')
    expect(normalizedStyles).not.toContain('.palace-maid-pet-shell {\n  width: 100vw;\n  height: 100vh;')
    expect(normalizedStyles).not.toContain('min(54vw, 50vh)')
    expect(normalizedStyles).not.toContain('min(54vw, calc(100vh - 96px))')
    expect(normalizedStyles).not.toContain('min(72vw, calc(100vh - 96px))')
    expect(normalizedStyles).toContain('padding: 0 16px 18px;')
    expect(normalizedStyles).not.toContain('padding: 16px 16px 18px;')
    expect(normalizedStyles).toContain('.palace-maid-pet {\n  width: var(--floating-pet-size);\n  height: var(--floating-pet-size);')
    expect(normalizedStyles).toContain('.palace-maid-pet__bubble {\n  position: absolute;\n  left: 50%;')
    expect(normalizedStyles).toContain('left: 50%;\n  bottom: calc(var(--floating-pet-size) + 10px);')
    expect(normalizedStyles).not.toContain('top: 1px;')
    expect(normalizedStyles).toContain('max-width: min(270px, calc(var(--floating-pet-host-width) - 8px));')
    expect(normalizedStyles).toContain('transform: translateX(var(--pet-bubble-offset-x, -50%));')
    expect(normalizedStyles).toContain('width: min(270px, calc(var(--floating-pet-host-width) - 8px));')
    expect(normalizedStyles).not.toContain('width: calc(var(--floating-pet-host-width) - 8px);')
    expect(normalizedStyles).not.toContain('width: calc(100vw - 8px);')
    expect(normalizedStyles).not.toContain('max-width: calc(100vw - 8px);')
    expect(normalizedStyles).not.toContain('width: min(204px, calc(100vw - 28px));')
    expect(normalizedStyles).not.toContain('bottom: calc(100% + 18px);')
    expect(normalizedStyles).toContain('.palace-maid-pet__resize-controls {')
    expect(normalizedStyles).toContain('.palace-maid-pet__resize-step {')
    expect(normalizedStyles).toContain('right: 22px;')
    expect(normalizedStyles).toContain('bottom: 34px;')
    expect(normalizedStyles).not.toContain('right: max(8px, calc(50% - var(--floating-pet-size) * 0.46));')
    expect(normalizedStyles).not.toContain('left: calc(50% + 96px);')
    expect(normalizedStyles).toContain('border: 1px solid rgba(116, 199, 223, 0.72);')
    expect(normalizedStyles).toContain('background: rgba(220, 238, 255, 0.86);')
    expect(normalizedStyles).toContain('color: var(--porcelain-deep);')
    expect(normalizedStyles).not.toContain(
      'left: calc(50% + var(--floating-pet-size) * 0.42);'
    )
    expect(normalizedStyles).not.toContain('bottom: 14px;')
    expect(normalizedStyles).toContain('opacity: 0;')
    expect(normalizedStyles).toContain('pointer-events: none;')
    expect(normalizedStyles).toContain('.palace-maid-pet__resize-controls[data-visible="true"],')
    expect(normalizedStyles).toContain('opacity: 1;')
    expect(normalizedStyles).toContain('pointer-events: auto;')
    expectStyleSnippet(
      '.palace-maid-pet__resize-controls[data-visible="true"], .palace-maid-pet__resize-controls:focus-within { opacity: 1; pointer-events: auto; transform: none;'
    )
    expectStyleSnippet('.palace-maid-pet__resize-step:active { transform: none;')
    expect(normalizedStyles).not.toContain('.palace-maid-pet__resize-handle')
    expect(normalizedStyles).not.toContain('cursor: nwse-resize;')
    expect(normalizedStyles).not.toContain('right: 7px;\n  bottom: 7px;')
    expect(normalizedStyles).not.toContain('-webkit-line-clamp: 2;')
  })

  it('uses compact spacing for the review panel', () => {
    expect(normalizedStyles).toContain(
      '.memorial-panel__paper {\n  border: 1px solid rgba(31, 99, 181, 0.3);'
    )
    expect(normalizedStyles).toContain('padding: 8px;\n  max-height: calc(100vh - 16px);')
    expect(normalizedStyles).toContain('display: grid;\n  gap: 8px;')
    expect(normalizedStyles).toContain('.memorial-panel__actions {\n  display: grid;\n  grid-template-columns: 1fr;')
    expect(normalizedStyles).toContain('.memorial-panel__action {\n  min-height: 62px;')
    expect(normalizedStyles).toContain('grid-template-columns: 58px minmax(0, 1fr);')
    expectStyleSnippet('grid-template-areas: "mark label" "mark desc";')
    expect(normalizedStyles).toContain(
      '.memorial-panel__action-icon {\n  grid-area: mark;\n  position: relative;\n  width: 42px;\n  height: 44px;'
    )
    expect(normalizedStyles).toContain('justify-self: start;')
    expect(normalizedStyles).toContain(
      '.memorial-panel__action-pet {\n  width: 42px;\n  height: 42px;'
    )
    expect(normalizedStyles).toContain(
      '.memorial-panel__action strong {\n  position: absolute;\n  right: -2px;\n  bottom: -1px;\n  width: 18px;\n  height: 18px;'
    )
    expect(normalizedStyles).toContain('.memorial-panel__copy,\n.memorial-panel__meta,\n.memorial-panel__verdict {\n  color: var(--porcelain-text);\n  line-height: 1.5;\n  font-size: 14px;')
    expect(normalizedStyles).not.toContain('.memorial-panel__action span {\n  grid-area: label;')
    expect(normalizedStyles).toContain('.memorial-panel__action-label {\n  grid-area: label;\n  min-width: 0;\n  padding-left: 4px;\n  color: var(--porcelain-text);\n  font-weight: 700;\n  font-size: 15px;\n  text-align: left;')
    expect(normalizedStyles).toContain('.memorial-panel__action-description {\n  grid-area: desc;\n  min-width: 0;\n  padding-left: 4px;\n  color: var(--porcelain-muted);\n  font-size: 12px;\n  text-align: left;')
  })

  it('uses compact spacing for the notes panel', () => {
    expect(normalizedStyles).toContain(
      '.video-notes {\n  color: var(--porcelain-text);\n  display: grid;\n  align-content: start;\n  gap: 8px;\n  font-size: 14px;'
    )
    expect(normalizedStyles).toContain('.video-notes__source {\n  display: grid;\n  gap: 4px;')
    expect(normalizedStyles).toContain(
      '.video-notes__source h3 {\n  margin: 0;\n  color: var(--porcelain-text);\n  font-size: 16px;'
    )
    expect(normalizedStyles).toContain(
      '.video-notes__primary-actions button {\n  min-width: 88px;\n  min-height: 36px;'
    )
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 4px;'
    )
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs button {\n  display: grid;\n  gap: 2px;\n  min-height: 50px;'
    )
    expect(normalizedStyles).toContain('.video-notes__plain-text {\n  max-height: 160px;')
    expect(normalizedStyles).toContain('.video-notes textarea {\n  min-height: 60px;')
    expect(normalizedStyles).toContain(
      '.video-notes__memo textarea[readonly] {\n  min-height: 130px;'
    )
  })

  it('keeps assistant panel rows from stretching into tall empty blocks', () => {
    expect(normalizedStyles).toContain(
      '.memorial-panel__paper {\n  border: 1px solid rgba(31, 99, 181, 0.3);'
    )
    expect(normalizedStyles).toContain('display: grid;\n  align-content: start;\n  gap: 6px;')
    expect(normalizedStyles).toContain(
      '.video-notes {\n  color: var(--porcelain-text);\n  display: grid;\n  align-content: start;\n  gap: 8px;'
    )
  })

  it('keeps favorite ledger status near the toolbar and ledger copy compact', () => {
    expectStyleSnippet('.favorite-ledger-panel__status { margin: 6px 0 0;')
    expectStyleSnippet('.favorite-ledger-panel__category-actions { display: flex; flex-wrap: wrap;')
    expectStyleSnippet('.favorite-ledger-panel__chips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));')
    expectStyleSnippet('.favorite-ledger-panel__list-toggle { display: flex; justify-content: flex-end; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__editor-actions { display: flex; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__chip-item { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 28px;')
    expectStyleSnippet('.favorite-ledger-panel__chip-item[data-dragging="true"] { opacity: 0.58; filter: drop-shadow(0 5px 7px rgba(31, 99, 181, 0.18));')
    expectStyleSnippet('.favorite-ledger-panel__chip-item[data-drop-target="true"]::before { position: absolute; top: -4px;')
    expectStyleSnippet('.favorite-ledger-panel__chip-item[data-drop-target="true"] > button:first-child, .favorite-ledger-panel__chip-item[data-drop-target="true"] > .favorite-ledger-panel__chip-action { background: rgba(220, 238, 255, 0.72);')
    expectStyleSnippet('.favorite-ledger-panel__chip-action { min-width: 28px; width: 28px;')
    expectStyleSnippet('.favorite-ledger-panel__chip-item > button:first-child[aria-pressed="true"] { border-color: rgba(31, 99, 181, 0.42); background: rgba(220, 238, 255, 0.78);')
    expectStyleSnippet('.favorite-ledger-panel__chip-action[data-enabled="true"] { border-color: rgba(31, 99, 181, 0.42); background: rgba(220, 238, 255, 0.78);')
    expectStyleSnippet('.favorite-ledger-panel__save-status { color: var(--porcelain-muted); font-size: 12px;')
    expectStyleSnippet('.favorite-ledger-panel__prefixed-input { display: grid; grid-template-columns: auto minmax(0, 1fr);')
    expectStyleSnippet('.favorite-ledger-panel__keyword-hint { margin: 0; color: var(--porcelain-muted);')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__sync-confirm')
    expectStyleSnippet('.favorite-ledger-panel__editor strong, .favorite-ledger-panel__preview strong { font-size: 15px;')
    expectStyleSnippet('.favorite-ledger-panel__preview h3 { font-size: 16px;')
  })

  it('styles the DeepSeek assistant settings group and actions', () => {
    expect(normalizedStyles).toContain('.assistant-settings__group--deepseek')
    expect(normalizedStyles).toContain('.assistant-settings__actions')
    expect(normalizedStyles).toContain(
      '.assistant-settings__group--deepseek .assistant-settings__actions'
    )
    expect(normalizedStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));')
    expect(normalizedStyles).toContain('.assistant-settings__actions button:active')
    expect(normalizedStyles).toContain('.assistant-settings__actions button:focus-visible')
    expect(normalizedStyles).toContain('.assistant-settings__deepseek-recommendation')
    expect(normalizedStyles).toContain('.assistant-settings__copy-button')
    expect(normalizedStyles).toContain('width: 18px;')
  })

  it('keeps sidebar review comment suggestions readable inside the workspace', () => {
    expectStyleSnippet('.memorial-panel__deepseek-status {')
    expectStyleSnippet('.assistant-dialog--comment-chooser { max-height: min(74vh, 560px);')
    expectStyleSnippet('.assistant-dialog__comment-list { display: grid; gap: 8px; max-height: min(48vh, 360px); overflow: auto;')
    expectStyleSnippet('.assistant-dialog__comment-choice { width: 100%; line-height: 1.55; white-space: normal; overflow-wrap: anywhere;')
    expectStyleSnippet('.assistant-sidebar-workspace .assistant-dialog--comment-chooser { position: absolute; top: 58px; right: 12px; bottom: 12px; left: 12px;')
    expectStyleSnippet('grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden;')
    expectStyleSnippet('.assistant-sidebar-workspace .assistant-dialog__comment-list { min-height: 0; max-height: none; overflow: auto;')
  })
})

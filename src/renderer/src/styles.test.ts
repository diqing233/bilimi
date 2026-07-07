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
    expect(normalizedStyles).not.toContain('.app-shell {\n  transform: scale(')
  })

  it('uses compact density rules for small logical windows without scaling the whole app', () => {
    expect(normalizedStyles).toContain('@media (max-width: 1200px), (max-height: 760px)')
    expectStyleSnippet(
      '@media (max-width: 1200px), (max-height: 760px) { .app-main { grid-template-rows: 38px minmax(0, 1fr);'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace { gap: 8px; padding: 8px; font-size: 13px;'
    )
    expectStyleSnippet(
      '.assistant-sidebar { width: var(--assistant-sidebar-width, clamp(288px, 26vw, 320px));'
    )
  })

  it('keeps browser tabs scrolling left of fixed refresh and collapse controls', () => {
    expect(normalizedStyles).toContain(
      '.browser-tabs {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;'
    )
    expect(normalizedStyles).toContain(
      '.browser-tabs__list {\n  min-width: 0;\n  display: flex;'
    )
    expect(normalizedStyles).toContain('overflow-x: auto;')
    expect(normalizedStyles).toContain(
      '.browser-tabs__controls {\n  display: grid;\n  grid-template-columns: 34px 78px;'
    )
    expect(normalizedStyles).toContain('border-left: 1px solid rgba(7, 26, 51, 0.24);')
    expect(normalizedStyles).toContain('.browser-tabs__collapse-slot {\n  width: 78px;')
  })

  it('keeps inactive browser webviews composited so switching tabs repaints correctly', () => {
    expectStyleSnippet('.browser-stack { position: relative; min-height: 0;')
    expectStyleSnippet('.browser-surface { position: absolute; inset: 0; width: 100%; height: 100%;')
    expectStyleSnippet('.browser-surface[data-active="true"] { visibility: visible; opacity: 1; pointer-events: auto;')
    expectStyleSnippet('.browser-surface--hidden { visibility: hidden; opacity: 0; pointer-events: none;')
    expect(normalizedStyles).not.toContain('.browser-surface--hidden {\n  display: none;')
  })

  it('uses a left boundary sidebar collapse control without reserving a rail column', () => {
    const sidebarStyles = styles.replace(/\r\n/g, '\n')

    expect(sidebarStyles).not.toContain('.assistant-sidebar__rail')
    expect(sidebarStyles).not.toContain('.assistant-sidebar {\n  width: 46px;')
    expect(sidebarStyles).toContain(
      'width: var(--assistant-sidebar-width, clamp(320px, 24vw, 384px));'
    )
    expect(sidebarStyles).toContain(
      'min-width: var(--assistant-sidebar-width, clamp(320px, 24vw, 384px));'
    )
    expect(sidebarStyles).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(sidebarStyles).toContain('.assistant-sidebar[data-collapsed="true"] {\n  width: 0;')
    expect(sidebarStyles).toContain('.assistant-sidebar__resize-handle {')
    expect(sidebarStyles).toContain('cursor: col-resize;')
    expect(sidebarStyles).toContain('.assistant-sidebar__resize-shield {\n  position: fixed;')
    expect(sidebarStyles).toContain('inset: 0;\n  z-index: 2;\n  cursor: col-resize;')
    expect(sidebarStyles).toContain('.assistant-sidebar__collapse-button {\n  position: absolute;\n  top: 5px;\n  left: -82px;')
    expect(sidebarStyles).not.toContain(
      '.assistant-sidebar__collapse-button {\n  position: absolute;\n  top: 12px;'
    )
    expect(sidebarStyles).toContain('min-width: 66px;\n  min-height: 30px;')
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
    expect(normalizedStyles).not.toContain(
      '.floating-assistant-tabs button[data-icon-only="true"]'
    )
    expectStyleSnippet(
      '.floating-assistant-workspace__fold { position: absolute; right: 0; bottom: 0;'
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
    expect(normalizedStyles).toContain('padding: 0 16px 2px;')
    expect(normalizedStyles).not.toContain('padding: 0 16px 18px;')
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
    expectStyleSnippet(
      '.palace-maid-pet__resize-controls { position: absolute; right: 34px; bottom: 2px;'
    )
    expect(normalizedStyles).not.toContain('right: 22px;\n  bottom: 18px;')
    expect(normalizedStyles).not.toContain('bottom: 34px;')
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
    expectStyleSnippet(
      '.palace-maid-pet__hover-shortcuts { position: absolute; left: 38px; bottom: 2px;'
    )
    expect(normalizedStyles).not.toContain('left: 58px;\n  bottom: 2px;')
    expectStyleSnippet(
      '.palace-maid-pet__hover-shortcuts[data-layout="fan"] .palace-maid-pet__hover-shortcut:nth-child(1) { transform: translate(12px, 0);'
    )
    expect(normalizedStyles).not.toContain('left: 18px;\n  bottom: 50px;')
    expect(normalizedStyles).not.toContain('transform: translate(18px, -16px);')
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
    expect(normalizedStyles).toContain('padding: 8px 8px 46px;\n  max-height: calc(100vh - 16px);')
    expectStyleSnippet(
      '.memorial-panel__paper { border: 1px solid rgba(31, 99, 181, 0.3); position: relative;'
    )
    expectStyleSnippet('.memorial-panel__paper { padding: 8px 8px 46px;')
    expectStyleSnippet(
      '.memorial-panel__close { position: absolute; right: 8px; bottom: 8px;'
    )
    expect(normalizedStyles).toContain('display: grid;\n  gap: 8px;')
    expect(normalizedStyles).toContain('.memorial-panel__actions {\n  display: grid;\n  grid-template-columns: 1fr;')
    expect(normalizedStyles).toContain('.assistant-action-button {\n  min-height: 62px;')
    expect(normalizedStyles).toContain('grid-template-columns: 58px minmax(0, 1fr);')
    expectStyleSnippet('grid-template-areas: "mark label" "mark desc";')
    expect(normalizedStyles).toContain(
      '.assistant-action-button__icon {\n  grid-area: mark;\n  position: relative;\n  width: 42px;\n  height: 44px;'
    )
    expect(normalizedStyles).toContain('justify-self: start;')
    expect(normalizedStyles).toContain(
      '.assistant-action-button__pet {\n  width: 42px;\n  height: 42px;'
    )
    expect(normalizedStyles).toContain(
      '.assistant-action-button__icon strong {\n  position: absolute;\n  right: -2px;\n  bottom: -1px;\n  width: 18px;\n  height: 18px;'
    )
    expectStyleSnippet(
      '.assistant-action-button__icon strong { position: absolute; right: -2px; bottom: -1px; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 999px; background: var(--porcelain-primary); color: var(--porcelain-white);'
    )
    expect(normalizedStyles).not.toContain('.video-notes__primary-actions strong,')
    expect(normalizedStyles).toContain('.memorial-panel__copy,\n.memorial-panel__meta,\n.memorial-panel__verdict {\n  color: var(--porcelain-text);\n  line-height: 1.5;\n  font-size: 14px;')
    expect(normalizedStyles).not.toContain('.memorial-panel__action span {\n  grid-area: label;')
    expect(normalizedStyles).toContain('.assistant-action-button__label {\n  grid-area: label;\n  min-width: 0;\n  padding-left: 4px;\n  color: var(--porcelain-text);\n  font-weight: 700;\n  font-size: 15px;\n  text-align: left;')
    expect(normalizedStyles).toContain('.assistant-action-button__description {\n  grid-area: desc;\n  min-width: 0;\n  padding-left: 4px;\n  color: var(--porcelain-muted);\n  font-size: 12px;\n  font-weight: 700;\n  text-align: left;')
  })

  it('uses compact spacing for the notes panel', () => {
    expect(normalizedStyles).toContain(
      '.video-notes {\n  color: var(--porcelain-text);\n  display: grid;\n  align-content: start;\n  gap: 8px;\n  font-size: 14px;'
    )
    expect(normalizedStyles).toContain('.video-notes__source {\n  display: grid;\n  gap: 4px;')
    expect(normalizedStyles).toContain(
      '.video-notes__source h3 {\n  margin: 0;\n  color: var(--porcelain-text);\n  font-size: 16px;'
    )
    expectStyleSnippet('.video-notes__primary-actions { display: grid; grid-template-columns: 1fr;')
    expectStyleSnippet(
      '.video-notes__primary-actions { display: grid; grid-template-columns: 1fr; gap: 6px; align-items: center; border: 0; background: transparent; padding: 0;'
    )
    expect(normalizedStyles).not.toContain('.video-notes__primary-title')
    expectStyleSnippet('.assistant-action-button { min-height: 62px; display: grid; grid-template-columns: 58px minmax(0, 1fr);')
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));\n  gap: 4px;'
    )
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs button {\n  display: grid;\n  gap: 2px;\n  min-height: 50px;'
    )
    expectStyleSnippet('.video-notes__source dd { min-width: 0; overflow-wrap: anywhere;')
    expectStyleSnippet('.video-notes__summary-result { display: grid; gap: 8px; min-width: 0;')
    expectStyleSnippet('.video-notes__summary-result pre { max-width: 100%; overflow-x: hidden; white-space: pre-wrap; overflow-wrap: anywhere;')
    expectStyleSnippet('.video-notes__summary-section pre { max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;')
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
    expectStyleSnippet(
      '.video-notes__panel-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; margin-left: auto;'
    )
    expectStyleSnippet('.video-notes__summary-generate { font-weight: 700;')
  })

  it('keeps favorite ledger status near the toolbar and ledger copy compact', () => {
    expectStyleSnippet('.favorite-ledger-panel__topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 8px;')
    expectStyleSnippet('.favorite-ledger-panel__topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 8px; border: 0; background: transparent; padding: 0;')
    expectStyleSnippet('.favorite-ledger-panel__toolbar { display: grid; grid-template-columns: 1fr; width: 100%;')
    expectStyleSnippet('.assistant-action-button:hover:not(:disabled), .assistant-action-button:focus-visible:not(:disabled) { border-color: rgba(31, 99, 181, 0.5);')
    expectStyleSnippet('.favorite-ledger-panel__safety-note { flex: 1 0 100%; color: var(--porcelain-muted); font-size: 12px;')
    expectStyleSnippet('.favorite-ledger-panel__status { margin: 6px 0 0;')
    expectStyleSnippet('.favorite-ledger-panel__sync-hint { color: var(--porcelain-muted); font-size: 12px;')
    expectStyleSnippet('.favorite-ledger-panel__category-actions { display: flex; flex-wrap: wrap;')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__pending-queue')
    expectStyleSnippet('.favorite-ledger-panel__pending-actions { display: grid; grid-template-columns: minmax(0, 1fr);')
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

  it('styles the old favorites guide as a step-based review flow', () => {
    expectStyleSnippet('.favorite-ledger-panel__old-favorites-guide { display: grid; gap: 10px;')
    expectStyleSnippet('.favorite-ledger-panel__guide-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));')
    expectStyleSnippet('.favorite-ledger-panel__guide-steps button { width: 100%; min-width: 0;')
    expectStyleSnippet('.favorite-ledger-panel__guide-steps button { width: 100%; min-width: 0; height: 36px; min-height: 36px; padding: 0 6px;')
    expect(compactStyles).not.toContain(
      '.favorite-ledger-panel__guide-steps { display: grid; grid-template-columns: repeat(4, minmax(88px, 1fr)); gap: 6px; overflow-x: auto;'
    )
    expect(compactStyles).not.toContain(
      '.favorite-ledger-panel__guide-steps button { min-width: 0; height: 36px; min-height: 36px; padding: 0 8px; font-size: 12px; line-height: 1.2; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
    )
    expectStyleSnippet('.favorite-ledger-panel__guide-steps button[aria-current="step"] { border-color: rgba(31, 99, 181, 0.5);')
    expectStyleSnippet('.favorite-ledger-panel__guide-hint { margin: 0; color: var(--porcelain-muted);')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__guide-hint {\n  margin: 0;\n  border:')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics article { display: grid; grid-template-rows: 36px 26px;')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics span { min-height: 36px;')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics strong { align-self: start; padding-top: 3px; font-variant-numeric: tabular-nums;')
    expectStyleSnippet('.favorite-ledger-panel__scan-warning { margin: 0; color: var(--porcelain-warn);')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__scan-candidates')
    expectStyleSnippet('.favorite-ledger-panel__candidate-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));')
    expectStyleSnippet('.favorite-ledger-panel__candidates article, .favorite-ledger-panel__confirm { border: 1px solid rgba(31, 99, 181, 0.18);')
    expectStyleSnippet('.favorite-ledger-panel__candidates article { min-width: 0; min-height: 42px; padding: 6px 7px;')
    expectStyleSnippet('.favorite-ledger-panel__candidates label, .favorite-ledger-panel__preview label { display: grid; grid-template-columns: auto minmax(0, 1fr);')
    expectStyleSnippet('.favorite-ledger-panel__candidate-list > button { grid-column: 1 / -1; justify-self: end;')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__candidate-list--detailed')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__candidate-list--compact')
    expectStyleSnippet('.favorite-ledger-panel__preview-groups { display: grid; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__preview-row { display: grid; grid-template-columns: minmax(0, 1fr);')
    expectStyleSnippet('.favorite-ledger-panel__preview-row header { grid-column: 1 / -1; min-width: 0;')
    expectStyleSnippet('.favorite-ledger-panel__preview-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__preview-heading strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')
    expectStyleSnippet('.favorite-ledger-panel__preview-tools { display: grid; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-card, .favorite-ledger-panel__deepseek-archive-card { display: grid; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-button { min-width: 132px; min-height: 36px;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-scope { display: inline-grid; grid-template-columns: auto minmax(150px, max-content);')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-scope select { width: min(220px, 100%);')
    expectStyleSnippet('.favorite-ledger-panel__preview-videos { grid-column: 1 / -1; display: grid; grid-auto-columns: minmax(260px, calc(100% - 12px));')
    expectStyleSnippet('.favorite-ledger-panel__preview-videos article { min-width: 0; border: 1px solid rgba(31, 99, 181, 0.12);')
    expectStyleSnippet('.favorite-ledger-panel__preview-video { width: 100%; min-height: 0; display: grid; align-content: start;')
    expectStyleSnippet('border-left: 3px solid transparent; background: transparent;')
    expectStyleSnippet('.favorite-ledger-panel__preview-video[data-selected="true"] { border-left-color: var(--porcelain-accent); background: rgba(220, 238, 255, 0.68);')
    expectStyleSnippet('.favorite-ledger-panel__preview-row--pending .favorite-ledger-panel__preview-videos article { border-color: transparent; background: transparent;')
    expectStyleSnippet('.favorite-ledger-panel__preview-video-meta { display: grid; gap: 3px; min-width: 0;')
    expectStyleSnippet('.favorite-ledger-panel__preview-video-meta small { min-width: 0; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')
    expectStyleSnippet('.favorite-ledger-panel__preview-delta-row { display: grid; grid-template-columns: minmax(0, 1fr) auto;')
    expectStyleSnippet('.favorite-ledger-panel__preview-delta { min-width: 0; overflow: hidden; color: rgb(166, 46, 46);')
    expectStyleSnippet('.favorite-ledger-panel__preview-row--pending { background: transparent;')
    expectStyleSnippet('.favorite-ledger-panel button.favorite-ledger-panel__preview-video-title { display: block; width: 100%;')
    expectStyleSnippet('text-decoration: underline; text-underline-offset: 2px; cursor: pointer;')
    expectStyleSnippet('.favorite-ledger-panel__old-favorite-progress { display: grid; gap: 6px;')
    expectStyleSnippet('.favorite-ledger-panel__old-favorite-progress progress { width: 100%;')
  })

  it('styles the DeepSeek assistant settings group and actions', () => {
    expectStyleSnippet('.assistant-settings { display: grid; grid-template-rows: auto minmax(0, 1fr);')
    expectStyleSnippet('.assistant-settings > header { display: grid; gap: 10px;')
    expectStyleSnippet('.assistant-settings__title-row { display: grid; grid-template-columns: minmax(0, 1fr) auto;')
    expectStyleSnippet('.assistant-settings__header-actions { display: flex; flex-wrap: wrap;')
    expectStyleSnippet('justify-content: flex-end; gap: 8px;')
    expectStyleSnippet('.assistant-settings__section-buttons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));')
    expectStyleSnippet('.assistant-settings__body { min-height: 0; overflow: auto;')
    expectStyleSnippet('.assistant-settings > header button { min-height: 30px;')
    expectStyleSnippet('.assistant-settings__diagnostics-head { display: grid; grid-template-columns: minmax(0, 1fr) auto auto;')
    expect(normalizedStyles).toContain('.assistant-settings__group--deepseek')
    expectStyleSnippet('.assistant-settings__deepseek-switches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));')
    expectStyleSnippet('.assistant-settings__deepseek-switches label { display: inline-grid; grid-template-columns: auto minmax(0, 1fr);')
    expectStyleSnippet('.assistant-settings__deepseek-switches--nested { grid-template-columns: repeat(2, minmax(0, max-content));')
    expect(normalizedStyles).not.toContain('.assistant-settings__deepseek-divider')
    expect(normalizedStyles).toContain('.assistant-settings__actions')
    expect(normalizedStyles).toContain(
      '.assistant-settings__group--deepseek .assistant-settings__actions'
    )
    expect(normalizedStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));')
    expect(normalizedStyles).toContain('.assistant-settings__actions button:active')
    expect(normalizedStyles).toContain('.assistant-settings__actions button:focus-visible')
    expect(normalizedStyles).toContain('.assistant-settings__deepseek-recommendation')
    expectStyleSnippet(
      '.assistant-settings__copy-row { display: flex; align-items: center; gap: 6px;'
    )
    expectStyleSnippet(
      '.assistant-settings__copy-button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center;'
    )
    expectStyleSnippet(
      '.assistant-settings__copy-button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; min-width: 40px; height: 24px;'
    )
    expect(normalizedStyles).toContain('border-color: rgba(31, 99, 181, 0.3);')
    expect(normalizedStyles).toContain('background: var(--porcelain-surface);')
  })

  it('keeps archive strategy help text compact', () => {
    expectStyleSnippet('.assistant-settings__group--archive { gap: 6px;')
    expectStyleSnippet('.assistant-settings__group--archive p { margin: 0;')
  })

  it('keeps correction learning and keyword suggestion settings compact', () => {
    expectStyleSnippet('.assistant-settings__learning-list { display: grid; gap: 6px;')
    expectStyleSnippet('.assistant-settings__option-help { min-width: 0; overflow: hidden; color: var(--porcelain-muted);')
    expectStyleSnippet('.assistant-settings__learning-head { display: grid; grid-template-columns: minmax(0, 1fr) auto;')
    expectStyleSnippet('.assistant-settings__learning-summary { min-width: 0; overflow: hidden;')
    expectStyleSnippet('.assistant-settings__keyword-item { display: grid; grid-template-columns: minmax(0, 1fr);')
    expectStyleSnippet('.assistant-settings__keyword-actions button { min-height: 30px; height: 30px;')
    expectStyleSnippet('.assistant-settings__keyword-actions button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')
    expect(compactStyles).not.toContain(
      '.assistant-settings__learning-item { border: 1px solid rgba(31, 99, 181, 0.18); background: rgba(247, 251, 255, 0.64);'
    )
  })

  it('keeps the pet shortcut heading the same font size as pet settings', () => {
    expect(normalizedStyles).toContain('.assistant-settings__group legend {\n  color: var(--porcelain-text);')
    expect(normalizedStyles).not.toContain(
      '.assistant-settings__hover-shortcuts-copy strong {\n  font-size: 14px;'
    )
  })

  it('keeps sidebar review comment suggestions readable inside the workspace', () => {
    expectStyleSnippet('.memorial-panel__deepseek-status {')
    expectStyleSnippet('.assistant-dialog--comment-chooser { position: relative; box-sizing: border-box; max-height: min(52vh, 360px); padding: 12px 12px 36px; overflow: hidden;')
    expectStyleSnippet('.assistant-dialog__comment-list { display: grid; gap: 8px; max-height: min(36vh, 232px); margin-bottom: 6px; overflow: auto;')
    expectStyleSnippet('.assistant-dialog__comment-row { display: block;')
    expectStyleSnippet('.assistant-dialog .assistant-dialog__comment-choice { display: inline; width: auto;')
    expectStyleSnippet('line-height: 1.55; padding: 0; white-space: normal; overflow-wrap: anywhere;')
    expectStyleSnippet('.assistant-dialog .assistant-dialog__comment-copy { display: inline-flex;')
    expectStyleSnippet('.assistant-dialog .assistant-dialog__comment-copy { display: inline-flex; align-items: center; justify-content: center; min-width: 34px;')
    expectStyleSnippet('.assistant-dialog .assistant-dialog__comment-status { margin: 0; min-height: 20px;')
    expectStyleSnippet('.assistant-dialog__comment-actions { position: absolute; right: 20px; bottom: 8px; display: flex; justify-content: flex-end;')
    expectStyleSnippet('.assistant-dialog__comment-cancel { flex: 0 0 auto;')
    expectStyleSnippet('.assistant-sidebar-workspace .assistant-dialog--comment-chooser { position: absolute; right: 12px; bottom: 12px; left: 12px;')
    expectStyleSnippet('width: auto; box-sizing: border-box; max-height: min(52vh, 360px);')
  })

  it('does not show wait cursors for disabled controls', () => {
    expect(normalizedStyles).not.toContain('cursor: wait')
    expectStyleSnippet('.video-notes button:disabled { cursor: not-allowed;')
    expectStyleSnippet('.assistant-settings__diagnostics-head button:disabled, .assistant-settings > header button:disabled { cursor: not-allowed;')
  })
})

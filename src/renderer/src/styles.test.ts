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
  it('keeps bordered controls rounded instead of square-cornered', () => {
    expect(normalizedStyles).not.toMatch(/border-(?:top|bottom)-(?:left|right)-radius:\s*0\b/)

    const roundedControlSelectors = [
      'button',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[role="tab"]'
    ]

    expectStyleSnippet(
      `${roundedControlSelectors.join(', ')} { border-radius: var(--porcelain-radius-control);`
    )
  })

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
      '.assistant-sidebar-workspace { --assistant-sidebar-workspace-padding-x: 8px; gap: 6px; padding: 4px var(--assistant-sidebar-workspace-padding-x) 8px; font-size: 13px;'
    )
    expectStyleSnippet(
      '.assistant-sidebar { width: var(--assistant-sidebar-width, clamp(288px, 26vw, 320px));'
    )
  })

  it('keeps browser tabs scrolling left of fixed refresh and collapse controls', () => {
    expect(normalizedStyles).toContain(
      '.browser-tabs {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;'
    )
    expectStyleSnippet(
      '.browser-tabs { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-width: 0; overflow: hidden; padding: 5px 0 5px 10px; border-top: 1px solid rgba(31, 99, 181, 0.06); border-bottom: 1px solid rgba(31, 99, 181, 0.18); background: linear-gradient( 180deg, rgba(226, 238, 249, 0.96), rgba(216, 232, 246, 0.96) ); box-shadow: 0 1px 2px rgba(7, 26, 51, 0.06);'
    )
    expect(normalizedStyles).toContain(
      '.browser-tabs__list {\n  min-width: 0;\n  display: flex;'
    )
    expect(normalizedStyles).toContain('overflow-x: auto;')
    expect(normalizedStyles).toContain(
      '.browser-tabs__controls {\n  display: grid;\n  grid-template-columns: 34px 78px;'
    )
    expect(normalizedStyles).toContain('border-left: 1px solid rgba(31, 99, 181, 0.16);')
    expect(normalizedStyles).toContain('.browser-tabs__collapse-slot {\n  width: 78px;')
  })

  it('visually separates the app browser toolbar from the native window title bar', () => {
    expectStyleSnippet(
      '.browser-tabs { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-width: 0; overflow: hidden; padding: 5px 0 5px 10px; border-top: 1px solid rgba(31, 99, 181, 0.06); border-bottom: 1px solid rgba(31, 99, 181, 0.18); background: linear-gradient( 180deg, rgba(226, 238, 249, 0.96), rgba(216, 232, 246, 0.96) ); box-shadow: 0 1px 2px rgba(7, 26, 51, 0.06);'
    )
    expectStyleSnippet(
      '.browser-tabs__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; flex: 0 0 auto; width: clamp(112px, 16vw, 220px); min-width: 112px; max-width: 220px; height: 30px; border: 1px solid rgba(31, 99, 181, 0.2); border-radius: 6px 6px 4px 4px; background: rgba(247, 251, 255, 0.62); box-shadow: inset 0 -1px 0 rgba(31, 99, 181, 0.08);'
    )
    expectStyleSnippet(
      '.browser-tabs__item[data-selected="true"] { border-color: rgba(31, 99, 181, 0.42); background: rgba(255, 254, 253, 0.96); box-shadow: 0 1px 3px rgba(7, 26, 51, 0.08), inset 0 -2px 0 var(--porcelain-primary);'
    )
    expectStyleSnippet(
      '.browser-tabs__controls { display: grid; grid-template-columns: 34px 78px; gap: 8px; align-items: center; height: 100%; padding: 0 0 0 8px; border-left: 1px solid rgba(31, 99, 181, 0.22); box-sizing: border-box; background: rgba(213, 230, 246, 0.44);'
    )
    expect(styles).not.toContain('border-top: 1px solid rgba(255, 255, 255')
    expect(styles).not.toContain('inset 0 1px 0 rgba(255, 255, 255, 0.76)')
    expect(styles).not.toContain('-webkit-app-region: drag')
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
    expectStyleSnippet(
      '.assistant-sidebar-workspace { --assistant-sidebar-workspace-padding-x: 12px; --assistant-sidebar-scrollbar-width: 12px; --assistant-sidebar-panel-overhang: max(var(--assistant-sidebar-workspace-padding-x), var(--assistant-sidebar-scrollbar-width)); height: 100%; min-height: 0; box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 6px; padding: 4px var(--assistant-sidebar-workspace-padding-x) 12px;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .floating-assistant-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; padding: 7px 6px 6px;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .floating-assistant-global-status { margin-right: 0; margin-left: 0; padding-right: 0; padding-left: 0;'
    )
    expect(sidebarStyles).toContain('.assistant-sidebar__collapse-label {\n  line-height: 1;')
    expect(sidebarStyles).toContain('.assistant-sidebar__collapse-pet {\n  width: 24px;\n  height: 24px;')
    expect(sidebarStyles).not.toContain('.assistant-sidebar[data-collapsed="true"] .assistant-sidebar__collapse-button {\n  right: 12px;\n  bottom: 12px;')
  })

  it('keeps the four assistant tabs equally spaced with horizontal labels', () => {
    expect(normalizedStyles).toContain(
      '.floating-assistant-tabs {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));'
    )
    expect(normalizedStyles).toContain(
      '.floating-assistant-tabs button {\n  width: 100%;\n  min-width: 0;\n  min-height: 38px;'
    )
    expect(normalizedStyles).toContain('grid-template-columns: 22px minmax(0, auto);')
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
      '.assistant-sidebar-workspace .floating-assistant-tabs {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 5px;\n  padding: 7px 6px 6px;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .floating-assistant-tabs button { grid-template-columns: 18px minmax(0, auto); gap: 2px; min-height: 34px; padding: 0 3px; font-size: 12px; overflow: hidden;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .floating-assistant-tabs__pet { width: 18px; height: 18px; transform: scale(1.3333333333);'
    )
  })

  it('keeps the global assistant status separated by a visible soft bottom rule', () => {
    expectStyleSnippet('.floating-assistant-global-status { min-height: 68px; display: grid; grid-template-rows: minmax(34px, auto) 34px; gap: 0; padding: 0; border: 0; background: rgba(247, 251, 255, 0.76);')
    expectStyleSnippet('.floating-assistant-global-status__feedback { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--porcelain-deep); padding: 7px 10px; font-size: 14px; font-weight: 700;')
    expectStyleSnippet('.floating-assistant-global-status__lights { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));')
    expectStyleSnippet('.floating-assistant-global-status__light { min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 100%; padding: 0 4px; overflow: hidden; color: #285e90; font-size: 12px;')
    expect(compactStyles).not.toContain('border: 1px solid rgba(31, 99, 181, 0.14); border-left: 0; border-right: 0;')
  })

  it('lets archive history controls wrap instead of overlapping in the assistant sidebar', () => {
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-actions { width: 100%; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-select { flex: 1 1 148px;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-button { flex: 1 1 112px; min-width: 112px;'
    )
  })

  it('uses dashed assistant sidebar divider lines while keeping the outer frame and tab buttons defined', () => {
    expectStyleSnippet('.floating-assistant-chrome { min-width: 0; display: grid; grid-template-rows: auto auto; border: 1px solid #82b8f0;')
    expectStyleSnippet('.floating-assistant-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; padding: 8px 8px 7px; border-bottom: 1px dashed #d1e6fb;')
    expectStyleSnippet('.floating-assistant-tabs button { width: 100%; min-width: 0; min-height: 38px; display: grid; grid-template-columns: 22px minmax(0, auto); justify-content: center; align-items: center; gap: 4px; border: 1px solid #8ec0f4;')
    expectStyleSnippet('.floating-assistant-global-status__lights { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; align-items: center; border-top: 1px dashed #d1e6fb;')
    expectStyleSnippet('.floating-assistant-global-status__light + .floating-assistant-global-status__light { border-left: 1px dashed #d1e6fb;')
  })

  it('keeps every assistant sidebar panel stretched to the ledger frame height', () => {
    expectStyleSnippet(
      '.assistant-sidebar-workspace .floating-assistant-view { min-width: 0; min-height: 0; height: 100%; overflow: visible;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .memorial-panel, .assistant-sidebar-workspace .favorite-ledger-panel, .assistant-sidebar-workspace .video-note-archive, .assistant-sidebar-workspace .assistant-settings { width: 100%; height: 100%; max-height: none; box-sizing: border-box; box-shadow: none;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .memorial-panel__paper { height: 100%; max-height: none; box-sizing: border-box; overflow: auto; box-shadow: none; border: 0;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .favorite-ledger-panel, .assistant-sidebar-workspace .video-note-archive { height: 100%; box-sizing: border-box; overflow: auto;'
    )
  })

  it('keeps assistant sidebar scrollbars in a right-side panel overhang instead of reserving content space', () => {
    expect(normalizedStyles).not.toContain('--assistant-sidebar-scrollbar-rail')
    expectStyleSnippet(
      '.assistant-sidebar-workspace { --assistant-sidebar-workspace-padding-x: 12px; --assistant-sidebar-scrollbar-width: 12px; --assistant-sidebar-panel-overhang: max(var(--assistant-sidebar-workspace-padding-x), var(--assistant-sidebar-scrollbar-width));'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .memorial-panel__paper, .assistant-sidebar-workspace .favorite-ledger-panel, .assistant-sidebar-workspace .video-note-archive { width: auto; margin-right: calc(var(--assistant-sidebar-panel-overhang) * -1);'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .floating-assistant-view { min-width: 0; min-height: 0; height: 100%; overflow: visible;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .memorial-panel__paper { padding-right: calc(8px + var(--assistant-sidebar-panel-overhang));'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .favorite-ledger-panel, .assistant-sidebar-workspace .video-note-archive { padding-right: var(--assistant-sidebar-panel-overhang);'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .memorial-panel__paper::-webkit-scrollbar, .assistant-sidebar-workspace .favorite-ledger-panel::-webkit-scrollbar, .assistant-sidebar-workspace .video-note-archive::-webkit-scrollbar { width: var(--assistant-sidebar-scrollbar-width);'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .memorial-panel__paper::-webkit-scrollbar-track, .assistant-sidebar-workspace .favorite-ledger-panel::-webkit-scrollbar-track, .assistant-sidebar-workspace .video-note-archive::-webkit-scrollbar-track { background: rgba(220, 238, 255, 0.72);'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace .memorial-panel__paper::-webkit-scrollbar-thumb, .assistant-sidebar-workspace .favorite-ledger-panel::-webkit-scrollbar-thumb, .assistant-sidebar-workspace .video-note-archive::-webkit-scrollbar-thumb { border: 3px solid rgba(220, 238, 255, 0.72); background: rgba(31, 99, 181, 0.48);'
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
    expect(normalizedStyles).not.toContain('.palace-maid-pet__bubble span {\n  -webkit-line-clamp: 2;')
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
    expect(normalizedStyles).toContain('grid-template-columns: 58px minmax(0, 1fr) auto;')
    expectStyleSnippet('grid-template-areas: "mark label setting" "mark desc desc";')
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
    expectStyleSnippet('.assistant-action-button .memorial-panel__action-setting { grid-area: setting;')
    expect(normalizedStyles).not.toContain('.video-notes__primary-actions strong,')
    expect(normalizedStyles).toContain('.memorial-panel__copy,\n.memorial-panel__meta,\n.memorial-panel__verdict {\n  color: var(--porcelain-text);\n  line-height: 1.5;\n  font-size: 14px;')
    expect(normalizedStyles).not.toContain('.memorial-panel__action span {\n  grid-area: label;')
    expect(normalizedStyles).toContain('.assistant-action-button__label {\n  grid-area: label;\n  min-width: 0;\n  padding-left: 4px;\n  color: var(--porcelain-text);\n  font-weight: 700;\n  font-size: 15px;\n  text-align: left;')
    expect(normalizedStyles).toContain('.assistant-action-button__description {\n  grid-area: desc;\n  min-width: 0;\n  padding-left: 4px;\n  color: var(--porcelain-muted);\n  font-size: 12px;\n  font-weight: 700;\n  text-align: left;')
  })

  it('frames review video metadata and stretches review actions to the panel width', () => {
    expectStyleSnippet(
      '.memorial-panel__body { margin-top: 0; margin-right: -8px; margin-left: -8px; grid-template-columns: 1fr; gap: 8px;'
    )
    expectStyleSnippet(
      '.memorial-panel__meta { box-sizing: border-box; width: 100%; border: 1px solid rgba(31, 99, 181, 0.16); background: rgba(247, 251, 255, 0.64); padding: 8px;'
    )
    expectStyleSnippet(
      '.memorial-panel__actions, .memorial-panel__action-card, .memorial-panel__actions .assistant-action-button { width: 100%; box-sizing: border-box;'
    )
    expect(normalizedStyles).toContain('.assistant-action-button {\n  min-height: 62px;')
    expect(compactStyles).not.toContain('.memorial-panel__meta { height:')
    expect(compactStyles).not.toContain('.assistant-action-button { height:')
    expect(compactStyles).not.toContain('.memorial-panel__meta { border: 0;')
    expect(compactStyles).not.toContain(
      '.memorial-panel__meta { border-top: 1px dashed'
    )
    expect(compactStyles).not.toContain(
      '.memorial-panel__meta { border-top: 0; border-bottom: 1px solid'
    )
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
    expectStyleSnippet(
      '.video-notes, .video-notes__source, .video-notes__primary-actions, .video-notes__result-tabs, .video-notes__primary-actions .assistant-action-button { width: 100%; box-sizing: border-box;'
    )
    expectStyleSnippet(
      '.memorial-panel__paper > .video-notes { width: auto; margin-right: -8px; margin-left: -8px;'
    )
    expect(normalizedStyles).not.toContain('.video-notes__primary-title')
    expectStyleSnippet('.assistant-action-button { min-height: 62px; display: grid; grid-template-columns: 58px minmax(0, 1fr) auto;')
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));\n  gap: 4px;'
    )
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs button {\n  display: grid;\n  grid-template-rows: auto auto;\n  align-content: start;\n  gap: 2px;\n  height: 66px;\n  min-height: 66px;'
    )
    expectStyleSnippet('.video-notes__result-tabs button { display: grid; grid-template-rows: auto auto; align-content: start; gap: 2px; height: 66px; min-height: 66px; min-width: 0; box-sizing: border-box; padding: 6px 8px;')
    expectStyleSnippet('.video-notes__result-tabs small { display: -webkit-box; overflow: hidden; color: inherit; opacity: 0.78; line-height: 1.18; -webkit-box-orient: vertical; -webkit-line-clamp: 2; text-overflow: ellipsis;')
    expectStyleSnippet('.video-notes__queue-selector { position: relative; top: -2px; display: inline-flex; flex: 0 0 auto; align-self: flex-start; align-items: center;')
    expectStyleSnippet('.video-notes__queue-selector select { appearance: none; width: 24px; min-width: 24px; height: 24px; padding: 0;')
    expectStyleSnippet('.video-notes__queue-selector::after { content: ""; position: absolute; right: 8px; top: 50%; width: 6px; height: 6px; border-right: 1.5px solid rgba(31, 99, 181, 0.72); border-bottom: 1.5px solid rgba(31, 99, 181, 0.72); transform: translateY(-62%) rotate(45deg); pointer-events: none;')
    expect(normalizedStyles).toContain(
      '.video-note-archive__result-tabs {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(104px, 1fr));'
    )
    expectStyleSnippet(
      '.video-note-archive__result-tabs button { width: 100%;'
    )
    expect(normalizedStyles).toContain(
      '.video-note-archive__result-tabs button[aria-selected="true"],\n.memorial-panel__tabs button[aria-selected="true"],\n.video-notes [role="tab"][aria-selected="true"]'
    )
    expect(normalizedStyles).not.toContain('min-height: 36px;\n  height: 36px;')
    expectStyleSnippet(
      '.video-note-archive { display: grid; grid-template-rows: minmax(0, 1fr) auto auto; gap: 10px; min-height: 0; border: 0; background: transparent;'
    )
    expectStyleSnippet(
      '.video-note-archive[data-result-expanded="true"] { grid-template-rows: minmax(0, 1.05fr) minmax(0, 0.85fr) auto;'
    )
    expectStyleSnippet(
      '.video-note-archive__history-card, .video-note-archive__detail { width: 100%; box-sizing: border-box;'
    )
    expectStyleSnippet(
      '.video-note-archive__history-card { display: grid; grid-template-rows: auto auto minmax(0, 1fr);'
    )
    expectStyleSnippet(
      '.video-note-archive__toolbar, .video-note-archive__list { border-top: 1px dashed rgba(31, 99, 181, 0.2);'
    )
    expectStyleSnippet('.video-notes__source dd { min-width: 0; overflow-wrap: anywhere;')
    expectStyleSnippet('.video-notes__summary-result { display: grid; gap: 8px; min-width: 0;')
    expectStyleSnippet('.video-notes__summary-result pre { max-width: 100%; overflow-x: hidden; white-space: pre-wrap; overflow-wrap: anywhere;')
    expectStyleSnippet('.video-notes__summary-section { display: grid; gap: 5px; min-width: 0; border-top: 1px dashed rgba(31, 99, 181, 0.18);')
    expectStyleSnippet('.video-notes__summary-section pre { max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; border: 0; background: transparent;')
    expectStyleSnippet('.video-notes__result-body { max-height: 160px; overflow: auto; border-top: 1px dashed rgba(31, 99, 181, 0.18); background: transparent;')
    expectStyleSnippet('.video-notes__result-body ol, .video-notes__result-body pre, .video-notes__result-body .video-notes__plain-text { max-height: none; overflow: visible; border-top: 0; padding-top: 0;')
    expectStyleSnippet('.video-note-archive__detail section { display: grid; gap: 6px; border-top: 1px dashed rgba(31, 99, 181, 0.18);')
    expectStyleSnippet('.video-note-archive__result-panel .video-notes__result-body { border-top: 0; padding-top: 0;')
    expect(normalizedStyles).not.toContain('.video-notes__plain-text {\n  max-height: 160px;\n  overflow: auto;\n  border: 1px solid')
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
    expectStyleSnippet(
      '.assistant-sidebar-workspace .favorite-ledger-panel { border: 0; background: transparent; padding: 0;'
    )
    expectStyleSnippet('.favorite-ledger-panel__topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 8px;')
    expectStyleSnippet('.favorite-ledger-panel__topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 8px; border: 0; background: transparent; padding: 0;')
    expectStyleSnippet('.favorite-ledger-panel__toolbar { display: grid; grid-template-columns: 1fr; width: 100%;')
    expectStyleSnippet(
      '.favorite-ledger-panel__topbar, .favorite-ledger-panel__toolbar, .favorite-ledger-panel__toolbar button, .favorite-ledger-panel__workspace, .favorite-ledger-panel__notice, .favorite-ledger-panel__status, .favorite-ledger-panel__checklist, .favorite-ledger-panel__editor, .favorite-ledger-panel__form, .favorite-ledger-panel__preview, .favorite-ledger-panel__chips, .favorite-ledger-panel__chip-item { width: 100%; box-sizing: border-box;'
    )
    expect(compactStyles).not.toContain(
      '.favorite-ledger-panel__chip-item, .favorite-ledger-panel__category-actions { width: 100%;'
    )
    expectStyleSnippet('.assistant-action-button:hover:not(:disabled), .assistant-action-button:focus-visible:not(:disabled) { border-color: rgba(31, 99, 181, 0.5);')
    expectStyleSnippet('.favorite-ledger-panel__safety-note { flex: 1 0 100%; color: var(--porcelain-muted); font-size: 12px;')
    expectStyleSnippet('.favorite-ledger-panel__status { margin: 6px 0 0;')
    expectStyleSnippet('.favorite-ledger-panel__sync-hint { color: var(--porcelain-muted); font-size: 12px;')
    expectStyleSnippet('.favorite-ledger-panel__help-toggle { appearance: none; width: 14px; height: 18px;')
    expectStyleSnippet('.favorite-ledger-panel__help-toggle { appearance: none; width: 14px; height: 18px; min-width: 14px; min-height: 18px; padding: 0; border: 0; background: transparent; box-shadow: none;')
    expectStyleSnippet('.favorite-ledger-panel__help-toggle:hover:not(:disabled), .favorite-ledger-panel__help-toggle:focus-visible:not(:disabled) { border-color: transparent; background: transparent;')
    expect(normalizedStyles).toContain(
      '.favorite-ledger-panel .favorite-ledger-panel__help-toggle {\n  border: 0;'
    )
    expect(normalizedStyles.indexOf('.favorite-ledger-panel button,')).toBeLessThan(
      normalizedStyles.indexOf('.favorite-ledger-panel .favorite-ledger-panel__help-toggle {')
    )
    expect(normalizedStyles).toContain(
      '.favorite-ledger-panel .favorite-ledger-panel__help-toggle:hover:not(:disabled),\n.favorite-ledger-panel .favorite-ledger-panel__help-toggle:focus-visible:not(:disabled) {\n  border-color: transparent;'
    )
    expect(normalizedStyles.indexOf('.favorite-ledger-panel button:hover:not(:disabled):not(.assistant-action-button)')).toBeLessThan(
      normalizedStyles.indexOf('.favorite-ledger-panel .favorite-ledger-panel__help-toggle:hover:not(:disabled)')
    )
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
    expectStyleSnippet('.favorite-ledger-panel__step-note { margin: 0; font-size: 12px; line-height: 1.45;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__step-note {\n  margin: 0;\n  color: var(--porcelain-muted);')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__scan-candidates')
    expectStyleSnippet('.favorite-ledger-panel__candidate-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));')
    expectStyleSnippet('.favorite-ledger-panel__candidates article, .favorite-ledger-panel__confirm { border: 1px solid rgba(31, 99, 181, 0.18);')
    expectStyleSnippet('.favorite-ledger-panel__candidates article { min-width: 0; min-height: 42px; padding: 6px 7px;')
    expectStyleSnippet('.favorite-ledger-panel__candidates label, .favorite-ledger-panel__preview label { display: grid; grid-template-columns: auto minmax(0, 1fr);')
    expectStyleSnippet('.favorite-ledger-panel__candidate-list > button { grid-column: 1 / -1; justify-self: end;')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__candidate-list--detailed')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__candidate-list--compact')
    expectStyleSnippet('.favorite-ledger-panel__preview-groups { display: grid; gap: 10px; max-height: min(62vh, 720px); overflow-y: auto;')
    expectStyleSnippet('.favorite-ledger-panel__preview-groups { display: grid; gap: 10px; max-height: min(62vh, 720px); overflow-y: auto; min-width: 0; border: 1px solid rgba(31, 99, 181, 0.22); border-radius: var(--porcelain-radius-surface);')
    expectStyleSnippet('.favorite-ledger-panel__preview-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-items: start; min-width: 0; border: 1px solid rgba(31, 99, 181, 0.18); border-radius: var(--porcelain-radius-surface);')
    expectStyleSnippet('.favorite-ledger-panel__preview-row header { grid-column: 1 / -1; min-width: 0;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__preview-row header {\n  grid-column: 1 / -1;\n  position: sticky;')
    expectStyleSnippet('.favorite-ledger-panel__preview-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__preview-heading strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')
    expectStyleSnippet('.favorite-ledger-panel__preview-tools { display: grid; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__archive-tool-card { display: grid; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__archive-tool-divider { height: 1px; border-top: 1px dashed rgba(31, 99, 181, 0.3);')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-actions { width: 100%; display: flex; flex-wrap: wrap;')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-select { flex: 1 1 148px; display: flex; align-items: center;')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-button { flex: 1 1 112px; min-width: 112px; min-height: 32px;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-actions { display: flex; align-items: center; justify-content: flex-end;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-scope > button { min-width: 84px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-scope-arrow { font-size: 10px; line-height: 1;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-scope-menu { position: absolute; z-index: 10;')
    expectStyleSnippet('.favorite-ledger-panel__preview-videos { grid-column: 1 / -1; display: flex; align-items: stretch; gap: 18px; min-width: 0; overflow-x: auto;')
    expectStyleSnippet('padding: 0 12px 8px; scroll-padding-inline: 12px;')
    expectStyleSnippet('.favorite-ledger-panel__preview-videos article { flex: 0 0 calc(100% - 56px); min-width: 0; display: grid; grid-template-rows: minmax(116px, 1fr) auto; scroll-snap-align: start;')
    expectStyleSnippet('.favorite-ledger-panel__preview-videos article + article { padding-left: 0;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__preview-videos article + article {\n  border-left: 1px dashed')
    expectStyleSnippet('.favorite-ledger-panel__preview-video { width: 100%; min-height: 116px; display: grid; align-content: start;')
    expectStyleSnippet('border: 1px solid rgba(31, 99, 181, 0.16); border-left: 1px solid rgba(31, 99, 181, 0.16); background: rgba(255, 255, 255, 0.72);')
    expectStyleSnippet('.favorite-ledger-panel__preview-video[data-selected="true"] { border-color: rgba(31, 99, 181, 0.24); border-left-color: rgba(31, 99, 181, 0.58); background: rgba(220, 238, 255, 0.5);')
    expect(normalizedStyles).not.toContain('border-right-color: rgba(31, 99, 181, 0.58);')
    expectStyleSnippet('.favorite-ledger-panel__preview-row--pending .favorite-ledger-panel__preview-videos article { background: transparent;')
    expectStyleSnippet('.favorite-ledger-panel__preview-row--pending .favorite-ledger-panel__preview-video { border-color: rgba(31, 99, 181, 0.14); border-left-color: rgba(31, 99, 181, 0.14); background: rgba(255, 255, 255, 0.74);')
    expectStyleSnippet('.favorite-ledger-panel__preview-video-meta { display: grid; gap: 3px; min-width: 0;')
    expectStyleSnippet('.favorite-ledger-panel__preview-video-meta small { min-width: 0; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')
    expectStyleSnippet('.favorite-ledger-panel__preview-controls { display: grid; grid-template-columns: auto minmax(0, 1fr);')
    expect(normalizedStyles).not.toContain(".favorite-ledger-panel__preview-videos article[data-latest-change='true'] {\n  outline:")
    expectStyleSnippet('.favorite-ledger-panel__preview-delta-row { min-width: 0; min-height: 28px; display: flex; align-items: center; justify-content: flex-start; border-radius: var(--porcelain-radius-control);')
    expectStyleSnippet('background: rgba(255, 241, 219, 0.72);')
    expectStyleSnippet('text-align: left;')
    expectStyleSnippet('padding: 0 6px;')
    expectStyleSnippet('.favorite-ledger-panel__preview-delta { display: block; width: 100%; min-width: 0; overflow: hidden; color: rgb(145, 82, 21);')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__preview-delta-action')
    expectStyleSnippet('.favorite-ledger-panel__preview-row--pending { background: rgba(255, 255, 255, 0.56);')
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
    expect(normalizedStyles).not.toContain('.assistant-settings__section-buttons')
    expectStyleSnippet('.assistant-settings__jump { display: grid; grid-template-columns: auto minmax(140px, 1fr); align-items: center;')
    expectStyleSnippet('.assistant-settings__jump select { box-sizing: border-box; min-width: 0; min-height: 30px;')
    expectStyleSnippet(
      '.assistant-settings__body { min-height: 0; overflow: auto; display: grid; align-content: start; gap: 32px;'
    )
    expectStyleSnippet('border-top: 1px dashed rgba(31, 99, 181, 0.2); padding-top: 14px;')
    expectStyleSnippet('margin-right: -12px; padding-right: 10px;')
    expectStyleSnippet(
      '.assistant-settings__body::-webkit-scrollbar { width: var(--assistant-sidebar-scrollbar-width);'
    )
    expectStyleSnippet(
      '.assistant-settings__body::-webkit-scrollbar-track { background: rgba(220, 238, 255, 0.72);'
    )
    expectStyleSnippet(
      '.assistant-settings__body::-webkit-scrollbar-thumb { border: 3px solid rgba(220, 238, 255, 0.72); background: rgba(31, 99, 181, 0.48);'
    )
    expectStyleSnippet('.assistant-settings__group { display: grid; gap: 12px;')
    expectStyleSnippet('.assistant-settings__group legend { color: var(--porcelain-text); font-size: 14px;')
    expectStyleSnippet('.assistant-settings > header button { min-height: 30px;')
    expectStyleSnippet('.assistant-settings__diagnostics-head { display: grid; grid-template-columns: minmax(0, 1fr) auto auto;')
    expect(normalizedStyles).toContain('.assistant-settings__group--deepseek')
    expectStyleSnippet('.assistant-settings__deepseek-switches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));')
    expectStyleSnippet('.assistant-settings__deepseek-switches label { display: inline-grid; grid-template-columns: auto minmax(0, 1fr);')
    expectStyleSnippet('.assistant-settings__deepseek-switches--nested { grid-template-columns: repeat(2, minmax(0, max-content));')
    expectStyleSnippet('.assistant-settings__group--deepseek > label:first-of-type { display: flex; padding-bottom: 8px; border-bottom: 1px dashed rgba(31, 99, 181, 0.22);')
    expectStyleSnippet('.assistant-settings__group--deepseek > label:nth-of-type(2) { border-top: 1px dashed rgba(31, 99, 181, 0.22); padding-top: 10px;')
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
    expectStyleSnippet('.assistant-settings__group--learning .assistant-settings__inline-options { padding-bottom: 8px; border-bottom: 1px dashed rgba(31, 99, 181, 0.22);')
    expectStyleSnippet('.assistant-settings__subsection--records { border-top: 1px dashed rgba(31, 99, 181, 0.22); padding-top: 10px;')
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
    expectStyleSnippet('.assistant-dialog__comment-list { display: grid; gap: 8px; max-height: min(36vh, 232px); margin-right: -8px; padding-right: 16px; margin-bottom: 6px; overflow: auto;')
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


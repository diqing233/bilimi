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
  it('uses one themed, responsive modal surface and semantic action system', () => {
    expectStyleSnippet('.bilimi-modal__viewport { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center;')
    expectStyleSnippet('.bilimi-modal__dialog { position: relative; z-index: 1; display: grid; width: min(460px, calc(100vw - 32px));')
    expectStyleSnippet('background: linear-gradient(180deg, rgba(247, 251, 255, 0.99), rgba(220, 238, 255, 0.99));')
    expectStyleSnippet('.bilimi-modal__dialog[data-tone="danger"] { border-color: rgba(183, 62, 48, 0.42);')
    expectStyleSnippet('.bilimi-modal__actions button:hover:not(:disabled) { border-color: rgba(31, 99, 181, 0.52);')
    expectStyleSnippet('.bilimi-modal__actions button[data-variant="danger"] { border-color: #b73e30; background: #b73e30; color: white;')
    expectStyleSnippet('.assistant-settings__reset-confirmation .bilimi-modal__actions button { min-height: 30px; padding: 5px 9px; font-size: 14px; }')
    expectStyleSnippet('.assistant-settings__reset-confirmation .bilimi-modal__actions button[data-variant="danger"] { border-color: #e7a69e; background: #fff8f7; color: #a8453b; }')
    expect(normalizedStyles).not.toContain('@media (max-width: 420px) {\n  .bilimi-modal__actions {\n    display: grid;')
  })

  it('keeps old favorite recovery actions compact on one row until space genuinely runs out', () => {
    expectStyleSnippet('.old-favorite-modal__dialog .bilimi-modal__actions { flex-wrap: wrap; gap: 8px; }')
    expectStyleSnippet('.old-favorite-modal__dialog .bilimi-modal__actions button { min-height: 30px; padding: 5px 9px; font-weight: 400; white-space: nowrap; }')
  })

  it('themes the completed export folder action instead of stretching a native button', () => {
    expectStyleSnippet('.video-note-export-dialog__open-folder { justify-self: start; min-height: 32px; padding: 6px 12px;')
    expectStyleSnippet('.video-note-export-dialog__open-folder:hover:not(:disabled), .video-note-export-dialog__open-folder:focus-visible:not(:disabled) { border-color: rgba(31, 99, 181, 0.52); background: rgba(220, 238, 255, 0.92);')
    expectStyleSnippet('.video-note-export-dialog__open-folder:active:not(:disabled) { background: rgba(220, 238, 255, 0.98);')
  })

  it('keeps queue titles text-only and highlights the selected list row', () => {
    expectStyleSnippet(
      '.video-notes .video-notes__queue-record-title { display: block; min-width: 0; overflow: hidden; border: 0; padding: 0; background: transparent;'
    )
    expectStyleSnippet(
      '.video-notes__queue-record[data-selected="true"] { background: #e7f0ff;'
    )
    expectStyleSnippet(
      '.video-notes .video-notes__queue-record-title:hover, .video-notes .video-notes__queue-record-title:focus-visible { border-color: transparent; background: transparent; box-shadow: none; transform: none;'
    )
    expectStyleSnippet(
      '.video-notes .video-notes__queue-record-select, .video-notes .video-notes__queue-current-title { display: grid; min-width: 0; flex: 1; gap: 3px; border: 0; background: transparent; padding: 0;'
    )
    expectStyleSnippet(
      '.video-notes__queue-row-action { align-self: center; border: 0; background: transparent; padding: 0;'
    )
  })

  it('keeps the queue bulk-select label on one line in a narrow sidebar', () => {
    expectStyleSnippet(
      '.video-notes__queue-bulk-toolbar label { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;'
    )
  })

  it('keeps assistant-owned scrollbars on the shared porcelain palette', () => {
    expect(normalizedStyles).toContain('.assistant-settings, .local-data-settings { scrollbar-width: thin; scrollbar-color: #7ea8d8 rgb(226 238 255 / .58); }')
    expect(normalizedStyles).toContain('.assistant-settings::-webkit-scrollbar, .local-data-settings::-webkit-scrollbar { width: 10px; height: 10px; }')
  })

  it('hides the persistently mounted settings workspace outside the Settings tab', () => {
    expectStyleSnippet('.assistant-settings[hidden] { display: none;')
  })

  it('does not keep the transparent desktop pet repainting forever while idle or working', () => {
    expectStyleSnippet('.layered-pet { position: relative; z-index: 1; display: block;')
    expectStyleSnippet('animation: layered-pet-idle 3.8s ease-in-out 2;')
    expectStyleSnippet('.layered-pet[data-pet-motion="working"] { animation-name: layered-pet-working; animation-duration: 1s; animation-iteration-count: 3;')
    expectStyleSnippet('.layered-pet__layer--effect { animation: layered-pet-effect 1.2s ease-in-out 2;')
  })

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

  it('places protected reorganization buttons on the line below their copy', () => {
    expectStyleSnippet(
      '.favorite-ledger-panel__protected-summary small { grid-column: 1 / -1; min-width: 0;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__protected-summary small + button { grid-column: 1 / -1; justify-self: start;'
    )
  })

  it('centers old favorite modals over the viewport above the assistant sidebar', () => {
    expectStyleSnippet(
      '.bilimi-modal__viewport { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center;'
    )
    expectStyleSnippet(
      '.bilimi-modal__dialog { position: relative; z-index: 1; display: grid; width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 32px);'
    )
    expectStyleSnippet('.old-favorite-modal__dialog { width: min(420px, calc(100vw - 32px));')
  })

  it('keeps the compact old favorite batch controls inside narrow sidebars', () => {
    expectStyleSnippet(
      '.favorite-ledger-panel__batch-switcher { display: grid; grid-template-columns: minmax(0, 1fr) auto; flex: 1 1 100%; grid-column: 1 / -1; width: 100%; min-width: 0; max-width: 100%;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__batch-switcher > .favorite-ledger-panel__batch-select { grid-column: 1; width: 100%; min-width: 0;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__batch-switcher button, .favorite-ledger-panel__batch-switcher select { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis;'
    )
  })

  it('keeps the closed change-history trigger free of the retired parent pseudo-arrow', () => {
    expect(normalizedStyles).not.toContain(
      '.favorite-ledger-panel__archive-history-select-control::after'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-arrow { width: 7px; height: 7px;'
    )
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
      '@media (max-width: 1200px), (max-height: 760px) { .browser-workspace { grid-template-rows: 38px minmax(0, 1fr) auto;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-workspace { --assistant-sidebar-workspace-padding-x: 8px; gap: 6px; padding: 4px var(--assistant-sidebar-workspace-padding-x) 8px; font-size: 13px;'
    )
    expectStyleSnippet(
      '.assistant-sidebar-shell { width: var(--assistant-sidebar-width, clamp(288px, 26vw, 320px));'
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
    expect(normalizedStyles).toContain('border-left: 1px solid rgba(31, 99, 181, 0.22);')
    expect(normalizedStyles).toContain('.browser-tabs__collapse-slot {\n  width: 78px;')
  })

  it('compresses many open browser video tabs before falling back to horizontal scrolling', () => {
    expectStyleSnippet(
      '.browser-tabs__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; flex: 1 1 168px; width: auto; min-width: 80px; max-width: 220px;'
    )
    expectStyleSnippet(
      '.browser-tabs__item[data-selected="true"] { flex-basis: clamp(120px, 18vw, 220px);'
    )
    expectStyleSnippet(
      '.browser-tabs__tab { min-width: 0; height: 100%; display: inline-flex; align-items: center; gap: 6px; overflow: hidden;'
    )
    expect(normalizedStyles).not.toContain('.browser-tabs__tab::before')
    expectStyleSnippet(
      '.browser-tabs__close { width: 0; min-width: 0; height: 26px; padding: 0; opacity: 0; overflow: hidden; pointer-events: none;'
    )
    expectStyleSnippet(
      '.browser-tabs__item:is(:hover, :focus-within, [data-selected="true"]) .browser-tabs__close { width: 26px; opacity: 1; pointer-events: auto;'
    )
    expectStyleSnippet(
      '@media (max-width: 1200px), (max-height: 760px) { .browser-workspace { grid-template-rows: 38px minmax(0, 1fr) auto;'
    )
    expectStyleSnippet(
      '.browser-tabs__item { flex-basis: 132px; min-width: 80px; max-width: 180px; height: 28px;'
    )
  })

  it('visually separates the app browser toolbar from the native window title bar', () => {
    expectStyleSnippet(
      '.browser-tabs { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-width: 0; overflow: hidden; padding: 5px 0 5px 10px; border-top: 1px solid rgba(31, 99, 181, 0.06); border-bottom: 1px solid rgba(31, 99, 181, 0.18); background: linear-gradient( 180deg, rgba(226, 238, 249, 0.96), rgba(216, 232, 246, 0.96) ); box-shadow: 0 1px 2px rgba(7, 26, 51, 0.06);'
    )
    expectStyleSnippet(
      '.browser-tabs__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; flex: 1 1 168px; width: auto; min-width: 80px; max-width: 220px; height: 30px; box-sizing: border-box; border: 1px solid rgba(31, 99, 181, 0.2); border-radius: 6px 6px 4px 4px; background: rgba(247, 251, 255, 0.62); box-shadow: inset 0 -1px 0 rgba(31, 99, 181, 0.08);'
    )
    expectStyleSnippet(
      '.browser-tabs__item[data-selected="true"] { flex-basis: clamp(120px, 18vw, 220px); border-color: rgba(31, 99, 181, 0.42); background: rgba(255, 254, 253, 0.96); box-shadow: 0 1px 3px rgba(7, 26, 51, 0.08), inset 0 -2px 0 var(--porcelain-primary);'
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

  it('gives rounded settings, archive, and queue cards one shared full-bleed divider contract', () => {
    expectStyleSnippet('.porcelain-full-bleed-divider { box-sizing: border-box; width: calc(100% + (var(--porcelain-card-padding) * 2)); margin-inline: calc(var(--porcelain-card-padding) * -1); border-top: var(--bilimi-divider);')
    expect(normalizedStyles).toMatch(/\.video-note-archive__history-card,\n\.video-note-archive__detail \{[\s\S]*?--porcelain-card-padding: 8px;/)
    expect(normalizedStyles).toMatch(/\.assistant-settings__group \{[\s\S]*?--porcelain-card-padding: 10px;/)
    expect(normalizedStyles).toMatch(/\.video-notes__queue \{[\s\S]*?--porcelain-card-padding: 6px;/)
    for (const selector of ['\\.video-note-archive__toolbar,\\s*\\.video-note-archive__list', '\\.video-note-archive__detail section', '\\.video-notes__queue-body']) {
      expect(normalizedStyles).toMatch(new RegExp(`${selector} \\{[\\s\\S]*?width: calc\\(100% \\+ \\(var\\(--porcelain-card-padding\\) \\* 2\\)\\);[\\s\\S]*?margin-inline: calc\\(var\\(--porcelain-card-padding\\) \\* -1\\);`))
    }
    for (const selector of ['\\.video-note-archive__toolbar', '\\.video-note-archive__list', '\\.video-note-archive__detail section', '\\.video-notes__queue-body']) {
      expect(normalizedStyles).toMatch(new RegExp(`${selector} \\{[\\s\\S]*?padding-inline: var\\(--porcelain-card-padding\\);`))
    }
    expect(normalizedStyles).toMatch(/\.video-note-archive__list \{[\s\S]*?padding-block: 8px 0;[\s\S]*?padding-inline: var\(--porcelain-card-padding\);/)
    expect(normalizedStyles).toMatch(/\.video-note-archive__list \{[\s\S]*?scrollbar-gutter: stable;[\s\S]*?padding-right: calc\(var\(--porcelain-card-padding\) \+ 8px\);/)
    expect(normalizedStyles).toMatch(/\.video-note-archive__list \{[\s\S]*?width: calc\(100% \+ var\(--porcelain-card-padding\)\);[\s\S]*?margin-left: calc\(var\(--porcelain-card-padding\) \* -1\);/)
  })

  it('disables the favorite-detail reveal transition for reduced motion', () => {
    expectStyleSnippet(
      '@media (prefers-reduced-motion: reduce) { .favorite-library-drawer, .assistant-sidebar, .favorite-library__chevron, .disclosure-arrow, .favorite-library-drawer__actions button, .favorite-library__detail-section, .video-note-archive__return-button { transition-duration: 1ms !important;'
    )
  })

  it('removes the collapsed favorite library body from the drawer grid', () => {
    expectStyleSnippet(
      '.favorite-library-drawer[data-collapsed="true"] .favorite-library-drawer__body { display: none;'
    )
  })

  it('keeps preview cards as sized interactive track items with visible borders and menus', () => {
    expectStyleSnippet(
      '.favorite-ledger-panel__preview-item-shell { flex: 0 0 calc(100% - 56px); min-width: 0; scroll-snap-align: start;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__preview-item-shell > article { box-sizing: border-box; width: 100%; min-width: 0;'
    )
    expectStyleSnippet('.favorite-ledger-panel__preview-video { box-sizing: border-box; width: 100%;')
    expectStyleSnippet(
      '.favorite-ledger-panel__preview-video a { color: var(--porcelain-deep); text-decoration: underline; text-underline-offset: 2px;'
    )
    expectStyleSnippet('.favorite-ledger-panel__target-menu { position: static;')
  })

  it('slides the closed favorite library drawer out before releasing its layout', () => {
    expectStyleSnippet('.favorite-library-drawer[data-closing="true"] { transform: translateY(14px); opacity: 0; pointer-events: none;')
    expectStyleSnippet('.favorite-library-drawer[data-collapsing="true"] { transform: translateY(14px); opacity: 0;')
    expectStyleSnippet('.favorite-library-drawer[data-closing="true"] { transform: translateY(var(--panel-drawer-collapse-offset, 14px)); transition: transform var(--panel-drawer-close-duration, 170ms) var(--panel-drawer-close-easing, cubic-bezier(0.4, 0, 1, 1)), opacity 140ms var(--panel-drawer-close-easing, cubic-bezier(0.4, 0, 1, 1));')
    expectStyleSnippet('.favorite-library-drawer[data-collapsing="true"] { transform: translateY(var(--panel-drawer-collapse-offset, 14px)); transition: transform var(--panel-drawer-collapse-duration, 170ms) var(--panel-drawer-collapse-easing, cubic-bezier(0.4, 0, 1, 1)), opacity 140ms var(--panel-drawer-collapse-easing, cubic-bezier(0.4, 0, 1, 1));')
    expect(normalizedStyles).not.toContain(
      '.favorite-library-drawer[data-collapsing="true"] {\n  transform: translateY(14px);\n  opacity: 0;\n  pointer-events: none;'
    )
  })

  it('keeps the favorite drawer resize hit area out of the header layout', () => {
    expectStyleSnippet('.favorite-library-drawer { position: relative; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr);')
    expectStyleSnippet('.favorite-library-drawer__resize-handle { position: absolute; top: 0; right: 0; left: 0; z-index: 2; height: 10px;')
    expectStyleSnippet(".favorite-library-drawer__resize-handle::after { content: ''; position: absolute; top: 0;")
  })

  it('keeps panel transition gaps on the assistant ice surface', () => {
    expectStyleSnippet(
      '.app-shell { position: relative; width: 100%; height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; background: var(--porcelain-ice);'
    )
    expectStyleSnippet(
      '.browser-stack { position: relative; min-height: 0; overflow: hidden; background: var(--porcelain-ice);'
    )
    expectStyleSnippet('.assistant-sidebar-shell { position: relative; width: var(--assistant-sidebar-width, clamp(320px, 24vw, 384px));')
  })

  it('keeps local data usage readable in a narrow sidebar', () => {
    expectStyleSnippet('.local-data-settings__section:first-child { padding-top: 0; border-top: 0; }')
    expectStyleSnippet('@media (max-width: 420px) { .local-data-settings__usage { grid-template-columns: minmax(0, 1fr); }')
  })

  it('keeps the migration scope equally sized and separates destructive data actions', () => {
    expectStyleSnippet('.local-data-settings__segmented { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); width: 100%;')
    expectStyleSnippet('.local-data-settings__danger-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; padding-top: 10px; border-top: 1px solid rgba(183, 62, 48, .38); }')
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
    expect(sidebarStyles).toContain('.assistant-sidebar-shell[data-collapsed="true"] {\n  width: 0;\n  min-width: 0;')
    expectStyleSnippet('.assistant-sidebar-shell[data-closing="true"] .assistant-sidebar { position: absolute; top: 0; right: 0; width: var(--assistant-sidebar-width, clamp(320px, 24vw, 384px));')
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

  it('keeps the sidebar visible while it translates out before releasing browser space', () => {
    expectStyleSnippet('.assistant-sidebar-shell[data-closing="true"] .assistant-sidebar { position: absolute; top: 0; right: 0; width: var(--assistant-sidebar-width, clamp(320px, 24vw, 384px)); transform: translateX(calc(100% + var(--panel-sidebar-collapse-offset, 14px))); transition: transform var(--panel-sidebar-collapse-duration, 220ms) var(--panel-sidebar-collapse-easing, cubic-bezier(0.4, 0, 1, 1)), border-color 160ms ease;')
    expect(normalizedStyles).not.toContain('.assistant-sidebar-shell[data-closing="true"] .assistant-sidebar { opacity: 0;')
    expectStyleSnippet('.assistant-sidebar-shell[data-closing="true"] { background: var(--porcelain-ice); }')
  })

  it('keeps the four assistant tabs equally spaced with horizontal labels', () => {
    expectStyleSnippet('.floating-assistant-workspace { position: relative; width: min(420px, 100vw);')
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

  it('keeps the global assistant status inside the chrome frame without an extra bottom rule', () => {
    expectStyleSnippet('.floating-assistant-global-status { min-height: 68px; display: grid; grid-template-rows: minmax(34px, auto) 34px; gap: 0; padding: 0; border-bottom: 0; background: rgba(247, 251, 255, 0.76);')
    expectStyleSnippet('.floating-assistant-global-status__feedback { position: relative; z-index: 3; margin: 0; min-width: 0; color: var(--porcelain-deep); font-size: 12px; font-weight: 700; line-height: 18px; background: rgba(247, 251, 255, 0.98);')
    expectStyleSnippet('.floating-assistant-global-status__feedback-message { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')
    expectStyleSnippet('.floating-assistant-global-status__feedback[data-expanded="true"] .floating-assistant-global-status__feedback-message { overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: anywhere;')
    expectStyleSnippet('.floating-assistant-global-status__feedback-chevron { display: block; width: 16px; height: 16px; margin: 0 auto; transition: transform 180ms ease-out;')
    expectStyleSnippet('.floating-assistant-global-status__feedback-toggle[aria-expanded="true"] .floating-assistant-global-status__feedback-chevron { transform: rotate(180deg);')
    expectStyleSnippet('.floating-assistant-global-status__menu { position: absolute; top: 100%; right: 0; left: 0; z-index: 5; max-height: min(320px, calc(100vh - 140px)); overflow: auto;')
    expectStyleSnippet('.floating-assistant-global-status__lights { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));')
    expectStyleSnippet('.floating-assistant-global-status__light { appearance: none; position: static; border: 0; background: transparent; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 4px;')
    expectStyleSnippet('.floating-assistant-global-status__light:hover, .floating-assistant-global-status__light:focus-visible { background: rgba(220, 238, 255, 0.72); outline: none;')
  })

  it('lets archive history controls wrap instead of overlapping in the assistant sidebar', () => {
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-actions { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-items: center;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-select { grid-column: 1 / -1;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-select-control { position: relative; flex: 0 0 32px; width: 32px;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-select-control select { appearance: none; width: 100%;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-select-control select { appearance: none; width: 100%; min-width: 0; min-height: 30px; color: transparent; text-indent: 100%;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-select-control option { color: var(--porcelain-deep); background: #ffffff;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-trigger { width: 32px; min-width: 32px; height: 32px;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__archive-history-button { width: 100%; min-width: 0;'
    )
  })

  it('lets DeepSeek archive actions wrap instead of squeezing buttons', () => {
    expectStyleSnippet(
      '.favorite-ledger-panel__deepseek-archive-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__deepseek-archive-actions { flex: 1 1 176px; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__deepseek-archive-actions > button, .favorite-ledger-panel__deepseek-archive-scope { flex: 0 0 auto;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__deepseek-archive-scope > button, .favorite-ledger-panel__deepseek-archive-heading button { white-space: nowrap;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__deepseek-archive-run-button { width: 104px; min-width: 104px;'
    )
    expectStyleSnippet(
      ".favorite-ledger-panel__deepseek-archive-run-button[data-action='cancel'] { border-color: rgba(155, 54, 66, 0.42);"
    )
  })

  it('keeps DeepSeek archive feedback full-width and readable', () => {
    expectStyleSnippet(
      '.favorite-ledger-panel__deepseek-feedback { width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 6px;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__deepseek-feedback-copy { min-width: 0; overflow-wrap: anywhere; white-space: normal;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__deepseek-feedback .favorite-ledger-panel__deepseek-archive-progress-track { width: 100%; box-sizing: border-box;'
    )
    expectStyleSnippet(
      '.favorite-ledger-panel__deepseek-archive-progress-copy { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; overflow: visible;'
    )
    expectStyleSnippet('.favorite-ledger-panel__deepseek-result-details { display: grid;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-result-details--organization { margin-top: 0; padding-top: 0; border-top: 0;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-result-details--organization {')
    expectStyleSnippet('max-height: min(42vh, 300px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #7ea8d8 rgb(226 238 255 / .58);')
    expectStyleSnippet('.favorite-ledger-panel button.favorite-ledger-panel__deepseek-result-toggle { display: inline-flex;')
    expectStyleSnippet('.favorite-ledger-panel button.favorite-ledger-panel__deepseek-result-toggle:hover:not(:disabled), .favorite-ledger-panel button.favorite-ledger-panel__deepseek-result-toggle:focus-visible:not(:disabled) { border-color: transparent; background: transparent;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__deepseek-result-trigger strong')
  })

  it('frames the assistant workspace chrome while keeping tab buttons defined', () => {
    expectStyleSnippet('.floating-assistant-chrome { position: relative; min-width: 0; display: grid; grid-template-rows: auto auto; border: 1px solid rgba(31, 99, 181, 0.28); border-radius: 8px; background: rgba(247, 251, 255, 0.72); box-shadow: 0 1px 3px rgba(7, 26, 51, 0.08); overflow: visible;')
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
    expect(normalizedStyles).not.toContain('data-workspace-side')
    expect(normalizedStyles).toContain('left: 50%;\n  bottom: calc(var(--floating-pet-size) + 10px);')
    expect(normalizedStyles).not.toContain('top: 1px;')
    expect(normalizedStyles).toContain('max-width: 270px;')
    expect(normalizedStyles).toContain('transform: translateX(var(--pet-bubble-offset-x, -50%));')
    expect(normalizedStyles).toContain('width: 270px;')
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
    expectStyleSnippet(
      '.palace-maid-pet__hover-shortcuts[data-assistant-shortcut="true"] { left: 34px;'
    )
    expect(normalizedStyles).not.toContain('left: 58px;\n  bottom: 2px;')
    expectStyleSnippet(
      '.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="1"] .palace-maid-pet__hover-shortcut:nth-child(1) { transform: translate(8px, 0);'
    )
    expectStyleSnippet('.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="2"] .palace-maid-pet__hover-shortcut:nth-child(1) { transform: translate(4px, 0);')
    expectStyleSnippet('.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="2"] .palace-maid-pet__hover-shortcut:nth-child(2) { transform: translate(4px, 0);')
    expectStyleSnippet('.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="3"] .palace-maid-pet__hover-shortcut:nth-child(1) { transform: translate(9px, 0);')
    expectStyleSnippet('.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="3"] .palace-maid-pet__hover-shortcut:nth-child(2) { transform: translate(0, 0);')
    expectStyleSnippet('.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="3"] .palace-maid-pet__hover-shortcut:nth-child(3) { transform: translate(9px, 0);')
    expectStyleSnippet('.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="4"] .palace-maid-pet__hover-shortcut:nth-child(1) { transform: translate(12px, 0);')
    expectStyleSnippet('.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="4"] .palace-maid-pet__hover-shortcut:nth-child(2) { transform: translate(2px, -1px);')
    expectStyleSnippet('.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="4"] .palace-maid-pet__hover-shortcut:nth-child(3) { transform: translate(0, 0);')
    expectStyleSnippet('.palace-maid-pet__hover-shortcuts[data-layout="fan"][data-count="4"] .palace-maid-pet__hover-shortcut:nth-child(4) { transform: translate(9px, 1px);')
    expect(normalizedStyles).not.toMatch(/data-count="[1-4]"[^}]+translate\([^,]+,\s*-\d{2,}px\)/)
    expectStyleSnippet(
      '.palace-maid-pet__hover-shortcuts[data-assistant-shortcut="true"] .palace-maid-pet__assistant-shortcut { position: absolute; left: 42px; bottom: 50px;'
    )
    expectStyleSnippet(
      '.palace-maid-pet__hover-shortcuts[data-layout="grid"] { left: 30px; bottom: 6px; grid-template-columns: repeat(2, 32px); gap: 5px;'
    )
    expectStyleSnippet(
      '.palace-maid-pet__hover-shortcuts[data-layout="grid"][data-assistant-shortcut="true"] { left: 34px; bottom: 16px;'
    )
    expectStyleSnippet(
      '.palace-maid-pet__hover-shortcuts[data-layout="grid"][data-assistant-shortcut="true"] .palace-maid-pet__assistant-shortcut { left: 74px; bottom: 18px;'
    )
    expect(normalizedStyles).toContain('.palace-maid-pet__assistant-shortcut')
    expect(normalizedStyles).not.toContain('left: 18px;\n  bottom: 50px;')
    expect(normalizedStyles).not.toContain('transform: translate(18px, -16px);')
    expectStyleSnippet('.palace-maid-pet__resize-step:active { transform: none;')
    expect(normalizedStyles).not.toContain('.palace-maid-pet__resize-handle')
    expect(normalizedStyles).not.toContain('cursor: nwse-resize;')
    expect(normalizedStyles).not.toContain('right: 7px;\n  bottom: 7px;')
    expect(normalizedStyles).not.toContain('.palace-maid-pet__bubble span {\n  -webkit-line-clamp: 2;')
    expectStyleSnippet('.palace-maid-pet__chat-compose { display: flex; gap: 5px; align-items: end;')
    expectStyleSnippet('.palace-maid-pet__chat-field { display: grid; gap: 3px; flex: 1 1 auto;')
    expectStyleSnippet('.palace-maid-pet__chat button[type="submit"] { flex: none; padding: 4px 7px;')
  })

  it('uses compact spacing for the review panel', () => {
    expect(normalizedStyles).toContain(
      '.memorial-panel__paper {\n  border: 0;'
    )
    expect(normalizedStyles).toContain('padding: 8px 8px 46px;\n  max-height: calc(100vh - 16px);')
    expectStyleSnippet(
      '.memorial-panel__paper { border: 0; position: relative;'
    )
    expectStyleSnippet('.memorial-panel__paper { padding: 8px 8px 46px;')
    expectStyleSnippet(
      '.memorial-panel__close { position: absolute; right: 8px; bottom: 8px;'
    )
    expect(normalizedStyles).toContain('display: grid;\n  gap: 8px;')
    expect(normalizedStyles).toContain('.memorial-panel__actions {\n  display: grid;\n  grid-template-columns: 1fr;')
    expect(normalizedStyles).toContain('.assistant-action-button {\n  min-height: 62px;')
    expectStyleSnippet(
      '.memorial-panel__action-card--with-setting { grid-template-columns: minmax(0, 1fr) 56px; gap: 0; align-items: stretch; border: 1px solid rgba(31, 99, 181, 0.22);'
    )
    expectStyleSnippet(
      '.memorial-panel__action-card--with-setting { grid-template-columns: minmax(0, 1fr) 56px; gap: 0; align-items: stretch; border: 1px solid rgba(31, 99, 181, 0.22); border-radius: var(--porcelain-radius-control); background: linear-gradient( 180deg, rgba(255, 254, 253, 0.99), rgba(247, 251, 255, 0.99) );'
    )
    expectStyleSnippet(
      '.memorial-panel__action-card--with-setting:hover, .memorial-panel__action-card--with-setting:focus-within { border-color: rgba(31, 99, 181, 0.5); background: linear-gradient( 180deg, rgba(255, 254, 253, 1), rgba(220, 238, 255, 1) ); box-shadow: 0 8px 16px rgba(31, 99, 181, 0.14); transform: translateY(-1px);'
    )
    expectStyleSnippet(
      '.memorial-panel__action-card--with-setting .assistant-action-button { border-radius: var(--porcelain-radius-control) var(--porcelain-radius-join) var(--porcelain-radius-join) var(--porcelain-radius-control);'
    )
    expectStyleSnippet(
      '.memorial-panel__action-card--with-setting .assistant-action-button { border-radius: var(--porcelain-radius-control) var(--porcelain-radius-join) var(--porcelain-radius-join) var(--porcelain-radius-control); border: 0; background: transparent;'
    )
    expectStyleSnippet(
      '.memorial-panel__action-card--with-setting .assistant-action-button:hover:not(:disabled), .memorial-panel__action-card--with-setting .assistant-action-button:focus-visible:not(:disabled) { background: transparent; box-shadow: none; transform: none;'
    )
    expectStyleSnippet(
      '.memorial-panel__action-setting { display: grid; grid-template-columns: minmax(0, 1fr); align-items: center; justify-self: stretch; min-width: 0; width: 56px; max-width: 56px;'
    )
    expectStyleSnippet(
      '.memorial-panel__action-setting select { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; min-height: 62px;'
    )
    expectStyleSnippet(
      '.memorial-panel__action-setting select { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; min-height: 62px; border: 0; border-left: 1px solid rgba(31, 99, 181, 0.22);'
    )
    expect(normalizedStyles).toContain(
      '.memorial-panel__action-setting select {\n  box-sizing: border-box;\n  width: 100%;\n  max-width: 100%;\n  min-width: 0;\n  min-height: 62px;\n  border: 0;\n  border-left: 1px solid rgba(31, 99, 181, 0.22);\n  border-radius: var(--porcelain-radius-join) var(--porcelain-radius-control)\n    var(--porcelain-radius-control) var(--porcelain-radius-join);\n  background: transparent;'
    )
    expectStyleSnippet(
      '.memorial-panel__action-setting select:hover, .memorial-panel__action-setting select:focus-visible { border-left-color: rgba(31, 99, 181, 0.5); background: transparent; box-shadow: none;'
    )
    expect(normalizedStyles).toContain('rgba(220, 238, 255, 0.98)')
    expect(normalizedStyles).toContain('rgba(220, 238, 255, 1)')
    expectStyleSnippet(
      '.assistant-action-button { min-height: 62px; display: grid; grid-template-columns: 58px minmax(0, 1fr); grid-template-areas: "mark label" "mark desc"; align-items: center; gap: 3px 8px; border-radius: 6px; text-align: left; background: linear-gradient( 180deg, rgba(255, 254, 253, 0.99), rgba(247, 251, 255, 0.99) );'
    )
    expect(normalizedStyles).toContain('padding: 0 15px 0 7px;\n  text-align: left;\n  text-align-last: left;')
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
    expect(normalizedStyles).not.toContain('.assistant-action-button .memorial-panel__action-setting')
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
      '.memorial-panel__meta { box-sizing: border-box; width: 100%; border: 1px solid rgba(31, 99, 181, 0.18); background: rgba(247, 251, 255, 0.62); padding: 8px;'
    )
    expectStyleSnippet(
      '.memorial-panel__actions, .memorial-panel__action-card, .memorial-panel__actions .assistant-action-button { width: 100%; box-sizing: border-box;'
    )
    expect(normalizedStyles).toContain('.assistant-action-button {\n  min-height: 62px;')
    expect(compactStyles).not.toContain('.memorial-panel__meta { height:')
    expect(compactStyles).not.toContain('.assistant-action-button { height:')
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
    expectStyleSnippet('.video-notes__source-transcription-status { margin: 0; color: inherit; font-size: 12px; line-height: inherit; font-weight: inherit; }')
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
    expectStyleSnippet('.assistant-action-button { min-height: 62px; display: grid; grid-template-columns: 58px minmax(0, 1fr);')
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));\n  gap: 4px;'
    )
    expect(normalizedStyles).toContain(
      '.video-notes__result-tabs button {\n  display: grid;\n  grid-template-rows: auto auto;\n  align-content: start;\n  gap: 2px;\n  height: 66px;\n  min-height: 66px;'
    )
    expectStyleSnippet('.video-notes__result-tabs button { display: grid; grid-template-rows: auto auto; align-content: start; gap: 2px; height: 66px; min-height: 66px; min-width: 0; box-sizing: border-box; padding: 6px 8px;')
    expectStyleSnippet('.video-notes__result-tabs small { display: -webkit-box; overflow: hidden; color: inherit; opacity: 0.78; line-height: 1.18; -webkit-box-orient: vertical; -webkit-line-clamp: 2; text-overflow: ellipsis;')
    expectStyleSnippet('.video-notes__queue-header { display: grid; gap: 4px;')
    expectStyleSnippet('.video-notes__queue-header--after-current { border-top: var(--bilimi-divider); padding-top: 6px;')
    expectStyleSnippet('.video-notes__queue-summary { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between;')
    expectStyleSnippet('.video-notes__queue-title { display: -webkit-box; overflow: hidden;')
    expectStyleSnippet('.video-notes__queue-selector { position: relative; display: inline-flex; flex: 0 0 auto; margin-left: auto; align-items: center;')
    expect(normalizedStyles).not.toContain('.video-notes__queue-history-toggle')
    expectStyleSnippet('.video-notes__queue-arrow { position: static; width: 6px; height: 6px; border-right: 1.5px solid rgba(31, 99, 181, 0.72); border-bottom: 1.5px solid rgba(31, 99, 181, 0.72); transform: rotate(45deg); pointer-events: none;')
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
    expectStyleSnippet('.video-note-archive__toolbar, .video-note-archive__list { box-sizing: border-box; width: calc(100% + (var(--porcelain-card-padding) * 2)); margin-inline: calc(var(--porcelain-card-padding) * -1); border-top: 1px dashed rgba(31, 99, 181, 0.2);')
    expectStyleSnippet('.video-notes__source dd { min-width: 0; overflow-wrap: anywhere;')
    expectStyleSnippet('.video-notes__summary-result { display: grid; gap: 8px; min-width: 0;')
    expectStyleSnippet('.video-notes__summary-result pre { max-width: 100%; overflow-x: hidden; white-space: pre-wrap; overflow-wrap: anywhere;')
    expectStyleSnippet('.video-notes__summary-section { display: grid; gap: 5px; min-width: 0; border-top: 1px dashed rgba(31, 99, 181, 0.18);')
    expectStyleSnippet('.video-notes__summary-section pre { max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; border: 0; background: transparent;')
    expectStyleSnippet('.video-notes__result-body { max-height: min(52vh, 520px); overflow: auto; border-top: 1px dashed rgba(31, 99, 181, 0.18); background: transparent;')
    expectStyleSnippet('.video-notes__result-body ol, .video-notes__result-body pre, .video-notes__result-body .video-notes__plain-text { max-height: none; overflow: visible; border-top: 0; padding-top: 0;')
    expectStyleSnippet('.video-note-archive__detail section { display: grid; gap: 6px; box-sizing: border-box; width: calc(100% + (var(--porcelain-card-padding) * 2)); margin-inline: calc(var(--porcelain-card-padding) * -1); border-top: var(--bilimi-divider);')
    expectStyleSnippet('.video-note-archive__result-panel .video-notes__result-body { min-height: 240px; max-height: none; overflow: auto; border-top: 0; padding-top: 0;')
    expectStyleSnippet('.video-notes__feedback { position: absolute; right: 0; bottom: 0; left: 0; z-index: 4; display: grid; gap: 2px; pointer-events: none;')
    expectStyleSnippet('.video-notes__feedback p { max-height: 3em; margin: 0; overflow: auto; border: 1px solid rgba(31, 99, 181, 0.22); background: rgba(247, 251, 255, 0.96);')
    expect(normalizedStyles).not.toContain('.video-notes__plain-text {\n  max-height: 160px;\n  overflow: auto;\n  border: 1px solid')
    expect(normalizedStyles).toContain('.video-notes textarea {\n  min-height: 60px;')
    expect(normalizedStyles).toContain(
      '.video-notes__memo textarea[readonly] {\n  min-height: 130px;'
    )
  })

  it('matches only the review title to the notes title hierarchy', () => {
    expectStyleSnippet('.memorial-panel__meta-eyebrow { color: var(--porcelain-text); font-size: 14px; font-weight: 700; line-height: 1.45;')
    expectStyleSnippet('.memorial-panel__meta-title { color: var(--porcelain-text); font-size: 16px; font-weight: 700; line-height: 1.3;')
    expectStyleSnippet('.memorial-panel__meta-detail { color: var(--porcelain-text); font-size: 12px; font-weight: inherit; line-height: 1.45;')
  })

  it('keeps assistant panel rows from stretching into tall empty blocks', () => {
    expect(normalizedStyles).toContain(
      '.memorial-panel__paper {\n  border: 0;'
    )
    expect(normalizedStyles).toContain('display: grid;\n  align-content: start;\n  gap: 6px;')
    expect(normalizedStyles).toContain(
      '.video-notes {\n  color: var(--porcelain-text);\n  display: grid;\n  align-content: start;\n  gap: 8px;'
    )
    expectStyleSnippet(
      '.video-notes__panel-actions { display: flex; min-width: 0; flex: 1 1 auto; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-left: auto;'
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
    expectStyleSnippet('.favorite-ledger-panel__sync-hint { color: #365b83; font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif; font-size: 13px; font-weight: 500; line-height: 1.62;')
    expectStyleSnippet('.favorite-ledger-panel__section-title { display: inline-flex; align-items: center; gap: 5px; min-width: 0;')
    expectStyleSnippet('.favorite-ledger-panel__chevron { width: 16px; height: 16px; flex: 0 0 16px; transition: transform 180ms ease-out;')
    expectStyleSnippet('.favorite-ledger-panel__help-toggle[aria-expanded="true"] .favorite-ledger-panel__chevron { transform: rotate(180deg);')
    expectStyleSnippet('.disclosure-arrow { display: inline-block; transition: transform 180ms ease-out;')
    expectStyleSnippet('.video-notes__copy-main[aria-expanded="true"] .disclosure-arrow, .video-note-archive__version-picker > button[aria-expanded="true"] .disclosure-arrow, .favorite-ledger-panel__deepseek-archive-scope > button[aria-expanded="true"] .disclosure-arrow, .favorite-ledger-panel__target-toggle[aria-expanded="true"] .disclosure-arrow { transform: rotate(180deg);')
    expectStyleSnippet('.video-notes__queue-selector[aria-expanded="true"] .video-notes__queue-arrow { transform: rotate(225deg);')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-trigger[aria-expanded="true"] .favorite-ledger-panel__archive-history-arrow { transform: translateY(-2px) rotate(225deg);')
    expectStyleSnippet('.memorial-panel__log > summary::before, .favorite-ledger-panel__deepseek-result-details > summary::before, .favorite-ledger-panel__scan-risk-summary > summary::before, .favorite-ledger-panel__scan-failure-details > summary::before { content: "";')
    expectStyleSnippet('.favorite-ledger-panel__sync-hint, .favorite-ledger-panel__guide-hint { overflow: hidden; transition: max-height 180ms ease-out, opacity 150ms ease-out, transform 180ms ease-out;')
    expectStyleSnippet('.favorite-ledger-panel__help-toggle { appearance: none; width: auto; min-width: 0; min-height: 28px; padding: 4px 2px; border: 0; background: transparent; box-shadow: none;')
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
    expectStyleSnippet('.favorite-ledger-panel__chip-item[data-drop-position="before"]::before { position: absolute; right: 3px; left: 3px; height: 2px; border-radius: 999px; background: #1f63b5; box-shadow: 0 0 0 1px rgba(220, 238, 255, 0.92); content: ""; top: -4px;')
    expect(normalizedStyles).not.toContain('[data-drop-position="after"]::after')
    expectStyleSnippet('.favorite-ledger-panel__chip-item[data-drop-position] > button:first-child, .favorite-ledger-panel__chip-item[data-drop-position] > .favorite-ledger-panel__chip-action { background: rgba(220, 238, 255, 0.72);')
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
    expectStyleSnippet('.favorite-ledger-panel__guide-title-row { display: grid; grid-template-columns: minmax(0, 1fr);')
    expectStyleSnippet('.favorite-ledger-panel__scan-metrics strong { min-width: 0; text-align: right; white-space: nowrap;')
    expectStyleSnippet('.favorite-ledger-panel__source-count { min-width: 0; text-align: right; white-space: nowrap;')
    expectStyleSnippet('.favorite-ledger-panel__source-header, .favorite-ledger-panel__source-row-content, .favorite-ledger-panel__source-row--bilimi { display: grid; grid-template-columns: 18px minmax(0, 1fr) 72px 110px;')
    expect(compactStyles).not.toContain('.favorite-ledger-panel__source-header--bilimi, .favorite-ledger-panel__source-row--bilimi { display: grid; grid-template-columns: minmax(0, 1fr) 52px;')
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
    expectStyleSnippet('.favorite-ledger-panel__guide-hint { margin: 0; color: #365b83; font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif; font-size: 13px; font-weight: 500; line-height: 1.62;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__guide-hint {\n  margin: 0;\n  border:')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics article { display: grid; grid-template-rows: 36px 26px;')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics span { min-height: 36px;')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics strong { align-self: start; padding-top: 3px; font-variant-numeric: tabular-nums;')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics[aria-label="原归档状态"] article { grid-template-rows: 60px 28px;')
    expectStyleSnippet('.favorite-ledger-panel__guide-metrics[aria-label="原归档状态"] span { min-height: 60px;')
    expectStyleSnippet('.favorite-ledger-panel__protected-summary { display: grid; grid-template-columns: minmax(0, 1fr); align-items: center;')
    expectStyleSnippet('.favorite-ledger-panel__whole-run-overview { display: grid; gap: 7px; min-width: 0; overflow: hidden;')
    expectStyleSnippet('.favorite-ledger-panel__whole-run-targets { display: grid; gap: 0; width: calc(100% + 16px); margin-inline: -8px; margin-bottom: -8px; max-height: 280px; overflow-x: hidden; overflow-y: auto;')
    expectStyleSnippet('border-top: 1px dashed rgba(31, 99, 181, 0.28);')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__whole-run-targets {\n  border-bottom: 1px solid rgba(31, 99, 181, 0.18);')
    expectStyleSnippet('.favorite-ledger-panel__whole-run-targets article { display: grid; gap: 5px; min-width: 0; border: 0; border-radius: 0; background: transparent; padding: 7px 8px;')
    expectStyleSnippet('.favorite-ledger-panel__whole-run-targets article:last-child { padding-bottom: 0; }')
    expectStyleSnippet('.favorite-ledger-panel__scan-warning { margin: 0; color: var(--porcelain-warn);')
    expectStyleSnippet('.favorite-ledger-panel__step-note { margin: 0; font-size: 12px; line-height: 1.45;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__step-note {\n  margin: 0;\n  color: var(--porcelain-muted);')
    expectStyleSnippet('.favorite-ledger-panel__step-divider { border: 0; border-top: 1px dashed rgba(31, 99, 181, 0.28);')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__scan-candidates')
    expectStyleSnippet('.favorite-ledger-panel__candidate-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;')
    expectStyleSnippet('.favorite-ledger-panel__candidates article, .favorite-ledger-panel__confirm { border: 1px solid rgba(31, 99, 181, 0.18);')
    expectStyleSnippet('.favorite-ledger-panel__candidates article { min-width: 0; min-height: 42px; padding: 6px 7px;')
    expectStyleSnippet('.favorite-ledger-panel__candidates label, .favorite-ledger-panel__preview label { display: grid; grid-template-columns: auto minmax(0, 1fr);')
    expectStyleSnippet('.favorite-ledger-panel__candidate-list > button { grid-column: 1 / -1; justify-self: end;')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__candidate-list--detailed')
    expect(normalizedStyles).not.toContain('favorite-ledger-panel__candidate-list--compact')
    expectStyleSnippet('.favorite-ledger-panel__preview-groups { display: grid; gap: 10px; max-height: min(62vh, 720px); overflow-y: auto;')
    expectStyleSnippet('.favorite-ledger-panel__preview-groups { display: grid; gap: 10px; max-height: min(62vh, 720px); overflow-y: auto; min-width: 0; border: 1px solid rgba(31, 99, 181, 0.22); border-radius: var(--porcelain-radius-surface);')
    expectStyleSnippet('.favorite-ledger-panel__archive-preview { --old-favorite-preview-card-height: 160px; display: grid; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__step-title-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__archive-preview [role="group"] {')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__archive-preview .favorite-ledger-panel__view-scope {\n  display: flex;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__archive-preview .favorite-ledger-panel__view-scope button[aria-pressed="true"] {')
    expectStyleSnippet('.favorite-ledger-panel__preview-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-items: start; min-width: 0; border: 1px solid rgba(31, 99, 181, 0.18); border-radius: var(--porcelain-radius-surface);')
    expectStyleSnippet('.favorite-ledger-panel__preview-row header { grid-column: 1 / -1; display: grid; gap: 7px; min-width: 0;')
    expectStyleSnippet('.favorite-ledger-panel__preview-header-actions { display: flex; align-items: center; justify-content: flex-start; gap: 6px; min-width: 0;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__preview-header-actions > button:last-child {')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__preview-row header {\n  grid-column: 1 / -1;\n  position: sticky;')
    expectStyleSnippet('.favorite-ledger-panel__preview-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__preview-heading strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')
    expectStyleSnippet('.favorite-ledger-panel__target-toggle { display: inline-flex; align-items: center; flex: 0 0 auto; white-space: nowrap;')
    expectStyleSnippet('.favorite-ledger-panel__preview-tools { display: grid; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__archive-tool-card { display: grid; gap: 8px;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-section--full { width: 100%; grid-column: 1 / -1;')
    expectStyleSnippet('.favorite-ledger-panel__archive-tool-divider { width: 100%; height: 0; margin: 2px 0 0; border-top: 1px dashed rgba(31, 99, 181, 0.48);')
    expectStyleSnippet('.favorite-ledger-panel__archive-tool-divider--full-width { grid-column: 1 / -1;')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-actions { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-select { grid-column: 1 / -1; display: flex; align-items: center;')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-select-control { position: relative; flex: 0 0 32px; width: 32px;')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-button { width: 100%; min-width: 0; min-height: 32px;')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-menu { position: fixed; z-index: 130; top: calc(100% + 4px); right: auto; left: auto;')
    expectStyleSnippet('width: min(360px, calc(100vw - 16px)); max-height: min(52vh, 360px); box-sizing: border-box; display: grid; gap: 2px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #7ea8d8 rgb(226 238 255 / .58); scrollbar-gutter: stable;')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-menu::-webkit-scrollbar { width: 8px; }')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-menu::-webkit-scrollbar-track { background: rgb(226 238 255 / .58); }')
    expectStyleSnippet('.favorite-ledger-panel__archive-history-menu::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: #7ea8d8; background-clip: padding-box; }')
    expectStyleSnippet('border: 1px solid #c9dcf5; border-radius: 8px; background: #ffffff;')
    expectStyleSnippet('.favorite-ledger-panel__target-menu { position: static; z-index: auto; display: grid; width: min(220px, calc(100vw - 40px)); max-height: 240px; box-sizing: border-box; overflow: auto; border: 1px solid #c9dcf5;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-actions { flex: 1 1 176px; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-scope > button { min-width: 84px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-scope-arrow { font-size: 10px; line-height: 1;')
    expectStyleSnippet('.favorite-ledger-panel__deepseek-archive-scope-menu { position: absolute; z-index: 10;')
    expectStyleSnippet('.favorite-ledger-panel__preview-videos { grid-column: 1 / -1; display: flex; align-items: stretch; gap: 18px; min-width: 0; overflow-x: auto;')
    expectStyleSnippet('padding: 0 12px 8px; scroll-padding-inline: 12px;')
    expectStyleSnippet('.favorite-ledger-panel__preview-videos article { flex: 0 0 calc(100% - 56px); min-width: 0; height: var(--old-favorite-preview-card-height); display: grid; grid-template-rows: minmax(0, 1fr) auto; content-visibility: auto; contain-intrinsic-size: auto var(--old-favorite-preview-card-height); scroll-snap-align: start;')
    expectStyleSnippet('.favorite-ledger-panel__preview-videos article + article { padding-left: 0;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__preview-videos article + article {\n  border-left: 1px dashed')
    expectStyleSnippet('.favorite-ledger-panel__preview-video { box-sizing: border-box; width: 100%; min-height: 0; display: grid; align-content: start;')
    expectStyleSnippet('border: 1px solid rgba(31, 99, 181, 0.22); border-radius: var(--porcelain-radius-surface); background: rgba(255, 255, 255, 0.74);')
    expectStyleSnippet('.favorite-ledger-panel__preview-videos article[data-selected="true"] .favorite-ledger-panel__preview-information { border-color: rgba(31, 99, 181, 0.44); background: rgba(220, 238, 255, 0.5);')
    expect(normalizedStyles).not.toContain('border-right-color: rgba(31, 99, 181, 0.58);')
    expectStyleSnippet('.favorite-ledger-panel__preview-row--pending .favorite-ledger-panel__preview-videos article { background: transparent;')
    expectStyleSnippet('.favorite-ledger-panel__preview-row--pending .favorite-ledger-panel__preview-video { border-color: rgba(31, 99, 181, 0.22); background: rgba(255, 255, 255, 0.74);')
    expectStyleSnippet('.favorite-ledger-panel__preview-video-meta { display: grid; gap: 3px; min-width: 0;')
    expectStyleSnippet('.favorite-ledger-panel__preview-video-meta small { min-width: 0; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')
    expectStyleSnippet('.favorite-ledger-panel__preview-controls { position: relative; display: flex; align-items: center;')
    expectStyleSnippet('.favorite-ledger-panel__target-menu { position: static; z-index: auto;')
    expect(normalizedStyles).not.toContain(".favorite-ledger-panel__preview-videos article[data-latest-change='true'] {\n  outline:")
    expectStyleSnippet('.favorite-ledger-panel__preview-delta-row { min-width: 0; min-height: 28px; display: flex; align-items: center; justify-content: flex-start; border-radius: var(--porcelain-radius-control);')
    expectStyleSnippet('border-left: 2px solid rgba(155, 54, 66, 0.68); background: rgba(255, 232, 235, 0.82); color: var(--porcelain-error);')
    expectStyleSnippet('text-align: left;')
    expectStyleSnippet('padding: 0 6px;')
    expectStyleSnippet('.favorite-ledger-panel__preview-delta { display: block; width: 100%; min-width: 0; overflow: hidden; color: var(--porcelain-error);')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__preview-delta-action')
    expectStyleSnippet('.favorite-ledger-panel__preview-row--pending { background: rgba(255, 255, 255, 0.56);')
    expectStyleSnippet('.favorite-ledger-panel button.favorite-ledger-panel__preview-video-title { display: block; width: 100%;')
    expectStyleSnippet('text-decoration: underline; text-underline-offset: 2px; cursor: pointer;')
    expectStyleSnippet('.favorite-ledger-panel__old-favorite-progress { display: grid; gap: 6px;')
    expectStyleSnippet('.favorite-ledger-panel__old-favorite-progress progress { width: 100%;')
    expectStyleSnippet('.favorite-ledger-panel__old-favorite-progress p { margin: 0;')
    expectStyleSnippet('.favorite-ledger-panel__old-favorite-progress > button, .favorite-ledger-panel__old-favorite-progress .favorite-ledger-panel__confirm-actions button { min-height: 44px;')
    expectStyleSnippet('.favorite-ledger-panel__scan-risk-summary { display: grid; gap: 6px;')
    expectStyleSnippet('.favorite-ledger-panel__scan-risk-summary p, .favorite-ledger-panel__scan-risk-summary ul { margin: 0;')
    expectStyleSnippet('.favorite-ledger-panel__scan-risk-summary summary, .favorite-ledger-panel__scan-failure-details summary { cursor: pointer;')
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
      '.assistant-settings__body { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; display: grid; align-content: start; gap: 32px;'
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
    expectStyleSnippet('.assistant-settings__group { display: grid; box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; gap: 12px;')
    expectStyleSnippet('.assistant-settings__group { display: grid; box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; gap: 12px; margin: 0; border: 1px solid rgba(31, 99, 181, 0.18); background: rgba(255, 255, 255, 0.62); padding: 10px;')
    expectStyleSnippet('.assistant-settings__group legend { color: var(--porcelain-text); font-size: 14px;')
    expectStyleSnippet('.assistant-settings > header button { min-height: 30px;')
    expectStyleSnippet('.assistant-settings__diagnostics-head { display: grid; grid-template-columns: minmax(0, 1fr) auto auto;')
    expect(normalizedStyles).toContain('.assistant-settings__group--deepseek')
    expectStyleSnippet('.assistant-settings__deepseek-switches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));')
    expectStyleSnippet('.assistant-settings__deepseek-switches label { display: inline-grid; grid-template-columns: auto minmax(0, 1fr);')
    expectStyleSnippet('.assistant-settings__deepseek-switches--nested { grid-template-columns: repeat(2, minmax(0, max-content));')
    expectStyleSnippet('.assistant-settings__deepseek-review-control { display: flex; align-items: center; flex-wrap: wrap;')
    expectStyleSnippet('.assistant-settings__deepseek-review-control { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-left: 0;')
    expect(normalizedStyles).not.toContain('.assistant-settings__deepseek-review-control { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; border-left:')
    expectStyleSnippet('.assistant-settings__deepseek-review-control select:disabled { opacity: 0.5; cursor: not-allowed;')
    expectStyleSnippet('.assistant-settings__group--deepseek > label:first-of-type { display: flex; padding-bottom: 8px; border-bottom: 1px dashed rgba(31, 99, 181, 0.22);')
    expect(normalizedStyles).not.toContain('.assistant-settings__deepseek-divider')
    expect(normalizedStyles).toContain('.assistant-settings__actions')
    expect(normalizedStyles).toContain(
      '.assistant-settings__group--deepseek .assistant-settings__actions'
    )
    expectStyleSnippet(
      '.assistant-settings__group--deepseek .assistant-settings__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));'
    )
    expectStyleSnippet(
      '.assistant-settings__group--deepseek .assistant-settings__actions button { font-size: 12px; white-space: nowrap;'
    )
    expect(normalizedStyles).toContain('.assistant-settings__actions button:active')
    expect(normalizedStyles).toContain('.assistant-settings__actions button:focus-visible')
    expectStyleSnippet('.assistant-settings button:hover:not(:disabled) { border-color: rgba(31, 99, 181, 0.5); background: rgba(220, 238, 255, 0.88); box-shadow: 0 5px 12px rgba(31, 99, 181, 0.12);')
    expect(normalizedStyles).toContain('.assistant-settings__deepseek-recommendation')
    expectStyleSnippet('.assistant-settings__deepseek-official-link { margin: 0; border-top: 1px dashed rgba(31, 99, 181, 0.22); padding-top: 10px; color: var(--porcelain-text); font: inherit;')
    expectStyleSnippet('.assistant-settings__deepseek-official-link a { color: var(--porcelain-primary); text-decoration: underline; text-underline-offset: 2px;')
    expect(normalizedStyles).not.toContain('.assistant-settings__group--deepseek > label:nth-of-type(2)')
    expectStyleSnippet('.assistant-settings__recommendation-divider { box-sizing: border-box; width: 100%; margin-inline: 0; border-top: 1px dashed rgba(31, 99, 181, 0.28); padding-inline: 0; padding-top: 4px;')
    expect(normalizedStyles).not.toContain('.assistant-settings__review-action-title')
    expectStyleSnippet('.assistant-settings .local-data-settings__heading { margin: 0; color: var(--porcelain-text); font-size: 12px; font-weight: 700; line-height: 1.45;')
    expectStyleSnippet('.local-data-settings__section p, .local-data-settings__section ul { margin: 0; color: var(--porcelain-text); font-size: 12px; line-height: 1.45;')
    expectStyleSnippet('.local-data-settings button { min-height: 28px; padding: 4px 8px;')
    expectStyleSnippet('color: var(--porcelain-text); cursor: pointer; font: inherit;')
    expectStyleSnippet('.local-data-settings button.local-data-settings__section-toggle { display: inline-flex; align-items: center; gap: 5px;')
    expectStyleSnippet('.local-data-settings__section-chevron { width: 12px; height: 12px; transition: transform 160ms ease; }')
    expectStyleSnippet('.local-data-settings__section-toggle[aria-expanded="false"] .local-data-settings__section-chevron { transform: rotate(-90deg); }')
    expectStyleSnippet(
      '.assistant-settings__copy-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;'
    )
    expectStyleSnippet('.assistant-settings__copy-row--inline { display: inline-flex; max-width: 100%; min-width: 0; flex-wrap: wrap; vertical-align: middle;')
    expectStyleSnippet(
      '.assistant-settings__copy-button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center;'
    )
    expectStyleSnippet(
      '.assistant-settings__copy-button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; min-width: 40px; height: 24px;'
    )
    expect(normalizedStyles).toContain('border-color: rgba(31, 99, 181, 0.3);')
    expect(normalizedStyles).toContain('background: var(--porcelain-surface);')
  })

  it('uses the amber alert treatment for unclassified archive guidance', () => {
    expectStyleSnippet('.favorite-ledger-panel__confirm-warning { margin: 0; padding: 8px 10px; border: 1px solid rgba(188, 126, 0, 0.42); border-radius: 8px; background: #fff7d6; color: #8a5700;')
    expect(normalizedStyles).not.toContain('.favorite-ledger-panel__confirm-warning { color: var(--porcelain-danger')
  })

  it('contains narrow settings content without a horizontal workspace scrollbar', () => {
    expectStyleSnippet('.assistant-settings__body { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto;')
    expectStyleSnippet('.assistant-settings__group { display: grid; box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%;')
    expectStyleSnippet('.assistant-settings__deepseek-recommendation { display: grid; min-width: 0; max-width: 100%; box-sizing: border-box;')
    expectStyleSnippet('.assistant-settings__copy-row--inline { display: inline-flex; max-width: 100%; min-width: 0; flex-wrap: wrap;')
    expectStyleSnippet('.assistant-settings__copy-row--inline > span { flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere;')
  })

  it('keeps archive strategy help text compact', () => {
    expectStyleSnippet('.assistant-settings__group--archive { gap: 6px;')
    expectStyleSnippet('.assistant-settings__group--archive p { margin: 0;')
  })

  it('themes the custom old-favorite batch size without crowding its radio control', () => {
    expectStyleSnippet('.assistant-settings__batch-size-field { display: grid; grid-template-columns: auto minmax(0, 1fr) auto;')
    expectStyleSnippet('.assistant-settings__batch-size-input { box-sizing: border-box; width: 88px; min-height: 32px; border: 1px solid rgba(31, 99, 181, 0.32);')
    expectStyleSnippet('.assistant-settings__batch-size-input:focus-visible { outline: 2px solid rgba(45, 134, 199, 0.32);')
  })

  it('keeps correction learning and keyword suggestion settings compact', () => {
    expectStyleSnippet('.assistant-settings__group--learning .assistant-settings__inline-options { padding-bottom: 8px; border-bottom: 1px dashed rgba(31, 99, 181, 0.22);')
    expectStyleSnippet('.assistant-settings__subsection--records { border-top: 1px dashed rgba(31, 99, 181, 0.22); padding-top: 10px;')
    expectStyleSnippet('.assistant-settings__record-track { display: flex; align-items: stretch; gap: 12px;')
    expectStyleSnippet('.assistant-settings__record-card { flex: 0 0 calc(100% - 52px);')
    expectStyleSnippet('.assistant-settings__option-help { min-width: 0; overflow: hidden; color: var(--porcelain-muted);')
    expectStyleSnippet('.assistant-settings__learning-head { display: grid; grid-template-columns: minmax(0, 1fr) auto;')
    expectStyleSnippet('.assistant-settings__learning-summary { min-width: 0; overflow: hidden;')
    expectStyleSnippet('.assistant-settings__keyword-item { display: grid; grid-template-columns: minmax(0, 1fr);')
    expectStyleSnippet('.assistant-settings__keyword-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;')
    expectStyleSnippet('.assistant-settings__keyword-restore { min-width: 44px; min-height: 24px;')
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

  it('shows a progress cursor only on the active backup button', () => {
    expectStyleSnippet(".favorite-ledger-panel .assistant-action-button[aria-busy='true'] { cursor: progress; opacity: 0.72;")
    expect(normalizedStyles).not.toContain(".favorite-ledger-panel[aria-busy='true']")
  })

  it('keeps sidebar help and status tooltips above content without using the sidebar body', () => {
    expectStyleSnippet('.favorite-ledger-panel__help-tooltip {\n  position: fixed;\n  z-index: 10001;')
    expectStyleSnippet('.floating-assistant-global-status__light-tooltip {\n  position: fixed;\n  z-index: 10001;')
    expectStyleSnippet('.floating-assistant-global-status__light-tooltip {\n  position: fixed;\n  z-index: 10001;\n  box-sizing: border-box;\n  width: min(360px, calc(100vw - 32px));')
    expectStyleSnippet('.favorite-ledger-panel__scan-enrichment-summary,\n.favorite-ledger-panel__scan-discovery {')
    expectStyleSnippet('.video-summary-menu__options { position: absolute; z-index: 110; top: calc(100% + 4px); left: 0; display: grid; min-width: 132px;')
  })
})


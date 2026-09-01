import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const installerSource = readFileSync(resolve(process.cwd(), 'electron/installer/installer.nsh'), 'utf8')

describe('NSIS finish page window controls', () => {
  it('defines a dedicated finish page with all caption controls enabled', () => {
    expect(installerSource).toContain('customFinishPage')
    expect(installerSource).toContain('WS_MINIMIZEBOX')
    expect(installerSource).toContain('WS_MAXIMIZEBOX')
    expect(installerSource).toContain('WS_THICKFRAME')
    expect(installerSource).toContain('WS_SYSMENU')
    expect(installerSource).toContain('SWP_FRAMECHANGED')
    expect(installerSource).toContain('GetSystemMenu')
    expect(installerSource).toContain('EnableMenuItem')
    expect(installerSource).toContain('user32::EnableWindow(i r0, i 1)')
    expect(installerSource).toContain("GetDlgItem $0 $HWNDPARENT 2\n  System::Call 'user32::EnableWindow(i r0, i 1)'")
    expect(installerSource).toContain('SC_CLOSE')
    expect(installerSource).toContain('SC_MAXIMIZE')
    expect(installerSource).toContain('SC_MINIMIZE')
    expect(installerSource).toContain('MUI_CUSTOMFUNCTION_ABORT')
    expect(installerSource).toContain('bilimiFinishAbort')
    expect(installerSource).toContain('bilimiFinishPageActive')
    expect(installerSource).toContain('GetAncestor')
    expect(installerSource).toContain('MUI_FINISHPAGE_CANCEL_ENABLED')
  })

  it('hides only the disabled finish-page back and cancel buttons', () => {
    expect(installerSource).toContain('GetDlgItem')
    expect(installerSource).toContain('ShowWindow')
    expect(installerSource).toContain('MUI_PAGE_FINISH')
    expect(installerSource).not.toContain('MUI_FINISHPAGE_NOREADME')
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const installerScript = readFileSync(
  join(process.cwd(), 'electron', 'installer', 'installer.nsh'),
  'utf8'
)

describe('NSIS installer directory normalization', () => {
  it('only defines install-page hooks for the installer build, not the uninstaller build', () => {
    expect(installerScript).toContain('!ifndef BUILD_UNINSTALLER')
    expect(installerScript).toContain('!endif')
  })

  it('normalizes the chosen directory after the directory page and before installation', () => {
    expect(installerScript).toContain('!macro customPageAfterChangeDir')
    expect(installerScript).toContain('Page custom bilimiNormalizeInstallDirectory')
    expect(installerScript).toContain('Function bilimiNormalizeInstallDirectory')
    expect(installerScript).toContain('Abort')
  })

  it('appends a bilimi subfolder for selected parent directories', () => {
    expect(installerScript).toContain('StrCpy $INSTDIR "$INSTDIR\\bilimi"')
  })

  it('appends bilimi to drive roots without adding a duplicate separator', () => {
    expect(installerScript).toContain('Call bilimiAppendInstallSubfolder')
    expect(installerScript).toContain('StrCmp $R1 3 maybeAppendToDriveRoot appendWithSeparator')
    expect(installerScript).toContain('StrCpy $INSTDIR "$INSTDIRbilimi"')
  })

  it('trims trailing slashes before appending the bilimi subfolder', () => {
    expect(installerScript).toContain('Call bilimiTrimTrailingInstallSeparators')
  })

  it('keeps drive roots valid when trimming trailing slashes', () => {
    expect(installerScript).toContain('StrCmp $R1 3 maybeDriveRoot checkLastCharacter')
    expect(installerScript).toContain('StrCmp $R2 ":" doneTrimming')
  })

  it('does not append bilimi twice when the selected directory already ends with bilimi', () => {
    expect(installerScript).toContain('StrCmp "$R0" "bilimi" done')
    expect(installerScript).toContain('StrCmp "$R0" "Bilimi" done')
  })
})

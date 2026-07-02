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

  it('normalizes the default directory before the directory page is shown', () => {
    expect(installerScript).toContain('!macro customInit')
    expect(installerScript).toContain('Call bilimiEnsureInstallSubfolder')
    expect(installerScript).toContain('!macroend')
  })

  it('uses a custom directory page that displays the normalized target folder', () => {
    expect(installerScript).toContain('!macro customPageAfterChangeDir')
    expect(installerScript).toContain('Page custom bilimiDirectoryPageCreate bilimiDirectoryPageLeave')
    expect(installerScript).toContain('Function bilimiDirectoryPageCreate')
    expect(installerScript).toContain('Function bilimiDirectoryPageLeave')
  })

  it('loads dialog helpers without relying on MUI macros before MUI2 is included', () => {
    expect(installerScript).toContain('!include nsDialogs.nsh')
    expect(installerScript).not.toContain('MUI_HEADER_TEXT')
  })

  it('normalizes the directory input immediately after browsing for a parent folder', () => {
    expect(installerScript).toContain('Function bilimiBrowseInstallDirectory')
    expect(installerScript).toContain('nsDialogs::SelectFolderDialog')
    expect(installerScript).toContain('Call bilimiSetInstallDirectoryText')
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

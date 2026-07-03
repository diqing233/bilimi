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

describe('NSIS uninstaller user data removal option', () => {
  it('adds a pre-uninstall page with an unchecked user data removal choice', () => {
    expect(installerScript).toContain('!macro customUnWelcomePage')
    expect(installerScript).toContain('UninstPage custom un.bilimiUserDataPageCreate un.bilimiUserDataPageLeave')
    expect(installerScript).toContain('Var bilimiDeleteUserData')
    expect(installerScript).toContain('StrCpy $bilimiDeleteUserData "0"')
    expect(installerScript).not.toContain('SendMessage $bilimiDeleteUserDataCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0')
  })

  it('explains which user data will be removed before uninstalling', () => {
    expect(installerScript).toContain('同时删除 bilimi 用户数据')
    expect(installerScript).toContain('登录状态和浏览器会话')
    expect(installerScript).toContain('bilimi 设置、启动权限引导状态')
    expect(installerScript).toContain('视频笔记、本地缓存、诊断缓存')
    expect(installerScript).toContain('已保存的 API Key 等本机配置')
  })

  it('removes the current user AppData folder only when the option is checked', () => {
    expect(installerScript).toContain('${If} $bilimiDeleteUserData == "1"')
    expect(installerScript).toContain('${If} $installMode == "all"')
    expect(installerScript).toContain('SetShellVarContext current')
    expect(installerScript).toContain('RMDir /r "$APPDATA\\bilimi"')
    expect(installerScript).toContain('SetShellVarContext all')
  })
})

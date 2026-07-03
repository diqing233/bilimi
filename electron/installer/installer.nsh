!include FileFunc.nsh
!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var bilimiInstallDirectoryDialog
Var bilimiInstallDirectoryText

!macro customInit
  Call bilimiEnsureInstallSubfolder
!macroend

!macro customPageAfterChangeDir
  Page custom bilimiDirectoryPageCreate bilimiDirectoryPageLeave
!macroend

Function bilimiDirectoryPageCreate
  Call bilimiEnsureInstallSubfolder

  nsDialogs::Create 1018
  Pop $bilimiInstallDirectoryDialog

  ${If} $bilimiInstallDirectoryDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 34u "Setup 将安装 bilimi 在下列文件夹。要安装到不同文件夹，单击 [浏览(B)...] 并选择其他的文件夹。单击 [下一步(N)] 继续。"
  Pop $R0

  ${NSD_CreateGroupBox} 0 74u 100% 48u "目标文件夹"
  Pop $R0

  ${NSD_CreateText} 20u 92u 70% 13u "$INSTDIR"
  Pop $bilimiInstallDirectoryText

  ${NSD_CreateButton} 78% 90u 20% 16u "浏览(B)..."
  Pop $R0
  ${NSD_OnClick} $R0 bilimiBrowseInstallDirectory

  nsDialogs::Show
FunctionEnd

Function bilimiDirectoryPageLeave
  Call bilimiReadInstallDirectoryText
  Call bilimiEnsureInstallSubfolder
  Call bilimiSetInstallDirectoryText
FunctionEnd

Function bilimiBrowseInstallDirectory
  nsDialogs::SelectFolderDialog "选择 bilimi 要安装的文件夹。" "$INSTDIR"
  Pop $R0

  ${If} $R0 != error
  ${AndIf} $R0 != ""
    StrCpy $INSTDIR "$R0"
    Call bilimiEnsureInstallSubfolder
    Call bilimiSetInstallDirectoryText
  ${EndIf}
FunctionEnd

Function bilimiReadInstallDirectoryText
  ${NSD_GetText} $bilimiInstallDirectoryText $INSTDIR
FunctionEnd

Function bilimiSetInstallDirectoryText
  ${NSD_SetText} $bilimiInstallDirectoryText "$INSTDIR"
FunctionEnd

Function bilimiEnsureInstallSubfolder
  Push $R0

  Call bilimiTrimTrailingInstallSeparators
  ${GetFileName} "$INSTDIR" $R0
  StrCmp "$R0" "bilimi" done
  StrCmp "$R0" "Bilimi" done

  Call bilimiAppendInstallSubfolder

done:
  Pop $R0
FunctionEnd

Function bilimiAppendInstallSubfolder
  Push $R1
  Push $R2

  StrLen $R1 "$INSTDIR"
  StrCmp $R1 3 maybeAppendToDriveRoot appendWithSeparator

maybeAppendToDriveRoot:
  StrCpy $R2 "$INSTDIR" 1 1
  StrCmp $R2 ":" appendToDriveRoot appendWithSeparator

appendToDriveRoot:
  StrCpy $INSTDIR "$INSTDIRbilimi"
  Goto doneAppending

appendWithSeparator:
  StrCpy $INSTDIR "$INSTDIR\bilimi"

doneAppending:
  Pop $R2
  Pop $R1
FunctionEnd

Function bilimiTrimTrailingInstallSeparators
  Push $R0
  Push $R1
  Push $R2

trimNext:
  StrLen $R1 "$INSTDIR"
  IntCmp $R1 0 doneTrimming
  StrCmp $R1 3 maybeDriveRoot checkLastCharacter

maybeDriveRoot:
  StrCpy $R2 "$INSTDIR" 1 1
  StrCmp $R2 ":" doneTrimming

checkLastCharacter:
  IntOp $R0 $R1 - 1
  StrCpy $R2 "$INSTDIR" 1 $R0
  StrCmp $R2 "\" trimLast
  StrCmp $R2 "/" trimLast doneTrimming

trimLast:
  StrCpy $INSTDIR "$INSTDIR" $R0
  Goto trimNext

doneTrimming:
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
Var bilimiDeleteUserData
Var bilimiDeleteUserDataCheckbox
Var bilimiUserDataDialog

!macro customUnWelcomePage
  UninstPage custom un.bilimiUserDataPageCreate un.bilimiUserDataPageLeave
!macroend

!macro customUnInstall
  ${If} $bilimiDeleteUserData == "1"
    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}
    DetailPrint "Removing bilimi user data from $APPDATA\bilimi"
    RMDir /r "$APPDATA\bilimi"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend

Function un.bilimiUserDataPageCreate
  StrCpy $bilimiDeleteUserData "0"

  nsDialogs::Create 1018
  Pop $bilimiUserDataDialog

  ${If} $bilimiUserDataDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "卸载 bilimi 时，可以选择是否同时删除保存在本机当前 Windows 用户下的数据。"
  Pop $R0

  ${NSD_CreateCheckbox} 0 34u 100% 12u "同时删除 bilimi 用户数据"
  Pop $bilimiDeleteUserDataCheckbox

  ${NSD_CreateLabel} 12u 54u 96% 58u "会删除：登录状态和浏览器会话、bilimi 设置、启动权限引导状态、B 站收藏夹/分类相关缓存、视频笔记、本地缓存、诊断缓存、已保存的 API Key 等本机配置。"
  Pop $R0

  ${NSD_CreateLabel} 12u 116u 96% 24u "不勾选则只卸载程序本体，之后重装会继续沿用原来的登录状态、设置和缓存。"
  Pop $R0

  nsDialogs::Show
FunctionEnd

Function un.bilimiUserDataPageLeave
  ${NSD_GetState} $bilimiDeleteUserDataCheckbox $bilimiDeleteUserData
FunctionEnd
!endif

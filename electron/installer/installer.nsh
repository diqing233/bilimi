!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
!macro customPageAfterChangeDir
  Page custom bilimiNormalizeInstallDirectory
!macroend

Function bilimiNormalizeInstallDirectory
  Call bilimiEnsureInstallSubfolder
  Abort
FunctionEnd

Function bilimiEnsureInstallSubfolder
  Push $R0

  ${GetFileName} "$INSTDIR" $R0
  StrCmp "$R0" "bilimi" done
  StrCmp "$R0" "Bilimi" done

  StrCpy $INSTDIR "$INSTDIR\bilimi"

done:
  Pop $R0
FunctionEnd
!endif

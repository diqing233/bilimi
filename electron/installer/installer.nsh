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

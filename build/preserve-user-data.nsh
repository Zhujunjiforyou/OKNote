!include "LogicLib.nsh"
!include "FileFunc.nsh"

; The old uninstaller removes its whole install directory. Keep a persistent
; copy OUTSIDE it before invoking that uninstaller, including .bak/Local State.
!ifndef BUILD_UNINSTALLER
Var oknoteUserBackup
Var oknoteMachineBackup
Var oknoteTargetBackup

Function OknotePreserveUserData
  Exch $R0
  Push $R1
  Push $R2
  StrCpy $R2 ""
  ${If} $R0 != ""
  ${AndIf} ${FileExists} "$R0\user-data\*.*"
    ${GetParent} "$R0" $R1
    ClearErrors
    GetTempFileName $R2 "$R1"
    ${IfNot} ${Errors}
      Delete "$R2"
      CreateDirectory "$R2"
      CopyFiles /SILENT "$R0\user-data" "$R2"
    ${EndIf}
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Cannot preserve old user-data. Installation stopped; original data has not been removed." /SD IDOK
      SetErrorLevel 3
      Quit
    ${EndIf}
    DetailPrint "Old user-data preserved at $R2\user-data"
  ${EndIf}
  StrCpy $R0 $R2
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

Function OknoteRestoreUserData
  Exch $R0
  ${If} $R0 != ""
    ; A destination with its own user-data always wins. The other original
    ; remains available in the external backup, never overwritten or deleted.
    ${IfNot} ${FileExists} "$INSTDIR\user-data\*.*"
      ClearErrors
      CopyFiles /SILENT "$R0\user-data" "$INSTDIR"
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONSTOP "Unable to restore old user-data. Your complete original copy is at $R0\user-data. Restore it before starting OKNote." /SD IDOK
        SetErrorLevel 3
        Quit
      ${EndIf}
    ${Else}
      DetailPrint "Existing user-data kept. Additional old copy: $R0\user-data"
    ${EndIf}
  ${EndIf}
  Pop $R0
FunctionEnd

!macro customCheckAppRunning
  ; Preserve the builder's standard process check/close behavior.
  ; When the destination changes, check the OLD executable before copying.
  Push $INSTDIR
  ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 != ""
    StrCpy $INSTDIR $R0
  ${EndIf}
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  Pop $INSTDIR
  Push $R0
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  Push $R0
  Call OknotePreserveUserData
  Pop $oknoteUserBackup
  ${If} $installMode == "all"
    ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    Push $R0
    Call OknotePreserveUserData
    Pop $oknoteMachineBackup
  ${EndIf}
  ; Covers a chosen directory with legacy data but no uninstall registration.
  Push "$INSTDIR"
  Call OknotePreserveUserData
  Pop $oknoteTargetBackup
  Pop $R0
!macroend

; The default builder skips these declarations when a custom check exists.
!ifndef OKNOTE_INSTALLER_TEST
  !include "getProcessInfo.nsh"
  Var pid
!endif

!macro customInstall
  Push "$oknoteTargetBackup"
  Call OknoteRestoreUserData
  Push "$oknoteUserBackup"
  Call OknoteRestoreUserData
  Push "$oknoteMachineBackup"
  Call OknoteRestoreUserData
!macroend
!endif

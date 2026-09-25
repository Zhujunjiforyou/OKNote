Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${TEST_ROOT}\preserve-test.exe"
!define OKNOTE_INSTALLER_TEST
!define INSTALL_REGISTRY_KEY "Software\OKNote-Isolated-Installer-Test-${TEST_ID}"
Var installMode
!macro IS_POWERSHELL_AVAILABLE
!macroend
!macro _CHECK_APP_RUNNING
  !ifdef TEST_RUNNING_APP_STACK
    ; electron-builder's KILL_PROCESS can leave its saved $0 on the NSIS
    ; data stack after nsExec. The target path must survive this dependency.
    Push "0"
  !endif
!macroend
!include "${SOURCE_ROOT}\build\preserve-user-data.nsh"

Section
  StrCpy $installMode "CurrentUser"
  StrCpy $INSTDIR "${TEST_ROOT}\new-install"
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "${TEST_ROOT}\old-install"
  !insertmacro customCheckAppRunning
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  ${If} $INSTDIR != "${TEST_ROOT}\new-install"
    SetErrorLevel 44
    Quit
  ${EndIf}
  ; Simulate the old uninstaller's full directory removal. TEST_ROOT is a
  ; unique, validated, test-owned temp directory supplied by the driver.
  RMDir /r "${TEST_ROOT}\old-install"
  CreateDirectory "$INSTDIR"
  !insertmacro customInstall
SectionEnd

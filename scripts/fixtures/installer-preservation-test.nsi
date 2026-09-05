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
!macroend
!include "${SOURCE_ROOT}\build\preserve-user-data.nsh"

Section
  StrCpy $installMode "CurrentUser"
  StrCpy $INSTDIR "${TEST_ROOT}\new-install"
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "${TEST_ROOT}\old-install"
  !insertmacro customCheckAppRunning
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  ; Simulate the old uninstaller's full directory removal. TEST_ROOT is a
  ; unique, validated, test-owned temp directory supplied by the driver.
  RMDir /r "${TEST_ROOT}\old-install"
  CreateDirectory "$INSTDIR"
  !insertmacro customInstall
SectionEnd

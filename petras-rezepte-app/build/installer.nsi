; Petras Rezepte App – Windows-Installer (NSIS 3, Unicode)
; Installation ohne Administratorrechte in %LOCALAPPDATA%\Programs\Petras Rezepte App
; Daten (Rezepte, Sicherungen) liegen getrennt in %APPDATA%\Petras Rezepte App
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!define APPNAME "Petras Rezepte App"
!define COMPANY "Patrick S."
!define EXE "PetrasRezepteApp.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PetrasRezepteApp"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\PetrasRezepteApp" "InstallDir"
BrandingText "${APPNAME} ${VERSION} · © ${COMPANY}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "LegalCopyright" "© ${COMPANY}"
VIAddVersionKey "FileDescription" "${APPNAME} – Installation"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!include "MUI2.nsh"
!define MUI_ICON "${APPDIR}\app.ico"
!define MUI_UNICON "${APPDIR}\app.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Willkommen bei der ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "Mit der ${APPNAME} übernimmst du Rezepte aus dem Zaubertopf Club, aus PDFs oder Webseiten für deinen Thermomix TM6 und bringst sie Schritt für Schritt in Cookidoo.$\r$\n$\r$\nDie App läuft in Google Chrome. Alle Rezepte bleiben auf diesem PC.$\r$\n$\r$\nKlicke auf „Weiter“."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "${APPNAME} jetzt starten"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\LIESMICH.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Kurzanleitung anzeigen"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${APPDIR}\LIZENZ.txt"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"

Function StopRunningApp
  ; Laufende App vor Update/Deinstallation beenden (nur eigene Prozesse des Benutzers)
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Pop $0
  Sleep 500
FunctionEnd

Function un.StopRunningApp
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Pop $0
  Sleep 500
FunctionEnd

Section "Programm" SecMain
  SectionIn RO
  Call StopRunningApp
  SetOutPath "$INSTDIR"
  File "${APPDIR}\${EXE}"
  File "${APPDIR}\app.ico"
  File "${APPDIR}\LIZENZ.txt"
  File "${APPDIR}\LIZENZEN.txt"
  File "${APPDIR}\LIESMICH.txt"
  File "${APPDIR}\SYNC-ANLEITUNG.txt"

  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\app.ico" 0 SW_SHOWNORMAL "" "Rezepte für den Thermomix verwalten"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\app.ico" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Kurzanleitung.lnk" "$INSTDIR\LIESMICH.txt"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Synchronisierung einrichten.lnk" "$INSTDIR\SYNC-ANLEITUNG.txt"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME} deinstallieren.lnk" "$INSTDIR\Deinstallieren.exe"

  WriteUninstaller "$INSTDIR\Deinstallieren.exe"
  WriteRegStr HKCU "Software\PetrasRezepteApp" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Deinstallieren.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Deinstallieren.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" 95000
SectionEnd

Section "Uninstall"
  Call un.StopRunningApp
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\app.ico"
  Delete "$INSTDIR\LIZENZ.txt"
  Delete "$INSTDIR\LIZENZEN.txt"
  Delete "$INSTDIR\LIESMICH.txt"
  Delete "$INSTDIR\SYNC-ANLEITUNG.txt"
  Delete "$INSTDIR\Deinstallieren.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\PetrasRezepteApp"
  ; Rezepte standardmäßig BEHALTEN (Schutz vor Datenverlust); nur auf ausdrücklichen Wunsch löschen
  IfSilent keepdata
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Sollen auch alle gespeicherten Rezepte und Sicherungen gelöscht werden?$\r$\n$\r$\n(Ordner: $APPDATA\${APPNAME})$\r$\n$\r$\nWähle „Nein“, um sie für eine spätere Neuinstallation zu behalten." IDNO keepdata
  RMDir /r "$APPDATA\${APPNAME}"
  keepdata:
SectionEnd

; Uninstalling must not leave a startup entry pointing at a removed program.
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Download Organizer"
!macroend

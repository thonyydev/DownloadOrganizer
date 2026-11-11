; Uninstalling must not leave a startup entry or a File Explorer menu entry pointing at a removed program.
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Download Organizer"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\DownloadOrganizer"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\DownloadOrganizer"
!macroend

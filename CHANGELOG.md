# Changelog

## 0.1.2 — 2026-11-04

- Add custom rules: send files to your own folders by name, with patterns such as `*.stl` or `invoice*.pdf`. The first matching rule decides, even if the file's category is turned off. A short tutorial explains them the first time, and you can reopen it from Settings.
- Review the preview more easily: conflicts come first, the other files are grouped by destination folder, and each row shows a short destination. You can still show full paths.
- Leave empty files where they are, so an empty file that a browser creates when a download starts isn't moved before the download finishes.
- Leave a file alone when it's already in its category folder, instead of offering to rename it.
- Show save errors in the save bar, which stays in view while you scroll Settings.
- Make result dialogs smaller and category colors easier to tell apart.
- Don't install an update if you turned updates off while it was downloading.
- Reword stiff text in Portuguese, Spanish, French and Italian.

Known limits:

- The installer isn't code-signed yet, so Windows SmartScreen may show a warning.

## 0.1.1 — 2026-11-02

- Choose which files to organize in the preview.
- Rename conflicting files instead of leaving them behind. Existing files are still never overwritten.
- Organize to another drive. Files are copied, checked and only then removed from the source.
- With automatic organization on, closing the window keeps the app monitoring from the system tray. Use the tray icon to reopen or quit it.
- Optionally start with Windows, in the tray when automatic organization is on.
- Update automatically from GitHub Releases, with signature checks. You can turn this off in Settings. Versions before this one must install the update by hand once.
- Get notifications about automatic organization and monitoring problems. You can turn them off in Settings.

Known limits:

- The installer isn't code-signed yet, so Windows SmartScreen may show a warning.

## 0.1.0 — 2026-11-01 (first public beta)

First public release, for Windows 11.

- Organize the top level of a folder into categories by file type, after reviewing a preview.
- See every destination, conflict and skipped file before anything moves. Existing files are never overwritten.
- Undo past operations from the history when the files are unchanged and it is safe to do so.
- Optionally organize new files automatically while the app is open.
- Preview images, audio and video without changing them.
- Use the app in English, Portuguese, Spanish, French or Italian, following the Windows language by default.
- Choose dark or light theme and optional sound effects.

Known limits:

- The destination must be on the same volume as the source folder.
- The installer isn't code-signed yet, so Windows SmartScreen may show a warning.
- There's no automatic update. Install a new version over the old one.

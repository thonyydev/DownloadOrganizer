# Changelog

## 0.2.0 — 2026-11-13

- See your statistics on a new page: files organized, space moved, when you organize most and the largest files, for the last 7 days, 30 days, 12 months or all time. Every chart has a table with its values.
- Share a card with your totals as an image. It shows no file names or paths.
- Organize any folder from File Explorer. Right-click the folder, or the empty space inside it, and choose **Organize with Download Organizer**. The folder is organized in place, into category folders inside it, after the usual preview. You can turn this off in Settings.
- On the Files page, pick files and send them to the Recycle Bin after a confirmation. Windows can restore them from there.
- Sort files by name, date or size, see how many files each category has, and filter the conflicts. **Never organize this file** adds a rule that keeps a file where it is.
- After organizing, undo right away or open the destination folder. The review before organizing can also group files by destination folder.
- Search the history for a file by name, and show a moved file in its folder. New operations appear in the history on their own.
- Recognize more file types in each category, from 83 to 175, including camera RAW photos, e-books and disk images. Files already in Other stay there.
- Settings has a tab for each section. The new About tab links to the website and to forms for ideas and bug reports, with your app and Windows versions already filled in.
- Check for updates from Settings, even with automatic updates turned off.
- A new look for the sidebar and pages. Ctrl+1 to Ctrl+5 switch pages, and Ctrl+S saves the settings.
- A click on the "files organized" notification opens the history.
- The "preferences saved" notice now appears in the language you just chose.

Known limits:

- The installer isn't code-signed yet, so Windows SmartScreen may show a warning.
- On Windows 11, the File Explorer entry is under **Show more options**.

## 0.1.3 — 2026-11-06

- Organize several source folders into one destination, such as Downloads and Desktop. With more than one, each file in the preview shows its source folder. If two of them have a file with the same name, the first one goes and the other is kept as a conflict, which you can rename.
- Set a custom rule to keep the files it fits where they are, such as `*.torrent`.
- In the preview, files that won't move say "Stays where it is" instead of showing a folder.
- Leave files that are only in the cloud, such as OneDrive online-only files, where they are. The app never downloads them to organize, undo or preview them.
- Get a short guide the first time you open the app, and a summary of what's new after an update.
- Undo no longer ends with an error when an extra source folder is unplugged. A file that came from it stays organized until the folder is back, and undoing again brings it back.

Known limits:

- The installer isn't code-signed yet, so Windows SmartScreen may show a warning.
- Online-only files are recognized by the marks Windows puts on them. This hasn't been tested with OneDrive itself yet.

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

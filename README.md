![Download Organizer](.github/assets/banner.png)

# Download Organizer

**Keep your downloads organized, effortlessly.**

Download Organizer is a lightweight desktop app that helps you keep your Downloads folder clean, organized, and easy to navigate.

Sort files into categories, preview changes before applying them, and undo previous actions — all from a simple, intuitive interface.

[![CI](https://github.com/thonyydev/DownloadOrganizer/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/thonyydev/DownloadOrganizer/actions/workflows/ci.yml)
![Windows](https://img.shields.io/badge/Windows-11-0078D4?logo=windows11&logoColor=white)
![Status](https://img.shields.io/badge/Status-Beta-orange)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **Automatic Organization** — Automatically sort new downloads into folders based on file type.
- **Smart Categories** — Keep images, videos, documents, archives, and other files organized.
- **Preview Before Organizing** — See exactly where your files will go before making changes.
- **Undo Actions** — Restore previously moved files when supported and safe.
- **Activity History** — Keep track of organized files and previous operations.
- **Custom Folders** — Choose which folders to organize and where files should go.
- **Safe File Handling** — Detect conflicts and avoid overwriting existing files.
- **English, Portuguese, Spanish, French and Italian** — The app and new category folders follow your Windows language, or the one you choose in Settings. Existing files are not moved.
- **Privacy First** — Everything runs locally, with no accounts or cloud uploads.

## How It Works

1. **Choose a folder** — Select the folder you want to organize.
2. **Set your preferences** — Choose your destination and file categories.
3. **Preview changes** — Review the files and their destinations.
4. **Organize** — Confirm and let Download Organizer handle the rest.

You can also enable automatic organization to sort new downloads while the app is running.

## Download

Get the installer from the [Releases page](https://github.com/thonyydev/DownloadOrganizer/releases). Download Organizer is in beta and supports Windows 11.

The installer isn't code-signed yet, so Windows SmartScreen may warn you when you run it. Each release lists a SHA-256 hash you can check before installing.

**To update,** install the new version over the old one. Your history and settings are kept.

**To uninstall,** use Windows Settings. Your organized files are never touched. Settings and history stay in `%APPDATA%\com.thonyy.download-organizer` unless you remove them.

## Good to Know

- Only files at the top level of the source folder are organized, not subfolders.
- The destination must be on the same volume as the source.
- Files with a name that already exists at the destination are skipped, never overwritten.
- Automatic organization is off by default. It only runs while the app is open, handles new files, and waits until a file has gone 10 seconds without writes.
- Temporary files and downloads still being written are skipped, but no check can catch every case. Use the preview if you're unsure.
- Undo restores a file only if it hasn't changed since it was moved.

## Privacy

Download Organizer has no account, telemetry or cloud service. Its local database stores file paths, sizes, dates and content hashes so that it can show your history and undo safely. When reporting a problem, remove personal file names and paths, and don't attach the database.

## Feedback & Suggestions

Have an idea or found a bug?

Feel free to [open an issue](https://github.com/thonyydev/DownloadOrganizer/issues). Feedback and suggestions are always welcome.

## Building from Source

You need [Node.js](https://nodejs.org), [Rust](https://rustup.rs) and the [Tauri prerequisites for Windows](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run tauri dev
npm run tauri build
```

## License

[MIT](LICENSE). The Download Organizer name and logo aren't covered by this license. Third-party notices are in [`public/`](public).

---

Made with care by [Thonyy](https://github.com/thonyydev).

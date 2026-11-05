# Contributing

Thanks for helping with Download Organizer. Bug reports, ideas, translations and code are all welcome.

## Before you start

- For a bug or an idea, [open an issue](https://github.com/thonyydev/DownloadOrganizer/issues) first, using its template. Remove personal file names and paths, and don't attach the app's database.
- For a larger change, describe it in an issue before writing code, so we can agree on the approach.

## Setup

The app builds only on Windows. You need [Node.js](https://nodejs.org), [Rust](https://rustup.rs) and the [Tauri prerequisites for Windows](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run tauri dev
```

`npm run dev` runs only the frontend in a browser. It can't reach your files, so native calls fail there.

A development build uses the same settings and history as an installed copy. Quit the installed app from the tray first, and point the development build at test folders.

## Keep files safe

The app moves people's files, so safety comes before everything else:

- Never test with your real Downloads, Desktop, Documents or OneDrive folders. Use temporary folders with copies of test files.
- Existing files are never overwritten, and every move must be previewable and undoable.
- File access and validation live in Rust (`src-tauri/src`). The frontend only shows state and asks for actions.
- A change to how files are moved, restored or watched needs a test that fails without it.

## Checks

These are the checks CI runs. Run them before opening a pull request:

```powershell
npm run check
npm run lint
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
npm run build
```

To run one test:

```powershell
npx vitest run src/components/settings.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml part_of_the_test_name
```

Tests run in Portuguese by default, so they look for the Portuguese text.

## Translations

The app is in English, Portuguese, Spanish, French and Italian. Each language has one file in [`i18n/`](i18n), read by both the frontend and Rust.

- Code calls `t("English text")`. The English text is the key, and each file maps it to its language.
- Adding, rewording or removing a text means changing that key in every file in the same change. A test fails if a key is missing or unused.
- The first argument to `t` must be a plain string, so the test can find it.
- Values can't contain JSON escapes such as `\"`.
- `folder.*` keys are the names of the category folders. Changing one changes where new files go.

To improve a translation, editing the value in the language's file is enough.

## Pull requests

- Keep each pull request to one topic, with tests for behavior changes.
- Fill in the template, and list only the checks you actually ran.
- For UI changes, add a screenshot of the app with private names and paths hidden.
- Don't edit `CHANGELOG.md`. It is written when a version is released.

By contributing, you agree that your work is released under the [MIT License](LICENSE).

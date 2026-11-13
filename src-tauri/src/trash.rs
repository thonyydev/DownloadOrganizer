//! Sends files from the list to the Recycle Bin, where Windows can restore them.
use crate::{
    engine::{self, Preferences, Result},
    file_preview::{self, Access},
    i18n::t,
};
use std::path::Path;
use windows_sys::Win32::{Foundation::HWND, UI::Shell::*};

/// The files the page asked for, each still in the last listing and unchanged on disk.
pub fn checked(
    access: &Access,
    prefs: &Preferences,
    files: &[(String, u64, i64)],
) -> Result<Vec<String>> {
    files
        .iter()
        .map(|(path, size, modified)| {
            let expected = access.authorize(prefs, path, *size, *modified)?;
            let meta = std::fs::symlink_metadata(path).map_err(|_| file_preview::changed())?;
            if !meta.is_file() || engine::stamp(&meta)? != expected {
                return Err(file_preview::changed().into());
            }
            Ok(path.clone())
        })
        .collect()
}

/// Recycles the files in one shell operation and returns how many left their folder.
pub fn recycle(paths: &[String], window: HWND) -> Result<usize> {
    if paths.is_empty() {
        return Ok(0);
    }
    // The shell doesn't read \\?\ paths; the list ends with an extra null.
    let from: Vec<u16> = paths
        .iter()
        .flat_map(|path| {
            file_preview::plain_path(path)
                .encode_utf16()
                .chain(Some(0))
                .collect::<Vec<_>>()
        })
        .chain(Some(0))
        .collect();
    let mut operation = SHFILEOPSTRUCTW {
        hwnd: window,
        wFunc: FO_DELETE,
        pFrom: from.as_ptr(),
        // NOCONFIRMATION skips "are you sure", which the app already asked. WANTNUKEWARNING
        // still makes Windows ask before deleting a file it can't recycle for good.
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_WANTNUKEWARNING | FOF_SILENT) as u16,
        ..Default::default()
    };
    let code = unsafe { SHFileOperationW(&mut operation) };
    let gone = paths
        .iter()
        .filter(|path| std::fs::symlink_metadata(Path::new(path)).is_err())
        .count();
    if code != 0 && gone == 0 {
        return Err(t("Could not move the files to the Recycle Bin.").into());
    }
    Ok(gone)
}

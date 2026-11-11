use crate::engine::Result;

/// File Explorer starts the app with this argument followed by the folder.
pub const ORGANIZE_ARGUMENT: &str = "--organize";

/// The folder of an "Organize with Download Organizer" launch, if this is one.
pub fn requested_folder(args: impl IntoIterator<Item = String>) -> Option<String> {
    let mut args = args
        .into_iter()
        .skip_while(|argument| argument != ORGANIZE_ARGUMENT);
    args.next()?;
    // At a drive root the command is "D:\", whose \" Windows reads as a quote: D:" arrives.
    let folder = args.next()?.trim_end_matches('"').to_owned();
    match folder.trim() {
        "" => None,
        root if root.ends_with(':') => Some(format!(r"{root}\")),
        _ => Some(folder),
    }
}

/// Adds or removes the entry in the right-click menu of every folder, and of the empty space
/// inside one, for the current user. Run at each start, so it follows updates and the app's language.
/// The installer's uninstall step removes it.
pub fn apply(enabled: bool, label: &str) -> Result<()> {
    use std::{ffi::OsString, iter::once, os::windows::ffi::OsStrExt, ptr::null};
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{HKEY_CURRENT_USER, REG_SZ, RegDeleteTreeW, RegSetKeyValueW},
    };

    // A dev executable needs the Vite server, so the menu must not point at it.
    if cfg!(debug_assertions) {
        return Ok(());
    }
    // Only logged: the app works without the menu entry.
    let fail = |status: u32| {
        Err(format!(
            "Could not change the File Explorer menu: {}",
            std::io::Error::from_raw_os_error(status as i32)
        ))
    };
    let keys = [
        r"Software\Classes\Directory\shell\DownloadOrganizer",
        r"Software\Classes\Directory\Background\shell\DownloadOrganizer",
    ];
    let wide = |text: &std::ffi::OsStr| -> Vec<u16> { text.encode_wide().chain(once(0)).collect() };
    if !enabled {
        for key in keys {
            match unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, wide(key.as_ref()).as_ptr()) } {
                ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => (),
                status => return fail(status),
            }
        }
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut command = OsString::from("\"");
    command.push(&exe);
    command.push(format!("\" {ORGANIZE_ARGUMENT} \"%V\""));
    let mut icon = OsString::from("\"");
    icon.push(&exe);
    icon.push("\",0");
    for key in keys {
        let command_key = format!(r"{key}\command");
        for (subkey, name, data) in [
            (key, Some("MUIVerb"), OsString::from(label)),
            (key, Some("Icon"), icon.clone()),
            // Explorer starts one launch per selected folder, and only the last one would be kept.
            (key, Some("MultiSelectModel"), OsString::from("Single")),
            (command_key.as_str(), None, command.clone()),
        ] {
            let subkey = wide(subkey.as_ref());
            let name = name.map(|name| wide(name.as_ref()));
            let data = wide(&data);
            let status = unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    subkey.as_ptr(),
                    name.as_ref().map_or(null(), |name| name.as_ptr()),
                    REG_SZ,
                    data.as_ptr().cast(),
                    (data.len() * 2) as u32,
                )
            };
            if status != ERROR_SUCCESS {
                return fail(status);
            }
        }
    }
    Ok(())
}

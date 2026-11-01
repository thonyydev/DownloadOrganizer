use crate::engine::Result;
use crate::i18n::t;

pub const LAUNCH_ARGUMENT: &str = "--autostart";

/// Adds or removes this executable from the current user's startup programs.
pub fn apply(enabled: bool) -> Result<()> {
    use std::{ffi::OsString, iter::once, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{HKEY_CURRENT_USER, REG_SZ, RegDeleteKeyValueW, RegSetKeyValueW},
    };

    // A dev executable can't start at login: it needs the Vite server.
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(once(0)).collect() };
    let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
    let name = wide("Download Organizer");
    let status = if enabled {
        let mut command = OsString::from("\"");
        command.push(std::env::current_exe().map_err(|e| e.to_string())?);
        command.push(format!("\" {LAUNCH_ARGUMENT}"));
        let data: Vec<u16> = command.encode_wide().chain(once(0)).collect();
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                REG_SZ,
                data.as_ptr().cast(),
                (data.len() * 2) as u32,
            )
        }
    } else {
        match unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) } {
            ERROR_FILE_NOT_FOUND => ERROR_SUCCESS,
            status => status,
        }
    };
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!(
            "{}: {}",
            t(
                "Não foi possível alterar a inicialização com o Windows",
                "Could not change starting with Windows"
            ),
            std::io::Error::from_raw_os_error(status as i32)
        ))
    }
}

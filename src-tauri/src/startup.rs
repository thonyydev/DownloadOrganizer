use crate::i18n::t;
use crate::{Runtime, store::Store};
use rusqlite::ErrorCode;
use std::{
    fmt,
    path::Path,
    sync::{Arc, atomic::AtomicU64},
};

#[derive(Debug, PartialEq, Eq)]
pub enum StartupError {
    DataDirectory,
    StorageAccess,
    DatabaseLocked,
    DatabaseCorrupt,
    Database,
    DiskFull,
    NewerVersion,
    Preferences,
    Recovery,
    Runtime,
}

impl From<rusqlite::Error> for StartupError {
    fn from(error: rusqlite::Error) -> Self {
        match error.sqlite_error_code() {
            Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => Self::DatabaseLocked,
            Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => Self::DatabaseCorrupt,
            Some(
                ErrorCode::PermissionDenied
                | ErrorCode::ReadOnly
                | ErrorCode::CannotOpen
                | ErrorCode::SystemIoFailure,
            ) => Self::StorageAccess,
            Some(ErrorCode::DiskFull) => Self::DiskFull,
            _ => Self::Database,
        }
    }
}

impl fmt::Display for StartupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (reason, guidance) = match self {
            Self::DataDirectory => (
                t("The app's data folder is unavailable or cannot be accessed."),
                t(
                    "Check that the drive is connected and that your account can access the data folder. Then open the app again.",
                ),
            ),
            Self::StorageAccess => (
                t("Could not safely access or write to the database."),
                t(
                    "Close any tools that may be using the data and check the drive's permissions and availability. Then open the app again.",
                ),
            ),
            Self::DatabaseLocked => (
                t("The database is in use or its safety lock is unavailable."),
                t(
                    "Close other running copies of Download Organizer and any tools using the database. Then open the app again. If this continues, restart Windows or contact support.",
                ),
            ),
            Self::DatabaseCorrupt => (
                t("The database is invalid or may be damaged."),
                t(
                    "Do not try to recreate the database. Keep the data and contact support to assess recovery or an existing backup.",
                ),
            ),
            Self::Database => (
                t("Could not prepare the database safely."),
                t(
                    "Open the app again after checking the data drive. If this continues, keep the data and contact support.",
                ),
            ),
            Self::DiskFull => (
                t("There is no space left to write the app's data."),
                t(
                    "Free up space on the drive without removing Download Organizer's data, then open the app again.",
                ),
            ),
            Self::NewerVersion => (
                t("The database belongs to a newer version of the app."),
                t("Use a compatible or newer version of Download Organizer to access this data."),
            ),
            Self::Preferences => (
                t("The saved preferences could not be read safely."),
                t(
                    "The preferences were not reset. Keep the data and contact support to recover the settings.",
                ),
            ),
            Self::Recovery => (
                t("Could not finish checking the interrupted operations."),
                t(
                    "Do not start another organization. Check access to the drive and reopen the app. If this continues, keep the data and contact support.",
                ),
            ),
            Self::Runtime => (
                t("Could not prepare the app's window components."),
                t(
                    "Restart the app. If this continues, check the installation and the availability of Microsoft Edge WebView2 on Windows.",
                ),
            ),
        };
        write!(
            f,
            "{}\n\n{reason}\n\n{guidance}\n\n{}",
            t("Could not start Download Organizer."),
            t(
                "The app will close. Do not delete the database or its associated WAL and SHM files."
            )
        )
    }
}

// No watcher or application state is published until all storage checks succeed.
pub fn initialize(data: &Path, default_source: &str) -> Result<Runtime, StartupError> {
    std::fs::create_dir_all(data).map_err(|_| StartupError::DataDirectory)?;
    let store = Store::open(&data.join("organizer.sqlite3"), default_source)?;
    Ok(Runtime {
        store,
        preview: None,
        sequence: 0,
        watcher: None,
        session: None,
        watch_error: None,
        overflow: Arc::new(AtomicU64::new(0)),
    })
}

pub fn show_error(error: StartupError) {
    let message = error.to_string();
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    let title: Vec<u16> = t("Download Organizer — Failed to start")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    // Independent of Tauri/WebView: both UTF-16 buffers live through the modal call.
    if unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        )
    } != 0
    {
        return;
    }
    eprintln!("{message}");
}

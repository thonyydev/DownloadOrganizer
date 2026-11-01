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
                t(
                    "A pasta de dados do aplicativo está indisponível ou sem permissão de acesso.",
                    "The app's data folder is unavailable or cannot be accessed.",
                ),
                t(
                    "Verifique se a unidade está conectada e se sua conta pode acessar a pasta de dados. Depois, abra o aplicativo novamente.",
                    "Check that the drive is connected and that your account can access the data folder. Then open the app again.",
                ),
            ),
            Self::StorageAccess => (
                t(
                    "Não foi possível acessar ou gravar o banco de dados com segurança.",
                    "Could not safely access or write to the database.",
                ),
                t(
                    "Feche ferramentas que possam estar usando os dados e verifique as permissões e a disponibilidade da unidade. Depois, abra o aplicativo novamente.",
                    "Close any tools that may be using the data and check the drive's permissions and availability. Then open the app again.",
                ),
            ),
            Self::DatabaseLocked => (
                t(
                    "O banco de dados está em uso ou seu bloqueio de segurança não está disponível.",
                    "The database is in use or its safety lock is unavailable.",
                ),
                t(
                    "Feche outras execuções do Download Organizer e ferramentas que estejam usando o banco. Depois, abra o aplicativo novamente. Se persistir, reinicie o Windows ou procure suporte.",
                    "Close other running copies of Download Organizer and any tools using the database. Then open the app again. If this continues, restart Windows or contact support.",
                ),
            ),
            Self::DatabaseCorrupt => (
                t(
                    "O banco de dados está inválido ou pode estar danificado.",
                    "The database is invalid or may be damaged.",
                ),
                t(
                    "Não tente recriar o banco. Preserve os dados e procure suporte para avaliar uma recuperação ou um backup existente.",
                    "Do not try to recreate the database. Keep the data and contact support to assess recovery or an existing backup.",
                ),
            ),
            Self::Database => (
                t(
                    "Não foi possível preparar o banco de dados com segurança.",
                    "Could not prepare the database safely.",
                ),
                t(
                    "Abra o aplicativo novamente após verificar a unidade de dados. Se persistir, preserve os dados e procure suporte.",
                    "Open the app again after checking the data drive. If this continues, keep the data and contact support.",
                ),
            ),
            Self::DiskFull => (
                t(
                    "Não há espaço disponível para gravar os dados do aplicativo.",
                    "There is no space left to write the app's data.",
                ),
                t(
                    "Libere espaço na unidade sem remover os dados do Download Organizer e abra o aplicativo novamente.",
                    "Free up space on the drive without removing Download Organizer's data, then open the app again.",
                ),
            ),
            Self::NewerVersion => (
                t(
                    "O banco de dados pertence a uma versão mais recente do aplicativo.",
                    "The database belongs to a newer version of the app.",
                ),
                t(
                    "Use uma versão compatível ou mais recente do Download Organizer para acessar esses dados.",
                    "Use a compatible or newer version of Download Organizer to access this data.",
                ),
            ),
            Self::Preferences => (
                t(
                    "As preferências salvas não puderam ser lidas com segurança.",
                    "The saved preferences could not be read safely.",
                ),
                t(
                    "As preferências não foram redefinidas. Preserve os dados e procure suporte para recuperar as configurações.",
                    "The preferences were not reset. Keep the data and contact support to recover the settings.",
                ),
            ),
            Self::Recovery => (
                t(
                    "Não foi possível concluir a verificação das operações interrompidas.",
                    "Could not finish checking the interrupted operations.",
                ),
                t(
                    "Não inicie outra organização. Verifique o acesso à unidade e reabra o aplicativo. Se persistir, preserve os dados e procure suporte.",
                    "Do not start another organization. Check access to the drive and reopen the app. If this continues, keep the data and contact support.",
                ),
            ),
            Self::Runtime => (
                t(
                    "Não foi possível preparar os componentes da janela do aplicativo.",
                    "Could not prepare the app's window components.",
                ),
                t(
                    "Reinicie o aplicativo. Se persistir, verifique a instalação e a disponibilidade do Microsoft Edge WebView2 no Windows.",
                    "Restart the app. If this continues, check the installation and the availability of Microsoft Edge WebView2 on Windows.",
                ),
            ),
        };
        write!(
            f,
            "{}\n\n{reason}\n\n{guidance}\n\n{}",
            t(
                "Não foi possível iniciar o Download Organizer.",
                "Could not start Download Organizer."
            ),
            t(
                "O aplicativo será fechado. Não exclua o banco nem os arquivos WAL e SHM associados.",
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
    let title: Vec<u16> = t(
        "Download Organizer — Falha ao iniciar",
        "Download Organizer — Failed to start",
    )
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

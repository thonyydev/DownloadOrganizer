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
                "A pasta de dados do aplicativo está indisponível ou sem permissão de acesso.",
                "Verifique se a unidade está conectada e se sua conta pode acessar a pasta de dados. Depois, abra o aplicativo novamente.",
            ),
            Self::StorageAccess => (
                "Não foi possível acessar ou gravar o banco de dados com segurança.",
                "Feche ferramentas que possam estar usando os dados e verifique as permissões e a disponibilidade da unidade. Depois, abra o aplicativo novamente.",
            ),
            Self::DatabaseLocked => (
                "O banco de dados está em uso ou seu bloqueio de segurança não está disponível.",
                "Feche outras execuções do Download Organizer e ferramentas que estejam usando o banco. Depois, abra o aplicativo novamente. Se persistir, reinicie o Windows ou procure suporte.",
            ),
            Self::DatabaseCorrupt => (
                "O banco de dados está inválido ou pode estar danificado.",
                "Não tente recriar o banco. Preserve os dados e procure suporte para avaliar uma recuperação ou um backup existente.",
            ),
            Self::Database => (
                "Não foi possível preparar o banco de dados com segurança.",
                "Abra o aplicativo novamente após verificar a unidade de dados. Se persistir, preserve os dados e procure suporte.",
            ),
            Self::DiskFull => (
                "Não há espaço disponível para gravar os dados do aplicativo.",
                "Libere espaço na unidade sem remover os dados do Download Organizer e abra o aplicativo novamente.",
            ),
            Self::NewerVersion => (
                "O banco de dados pertence a uma versão mais recente do aplicativo.",
                "Use uma versão compatível ou mais recente do Download Organizer para acessar esses dados.",
            ),
            Self::Preferences => (
                "As preferências salvas não puderam ser lidas com segurança.",
                "As preferências não foram redefinidas. Preserve os dados e procure suporte para recuperar as configurações.",
            ),
            Self::Recovery => (
                "Não foi possível concluir a verificação das operações interrompidas.",
                "Não inicie outra organização. Verifique o acesso à unidade e reabra o aplicativo. Se persistir, preserve os dados e procure suporte.",
            ),
            Self::Runtime => (
                "Não foi possível preparar os componentes da janela do aplicativo.",
                "Reinicie o aplicativo. Se persistir, verifique a instalação e a disponibilidade do Microsoft Edge WebView2 no Windows.",
            ),
        };
        write!(
            f,
            "Não foi possível iniciar o Download Organizer.\n\n{reason}\n\n{guidance}\n\nO aplicativo será fechado. Não exclua o banco nem os arquivos WAL e SHM associados."
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
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
        let title: Vec<u16> = "Download Organizer — Falha ao iniciar\0"
            .encode_utf16()
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
    }
    eprintln!("{message}");
}

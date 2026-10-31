use crate::engine::Result;
use crate::i18n::t;
use std::{fs::File, io, path::Path};

fn incompatible() -> &'static str {
    t(
        "A origem e o destino estão em volumes diferentes ou em compartilhamentos incompatíveis. Escolha um destino no mesmo volume da origem em Configurações e salve as preferências.",
        "The source and destination are on different volumes or incompatible network shares. Choose a destination on the same volume as the source in Settings and save your preferences.",
    )
}

fn unavailable(error: io::Error) -> String {
    format!(
        "{}: {error}",
        t(
            "Não foi possível verificar se a origem e o destino estão no mesmo volume. Verifique o acesso às pastas ou escolha pastas locais no mesmo volume em Configurações. Detalhes",
            "Could not check whether the source and destination are on the same volume. Check access to the folders or choose local folders on the same volume in Settings. Details"
        )
    )
}

fn open_directory(path: &Path) -> io::Result<File> {
    let mut options = File::options();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        };
        options
            .share_mode(3)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_dir() || crate::engine::linked(&metadata) {
        return Err(io::Error::other(t(
            "Pasta inválida ou link",
            "Invalid folder or link",
        )));
    }
    Ok(file)
}

pub fn validate_directories(source: &Path, destination: &Path) -> Result<()> {
    let source = open_directory(source).map_err(unavailable)?;
    validate(&source, destination)
}

// The caller keeps its existing path validation and directory guards.
pub fn validate(source: &File, destination: &Path) -> Result<()> {
    let destination = open_directory(destination).map_err(unavailable)?;
    let source = identity(source).map_err(unavailable)?;
    let destination = identity(&destination).map_err(unavailable)?;
    compare(source, destination)
}

fn compare<T: PartialEq>(source: T, destination: T) -> Result<()> {
    if source != destination {
        return Err(incompatible().into());
    }
    Ok(())
}

#[cfg(windows)]
#[derive(Debug, PartialEq)]
enum Identity {
    Local(String),
    Remote { share: String, serial: u64 },
}

#[cfg(windows)]
fn final_path(file: &File, flags: u32) -> io::Result<std::path::PathBuf> {
    use std::{
        ffi::OsString,
        os::windows::{ffi::OsStringExt, io::AsRawHandle},
    };
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
    let handle = file.as_raw_handle();
    let length = unsafe { GetFinalPathNameByHandleW(handle, std::ptr::null_mut(), 0, flags) };
    if length == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let written = unsafe {
        GetFinalPathNameByHandleW(handle, buffer.as_mut_ptr(), buffer.len() as u32, flags)
    };
    if written == 0 {
        return Err(io::Error::last_os_error());
    }
    if written as usize >= buffer.len() {
        return Err(io::Error::other(t(
            "O caminho mudou durante a verificação",
            "The path changed during the check",
        )));
    }
    Ok(OsString::from_wide(&buffer[..written as usize]).into())
}

#[cfg(windows)]
fn identity(file: &File) -> io::Result<Identity> {
    use std::{mem::size_of, os::windows::io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx, VOLUME_NAME_DOS, VOLUME_NAME_GUID,
    };
    if let Ok(path) = final_path(file, VOLUME_NAME_GUID) {
        return local_identity(&path);
    }
    // SMB has no volume GUID. Do not equate shares or servers by serial alone.
    let path = final_path(file, VOLUME_NAME_DOS)?;
    let mut info: FILE_ID_INFO = unsafe { std::mem::zeroed() };
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            (&mut info as *mut FILE_ID_INFO).cast(),
            size_of::<FILE_ID_INFO>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    remote_identity(&path, info.VolumeSerialNumber)
}

#[cfg(windows)]
fn local_identity(path: &Path) -> io::Result<Identity> {
    use std::path::{Component, Prefix};
    if let Some(Component::Prefix(prefix)) = path.components().next()
        && let Prefix::Verbatim(volume) = prefix.kind()
        && let Some(volume) = volume.to_str()
        && volume.starts_with("Volume{")
        && volume.ends_with('}')
    {
        return Ok(Identity::Local(volume.to_ascii_lowercase()));
    }
    Err(io::Error::other(t(
        "Identidade do volume local indisponível",
        "Local volume identity unavailable",
    )))
}

#[cfg(windows)]
fn remote_identity(path: &Path, serial: u64) -> io::Result<Identity> {
    use std::path::{Component, Prefix};
    if serial != 0
        && let Some(Component::Prefix(prefix)) = path.components().next()
        && let Prefix::VerbatimUNC(server, share) = prefix.kind()
        && let (Some(server), Some(share)) = (server.to_str(), share.to_str())
    {
        return Ok(Identity::Remote {
            share: format!("{server}\\{share}").to_ascii_lowercase(),
            serial,
        });
    }
    Err(io::Error::other(t(
        "Identidade do compartilhamento indisponível",
        "Network share identity unavailable",
    )))
}

#[cfg(unix)]
fn identity(file: &File) -> io::Result<u64> {
    use std::os::unix::fs::MetadataExt;
    Ok(file.metadata()?.dev())
}

#[cfg(not(any(windows, unix)))]
fn identity(_file: &File) -> io::Result<u64> {
    Err(io::Error::other(t(
        "Sistema ainda não suportado",
        "System not supported yet",
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn different_volume_identities_are_refused() {
        assert_eq!(compare(1u64, 2u64).unwrap_err(), incompatible());
        assert!(compare(1u64, 1u64).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn windows_identities_use_guids_and_share_scoped_serials() {
        let a = local_identity(Path::new(
            r"\\?\Volume{11111111-1111-1111-1111-111111111111}\one",
        ))
        .unwrap();
        let b = local_identity(Path::new(
            r"\\?\Volume{11111111-1111-1111-1111-111111111111}\two",
        ))
        .unwrap();
        assert!(compare(a, b).is_ok());
        assert!(
            compare(
                Identity::Local("volume-a".into()),
                Identity::Local("volume-b".into())
            )
            .is_err()
        );
        let remote = |path, serial| remote_identity(Path::new(path), serial).unwrap();
        assert!(
            compare(
                remote(r"\\?\UNC\server\share\one", 42),
                remote(r"\\?\UNC\SERVER\SHARE\two", 42)
            )
            .is_ok()
        );
        assert!(
            compare(
                remote(r"\\?\UNC\server\share\one", 42),
                remote(r"\\?\UNC\server\other\two", 42)
            )
            .is_err()
        );
        assert!(
            compare(
                remote(r"\\?\UNC\server\share\one", 42),
                remote(r"\\?\UNC\other\share\two", 42)
            )
            .is_err()
        );
        assert!(
            compare(
                remote(r"\\?\UNC\server\share\one", 42),
                remote(r"\\?\UNC\server\share\two", 43)
            )
            .is_err()
        );
        assert!(remote_identity(Path::new(r"\\?\UNC\server\share\one"), 0).is_err());
        assert!(remote_identity(Path::new(r"C:\one"), 42).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn native_identity_accepts_dos_verbatim_and_volume_guid_paths() {
        use windows_sys::Win32::Storage::FileSystem::VOLUME_NAME_GUID;
        let temp = tempfile::tempdir().unwrap();
        let canonical = std::fs::canonicalize(temp.path()).unwrap();
        let plain = canonical.to_str().unwrap().strip_prefix(r"\\?\").unwrap();
        validate_directories(&canonical, Path::new(plain)).unwrap();
        let guid_path = final_path(&open_directory(&canonical).unwrap(), VOLUME_NAME_GUID).unwrap();
        crate::engine::validate_directory(&guid_path).unwrap();
        validate_directories(&canonical, &guid_path).unwrap();
        let handle = open_directory(&canonical).unwrap();
        let uppercase = plain.to_ascii_uppercase();
        validate(&handle, Path::new(&uppercase)).unwrap();
    }

    #[test]
    fn missing_and_non_directory_paths_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing");
        let file = temp.path().join("file.txt");
        std::fs::write(&file, b"unchanged").unwrap();
        assert!(
            validate_directories(temp.path(), &missing)
                .unwrap_err()
                .contains("Não foi possível verificar")
        );
        assert!(validate_directories(temp.path(), &file).is_err());
        assert!(validate_directories(&missing, temp.path()).is_err());
        assert_eq!(std::fs::read(file).unwrap(), b"unchanged");
    }

    #[cfg(windows)]
    #[test]
    fn inaccessible_directory_cannot_be_treated_as_compatible() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("destination");
        std::fs::create_dir(&destination).unwrap();
        let _exclusive = File::options()
            .read(true)
            .share_mode(0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(&destination)
            .unwrap();
        assert!(
            validate_directories(temp.path(), &destination)
                .unwrap_err()
                .contains("Verifique o acesso às pastas")
        );
    }
}

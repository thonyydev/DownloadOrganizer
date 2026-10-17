use crate::engine::{self, Result};
use std::{fs, path::Path};

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{
        fs::File,
        io,
        mem::size_of,
        os::windows::{
            ffi::OsStrExt,
            io::{AsRawHandle, FromRawHandle},
        },
        ptr,
    };
    use windows_sys::{
        Wdk::{
            Foundation::OBJECT_ATTRIBUTES,
            Storage::FileSystem::{
                FILE_CREATE, FILE_DIRECTORY_FILE, FILE_OPEN, FILE_OPEN_REPARSE_POINT,
                FILE_SYNCHRONOUS_IO_NONALERT, NtCreateFile,
            },
        },
        Win32::{
            Foundation::{RtlNtStatusToDosError, UNICODE_STRING},
            Storage::FileSystem::*,
            System::IO::IO_STATUS_BLOCK,
        },
    };

    pub struct Directory {
        file: File,
        _parents: Vec<File>,
    }

    fn open(path: &Path, create: bool) -> Result<Directory> {
        let parents = engine::guard_directory(path.parent().ok_or("Pasta sem ancestral")?)?;
        let mut name: Vec<u16> = path
            .file_name()
            .ok_or("Nome de pasta inválido")?
            .encode_wide()
            .collect();
        let length = (name.len() * 2)
            .try_into()
            .map_err(|_| "Nome de pasta longo demais")?;
        let mut name = UNICODE_STRING {
            Length: length,
            MaximumLength: length,
            Buffer: name.as_mut_ptr(),
        };
        let attributes = OBJECT_ATTRIBUTES {
            Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: parents
                .last()
                .ok_or("Ancestral indisponível")?
                .as_raw_handle(),
            ObjectName: &mut name,
            Attributes: 0x40, // OBJ_CASE_INSENSITIVE, matching ordinary Windows path resolution.
            ..unsafe { std::mem::zeroed() }
        };
        let mut handle = ptr::null_mut();
        let mut status: IO_STATUS_BLOCK = unsafe { std::mem::zeroed() };
        // FILE_CREATE returns the newly created object itself; no create/open ownership race.
        let result = unsafe {
            NtCreateFile(
                &mut handle,
                FILE_READ_ATTRIBUTES | SYNCHRONIZE | if create { 0 } else { DELETE },
                &attributes,
                &mut status,
                ptr::null(),
                FILE_ATTRIBUTE_NORMAL,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                if create { FILE_CREATE } else { FILE_OPEN },
                FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
                ptr::null(),
                0,
            )
        };
        if result < 0 {
            return Err(io::Error::from_raw_os_error(
                unsafe { RtlNtStatusToDosError(result) } as i32
            )
            .to_string());
        }
        let file = unsafe { File::from_raw_handle(handle) };
        let meta = file.metadata().map_err(|e| e.to_string())?;
        if !meta.is_dir() || engine::linked(&meta) {
            return Err("Pasta inválida ou link; preservada".into());
        }
        Ok(Directory {
            file,
            _parents: parents,
        })
    }

    impl Directory {
        pub fn identity(&self) -> Result<String> {
            use std::os::windows::fs::MetadataExt;
            let mut id: FILE_ID_INFO = unsafe { std::mem::zeroed() };
            if unsafe {
                GetFileInformationByHandleEx(
                    self.file.as_raw_handle(),
                    FileIdInfo,
                    (&mut id as *mut FILE_ID_INFO).cast(),
                    size_of::<FILE_ID_INFO>() as u32,
                )
            } == 0
            {
                return Err(io::Error::last_os_error().to_string());
            }
            let born = self
                .file
                .metadata()
                .map_err(|e| e.to_string())?
                .creation_time();
            Ok(format!(
                "{}:{:02x?}:{born}",
                id.VolumeSerialNumber, id.FileId.Identifier
            ))
        }
    }

    pub fn create(path: &Path) -> Result<Option<Directory>> {
        match open(path, true) {
            Ok(directory) => Ok(Some(directory)),
            Err(error) => {
                // A concurrent creator never grants us ownership of its directory.
                if fs::symlink_metadata(path).is_ok() {
                    engine::validate_directory(path)?;
                    Ok(None)
                } else {
                    Err(error)
                }
            }
        }
    }

    pub fn remove(path: &Path, identity: &str) -> Result<bool> {
        remove_with(path, identity, || {})
    }

    pub fn remove_with(path: &Path, identity: &str, before_remove: impl FnOnce()) -> Result<bool> {
        let directory = open(path, false)?;
        if directory.identity()? != identity {
            return Err("A pasta foi substituída; preservada por segurança".into());
        }
        let mut entries = fs::read_dir(path).map_err(|e| e.to_string())?;
        if let Some(entry) = entries.next() {
            entry.map_err(|e| e.to_string())?;
            return Ok(false);
        }
        drop(entries);
        before_remove();
        let info = FILE_DISPOSITION_INFO { DeleteFile: true };
        // The kernel removes this exact directory only if it is still empty, including races.
        if unsafe {
            SetFileInformationByHandle(
                directory.file.as_raw_handle(),
                FileDispositionInfo,
                (&info as *const FILE_DISPOSITION_INFO).cast(),
                size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        } == 0
        {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(145) {
                return Ok(false);
            }
            return Err(error.to_string());
        }
        drop(directory);
        match fs::symlink_metadata(path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
            _ => Err(
                "A remoção da pasta ainda não foi confirmada; nova verificação necessária".into(),
            ),
        }
    }
}

#[cfg(all(windows, test))]
pub use windows::remove_with;
#[cfg(windows)]
pub use windows::{create, remove};

// shortcut: automatic directory deletion is Windows-only until other platforms have handle-safe removal.
#[cfg(not(windows))]
pub fn create(path: &Path) -> Result<Option<UntrackedDirectory>> {
    match fs::create_dir(path) {
        Ok(()) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            engine::validate_directory(path)?;
            Ok(None)
        }
        Err(error) => Err(error.to_string()),
    }
}
#[cfg(not(windows))]
pub struct UntrackedDirectory;
#[cfg(not(windows))]
impl UntrackedDirectory {
    pub fn identity(&self) -> Result<String> {
        Err("Identidade indisponível".into())
    }
}
#[cfg(not(windows))]
pub fn remove(_path: &Path, _identity: &str) -> Result<bool> {
    Err("Limpeza segura de pastas disponível apenas no Windows".into())
}

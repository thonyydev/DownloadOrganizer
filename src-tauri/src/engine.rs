use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Read, Seek},
    path::{Component, Path, PathBuf},
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, String>;
pub const QUIET_SECONDS: u64 = 10;

#[derive(Clone, Serialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub extensions: Vec<String>,
}

static CATEGORIES: LazyLock<Vec<Category>> = LazyLock::new(|| {
    [
        (
            "images",
            "Imagens",
            "jpg jpeg png gif webp svg bmp ico heic avif tiff tif raw",
        ),
        ("videos", "Vídeos", "mp4 mkv mov avi webm m4v mpg mpeg wmv"),
        ("audio", "Áudios", "mp3 wav flac aac ogg m4a opus aiff"),
        (
            "documents",
            "Documentos",
            "pdf doc docx xls xlsx ppt pptx txt csv odt ods rtf epub md",
        ),
        ("archives", "Compactados", "zip rar 7z tar gz bz2 xz tgz"),
        (
            "installers",
            "Instaladores",
            "exe msi msix appx dmg pkg deb rpm appimage",
        ),
        (
            "code",
            "Código",
            "rs ts tsx js jsx py java c cpp h cs go html css json yaml yml toml sql sh ps1 ipynb",
        ),
        ("other", "Outros", ""),
    ]
    .into_iter()
    .map(|(id, name, ext)| Category {
        id: id.into(),
        name: name.into(),
        extensions: ext.split_whitespace().map(str::to_owned).collect(),
    })
    .collect()
});

pub fn categories() -> &'static [Category] {
    &CATEGORIES
}

pub fn classify(path: &Path) -> &'static Category {
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase();
    let all = categories();
    all.iter()
        .find(|c| c.extensions.contains(&ext))
        .unwrap_or_else(|| all.last().unwrap())
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
pub struct Preferences {
    pub source: String,
    pub destination: String,
    pub automatic: bool,
    pub enabled_categories: Vec<String>,
    pub theme: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
pub struct Stamp {
    pub size: i64,
    pub modified: i64,
}

pub fn stamp(meta: &Metadata) -> Result<Stamp> {
    Ok(Stamp {
        size: meta.len().try_into().map_err(|_| "Arquivo grande demais")?,
        modified: meta
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
            .try_into()
            .map_err(|_| "Data de modificação inválida")?,
    })
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .try_into()
        .unwrap_or(i64::MAX)
}

pub fn linked(meta: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

// Validate every ancestor: junctions and symlinks must never redirect a move.
pub fn validate_directory(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err("Selecione um caminho absoluto, sem . ou ..".into());
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        let meta =
            fs::symlink_metadata(&current).map_err(|e| format!("{}: {e}", current.display()))?;
        if linked(&meta) || !meta.is_dir() {
            return Err(format!("Pasta inválida ou link: {}", current.display()));
        }
    }
    fs::canonicalize(path).map_err(|e| e.to_string())
}

pub fn validate_preferences(prefs: &Preferences) -> Result<()> {
    validate_directory(Path::new(&prefs.source))?;
    validate_directory(Path::new(&prefs.destination))?;
    if !["dark", "light"].contains(&prefs.theme.as_str()) {
        return Err("Tema inválido".into());
    }
    if prefs
        .enabled_categories
        .iter()
        .any(|id| !categories().iter().any(|c| &c.id == id))
    {
        return Err("Categoria inválida".into());
    }
    Ok(())
}

pub fn temporary(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    name.starts_with('.')
        || name.starts_with('~')
        || name.ends_with('~')
        || name.starts_with("desktop.ini")
        || name == "thumbs.db"
        || [
            "crdownload",
            "part",
            "partial",
            "download",
            "tmp",
            "temp",
            "lock",
            "opdownload",
        ]
        .contains(
            &path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase()
                .as_str(),
        )
}

#[derive(Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub extension: String,
    pub category: String,
    pub size: u64,
    pub modified: i64,
    pub destination: String,
    pub status: String,
    pub reason: Option<String>,
    #[serde(skip)]
    pub stamp: Option<Stamp>,
}

#[derive(Clone, Serialize)]
pub struct Preview {
    pub id: u64,
    pub files: Vec<FileEntry>,
    pub created: i64,
}

pub fn scan(prefs: &Preferences) -> Result<Vec<FileEntry>> {
    let source = validate_directory(Path::new(&prefs.source))?;
    let paths = fs::read_dir(&source)
        .map_err(|e| e.to_string())?
        .map(|item| item.map(|item| item.path()))
        .collect::<io::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    scan_paths(prefs, paths)
}

pub fn scan_paths(
    prefs: &Preferences,
    paths: impl IntoIterator<Item = PathBuf>,
) -> Result<Vec<FileEntry>> {
    validate_preferences(prefs)?;
    let source = validate_directory(Path::new(&prefs.source))?;
    let destination = validate_directory(Path::new(&prefs.destination))?;
    let mut files = Vec::new();
    for path in paths {
        if path.parent() != Some(source.as_path()) {
            continue;
        }
        let name = path.file_name().ok_or("Nome de arquivo inválido")?;
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if meta.is_dir() && !linked(&meta) {
            continue;
        }
        let category = classify(&path);
        let target_folder = destination.join(&category.name);
        let target = target_folder.join(name);
        let mut reason = None;
        let mut status = "ready";
        let captured = stamp(&meta).ok();
        if linked(&meta) || !meta.is_file() {
            reason = Some("Link ou arquivo especial ignorado".into());
        } else if path.to_str().is_none() {
            reason = Some("Nome não representável em UTF-8".into());
        } else if temporary(&path) {
            reason = Some("Arquivo temporário ou download incompleto".into());
        } else if !prefs.enabled_categories.contains(&category.id) {
            reason = Some("Categoria desativada".into());
        } else if captured.is_none() {
            reason = Some("Metadados indisponíveis".into());
        } else if meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_none_or(|d| d < Duration::from_secs(QUIET_SECONDS))
        {
            reason = Some("Aguardando 10 segundos sem gravações".into());
        } else if fs::symlink_metadata(&target_folder).is_ok()
            && validate_directory(&target_folder).is_err()
        {
            reason = Some("Pasta de destino inválida ou link".into());
        } else if fs::symlink_metadata(&target).is_ok() {
            status = "conflict";
            reason = Some("Já existe um arquivo com esse nome; será preservado".into());
        }
        if reason.is_some() && status != "conflict" {
            status = "ignored";
        }
        files.push(FileEntry {
            name: name.to_string_lossy().into(),
            path: path.to_string_lossy().into(),
            extension: path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase(),
            category: category.id.clone(),
            size: meta.len(),
            modified: captured.as_ref().map_or(0, |s| s.modified / 1_000_000),
            destination: target.to_string_lossy().into(),
            status: status.into(),
            reason,
            stamp: captured,
        });
    }
    files.sort_by_key(|f| f.name.to_lowercase());
    Ok(files)
}

pub struct LockedFile {
    pub file: File,
    _directories: Vec<File>,
}

fn guard_directory(path: &Path) -> Result<Vec<File>> {
    validate_directory(path)?;
    #[cfg(windows)]
    let mut handles = Vec::new();
    #[cfg(not(windows))]
    let handles = Vec::new();
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        };
        let mut current = PathBuf::new();
        for component in path.components() {
            current.push(component);
            if matches!(component, Component::Prefix(_)) {
                continue;
            }
            let handle = OpenOptions::new()
                .read(true)
                // Native rename needs directory write sharing; deny replacement via DELETE sharing.
                .share_mode(3)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&current)
                .map_err(|e| e.to_string())?;
            let meta = handle.metadata().map_err(|e| e.to_string())?;
            if linked(&meta) || !meta.is_dir() {
                return Err("Ancestral inválido ou link".into());
            }
            handles.push(handle);
        }
    }
    Ok(handles)
}

pub fn locked_file(path: &Path) -> Result<LockedFile> {
    let directories = guard_directory(path.parent().ok_or("Caminho sem pasta")?)?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if linked(&meta) || !meta.is_file() {
        return Err("Arquivo inválido ou link".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{DELETE, FILE_FLAG_OPEN_REPARSE_POINT};
        options
            .share_mode(0)
            .access_mode(0x80000000 | DELETE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).map_err(|e| {
        if matches!(e.raw_os_error(), Some(32 | 33)) {
            "Arquivo ocupado".into()
        } else {
            format!("Arquivo sem permissão ou indisponível: {e}")
        }
    })?;
    #[cfg(unix)]
    {
        // shortcut: locks Unix são cooperativos; validar a plataforma antes de distribuir automação.
        use std::os::fd::AsRawFd;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("Arquivo ocupado".into());
        }
    }
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if linked(&meta) || !meta.is_file() {
        return Err("Arquivo inválido ou link".into());
    }
    Ok(LockedFile {
        file,
        _directories: directories,
    })
}

pub fn fingerprint(file: &mut File) -> Result<String> {
    file.rewind().map_err(|e| e.to_string())?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

pub fn verify_file(path: &Path, expected: &Stamp, digest: &str) -> Result<LockedFile> {
    let mut file = locked_file(path)?;
    verify_open(&mut file, expected, digest)?;
    Ok(file)
}

pub fn verify_open(file: &mut LockedFile, expected: &Stamp, digest: &str) -> Result<()> {
    if stamp(&file.file.metadata().map_err(|e| e.to_string())?)? != *expected
        || fingerprint(&mut file.file)? != digest
        || stamp(&file.file.metadata().map_err(|e| e.to_string())?)? != *expected
    {
        return Err("O arquivo mudou desde a movimentação; preservado".into());
    }
    Ok(())
}

pub fn prepare_move(entry: &FileEntry, prefs: &Preferences) -> Result<(LockedFile, String)> {
    let source = validate_directory(Path::new(&prefs.source))?;
    let path = Path::new(&entry.path);
    if path.parent() != Some(source.as_path()) || temporary(path) {
        return Err("Arquivo fora da pasta autorizada".into());
    }
    let category = classify(path);
    let base = validate_directory(Path::new(&prefs.destination))?;
    let folder = base.join(&category.name);
    let target = folder.join(path.file_name().ok_or("Nome inválido")?);
    if target != Path::new(&entry.destination) || !prefs.enabled_categories.contains(&category.id) {
        return Err("Destino ou categoria mudou; refaça a prévia".into());
    }
    let mut file = locked_file(path)?;
    file._directories.extend(guard_directory(&base)?);
    let expected = entry.stamp.as_ref().ok_or("Metadados indisponíveis")?;
    if stamp(&file.file.metadata().map_err(|e| e.to_string())?)? != *expected {
        return Err("Arquivo mudou desde a prévia; refaça a prévia".into());
    }
    let digest = fingerprint(&mut file.file)?;
    if stamp(&file.file.metadata().map_err(|e| e.to_string())?)? != *expected {
        return Err("Arquivo ainda está sendo gravado".into());
    }
    match fs::create_dir(&folder) {
        Ok(()) => (),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
        Err(e) => return Err(e.to_string()),
    }
    validate_directory(&folder)?;
    Ok((file, digest))
}

#[cfg(test)]
pub fn move_no_replace(source: &Path, destination: &Path) -> Result<()> {
    let mut file = locked_file(source)?;
    move_locked(&mut file, source, destination)
}

pub fn move_locked(file: &mut LockedFile, source: &Path, destination: &Path) -> Result<()> {
    // shortcut: somente mesmo volume; exigir cópia verificada e recuperação antes de expandir.
    validate_directory(source.parent().ok_or("Origem inválida")?)?;
    file._directories.extend(guard_directory(
        destination.parent().ok_or("Destino inválido")?,
    )?);
    let meta = file.file.metadata().map_err(|e| e.to_string())?;
    if linked(&meta) || !meta.is_file() {
        return Err("Origem inválida ou link".into());
    }
    #[cfg(windows)]
    {
        use std::{
            mem::{offset_of, size_of},
            os::windows::{ffi::OsStrExt, io::AsRawHandle},
            ptr,
        };
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_RENAME_INFO, FileRenameInfo, SetFileInformationByHandle,
        };
        let mut name: Vec<u16> = destination.as_os_str().encode_wide().collect();
        if name.contains(&0) {
            return Err("Destino contém caractere inválido".into());
        }
        let name_bytes = name.len() * 2;
        name.push(0);
        let bytes = offset_of!(FILE_RENAME_INFO, FileName) + name.len() * 2;
        let mut storage = vec![0u64; bytes.max(size_of::<FILE_RENAME_INFO>()).div_ceil(8)];
        // Aligned storage includes the flexible UTF-16 name; zero keeps ReplaceIfExists=false.
        let result = unsafe {
            let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
            (*info).FileNameLength = name_bytes.try_into().map_err(|_| "Destino longo demais")?;
            ptr::copy_nonoverlapping(
                name.as_ptr(),
                ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
                name.len(),
            );
            SetFileInformationByHandle(
                file.file.as_raw_handle(),
                FileRenameInfo,
                info.cast(),
                bytes.try_into().map_err(|_| "Destino longo demais")?,
            )
        };
        if result == 0 {
            return Err(format!(
                "Movimentação recusada (conflito, permissão ou volumes distintos): {}",
                io::Error::last_os_error()
            ));
        }
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let from = CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let to = CString::new(destination.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        #[cfg(target_os = "macos")]
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        if result != 0 {
            return Err(io::Error::last_os_error().to_string());
        }
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    return Err("Sistema ainda não suportado".into());
    Ok(())
}

use crate::i18n::{self, t};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
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

static CATEGORIES: LazyLock<Vec<Vec<Category>>> =
    LazyLock::new(|| (0..i18n::LANGUAGES.len()).map(build_categories).collect());

// Names double as destination folder names, so they follow the language in use.
fn build_categories(language: usize) -> Vec<Category> {
    [
        (
            "images",
            ["Imagens", "Images", "Imágenes", "Images", "Immagini"],
            "jpg jpeg png gif webp svg bmp ico heic avif tiff tif raw",
        ),
        (
            "videos",
            ["Vídeos", "Videos", "Vídeos", "Vidéos", "Video"],
            "mp4 mkv mov avi webm m4v mpg mpeg wmv",
        ),
        (
            "audio",
            ["Áudios", "Audio", "Audio", "Audio", "Audio"],
            "mp3 wav flac aac ogg m4a opus aiff",
        ),
        (
            "documents",
            [
                "Documentos",
                "Documents",
                "Documentos",
                "Documents",
                "Documenti",
            ],
            "pdf doc docx xls xlsx ppt pptx txt csv odt ods rtf epub md",
        ),
        (
            "archives",
            [
                "Compactados",
                "Archives",
                "Comprimidos",
                "Archives",
                "Archivi",
            ],
            "zip rar 7z tar gz bz2 xz tgz",
        ),
        (
            "installers",
            [
                "Instaladores",
                "Installers",
                "Instaladores",
                "Installateurs",
                "Installer",
            ],
            "exe msi msix appx dmg pkg deb rpm appimage",
        ),
        (
            "code",
            ["Código", "Code", "Código", "Code", "Codice"],
            "rs ts tsx js jsx py java c cpp h cs go html css json yaml yml toml sql sh ps1 ipynb",
        ),
        ("other", ["Outros", "Other", "Otros", "Autres", "Altro"], ""),
    ]
    .into_iter()
    .map(|(id, names, ext)| Category {
        id: id.into(),
        name: names[language].into(),
        extensions: ext.split_whitespace().map(str::to_owned).collect(),
    })
    .collect()
}

pub fn categories() -> &'static [Category] {
    &CATEGORIES[0]
}

pub fn categories_for(language: &str) -> &'static [Category] {
    &CATEGORIES[i18n::index_of(language)]
}

fn category_folder(id: &str, language: &str) -> &'static str {
    categories_for(language)
        .iter()
        .find(|category| category.id == id)
        .map_or("", |category| category.name.as_str())
}

fn enabled_by_default() -> bool {
    true
}

fn default_language() -> String {
    i18n::PORTUGUESE.into()
}

const BUSY: [&str; 5] = [
    "Arquivo ocupado",
    "File is busy",
    "Archivo ocupado",
    "Fichier occupé",
    "File occupato",
];

fn busy_message() -> &'static str {
    BUSY[i18n::current_index()]
}

/// Busy files are retried, not failed, so this must not depend on the active language.
pub fn is_busy(error: &str) -> bool {
    BUSY.contains(&error)
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
    // Installs from before this field only knew Portuguese; new ones start on "system".
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "enabled_by_default")]
    pub notifications: bool,
    #[serde(default = "enabled_by_default")]
    pub updates: bool,
    #[serde(default)]
    pub autostart: bool,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
pub struct Stamp {
    pub size: i64,
    pub modified: i64,
}

pub fn stamp(meta: &Metadata) -> Result<Stamp> {
    Ok(Stamp {
        size: meta
            .len()
            .try_into()
            .map_err(|_| t("Arquivo grande demais", "File is too large"))?,
        modified: meta
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
            .try_into()
            .map_err(|_| t("Data de modificação inválida", "Invalid modification date"))?,
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
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & 0x400 != 0
}

// Validate every ancestor: junctions and symlinks must never redirect a move.
pub fn validate_directory(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err(t(
            "Selecione um caminho absoluto, sem . ou ..",
            "Select an absolute path, without . or ..",
        )
        .into());
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
            return Err(format!(
                "{}: {}",
                t("Pasta inválida ou link", "Invalid folder or link"),
                current.display()
            ));
        }
    }
    fs::canonicalize(path).map_err(|e| e.to_string())
}

pub fn validate_preferences(prefs: &Preferences) -> Result<()> {
    validate_directory(Path::new(&prefs.source))?;
    validate_directory(Path::new(&prefs.destination))?;
    if !["dark", "light"].contains(&prefs.theme.as_str()) {
        return Err(t("Tema inválido", "Invalid theme").into());
    }
    if prefs.language != i18n::SYSTEM && !i18n::LANGUAGES.contains(&prefs.language.as_str()) {
        return Err(t("Idioma inválido", "Invalid language").into());
    }
    if prefs
        .enabled_categories
        .iter()
        .any(|id| !categories().iter().any(|c| &c.id == id))
    {
        return Err(t("Categoria inválida", "Invalid category").into());
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
            "!qb",
            "!ut",
            "bc!",
            "aria2",
            "dtapart",
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
    pub rename_to: Option<String>,
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
        let name = path
            .file_name()
            .ok_or(t("Nome de arquivo inválido", "Invalid file name"))?;
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if meta.is_dir() && !linked(&meta) {
            continue;
        }
        let category = classify(&path);
        let target_folder = destination.join(category_folder(&category.id, &prefs.language));
        let target = target_folder.join(name);
        let mut reason = None;
        let mut status = "ready";
        let captured = stamp(&meta).ok();
        if linked(&meta) || !meta.is_file() {
            reason = Some(
                t(
                    "Link ou arquivo especial ignorado",
                    "Link or special file ignored",
                )
                .into(),
            );
        } else if path.to_str().is_none() {
            reason = Some(
                t(
                    "Nome não representável em UTF-8",
                    "Name cannot be represented in UTF-8",
                )
                .into(),
            );
        } else if temporary(&path) {
            reason = Some(
                t(
                    "Arquivo temporário ou download incompleto",
                    "Temporary file or incomplete download",
                )
                .into(),
            );
        } else if !prefs.enabled_categories.contains(&category.id) {
            reason = Some(t("Categoria desativada", "Category turned off").into());
        } else if captured.is_none() {
            reason = Some(t("Metadados indisponíveis", "Metadata unavailable").into());
        } else if meta.modified().is_ok_and(|t| t.elapsed().is_err()) {
            reason = Some(
                t(
                    "Data de modificação no futuro; ajuste a data do arquivo para organizá-lo",
                    "Modification date is in the future; fix the file's date to organize it",
                )
                .into(),
            );
        } else if meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_none_or(|d| d < Duration::from_secs(QUIET_SECONDS))
        {
            reason = Some(
                t(
                    "Aguardando 10 segundos sem gravações",
                    "Waiting for 10 seconds without writes",
                )
                .into(),
            );
        } else if fs::symlink_metadata(&target_folder).is_ok()
            && validate_directory(&target_folder).is_err()
        {
            reason = Some(
                t(
                    "Pasta de destino inválida ou link",
                    "Invalid destination folder or link",
                )
                .into(),
            );
        } else if fs::symlink_metadata(&target).is_ok() {
            status = "conflict";
            reason = Some(
                t(
                    "Já existe um arquivo com esse nome; será preservado",
                    "A file with this name already exists; it will be preserved",
                )
                .into(),
            );
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
            rename_to: None,
            stamp: captured,
        });
    }
    files.sort_by_key(|f| f.name.to_lowercase());
    plan_renames(&mut files);
    Ok(files)
}

// Suggests a free name for each conflict, avoiding names other files in this batch will take.
fn plan_renames(files: &mut [FileEntry]) {
    let mut taken: HashSet<String> = files
        .iter()
        .filter(|file| file.status == "ready")
        .map(|file| file.destination.to_lowercase())
        .collect();
    for file in files.iter_mut().filter(|file| file.status == "conflict") {
        let target = Path::new(&file.destination);
        let (Some(folder), Some(stem)) = (target.parent(), target.file_stem()) else {
            continue;
        };
        let stem = stem.to_string_lossy();
        let extension = target.extension().map_or(String::new(), |value| {
            format!(".{}", value.to_string_lossy())
        });
        let free = (2..=9999)
            .map(|number| folder.join(format!("{stem} ({number}){extension}")))
            .map(|path| path.to_string_lossy().into_owned())
            .find(|path| {
                !taken.contains(&path.to_lowercase())
                    && fs::symlink_metadata(path)
                        .is_err_and(|error| error.kind() == io::ErrorKind::NotFound)
            });
        if let Some(path) = free {
            taken.insert(path.to_lowercase());
            file.rename_to = Some(path);
        }
    }
}

pub struct LockedFile {
    pub file: File,
    _directories: Vec<File>,
}

pub(crate) fn guard_directory(path: &Path) -> Result<Vec<File>> {
    validate_directory(path)?;
    let mut handles = Vec::new();
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
            return Err(t(
                "Ancestral inválido ou link",
                "Invalid parent folder or link",
            )
            .into());
        }
        handles.push(handle);
    }
    Ok(handles)
}

pub fn locked_file(path: &Path) -> Result<LockedFile> {
    let directories = guard_directory(
        path.parent()
            .ok_or(t("Caminho sem pasta", "Path has no folder"))?,
    )?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if linked(&meta) || !meta.is_file() {
        return Err(t("Arquivo inválido ou link", "Invalid file or link").into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{DELETE, FILE_FLAG_OPEN_REPARSE_POINT};
    options
        .share_mode(0)
        .access_mode(0x80000000 | DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    let file = options.open(path).map_err(|e| {
        if matches!(e.raw_os_error(), Some(32 | 33)) {
            busy_message().into()
        } else {
            format!(
                "{}: {e}",
                t(
                    "Arquivo sem permissão ou indisponível",
                    "File has no permission or is unavailable"
                )
            )
        }
    })?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if linked(&meta) || !meta.is_file() {
        return Err(t("Arquivo inválido ou link", "Invalid file or link").into());
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

// Other file systems round dates by up to 2 seconds. The hash is what proves the content.
fn same_stamp(a: &Stamp, b: &Stamp) -> bool {
    a.size == b.size && a.modified.abs_diff(b.modified) <= 2_000_000_000
}

pub fn verify_open(file: &mut LockedFile, expected: &Stamp, digest: &str) -> Result<()> {
    let current = |file: &File| stamp(&file.metadata().map_err(|e| e.to_string())?);
    if !same_stamp(&current(&file.file)?, expected)
        || fingerprint(&mut file.file)? != digest
        || !same_stamp(&current(&file.file)?, expected)
    {
        return Err(t(
            "O arquivo mudou desde a movimentação; preservado",
            "The file changed after it was moved; preserved",
        )
        .into());
    }
    Ok(())
}

pub fn prepare_move(
    entry: &FileEntry,
    prefs: &Preferences,
    create_directory: impl FnOnce(&Path) -> Result<()>,
) -> Result<(LockedFile, String)> {
    let source = validate_directory(Path::new(&prefs.source))?;
    let path = Path::new(&entry.path);
    if path.parent() != Some(source.as_path()) || temporary(path) {
        return Err(t(
            "Arquivo fora da pasta autorizada",
            "File is outside the authorized folder",
        )
        .into());
    }
    let category = classify(path);
    let base = validate_directory(Path::new(&prefs.destination))?;
    let folder = base.join(category_folder(&category.id, &prefs.language));
    let target = folder.join(path.file_name().ok_or(t("Nome inválido", "Invalid name"))?);
    let destination = Path::new(&entry.destination);
    let renamed = entry.rename_to.as_deref() == Some(entry.destination.as_str())
        && destination.parent() == Some(folder.as_path());
    if (target != destination && !renamed) || !prefs.enabled_categories.contains(&category.id) {
        return Err(t(
            "Destino ou categoria mudou; refaça a prévia",
            "Destination or category changed; generate the preview again",
        )
        .into());
    }
    let mut file = locked_file(path)?;
    file._directories.extend(guard_directory(&base)?);
    let expected = entry
        .stamp
        .as_ref()
        .ok_or(t("Metadados indisponíveis", "Metadata unavailable"))?;
    if stamp(&file.file.metadata().map_err(|e| e.to_string())?)? != *expected {
        return Err(t(
            "Arquivo mudou desde a prévia; refaça a prévia",
            "File changed since the preview; generate the preview again",
        )
        .into());
    }
    let digest = fingerprint(&mut file.file)?;
    if stamp(&file.file.metadata().map_err(|e| e.to_string())?)? != *expected {
        return Err(t(
            "Arquivo ainda está sendo gravado",
            "File is still being written",
        )
        .into());
    }
    create_directory(&folder)?;
    validate_directory(&folder)?;
    Ok((file, digest))
}

#[cfg(test)]
pub fn move_no_replace(source: &Path, destination: &Path) -> Result<()> {
    let mut file = locked_file(source)?;
    let digest = fingerprint(&mut file.file)?;
    move_locked(&mut file, source, destination, &digest)
}

/// Moves without ever replacing. Between drives it copies, verifies and only then removes the original.
pub fn move_locked(
    file: &mut LockedFile,
    source: &Path,
    destination: &Path,
    digest: &str,
) -> Result<()> {
    validate_directory(
        source
            .parent()
            .ok_or(t("Origem inválida", "Invalid source"))?,
    )?;
    file._directories.extend(guard_directory(
        destination
            .parent()
            .ok_or(t("Destino inválido", "Invalid destination"))?,
    )?);
    let meta = file.file.metadata().map_err(|e| e.to_string())?;
    if linked(&meta) || !meta.is_file() {
        return Err(t("Origem inválida ou link", "Invalid source or link").into());
    }
    const ERROR_NOT_SAME_DEVICE: i32 = 17;
    match rename_no_replace(&file.file, destination) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(ERROR_NOT_SAME_DEVICE) => {
            copy_then_remove(file, source, destination, digest, delete_open)
        }
        Err(error) => Err(format!(
            "{}: {error}",
            t(
                "Movimentação recusada (conflito ou permissão)",
                "Move refused (conflict or permission)"
            )
        )),
    }
}

fn rename_no_replace(file: &File, destination: &Path) -> io::Result<()> {
    use std::{
        mem::{offset_of, size_of},
        os::windows::{ffi::OsStrExt, io::AsRawHandle},
        ptr,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_RENAME_INFO, FileRenameInfo, SetFileInformationByHandle,
    };
    let too_long = || io::Error::other(t("Destino longo demais", "Destination is too long"));
    let mut name: Vec<u16> = destination.as_os_str().encode_wide().collect();
    if name.contains(&0) {
        return Err(io::Error::other(t(
            "Destino contém caractere inválido",
            "Destination contains an invalid character",
        )));
    }
    let name_bytes = name.len() * 2;
    name.push(0);
    let bytes = offset_of!(FILE_RENAME_INFO, FileName) + name.len() * 2;
    let mut storage = vec![0u64; bytes.max(size_of::<FILE_RENAME_INFO>()).div_ceil(8)];
    // Aligned storage includes the flexible UTF-16 name; zero keeps ReplaceIfExists=false.
    let result = unsafe {
        let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
        (*info).FileNameLength = name_bytes.try_into().map_err(|_| too_long())?;
        ptr::copy_nonoverlapping(
            name.as_ptr(),
            ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
            name.len(),
        );
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileRenameInfo,
            info.cast(),
            bytes.try_into().map_err(|_| too_long())?,
        )
    };
    if result == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

// Windows removes the file when the last handle closes, so this only works on files we hold.
pub(crate) fn delete_open(file: &File) -> io::Result<()> {
    use std::{mem::size_of, os::windows::io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
        FILE_DISPOSITION_INFO, FILE_DISPOSITION_INFO_EX, FileDispositionInfo,
        FileDispositionInfoEx, SetFileInformationByHandle,
    };
    let info = FILE_DISPOSITION_INFO { DeleteFile: true };
    if unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileDispositionInfo,
            (&info as *const FILE_DISPOSITION_INFO).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    } != 0
    {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    // A plain delete refuses read-only files. The extended form isn't available on every file system.
    let info = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
    };
    if unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileDispositionInfoEx,
            (&info as *const FILE_DISPOSITION_INFO_EX).cast(),
            size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
        )
    } == 0
    {
        return Err(error);
    }
    Ok(())
}

/// Where an interrupted copy is left. The digest keeps the name short and lets recovery find it.
fn partial_path(destination: &Path, digest: &str) -> Option<PathBuf> {
    let short = digest.get(..16)?;
    Some(destination.parent()?.join(format!("~do-{short}.partial")))
}

/// Called at startup only after the complete file was verified elsewhere.
pub fn remove_partial(destination: &Path, digest: &str) {
    if let Some(partial) = partial_path(destination, digest) {
        let _ = fs::remove_file(partial);
    }
}

fn with_zone_stream(path: &Path) -> std::ffi::OsString {
    let mut stream = path.as_os_str().to_owned();
    stream.push(":Zone.Identifier");
    stream
}

// shortcut: attributes and other alternate streams aren't copied, keep them if users ask.
pub(crate) fn copy_then_remove(
    file: &mut LockedFile,
    source: &Path,
    destination: &Path,
    digest: &str,
    remove_original: impl FnOnce(&File) -> io::Result<()>,
) -> Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::DELETE;
    let failed = |error: String| {
        format!(
            "{}: {error}",
            t(
                "Não foi possível copiar para a outra unidade; o original foi preservado",
                "Could not copy to the other drive; the original was kept"
            )
        )
    };
    let modified = file
        .file
        .metadata()
        .and_then(|meta| meta.modified())
        .map_err(|e| e.to_string())?;
    let partial =
        partial_path(destination, digest).ok_or(t("Destino inválido", "Invalid destination"))?;
    let mut copy = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .share_mode(0)
        .access_mode(0x80000000 | 0x40000000 | DELETE)
        .open(&partial)
        .map_err(|e| failed(e.to_string()))?;
    let result = (|| -> Result<()> {
        file.file.rewind().map_err(|e| e.to_string())?;
        io::copy(&mut file.file, &mut copy).map_err(|e| e.to_string())?;
        copy.sync_all().map_err(|e| e.to_string())?;
        if fingerprint(&mut copy)? != digest {
            return Err(t(
                "A cópia ficou diferente do original",
                "The copy differs from the original",
            )
            .into());
        }
        // The "downloaded from the internet" mark must survive, or Windows stops warning about the file.
        if let Ok(zone) = fs::read(with_zone_stream(source)) {
            let _ = fs::write(with_zone_stream(&partial), zone);
        }
        copy.set_modified(modified).map_err(|e| e.to_string())?;
        copy.sync_all().map_err(|e| e.to_string())?;
        rename_no_replace(&copy, destination).map_err(|e| e.to_string())?;
        // The final name must be on the disk before the original goes, even if the drive is pulled out.
        copy.sync_all().map_err(|e| e.to_string())
    })();
    if let Err(error) = result {
        let _ = delete_open(&copy);
        return Err(failed(error));
    }
    if let Err(error) = remove_original(&file.file) {
        let outcome = if delete_open(&copy).is_ok() {
            t(
                "Não foi possível remover o original depois da cópia; a cópia foi desfeita",
                "Could not remove the original after copying; the copy was undone",
            )
        } else {
            t(
                "Não foi possível remover o original depois da cópia; a cópia continua no destino",
                "Could not remove the original after copying; the copy is still at the destination",
            )
        };
        return Err(format!("{outcome}: {error}"));
    }
    file.file = copy;
    Ok(())
}

use crate::engine::{self, FileEntry, Preferences, Result, Stamp};
use crate::i18n::t;
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageFormat, ImageReader, Limits};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::File,
    io::{Cursor, Read, Write},
    path::Path,
};

const MAX_INPUT: u64 = 16 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_000_000;
const MAX_DECODED: u64 = 64 * 1024 * 1024;
const MAX_OUTPUT: usize = 2 * 1024 * 1024;
fn changed() -> &'static str {
    t(
        "O arquivo mudou ou não está mais disponível. Atualize a lista e tente novamente.",
        "The file changed or is no longer available. Refresh the list and try again.",
    )
}

#[derive(Default)]
pub struct Access {
    source: String,
    destination: String,
    files: HashMap<String, Stamp>,
}

impl Access {
    pub fn update(&mut self, prefs: &Preferences, files: &[FileEntry]) {
        self.source = prefs.source.clone();
        self.destination = prefs.destination.clone();
        self.files = files
            .iter()
            .filter_map(|file| Some((file.path.clone(), file.stamp.clone()?)))
            .collect();
    }

    pub fn authorize(
        &self,
        prefs: &Preferences,
        path: &str,
        size: u64,
        modified: i64,
    ) -> Result<Stamp> {
        let captured = self
            .files
            .get(path)
            .filter(|stamp| {
                self.source == prefs.source
                    && self.destination == prefs.destination
                    && u64::try_from(stamp.size).ok() == Some(size)
                    && stamp.modified / 1_000_000 == modified
            })
            .ok_or(t(
                "Esta visualização não está mais autorizada. Atualize a lista de arquivos.",
                "This preview is no longer authorized. Refresh the file list.",
            ))?;
        Ok(captured.clone())
    }
}

#[derive(Debug, Serialize)]
pub struct FilePreview {
    pub data_url: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(PartialEq, Eq)]
pub(super) struct Identity(u64, u128);

pub(super) fn identity(file: &File) -> Result<Identity> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx,
        };
        let mut id: FILE_ID_INFO = unsafe { std::mem::zeroed() };
        if unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileIdInfo,
                (&mut id as *mut FILE_ID_INFO).cast(),
                std::mem::size_of::<FILE_ID_INFO>() as u32,
            )
        } == 0
        {
            return Err(t(
                "Não foi possível verificar a identidade do arquivo.",
                "Could not verify the file's identity.",
            )
            .into());
        }
        Ok(Identity(
            id.VolumeSerialNumber,
            u128::from_le_bytes(id.FileId.Identifier),
        ))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let meta = file.metadata().map_err(|_| changed())?;
        Ok(Identity(meta.dev(), meta.ino().into()))
    }
}

#[cfg(windows)]
fn verify_physical_path(file: &File, expected: &Path) -> Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
    let mut buffer = vec![0u16; 32768];
    let length = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(t(
            "Não foi possível confirmar o caminho seguro do arquivo.",
            "Could not confirm the file's safe path.",
        )
        .into());
    }
    let actual = String::from_utf16(&buffer[..length]).map_err(|_| changed())?;
    let normalize = |name: &str| {
        if let Some(tail) = name.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{tail}")
        } else {
            name.strip_prefix(r"\\?\").unwrap_or(name).to_owned()
        }
    };
    // Compare the resolved handle, never canonicalize the requested path after opening.
    if normalize(&actual) != normalize(expected.to_str().ok_or(changed())?) {
        return Err(changed().into());
    }
    Ok(())
}

pub(super) fn open_source(path: &Path, expected: &Stamp) -> Result<(File, Vec<File>)> {
    let parent = path.parent().ok_or(changed())?;
    let directories = engine::guard_directory(parent).map_err(|_| {
        t(
            "A pasta mudou, está inacessível ou contém um link. Atualize a lista.",
            "The folder changed, is inaccessible or contains a link. Refresh the list.",
        )
    })?;
    #[cfg(windows)]
    let file = {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };
        File::options()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
    };
    #[cfg(unix)]
    let mut directories = directories;
    #[cfg(unix)]
    let file: std::io::Result<File> = {
        use std::{
            ffi::CString,
            os::unix::{
                ffi::OsStrExt,
                io::{AsRawFd, FromRawFd},
            },
        };
        // Resolve each component relative to its held parent, never following links.
        directories.push(File::open("/").map_err(|_| changed())?);
        for component in parent
            .components()
            .filter(|part| matches!(part, std::path::Component::Normal(_)))
        {
            let name = CString::new(component.as_os_str().as_bytes()).map_err(|_| changed())?;
            let fd = unsafe {
                libc::openat(
                    directories.last().ok_or(changed())?.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                return Err(changed().into());
            }
            directories.push(unsafe { File::from_raw_fd(fd) });
        }
        let name =
            CString::new(path.file_name().ok_or(changed())?.as_bytes()).map_err(|_| changed())?;
        let fd = unsafe {
            libc::openat(
                directories.last().ok_or(changed())?.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(changed().into());
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    };
    let file = file.map_err(|_| t("Não foi possível ler o arquivo. Ele pode ter sido removido, estar em uso ou sem permissão de leitura.", "Could not read the file. It may have been removed, be in use or lack read permission."))?;
    #[cfg(windows)]
    verify_physical_path(&file, path)?;
    let meta = file.metadata().map_err(|_| changed())?;
    if !meta.is_file() || engine::linked(&meta) || engine::stamp(&meta)? != *expected {
        return Err(changed().into());
    }
    Ok((file, directories))
}

fn verify_source(
    path: &Path,
    expected: &Stamp,
    original: &Identity,
    digest: &blake3::Hash,
) -> Result<()> {
    let (mut file, _directories) = open_source(path, expected)?;
    if identity(&file)? != *original {
        return Err(changed().into());
    }
    if blake3::hash(&read_buffer(&mut file, expected)?) != *digest {
        return Err(changed().into());
    }
    Ok(())
}

fn read_buffer(file: &mut File, expected: &Stamp) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    (&mut *file)
        .take(MAX_INPUT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            t(
                "Não foi possível concluir a leitura da imagem.",
                "Could not finish reading the image.",
            )
        })?;
    if bytes.len() as u64 > MAX_INPUT
        || bytes.len() as i64 != expected.size
        || engine::stamp(&file.metadata().map_err(|_| changed())?)? != *expected
    {
        return Err(changed().into());
    }
    Ok(bytes)
}

pub fn load(path: &Path, expected: &Stamp) -> Result<FilePreview> {
    if engine::temporary(path) {
        return Err(t(
            "Arquivo temporário ou download incompleto. Aguarde a conclusão e atualize a lista.",
            "Temporary file or incomplete download. Wait for it to finish and refresh the list.",
        )
        .into());
    }
    let format = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "png" => Some(ImageFormat::Png),
        "webp" => Some(ImageFormat::WebP),
        "bmp" => Some(ImageFormat::Bmp),
        "gif" => Some(ImageFormat::Gif),
        _ => None,
    };
    let (mut file, directories) = open_source(path, expected)?;
    let original = identity(&file)?;
    let Some(format) = format else {
        return Ok(FilePreview {
            data_url: None,
            width: None,
            height: None,
        });
    };
    if expected.size < 0 || expected.size as u64 > MAX_INPUT {
        return Err(t(
            "Imagem grande demais para visualização segura. O limite é 16 MB.",
            "Image is too large for a safe preview. The limit is 16 MB.",
        )
        .into());
    }
    let bytes = read_buffer(&mut file, expected)?;
    let digest = blake3::hash(&bytes);
    // Release filesystem handles before decoding; recheck the object before delivery.
    drop(file);
    drop(directories);
    let result = decode(&bytes, format)?;
    drop(bytes);
    verify_source(path, expected, &original, &digest)?;
    Ok(result)
}

fn decode(bytes: &[u8], format: ImageFormat) -> Result<FilePreview> {
    let malformed = || {
        t("Não foi possível interpretar a imagem. Ela pode estar danificada ou ter um formato diferente da extensão.", "Could not interpret the image. It may be damaged or have a format that differs from its extension.").to_owned()
    };
    if image::guess_format(bytes).map_err(|_| malformed())? != format {
        return Err(malformed());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(MAX_DECODED);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|error| match error {
        image::ImageError::Limits(_) => t("A imagem excede os limites de resolução ou memória para visualização segura (máximo de 8192 px por lado).", "The image exceeds the resolution or memory limits for a safe preview (8192 px per side at most).").to_owned(),
        _ => malformed(),
    })?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 {
        return Err(malformed());
    }
    if u64::from(width) * u64::from(height) > MAX_PIXELS || decoder.total_bytes() > MAX_DECODED {
        return Err(
            t("A imagem excede os limites de visualização segura: 16 megapixels ou 64 MB decodificados.", "The image exceeds the safe preview limits: 16 megapixels or 64 MB decoded.").into(),
        );
    }
    let orientation = decoder.orientation().map_err(|_| malformed())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| malformed())?;
    image.apply_orientation(orientation);
    let thumbnail = image.thumbnail(640, 640).to_rgba8();
    let mut output = Output(Vec::new());
    image::codecs::png::PngEncoder::new(&mut output)
        .write_image(
            thumbnail.as_raw(),
            thumbnail.width(),
            thumbnail.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|_| {
            t(
                "Não foi possível preparar a miniatura com segurança.",
                "Could not prepare the thumbnail safely.",
            )
        })?;
    Ok(FilePreview {
        data_url: Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(output.0)
        )),
        width: Some(width),
        height: Some(height),
    })
}

struct Output(Vec<u8>);
impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_OUTPUT.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other(t(
                "Limite da miniatura",
                "Thumbnail limit",
            )));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/file_preview.rs"]
mod tests;

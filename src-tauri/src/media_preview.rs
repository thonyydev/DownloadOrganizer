use crate::i18n::t;
use crate::{
    engine::{self, Result, Stamp},
    file_preview::{Identity, identity, open_source},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::http::{Request, Response, StatusCode};

const MAX_FILE: u64 = 8 * 1024 * 1024 * 1024;
const CHUNK: u64 = 1024 * 1024;
const LIFETIME: Duration = Duration::from_secs(4 * 60 * 60);
fn changed() -> &'static str {
    t(
        "A mídia mudou ou não está mais disponível. Feche a visualização e atualize a lista.",
        "The media changed or is no longer available. Close the preview and refresh the list.",
    )
}

#[derive(Clone, Debug, Serialize)]
pub struct MediaPreview {
    pub token: String,
    pub kind: &'static str,
    pub mime: &'static str,
}

pub struct Session {
    path: PathBuf,
    stamp: Stamp,
    file: File,
    _directories: Vec<File>,
    identity: Identity,
    descriptor: MediaPreview,
    created: Instant,
}

impl Session {
    pub fn open(path: &Path, stamp: Stamp) -> Result<Self> {
        if engine::temporary(path) {
            return Err(t(
                "Aguarde o término do download e atualize a lista.",
                "Wait for the download to finish and refresh the list.",
            )
            .into());
        }
        if stamp.size <= 0 || stamp.size as u64 > MAX_FILE {
            return Err(t(
                "Mídia vazia ou grande demais. O limite de visualização é 8 GB.",
                "Media is empty or too large. The preview limit is 8 GB.",
            )
            .into());
        }
        let (mut file, directories) = open_source(path, &stamp)?;
        let original = identity(&file)?;
        let mut header = [0u8; 4096];
        let length = file.read(&mut header).map_err(|_| changed())?;
        let (kind, mime) = media_type(path, &header[..length])?;
        let mut random = [0u8; 32];
        getrandom::fill(&mut random).map_err(|_| {
            t(
                "Não foi possível iniciar uma sessão segura de mídia.",
                "Could not start a secure media session.",
            )
        })?;
        let token = random.iter().map(|byte| format!("{byte:02x}")).collect();
        Ok(Self {
            path: path.to_owned(),
            stamp,
            file,
            _directories: directories,
            identity: original,
            descriptor: MediaPreview { token, kind, mime },
            created: Instant::now(),
        })
    }

    fn verify(&self) -> Result<()> {
        let (file, _directories) = open_source(&self.path, &self.stamp)?;
        if identity(&file)? != self.identity
            || engine::stamp(&self.file.metadata().map_err(|_| changed())?)? != self.stamp
        {
            return Err(changed().into());
        }
        Ok(())
    }
}

// MIME is restricted by extension AND container signature; decoding remains native.
fn media_type(path: &Path, header: &[u8]) -> Result<(&'static str, &'static str)> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mp4 = header.get(4..8) == Some(b"ftyp");
    let result = match extension.as_str() {
        "mp3" if header.starts_with(b"ID3") || (header.len() >= 2 && header[0] == 0xff && header[1] & 0xe0 == 0xe0) => ("audio", "audio/mpeg"),
        "wav" if header.starts_with(b"RIFF") && header.get(8..12) == Some(b"WAVE") => ("audio", "audio/wav"),
        "ogg" | "oga" if header.starts_with(b"OggS") => ("audio", "audio/ogg"),
        "flac" if header.starts_with(b"fLaC") => ("audio", "audio/flac"),
        "m4a" if mp4 => ("audio", "audio/mp4"),
        "mp4" | "m4v" | "mov" if mp4 => ("video", "video/mp4"),
        "webm" if header.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) && header.windows(4).any(|part| part == b"webm") => ("video", "video/webm"),
        _ => return Err(t("Formato de mídia não reconhecido ou arquivo danificado. Nenhuma conversão será realizada.", "Media format not recognized or file damaged. Nothing will be converted.").into()),
    };
    Ok(result)
}

#[derive(Default)]
pub struct Sessions(HashMap<String, Session>);
impl Sessions {
    pub fn insert(&mut self, session: Session) -> Result<MediaPreview> {
        self.0.retain(|_, value| value.created.elapsed() < LIFETIME);
        if self.0.len() >= 4 {
            return Err(t(
                "Feche as outras visualizações de mídia e tente novamente.",
                "Close the other media previews and try again.",
            )
            .into());
        }
        let descriptor = session.descriptor.clone();
        self.0.insert(descriptor.token.clone(), session);
        Ok(descriptor)
    }
    pub fn close(&mut self, token: &str) {
        self.0.remove(token);
    }

    pub fn respond(
        &mut self,
        request: &Request<Vec<u8>>,
        authorize: impl FnOnce(&Path, &Stamp) -> Result<()>,
    ) -> Response<Vec<u8>> {
        let token = request.uri().path().strip_prefix('/').unwrap_or("");
        if request.uri().query().is_some()
            || token.len() != 64
            || !token.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return response(StatusCode::NOT_FOUND, Vec::new());
        }
        if request.method() != "GET" && request.method() != "HEAD" {
            return response(StatusCode::METHOD_NOT_ALLOWED, Vec::new());
        }
        let Some(session) = self.0.get_mut(token) else {
            return response(StatusCode::NOT_FOUND, Vec::new());
        };
        if session.created.elapsed() >= LIFETIME
            || authorize(&session.path, &session.stamp).is_err()
            || session.verify().is_err()
        {
            self.0.remove(token);
            return response(StatusCode::GONE, Vec::new());
        }
        let size = session.stamp.size as u64;
        let mut result = response(StatusCode::OK, Vec::new());
        let headers = result.headers_mut();
        headers.insert(
            "Content-Type",
            session.descriptor.mime.parse().expect("static MIME"),
        );
        headers.insert("Accept-Ranges", "bytes".parse().expect("static header"));
        if request.method() == "HEAD" {
            headers.insert("Content-Length", size.into());
            return result;
        }
        let range = request
            .headers()
            .get("Range")
            .map(|value| value.to_str().unwrap_or(""));
        let Ok((start, end)) = byte_range(range, size) else {
            *result.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
            result.headers_mut().insert(
                "Content-Range",
                format!("bytes */{size}").parse().expect("numeric header"),
            );
            return result;
        };
        let mut bytes = vec![0; (end - start + 1) as usize];
        if session
            .file
            .seek(SeekFrom::Start(start))
            .and_then(|_| session.file.read_exact(&mut bytes))
            .is_err()
            || session.verify().is_err()
        {
            self.0.remove(token);
            return response(StatusCode::GONE, Vec::new());
        }
        // A bounded partial response also bootstraps clients which omit the first Range.
        *result.status_mut() = StatusCode::PARTIAL_CONTENT;
        result.headers_mut().insert(
            "Content-Range",
            format!("bytes {start}-{end}/{size}")
                .parse()
                .expect("numeric header"),
        );
        result
            .headers_mut()
            .insert("Content-Length", bytes.len().into());
        *result.body_mut() = bytes;
        result
    }
}

fn byte_range(value: Option<&str>, size: u64) -> Result<(u64, u64)> {
    if size == 0 {
        return Err(t("Range inválido", "Invalid range").into());
    }
    let Some(value) = value else {
        return Ok((0, size.min(CHUNK) - 1));
    };
    let (start, end) = value
        .strip_prefix("bytes=")
        .and_then(|value| value.split_once('-'))
        .ok_or(t("Range inválido", "Invalid range"))?;
    let (start, end) = if start.is_empty() {
        let suffix: u64 = end
            .parse()
            .map_err(|_| t("Range inválido", "Invalid range"))?;
        if suffix == 0 {
            return Err(t("Range inválido", "Invalid range").into());
        }
        (size.saturating_sub(suffix), size - 1)
    } else {
        let start: u64 = start
            .parse()
            .map_err(|_| t("Range inválido", "Invalid range"))?;
        let end = if end.is_empty() {
            size - 1
        } else {
            end.parse()
                .map_err(|_| t("Range inválido", "Invalid range"))?
        };
        (start, end.min(size - 1))
    };
    if start >= size || end < start {
        return Err(t("Range inválido", "Invalid range").into());
    }
    Ok((start, end.min(start.saturating_add(CHUNK - 1))))
}

pub fn response(status: StatusCode, bytes: Vec<u8>) -> Response<Vec<u8>> {
    let mut response = Response::new(bytes);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert("Cache-Control", "no-store".parse().expect("static header"));
    headers.insert(
        "X-Content-Type-Options",
        "nosniff".parse().expect("static header"),
    );
    // Anonymous media and Web Audio need CORS; the handler accepts only application origins.
    headers.insert(
        "Access-Control-Allow-Origin",
        "http://tauri.localhost".parse().expect("static header"),
    );
    headers.insert(
        "Access-Control-Expose-Headers",
        "Content-Range, Content-Length, Accept-Ranges"
            .parse()
            .expect("static header"),
    );
    response
}

#[cfg(test)]
#[path = "tests/media_preview.rs"]
mod tests;

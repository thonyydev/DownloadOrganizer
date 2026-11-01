use super::*;
use std::fs;

fn temp_directory() -> tempfile::TempDir {
    // Production scan returns canonical paths; TEMP may use case/8.3 aliases on Windows CI.
    let root = fs::canonicalize(std::env::temp_dir()).unwrap();
    tempfile::tempdir_in(root).unwrap()
}

fn sample(format: ImageFormat) -> (tempfile::TempDir, std::path::PathBuf, Stamp) {
    let temp = temp_directory();
    let path = temp
        .path()
        .join(format!("image.{}", format.extensions_str()[0]));
    DynamicImage::new_rgb8(32, 24)
        .save_with_format(&path, format)
        .unwrap();
    let expected = engine::stamp(&fs::metadata(&path).unwrap()).unwrap();
    (temp, path, expected)
}

#[test]
fn supported_images_become_bounded_png_without_modifying_the_source() {
    for format in [
        ImageFormat::Jpeg,
        ImageFormat::Png,
        ImageFormat::WebP,
        ImageFormat::Bmp,
        ImageFormat::Gif,
    ] {
        let (_temp, path, stamp) = sample(format);
        let original = fs::read(&path).unwrap();
        let response = load(&path, &stamp).unwrap();
        assert_eq!((response.width, response.height), (Some(32), Some(24)));
        let bytes = STANDARD
            .decode(
                response
                    .data_url
                    .unwrap()
                    .strip_prefix("data:image/png;base64,")
                    .unwrap(),
            )
            .unwrap();
        assert!(bytes.len() <= MAX_OUTPUT);
        assert_eq!(image::guess_format(&bytes).unwrap(), ImageFormat::Png);
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(engine::stamp(&fs::metadata(path).unwrap()).unwrap(), stamp);
    }
}

#[test]
fn thumbnail_keeps_resolution_metadata_and_limits_output_dimensions() {
    let temp = temp_directory();
    let path = temp.path().join("large.png");
    DynamicImage::new_rgb8(1200, 800).save(&path).unwrap();
    let response = load(
        &path,
        &engine::stamp(&fs::metadata(&path).unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!((response.width, response.height), (Some(1200), Some(800)));
    let bytes = STANDARD
        .decode(
            response
                .data_url
                .unwrap()
                .strip_prefix("data:image/png;base64,")
                .unwrap(),
        )
        .unwrap();
    let thumbnail = image::load_from_memory(&bytes).unwrap();
    assert!(thumbnail.width() <= 640 && thumbnail.height() <= 640);
}

#[test]
fn gif_returns_only_the_first_static_frame() {
    let temp = temp_directory();
    let path = temp.path().join("animated.gif");
    let mut encoder = image::codecs::gif::GifEncoder::new(File::create(&path).unwrap());
    for color in [[255, 0, 0, 255], [0, 0, 255, 255]] {
        encoder
            .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                8,
                8,
                image::Rgba(color),
            )))
            .unwrap();
    }
    drop(encoder);
    let response = load(
        &path,
        &engine::stamp(&fs::metadata(&path).unwrap()).unwrap(),
    )
    .unwrap();
    let bytes = STANDARD
        .decode(
            response
                .data_url
                .unwrap()
                .strip_prefix("data:image/png;base64,")
                .unwrap(),
        )
        .unwrap();
    assert_eq!(
        image::load_from_memory(&bytes)
            .unwrap()
            .to_rgba8()
            .get_pixel(0, 0)
            .0,
        [255, 0, 0, 255]
    );
}

#[test]
fn unsupported_content_is_metadata_only_and_never_interpreted_as_markup() {
    let temp = temp_directory();
    for extension in ["svg", "html", "exe", "pdf", "mp4", "mp3", "txt"] {
        let path = temp.path().join(format!("unsupported.{extension}"));
        let contents = b"<svg onload='never-run'><script>invalid</script></svg>";
        fs::write(&path, contents).unwrap();
        let response = load(
            &path,
            &engine::stamp(&fs::metadata(&path).unwrap()).unwrap(),
        )
        .unwrap();
        assert!(response.data_url.is_none());
        assert!(response.width.is_none() && response.height.is_none());
        assert_eq!(fs::read(path).unwrap(), contents);
    }
}

#[test]
fn missing_changed_and_temporary_files_fail_without_writes() {
    let (temp, path, stamp) = sample(ImageFormat::Png);
    fs::write(&path, b"modified").unwrap();
    assert!(load(&path, &stamp).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"modified");
    fs::remove_file(&path).unwrap();
    assert!(load(&path, &stamp).is_err());
    let temporary = temp.path().join(".download.png");
    fs::write(&temporary, b"incomplete").unwrap();
    assert!(load(&temporary, &stamp).unwrap_err().contains("temporário"));
}

#[test]
fn oversized_input_is_rejected_before_allocating_the_file_contents() {
    let temp = temp_directory();
    let path = temp.path().join("huge.png");
    File::create(&path).unwrap().set_len(MAX_INPUT + 1).unwrap();
    let expected = engine::stamp(&fs::metadata(&path).unwrap()).unwrap();
    assert!(load(&path, &expected).err().unwrap().contains("16 MB"));
    assert_eq!(fs::metadata(path).unwrap().len(), MAX_INPUT + 1);
}

fn bitmap_header(width: i32, height: i32) -> Vec<u8> {
    let mut bytes = vec![0; 54];
    bytes[..2].copy_from_slice(b"BM");
    bytes[2..6].copy_from_slice(&54u32.to_le_bytes());
    bytes[10..14].copy_from_slice(&54u32.to_le_bytes());
    bytes[14..18].copy_from_slice(&40u32.to_le_bytes());
    bytes[18..22].copy_from_slice(&width.to_le_bytes());
    bytes[22..26].copy_from_slice(&height.to_le_bytes());
    bytes[26..28].copy_from_slice(&1u16.to_le_bytes());
    bytes[28..30].copy_from_slice(&24u16.to_le_bytes());
    bytes
}

#[test]
fn dimensional_and_pixel_bombs_fail_before_decoding_buffers() {
    assert!(decode(&bitmap_header(0, 0), ImageFormat::Bmp).is_err());
    assert!(decode(&bitmap_header(100_000, 100_000), ImageFormat::Bmp).is_err());
    assert!(
        decode(&bitmap_header(8192, 8192), ImageFormat::Bmp)
            .err()
            .unwrap()
            .contains("16 megapixels")
    );
    let mut output = Output(Vec::new());
    assert!(output.write(&vec![0; MAX_OUTPUT + 1]).is_err());
    assert!(output.0.is_empty());
}

#[test]
fn malformed_truncated_or_disguised_images_fail_safely() {
    for contents in [b"<svg/>".as_slice(), b"\x89PNG\r\n\x1a\n", b"GIF89a", b"BM"] {
        assert!(decode(contents, ImageFormat::Png).is_err());
    }
    let (_temp, path, _) = sample(ImageFormat::Png);
    assert!(decode(&fs::read(path).unwrap(), ImageFormat::Jpeg).is_err());
}

#[test]
fn only_the_latest_authorized_snapshot_and_configuration_can_grant_access() {
    let temp = temp_directory();
    let source = engine::validate_directory(temp.path()).unwrap();
    let path = source.join("one.png");
    DynamicImage::new_rgb8(2, 2).save(&path).unwrap();
    let mut prefs = Preferences {
        source: source.to_str().unwrap().into(),
        destination: source.to_str().unwrap().into(),
        automatic: false,
        enabled_categories: vec!["images".into()],
        theme: "dark".into(),
        language: "system".into(),

        notifications: true,

        updates: true,

        autostart: false,
    };
    let files = engine::scan(&prefs).unwrap();
    let entry = &files[0];
    let mut access = Access::default();
    assert!(
        access
            .authorize(&prefs, &entry.path, entry.size, entry.modified)
            .is_err()
    );
    access.update(&prefs, &files);
    assert!(
        access
            .authorize(&prefs, &entry.path, entry.size, entry.modified)
            .is_ok()
    );
    for unauthorized in [
        source.join("missing.png"),
        source.join("../outside.png"),
        temp.path().join("other.png"),
    ] {
        assert!(
            access
                .authorize(
                    &prefs,
                    unauthorized.to_str().unwrap(),
                    entry.size,
                    entry.modified
                )
                .is_err()
        );
    }
    assert!(
        access
            .authorize(&prefs, &entry.path, entry.size + 1, entry.modified)
            .is_err()
    );
    assert!(
        access
            .authorize(&prefs, &entry.path, entry.size, entry.modified + 1)
            .is_err()
    );
    prefs.source = "different".into();
    assert!(
        access
            .authorize(&prefs, &entry.path, entry.size, entry.modified)
            .is_err()
    );
    prefs.source = source.to_str().unwrap().into();
    prefs.destination = "different".into();
    assert!(
        access
            .authorize(&prefs, &entry.path, entry.size, entry.modified)
            .is_err()
    );
    prefs.destination = source.to_str().unwrap().into();
    access.update(&prefs, &[]);
    assert!(
        access
            .authorize(&prefs, &entry.path, entry.size, entry.modified)
            .is_err()
    );
}

#[test]
fn replacement_with_identical_size_and_timestamp_fails_identity_revalidation() {
    let (_temp, path, stamp) = sample(ImageFormat::Png);
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    let (file, directories) = open_source(&path, &stamp).unwrap();
    let original = identity(&file).unwrap();
    let contents = fs::read(&path).unwrap();
    drop(file);
    drop(directories);
    let old = path.with_extension("original");
    fs::rename(&path, &old).unwrap();
    fs::write(&path, contents).unwrap();
    File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert_eq!(engine::stamp(&fs::metadata(&path).unwrap()).unwrap(), stamp);
    assert!(
        verify_source(
            &path,
            &stamp,
            &original,
            &blake3::hash(&fs::read(&old).unwrap())
        )
        .is_err()
    );
    assert!(old.exists());
}

#[test]
fn changed_content_with_original_identity_size_and_time_is_rejected() {
    let (_temp, path, stamp) = sample(ImageFormat::Png);
    let meta = fs::metadata(&path).unwrap();
    let (file, directories) = open_source(&path, &stamp).unwrap();
    let original = identity(&file).unwrap();
    let mut content = fs::read(&path).unwrap();
    let digest = blake3::hash(&content);
    drop(file);
    drop(directories);
    content[0] ^= 1;
    fs::write(&path, content).unwrap();
    File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(meta.modified().unwrap()))
        .unwrap();
    assert_eq!(engine::stamp(&fs::metadata(&path).unwrap()).unwrap(), stamp);
    assert!(verify_source(&path, &stamp, &original, &digest).is_err());
}

#[test]
fn windows_preview_denies_writes_and_replacement_only_during_reading() {
    let (_temp, path, stamp) = sample(ImageFormat::Png);
    let (file, directories) = open_source(&path, &stamp).unwrap();
    assert!(File::options().write(true).open(&path).is_err());
    assert!(fs::rename(&path, path.with_extension("replacement")).is_err());
    drop(file);
    drop(directories);
    assert!(File::options().write(true).open(&path).is_ok());
}

#[test]
fn read_only_images_do_not_require_delete_or_write_permission() {
    let (_temp, path, stamp) = sample(ImageFormat::Png);
    let original_permissions = fs::metadata(&path).unwrap().permissions();
    let mut permissions = original_permissions.clone();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(load(&path, &stamp).is_ok());
    fs::set_permissions(path, original_permissions).unwrap();
}

#[test]
fn windows_junction_ancestors_never_authorize_reading_their_targets() {
    let (temp, path, stamp) = sample(ImageFormat::Png);
    let junction = temp.path().join("redirect");
    let target = temp.path().join("target");
    fs::create_dir(&target).unwrap();
    let target_file = target.join("image.png");
    fs::copy(path, &target_file).unwrap();
    let expected = engine::stamp(&fs::metadata(&target_file).unwrap()).unwrap();
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&target)
        .output()
        .unwrap();
    assert!(status.status.success());
    // Simulate opening through a redirected ancestor after the path check.
    let redirected = File::open(junction.join("image.png")).unwrap();
    assert!(verify_physical_path(&redirected, &junction.join("image.png")).is_err());
    drop(redirected);
    assert!(load(&junction.join("image.png"), &expected).is_err());
    assert!(load(&junction, &stamp).is_err());
    fs::remove_dir(junction).unwrap();
    assert!(target_file.is_file());
}

#[test]
fn physical_path_checks_preserve_unicode_names_and_verbatim_paths() {
    let temp = temp_directory();
    let path = temp.path().join("Visão_日本語.PNG");
    DynamicImage::new_rgb8(4, 3)
        .save_with_format(&path, ImageFormat::Png)
        .unwrap();
    let stamp = engine::stamp(&fs::metadata(&path).unwrap()).unwrap();
    assert!(load(&path, &stamp).is_ok());
    let verbatim = fs::canonicalize(&path).unwrap();
    assert!(load(&verbatim, &stamp).is_ok());
    let text = verbatim.to_str().unwrap();
    let ordinary = if let Some(tail) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{tail}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(text).to_owned()
    };
    assert!(load(Path::new(&ordinary), &stamp).is_ok());
}

#[test]
fn scan_authorizes_canonical_previews_for_case_and_short_path_aliases() {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;
    let temp = temp_directory();
    let folder = temp.path().join("MixedCaseParent");
    fs::create_dir(&folder).unwrap();
    let path = folder.join("Visão_日本語.PNG");
    DynamicImage::new_rgb8(4, 3)
        .save_with_format(&path, ImageFormat::Png)
        .unwrap();
    let differently_cased = temp.path().join("mixedcaseparent");
    let name: Vec<u16> = folder.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut buffer = vec![0u16; 32768];
    let length =
        unsafe { GetShortPathNameW(name.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) }
            as usize;
    assert!(length > 0 && length < buffer.len());
    // If 8.3 generation is disabled, Windows may return the original spelling.
    let short = std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length]));
    let original = fs::read(&path).unwrap();
    for source in [differently_cased, short] {
        let prefs = Preferences {
            source: source.to_str().unwrap().into(),
            destination: source.to_str().unwrap().into(),
            automatic: false,
            enabled_categories: vec!["images".into()],
            theme: "dark".into(),
            language: "system".into(),

            notifications: true,

            updates: true,

            autostart: false,
        };
        let files = engine::scan(&prefs).unwrap();
        let entry = files
            .iter()
            .find(|entry| entry.name == "Visão_日本語.PNG")
            .unwrap();
        assert_eq!(Path::new(&entry.path), fs::canonicalize(&path).unwrap());
        let mut access = Access::default();
        access.update(&prefs, &files);
        let stamp = access
            .authorize(&prefs, &entry.path, entry.size, entry.modified)
            .unwrap();
        let raw_alias = source.join("visão_日本語.png");
        assert_eq!(
            engine::stamp(&fs::metadata(&raw_alias).unwrap()).unwrap(),
            stamp
        );
        assert!(
            access
                .authorize(
                    &prefs,
                    raw_alias.to_str().unwrap(),
                    entry.size,
                    entry.modified
                )
                .is_err()
        );
        let response = load(Path::new(&entry.path), &stamp).unwrap();
        assert_eq!((response.width, response.height), (Some(4), Some(3)));
    }
    assert_eq!(fs::read(path).unwrap(), original);
}

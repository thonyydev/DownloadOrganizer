use super::*;
use std::fs;
use tauri::http::header;

fn sample(extension: &str, contents: &[u8]) -> (tempfile::TempDir, PathBuf, Stamp) {
    let temp = tempfile::tempdir().unwrap();
    let folder = fs::canonicalize(temp.path()).unwrap();
    let path = folder.join(format!("sample.{extension}"));
    fs::write(&path, contents).unwrap();
    let stamp = engine::stamp(&fs::metadata(&path).unwrap()).unwrap();
    (temp, path, stamp)
}
fn request(token: &str, range: Option<&str>) -> Request<Vec<u8>> {
    let mut builder = Request::builder().uri(format!("media-preview://localhost/{token}"));
    if let Some(range) = range {
        builder = builder.header(header::RANGE, range);
    }
    builder.body(Vec::new()).unwrap()
}

#[test]
fn supported_container_signatures_are_required_and_never_executed() {
    for (extension, contents, kind, mime) in [
        ("mp3", b"ID3synthetic".as_slice(), "audio", "audio/mpeg"),
        ("wav", b"RIFFabcdWAVEsynthetic", "audio", "audio/wav"),
        ("ogg", b"OggSsynthetic", "audio", "audio/ogg"),
        ("m4a", b"abcdftypM4Asynthetic", "audio", "audio/mp4"),
        ("flac", b"fLaCsynthetic", "audio", "audio/flac"),
        ("mp4", b"abcdftypisomsynthetic", "video", "video/mp4"),
        (
            "webm",
            b"\x1a\x45\xdf\xa3webmsynthetic",
            "video",
            "video/webm",
        ),
    ] {
        let (_temp, path, stamp) = sample(extension, contents);
        let session = Session::open(&path, stamp.clone()).unwrap();
        assert_eq!(
            (session.descriptor.kind, session.descriptor.mime),
            (kind, mime)
        );
        assert_eq!(fs::read(&path).unwrap(), contents);
        assert_eq!(engine::stamp(&fs::metadata(&path).unwrap()).unwrap(), stamp);
    }
    for extension in ["mp3", "wav", "mp4", "webm", "exe", "svg"] {
        let (_temp, path, stamp) = sample(extension, b"<script>never execute</script>");
        assert!(Session::open(&path, stamp).is_err());
    }
}

#[test]
fn ranges_support_seek_suffixes_and_bound_memory() {
    assert_eq!(byte_range(None, CHUNK * 5).unwrap(), (0, CHUNK - 1));
    assert_eq!(
        byte_range(Some("bytes=123-"), CHUNK * 5).unwrap(),
        (123, 123 + CHUNK - 1)
    );
    assert_eq!(byte_range(Some("bytes=10-30"), 100).unwrap(), (10, 30));
    assert_eq!(byte_range(Some("bytes=-10"), 100).unwrap(), (90, 99));
    assert_eq!(byte_range(Some("bytes=-999"), 100).unwrap(), (0, 99));
    assert_eq!(byte_range(Some("bytes=90-999"), 100).unwrap(), (90, 99));
    for value in [
        "bytes=100-",
        "bytes=9-1",
        "bytes=-0",
        "bytes=",
        "bytes=0-1,4-9",
        "bytes=a-z",
        "bytes=18446744073709551616-",
        "bytes=1--1",
        "items=0-1",
    ] {
        assert!(byte_range(Some(value), 100).is_err(), "{value}");
    }
    assert!(byte_range(None, 0).is_err());
}

#[test]
fn streaming_is_bounded_read_only_and_supports_seeking_near_end() {
    let (_temp, path, _) = sample("mp3", b"ID3initial audio bytes");
    let mut options = File::options();
    options.write(true);
    options.open(&path).unwrap().set_len(CHUNK * 5).unwrap();
    let stamp = engine::stamp(&fs::metadata(&path).unwrap()).unwrap();
    let mut sessions = Sessions::default();
    let descriptor = sessions
        .insert(Session::open(&path, stamp.clone()).unwrap())
        .unwrap();
    let response = sessions.respond(&request(&descriptor.token, Some("bytes=0-")), |_, _| Ok(()));
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.body().len(), CHUNK as usize);
    assert_eq!(
        response.headers()["Content-Range"],
        format!("bytes 0-{}/{}", CHUNK - 1, CHUNK * 5)
    );
    assert_eq!(response.headers()["Content-Type"], "audio/mpeg");
    assert_eq!(response.headers()["Cache-Control"], "no-store");
    assert_eq!(response.headers()["X-Content-Type-Options"], "nosniff");
    let response = sessions.respond(
        &request(&descriptor.token, Some("bytes=-16")),
        |_, _| Ok(()),
    );
    assert_eq!(response.body(), &[0u8; 16]);
    let mut head = request(&descriptor.token, None);
    *head.method_mut() = tauri::http::Method::HEAD;
    let response = sessions.respond(&head, |_, _| Ok(()));
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.body().is_empty());
    assert_eq!(
        response.headers()["Content-Length"],
        (CHUNK * 5).to_string()
    );
    let response = sessions.respond(
        &request(&descriptor.token, Some("bytes=9999999999-")),
        |_, _| Ok(()),
    );
    assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(
        response.headers()["Content-Range"],
        format!("bytes */{}", CHUNK * 5)
    );
    assert_eq!(engine::stamp(&fs::metadata(path).unwrap()).unwrap(), stamp);
}

#[test]
fn tokens_are_unique_revocable_and_never_resolve_arbitrary_paths() {
    let (_temp, path, stamp) = sample("wav", b"RIFFabcdWAVE123456789");
    let mut sessions = Sessions::default();
    let one = sessions
        .insert(Session::open(&path, stamp.clone()).unwrap())
        .unwrap();
    let two = sessions
        .insert(Session::open(&path, stamp).unwrap())
        .unwrap();
    assert_ne!(one.token, two.token);
    for path in ["../../secret", "C:/secret", "unknown", &"a".repeat(64)] {
        assert_eq!(
            sessions
                .respond(&request(path, None), |_, _| panic!(
                    "unauthorized request must not reach filesystem"
                ))
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    sessions.close(&one.token);
    sessions.close(&one.token);
    assert_eq!(
        sessions
            .respond(&request(&one.token, None), |_, _| Ok(()))
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        sessions
            .respond(&request(&two.token, None), |_, _| Ok(()))
            .status(),
        StatusCode::PARTIAL_CONTENT
    );
    let mut post = request(&two.token, None);
    *post.method_mut() = tauri::http::Method::POST;
    assert_eq!(
        sessions.respond(&post, |_, _| Ok(())).status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
    let response = sessions.respond(&request(&two.token, None), |_, _| {
        Err("snapshot ou preferências mudaram".into())
    });
    assert_eq!(response.status(), StatusCode::GONE);
    assert!(sessions.0.is_empty());
}

#[test]
fn session_expiry_and_capacity_are_bounded_without_evicting_another_preview() {
    let (_temp, path, stamp) = sample("mp3", b"ID3sample");
    let mut sessions = Sessions::default();
    for _ in 0..4 {
        sessions
            .insert(Session::open(&path, stamp.clone()).unwrap())
            .unwrap();
    }
    assert!(
        sessions
            .insert(Session::open(&path, stamp.clone()).unwrap())
            .is_err()
    );
    let token = sessions.0.keys().next().unwrap().clone();
    sessions.0.get_mut(&token).unwrap().created = Instant::now() - LIFETIME;
    assert_eq!(
        sessions
            .respond(&request(&token, None), |_, _| Ok(()))
            .status(),
        StatusCode::GONE
    );
    sessions
        .insert(Session::open(&path, stamp).unwrap())
        .unwrap();
}

#[test]
fn stale_missing_oversized_and_temporary_media_fail_before_streaming() {
    let (_temp, path, stamp) = sample("mp3", b"ID3sample");
    assert!(
        Session::open(
            &path,
            Stamp {
                size: MAX_FILE as i64 + 1,
                ..stamp.clone()
            }
        )
        .is_err()
    );
    assert!(
        Session::open(
            &path,
            Stamp {
                size: 0,
                ..stamp.clone()
            }
        )
        .is_err()
    );
    fs::write(&path, b"changed").unwrap();
    assert!(Session::open(&path, stamp.clone()).is_err());
    fs::remove_file(&path).unwrap();
    assert!(Session::open(&path, stamp.clone()).is_err());
    assert!(Session::open(&path.with_file_name(".download.mp3"), stamp).is_err());
}

#[test]
fn media_access_requires_the_current_authorized_snapshot() {
    let (temp, path, _) = sample("wav", b"RIFFabcdWAVEsynthetic");
    let source = fs::canonicalize(temp.path())
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    let mut prefs = engine::Preferences {
        source: source.clone(),
        destination: source,
        automatic: false,
        enabled_categories: vec!["audio".into()],
        theme: "dark".into(),
    };
    let files = engine::scan(&prefs).unwrap();
    let entry = files
        .iter()
        .find(|entry| Path::new(&entry.path) == path)
        .unwrap();
    let mut access = crate::file_preview::Access::default();
    assert!(
        access
            .authorize(&prefs, &entry.path, entry.size, entry.modified)
            .is_err()
    );
    access.update(&prefs, &files);
    let stamp = access
        .authorize(&prefs, &entry.path, entry.size, entry.modified)
        .unwrap();
    let mut sessions = Sessions::default();
    let token = sessions
        .insert(Session::open(&path, stamp).unwrap())
        .unwrap()
        .token;
    prefs.source = "changed".into();
    assert_eq!(
        sessions
            .respond(&request(&token, None), |_, stamp| access
                .authorize(
                    &prefs,
                    &entry.path,
                    stamp.size as u64,
                    stamp.modified / 1_000_000
                )
                .map(|_| ()))
            .status(),
        StatusCode::GONE
    );
}

#[cfg(windows)]
#[test]
fn windows_session_guards_against_writes_replacement_and_junctions_until_closed() {
    let (temp, path, stamp) = sample("mp3", b"ID3sample");
    let mut sessions = Sessions::default();
    let token = sessions
        .insert(Session::open(&path, stamp.clone()).unwrap())
        .unwrap()
        .token;
    assert!(File::options().write(true).open(&path).is_err());
    assert!(fs::rename(&path, path.with_extension("old")).is_err());
    sessions.close(&token);
    assert!(File::options().write(true).open(&path).is_ok());
    let junction = temp.path().join("redirect");
    let target = temp.path().join("target");
    fs::create_dir(&target).unwrap();
    fs::copy(&path, target.join("sample.mp3")).unwrap();
    let result = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&target)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(Session::open(&junction.join("sample.mp3"), stamp).is_err());
    fs::remove_dir(junction).unwrap();
    assert_eq!(fs::read(path).unwrap(), b"ID3sample");
}

#[cfg(unix)]
#[test]
fn unix_replacement_modification_and_symlinks_are_rejected_between_ranges() {
    let (temp, path, stamp) = sample("mp3", b"ID3sample");
    let mut sessions = Sessions::default();
    let token = sessions
        .insert(Session::open(&path, stamp.clone()).unwrap())
        .unwrap()
        .token;
    let link = temp.path().join("link.mp3");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    assert!(Session::open(&link, stamp).is_err());
    fs::rename(&path, path.with_extension("old")).unwrap();
    fs::write(&path, b"ID3changed").unwrap();
    assert_eq!(
        sessions
            .respond(&request(&token, None), |_, _| Ok(()))
            .status(),
        StatusCode::GONE
    );
}

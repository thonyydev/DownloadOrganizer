use super::*;
use crate::startup::{StartupError, initialize};
use rusqlite::Connection;

#[test]
fn healthy_startup_preserves_preferences_and_history_on_reopen() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("data");
    let source = temp.path().join("source");
    fs::create_dir(&source).unwrap();
    let source = source.to_str().unwrap();
    let runtime = initialize(&data, source).unwrap();
    let preferences = runtime.store.preferences().unwrap();
    assert_eq!(preferences.source, source);
    assert!(!preferences.automatic);
    assert!(runtime.watcher.is_none() && runtime.session.is_none());
    let id = runtime.store.begin("manual").unwrap();
    drop(runtime);
    let runtime = initialize(&data, "different-default").unwrap();
    assert_eq!(runtime.store.preferences().unwrap(), preferences);
    assert_eq!(runtime.store.operation(id).unwrap().id, id);
}

#[test]
fn invalid_database_is_not_deleted_or_recreated() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("organizer.sqlite3");
    let original = b"invalid synthetic database";
    fs::write(&path, original).unwrap();
    assert_eq!(
        initialize(temp.path(), "").err(),
        Some(StartupError::DatabaseCorrupt)
    );
    assert_eq!(fs::read(path).unwrap(), original);
}

#[test]
fn corrupt_sqlite_page_is_reported_without_replacement() {
    let temp = tempfile::tempdir().unwrap();
    drop(initialize(temp.path(), "").unwrap());
    let path = temp.path().join("organizer.sqlite3");
    let mut bytes = fs::read(&path).unwrap();
    // Keep the SQLite header, but invalidate the first b-tree page type.
    bytes[100] = 0xff;
    fs::write(&path, &bytes).unwrap();
    assert_eq!(
        initialize(temp.path(), "").err(),
        Some(StartupError::DatabaseCorrupt)
    );
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn unavailable_data_directory_can_start_after_the_obstruction_is_resolved() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("data");
    fs::write(&data, b"preserve this file").unwrap();
    assert_eq!(
        initialize(&data, "").err(),
        Some(StartupError::DataDirectory)
    );
    assert_eq!(fs::read(&data).unwrap(), b"preserve this file");
    // Remove only the synthetic obstruction, as a user would after closing the app.
    fs::remove_file(&data).unwrap();
    assert!(initialize(&data, "").is_ok());
}

#[test]
fn failed_lock_preserves_database_and_sqlite_sidecars_then_allows_reopening() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = initialize(temp.path(), "").unwrap();
    let paths = [
        "organizer.sqlite3",
        "organizer.sqlite3-wal",
        "organizer.sqlite3-shm",
    ];
    let contents: Vec<_> = paths
        .iter()
        .map(|name| fs::read(temp.path().join(name)).unwrap())
        .collect();
    assert_eq!(
        initialize(temp.path(), "").err(),
        Some(StartupError::DatabaseLocked)
    );
    for (name, content) in paths.iter().zip(contents) {
        assert_eq!(fs::read(temp.path().join(name)).unwrap(), content);
    }
    drop(runtime);
    assert!(initialize(temp.path(), "").is_ok());
}

#[cfg(windows)]
#[test]
fn windows_database_sharing_violation_is_safe_and_recoverable() {
    use std::os::windows::fs::OpenOptionsExt;
    let temp = tempfile::tempdir().unwrap();
    drop(initialize(temp.path(), "").unwrap());
    let path = temp.path().join("organizer.sqlite3");
    let original = fs::read(&path).unwrap();
    let exclusive = File::options()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert_eq!(
        initialize(temp.path(), "").err(),
        Some(StartupError::StorageAccess)
    );
    drop(exclusive);
    assert_eq!(fs::read(path).unwrap(), original);
    assert!(initialize(temp.path(), "").is_ok());
}

#[test]
fn invalid_json_is_preserved_until_explicitly_corrected() {
    for json in ["{invalid", r#"{"automatic":true}"#] {
        let temp = tempfile::tempdir().unwrap();
        let runtime = initialize(temp.path(), "").unwrap();
        let original = runtime.store.preferences().unwrap();
        let id = runtime.store.begin("manual").unwrap();
        runtime
            .store
            .db
            .execute("UPDATE preferences SET value=?1", [json])
            .unwrap();
        drop(runtime);
        assert_eq!(
            initialize(temp.path(), "").err(),
            Some(StartupError::Preferences)
        );
        let db = Connection::open(temp.path().join("organizer.sqlite3")).unwrap();
        assert_eq!(
            db.query_row("SELECT value FROM preferences", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            json
        );
        assert_eq!(
            db.query_row("SELECT id FROM operations", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            id
        );
        db.execute(
            "UPDATE preferences SET value=?1",
            [serde_json::to_string(&original).unwrap()],
        )
        .unwrap();
        drop(db);
        assert!(initialize(temp.path(), "").is_ok());
    }
}

#[test]
fn missing_preferences_in_existing_database_do_not_create_silent_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = initialize(temp.path(), "").unwrap();
    let id = runtime.store.begin("manual").unwrap();
    runtime
        .store
        .db
        .execute("DELETE FROM preferences", [])
        .unwrap();
    drop(runtime);
    assert_eq!(
        initialize(temp.path(), "").err(),
        Some(StartupError::Preferences)
    );
    let db = Connection::open(temp.path().join("organizer.sqlite3")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM preferences", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT id FROM operations", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        id
    );
}

#[test]
fn failed_journal_recovery_never_starts_automation_or_moves_files() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    fs::create_dir(&source).unwrap();
    let file = source.join("synthetic.txt");
    old_file(&file, b"keep");
    let destination = source.join("Documentos/synthetic.txt");
    let runtime = initialize(temp.path(), source.to_str().unwrap()).unwrap();
    let mut preferences = runtime.store.preferences().unwrap();
    preferences.automatic = true;
    runtime
        .store
        .db
        .execute(
            "UPDATE preferences SET value=?1",
            [serde_json::to_string(&preferences).unwrap()],
        )
        .unwrap();
    let operation = runtime.store.begin("manual").unwrap();
    let movement = runtime
        .store
        .record(
            operation,
            file.to_str().unwrap(),
            destination.to_str().unwrap(),
            "pending",
            &Stamp {
                size: 4,
                modified: 0,
            },
            "synthetic",
        )
        .unwrap();
    runtime.store.db.execute_batch("CREATE TRIGGER fail_recovery BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    drop(runtime);
    assert_eq!(
        initialize(temp.path(), "").err(),
        Some(StartupError::Recovery)
    );
    let db = Connection::open(temp.path().join("organizer.sqlite3")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT status FROM movements WHERE id=?1",
            [movement],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        "pending"
    );
    assert_eq!(fs::read(&file).unwrap(), b"keep");
    assert!(!destination.exists());
    db.execute_batch("DROP TRIGGER fail_recovery;").unwrap();
    drop(db);
    let runtime = initialize(temp.path(), "").unwrap();
    assert!(runtime.store.preferences().unwrap().automatic);
    assert!(runtime.watcher.is_none() && runtime.session.is_none());
    assert_eq!(runtime.store.operation(operation).unwrap().id, operation);
    assert_ne!(
        runtime.store.movements(operation).unwrap()[0].status,
        "pending"
    );
    assert_eq!(fs::read(file).unwrap(), b"keep");
    assert!(!destination.exists());
}

#[test]
fn newer_database_version_is_not_reset() {
    let temp = tempfile::tempdir().unwrap();
    let runtime = initialize(temp.path(), "").unwrap();
    let id = runtime.store.begin("manual").unwrap();
    runtime
        .store
        .db
        .pragma_update(None, "user_version", 2)
        .unwrap();
    drop(runtime);
    assert_eq!(
        initialize(temp.path(), "").err(),
        Some(StartupError::NewerVersion)
    );
    let db = Connection::open(temp.path().join("organizer.sqlite3")).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.query_row("SELECT id FROM operations", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        id
    );
}

#[test]
fn sqlite_errors_have_actionable_messages_without_technical_details_or_paths() {
    use rusqlite::ffi;
    for (code, expected) in [
        (ffi::SQLITE_BUSY, StartupError::DatabaseLocked),
        (ffi::SQLITE_LOCKED, StartupError::DatabaseLocked),
        (ffi::SQLITE_CORRUPT, StartupError::DatabaseCorrupt),
        (ffi::SQLITE_NOTADB, StartupError::DatabaseCorrupt),
        (ffi::SQLITE_PERM, StartupError::StorageAccess),
        (ffi::SQLITE_READONLY, StartupError::StorageAccess),
        (ffi::SQLITE_CANTOPEN, StartupError::StorageAccess),
        (ffi::SQLITE_IOERR, StartupError::StorageAccess),
        (ffi::SQLITE_FULL, StartupError::DiskFull),
        (ffi::SQLITE_ERROR, StartupError::Database),
    ] {
        let error = StartupError::from(rusqlite::Error::SqliteFailure(
            ffi::Error::new(code),
            Some("private-path technical detail".into()),
        ));
        assert_eq!(error, expected);
        let message = error.to_string();
        assert!(!message.contains("private-path"));
        assert!(!message.contains("technical detail"));
        assert!(message.contains("Não foi possível iniciar o Download Organizer"));
        assert!(message.contains("Não exclua o banco"));
    }
}

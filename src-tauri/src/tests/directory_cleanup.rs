use super::*;
use std::os::windows::fs::OpenOptionsExt;

fn organize(runtime: &mut Runtime, prefs: &Preferences, name: &str) -> i64 {
    old_file(&Path::new(&prefs.source).join(name), name.as_bytes());
    execute(runtime, plan(prefs), "manual", None).unwrap()
}

fn directory_state(store: &Store) -> (String, Option<String>) {
    store
        .db
        .query_row(
            "SELECT state,error FROM created_directories ORDER BY id LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

#[test]
fn undo_removes_only_created_categories_and_survives_restart() {
    let (temp, mut runtime, prefs) = fixture();
    let folder = Path::new(&prefs.source).join("Documentos");
    let preexisting = Path::new(&prefs.source).join("Imagens");
    fs::create_dir(&preexisting).unwrap();
    old_file(&Path::new(&prefs.source).join("image.png"), b"image");
    let op = organize(&mut runtime, &prefs, "one.txt");
    assert!(folder.is_dir());
    assert_eq!(directory_state(&runtime.store).0, "created");
    drop(runtime.store);
    runtime.store = Store::open(&temp.path().join("test.sqlite3"), &prefs.source).unwrap();
    assert!(folder.is_dir()); // Opening the app does not clean an active organization.
    undo(&mut runtime, op, None).unwrap();
    assert!(!folder.exists());
    assert!(preexisting.is_dir());
    assert_eq!(
        fs::read(Path::new(&prefs.source).join("one.txt")).unwrap(),
        b"one.txt"
    );
    assert!(Path::new(&prefs.source).join("image.png").is_file());
    assert_eq!(directory_state(&runtime.store).0, "removed");
    runtime.store.cleanup_directories(None).unwrap();
    fs::create_dir(&folder).unwrap();
    runtime.store.cleanup_directories(None).unwrap();
    assert!(folder.exists()); // Completed journal entries never authorize a new directory.
}

#[test]
fn preexisting_empty_category_never_becomes_owned() {
    let (_temp, mut runtime, prefs) = fixture();
    let folder = Path::new(&prefs.source).join("Documentos");
    fs::create_dir(&folder).unwrap();
    let op = organize(&mut runtime, &prefs, "one.txt");
    undo(&mut runtime, op, None).unwrap();
    assert!(folder.is_dir());
    assert_eq!(
        runtime
            .store
            .db
            .query_row("SELECT count(*) FROM created_directories", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn category_reused_as_a_configured_root_is_preserved() {
    for source_root in [false, true] {
        let (_temp, mut runtime, mut prefs) = fixture();
        let op = organize(&mut runtime, &prefs, "one.txt");
        let folder = Path::new(&prefs.source).join("Documentos");
        if source_root {
            prefs.source = folder.to_string_lossy().into_owned();
        } else {
            prefs.destination = folder.to_string_lossy().into_owned();
        }
        runtime.store.save(&prefs).unwrap();
        undo(&mut runtime, op, None).unwrap();
        assert!(folder.is_dir());
        assert!(
            directory_state(&runtime.store)
                .1
                .unwrap()
                .contains("configurações")
        );
    }
}

#[test]
fn external_files_and_even_empty_subdirectories_are_preserved() {
    for subdirectory in [false, true] {
        let (_temp, mut runtime, prefs) = fixture();
        let op = organize(&mut runtime, &prefs, "one.txt");
        let folder = Path::new(&prefs.source).join("Documentos");
        let external = folder.join("external");
        if subdirectory {
            fs::create_dir(&external).unwrap();
        } else {
            fs::write(&external, b"user content").unwrap();
        }
        undo(&mut runtime, op, None).unwrap();
        runtime.store.recover().unwrap();
        assert!(folder.is_dir());
        assert!(external.exists());
        assert_eq!(directory_state(&runtime.store).0, "created");
        if !subdirectory {
            assert_eq!(fs::read(external).unwrap(), b"user content");
        }
    }
}

#[test]
fn partial_undo_keeps_directories_until_all_files_can_return() {
    let (_temp, mut runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("two.txt"), b"two");
    let op = organize(&mut runtime, &prefs, "one.txt");
    let conflict = Path::new(&prefs.source).join("one.txt");
    fs::write(&conflict, b"do not overwrite").unwrap();
    undo(&mut runtime, op, None).unwrap();
    assert!(Path::new(&prefs.source).join("Documentos/one.txt").exists());
    assert_eq!(fs::read(&conflict).unwrap(), b"do not overwrite");
    assert_eq!(
        runtime
            .store
            .movements(op)
            .unwrap()
            .iter()
            .filter(|m| m.status == "undone")
            .count(),
        1
    );
    fs::rename(&conflict, Path::new(&prefs.source).join("saved-conflict")).unwrap();
    undo(&mut runtime, op, None).unwrap();
    assert!(!Path::new(&prefs.source).join("Documentos").exists());
}

#[test]
fn shared_category_is_removed_only_after_both_operations_are_undone() {
    let (_temp, mut runtime, prefs) = fixture();
    let first = organize(&mut runtime, &prefs, "one.txt");
    let second = organize(&mut runtime, &prefs, "two.txt");
    let folder = Path::new(&prefs.source).join("Documentos");
    undo(&mut runtime, first, None).unwrap();
    assert!(folder.is_dir());
    undo(&mut runtime, second, None).unwrap();
    assert!(!folder.exists());
    assert!(Path::new(&prefs.source).join("one.txt").is_file());
    assert!(Path::new(&prefs.source).join("two.txt").is_file());
}

#[test]
fn undo_cleans_a_new_category_instance_despite_stale_history_for_the_same_path() {
    let (temp, mut runtime, prefs) = fixture();
    let older = organize(&mut runtime, &prefs, "old.txt");
    let folder = Path::new(&prefs.source).join("Documentos");
    let older_movement = runtime.store.movements(older).unwrap().remove(0);
    // Simulate external relocation/removal: the old history still says "moved".
    engine::move_no_replace(
        Path::new(&older_movement.destination),
        &temp.path().join("external.txt"),
    )
    .unwrap();
    fs::remove_dir(&folder).unwrap();
    let current = organize(&mut runtime, &prefs, "new.txt");
    assert!(current > older);
    let recorded: (String, bool) = runtime
        .store
        .db
        .query_row(
            "SELECT state,identity IS NOT NULL FROM created_directories WHERE operation_id=?1",
            [current],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(recorded, ("created".into(), true));
    assert!(folder.join("new.txt").is_file());
    undo(&mut runtime, current, None).unwrap();
    assert_eq!(
        runtime.store.movements(current).unwrap()[0].status,
        "undone"
    );
    assert_eq!(
        fs::read(Path::new(&prefs.source).join("new.txt")).unwrap(),
        b"new.txt"
    );
    assert_eq!(
        fs::read(temp.path().join("external.txt")).unwrap(),
        b"old.txt"
    );
    assert!(
        !folder.exists(),
        "stale movements for a previous directory instance must not block cleanup"
    );
    let state: String = runtime
        .store
        .db
        .query_row(
            "SELECT state FROM created_directories WHERE operation_id=?1",
            [current],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(state, "removed");
    assert_eq!(runtime.store.movements(older).unwrap()[0].status, "moved");
}

#[test]
fn replacement_with_same_name_is_not_deleted() {
    let (_temp, mut runtime, prefs) = fixture();
    let op = organize(&mut runtime, &prefs, "one.txt");
    let folder = Path::new(&prefs.source).join("Documentos");
    let original = Path::new(&prefs.source).join("saved-directory");
    fs::rename(&folder, &original).unwrap();
    fs::create_dir(&folder).unwrap();
    // Complete the restore independently to make this original creation eligible for cleanup.
    let movement = runtime.store.movements(op).unwrap().remove(0);
    engine::move_no_replace(&original.join("one.txt"), Path::new(&movement.source)).unwrap();
    runtime.store.status(movement.id, "undone", None).unwrap();
    assert!(runtime.store.cleanup_directories(None).is_err());
    assert!(folder.is_dir());
    assert!(original.is_dir());
    assert!(
        directory_state(&runtime.store)
            .1
            .unwrap()
            .contains("substituída")
    );
}

#[test]
fn cleanup_failure_preserves_files_is_recorded_and_retried_after_restart() {
    let (temp, mut runtime, prefs) = fixture();
    let op = organize(&mut runtime, &prefs, "one.txt");
    let folder = Path::new(&prefs.source).join("Documentos");
    let guard = File::options()
        .read(true)
        .share_mode(3)
        .custom_flags(0x02000000)
        .open(&folder)
        .unwrap();
    assert!(
        undo(&mut runtime, op, None)
            .unwrap_err()
            .contains("limpeza")
    );
    assert!(folder.exists());
    assert!(Path::new(&prefs.source).join("one.txt").is_file());
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "undone");
    assert!(directory_state(&runtime.store).1.is_some());
    drop(runtime.store);
    runtime.store = Store::open(&temp.path().join("test.sqlite3"), &prefs.source).unwrap();
    assert!(folder.exists()); // Cleanup errors do not prevent startup.
    drop(guard);
    runtime.store.recover().unwrap();
    assert!(!folder.exists());
    assert_eq!(directory_state(&runtime.store), ("removed".into(), None));
}

#[test]
fn migration_does_not_claim_directories_from_old_history() {
    let (temp, mut runtime, prefs) = fixture();
    let op = organize(&mut runtime, &prefs, "legacy.txt");
    drop(runtime.store);
    let db = rusqlite::Connection::open(temp.path().join("test.sqlite3")).unwrap();
    db.execute_batch("DROP TABLE created_directories; PRAGMA user_version=0;")
        .unwrap();
    drop(db);
    runtime.store = Store::open(&temp.path().join("test.sqlite3"), &prefs.source).unwrap();
    assert_eq!(runtime.store.history().unwrap()[0].id, op);
    assert_eq!(
        runtime
            .store
            .db
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
    undo(&mut runtime, op, None).unwrap();
    assert!(Path::new(&prefs.source).join("Documentos").is_dir());
}

#[test]
fn journal_reconciles_created_directory_without_a_movement_record() {
    let (temp, mut runtime, prefs) = fixture();
    let op = runtime.store.begin("manual").unwrap();
    let folder = Path::new(&prefs.source).join("Documentos");
    runtime.store.create_directory(op, &folder).unwrap();
    assert!(folder.is_dir());
    drop(runtime.store);
    runtime.store = Store::open(&temp.path().join("test.sqlite3"), &prefs.source).unwrap();
    assert!(!folder.exists());
    assert_eq!(directory_state(&runtime.store).0, "removed");
}

#[test]
fn interrupted_creation_without_committed_identity_never_authorizes_cleanup() {
    let (temp, mut runtime, prefs) = fixture();
    let op = runtime.store.begin("manual").unwrap();
    let folder = Path::new(&prefs.source).join("Documentos");
    runtime
        .store
        .db
        .execute(
            "INSERT INTO created_directories(operation_id,path,state) VALUES(?1,?2,'intent')",
            rusqlite::params![op, folder.to_str().unwrap()],
        )
        .unwrap();
    fs::create_dir(&folder).unwrap();
    drop(runtime.store);
    runtime.store = Store::open(&temp.path().join("test.sqlite3"), &prefs.source).unwrap();
    runtime.store.cleanup_directories(None).unwrap();
    assert!(folder.exists());
    assert_eq!(directory_state(&runtime.store).0, "unverified");
}

#[test]
fn failed_movement_journal_cleans_verified_creation_without_moving_file() {
    let (_temp, mut runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("one.txt"), b"safe");
    runtime.store.db.execute_batch("CREATE TRIGGER fail_move BEFORE INSERT ON movements BEGIN SELECT RAISE(FAIL,'disk failure'); END;").unwrap();
    assert!(execute(&mut runtime, plan(&prefs), "manual", None).is_err());
    assert_eq!(
        fs::read(Path::new(&prefs.source).join("one.txt")).unwrap(),
        b"safe"
    );
    assert!(!Path::new(&prefs.source).join("Documentos").exists());
}

#[test]
fn failed_directory_journal_never_moves_files_or_guesses_ownership() {
    for before_creation in [false, true] {
        let (_temp, mut runtime, prefs) = fixture();
        old_file(&Path::new(&prefs.source).join("one.txt"), b"safe");
        runtime.store.db.execute_batch(if before_creation {
            "CREATE TRIGGER fail_directory BEFORE INSERT ON created_directories BEGIN SELECT RAISE(FAIL,'disk failure'); END;"
        } else {
            "CREATE TRIGGER fail_directory BEFORE UPDATE ON created_directories WHEN NEW.state='created' BEGIN SELECT RAISE(FAIL,'disk failure'); END;"
        }).unwrap();
        let op = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
        assert_eq!(runtime.store.movements(op).unwrap()[0].status, "failed");
        assert_eq!(
            fs::read(Path::new(&prefs.source).join("one.txt")).unwrap(),
            b"safe"
        );
        assert_eq!(
            Path::new(&prefs.source).join("Documentos").exists(),
            !before_creation
        );
        if !before_creation {
            assert_eq!(directory_state(&runtime.store).0, "unverified");
        }
    }
}

#[test]
fn recovery_of_interrupted_undo_also_cleans_directory() {
    let (_temp, mut runtime, prefs) = fixture();
    let op = organize(&mut runtime, &prefs, "one.txt");
    let movement = runtime.store.movements(op).unwrap().remove(0);
    runtime
        .store
        .status(movement.id, "undo_pending", None)
        .unwrap();
    engine::move_no_replace(
        Path::new(&movement.destination),
        Path::new(&movement.source),
    )
    .unwrap();
    runtime.store.recover().unwrap();
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "undone");
    assert!(!Path::new(&prefs.source).join("Documentos").exists());
}

#[test]
fn uncertain_or_pending_movements_prevent_cleanup_even_when_empty() {
    for status in ["moved", "pending", "undo_pending", "uncertain"] {
        let (_temp, runtime, prefs) = fixture();
        let op = runtime.store.begin("manual").unwrap();
        let folder = Path::new(&prefs.source).join("Documentos");
        runtime.store.create_directory(op, &folder).unwrap();
        runtime
            .store
            .record(
                op,
                &Path::new(&prefs.source).join("one.txt").to_string_lossy(),
                &folder.join("one.txt").to_string_lossy(),
                status,
                &Stamp {
                    size: 1,
                    modified: 1,
                },
                "digest",
            )
            .unwrap();
        runtime.store.cleanup_directories(None).unwrap();
        assert!(folder.exists());
    }
}

#[test]
fn another_operations_pending_movement_also_prevents_cleanup() {
    let (_temp, runtime, prefs) = fixture();
    let owner = runtime.store.begin("manual").unwrap();
    let folder = Path::new(&prefs.source).join("Documentos");
    runtime.store.create_directory(owner, &folder).unwrap();
    let other = runtime.store.begin("manual").unwrap();
    runtime
        .store
        .record(
            other,
            &Path::new(&prefs.source).join("new.txt").to_string_lossy(),
            &folder.join("new.txt").to_string_lossy(),
            "pending",
            &Stamp {
                size: 1,
                modified: 1,
            },
            "digest",
        )
        .unwrap();
    runtime.store.cleanup_directories(None).unwrap();
    assert!(folder.is_dir());
}

#[test]
fn old_cleanup_errors_do_not_turn_an_unrelated_successful_operation_into_failure() {
    let (temp, mut runtime, prefs) = fixture();
    let owner = runtime.store.begin("manual").unwrap();
    let folder = Path::new(&prefs.source).join("Documentos");
    runtime.store.create_directory(owner, &folder).unwrap();
    fs::rename(&folder, temp.path().join("original")).unwrap();
    fs::create_dir(&folder).unwrap();
    let new_operation = organize(&mut runtime, &prefs, "new.txt");
    assert_eq!(
        runtime.store.movements(new_operation).unwrap()[0].status,
        "moved"
    );
    undo(&mut runtime, new_operation, None).unwrap();
    assert!(folder.is_dir());
    assert!(
        directory_state(&runtime.store)
            .1
            .unwrap()
            .contains("substituída")
    );
}

#[test]
fn interrupted_cleanup_is_idempotent_when_status_commit_fails_after_removal() {
    let (temp, mut runtime, prefs) = fixture();
    let op = organize(&mut runtime, &prefs, "one.txt");
    runtime.store.db.execute_batch("CREATE TRIGGER fail_cleanup BEFORE UPDATE ON created_directories WHEN NEW.state='removed' BEGIN SELECT RAISE(FAIL,'disk failure'); END;").unwrap();
    assert!(undo(&mut runtime, op, None).is_err());
    assert!(Path::new(&prefs.source).join("one.txt").is_file());
    assert!(!Path::new(&prefs.source).join("Documentos").exists());
    assert_eq!(directory_state(&runtime.store).0, "created");
    runtime
        .store
        .db
        .execute_batch("DROP TRIGGER fail_cleanup;")
        .unwrap();
    drop(runtime.store);
    runtime.store = Store::open(&temp.path().join("test.sqlite3"), &prefs.source).unwrap();
    assert_eq!(directory_state(&runtime.store).0, "removed");
    runtime.store.recover().unwrap();
    assert_eq!(
        fs::read(Path::new(&prefs.source).join("one.txt")).unwrap(),
        b"one.txt"
    );
}

#[test]
fn concurrent_creation_has_exactly_one_owner() {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().join("category");
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let owners: Vec<_> = (0..2)
        .map(|_| {
            let barrier = barrier.clone();
            let folder = folder.clone();
            std::thread::spawn(move || {
                barrier.wait();
                crate::directories::create(&folder).unwrap().is_some()
            })
        })
        .collect();
    assert_eq!(
        owners
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(|owned| *owned)
            .count(),
        1
    );
    assert!(folder.is_dir());
}

#[test]
fn cleanup_locks_identity_and_kernel_rejects_files_arriving_after_empty_check() {
    let temp = tempfile::tempdir().unwrap();
    let parent = temp.path().join("parent");
    fs::create_dir(&parent).unwrap();
    let folder = parent.join("category");
    let created = crate::directories::create(&folder).unwrap().unwrap();
    let identity = created.identity().unwrap();
    drop(created);
    assert!(
        !crate::directories::remove_with(&folder, &identity, || {
            assert!(fs::rename(&folder, parent.join("replacement")).is_err());
            assert!(fs::rename(&parent, temp.path().join("changed-parent")).is_err());
            fs::write(folder.join("arrived.txt"), b"preserve").unwrap();
        })
        .unwrap()
    );
    assert_eq!(fs::read(folder.join("arrived.txt")).unwrap(), b"preserve");
}

#[test]
fn junction_replacement_cannot_delete_its_target() {
    let (temp, runtime, prefs) = fixture();
    let op = runtime.store.begin("manual").unwrap();
    let folder = Path::new(&prefs.source).join("Documentos");
    runtime.store.create_directory(op, &folder).unwrap();
    fs::rename(&folder, temp.path().join("original")).unwrap();
    let external = temp.path().join("external");
    fs::create_dir(&external).unwrap();
    fs::write(external.join("user.txt"), b"user").unwrap();
    let result = std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(&folder)
        .arg(&external)
        .output()
        .unwrap();
    assert!(result.status.success());
    assert!(runtime.store.cleanup_directories(None).is_err());
    assert_eq!(fs::read(external.join("user.txt")).unwrap(), b"user");
    fs::remove_dir(folder).unwrap();
}

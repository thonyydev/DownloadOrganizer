use super::*;
use notify::{
    Event, EventKind,
    event::{CreateKind, RemoveKind},
};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Instant;
use std::{
    fs::{self, File, FileTimes},
    time::{Duration, SystemTime},
};
use tempfile::TempDir;
#[cfg(windows)]
mod directory_cleanup;
mod history_pagination;
mod language;
mod startup;

fn prepare_move(
    entry: &engine::FileEntry,
    prefs: &Preferences,
) -> Result<(engine::LockedFile, String)> {
    engine::prepare_move(entry, prefs, |folder| match fs::create_dir(folder) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.to_string()),
    })
}

mod monitor_activation {
    use super::*;
    use notify::event::{ModifyKind, RenameMode};
    use std::{cell::Cell, collections::HashSet};

    fn baseline(source: &Path) -> Result<HashSet<PathBuf>> {
        fs::read_dir(source)
            .and_then(|entries| {
                entries
                    .map(|entry| entry.map(|entry| entry.path()))
                    .collect()
            })
            .map_err(|error| error.to_string())
    }

    #[cfg(windows)]
    #[test]
    fn native_windows_arrival_during_enumeration_is_processed() {
        use notify::{RecursiveMode, Watcher};
        let (_temp, mut runtime, mut prefs) = fixture();
        prefs.automatic = true;
        runtime.store.save(&prefs).unwrap();
        let during = Path::new(&prefs.source).join("native-during.txt");
        let (tx, rx) = mpsc::sync_channel(1024);
        monitor::configure_with(
            &mut runtime,
            &tx,
            |watcher, source| {
                watcher
                    .watch(source, RecursiveMode::NonRecursive)
                    .map_err(|error| error.to_string())
            },
            |source| {
                old_file(&during, b"native");
                baseline(source)
            },
        )
        .unwrap();
        assert!(runtime.session.as_ref().unwrap().baseline.contains(&during));
        let mut queue = queue::Queue::default();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let message = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap();
            let arrived = message.1.as_ref().is_ok_and(|event| {
                matches!(event.kind, EventKind::Create(_))
                    && event
                        .paths
                        .iter()
                        .any(|path| path.file_name() == during.file_name())
            });
            queue.event(&mut runtime, message);
            if arrived {
                break;
            }
        }
        assert!(
            queue
                .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
                .unwrap()
        );
        assert!(!during.exists());
        assert_eq!(
            fs::read(Path::new(&prefs.destination).join("Documentos/native-during.txt")).unwrap(),
            b"native"
        );
        assert_eq!(runtime.store.history().unwrap()[0].movements.len(), 1);
    }

    #[test]
    fn arrivals_during_enumeration_are_reconciled_without_moving_existing_files() {
        let (_temp, mut runtime, mut prefs) = fixture();
        let existing = Path::new(&prefs.source).join("existing.txt");
        let during = Path::new(&prefs.source).join("during.txt");
        let after = Path::new(&prefs.source).join("after.txt");
        old_file(&existing, b"existing");
        prefs.automatic = true;
        runtime.store.save(&prefs).unwrap();
        let generation = runtime.sequence + 1;
        let (tx, rx) = mpsc::sync_channel(1024);
        let registered = Cell::new(false);
        monitor::configure_with(
            &mut runtime,
            &tx,
            |_, _| {
                registered.set(true);
                Ok(())
            },
            |source| {
                assert!(
                    registered.get(),
                    "watch registration must precede enumeration"
                );
                old_file(&during, b"during");
                for _ in 0..2 {
                    tx.try_send((
                        generation,
                        Ok(event(EventKind::Create(CreateKind::Any), &during)),
                    ))
                    .unwrap();
                }
                tx.try_send((
                    generation,
                    Ok(event(EventKind::Modify(ModifyKind::Any), &existing)),
                ))
                .unwrap();
                baseline(source)
            },
        )
        .unwrap();
        assert!(runtime.session.as_ref().unwrap().baseline.contains(&during));
        let mut queue = queue::Queue::default();
        for message in rx.try_iter() {
            queue.event(&mut runtime, message);
        }
        assert!(!runtime.session.as_ref().unwrap().baseline.contains(&during));
        assert!(
            runtime
                .session
                .as_ref()
                .unwrap()
                .baseline
                .contains(&existing)
        );
        old_file(&after, b"after");
        queue.event(
            &mut runtime,
            (
                generation,
                Ok(event(EventKind::Create(CreateKind::File), &after)),
            ),
        );
        assert!(
            !queue
                .process_due(&mut runtime, None, Instant::now())
                .unwrap()
        );
        assert!(
            queue
                .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
                .unwrap()
        );
        assert_eq!(fs::read(&existing).unwrap(), b"existing");
        assert_eq!(
            fs::read(Path::new(&prefs.destination).join("Documentos/during.txt")).unwrap(),
            b"during"
        );
        assert_eq!(
            fs::read(Path::new(&prefs.destination).join("Documentos/after.txt")).unwrap(),
            b"after"
        );
        let history = runtime.store.history().unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].movements.len(), 2);
    }

    #[test]
    fn late_arrival_events_and_rename_destinations_are_not_hidden_by_the_baseline() {
        let (_temp, mut runtime, mut prefs) = fixture();
        prefs.automatic = true;
        runtime.store.save(&prefs).unwrap();
        let during = Path::new(&prefs.source).join("during.txt");
        let renamed = Path::new(&prefs.source).join("renamed.txt");
        let temporary = Path::new(&prefs.source).join("partial.part");
        let (tx, _rx) = mpsc::sync_channel(1024);
        monitor::configure_with(
            &mut runtime,
            &tx,
            |_, _| Ok(()),
            |source| {
                old_file(&during, b"during");
                old_file(&renamed, b"renamed");
                old_file(&temporary, b"partial");
                baseline(source)
            },
        )
        .unwrap();
        let generation = runtime.session.as_ref().unwrap().generation;
        let mut queue = queue::Queue::default();
        // Native callbacks can arrive after enumeration/activation has returned.
        queue.event(
            &mut runtime,
            (
                generation,
                Ok(event(EventKind::Create(CreateKind::Any), &during)),
            ),
        );
        queue.event(
            &mut runtime,
            (
                generation,
                Ok(event(
                    EventKind::Modify(ModifyKind::Name(RenameMode::To)),
                    &renamed,
                )),
            ),
        );
        queue.event(
            &mut runtime,
            (
                generation,
                Ok(event(EventKind::Create(CreateKind::Any), &temporary)),
            ),
        );
        assert!(
            queue
                .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
                .unwrap()
        );
        assert!(!during.exists());
        assert!(!renamed.exists());
        assert!(temporary.exists());
        assert_eq!(runtime.store.history().unwrap()[0].movements.len(), 2);
    }

    #[test]
    fn paired_rename_only_reconciles_the_destination_not_an_existing_source_name() {
        let (_temp, mut runtime, mut prefs) = fixture();
        let from = Path::new(&prefs.source).join("from.txt");
        let to = Path::new(&prefs.source).join("to.txt");
        old_file(&from, b"preexisting");
        prefs.automatic = true;
        runtime.store.save(&prefs).unwrap();
        let (tx, _rx) = mpsc::sync_channel(1024);
        monitor::configure_with(
            &mut runtime,
            &tx,
            |_, _| Ok(()),
            |source| {
                old_file(&to, b"new");
                baseline(source)
            },
        )
        .unwrap();
        let generation = runtime.session.as_ref().unwrap().generation;
        let mut queue = queue::Queue::default();
        queue.event(
            &mut runtime,
            (
                generation,
                Ok(
                    event(EventKind::Modify(ModifyKind::Name(RenameMode::Both)), &from)
                        .add_path(to.clone()),
                ),
            ),
        );
        assert!(
            queue
                .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
                .unwrap()
        );
        assert_eq!(fs::read(from).unwrap(), b"preexisting");
        assert!(!to.exists());
    }

    #[test]
    fn failed_registration_does_not_publish_a_session_or_enumerate() {
        let (_temp, mut runtime, mut prefs) = fixture();
        prefs.automatic = true;
        runtime.store.save(&prefs).unwrap();
        let (tx, _rx) = mpsc::sync_channel(1024);
        let error = monitor::configure_with(
            &mut runtime,
            &tx,
            |_, _| Err("registration failed".into()),
            |_| panic!("must not enumerate without a watcher"),
        )
        .unwrap_err();
        assert_eq!(error, "registration failed");
        assert!(runtime.watcher.is_none());
        assert!(runtime.session.is_none());
        assert!(runtime.store.history().unwrap().is_empty());
    }

    #[test]
    fn partial_enumeration_failure_discards_queued_events_and_never_moves_files() {
        let (_temp, mut runtime, mut prefs) = fixture();
        prefs.automatic = true;
        runtime.store.save(&prefs).unwrap();
        let during = Path::new(&prefs.source).join("during.txt");
        let generation = runtime.sequence + 1;
        let (tx, rx) = mpsc::sync_channel(1024);
        let error = monitor::configure_with(
            &mut runtime,
            &tx,
            |_, _| Ok(()),
            |_| {
                old_file(&during, b"preserved");
                tx.try_send((
                    generation,
                    Ok(event(EventKind::Create(CreateKind::File), &during)),
                ))
                .unwrap();
                Err("enumeration failed".into())
            },
        )
        .unwrap_err();
        assert_eq!(error, "enumeration failed");
        assert!(runtime.watcher.is_none());
        assert!(runtime.session.is_none());
        let mut queue = queue::Queue::default();
        assert!(!queue.event(&mut runtime, rx.try_recv().unwrap()));
        assert!(
            !queue
                .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
                .unwrap()
        );
        assert_eq!(fs::read(during).unwrap(), b"preserved");
        assert!(runtime.store.history().unwrap().is_empty());
    }

    fn settings_change_during_enumeration(disable: bool) {
        let (temp, mut runtime, mut prefs) = fixture();
        prefs.automatic = true;
        runtime.store.save(&prefs).unwrap();
        let generation = runtime.sequence + 1;
        let during = Path::new(&prefs.source).join("during.txt");
        let next_source = temp.path().join("next");
        fs::create_dir(&next_source).unwrap();
        let mut external = prefs.clone();
        if disable {
            external.automatic = false;
        } else {
            external.source = fs::canonicalize(&next_source)
                .unwrap()
                .to_string_lossy()
                .into();
        }
        let database = rusqlite::Connection::open(temp.path().join("test.sqlite3")).unwrap();
        let (tx, rx) = mpsc::sync_channel(1024);
        assert!(
            monitor::configure_with(
                &mut runtime,
                &tx,
                |_, _| Ok(()),
                |source| {
                    old_file(&during, b"preserved");
                    tx.try_send((
                        generation,
                        Ok(event(EventKind::Create(CreateKind::File), &during)),
                    ))
                    .unwrap();
                    database
                        .execute(
                            "UPDATE preferences SET value=?1 WHERE id=1",
                            [serde_json::to_string(&external).unwrap()],
                        )
                        .unwrap();
                    baseline(source)
                }
            )
            .unwrap_err()
            .contains("mudaram durante a ativação")
        );
        assert!(runtime.watcher.is_none());
        assert!(runtime.session.is_none());
        monitor::configure(&mut runtime, &tx).unwrap();
        let mut queue = queue::Queue::default();
        assert!(!queue.event(&mut runtime, rx.try_recv().unwrap()));
        assert!(
            !queue
                .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
                .unwrap()
        );
        assert_eq!(fs::read(during).unwrap(), b"preserved");
        assert!(runtime.store.history().unwrap().is_empty());
        if disable {
            assert!(runtime.session.is_none());
        } else {
            assert_eq!(
                runtime.session.as_ref().unwrap().source,
                fs::canonicalize(next_source).unwrap()
            );
        }
    }

    #[test]
    fn source_change_during_enumeration_cannot_publish_or_process_the_old_session() {
        settings_change_during_enumeration(false);
    }

    #[test]
    fn disabling_during_enumeration_cannot_publish_or_process_the_old_session() {
        settings_change_during_enumeration(true);
    }

    #[test]
    fn overflow_and_rescan_during_enumeration_pause_before_processing() {
        for lost_events in [false, true] {
            let (_temp, mut runtime, mut prefs) = fixture();
            prefs.automatic = true;
            runtime.store.save(&prefs).unwrap();
            let generation = runtime.sequence + 1;
            let overflow = runtime.overflow.clone();
            let during = Path::new(&prefs.source).join("during.txt");
            let (tx, rx) = mpsc::sync_channel(1024);
            monitor::configure_with(
                &mut runtime,
                &tx,
                |_, _| Ok(()),
                |source| {
                    old_file(&during, b"preserved");
                    tx.try_send((
                        generation,
                        Ok(event(EventKind::Create(CreateKind::File), &during)),
                    ))
                    .unwrap();
                    if lost_events {
                        tx.try_send((
                            generation,
                            Ok(Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan)),
                        ))
                        .unwrap();
                    } else {
                        overflow.store(generation, Ordering::Release);
                    }
                    baseline(source)
                },
            )
            .unwrap();
            let mut queue = queue::Queue::default();
            for message in rx.try_iter() {
                queue.event(&mut runtime, message);
            }
            let result =
                queue.process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11));
            if lost_events {
                assert!(!result.unwrap());
            } else {
                assert!(result.is_err());
            }
            assert!(runtime.session.is_none());
            assert!(runtime.watcher.is_none());
            assert!(queue.idle());
            assert_eq!(fs::read(during).unwrap(), b"preserved");
            assert!(runtime.store.history().unwrap().is_empty());
        }
    }
}

#[test]
fn invalid_persisted_destination_blocks_scan_confirmation_execution_and_automation() {
    let (temp, mut runtime, mut prefs) = fixture();
    let generation = automatic(&mut runtime, &mut prefs);
    let source = Path::new(&prefs.source).join("sample.txt");
    old_file(&source, b"preserved");
    let preview = plan(&prefs);
    runtime.preview = Some(preview.clone());
    let saved = prefs.clone();
    // Simulate persisted/external settings bypassing the validated save command.
    prefs.destination = temp.path().join("unavailable").to_string_lossy().into();
    runtime
        .store
        .db
        .execute(
            "UPDATE preferences SET value=?1 WHERE id=1",
            [serde_json::to_string(&prefs).unwrap()],
        )
        .unwrap();
    assert!(engine::scan(&prefs).is_err());
    assert!(take_preview(&mut runtime, preview.id, preview.created).is_err());
    assert!(execute(&mut runtime, preview, "manual", None).is_err());
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    assert!(
        queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .is_err()
    );
    assert_eq!(fs::read(&source).unwrap(), b"preserved");
    assert!(runtime.store.history().unwrap().is_empty());
    assert_eq!(runtime.store.preferences().unwrap(), prefs);
    runtime
        .store
        .save_if_unchanged(&saved, Some(&prefs))
        .unwrap();
    assert_eq!(runtime.store.preferences().unwrap(), saved);
    assert_eq!(engine::scan(&saved).unwrap().len(), 1);
}

#[test]
fn failed_directory_validation_preserves_saved_preferences_and_preview_files() {
    let (temp, mut runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("sample.txt");
    old_file(&source, b"preserved");
    let preview = plan(&prefs);
    let entry = &preview.files[0];
    let mut draft = prefs.clone();
    draft.destination = temp.path().join("missing").to_string_lossy().into();
    assert!(
        runtime
            .store
            .save_if_unchanged(&draft, Some(&prefs))
            .is_err()
    );
    assert_eq!(runtime.store.preferences().unwrap(), prefs);
    assert!(prepare_move(entry, &draft).is_err());
    assert_eq!(fs::read(source).unwrap(), b"preserved");
    assert!(runtime.store.history().unwrap().is_empty());
}

#[test]
fn saving_a_stale_settings_form_preserves_the_external_update() {
    let (_temp, mut runtime, initial) = fixture();
    let mut external = initial.clone();
    external.theme = "light".into();
    runtime.store.save(&external).unwrap();
    let mut draft = initial.clone();
    draft.enabled_categories.clear();
    let error = runtime
        .store
        .save_if_unchanged(&draft, Some(&initial))
        .unwrap_err();
    assert!(error.starts_with("PREFERENCES_CHANGED:"));
    assert_eq!(runtime.store.preferences().unwrap(), external);
    runtime
        .store
        .save_if_unchanged(&draft, Some(&external))
        .unwrap();
    assert!(
        runtime
            .store
            .preferences()
            .unwrap()
            .enabled_categories
            .is_empty()
    );
}

#[test]
fn external_rule_updates_are_also_detected_before_saving() {
    let (_temp, mut runtime, initial) = fixture();
    runtime
        .store
        .db
        .execute("UPDATE rules SET enabled=0 WHERE category='images'", [])
        .unwrap();
    assert!(
        runtime
            .store
            .save_if_unchanged(&initial, Some(&initial))
            .is_err()
    );
    assert!(
        !runtime
            .store
            .preferences()
            .unwrap()
            .enabled_categories
            .contains(&"images".into())
    );
}

#[test]
fn expired_or_replaced_previews_cannot_move_files() {
    let (_temp, mut runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("a.txt");
    old_file(&source, b"original");
    let preview = plan(&prefs);
    runtime.preview = Some(preview.clone());
    assert!(take_preview(&mut runtime, preview.id, preview.created + 300).is_err());
    assert!(take_preview(&mut runtime, preview.id + 1, preview.created).is_err());
    assert!(take_preview(&mut runtime, preview.id, preview.created - 1).is_err());
    assert_eq!(fs::read(source).unwrap(), b"original");
    assert!(runtime.store.history().unwrap().is_empty());
}

#[test]
fn stale_files_invalidate_the_whole_preview_before_any_move() {
    let (_temp, mut runtime, prefs) = fixture();
    let a = Path::new(&prefs.source).join("a.txt");
    let b = Path::new(&prefs.source).join("b.txt");
    old_file(&a, b"a");
    old_file(&b, b"b");
    let preview = plan(&prefs);
    runtime.preview = Some(preview.clone());
    old_file(&b, b"changed");
    assert!(take_preview(&mut runtime, preview.id, preview.created).is_err());
    assert!(runtime.preview.is_none());
    assert_eq!(fs::read(a).unwrap(), b"a");
    assert_eq!(fs::read(b).unwrap(), b"changed");
    assert!(runtime.store.history().unwrap().is_empty());
    runtime.preview = Some(plan(&prefs));
    let preview = take_preview(&mut runtime, 1, engine::now()).unwrap();
    assert!(runtime.preview.is_none());
    execute(&mut runtime, preview, "manual", None).unwrap();
}

#[test]
fn destination_conflict_invalidates_confirmation_without_moving_other_files() {
    let (_temp, mut runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("a.txt"), b"source");
    let preview = plan(&prefs);
    let target = Path::new(&preview.files[0].destination);
    fs::create_dir(target.parent().unwrap()).unwrap();
    old_file(target, b"existing");
    runtime.preview = Some(preview.clone());
    assert!(take_preview(&mut runtime, preview.id, preview.created).is_err());
    assert_eq!(fs::read(target).unwrap(), b"existing");
    assert!(runtime.store.history().unwrap().is_empty());
}

#[test]
fn only_one_store_can_recover_and_write_the_same_database() {
    let (temp, runtime, prefs) = fixture();
    assert!(Store::open(&temp.path().join("test.sqlite3"), &prefs.source).is_err());
    drop(runtime);
    assert!(Store::open(&temp.path().join("test.sqlite3"), &prefs.source).is_ok());
}

#[cfg(windows)]
#[test]
fn recovery_waits_for_a_busy_file_instead_of_losing_undo() {
    let (_temp, runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("a.txt"), b"a");
    let entry = plan(&prefs).files.remove(0);
    let (mut file, digest) = prepare_move(&entry, &prefs).unwrap();
    let op = runtime.store.begin("manual").unwrap();
    runtime
        .store
        .record(
            op,
            &entry.path,
            &entry.destination,
            "pending",
            entry.stamp.as_ref().unwrap(),
            &digest,
        )
        .unwrap();
    engine::move_locked(
        &mut file,
        Path::new(&entry.path),
        Path::new(&entry.destination),
    )
    .unwrap();
    runtime.store.recover().unwrap();
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "pending");
    drop(file);
    runtime.store.recover().unwrap();
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "moved");
}

#[test]
fn recovery_distinguishes_completed_and_unexecuted_undo() {
    let (_temp, mut runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("a.txt"), b"a");
    old_file(&Path::new(&prefs.source).join("b.txt"), b"b");
    let op = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    for (index, item) in runtime.store.movements(op).unwrap().iter().enumerate() {
        runtime.store.status(item.id, "undo_pending", None).unwrap();
        if index == 0 {
            engine::move_no_replace(Path::new(&item.destination), Path::new(&item.source)).unwrap();
        }
    }
    runtime.store.recover().unwrap();
    let items = runtime.store.movements(op).unwrap();
    assert_eq!(items[0].status, "undone");
    assert_eq!(items[1].status, "moved");
    undo(&mut runtime, op, None).unwrap();
    assert_eq!(fs::read(&items[0].source).unwrap(), b"a");
    assert_eq!(fs::read(&items[1].source).unwrap(), b"b");
}

#[test]
fn event_overflow_pauses_automation_before_any_more_moves() {
    let (_temp, mut runtime, mut prefs) = fixture();
    let generation = automatic(&mut runtime, &mut prefs);
    let source = Path::new(&prefs.source).join("new.txt");
    old_file(&source, b"preserve");
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    runtime.overflow.store(generation, Ordering::Release);
    assert!(
        queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .is_err()
    );
    assert!(runtime.watcher.is_none());
    assert!(queue.idle());
    assert_eq!(fs::read(source).unwrap(), b"preserve");
    assert!(runtime.store.history().unwrap().is_empty());
}

#[cfg(windows)]
#[test]
fn checked_directory_cannot_be_replaced_before_the_move() {
    let (temp, _runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("a.txt");
    old_file(&source, b"checked");
    let entry = plan(&prefs).files.remove(0);
    let (_file, _digest) = prepare_move(&entry, &prefs).unwrap();
    assert!(fs::rename(&prefs.source, temp.path().join("redirected")).is_err());
}

#[test]
fn moves_unicode_names_of_different_lengths_to_the_exact_paths() {
    let (_temp, mut runtime, prefs) = fixture();
    let sources: Vec<_> = (1..=20)
        .map(|length| {
            let source =
                Path::new(&prefs.source).join(format!("{}-ação-🦀.txt", "a".repeat(length)));
            old_file(
                &source,
                source.file_name().unwrap().to_string_lossy().as_bytes(),
            );
            source
        })
        .collect();
    let op = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    for source in &sources {
        let target = Path::new(&prefs.source)
            .join("Documentos")
            .join(source.file_name().unwrap());
        assert!(!source.exists());
        assert_eq!(
            fs::read(target).unwrap(),
            source.file_name().unwrap().to_string_lossy().as_bytes()
        );
    }
    undo(&mut runtime, op, None).unwrap();
    for source in &sources {
        assert_eq!(
            fs::read(source).unwrap(),
            source.file_name().unwrap().to_string_lossy().as_bytes()
        );
    }
}

#[test]
fn native_watcher_overflow_is_bounded_and_does_not_block() {
    let (_temp, mut runtime, mut prefs) = fixture();
    prefs.automatic = true;
    runtime.store.save(&prefs).unwrap();
    let (tx, rx) = mpsc::sync_channel(1);
    monitor::configure(&mut runtime, &tx).unwrap();
    for index in 0..50 {
        old_file(
            &Path::new(&prefs.source).join(format!("event-{index}.txt")),
            b"new",
        );
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while runtime.overflow.load(Ordering::Acquire) == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        runtime.overflow.load(Ordering::Acquire),
        runtime.session.as_ref().unwrap().generation
    );
    runtime.watcher = None;
    assert_eq!(rx.try_iter().count(), 1);
}

#[test]
fn native_rescan_request_pauses_instead_of_silently_missing_files() {
    let (_temp, mut runtime, mut prefs) = fixture();
    let generation = automatic(&mut runtime, &mut prefs);
    let source = Path::new(&prefs.source).join("new.txt");
    old_file(&source, b"preserve");
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    assert!(queue.event(
        &mut runtime,
        (
            generation,
            Ok(Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan))
        )
    ));
    assert!(runtime.watch_error.is_some());
    assert!(runtime.watcher.is_none());
    assert!(queue.idle());
    assert!(
        !queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .unwrap()
    );
    assert_eq!(fs::read(source).unwrap(), b"preserve");
}

#[test]
fn reconfiguring_a_missing_source_stops_the_old_watcher() {
    let (_temp, mut runtime, mut prefs) = fixture();
    automatic(&mut runtime, &mut prefs);
    runtime
        .store
        .db
        .execute(
            "UPDATE preferences SET value=?1 WHERE id=1",
            [serde_json::to_string(&Preferences {
                source: Path::new(&prefs.source)
                    .join("missing")
                    .to_string_lossy()
                    .into(),
                ..prefs
            })
            .unwrap()],
        )
        .unwrap();
    let (tx, _rx) = mpsc::sync_channel(1024);
    assert!(monitor::configure(&mut runtime, &tx).is_err());
    assert!(runtime.watcher.is_none());
    assert!(runtime.session.is_none());
}

#[test]
fn undo_stops_when_the_journal_cannot_record_intent() {
    let (_temp, mut runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("a.txt"), b"a");
    let op = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    runtime.store.db.execute_batch("CREATE TRIGGER fail_undo BEFORE UPDATE ON movements WHEN NEW.status='undo_pending' BEGIN SELECT RAISE(FAIL,'simulated disk failure'); END;").unwrap();
    assert!(undo(&mut runtime, op, None).is_err());
    let item = runtime.store.movements(op).unwrap().remove(0);
    assert_eq!(item.status, "moved");
    assert!(Path::new(&item.destination).exists());
}

#[cfg(windows)]
#[test]
fn occupied_undo_can_be_retried_after_the_file_is_released() {
    use std::os::windows::fs::OpenOptionsExt;
    let (_temp, mut runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("a.txt"), b"a");
    let op = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    let item = runtime.store.movements(op).unwrap().remove(0);
    let writer = File::options()
        .write(true)
        .share_mode(0)
        .open(&item.destination)
        .unwrap();
    undo(&mut runtime, op, None).unwrap();
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "moved");
    drop(writer);
    undo(&mut runtime, op, None).unwrap();
    assert_eq!(fs::read(&item.source).unwrap(), b"a");
}

#[cfg(windows)]
#[test]
fn checked_source_cannot_be_replaced_before_the_move() {
    let (_temp, _runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("a.txt");
    old_file(&source, b"checked");
    let entry = plan(&prefs).files.remove(0);
    let (_file, _digest) = prepare_move(&entry, &prefs).unwrap();
    assert!(fs::rename(&source, Path::new(&prefs.source).join("replaced.txt")).is_err());
}

#[test]
fn queue_retains_files_after_temporary_destination_failure() {
    let (temp, mut runtime, mut prefs) = fixture();
    let destination = temp.path().join("destination");
    fs::create_dir(&destination).unwrap();
    prefs.destination = destination.to_string_lossy().into();
    let generation = automatic(&mut runtime, &mut prefs);
    let source = Path::new(&prefs.source).join("new.txt");
    old_file(&source, b"new");
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    fs::remove_dir(&destination).unwrap();
    assert!(
        queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .is_err()
    );
    assert!(!queue.idle());
    fs::create_dir(&destination).unwrap();
    assert!(
        queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(22))
            .unwrap()
    );
    assert!(!source.exists());
}

#[test]
fn saving_appearance_does_not_exclude_pending_downloads() {
    let (_temp, mut runtime, mut prefs) = fixture();
    let generation = automatic(&mut runtime, &mut prefs);
    let source = Path::new(&prefs.source).join("new.txt");
    old_file(&source, b"new");
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    prefs.theme = "light".into();
    runtime.store.save(&prefs).unwrap();
    let (tx, _rx) = mpsc::sync_channel(1024);
    monitor::configure(&mut runtime, &tx).unwrap();
    assert_eq!(runtime.session.as_ref().unwrap().generation, generation);
    assert!(
        queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .unwrap()
    );
}

#[test]
fn a_new_file_reusing_an_existing_name_is_not_excluded() {
    let (_temp, mut runtime, mut prefs) = fixture();
    let source = Path::new(&prefs.source).join("same.txt");
    old_file(&source, b"existing");
    let generation = automatic(&mut runtime, &mut prefs);
    fs::remove_file(&source).unwrap();
    old_file(&source, b"new download");
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Remove(RemoveKind::File), &source)),
        ),
    );
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    assert!(
        queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .unwrap()
    );
    assert_eq!(
        fs::read(Path::new(&prefs.source).join("Documentos/same.txt")).unwrap(),
        b"new download"
    );
}

fn automatic(runtime: &mut Runtime, prefs: &mut Preferences) -> u64 {
    prefs.automatic = true;
    runtime.store.save(prefs).unwrap();
    let (tx, _rx) = mpsc::sync_channel(1024);
    monitor::configure(runtime, &tx).unwrap();
    runtime.session.as_ref().unwrap().generation
}
fn event(kind: EventKind, path: &Path) -> Event {
    Event::new(kind).add_path(path.to_path_buf())
}

#[test]
fn automation_waits_for_quiet_and_ignores_duplicate_events() {
    let (_temp, mut runtime, mut prefs) = fixture();
    let generation = automatic(&mut runtime, &mut prefs);
    let source = Path::new(&prefs.source).join("new.txt");
    old_file(&source, b"new");
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    assert!(
        !queue
            .process_due(&mut runtime, None, Instant::now())
            .unwrap()
    );
    assert!(source.exists());
    assert!(
        queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .unwrap()
    );
    assert_eq!(runtime.store.history().unwrap().len(), 1);
    assert!(!source.exists());
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    assert!(
        !queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .unwrap()
    );
    assert_eq!(runtime.store.history().unwrap().len(), 1);
}

#[test]
fn undo_is_not_reorganized_by_stale_or_new_events() {
    let (_temp, mut runtime, mut prefs) = fixture();
    let generation = automatic(&mut runtime, &mut prefs);
    let source = Path::new(&prefs.source).join("new.txt");
    old_file(&source, b"restore");
    let op = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    undo(&mut runtime, op, None).unwrap();
    assert_eq!(
        runtime.store.movements(op).unwrap()[0].status,
        "undone",
        "{:?}",
        runtime.store.movements(op).unwrap()[0].error
    );
    assert_eq!(
        fs::read(&source).unwrap(),
        b"restore",
        "imediatamente após desfazer"
    );
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Remove(RemoveKind::File), &source)),
        ),
    );
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    assert!(
        !queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .unwrap()
    );
    assert_eq!(fs::read(&source).unwrap(), b"restore");
    assert_eq!(runtime.store.history().unwrap().len(), 1);
}

#[test]
fn automation_discards_pending_files_when_disabled() {
    let (_temp, mut runtime, mut prefs) = fixture();
    let generation = automatic(&mut runtime, &mut prefs);
    let source = Path::new(&prefs.source).join("new.txt");
    old_file(&source, b"keep");
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    prefs.automatic = false;
    runtime.store.save(&prefs).unwrap();
    let (tx, _rx) = mpsc::sync_channel(1024);
    monitor::configure(&mut runtime, &tx).unwrap();
    assert!(
        !queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .unwrap()
    );
    assert!(source.exists());
    assert!(queue.idle());
    assert!(runtime.store.history().unwrap().is_empty());
}

#[cfg(windows)]
#[test]
fn automation_retries_after_writer_closes_without_repeated_history() {
    use std::os::windows::fs::OpenOptionsExt;
    let (_temp, mut runtime, mut prefs) = fixture();
    let generation = automatic(&mut runtime, &mut prefs);
    let source = Path::new(&prefs.source).join("busy.txt");
    old_file(&source, b"complete");
    let writer = File::options()
        .write(true)
        .share_mode(0)
        .open(&source)
        .unwrap();
    let mut queue = queue::Queue::default();
    queue.event(
        &mut runtime,
        (
            generation,
            Ok(event(EventKind::Create(CreateKind::File), &source)),
        ),
    );
    assert!(
        !queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(11))
            .unwrap()
    );
    assert!(!queue.idle());
    assert!(runtime.store.history().unwrap().is_empty());
    drop(writer);
    assert!(
        queue
            .process_due(&mut runtime, None, Instant::now() + Duration::from_secs(22))
            .unwrap()
    );
    assert!(!source.exists());
    assert_eq!(runtime.store.history().unwrap().len(), 1);
}

#[test]
fn native_watcher_reports_new_file_events() {
    let (_temp, mut runtime, mut prefs) = fixture();
    prefs.automatic = true;
    runtime.store.save(&prefs).unwrap();
    let (tx, rx) = mpsc::sync_channel(1024);
    monitor::configure(&mut runtime, &tx).unwrap();
    let source = Path::new(&prefs.source).join("new.txt");
    old_file(&source, b"event");
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let (_, reported) = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap();
        if reported
            .unwrap()
            .paths
            .iter()
            .any(|p| p.file_name() == source.file_name())
        {
            break;
        }
    }
    assert!(source.exists());
    assert!(runtime.store.history().unwrap().is_empty());
}

#[test]
fn simultaneous_moves_do_not_overwrite_each_other() {
    let (_temp, _runtime, prefs) = fixture();
    let a = Path::new(&prefs.source).join("a.txt");
    let b = Path::new(&prefs.source).join("b.txt");
    old_file(&a, b"a");
    old_file(&b, b"b");
    let target = Path::new(&prefs.source).join("target.txt");
    let results = std::thread::scope(|s| {
        let first = s.spawn(|| engine::move_no_replace(&a, &target));
        let second = s.spawn(|| engine::move_no_replace(&b, &target));
        [first.join().unwrap(), second.join().unwrap()]
    });
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_ne!(a.exists(), b.exists());
    assert!([b"a".to_vec(), b"b".to_vec()].contains(&fs::read(target).unwrap()));
}

fn fixture() -> (TempDir, Runtime, Preferences) {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("downloads");
    fs::create_dir(&source).unwrap();
    let source = fs::canonicalize(source)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let store = Store::open(&temp.path().join("test.sqlite3"), &source).unwrap();
    let prefs = store.preferences().unwrap();
    (
        temp,
        Runtime {
            store,
            preview: None,
            sequence: 0,
            watcher: None,
            session: None,
            watch_error: None,
            overflow: Arc::new(AtomicU64::new(0)),
        },
        prefs,
    )
}
fn old_file(path: &Path, data: &[u8]) {
    fs::write(path, data).unwrap();
    File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(FileTimes::new().set_modified(SystemTime::now() - Duration::from_secs(60)))
        .unwrap();
}
fn plan(prefs: &Preferences) -> Preview {
    Preview {
        id: 1,
        created: engine::now(),
        files: engine::scan(prefs).unwrap(),
    }
}

#[test]
fn classifies_extensions_case_and_missing() {
    for (name, category) in [
        ("photo.JPG", "images"),
        ("movie.mkv", "videos"),
        ("song.FLAC", "audio"),
        ("invoice.pdf", "documents"),
        ("archive.tar.gz", "archives"),
        ("setup.msi", "installers"),
        ("main.rs", "code"),
        ("LICENSE", "other"),
        ("odd.xyz", "other"),
    ] {
        assert_eq!(engine::classify(Path::new(name)).id, category);
    }
    let all = engine::categories();
    let extensions: Vec<_> = all.iter().flat_map(|c| &c.extensions).collect();
    assert_eq!(
        extensions.len(),
        extensions.iter().collect::<HashSet<_>>().len()
    );
}
use std::collections::HashSet;

#[test]
fn moves_real_files_and_undoes() {
    let (_temp, mut runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("photo.JPG");
    old_file(&source, b"photo bytes");
    let preview = plan(&prefs);
    let target = PathBuf::from(&preview.files[0].destination);
    let op = execute(&mut runtime, preview, "manual", None).unwrap();
    assert!(!source.exists());
    assert_eq!(fs::read(&target).unwrap(), b"photo bytes");
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "moved");
    undo(&mut runtime, op, None).unwrap();
    assert_eq!(fs::read(&source).unwrap(), b"photo bytes");
    assert!(!target.exists());
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "undone");
}

#[test]
fn extensionless_file_is_preserved_in_other() {
    let (_temp, mut runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("LICENSE"), b"license");
    execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    assert_eq!(
        fs::read(Path::new(&prefs.source).join("Outros/LICENSE")).unwrap(),
        b"license"
    );
}

#[test]
fn destination_conflict_preserves_both_files() {
    let (_temp, _runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("same.txt");
    let folder = Path::new(&prefs.source).join("Documentos");
    fs::create_dir(&folder).unwrap();
    let target = folder.join("same.txt");
    old_file(&source, b"original");
    old_file(&target, b"existing");
    assert_eq!(plan(&prefs).files[0].status, "conflict");
    assert!(engine::move_no_replace(&source, &target).is_err());
    assert_eq!(fs::read(source).unwrap(), b"original");
    assert_eq!(fs::read(target).unwrap(), b"existing");
}

#[test]
fn conflict_created_after_preview_is_not_overwritten() {
    let (_temp, mut runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("a.pdf"), b"original");
    let preview = plan(&prefs);
    let target = PathBuf::from(&preview.files[0].destination);
    fs::create_dir(target.parent().unwrap()).unwrap();
    old_file(&target, b"new occupant");
    let op = execute(&mut runtime, preview, "manual", None).unwrap();
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "failed");
    assert_eq!(fs::read(target).unwrap(), b"new occupant");
    assert!(Path::new(&prefs.source).join("a.pdf").exists());
}

#[test]
fn partial_failures_do_not_stop_other_files() {
    let (_temp, mut runtime, prefs) = fixture();
    let a = Path::new(&prefs.source).join("a.txt");
    let b = Path::new(&prefs.source).join("b.txt");
    old_file(&a, b"a");
    old_file(&b, b"b");
    let preview = plan(&prefs);
    fs::remove_file(&a).unwrap();
    let op = execute(&mut runtime, preview, "manual", None).unwrap();
    let movements = runtime.store.movements(op).unwrap();
    assert_eq!(movements[0].status, "failed");
    assert_eq!(movements[1].status, "moved");
}

#[test]
fn changed_file_after_preview_is_not_moved() {
    let (_temp, mut runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("a.txt");
    old_file(&source, b"a");
    let preview = plan(&prefs);
    fs::write(&source, b"changed").unwrap();
    let op = execute(&mut runtime, preview, "manual", None).unwrap();
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "failed");
    assert!(source.exists());
}

#[test]
fn undo_conflicts_are_retryable_and_preserve_files() {
    let (_temp, mut runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("a.txt");
    old_file(&source, b"original");
    let op = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    old_file(&source, b"occupant");
    undo(&mut runtime, op, None).unwrap();
    let movement = runtime.store.movements(op).unwrap().remove(0);
    assert_eq!(movement.status, "moved");
    assert!(movement.error.is_some());
    assert_eq!(fs::read(&source).unwrap(), b"occupant");
    assert_eq!(fs::read(&movement.destination).unwrap(), b"original");
    fs::remove_file(&source).unwrap();
    undo(&mut runtime, op, None).unwrap();
    assert_eq!(fs::read(&source).unwrap(), b"original");
}

#[test]
fn undo_refuses_modified_content_even_with_same_size_and_time() {
    let (_temp, mut runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("a.txt"), b"original");
    let op = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    let movement = runtime.store.movements(op).unwrap().remove(0);
    let original_time = fs::metadata(&movement.destination)
        .unwrap()
        .modified()
        .unwrap();
    fs::write(&movement.destination, b"modified").unwrap();
    File::options()
        .write(true)
        .open(&movement.destination)
        .unwrap()
        .set_times(FileTimes::new().set_modified(original_time))
        .unwrap();
    undo(&mut runtime, op, None).unwrap();
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "moved");
    assert!(runtime.store.movements(op).unwrap()[0].error.is_some());
    assert!(!Path::new(&movement.source).exists());
    assert_eq!(fs::read(&movement.destination).unwrap(), b"modified");
}

#[test]
fn temporary_recent_files_and_disabled_categories_are_ignored() {
    let (_temp, mut runtime, mut prefs) = fixture();
    for name in ["a.crdownload", "b.part", "c.tmp", ".hidden", "~office.docx"] {
        old_file(&Path::new(&prefs.source).join(name), b"partial");
    }
    fs::write(Path::new(&prefs.source).join("recent.txt"), b"writing").unwrap();
    old_file(&Path::new(&prefs.source).join("image.png"), b"png");
    prefs.enabled_categories.retain(|id| id != "images");
    runtime.store.save(&prefs).unwrap();
    assert!(plan(&prefs).files.iter().all(|f| f.status == "ignored"));
    assert_eq!(
        runtime.store.preferences().unwrap().enabled_categories,
        prefs.enabled_categories
    );
}

#[test]
fn invalid_paths_are_rejected() {
    let (temp, _runtime, mut prefs) = fixture();
    assert!(engine::validate_directory(Path::new("relative")).is_err());
    assert!(
        engine::validate_directory(&temp.path().join("downloads").join("..").join("downloads"))
            .is_err()
    );
    prefs.destination = Path::new(&prefs.source)
        .join("missing")
        .to_string_lossy()
        .into();
    assert!(engine::scan(&prefs).is_err());
}

#[test]
fn nested_destination_is_not_scanned_recursively() {
    let (_temp, mut runtime, mut prefs) = fixture();
    let nested = Path::new(&prefs.source).join("Organizados");
    fs::create_dir(&nested).unwrap();
    prefs.destination = nested.to_string_lossy().into();
    runtime.store.save(&prefs).unwrap();
    old_file(&Path::new(&prefs.source).join("a.txt"), b"a");
    execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    assert!(plan(&prefs).files.is_empty());
}

#[test]
fn journal_recovers_completed_and_unexecuted_intents() {
    let (_temp, runtime, prefs) = fixture();
    old_file(&Path::new(&prefs.source).join("a.txt"), b"a");
    old_file(&Path::new(&prefs.source).join("b.txt"), b"b");
    let preview = plan(&prefs);
    let op = runtime.store.begin("manual").unwrap();
    for (index, entry) in preview.files.iter().enumerate() {
        let (mut file, digest) = prepare_move(entry, &prefs).unwrap();
        runtime
            .store
            .record(
                op,
                &entry.path,
                &entry.destination,
                "pending",
                entry.stamp.as_ref().unwrap(),
                &digest,
            )
            .unwrap();
        if index == 0 {
            engine::move_locked(
                &mut file,
                Path::new(&entry.path),
                Path::new(&entry.destination),
            )
            .unwrap();
        }
        drop(file);
    }
    runtime.store.recover().unwrap();
    let moves = runtime.store.movements(op).unwrap();
    assert_eq!(moves[0].status, "moved");
    assert_eq!(moves[1].status, "failed");
}

#[test]
fn monitoring_starts_disabled_and_does_not_process_existing_files() {
    let (_temp, mut runtime, mut prefs) = fixture();
    assert!(!prefs.automatic);
    let existing = Path::new(&prefs.source).join("existing.txt");
    old_file(&existing, b"existing");
    prefs.automatic = true;
    runtime.store.save(&prefs).unwrap();
    let (tx, _rx) = mpsc::sync_channel(1024);
    monitor::configure(&mut runtime, &tx).unwrap();
    assert!(
        runtime
            .session
            .as_ref()
            .unwrap()
            .baseline
            .contains(&existing)
    );
    assert!(runtime.store.history().unwrap().is_empty());
    prefs.automatic = false;
    runtime.store.save(&prefs).unwrap();
    monitor::configure(&mut runtime, &tx).unwrap();
    assert!(runtime.watcher.is_none());
}

#[cfg(windows)]
#[test]
fn locked_writer_is_not_moved() {
    use std::os::windows::fs::OpenOptionsExt;
    let (_temp, mut runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("busy.txt");
    old_file(&source, b"writing");
    let preview = plan(&prefs);
    let _writer = File::options()
        .write(true)
        .share_mode(0)
        .open(&source)
        .unwrap();
    let op = execute(&mut runtime, preview, "manual", None).unwrap();
    assert_eq!(runtime.store.movements(op).unwrap()[0].status, "failed");
    assert!(source.exists());
}

#[cfg(windows)]
#[test]
fn junction_destination_is_rejected() {
    let (temp, _runtime, prefs) = fixture();
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let junction = Path::new(&prefs.source).join("Documentos");
    assert!(
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .output()
            .unwrap()
            .status
            .success()
    );
    old_file(&Path::new(&prefs.source).join("a.txt"), b"a");
    assert_eq!(plan(&prefs).files[0].status, "ignored");
    assert!(engine::validate_directory(&junction).is_err());
    fs::remove_dir(junction).unwrap();
}

#[cfg(unix)]
#[test]
fn symlinks_are_ignored() {
    let (temp, _runtime, prefs) = fixture();
    let external = temp.path().join("external.txt");
    old_file(&external, b"outside");
    std::os::unix::fs::symlink(&external, Path::new(&prefs.source).join("link.txt")).unwrap();
    assert_eq!(plan(&prefs).files[0].status, "ignored");
}

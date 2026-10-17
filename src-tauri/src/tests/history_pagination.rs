use super::*;
use std::collections::HashSet;

fn seed(store: &Store, count: usize) {
    store.db.execute_batch("BEGIN").unwrap();
    for _ in 0..count {
        let id = store.begin("manual").unwrap();
        store
            .record(
                id,
                "/isolated/source.txt",
                "/isolated/output/source.txt",
                "moved",
                &Stamp {
                    size: 1,
                    modified: 1,
                },
                "digest",
            )
            .unwrap();
    }
    store.db.execute_batch("COMMIT").unwrap();
}

#[test]
fn cursor_pages_cover_empty_small_and_large_histories_without_duplicates() {
    for count in [0, 1, 99, 100, 101, 1205] {
        let (_temp, runtime, _prefs) = fixture();
        seed(&runtime.store, count);
        let mut cursor = None;
        let mut ids = Vec::new();
        loop {
            let page = runtime.store.history_page(cursor).unwrap();
            assert!(page.operations.len() <= 100);
            for op in &page.operations {
                assert!(cursor.is_none_or(|cursor| op.id < cursor));
                assert_eq!((op.total, op.moved, op.undone, op.errors), (1, 1, 0, 0));
            }
            if page.next_cursor.is_some() {
                assert_eq!(page.next_cursor, page.operations.last().map(|op| op.id));
            }
            ids.extend(page.operations.into_iter().map(|op| op.id));
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(ids.len(), count);
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), count);
        assert!(ids.windows(2).all(|pair| pair[0] > pair[1]));
    }
}

#[test]
fn arrivals_and_updates_do_not_shift_the_cursor_or_change_order() {
    let (_temp, runtime, _prefs) = fixture();
    seed(&runtime.store, 205);
    runtime
        .store
        .db
        .execute("UPDATE operations SET created=1", [])
        .unwrap();
    let first = runtime.store.history_page(None).unwrap();
    let last = first.next_cursor.unwrap();
    seed(&runtime.store, 3);
    let old = runtime.store.movements(1).unwrap().remove(0);
    runtime.store.status(old.id, "undone", None).unwrap();
    let second = runtime.store.history_page(Some(last)).unwrap();
    let third = runtime.store.history_page(second.next_cursor).unwrap();
    let ids: Vec<_> = first
        .operations
        .iter()
        .chain(&second.operations)
        .chain(&third.operations)
        .map(|op| op.id)
        .collect();
    assert_eq!(ids, (1..=205).rev().collect::<Vec<_>>());
    let oldest = third.operations.last().unwrap();
    assert_eq!((oldest.id, oldest.moved, oldest.undone), (1, 0, 1));
    assert_eq!(
        runtime.store.history_page(None).unwrap().operations[0].id,
        208
    );
}

#[test]
fn summaries_do_not_serialize_movements_and_details_are_explicit() {
    let (_temp, runtime, _prefs) = fixture();
    let id = runtime.store.begin("manual").unwrap();
    runtime.store.db.execute_batch("BEGIN").unwrap();
    for index in 0..5000 {
        runtime
            .store
            .record(
                id,
                &format!("/isolated/{index}.txt"),
                &format!("C:\\isolated\\Documents\\{index}.txt"),
                if index % 2 == 0 { "moved" } else { "undone" },
                &Stamp {
                    size: 1,
                    modified: 1,
                },
                "digest",
            )
            .unwrap();
    }
    runtime.store.db.execute_batch("COMMIT").unwrap();
    let first = runtime.store.history_page(None).unwrap();
    assert_eq!(
        (
            first.operations[0].total,
            first.operations[0].moved,
            first.operations[0].undone
        ),
        (5000, 2500, 2500)
    );
    let payload = serde_json::to_string(&first).unwrap();
    assert!(!payload.contains("movements"));
    assert!(!payload.contains("isolated"));
    assert!(payload.len() < 256);
    let detail = runtime.store.operation(id).unwrap();
    assert_eq!(detail.id, id);
    assert_eq!(detail.movements.len(), 5000);
    assert_eq!(detail.movements[4999].source, "/isolated/4999.txt");
    let summary = runtime.store.operation_summary(id).unwrap();
    assert_eq!(
        (summary.id, summary.total, summary.moved, summary.undone),
        (id, 5000, 2500, 2500)
    );
    let destinations = runtime.store.operation_destinations(id).unwrap();
    assert_eq!(
        destinations.folders,
        vec![("C:\\isolated\\Documents\\".into(), 5000)]
    );
    assert_eq!(destinations.other_folders, 0);
    assert!(runtime.store.operation(id + 1).is_err());
    assert!(runtime.store.operation_summary(id + 1).is_err());
    assert!(runtime.store.history_page(Some(0)).is_err());
    assert!(runtime.store.history_page(Some(-1)).is_err());
}

#[test]
fn page_query_uses_operation_primary_key_and_movement_index() {
    let (_temp, runtime, _prefs) = fixture();
    seed(&runtime.store, 1205);
    let mut query = runtime
        .store
        .db
        .prepare(&format!(
            "EXPLAIN QUERY PLAN {}",
            crate::store::HISTORY_SUMMARIES_SQL
        ))
        .unwrap();
    let plan = query
        .query_map([1, 1100, 100], |r| r.get::<_, String>(3))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap()
        .join("\n");
    assert!(
        plan.contains("SEARCH operations USING INTEGER PRIMARY KEY"),
        "{plan}"
    );
    assert!(plan.contains("movements_operation"), "{plan}");
}

#[test]
fn destinations_and_error_counts_match_real_states_and_stay_compact() {
    let (_temp, runtime, _prefs) = fixture();
    let id = runtime.store.begin("manual").unwrap();
    for (index, status) in [
        "moved",
        "undone",
        "failed",
        "uncertain",
        "pending",
        "undo_pending",
        "moved",
    ]
    .iter()
    .enumerate()
    {
        let movement = runtime
            .store
            .record(
                id,
                "/isolated/source.txt",
                &format!("/isolated/folder-{index}/file.txt"),
                status,
                &Stamp {
                    size: 1,
                    modified: 1,
                },
                "digest",
            )
            .unwrap();
        if index == 6 {
            runtime
                .store
                .status(movement, status, Some("Retry needed"))
                .unwrap();
        }
    }
    let page = runtime.store.history_page(None).unwrap();
    assert_eq!(
        (
            page.operations[0].total,
            page.operations[0].moved,
            page.operations[0].undone,
            page.operations[0].errors
        ),
        (7, 2, 1, 5)
    );
    let folders = runtime.store.operation_destinations(id).unwrap();
    assert_eq!(folders.folders.len(), 5);
    assert_eq!((folders.other_folders, folders.other_files), (2, 2));
    assert_eq!(folders.folders[0].0, "/isolated/folder-0/");
}

#[test]
fn old_operation_remains_reversible_by_its_original_id_after_reopen() {
    let (temp, mut runtime, prefs) = fixture();
    let source = Path::new(&prefs.source).join("original.txt");
    old_file(&source, b"preserve old content");
    let old = execute(&mut runtime, plan(&prefs), "manual", None).unwrap();
    seed(&runtime.store, 1005);
    drop(runtime.store);
    runtime.store = Store::open(&temp.path().join("test.sqlite3"), &prefs.source).unwrap();
    assert!(
        runtime
            .store
            .history_page(None)
            .unwrap()
            .operations
            .iter()
            .all(|op| op.id != old)
    );
    let details = runtime.store.operation(old).unwrap();
    assert_eq!(details.movements.len(), 1);
    assert_eq!(details.movements[0].status, "moved");
    undo(&mut runtime, old, None).unwrap();
    assert_eq!(fs::read(source).unwrap(), b"preserve old content");
    assert_eq!(
        runtime.store.operation(old).unwrap().movements[0].status,
        "undone"
    );
    let page = runtime.store.history_page(Some(old + 1)).unwrap();
    assert_eq!(
        (
            page.operations[0].id,
            page.operations[0].undone,
            page.operations[0].moved
        ),
        (old, 1, 0)
    );
    assert_eq!(
        runtime
            .store
            .db
            .query_row("SELECT count(*) FROM operations", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1006
    );
}

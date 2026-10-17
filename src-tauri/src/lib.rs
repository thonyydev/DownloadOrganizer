mod directories;
mod engine;
mod monitor;
mod queue;
mod store;
#[cfg(test)]
mod tests;
mod volume;

use engine::{Preferences, Preview, Result, Stamp};
use notify::RecommendedWatcher;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, atomic::AtomicU64, mpsc},
};
use store::{DestinationSummary, HistoryPage, Operation, OperationSummary, Store};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_window_state::StateFlags;

struct Runtime {
    store: Store,
    preview: Option<Preview>,
    sequence: u64,
    watcher: Option<RecommendedWatcher>,
    session: Option<monitor::Session>,
    watch_error: Option<String>,
    overflow: Arc<AtomicU64>,
}
struct AppState {
    runtime: Mutex<Runtime>,
    events: mpsc::SyncSender<monitor::Message>,
}

#[derive(Clone, Serialize)]
struct Progress {
    completed: usize,
    total: usize,
    name: String,
    kind: String,
    phase: String,
    operation_id: Option<i64>,
}
#[derive(Serialize)]
struct Snapshot {
    preferences: Preferences,
    categories: &'static [engine::Category],
    files: Vec<engine::FileEntry>,
    history: Vec<OperationSummary>,
    history_cursor: Option<i64>,
    monitoring: bool,
    watch_error: Option<String>,
    scan_error: Option<String>,
    preview_id: Option<u64>,
}

fn progress(
    app: Option<&AppHandle>,
    completed: usize,
    total: usize,
    name: &str,
    kind: &str,
    phase: &str,
    operation_id: Option<i64>,
) {
    if let Some(app) = app {
        let _ = app.emit(
            "organizer-progress",
            Progress {
                completed,
                total,
                name: name.into(),
                kind: kind.into(),
                phase: phase.into(),
                operation_id,
            },
        );
    }
}

fn lock(state: &AppState) -> Result<std::sync::MutexGuard<'_, Runtime>> {
    state
        .runtime
        .lock()
        .map_err(|_| "Estado interno indisponível; reinicie o aplicativo".into())
}

fn execute(
    runtime: &mut Runtime,
    preview: Preview,
    kind: &str,
    app: Option<&AppHandle>,
) -> Result<i64> {
    let total = preview.files.iter().filter(|f| f.status == "ready").count();
    progress(app, 0, total, "", kind, "preparing", None);
    let mut operation_id = None;
    let result = (|| {
        let prefs = runtime.store.preferences()?;
        engine::validate_preferences(&prefs)?;
        let ready: Vec<_> = preview
            .files
            .into_iter()
            .filter(|f| f.status == "ready")
            .collect();
        if ready.is_empty() {
            return Err("Nenhum arquivo pronto para organizar".into());
        }
        let operation = runtime.store.begin(kind)?;
        operation_id = Some(operation);
        let total = ready.len();
        for (index, entry) in ready.into_iter().enumerate() {
            progress(
                app,
                index,
                total,
                &entry.name,
                kind,
                "preparing",
                operation_id,
            );
            let captured = entry.stamp.as_ref().ok_or("Metadados inválidos")?;
            match engine::prepare_move(&entry, &prefs, |folder| {
                runtime.store.create_directory(operation, folder)
            }) {
                Ok((mut file, digest)) => {
                    progress(
                        app,
                        index,
                        total,
                        &entry.name,
                        kind,
                        "organizing",
                        operation_id,
                    );
                    let id = runtime.store.record(
                        operation,
                        &entry.path,
                        &entry.destination,
                        "pending",
                        captured,
                        &digest,
                    )?;
                    let result = engine::move_locked(
                        &mut file,
                        Path::new(&entry.path),
                        Path::new(&entry.destination),
                    );
                    match result {
                        Ok(()) => {
                            if let Err(error) = engine::verify_open(&mut file, captured, &digest) {
                                runtime.store.status(id, "uncertain", Some(&error))?;
                            } else {
                                runtime.store.status(id, "moved", None)?;
                            }
                        }
                        Err(error) => {
                            let state = if Path::new(&entry.path).exists() {
                                "failed"
                            } else {
                                "uncertain"
                            };
                            runtime.store.status(id, state, Some(&error))?;
                        }
                    }
                }
                Err(error) => {
                    let id = runtime.store.record(
                        operation,
                        &entry.path,
                        &entry.destination,
                        "failed",
                        captured,
                        "",
                    )?;
                    runtime.store.status(id, "failed", Some(&error))?;
                }
            }
            progress(
                app,
                index + 1,
                total,
                &entry.name,
                kind,
                "organizing",
                operation_id,
            );
        }
        Ok(operation)
    })();
    let cleanup = operation_id.map_or(Ok(()), |id| runtime.store.cleanup_directories(Some(id)));
    let result = match (result, cleanup) {
        (result, Ok(())) => result,
        (Ok(_), Err(error)) => Err(error),
        (Err(error), Err(cleanup)) => Err(format!("{error}; {cleanup}")),
    };
    progress(
        app,
        if result.is_ok() { total } else { 0 },
        total,
        "",
        kind,
        if result.is_ok() { "completed" } else { "error" },
        operation_id,
    );
    if let Some(app) = app {
        let _ = app.emit("organizer-changed", ());
    }
    result
}

fn undo(runtime: &mut Runtime, operation: i64, app: Option<&AppHandle>) -> Result<()> {
    progress(app, 0, 0, "", "undo", "preparing", Some(operation));
    let result = (|| {
        let movements: Vec<_> = runtime
            .store
            .movements(operation)?
            .into_iter()
            .filter(|m| m.status == "moved")
            .collect();
        if movements.is_empty() {
            return Err("Não há movimentações reversíveis nesta operação".into());
        }
        let total = movements.len();
        runtime.preview = None;
        for (index, item) in movements.into_iter().enumerate() {
            let name = Path::new(&item.source)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy();
            progress(
                app,
                index,
                total,
                &name,
                "undo",
                "preparing",
                Some(operation),
            );
            let captured = Stamp {
                size: item.size,
                modified: item.modified,
            };
            match engine::verify_file(Path::new(&item.destination), &captured, &item.digest) {
                Err(error) => runtime.store.status(item.id, "moved", Some(&error))?,
                Ok(mut file) => {
                    progress(
                        app,
                        index,
                        total,
                        &name,
                        "undo",
                        "organizing",
                        Some(operation),
                    );
                    // Persistence errors must stop the batch before any further filesystem operation.
                    runtime.store.status(item.id, "undo_pending", None)?;
                    match engine::move_locked(
                        &mut file,
                        Path::new(&item.destination),
                        Path::new(&item.source),
                    ) {
                        Err(error) => runtime.store.status(item.id, "moved", Some(&error))?,
                        Ok(()) => {
                            if let Some(session) = runtime.session.as_mut() {
                                let path = std::path::PathBuf::from(&item.source);
                                session.baseline.insert(path.clone());
                                session.restored.insert(path, captured.clone());
                            }
                            match engine::verify_open(&mut file, &captured, &item.digest) {
                                Ok(()) => runtime.store.status(item.id, "undone", None)?,
                                Err(error) => {
                                    runtime.store.status(item.id, "uncertain", Some(&error))?
                                }
                            }
                        }
                    }
                }
            }
            progress(
                app,
                index + 1,
                total,
                &name,
                "undo",
                "organizing",
                Some(operation),
            );
        }
        runtime.store.cleanup_directories(Some(operation))
    })();
    progress(
        app,
        0,
        0,
        "",
        "undo",
        if result.is_ok() { "completed" } else { "error" },
        Some(operation),
    );
    if let Some(app) = app {
        let _ = app.emit("organizer-changed", ());
    }
    result
}

fn take_preview(runtime: &mut Runtime, id: u64, now: i64) -> Result<Preview> {
    let invalid = || {
        "PREVIEW_INVALID: A prévia expirou ou os arquivos mudaram. Atualize e confira os novos destinos antes de confirmar.".to_owned()
    };
    let preview = runtime
        .preview
        .as_ref()
        .filter(|p| p.id == id && (0..300).contains(&now.saturating_sub(p.created)))
        .ok_or_else(invalid)?;
    let current: HashMap<_, _> = engine::scan(&runtime.store.preferences()?)?
        .into_iter()
        .map(|file| (file.path.clone(), file))
        .collect();
    if preview
        .files
        .iter()
        .filter(|f| f.status == "ready")
        .any(|old| {
            !current.get(&old.path).is_some_and(|new| {
                new.destination == old.destination
                    && new.status == "ready"
                    && new.stamp == old.stamp
            })
        })
    {
        runtime.preview = None;
        return Err(invalid());
    }
    runtime.preview.take().ok_or_else(invalid)
}

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn snapshot(app: AppHandle) -> Result<Snapshot> {
    blocking(move || {
        let state = app.state::<AppState>();
        let runtime = lock(&state)?;
        let prefs = runtime.store.preferences()?;
        let scan = engine::scan(&prefs);
        let scan_error = scan.as_ref().err().cloned();
        let history = runtime.store.history_page(None)?;
        Ok(Snapshot {
            preferences: prefs,
            categories: engine::categories(),
            files: scan.unwrap_or_default(),
            history: history.operations,
            history_cursor: history.next_cursor,
            monitoring: runtime.watcher.is_some(),
            watch_error: runtime.watch_error.clone(),
            scan_error,
            preview_id: runtime
                .preview
                .as_ref()
                .filter(|p| (0..300).contains(&engine::now().saturating_sub(p.created)))
                .map(|p| p.id),
        })
    })
    .await
}

#[tauri::command]
async fn history_page(app: AppHandle, before: Option<i64>) -> Result<HistoryPage> {
    blocking(move || {
        let state = app.state::<AppState>();
        lock(&state)?.store.history_page(before)
    })
    .await
}

#[tauri::command]
async fn operation_summary(app: AppHandle, operation_id: i64) -> Result<OperationSummary> {
    blocking(move || {
        let state = app.state::<AppState>();
        lock(&state)?.store.operation_summary(operation_id)
    })
    .await
}

#[tauri::command]
async fn operation_details(app: AppHandle, operation_id: i64) -> Result<Operation> {
    blocking(move || {
        let state = app.state::<AppState>();
        lock(&state)?.store.operation(operation_id)
    })
    .await
}

#[tauri::command]
async fn operation_destinations(app: AppHandle, operation_id: i64) -> Result<DestinationSummary> {
    blocking(move || {
        let state = app.state::<AppState>();
        lock(&state)?.store.operation_destinations(operation_id)
    })
    .await
}

#[tauri::command]
async fn preview(app: AppHandle) -> Result<Preview> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut runtime = lock(&state)?;
        let files = engine::scan(&runtime.store.preferences()?)?;
        runtime.sequence += 1;
        let preview = Preview {
            id: runtime.sequence,
            files,
            created: engine::now(),
        };
        runtime.preview = Some(preview.clone());
        Ok(preview)
    })
    .await
}

#[tauri::command]
async fn organize(app: AppHandle, preview_id: u64) -> Result<i64> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut runtime = lock(&state)?;
        let preview = take_preview(&mut runtime, preview_id, engine::now())?;
        execute(&mut runtime, preview, "manual", Some(&app))
    })
    .await
}

#[tauri::command]
async fn undo_operation(app: AppHandle, operation_id: i64) -> Result<()> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut runtime = lock(&state)?;
        undo(&mut runtime, operation_id, Some(&app))
    })
    .await
}

#[tauri::command]
async fn save_preferences(
    app: AppHandle,
    preferences: Preferences,
    expected: Preferences,
) -> Result<Preferences> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut runtime = lock(&state)?;
        runtime
            .store
            .save_if_unchanged(&preferences, Some(&expected))?;
        runtime.preview = None;
        if let Err(error) = monitor::configure(&mut runtime, &state.events) {
            runtime.watch_error = Some(error.clone());
        }
        let _ = app.emit("organizer-changed", ());
        runtime.store.preferences()
    })
    .await
}

#[tauri::command]
async fn retry_monitoring(app: AppHandle) -> Result<()> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut runtime = lock(&state)?;
        let result = (|| {
            engine::validate_preferences(&runtime.store.preferences()?)?;
            monitor::configure(&mut runtime, &state.events)
        })();
        runtime.watch_error = result.as_ref().err().cloned();
        let _ = app.emit("organizer-changed", ());
        result
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let result = window.show().and_then(|()| {
                    if window.is_minimized()? {
                        window.unminimize()?;
                    }
                    window.set_focus()
                });
                if let Err(error) = result {
                    eprintln!("Não foi possível ativar a janela existente: {error}");
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let default_source = app
                .path()
                .download_dir()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let store = Store::open(&data.join("organizer.sqlite3"), &default_source)
                .map_err(std::io::Error::other)?;
            let (events, receiver) = mpsc::sync_channel(1024);
            let mut runtime = Runtime {
                store,
                preview: None,
                sequence: 0,
                watcher: None,
                session: None,
                watch_error: None,
                overflow: Arc::new(AtomicU64::new(0)),
            };
            if let Err(error) = monitor::configure(&mut runtime, &events) {
                runtime.watch_error = Some(error);
            }
            app.manage(AppState {
                runtime: Mutex::new(runtime),
                events,
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || monitor::worker(handle, receiver));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            history_page,
            operation_summary,
            operation_details,
            operation_destinations,
            preview,
            organize,
            undo_operation,
            save_preferences,
            retry_monitoring
        ])
        .run(tauri::generate_context!())
        .expect("Falha ao iniciar Download Organizer");
}

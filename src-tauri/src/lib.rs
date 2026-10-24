mod directories;
mod engine;
mod file_preview;
mod media_preview;
mod monitor;
mod queue;
mod startup;
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
    file_previews: Mutex<file_preview::Access>,
    file_preview_job: Mutex<()>,
    media_previews: Mutex<media_preview::Sessions>,
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
        let files = scan.unwrap_or_default();
        state
            .file_previews
            .lock()
            .map_err(|_| "Visualização indisponível; reinicie o aplicativo")?
            .update(&prefs, &files);
        Ok(Snapshot {
            preferences: prefs,
            categories: engine::categories(),
            files,
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
async fn file_preview(
    app: AppHandle,
    path: String,
    size: u64,
    modified: i64,
) -> Result<file_preview::FilePreview> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _job = state
            .file_preview_job
            .try_lock()
            .map_err(|_| "Outra imagem está sendo preparada. Tente novamente em instantes.")?;
        let authorize = || {
            let prefs = lock(&state)?.store.preferences()?;
            state
                .file_previews
                .lock()
                .map_err(|_| "Visualização indisponível; reinicie o aplicativo")?
                .authorize(&prefs, &path, size, modified)
        };
        let expected = authorize()?;
        let result = file_preview::load(Path::new(&path), &expected)?;
        if authorize()? != expected {
            return Err("O arquivo mudou. Atualize a lista e tente novamente.".into());
        }
        Ok(result)
    })
    .await
}

fn authorize_media(state: &AppState, path: &str, size: u64, modified: i64) -> Result<Stamp> {
    let prefs = lock(state)?.store.preferences()?;
    state
        .file_previews
        .lock()
        .map_err(|_| "Visualização indisponível")?
        .authorize(&prefs, path, size, modified)
}

#[tauri::command]
async fn open_media_preview(
    app: AppHandle,
    path: String,
    size: u64,
    modified: i64,
) -> Result<media_preview::MediaPreview> {
    blocking(move || {
        let state = app.state::<AppState>();
        let stamp = authorize_media(&state, &path, size, modified)?;
        let session = media_preview::Session::open(Path::new(&path), stamp.clone())?;
        if authorize_media(&state, &path, size, modified)? != stamp {
            return Err("O arquivo mudou. Atualize a lista.".into());
        }
        state
            .media_previews
            .lock()
            .map_err(|_| "Visualização indisponível")?
            .insert(session)
    })
    .await
}

#[tauri::command]
async fn close_media_preview(app: AppHandle, token: String) -> Result<()> {
    blocking(move || {
        app.state::<AppState>()
            .media_previews
            .lock()
            .map_err(|_| "Visualização indisponível")?
            .close(&token);
        Ok(())
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
    if let Err(error) = run_application() {
        startup::show_error(error);
        std::process::exit(1);
    }
}

fn run_application() -> std::result::Result<(), startup::StartupError> {
    let app = tauri::Builder::default()
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
        .register_asynchronous_uri_scheme_protocol(
            "media-preview",
            |context, request, responder| {
                let app = context.app_handle().clone();
                let main = context.webview_label() == "main";
                tauri::async_runtime::spawn_blocking(move || {
                    let origin = request.headers().get("Origin").cloned();
                    let allowed = origin.as_ref().is_none_or(|value| {
                        matches!(
                            value.to_str(),
                            Ok("http://tauri.localhost"
                                | "https://tauri.localhost"
                                | "tauri://localhost")
                        ) || (cfg!(debug_assertions)
                            && value.to_str().ok()
                                == app
                                    .config()
                                    .build
                                    .dev_url
                                    .as_ref()
                                    .map(|url| url.origin().ascii_serialization())
                                    .as_deref())
                    });
                    let mut response = if !main || !allowed {
                        media_preview::response(tauri::http::StatusCode::FORBIDDEN, Vec::new())
                    } else if let Some(state) = app.try_state::<AppState>() {
                        match state.media_previews.lock() {
                            Ok(mut sessions) => sessions.respond(&request, |path, stamp| {
                                let current = authorize_media(
                                    &state,
                                    path.to_str().ok_or("Caminho inválido")?,
                                    stamp.size as u64,
                                    stamp.modified / 1_000_000,
                                )?;
                                if current != *stamp {
                                    return Err("A mídia mudou".into());
                                }
                                Ok(())
                            }),
                            Err(_) => media_preview::response(
                                tauri::http::StatusCode::SERVICE_UNAVAILABLE,
                                Vec::new(),
                            ),
                        }
                    } else {
                        media_preview::response(
                            tauri::http::StatusCode::SERVICE_UNAVAILABLE,
                            Vec::new(),
                        )
                    };
                    if allowed && let Some(origin) = origin {
                        response
                            .headers_mut()
                            .insert("Access-Control-Allow-Origin", origin);
                    }
                    responder.respond(response);
                });
            },
        )
        .invoke_handler(tauri::generate_handler![
            snapshot,
            file_preview,
            open_media_preview,
            close_media_preview,
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
        .build(tauri::generate_context!())
        .map_err(|_| startup::StartupError::Runtime)?;
    // Plugins (including Single Instance) are initialized by build; windows by run.
    let data = app
        .path()
        .app_data_dir()
        .map_err(|_| startup::StartupError::DataDirectory)?;
    let default_source = app
        .path()
        .download_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut runtime = startup::initialize(&data, &default_source)?;
    let (events, receiver) = mpsc::sync_channel(1024);
    if let Err(error) = monitor::configure(&mut runtime, &events) {
        runtime.watch_error = Some(error);
    }
    app.manage(AppState {
        runtime: Mutex::new(runtime),
        events,
        file_previews: Mutex::new(file_preview::Access::default()),
        file_preview_job: Mutex::new(()),
        media_previews: Mutex::new(media_preview::Sessions::default()),
    });
    let handle = app.handle().clone();
    std::thread::Builder::new()
        .spawn(move || monitor::worker(handle, receiver))
        .map_err(|_| startup::StartupError::Runtime)?;
    app.run(|_, _| {});
    Ok(())
}

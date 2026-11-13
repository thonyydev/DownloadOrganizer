use i18n::t;
mod about;
mod autostart;
mod context_menu;
mod directories;
mod engine;
mod file_preview;
mod i18n;
mod media_preview;
mod monitor;
mod queue;
mod startup;
mod store;
#[cfg(test)]
mod tests;
mod trash;

#[cfg(not(windows))]
compile_error!("Download Organizer only supports Windows");

use engine::{Preferences, Preview, Result, Stamp};
use notify::RecommendedWatcher;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, atomic::AtomicU64, mpsc},
    time::Duration,
};
use store::{
    DestinationSummary, FoundMovement, HistoryPage, Operation, OperationSummary, Statistics, Store,
};
use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
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
    update: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>,
    // A folder sent by File Explorer's menu, until the page takes it.
    requested_folder: Mutex<Option<String>>,
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
    language: &'static str,
    files: Vec<engine::FileEntry>,
    history: Vec<OperationSummary>,
    history_cursor: Option<i64>,
    monitoring: bool,
    watch_error: Option<String>,
    scan_error: Option<String>,
    preview_id: Option<u64>,
    update_version: Option<String>,
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

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let result = window.show().and_then(|()| {
            if window.is_minimized()? {
                window.unminimize()?;
            }
            window.set_focus()
        });
        if let Err(error) = result {
            eprintln!("Could not activate the existing window: {error}");
        }
    }
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", t("Open"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", t("Quit"), true, None::<&str>)?;
    Menu::with_items(app, &[&open, &quit])
}

fn sync_tray_status(app: &AppHandle, runtime: &Runtime) {
    if let Some(tray) = app.tray_by_id("main") {
        let status = if runtime.watcher.is_some() {
            t("Monitor on")
        } else {
            t("Monitor paused")
        };
        let _ = tray.set_tooltip(Some(format!("Download Organizer: {status}")));
    }
}

// The window already shows this feedback while it has focus.
fn notify(app: &AppHandle, runtime: &Runtime, title: &str, body: &str) {
    notify_with_id(app, runtime, 0, title, body);
}

fn notify_with_id(app: &AppHandle, runtime: &Runtime, id: i32, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let enabled = runtime.store.preferences().is_ok_and(|p| p.notifications);
    let focused = app
        .get_webview_window("main")
        .is_some_and(|window| window.is_focused().unwrap_or(false));
    if enabled && !focused {
        // On Windows the plugin sends it in the background and never reports a failure.
        let _ = app
            .notification()
            .builder()
            .id(id)
            .title(title)
            .body(body)
            .show();
    }
}

// A monitoring problem at login needs the window, not a silent tray icon.
fn starts_hidden(automatic: bool, monitoring_failed: bool, launched_at_login: bool) -> bool {
    automatic && !monitoring_failed && launched_at_login
}

fn organized_message(summary: &OperationSummary) -> String {
    let moved = format!("{}: {}", t("Files organized"), summary.moved);
    if summary.errors == 0 {
        moved
    } else {
        format!("{moved} · {}: {}", t("Need attention"), summary.errors)
    }
}

// Called right after the batch, under the same lock, so the newest operation is that batch.
fn notify_organized(app: &AppHandle, runtime: &Runtime) {
    if let Ok(page) = runtime.store.history_page(None)
        && let Some(summary) = page.operations.first()
    {
        let title = t("Automatic organization");
        notify_with_id(
            app,
            runtime,
            ORGANIZED_NOTIFICATION,
            title,
            &organized_message(summary),
        );
    }
}

/// The id of the "files organized" notification, so a click on it can open the history.
const ORGANIZED_NOTIFICATION: i32 = 1;

// Windows reports a click only while the toast is on screen, not from the Action Center.
fn open_from_notification(app: &AppHandle, performed: &tauri_plugin_notification::ActionPerformed) {
    if performed.action_id() != "tap" {
        return;
    }
    show_main_window(app);
    if performed
        .notification()
        .is_some_and(|notification| notification.id() == ORGANIZED_NOTIFICATION)
    {
        let _ = app.emit("open-history", ());
    }
}

fn internal_state_error() -> String {
    t("Internal state unavailable; restart the app").into()
}

fn lock(state: &AppState) -> Result<std::sync::MutexGuard<'_, Runtime>> {
    state.runtime.lock().map_err(|_| internal_state_error())
}

fn install_pending_update(app: &AppHandle) -> Result<()> {
    let state = app.state::<AppState>();
    // On success the app exits here, and this lock means no move or undo is running at that point.
    let _runtime = lock(&state)?;
    let pending = state
        .update
        .lock()
        .map_err(|_| internal_state_error())?
        .take();
    if let Some((update, bytes)) = pending {
        update.install(bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Downloads and verifies a newer signed version, and returns the one ready to install.
// `asked` is a check the user started: it runs even with automatic updates off.
fn fetch_update(app: &AppHandle, asked: bool) -> Result<Option<String>> {
    use tauri_plugin_updater::UpdaterExt;
    let state = app.state::<AppState>();
    // Turned off, the app makes no network request unless the user asks.
    if !asked && !lock(&state)?.store.preferences()?.updates {
        return Ok(None);
    }
    let pending = state
        .update
        .lock()
        .map_err(|_| internal_state_error())?
        .as_ref()
        .map(|(update, _)| update.version.clone());
    if pending.is_some() {
        return Ok(pending);
    }
    let found = tauri::async_runtime::block_on(async {
        let updater = app
            .updater_builder()
            .timeout(Duration::from_secs(300))
            .build()?;
        let Some(update) = updater.check().await? else {
            return Ok(None);
        };
        let bytes = update.download(|_, _| {}, || {}).await?;
        Ok::<_, tauri_plugin_updater::Error>(Some((update, bytes)))
    })
    .map_err(|e| e.to_string())?;
    let Some(found) = found else {
        return Ok(None);
    };
    // Saving holds this lock too, so turning updates off can't slip in between.
    let runtime = lock(&state)?;
    if !asked && !runtime.store.preferences()?.updates {
        return Ok(None);
    }
    let version = found.0.version.clone();
    *state.update.lock().map_err(|_| internal_state_error())? = Some(found);
    drop(runtime);
    let _ = app.emit("organizer-changed", ());
    Ok(Some(version))
}

// A visible window asks first; the tray has no draft to lose.
fn update_cycle(app: &AppHandle) -> Result<()> {
    if fetch_update(app, false)?.is_none() {
        return Ok(());
    }
    let hidden = app
        .get_webview_window("main")
        .is_some_and(|window| !window.is_visible().unwrap_or(true));
    if hidden {
        install_pending_update(app)?;
    }
    Ok(())
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
        let prefs =
            engine::preferences_for(runtime.store.preferences()?, preview.folder.as_deref());
        engine::validate_preferences(&prefs)?;
        let ready: Vec<_> = preview
            .files
            .into_iter()
            .filter(|f| f.status == "ready")
            .collect();
        if ready.is_empty() {
            return Err(t("No files ready to organize").into());
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
            let captured = entry.stamp.as_ref().ok_or(t("Invalid metadata"))?;
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
                        &digest,
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
            return Err(t("This operation has no reversible moves").into());
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
                        &item.digest,
                    ) {
                        Err(error) => runtime.store.status(item.id, "moved", Some(&error))?,
                        Ok(()) => {
                            if let Some(session) = runtime.session.as_mut() {
                                let path = std::path::PathBuf::from(&item.source);
                                session.baseline.insert(path.clone());
                                // Another drive may round the date, and an unchanged file must still match.
                                let restored = file
                                    .file
                                    .metadata()
                                    .map_err(|e| e.to_string())
                                    .and_then(|meta| engine::stamp(&meta))
                                    .unwrap_or_else(|_| captured.clone());
                                session.restored.insert(path, restored);
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

// Selection can only narrow what the preview authorized. What won't move can't invalidate it.
fn narrow_preview(preview: &mut Preview, excluded: &[String], rename_conflicts: bool) {
    let excluded: std::collections::HashSet<&String> = excluded.iter().collect();
    preview.files.retain(|file| {
        !excluded.contains(&file.path) && (rename_conflicts || file.status != "conflict")
    });
}

// Runs after validation, which compares against the conflicts a fresh scan still reports.
fn apply_renames(preview: &mut Preview) {
    for file in &mut preview.files {
        if file.status == "conflict"
            && let Some(renamed) = &file.rename_to
        {
            file.destination = renamed.clone();
            file.status = "ready".into();
        }
    }
}

fn take_preview(runtime: &mut Runtime, id: u64, now: i64) -> Result<Preview> {
    let invalid = || {
        t("PREVIEW_INVALID: The preview expired or the files changed. Refresh it and review the new destinations before confirming.").to_owned()
    };
    let preview = runtime
        .preview
        .as_ref()
        .filter(|p| p.id == id && (0..300).contains(&now.saturating_sub(p.created)))
        .ok_or_else(invalid)?;
    let prefs = engine::preferences_for(runtime.store.preferences()?, preview.folder.as_deref());
    let current: HashMap<_, _> = engine::scan(&prefs)?
        .into_iter()
        .map(|file| (file.path.clone(), file))
        .collect();
    if preview
        .files
        .iter()
        .filter(|f| f.status == "ready" || f.status == "conflict")
        .any(|old| {
            !current.get(&old.path).is_some_and(|new| {
                new.destination == old.destination
                    && new.status == old.status
                    && new.rename_to == old.rename_to
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
            .map_err(|_| t("Preview unavailable; restart the app"))?
            .update(&prefs, &files);
        Ok(Snapshot {
            categories: engine::categories_for(i18n::resolve(&prefs.language)),
            language: i18n::resolve(&prefs.language),
            preferences: prefs,
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
            update_version: state
                .update
                .lock()
                .map_err(|_| internal_state_error())?
                .as_ref()
                .map(|(update, _)| update.version.clone()),
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
            .map_err(|_| t("Another image is being prepared. Try again in a moment."))?;
        let expected = authorize_preview(&state, &path, size, modified)?;
        let result = file_preview::load(Path::new(&path), &expected)?;
        if authorize_preview(&state, &path, size, modified)? != expected {
            return Err(file_preview::changed().into());
        }
        Ok(result)
    })
    .await
}

fn authorize_preview(state: &AppState, path: &str, size: u64, modified: i64) -> Result<Stamp> {
    let prefs = lock(state)?.store.preferences()?;
    state
        .file_previews
        .lock()
        .map_err(|_| t("Preview unavailable; restart the app"))?
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
        let stamp = authorize_preview(&state, &path, size, modified)?;
        let session = media_preview::Session::open(Path::new(&path), stamp.clone())?;
        if authorize_preview(&state, &path, size, modified)? != stamp {
            return Err(file_preview::changed().into());
        }
        state
            .media_previews
            .lock()
            .map_err(|_| t("Preview unavailable"))?
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
            .map_err(|_| t("Preview unavailable"))?
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

/// The history search shows this many matches at most.
const SEARCH_LIMIT: usize = 50;

#[tauri::command]
async fn statistics(app: AppHandle, since: Option<i64>) -> Result<Statistics> {
    blocking(move || lock(&app.state::<AppState>())?.store.statistics(since)).await
}

/// The share card is a PNG drawn by the page, sent as raw bytes. The save dialog runs here,
/// so the page never chooses a path to write to. Returns false when the user cancels.
#[tauri::command]
async fn save_share_image(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<bool> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err(t("Invalid image").into());
    };
    if !valid_share_image(png) {
        return Err(t("Invalid image").into());
    }
    let png = png.clone();
    blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let Some(path) = app
            .dialog()
            .file()
            .set_file_name("download-organizer-stats.png")
            .add_filter("PNG", &["png"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, png).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(true)
    })
    .await
}

fn valid_share_image(png: &[u8]) -> bool {
    png.starts_with(b"\x89PNG\r\n\x1a\n") && png.len() <= 10 * 1024 * 1024
}

/// Sends listed files to the Recycle Bin. Each must be unchanged since the list was read;
/// the page sends what it showed, never a path of its own choosing. Returns how many left.
#[tauri::command]
async fn trash_files(app: AppHandle, files: Vec<(String, u64, i64)>) -> Result<usize> {
    blocking(move || {
        let state = app.state::<AppState>();
        // Its own statement, so the runtime lock is released before the preview list is locked:
        // snapshot takes them in the other order, and holding both here could deadlock.
        let prefs = lock(&state)?.store.preferences()?;
        let paths = trash::checked(
            &*state
                .file_previews
                .lock()
                .map_err(|_| internal_state_error())?,
            &prefs,
            &files,
        )?;
        // No lock from here: Windows may wait on a dialog of its own. An organization holds
        // each file open while moving it, so the two can't lose a file between them.
        let window = app
            .get_webview_window("main")
            .and_then(|window| window.hwnd().ok())
            .map_or(std::ptr::null_mut(), |hwnd| hwnd.0);
        trash::recycle(&paths, window)
    })
    .await
}

#[tauri::command]
async fn search_history(app: AppHandle, query: String) -> Result<Vec<FoundMovement>> {
    blocking(move || {
        let state = app.state::<AppState>();
        lock(&state)?.store.search_movements(&query, SEARCH_LIMIT)
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
async fn preview(app: AppHandle, folder: Option<String>) -> Result<Preview> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut runtime = lock(&state)?;
        let files = engine::scan(&engine::preferences_for(
            runtime.store.preferences()?,
            folder.as_deref(),
        ))?;
        runtime.sequence += 1;
        let preview = Preview {
            id: runtime.sequence,
            files,
            created: engine::now(),
            folder,
        };
        runtime.preview = Some(preview.clone());
        Ok(preview)
    })
    .await
}

/// The folder File Explorer asked to organize, once.
#[tauri::command]
fn take_requested_folder(app: AppHandle) -> Result<Option<String>> {
    Ok(app
        .state::<AppState>()
        .requested_folder
        .lock()
        .map_err(|_| internal_state_error())?
        .take())
}

fn request_folder(app: &AppHandle, folder: String) {
    // A second launch can arrive before the state is managed; the window still opens.
    if let Some(state) = app.try_state::<AppState>()
        && let Ok(mut requested) = state.requested_folder.lock()
    {
        *requested = Some(folder);
    }
    show_main_window(app);
    let _ = app.emit("organize-folder", ());
}

#[tauri::command]
async fn organize(
    app: AppHandle,
    preview_id: u64,
    excluded: Vec<String>,
    rename_conflicts: bool,
) -> Result<i64> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut runtime = lock(&state)?;
        if let Some(preview) = runtime.preview.as_mut().filter(|p| p.id == preview_id) {
            narrow_preview(preview, &excluded, rename_conflicts);
        }
        let mut preview = take_preview(&mut runtime, preview_id, engine::now())?;
        apply_renames(&mut preview);
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

// The Windows setting is applied here so that a refusal also undoes the saved preference.
fn save_with_autostart(
    store: &mut Store,
    preferences: &Preferences,
    expected: &Preferences,
    apply: impl FnOnce(bool) -> Result<()>,
) -> Result<()> {
    store.save_if_unchanged(preferences, Some(expected))?;
    if preferences.autostart != expected.autostart
        && let Err(error) = apply(preferences.autostart)
    {
        store.save_if_unchanged(expected, None)?;
        return Err(error);
    }
    Ok(())
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
        save_with_autostart(
            &mut runtime.store,
            &preferences,
            &expected,
            autostart::apply,
        )?;
        // Only when turned off now: a version the user checked for by hand stays ready while it's off.
        if !preferences.updates && expected.updates {
            *state.update.lock().map_err(|_| internal_state_error())? = None;
        }
        i18n::set_language(&preferences.language);
        if let Err(error) = context_menu::apply(
            preferences.context_menu,
            t("Organize with Download Organizer"),
        ) {
            eprintln!("{error}");
        }
        runtime.preview = None;
        if let Err(error) = monitor::configure(&mut runtime, &state.events) {
            runtime.watch_error = Some(error.clone());
        }
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_menu(tray_menu(&app).ok());
        }
        sync_tray_status(&app, &runtime);
        let _ = app.emit("organizer-changed", ());
        runtime.store.preferences()
    })
    .await
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<String>> {
    // Like the automatic checks, a dev build must never replace itself with a release.
    if cfg!(debug_assertions) {
        return Err("Development builds don't check for updates".into());
    }
    blocking(move || fetch_update(&app, true))
        .await
        .map_err(|error| {
            // The details are technical and in English; the person gets the next step.
            eprintln!("{error}");
            t("Check your connection and try again.").into()
        })
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<()> {
    blocking(move || install_pending_update(&app)).await
}

/// Opens the saved source or destination folder in File Explorer. Takes no path from the page.
#[tauri::command]
async fn open_folder(app: AppHandle, which: String) -> Result<()> {
    blocking(move || {
        let prefs = lock(&app.state::<AppState>())?.store.preferences()?;
        let path = match which.as_str() {
            "source" => prefs.source,
            "destination" => prefs.destination,
            _ => return Err("Unknown folder".into()),
        };
        if !Path::new(&path).is_dir() {
            return Err(
                t("This folder doesn't exist yet. It's created when files are organized.").into(),
            );
        }
        // "explore" only opens folders: a path swapped for a program is never run.
        if shell("explore", &path) {
            Ok(())
        } else {
            Err(t("Could not open the folder.").into())
        }
    })
    .await
}

/// Opens one of the About tab's links in the browser. Takes a name, never an address.
#[tauri::command]
async fn open_link(which: String) -> Result<()> {
    blocking(move || {
        let version = env!("CARGO_PKG_VERSION");
        let url = about::url(&which, version, &about::windows_version()).ok_or("Unknown link")?;
        if shell("open", &url) {
            Ok(())
        } else {
            Err(t("Could not open the link.").into())
        }
    })
    .await
}

/// Shows a moved file selected in File Explorer. The path comes from the history, not from the page.
#[tauri::command]
async fn reveal_movement(app: AppHandle, operation_id: i64, movement_id: i64) -> Result<()> {
    use std::os::windows::process::CommandExt;
    blocking(move || {
        let path = moved_destination(
            &lock(&app.state::<AppState>())?.store,
            operation_id,
            movement_id,
        )?;
        // The full path keeps a program named explorer.exe elsewhere from being run; /select never opens the file.
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        std::process::Command::new(Path::new(&windows).join("explorer.exe"))
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map_err(|_| t("Could not open the folder."))?;
        Ok(())
    })
    .await
}

/// Where a movement still recorded as moved left its file, if the file is still there.
fn moved_destination(store: &Store, operation_id: i64, movement_id: i64) -> Result<String> {
    let missing = t("This file is no longer at the destination.");
    let path = store
        .operation(operation_id)?
        .movements
        .into_iter()
        .find(|movement| movement.id == movement_id && movement.status == "moved")
        .map(|movement| movement.destination)
        .ok_or(missing)?;
    if !Path::new(&path).is_file() {
        return Err(missing.into());
    }
    // The history keeps the \\?\ form, which Explorer doesn't read.
    Ok(file_preview::plain_path(&path))
}

fn shell(verb: &str, target: &str) -> bool {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (verb, file) = (wide(verb), wide(target));
    let code = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    code as isize > 32
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
        sync_tray_status(&app, &runtime);
        let _ = app.emit("organizer-changed", ());
        result
    })
    .await
}

pub fn run() {
    if let Err(error) = run_application() {
        startup::show_error(error);
        std::process::exit(1);
    }
}

fn run_application() -> std::result::Result<(), startup::StartupError> {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            match context_menu::requested_folder(args) {
                Some(folder) => request_folder(app, folder),
                None => show_main_window(app),
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                                let current = authorize_preview(
                                    &state,
                                    path.to_str().ok_or(t("Invalid path"))?,
                                    stamp.size as u64,
                                    stamp.modified / 1_000_000,
                                )?;
                                if current != *stamp {
                                    return Err(t("The media changed").into());
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
            check_update,
            install_update,
            retry_monitoring,
            open_folder,
            reveal_movement,
            search_history,
            take_requested_folder,
            statistics,
            save_share_image,
            trash_files,
            open_link
        ])
        .build(tauri::generate_context!())
        .map_err(|_| startup::StartupError::Runtime)?;
    // Startup errors can happen before preferences load.
    i18n::set_language(i18n::SYSTEM);
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
    let mut automatic = false;
    if let Ok(preferences) = runtime.store.preferences() {
        i18n::set_language(&preferences.language);
        automatic = preferences.automatic;
        // Keeps the entry pointing at this executable after an update.
        if let Err(error) = autostart::apply(preferences.autostart) {
            eprintln!("{error}");
        }
        // Follows the executable after an update and the app's language.
        if let Err(error) = context_menu::apply(
            preferences.context_menu,
            t("Organize with Download Organizer"),
        ) {
            eprintln!("{error}");
        }
    }
    // The worker can't drain this during a batch, and the batch's own moves fill it.
    let (events, receiver) = mpsc::sync_channel(65536);
    if let Err(error) = monitor::configure(&mut runtime, &events) {
        runtime.watch_error = Some(error);
    }
    let requested_folder = context_menu::requested_folder(std::env::args());
    let start_hidden = requested_folder.is_none()
        && starts_hidden(
            automatic,
            runtime.watch_error.is_some(),
            std::env::args().any(|argument| argument == autostart::LAUNCH_ARGUMENT),
        );
    app.manage(AppState {
        runtime: Mutex::new(runtime),
        events,
        file_previews: Mutex::new(file_preview::Access::default()),
        file_preview_job: Mutex::new(()),
        media_previews: Mutex::new(media_preview::Sessions::default()),
        update: Mutex::new(None),
        requested_folder: Mutex::new(requested_folder),
    });
    {
        use tauri_plugin_notification::NotificationExt;
        let handle = app.handle().clone();
        let _ = app
            .notification()
            .on_action(move |performed| open_from_notification(&handle, performed));
    }
    let handle = app.handle().clone();
    std::thread::Builder::new()
        .spawn(move || monitor::worker(handle, receiver))
        .map_err(|_| startup::StartupError::Runtime)?;
    // Dev builds must never replace themselves with a release.
    if !cfg!(debug_assertions) {
        let handle = app.handle().clone();
        std::thread::Builder::new()
            .spawn(move || {
                let mut delay = Duration::from_secs(60);
                loop {
                    std::thread::sleep(delay);
                    delay = Duration::from_secs(6 * 60 * 60);
                    // Being offline is normal; the next cycle tries again.
                    if let Err(error) = update_cycle(&handle) {
                        eprintln!("{error}");
                    }
                }
            })
            .map_err(|_| startup::StartupError::Runtime)?;
    }
    // Built after the preferences load, so the menu uses the saved language.
    let menu = tray_menu(app.handle()).map_err(|_| startup::StartupError::Runtime)?;
    let icon = app
        .default_window_icon()
        .ok_or(startup::StartupError::Runtime)?
        .clone();
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            show_main_window(app);
            // Quitting goes through the window, which protects drafts and running operations.
            if event.id() == "quit" {
                let _ = app.emit("tray-quit", ());
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(&app)
        .map_err(|_| startup::StartupError::Runtime)?;
    if let Ok(runtime) = lock(&app.state::<AppState>()) {
        sync_tray_status(app.handle(), &runtime);
    }
    app.run(move |app, event| {
        if matches!(event, tauri::RunEvent::Ready) && !start_hidden {
            show_main_window(app);
        }
    });
    Ok(())
}

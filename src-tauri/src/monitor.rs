use crate::i18n::t;
use crate::{
    AppState, Runtime,
    engine::{self, Result, Stamp},
    lock,
    queue::Queue,
};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, mpsc},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

pub type Message = (u64, notify::Result<Event>);
pub struct Session {
    pub generation: u64,
    pub baseline: HashSet<PathBuf>,
    pub restored: HashMap<PathBuf, Stamp>,
    pub source: PathBuf,
}

pub fn configure(runtime: &mut Runtime, sender: &mpsc::SyncSender<Message>) -> Result<()> {
    configure_with(
        runtime,
        sender,
        |watcher, source| {
            watcher
                .watch(source, RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())
        },
        |source| {
            fs::read_dir(source)
                .and_then(|entries| entries.map(|entry| entry.map(|entry| entry.path())).collect())
                .map_err(|e| format!("{}: {e}", t("Monitoramento pausado: não foi possível preparar os arquivos existentes. Verifique a pasta e tente reativar. Detalhes", "Monitoring paused: could not prepare the existing files. Check the folder and try turning it back on. Details")))
        },
    )
}

// Keep registration and enumeration injectable for deterministic activation tests.
pub(crate) fn configure_with(
    runtime: &mut Runtime,
    sender: &mpsc::SyncSender<Message>,
    register: impl FnOnce(&mut RecommendedWatcher, &Path) -> Result<()>,
    enumerate: impl FnOnce(&Path) -> Result<HashSet<PathBuf>>,
) -> Result<()> {
    let prefs = runtime.store.preferences()?;
    if !prefs.automatic {
        runtime.watcher = None;
        runtime.session = None;
        runtime.sequence += 1;
        runtime.watch_error = None;
        return Ok(());
    }
    let source = match engine::validate_directory(Path::new(&prefs.source)) {
        Ok(source) => source,
        Err(error) => {
            runtime.watcher = None;
            runtime.session = None;
            runtime.sequence += 1;
            return Err(error);
        }
    };
    if prefs.automatic
        && runtime.watcher.is_some()
        && runtime.session.as_ref().is_some_and(|s| s.source == source)
    {
        return Ok(());
    }
    runtime.watcher = None;
    runtime.session = None;
    runtime.sequence += 1;
    runtime.watch_error = None;
    let generation = runtime.sequence;
    let tx = sender.clone();
    let overflow = runtime.overflow.clone();
    let mut watcher = notify::recommended_watcher(move |result| {
        // Never block the native callback: dropping a watcher may wait for it.
        if matches!(
            tx.try_send((generation, result)),
            Err(mpsc::TrySendError::Full(_))
        ) {
            overflow.store(generation, Ordering::Release);
        }
    })
    .map_err(|e| e.to_string())?;
    // Observe first; queued arrivals remove entries sampled during enumeration.
    register(&mut watcher, &source)?;
    let baseline = enumerate(&source)?;
    let current = runtime.store.preferences()?;
    if !current.automatic || current.source != prefs.source {
        return Err(t("As configurações de monitoramento mudaram durante a ativação. Confira a origem e tente reativar o monitoramento.", "Monitoring settings changed during activation. Check the source folder and try turning monitoring on again.").into());
    }
    runtime.session = Some(Session {
        generation,
        baseline,
        restored: HashMap::new(),
        source,
    });
    runtime.watcher = Some(watcher);
    Ok(())
}

pub fn worker(app: AppHandle, receiver: mpsc::Receiver<Message>) {
    let mut queue = Queue::default();
    let mut last_organized_notice: Option<Instant> = None;
    loop {
        let received = if queue.idle() {
            receiver
                .recv()
                .map_err(|_| mpsc::RecvTimeoutError::Disconnected)
        } else {
            receiver.recv_timeout(Duration::from_secs(1))
        };
        let state = app.state::<AppState>();
        let Ok(mut runtime) = lock(&state) else {
            break;
        };
        let previous_error = runtime.watch_error.clone();
        let mut changed = false;
        match received {
            Ok(event) => changed = queue.event(&mut runtime, event),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => (),
        }
        match queue.process_due(&mut runtime, Some(&app), Instant::now()) {
            Ok(processed) => {
                if processed {
                    runtime.watch_error = None;
                    // shortcut: later batches in the minute aren't counted, add a summary if users ask.
                    if last_organized_notice
                        .is_none_or(|last| last.elapsed() >= Duration::from_secs(60))
                    {
                        crate::notify_organized(&app, &runtime);
                        last_organized_notice = Some(Instant::now());
                    }
                }
                changed |= processed;
            }
            Err(error) => {
                runtime.watch_error = Some(error);
                changed = true;
            }
        }
        if changed {
            crate::sync_tray_status(&app, &runtime);
            if runtime.watch_error != previous_error
                && let Some(error) = runtime.watch_error.clone()
            {
                let title = t(
                    "Há um problema no monitoramento",
                    "There's a problem with monitoring",
                );
                crate::notify(&app, &runtime, title, &error);
            }
            let _ = app.emit("organizer-changed", ());
        }
    }
}

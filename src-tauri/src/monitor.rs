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
                .map_err(|e| format!("Monitoramento pausado: não foi possível preparar os arquivos existentes. Verifique a pasta e tente reativar. Detalhes: {e}"))
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
        return Err("As configurações de monitoramento mudaram durante a ativação. Confira a origem e tente reativar o monitoramento.".into());
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
                }
                changed |= processed;
            }
            Err(error) => {
                runtime.watch_error = Some(error);
                changed = true;
            }
        }
        if changed {
            let _ = app.emit("organizer-changed", ());
        }
    }
}

use crate::i18n::t;
use crate::{
    Runtime,
    engine::{self, Preview, Result, Stamp},
    execute,
    monitor::Message,
};
use notify::{
    EventKind,
    event::{ModifyKind, RenameMode},
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::AppHandle;

#[derive(Default)]
pub struct Queue {
    generation: Option<u64>,
    pending: HashMap<PathBuf, Instant>,
    attempted: HashMap<PathBuf, Stamp>,
}

impl Queue {
    pub fn idle(&self) -> bool {
        self.pending.is_empty()
    }

    fn synchronize(&mut self, runtime: &Runtime) {
        let generation = runtime.session.as_ref().map(|s| s.generation);
        if self.generation != generation {
            self.pending.clear();
            self.attempted.clear();
            self.generation = generation;
        }
    }

    pub fn event(&mut self, runtime: &mut Runtime, (generation, event): Message) -> bool {
        self.synchronize(runtime);
        if self.generation != Some(generation) {
            return false;
        }
        let event = event.and_then(|event| {
            if event.need_rescan() {
                Err(notify::Error::generic(t("Monitoramento pausado: o sistema perdeu eventos. Confira os arquivos com uma prévia e salve as configurações para reativar.", "Monitoring paused: the system lost events. Review the files with a preview and save the settings to turn it back on.")))
            } else {
                Ok(event)
            }
        });
        let event = match event {
            Ok(event) => event,
            Err(error) => {
                runtime.watch_error = Some(error.to_string());
                runtime.watcher = None;
                runtime.session = None;
                self.synchronize(runtime);
                return true;
            }
        };
        if matches!(event.kind, EventKind::Access(_)) {
            return false;
        }
        let path_count = event.paths.len();
        for (index, raw_path) in event.paths.into_iter().enumerate() {
            let path = normalize_path(&raw_path);
            let arrival = matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(RenameMode::To))
            ) || (matches!(
                event.kind,
                EventKind::Modify(ModifyKind::Name(RenameMode::Both))
            ) && index + 1 == path_count);
            let removed = matches!(event.kind, EventKind::Remove(_))
                || fs::symlink_metadata(&path)
                    .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound);
            if removed || arrival {
                // Delayed removals/arrivals must not reorganize an unchanged restored file.
                if runtime
                    .session
                    .as_ref()
                    .unwrap()
                    .restored
                    .get(&path)
                    .is_some_and(|expected| {
                        fs::symlink_metadata(&path)
                            .ok()
                            .and_then(|m| engine::stamp(&m).ok())
                            .as_ref()
                            == Some(expected)
                    })
                {
                    continue;
                }
                runtime.session.as_mut().unwrap().baseline.remove(&path);
                runtime.session.as_mut().unwrap().restored.remove(&path);
                if removed {
                    self.pending.remove(&path);
                    self.attempted.remove(&path);
                    continue;
                }
            }
            if !runtime.session.as_ref().unwrap().baseline.contains(&path)
                && !engine::temporary(&path)
            {
                self.pending.insert(path, Instant::now());
            }
        }
        true
    }

    pub fn process_due(
        &mut self,
        runtime: &mut Runtime,
        app: Option<&AppHandle>,
        time: Instant,
    ) -> Result<bool> {
        self.synchronize(runtime);
        let overflow = runtime.overflow.swap(0, Ordering::AcqRel);
        if overflow != 0 && self.generation == Some(overflow) {
            runtime.watcher = None;
            runtime.session = None;
            self.synchronize(runtime);
            return Err(t("Monitoramento pausado por excesso de eventos. Confira os arquivos com uma prévia e salve as configurações para reativar.", "Monitoring paused by too many events. Review the files with a preview and save the settings to turn it back on.").into());
        }
        let due: HashSet<_> = self
            .pending
            .iter()
            .filter(|(_, last)| {
                time.saturating_duration_since(**last) >= Duration::from_secs(engine::QUIET_SECONDS)
            })
            .map(|(path, _)| path.clone())
            .collect();
        if due.is_empty() {
            return Ok(false);
        }
        let prefs = runtime.store.preferences()?;
        if !prefs.automatic {
            return Ok(false);
        }
        let mut files = Vec::new();
        let scanned = match engine::scan_paths(&prefs, due.iter().cloned()) {
            Ok(files) => files,
            Err(error) => {
                for path in &due {
                    self.pending.insert(path.clone(), time);
                }
                return Err(error);
            }
        };
        for path in &due {
            self.pending.remove(path);
        }
        for file in scanned
            .into_iter()
            .filter(|f| due.contains(Path::new(&f.path)) && f.status == "ready")
        {
            let captured = file
                .stamp
                .as_ref()
                .ok_or(t("Metadados indisponíveis", "Metadata unavailable"))?;
            if self.attempted.get(Path::new(&file.path)) == Some(captured) {
                continue;
            }
            if engine::locked_file(Path::new(&file.path)).is_err_and(|e| engine::is_busy(&e)) {
                self.pending.insert(PathBuf::from(&file.path), time);
            } else {
                self.attempted
                    .insert(PathBuf::from(&file.path), captured.clone());
                files.push(file);
            }
        }
        if files.is_empty() {
            return Ok(false);
        }
        runtime.preview = None;
        execute(
            runtime,
            Preview {
                id: 0,
                files,
                created: engine::now(),
            },
            "automatic",
            app,
        )?;
        Ok(true)
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    match (
        path.parent().and_then(|p| fs::canonicalize(p).ok()),
        path.file_name(),
    ) {
        (Some(parent), Some(name)) => parent.join(name),
        _ => path.to_path_buf(),
    }
}

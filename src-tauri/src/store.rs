use crate::engine::{self, Preferences, Result, Stamp};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

#[derive(Clone, Serialize)]
pub struct Movement {
    pub id: i64,
    pub source: String,
    pub destination: String,
    pub status: String,
    pub error: Option<String>,
    pub size: i64,
    pub modified: i64,
    pub digest: String,
}

#[derive(Serialize)]
pub struct Operation {
    pub id: i64,
    pub created: i64,
    pub kind: String,
    pub movements: Vec<Movement>,
}

pub struct Store {
    pub db: Connection,
    _lock: File,
}

impl Store {
    pub fn open(path: &Path, default_source: &str) -> Result<Self> {
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.with_extension("lock"))
            .map_err(|e| e.to_string())?;
        lock.try_lock().map_err(|e| {
            format!("Banco em uso por outra instância ou bloqueio indisponível: {e}")
        })?;
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS preferences(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS rules(category TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS operations(id INTEGER PRIMARY KEY, created INTEGER NOT NULL, kind TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY, operation_id INTEGER NOT NULL REFERENCES operations(id), source TEXT NOT NULL, destination TEXT NOT NULL, status TEXT NOT NULL, error TEXT, size INTEGER NOT NULL, modified INTEGER NOT NULL, digest TEXT NOT NULL);") .map_err(|e| e.to_string())?;
        let version: u32 = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| e.to_string())?;
        match version {
            0 => db.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE created_directories(id INTEGER PRIMARY KEY, operation_id INTEGER NOT NULL REFERENCES operations(id), path TEXT NOT NULL, identity TEXT, state TEXT NOT NULL, error TEXT);
                CREATE INDEX directories_operation ON created_directories(operation_id);
                PRAGMA user_version=1; COMMIT;").map_err(|e| e.to_string())?,
            1 => (),
            _ => return Err("Banco de uma versão mais recente; atualize o aplicativo".into()),
        }
        let prefs = Preferences {
            source: default_source.into(),
            destination: default_source.into(),
            automatic: false,
            enabled_categories: engine::categories().iter().map(|c| c.id.clone()).collect(),
            theme: "dark".into(),
        };
        db.execute(
            "INSERT OR IGNORE INTO preferences VALUES(1,?1)",
            [serde_json::to_string(&prefs).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        for c in engine::categories() {
            db.execute("INSERT OR IGNORE INTO rules VALUES(?1,1)", [&c.id])
                .map_err(|e| e.to_string())?;
        }
        db.execute_batch(
            "CREATE INDEX IF NOT EXISTS movements_operation ON movements(operation_id);",
        )
        .map_err(|e| e.to_string())?;
        let store = Self { db, _lock: lock };
        store.recover()?;
        Ok(store)
    }

    pub fn preferences(&self) -> Result<Preferences> {
        Self::read_preferences(&self.db)
    }

    fn read_preferences(db: &Connection) -> Result<Preferences> {
        let json: String = db
            .query_row("SELECT value FROM preferences WHERE id=1", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let mut prefs: Preferences = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        let mut query = db
            .prepare("SELECT category FROM rules WHERE enabled=1 ORDER BY category")
            .map_err(|e| e.to_string())?;
        prefs.enabled_categories = query
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<_, _>>()
            .map_err(|e| e.to_string())?;
        Ok(prefs)
    }

    #[cfg(test)]
    pub fn save(&mut self, prefs: &Preferences) -> Result<()> {
        self.save_if_unchanged(prefs, None)
    }

    pub fn save_if_unchanged(
        &mut self,
        prefs: &Preferences,
        expected: Option<&Preferences>,
    ) -> Result<()> {
        engine::validate_preferences(prefs)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        if let Some(expected) = expected
            && Self::read_preferences(&tx)? != *expected
        {
            return Err("PREFERENCES_CHANGED: As configurações foram atualizadas fora deste formulário. Revise a versão atual antes de salvar.".into());
        }
        tx.execute(
            "UPDATE preferences SET value=?1 WHERE id=1",
            [serde_json::to_string(prefs).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        for c in engine::categories() {
            tx.execute(
                "UPDATE rules SET enabled=?1 WHERE category=?2",
                params![prefs.enabled_categories.contains(&c.id), c.id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn begin(&self, kind: &str) -> Result<i64> {
        self.db
            .execute(
                "INSERT INTO operations(created,kind) VALUES(?1,?2)",
                params![engine::now(), kind],
            )
            .map_err(|e| e.to_string())?;
        Ok(self.db.last_insert_rowid())
    }

    pub fn record(
        &self,
        operation: i64,
        source: &str,
        destination: &str,
        state: &str,
        stamp: &Stamp,
        digest: &str,
    ) -> Result<i64> {
        self.db.execute("INSERT INTO movements(operation_id,source,destination,status,size,modified,digest) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![operation,source,destination,state,stamp.size,stamp.modified,digest]).map_err(|e| e.to_string())?;
        Ok(self.db.last_insert_rowid())
    }

    pub fn status(&self, id: i64, state: &str, error: Option<&str>) -> Result<()> {
        self.db
            .execute(
                "UPDATE movements SET status=?1,error=?2 WHERE id=?3",
                params![state, error, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn movements(&self, operation: i64) -> Result<Vec<Movement>> {
        let mut query = self.db.prepare("SELECT id,source,destination,status,error,size,modified,digest FROM movements WHERE operation_id=?1 ORDER BY id").map_err(|e| e.to_string())?;
        query
            .query_map([operation], |r| {
                Ok(Movement {
                    id: r.get(0)?,
                    source: r.get(1)?,
                    destination: r.get(2)?,
                    status: r.get(3)?,
                    error: r.get(4)?,
                    size: r.get(5)?,
                    modified: r.get(6)?,
                    digest: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<_, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn create_directory(&self, operation: i64, path: &Path) -> Result<()> {
        match fs::symlink_metadata(path) {
            Ok(_) => {
                engine::validate_directory(path)?;
                return Ok(());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.to_string()),
        }
        let path_text = path.to_str().ok_or("Caminho de pasta inválido")?;
        self.db
            .execute(
                "INSERT INTO created_directories(operation_id,path,state) VALUES(?1,?2,'intent')",
                params![operation, path_text],
            )
            .map_err(|e| e.to_string())?;
        let id = self.db.last_insert_rowid();
        let created = crate::directories::create(path);
        match created {
            Ok(Some(directory)) => {
                // Keep the creation handle alive until its identity is durably committed.
                let identity = directory.identity()?;
                self.db
                    .execute(
                        "UPDATE created_directories SET identity=?1,state='created' WHERE id=?2",
                        params![identity, id],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(None) => {
                self.db
                    .execute(
                        "UPDATE created_directories SET state='unowned' WHERE id=?1",
                        [id],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Err(error) => {
                self.db
                    .execute(
                        "UPDATE created_directories SET state='unverified',error=?1 WHERE id=?2",
                        params![error, id],
                    )
                    .map_err(|e| e.to_string())?;
                return Err(error);
            }
        }
        Ok(())
    }

    pub fn cleanup_directories(&self, operation: Option<i64>) -> Result<()> {
        let errors = self.reconcile_directories(operation)?;
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "Os arquivos foram preservados, mas não foi possível concluir a limpeza das pastas: {}",
                errors.join("; ")
            ))
        }
    }

    fn reconcile_directories(&self, operation: Option<i64>) -> Result<Vec<String>> {
        // Missing evidence is never reconstructed from a path or from old movement records.
        self.db.execute("UPDATE created_directories SET state='unverified',error='Criação interrompida sem identidade confirmada; pasta preservada' WHERE state='intent'", []).map_err(|e| e.to_string())?;
        // Earlier operations cannot own this newly created directory instance, even at the same path.
        let mut query = self
            .db
            .prepare(
                "SELECT id,path,identity,operation_id FROM created_directories d
            WHERE state='created' AND identity IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM movements m
                WHERE m.operation_id=d.operation_id AND m.status NOT IN ('undone','failed'))
            AND NOT EXISTS(SELECT 1 FROM movements m WHERE m.operation_id>d.operation_id AND m.status NOT IN ('undone','failed')
                AND (substr(m.destination,1,length(d.path)+1)=(d.path||char(92)) COLLATE NOCASE
                    OR substr(m.destination,1,length(d.path)+1)=(d.path||'/') COLLATE NOCASE))
            ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(query);
        let protected = self.preferences().and_then(|prefs| {
            [prefs.source, prefs.destination].iter().map(|path| {
                fs::canonicalize(path).map_err(|error| format!("Não foi possível validar as pastas configuradas antes da limpeza: {error}"))
            }).collect::<Result<Vec<_>>>()
        });
        let mut errors = Vec::new();
        for (id, path, identity, owner) in rows {
            if protected.as_ref().is_ok_and(|paths| {
                paths
                    .iter()
                    .any(|protected| protected.starts_with(Path::new(&path)))
            }) {
                self.db.execute("UPDATE created_directories SET error='Pasta usada pelas configurações atuais; preservada' WHERE id=?1", [id]).map_err(|e| e.to_string())?;
                continue;
            }
            let result = match (&protected, fs::symlink_metadata(&path)) {
                (Err(error), _) => Err(error.clone()),
                (_, Err(error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
                (_, Err(error)) => Err(error.to_string()),
                (_, Ok(_)) => crate::directories::remove(Path::new(&path), &identity),
            };
            let (state, error) = match result {
                Ok(true) => ("removed", None),
                Ok(false) => ("created", Some("Pasta não vazia; preservada".to_owned())),
                Err(error) => {
                    // Old cleanup failures remain journaled without failing an unrelated operation.
                    if operation.is_none_or(|op| op == owner) {
                        errors.push(error.clone());
                    }
                    ("created", Some(error))
                }
            };
            self.db
                .execute(
                    "UPDATE created_directories SET state=?1,error=?2 WHERE id=?3",
                    params![state, error, id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(errors)
    }

    pub fn history(&self) -> Result<Vec<Operation>> {
        let mut query = self
            .db
            .prepare("SELECT id,created,kind FROM operations ORDER BY id DESC LIMIT 100")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows.into_iter()
            .map(|(id, created, kind)| {
                Ok(Operation {
                    id,
                    created,
                    kind,
                    movements: self.movements(id)?,
                })
            })
            .collect()
    }

    // A committed intent precedes each rename; reconcile interrupted operations without moving anything.
    pub fn recover(&self) -> Result<()> {
        let mut query = self.db.prepare("SELECT DISTINCT operation_id FROM movements WHERE status IN ('pending','undo_pending')").map_err(|e| e.to_string())?;
        let ids = query
            .query_map([], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for op in ids {
            for item in self.movements(op)? {
                if !["pending", "undo_pending"].contains(&item.status.as_str()) {
                    continue;
                }
                let expected = Stamp {
                    size: item.size,
                    modified: item.modified,
                };
                let source = engine::verify_file(Path::new(&item.source), &expected, &item.digest);
                let target =
                    engine::verify_file(Path::new(&item.destination), &expected, &item.digest);
                if source
                    .as_ref()
                    .err()
                    .is_some_and(|e| e == "Arquivo ocupado")
                    || target
                        .as_ref()
                        .err()
                        .is_some_and(|e| e == "Arquivo ocupado")
                {
                    self.status(item.id, &item.status, Some("Arquivo ocupado; libere e reinicie para verificar a operação interrompida"))?;
                    continue;
                }
                let at_source = source.is_ok();
                let at_target = target.is_ok();
                let source_absent = fs::symlink_metadata(&item.source)
                    .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound);
                let target_absent = fs::symlink_metadata(&item.destination)
                    .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound);
                let state = if at_target && source_absent {
                    "moved"
                } else if at_source && target_absent {
                    if item.status == "undo_pending" {
                        "undone"
                    } else {
                        "failed"
                    }
                } else {
                    "uncertain"
                };
                self.status(
                    item.id,
                    state,
                    Some("Operação interrompida; estado verificado ao iniciar"),
                )?;
            }
        }
        // Cleanup failures stay in the journal for retry; they must not prevent startup.
        self.reconcile_directories(None)?;
        Ok(())
    }
}

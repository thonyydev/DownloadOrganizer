import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "radix-ui";
import { FolderDown, FolderOpen, History, LayoutDashboard, Loader2, RefreshCw, Search, Settings2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Overview } from "@/components/overview";
import { HistoryView } from "@/components/history";
import { FileTable } from "@/components/file-table";
import { Settings } from "@/components/settings";
import { SettingsActions } from "@/components/settings-actions";
import { OperationDialogs } from "@/components/operation-dialogs";
import { OperationFeedback } from "@/components/operation-feedback";
import { ProblemNotice } from "@/components/problem-notice";
import { NavigationIndicator, PageTransition, useContentMotion, usePagePosition } from "@/components/motion/transitions";
import { useMotionAllowed } from "@/components/motion/feedback";
import { SuccessNotice } from "@/components/success-notice";
import { errorMessage, isRunning, previewIssue, reconcileDraft, samePreferences, type Action, type PreferencesDraft } from "@/lib/experience";
import { api, native, type Operation, type Preview, type Progress, type Snapshot } from "@/lib/api";
import "./App.css";

const pages = [{ id: "dashboard", name: "Visão geral", icon: LayoutDashboard }, { id: "files", name: "Arquivos", icon: FolderOpen }, { id: "history", name: "Histórico", icon: History }, { id: "settings", name: "Configurações", icon: Settings2 }] as const;
export default function App() {
  const [page, setCurrentPage] = useState<(typeof pages)[number]["id"]>("dashboard");
  const [data, setData] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<PreferencesDraft | null>(null);
  const [loading, setLoading] = useState(native);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [undoTarget, setUndoTarget] = useState<Operation | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [automatic, setAutomatic] = useState<Action | null>(null);
  const [closeRequested, setCloseRequested] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const autoBusyRef = useRef(false);
  const dirtyRef = useRef(false);
  const closeBypass = useRef(false);
  const actionKind = useRef<Action["kind"] | null>(null);
  const refreshVersion = useRef(0);
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const setPage = usePagePosition(page, mainHeading, setCurrentPage);
  const themeRef = useContentMotion(data?.preferences.theme ?? "dark", useMotionAllowed(), false, "theme");
  const dirty = !!draft && !samePreferences(draft.base, draft.value);
  dirtyRef.current = dirty;
  const external = draft && data && !samePreferences(draft.base, data.preferences) ? data.preferences : null;

  const refresh = useCallback(async (propagate = false) => {
    if (!native) return;
    const version = ++refreshVersion.current;
    try {
      const next = await api.snapshot();
      if (version === refreshVersion.current) {
        setData(next);
        setDraft(current => reconcileDraft(current, next.preferences));
      }
      return next;
    } catch (e) {
      if (version === refreshVersion.current) setError(errorMessage(e));
      if (propagate) throw e;
    } finally { if (version === refreshVersion.current) setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    if (!native) return;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    Promise.all([
      listen<Progress>("organizer-progress", event => {
        if (disposed) return;
        const progress = event.payload;
        if (progress.kind === "automatic") {
          autoBusyRef.current = progress.phase === "preparing" || progress.phase === "organizing";
          setAutomatic({ kind: "organize", phase: progress.phase, progress, operationId: progress.operation_id ?? undefined });
        } else if (busyRef.current && ((actionKind.current === "organize" && progress.kind === "manual") || (actionKind.current === "undo" && progress.kind === "undo"))) {
          setAction(current => current ? { ...current, progress, operationId: progress.operation_id ?? current.operationId,
            phase: progress.phase === "preparing" || progress.phase === "organizing" ? progress.phase : current.phase } : current);
        }
      }),
      listen("organizer-changed", () => {
        if (disposed) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { void refresh(); }, 600);
      }),
    ]).then(items => { if (disposed) items.forEach(fn => fn()); else unlisteners.push(...items); }).catch(e => setError(errorMessage(e)));
    return () => { disposed = true; unlisteners.forEach(fn => fn()); if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);
  useLayoutEffect(() => { document.documentElement.classList.toggle("dark", data?.preferences.theme !== "light"); }, [data?.preferences.theme]);
  useEffect(() => {
    if (!preview) return;
    setClock(Date.now());
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [preview]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || busyRef.current || autoBusyRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    if (native) {
      getCurrentWindow().onCloseRequested(event => {
        if (!closeBypass.current && (dirtyRef.current || busyRef.current || autoBusyRef.current)) {
          event.preventDefault(); setCloseRequested(true);
        }
      }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(e => setError(errorMessage(e)));
    }
    return () => { disposed = true; unlisten?.(); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);

  async function run(job: () => Promise<number | void>, kind: Action["kind"] = "refresh") {
    if (busyRef.current || autoBusyRef.current) return false;
    busyRef.current = true; actionKind.current = kind;
    setBusy(true); setError(""); setMessage(""); setAction({ kind, phase: "preparing" });
    let operationId: number | undefined;
    try {
      const result = await job();
      operationId = typeof result === "number" ? result : undefined;
      if (kind !== "refresh") await refresh(true);
      setAction({ kind, phase: "completed", operationId });
      if (kind === "save") setMessage("Preferências salvas. Verifique separadamente o estado do monitoramento.");
      return true;
    } catch (e) {
      const problem = errorMessage(e);
      setError(problem); setAction(current => ({ kind, phase: "error", error: problem, operationId: operationId ?? current?.operationId }));
      if (kind === "organize") { setPreviewError("Esta confirmação não pode ser reutilizada. Confira o histórico e atualize a prévia antes de tentar novamente."); setReviewed(false); }
      if (kind === "preview") setPreviewError("Não foi possível atualizar a prévia. Tente atualizar novamente antes de confirmar.");
      await refresh();
      return false;
    } finally { busyRef.current = false; actionKind.current = null; setBusy(false); }
  }

  function discardDraft() {
    if (data) setDraft({ base: data.preferences, value: data.preferences });
  }
  async function saveDraft() {
    if (!draft || !dirty || external) return false;
    const captured = draft;
    return run(async () => {
      const saved = await api.save(captured.value, captured.base);
      setDraft({ base: saved, value: saved });
      setPreview(null); setReviewed(false);
    }, "save");
  }
  async function updatePreview() {
    setReviewed(false);
    return run(async () => {
      const next = await api.preview();
      setPreview(next); setPreviewError(""); setClock(Date.now());
      setData(current => current ? { ...current, preview_id: next.id } : current);
    }, "preview");
  }
  function closeDialogs() {
    if (busyRef.current) return;
    setPreview(null); setUndoTarget(null); setAction(null); setReviewed(false); setPreviewError(""); setError("");
  }
  async function closeApplication() {
    if (busyRef.current || autoBusyRef.current) return;
    closeBypass.current = true;
    try { await getCurrentWindow().close(); }
    catch (e) { closeBypass.current = false; setError(errorMessage(e)); }
  }
  const working = busy || isRunning(automatic);
  const issue = preview ? previewError || previewIssue(preview, data?.preview_id ?? null, clock) : "";
  const resultOperation = data?.history.find(op => op.id === action?.operationId);
  const files = data?.files ?? [];
  const categories = data?.categories ?? [];
  const history = data?.history ?? [];
  const visible = files.filter(f => (filter === "all" || f.category === filter) && f.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const current = pages.find(p => p.id === page)!;
  function showCategory(id: string) { setSearch(""); setFilter(id); setPage("files"); }
  function showOperation(op: Operation) { setPage("history"); setExpanded(op.id); }

  return <Tooltip.Provider delayDuration={500} skipDelayDuration={300}><div className="app-shell" ref={themeRef}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><FolderDown size={20} aria-hidden="true" /></span><span>Download<span className="brand-sub">Organizer</span></span></div>
      <nav aria-label="Navegação principal"><NavigationIndicator page={page} />{pages.map(item => <button key={item.id} className={"nav-item " + (page === item.id ? "active" : "")} aria-label={item.name} aria-describedby={item.id === "settings" && dirty ? "pending-preferences" : item.id === "files" && data ? "nav-file-count" : undefined} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}><item.icon size={16} aria-hidden="true" /><span>{item.name}</span>{item.id === "files" && data && <span className="nav-count" id="nav-file-count">{files.length}<span className="sr-only"> arquivos na pasta</span></span>}{item.id === "settings" && dirty && <><span className="draft-dot" aria-hidden="true" /><span id="pending-preferences" className="sr-only">Alterações não salvas</span></>}</button>)}</nav>
      <div className="sidebar-bottom"><span className={"monitor-status " + (data?.monitoring ? "online" : "")}><span className="small-dot" />{working ? "Operação em andamento" : data?.monitoring ? "Monitor ativo" : "Monitor pausado"}</span><div className="app-version"><ShieldCheck size={14} aria-hidden="true" /><span>Armazenamento local</span><span>v0.1.0</span></div></div>
    </aside>
    <div className="main-shell">
      <main className="content"><div className="page-heading"><div><h1 ref={mainHeading} tabIndex={-1}>{current.name}</h1><p>{page === "dashboard" ? "Pasta, arquivos e operações em um só lugar." : page === "files" ? "Confira os arquivos, seus destinos e possíveis conflitos." : page === "history" ? "Registros reais das movimentações e restaurações." : "Diretórios, regras e preferências de organização."}</p></div><div className="heading-actions"><Button variant="outline" size="sm" aria-label="Atualizar arquivos" disabled={!native || working || loading} onClick={() => void run(async () => { await refresh(true); })}><RefreshCw aria-hidden="true" className={loading || (busy && action?.kind === "refresh") ? "spin" : ""} />Atualizar</Button>{page !== "settings" && <Button disabled={!data || working || loading || !files.length || !!data?.scan_error} onClick={() => void updatePreview()}><FolderDown aria-hidden="true" />{busy && action?.kind === "preview" ? "Preparando prévia…" : "Organizar arquivos"}</Button>}</div></div>
        {!native && <div className="banner" role="status"><FolderDown size={16} aria-hidden="true" /><div><strong>Abra o aplicativo desktop para acessar seus arquivos</strong><p>Execute <code>npm run tauri dev</code>. As operações reais ficam no aplicativo Tauri.</p></div></div>}
        {dirty && page !== "settings" && <div className="banner" role="status"><div><strong>Há configurações não salvas</strong><p>Seu rascunho foi preservado. As operações usam as configurações salvas.</p><div className="notice-actions"><Button variant="outline" size="sm" onClick={() => setPage("settings")}>Revisar alterações</Button><Button variant="ghost" size="sm" disabled={working} onClick={discardDraft}>Descartar alterações</Button></div></div></div>}
        {error && !preview && !undoTarget && <ProblemNotice title="A ação não foi concluída" message={error} busy={working} action="Verificar novamente" onRecover={() => void run(async () => { await refresh(true); })} onDismiss={() => setError("")} />}
        {data?.scan_error && <ProblemNotice title="A pasta precisa de atenção" message={data.scan_error} persistent busy={working} action="Revisar diretórios" onRecover={() => setPage("settings")} />}
        {data?.watch_error && <ProblemNotice title="Há um problema no monitoramento" message={data.watch_error} persistent busy={working} action={data.preferences.automatic ? "Verificar e reativar monitor" : "Revisar automação"} onRecover={() => data.preferences.automatic ? void run(async () => { await api.retryMonitoring(); }, "monitor") : setPage("settings")} />}
        {message && <SuccessNotice message={message} onDismiss={() => setMessage("")} />}
        {!preview && !undoTarget && isRunning(action) && <OperationFeedback action={action} />}
        {automatic && <div className="automatic-feedback"><p>Organização automática</p><OperationFeedback action={automatic} operation={data?.history.find(op => op.id === automatic.operationId)} /></div>}
        {loading ? <div className="loading-state" role="status"><Loader2 className="spin" size={20} aria-hidden="true" /><p>Lendo seus arquivos com segurança…</p></div> : <PageTransition key={page}>
          {page === "dashboard" && <Overview data={data} onFiles={() => setPage("files")} onSettings={() => setPage("settings")} onCategory={showCategory} onHistory={() => setPage("history")} onOperation={showOperation} />}
          {page === "files" && <section className="files-view"><div className="file-toolbar" data-motion-group><label className="search-field"><span>Buscar arquivos</span><span className="search-input"><Search size={16} aria-hidden="true" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome do arquivo…" aria-label="Buscar arquivos" /></span></label><label className="filter-select"><span>Filtrar por categoria</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas as categorias</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><span className="file-count">{visible.length} arquivo(s)</span></div><FileTable filterKey={filter} files={visible} categories={categories} filtered={filter !== "all" || !!search} onClearFilters={() => { setFilter("all"); setSearch(""); }} /><div className="table-footer"><ShieldCheck size={14} aria-hidden="true" />Arquivos recentes aguardam estabilidade. Atualize para verificar novamente.</div></section>}
          {page === "history" && <HistoryView history={history} expanded={expanded} working={working} onExpand={setExpanded} onUndo={op => { setAction(null); setError(""); setUndoTarget(op); }} />}
          {page === "settings" && (data && draft ? <Settings draft={draft.value} categories={categories} busy={working} dirty={dirty} external={external} onChange={update => setDraft(current => current ? { ...current, value: update(current.value) } : current)} onDiscard={discardDraft} onAcceptExternal={() => setDraft(current => current && data ? { ...current, base: data.preferences } : current)} /> : <div className="empty"><Settings2 size={24} aria-hidden="true" /><h2>Configurações disponíveis no desktop</h2><p>Abra o aplicativo Tauri para selecionar suas pastas.</p></div>)}
        </PageTransition>}
        {page === "settings" && data && draft && <SettingsActions busy={working} dirty={dirty} external={!!external} onSave={() => void saveDraft()} onDiscard={discardDraft} />}
      </main>
    </div>
    <OperationDialogs preview={preview} undoTarget={undoTarget} categories={categories} action={action} busy={busy} working={working} issue={issue} reviewed={reviewed} operation={resultOperation}
      onReviewed={setReviewed} onUpdate={() => void updatePreview()} onClose={closeDialogs} onRestoreFocus={() => mainHeading.current?.focus()}
      onOrganize={() => { if (!preview || issue || !reviewed) return; const id = preview.id; void run(() => api.organize(id), "organize"); }}
      onUndo={() => { if (!undoTarget) return; const id = undoTarget.id; void run(async () => { await api.undo(id); return id; }, "undo"); }}
      onViewResult={() => { const id = action?.operationId; closeDialogs(); setPage("history"); if (id !== undefined) setExpanded(id); }} />
    <Dialog open={closeRequested} onOpenChange={setCloseRequested}><DialogContent><DialogHeader><DialogTitle>{working ? "Uma operação está em andamento" : dirty ? "Há alterações não salvas" : "Fechar aplicativo?"}</DialogTitle><DialogDescription>{working ? "Aguarde a conclusão antes de fechar o aplicativo." : dirty ? "Você pode salvar ou descartar o rascunho antes de sair." : "A operação terminou. Consulte o histórico para conferir os resultados."}</DialogDescription></DialogHeader>
      {working && <OperationFeedback action={isRunning(action) ? action : automatic} />}
      {external && <p className="inline-error" role="alert">As configurações salvas foram alteradas. Revise as versões nas configurações antes de salvar.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => { setCloseRequested(false); if (dirty) setPage("settings"); }}>Continuar no aplicativo</Button><Button variant="outline" disabled={working} onClick={() => void closeApplication()}>{dirty ? "Descartar e sair" : "Sair"}</Button><Button disabled={working || !dirty || !!external} onClick={() => { void saveDraft().then(saved => { if (saved) void closeApplication(); }); }}>Salvar e sair</Button></DialogFooter>
    </DialogContent></Dialog>
  </div></Tooltip.Provider>;
}

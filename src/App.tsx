import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { FilePreviewDialog } from "@/components/file-preview-dialog";
import { Settings } from "@/components/settings";
import { SettingsActions } from "@/components/settings-actions";
import { OperationDialogs } from "@/components/operation-dialogs";
import { OperationFeedback } from "@/components/operation-feedback";
import { ProblemNotice } from "@/components/problem-notice";
import { NavigationIndicator, PageTransition, useContentMotion, usePagePosition } from "@/components/motion/transitions";
import { useMotionAllowed } from "@/components/motion/feedback";
import { SuccessNotice } from "@/components/success-notice";
import { errorMessage, isRunning, previewIssue, reconcileDraft, samePreferences, type Action, type PreferencesDraft } from "@/lib/experience";
import { api, native, summarizeOperation, type FileEntry, type Operation, type OperationSummary, type Preview, type Progress, type Snapshot } from "@/lib/api";
import { useHistoryPages } from "@/lib/use-history";
import { createProgressPresenter } from "@/lib/progress";
import { plural } from "@/lib/utils";
import { setLanguage, t, useLanguage } from "@/lib/i18n";
import { AudioProvider, useAudioFeedback } from "@/components/audio/audio-provider";
import { operationSound } from "@/lib/sounds";
import { version } from "../package.json";
import brandPrimary from "@/assets/branding/symbol-primary.svg";
import brandWhite from "@/assets/branding/symbol-white.svg";
import "./App.css";

const pages = [{ id: "dashboard", name: () => t("Visão geral", "Overview"), icon: LayoutDashboard }, { id: "files", name: () => t("Arquivos", "Files"), icon: FolderOpen }, { id: "history", name: () => t("Histórico", "History"), icon: History }, { id: "settings", name: () => t("Configurações", "Settings"), icon: Settings2 }] as const;
const noFiles: FileEntry[] = [];
export default function App() {
  return <AudioProvider><OrganizerApp /></AudioProvider>;
}
function OrganizerApp() {
  useLanguage();
  const audio = useAudioFeedback();
  const [page, setCurrentPage] = useState<(typeof pages)[number]["id"]>("dashboard");
  const [data, setData] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<PreferencesDraft | null>(null);
  const [loading, setLoading] = useState(native);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [viewedFile, setViewedFile] = useState<FileEntry | null>(null);
  const filePreviewFocus = useRef<HTMLButtonElement | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [undoTarget, setUndoTarget] = useState<Operation | null>(null);
  const [detailOperation, setDetailOperation] = useState<Operation | OperationSummary>();
  const detailId = useRef<number | null>(null);
  const detailsNeeded = useRef(false);
  const [openingUndo, setOpeningUndo] = useState<number | null>(null);
  const historyPages = useHistoryPages();
  const { sync: syncHistory, upsert: upsertHistory } = historyPages;
  const [action, setAction] = useState<Action | null>(null);
  const [automatic, setAutomatic] = useState<Action | null>(null);
  const [closeRequested, setCloseRequested] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busyRef = useRef(false);
  const autoBusyRef = useRef(false);
  const dirtyRef = useRef(false);
  const closeBypass = useRef(false);
  const actionKind = useRef<Action["kind"] | null>(null);
  const manualProgress = useMemo(() => createProgressPresenter(progress => {
    if (progress.operation_id != null) detailId.current = progress.operation_id;
    setAction(current => current ? { ...current, progress, operationId: progress.operation_id ?? current.operationId, phase: progress.phase } : current);
  }), []);
  const automaticProgress = useMemo(() => createProgressPresenter(progress => {
    setAutomatic({ kind: "organize", phase: progress.phase, progress, operationId: progress.operation_id ?? undefined });
  }), []);
  const refreshVersion = useRef(0);
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const setPage = usePagePosition(page, mainHeading, setCurrentPage);
  const themeRef = useContentMotion(data?.preferences.theme ?? "dark", useMotionAllowed(), false, "theme");
  const mainDirty = !!draft && !samePreferences(draft.base, draft.value);
  const dirty = mainDirty || audio.dirty;
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
        syncHistory({ operations: next.history, next_cursor: next.history_cursor });
      }
      const id = detailId.current;
      const detail = id === null ? undefined : await (detailsNeeded.current ? api.operation(id) : api.operationSummary(id));
      if (detail && version === refreshVersion.current && detailId.current === id) {
        setDetailOperation(detail); upsertHistory(summarizeOperation(detail));
      }
      return { ...next, detail };
    } catch (e) {
      if (version === refreshVersion.current) setError(errorMessage(e));
      if (propagate) throw e;
    } finally { if (version === refreshVersion.current) setLoading(false); }
  }, [syncHistory, upsertHistory]);

  useEffect(() => {
    void refresh();
    if (!native) return;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    manualProgress.reset(); automaticProgress.reset();
    Promise.all([
      listen<Progress>("organizer-progress", event => {
        if (disposed) return;
        const progress = event.payload;
        if (progress.kind === "automatic") {
          if (progress.phase === "preparing" && progress.completed === 0 && progress.operation_id == null) automaticProgress.reset();
          if (automaticProgress.push(progress)) {
            autoBusyRef.current = progress.phase === "preparing" || progress.phase === "organizing";
            if (!autoBusyRef.current) void refresh();
          }
        } else if (busyRef.current && ((actionKind.current === "organize" && progress.kind === "manual") || (actionKind.current === "undo" && progress.kind === "undo"))) {
          manualProgress.push(progress);
        }
      }),
      listen("organizer-changed", () => {
        if (disposed) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { void refresh(); }, 600);
      }),
    ]).then(items => { if (disposed) items.forEach(fn => fn()); else unlisteners.push(...items); }).catch(e => setError(errorMessage(e)));
    return () => { disposed = true; unlisteners.forEach(fn => fn()); if (timer.current) clearTimeout(timer.current); manualProgress.stop(); automaticProgress.stop(); };
  }, [refresh, manualProgress, automaticProgress]);
  useLayoutEffect(() => { document.documentElement.classList.toggle("dark", data?.preferences.theme !== "light"); }, [data?.preferences.theme]);
  useLayoutEffect(() => { if (data) setLanguage(data.language); }, [data]);
  useEffect(() => () => clearTimeout(feedbackTimer.current), []);
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
    const audible = kind === "organize" || kind === "undo" || kind === "save";
    if (kind === "organize" || kind === "undo") setDetailOperation(undefined);
    detailsNeeded.current = false;
    if (kind === "organize") detailId.current = null;
    const refreshAfter = kind !== "save" || mainDirty;
    if (audible) audio.prepare();
    if (kind === "save" && audio.dirty) audio.prepare(true);
    const expectedCount = kind === "organize" ? preview?.files.reduce((count, file) => count + Number(file.status === "ready"), 0) : undefined;
    manualProgress.reset();
    const delayed = kind === "preview";
    const pendingAction: Action = { kind, phase: "preparing", showLoading: !delayed };
    clearTimeout(feedbackTimer.current);
    setBusy(true); setError(""); setMessage(""); setAction(pendingAction);
    if (delayed) feedbackTimer.current = setTimeout(() => {
      setAction(current => current === pendingAction ? { ...current, showLoading: true } : current);
    }, 200);
    let operationId: number | undefined;
    let jobSucceeded = false;
    try {
      const result = await job();
      jobSucceeded = true;
      if (kind === "save") audio.play("saved");
      manualProgress.finish();
      operationId = typeof result === "number" ? result : undefined;
      const fileOperation = kind === "organize" || kind === "undo";
      if (fileOperation && operationId !== undefined) detailId.current = operationId;
      if (fileOperation) setAction({ kind, phase: "completed", operationId });
      const next = kind !== "refresh" && refreshAfter ? await refresh(true) : undefined;
      if (fileOperation) {
        const sound = operationSound(kind, next?.detail && next.detail.id === operationId ? next.detail : next?.history.find(op => op.id === operationId), expectedCount);
        // One terminal decision per accepted command, never per event or render.
        if (sound) audio.play(sound);
      }
      if (!fileOperation) setAction({ kind, phase: "completed", operationId });
      if (kind === "save") setMessage(t("Preferências salvas. Verifique separadamente o estado do monitoramento.", "Preferences saved. Check the monitoring status separately."));
      return true;
    } catch (e) {
      if (audible && !(kind === "save" && jobSucceeded)) audio.play("warning");
      clearTimeout(feedbackTimer.current);
      manualProgress.finish();
      const problem = errorMessage(e);
      setError(problem); setAction(current => ({ kind, phase: "error", error: problem, operationId: operationId ?? current?.operationId }));
      detailsNeeded.current = kind === "undo";
      if (kind === "organize") { setPreviewError(t("Esta confirmação não pode ser reutilizada. Confira o histórico e atualize a prévia antes de tentar novamente.", "This confirmation can't be reused. Check the history and refresh the preview before trying again.")); setReviewed(false); }
      if (kind === "preview") setPreviewError(t("Não foi possível atualizar a prévia. Tente atualizar novamente antes de confirmar.", "Could not refresh the preview. Try refreshing again before confirming."));
      if (refreshAfter) await refresh();
      return false;
    } finally { clearTimeout(feedbackTimer.current); feedbackTimer.current = undefined; busyRef.current = false; actionKind.current = null; setBusy(false); }
  }

  function discardDraft() {
    audio.discard();
    if (action?.kind === "save") { setError(""); setAction(null); }
    if (data) setDraft({ base: data.preferences, value: data.preferences });
  }
  async function saveDraft() {
    if (!draft || !dirty || external) return false;
    const captured = draft;
    const capturedAudio = audio.draft;
    return run(async () => {
      if (mainDirty) {
        const saved = await api.save(captured.value, captured.base);
        setDraft({ base: saved, value: saved });
        setPreview(null); setReviewed(false);
      }
      if (audio.dirty) audio.save(capturedAudio);
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
    detailId.current = null; setDetailOperation(undefined);
  }
  async function openUndo(operation: Operation | OperationSummary) {
    if (busyRef.current || autoBusyRef.current) return;
    busyRef.current = true; setBusy(true); setOpeningUndo(operation.id); setError(""); setAction(null);
    try {
      const details = await api.operation(operation.id);
      detailId.current = operation.id; setDetailOperation(details); setUndoTarget(details);
      upsertHistory(summarizeOperation(details));
    } catch (error) { setError(errorMessage(error)); }
    finally { busyRef.current = false; setBusy(false); setOpeningUndo(null); }
  }
  async function closeApplication() {
    if (busyRef.current || autoBusyRef.current) return;
    closeBypass.current = true;
    try { await getCurrentWindow().close(); }
    catch (e) { closeBypass.current = false; setError(errorMessage(e)); }
  }
  const working = busy || isRunning(automatic);
  const issue = preview ? previewError || data?.scan_error || previewIssue(preview, data?.preview_id ?? null, clock) : "";
  const resultOperation = detailOperation?.id === action?.operationId ? detailOperation : undefined;
  const files = data?.files ?? noFiles;
  const categories = data?.categories ?? [];
  const history = historyPages.operations;
  const searchable = useMemo(() => files.map(file => ({ file, name: file.name.toLocaleLowerCase() })), [files]);
  const query = search.toLocaleLowerCase();
  const visible = useMemo(() => {
    if (filter === "all" && !query) return files;
    return searchable.filter(({ file, name }) => (filter === "all" || file.category === filter) && name.includes(query)).map(({ file }) => file);
  }, [files, searchable, filter, query]);
  const current = pages.find(p => p.id === page)!;
  function showCategory(id: string) { setSearch(""); setFilter(id); setPage("files"); }
  function showOperation(op: OperationSummary) { upsertHistory(op); setPage("history"); setExpanded(op.id); }

  return <Tooltip.Provider delayDuration={500} skipDelayDuration={300}><div className="app-shell" ref={themeRef}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><img src={data?.preferences.theme === "light" ? brandPrimary : brandWhite} width={32} height={32} alt="" aria-hidden="true" /></span><span>Download Organizer</span></div>
      <nav aria-label={t("Navegação principal", "Main navigation")}><NavigationIndicator page={page} />{pages.map(item => <button key={item.id} className={"nav-item " + (page === item.id ? "active" : "")} aria-label={item.name()} aria-describedby={item.id === "settings" && dirty ? "pending-preferences" : item.id === "files" && data ? "nav-file-count" : undefined} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}><item.icon size={16} aria-hidden="true" /><span>{item.name()}</span>{item.id === "files" && data && <span className="nav-count" id="nav-file-count">{files.length}<span className="sr-only"> {t("arquivos na pasta", "files in the folder")}</span></span>}{item.id === "settings" && dirty && <><span className="draft-dot" aria-hidden="true" /><span id="pending-preferences" className="sr-only">{t("Alterações não salvas", "Unsaved changes")}</span></>}</button>)}</nav>
      <div className="sidebar-bottom"><span className={"monitor-status " + (data?.monitoring ? "online" : "")}><span className="small-dot" />{working ? t("Operação em andamento", "Operation in progress") : data?.monitoring ? t("Monitor ativo", "Monitor on") : t("Monitor pausado", "Monitor paused")}</span><div className="app-version"><span>{t("Armazenamento local", "Local storage")}</span><span>v{version}</span></div></div>
    </aside>
    <div className="main-shell">
      <main className="content"><div className="page-heading"><div><h1 ref={mainHeading} tabIndex={-1}>{current.name()}</h1><p>{page === "dashboard" ? t("O que chegou, para onde vai e o que já foi movido", "What arrived, where it goes and what has moved") : page === "files" ? t("Arquivos da pasta de origem e o destino de cada um", "Files in the source folder and where each one goes") : page === "history" ? t("Cada movimentação registrada, com opção de desfazer", "Every recorded move, with the option to undo") : t("Pastas, regras e preferências de organização", "Folders, rules and organization preferences")}</p></div><div className="heading-actions"><Button variant="outline" size="sm" aria-label={t("Atualizar arquivos", "Refresh files")} disabled={!native || working || loading} onClick={() => void run(async () => { await refresh(true); })}><RefreshCw aria-hidden="true" className={loading || (busy && action?.kind === "refresh") ? "spin" : ""} />{t("Atualizar", "Refresh")}</Button>{page !== "settings" && <Button disabled={!data || working || loading || !files.length || !!data?.scan_error} onClick={() => void updatePreview()}><FolderDown aria-hidden="true" />{busy && action?.kind === "preview" ? t("Preparando prévia…", "Preparing preview…") : t("Organizar arquivos", "Organize files")}</Button>}</div></div>
        {!native && <div className="banner" role="status"><FolderDown size={16} aria-hidden="true" /><div><strong>{t("Abra o aplicativo desktop para acessar seus arquivos", "Open the desktop app to access your files")}</strong><p>{t("Execute", "Run")} <code>npm run tauri dev</code>. {t("As operações reais ficam no aplicativo Tauri.", "Real operations only run in the Tauri app.")}</p></div></div>}
        {dirty && page !== "settings" && <div className="banner" role="status"><div><strong>{t("Há configurações não salvas", "You have unsaved settings")}</strong><p>{t("Seu rascunho foi preservado. As operações usam as configurações salvas.", "Your draft was kept. Operations use the saved settings.")}</p><div className="notice-actions"><Button variant="outline" size="sm" onClick={() => setPage("settings")}>{t("Revisar alterações", "Review changes")}</Button><Button variant="ghost" size="sm" disabled={working} onClick={discardDraft}>{t("Descartar alterações", "Discard changes")}</Button></div></div></div>}
        {error && !preview && !undoTarget && <ProblemNotice title={t("A ação não foi concluída", "The action didn't finish")} message={error} busy={working} action={t("Verificar novamente", "Check again")} onRecover={() => void run(async () => { await refresh(true); })} onDismiss={() => setError("")} />}
        {data?.scan_error && <ProblemNotice title={t("A pasta precisa de atenção", "The folder needs attention")} message={data.scan_error} persistent busy={working} action={t("Revisar diretórios", "Review folders")} onRecover={() => setPage("settings")} />}
        {data?.watch_error && <ProblemNotice title={t("Há um problema no monitoramento", "There's a problem with monitoring")} message={data.watch_error} persistent busy={working} action={data.preferences.automatic ? t("Verificar e reativar monitor", "Check and restart monitor") : t("Revisar automação", "Review automation")} onRecover={() => data.preferences.automatic ? void run(async () => { await api.retryMonitoring(); }, "monitor") : setPage("settings")} />}
        {message && <SuccessNotice message={message} onDismiss={() => setMessage("")} />}
        {!preview && !undoTarget && isRunning(action) && <OperationFeedback action={action} />}
        {automatic && <div className="automatic-feedback"><p>{t("Organização automática", "Automatic organization")}</p><OperationFeedback action={automatic} operation={data?.history.find(op => op.id === automatic.operationId)} /></div>}
        {loading ? <div className="loading-state" role="status"><Loader2 className="spin" size={16} aria-hidden="true" /><p>{t("Lendo seus arquivos com segurança…", "Reading your files safely…")}</p></div> : <PageTransition key={page}>
          {page === "dashboard" && <Overview data={data} onFiles={() => setPage("files")} onSettings={() => setPage("settings")} onCategory={showCategory} onHistory={() => setPage("history")} onOperation={showOperation} />}
          {page === "files" && <section className="files-view"><div className="file-toolbar" data-motion-group><label className="search-field"><span className="sr-only">{t("Buscar arquivos", "Search files")}</span><span className="search-input"><Search size={16} aria-hidden="true" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("Buscar por nome", "Search by name")} aria-label={t("Buscar arquivos", "Search files")} /></span></label><label className="filter-select"><span className="sr-only">{t("Filtrar por categoria", "Filter by category")}</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{t("Todas as categorias", "All categories")}</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><span className="file-count">{plural(visible.length, t("arquivo", "file"), t("arquivos", "files"))}</span></div><FileTable onView={(file, trigger) => { filePreviewFocus.current = trigger; setViewedFile(file); }} filterKey={filter + ":" + query} files={visible} categories={categories} filtered={filter !== "all" || !!search} onClearFilters={() => { setFilter("all"); setSearch(""); }} /><div className="table-footer"><ShieldCheck size={16} aria-hidden="true" />{t("Arquivos recentes aguardam estabilidade. Atualize para verificar novamente.", "Recent files wait until they stop changing. Refresh to check again.")}</div></section>}
          {page === "history" && <HistoryView history={history} expanded={expanded} working={working} openingUndo={openingUndo} onExpand={setExpanded} onUndo={op => void openUndo(op)} hasMore={historyPages.next_cursor !== null} loading={historyPages.loading} pageError={historyPages.error} onLoadMore={() => void historyPages.loadMore()} onRetry={() => void historyPages.retry()} newAvailable={historyPages.newAvailable} onReload={() => void historyPages.reload(expanded)} />}
          {page === "settings" && (data && draft ? <Settings draft={draft.value} categories={categories} busy={working} dirty={dirty} external={external} onChange={update => setDraft(current => current ? { ...current, value: update(current.value) } : current)} onDiscard={discardDraft} onAcceptExternal={() => setDraft(current => current && data ? { ...current, base: data.preferences } : current)} /> : <div className="empty"><Settings2 size={24} aria-hidden="true" /><h2>{t("Configurações disponíveis no desktop", "Settings are available on desktop")}</h2><p>{t("Abra o aplicativo Tauri para selecionar suas pastas.", "Open the Tauri app to select your folders.")}</p></div>)}
        </PageTransition>}
        {page === "settings" && data && draft && <SettingsActions busy={working} dirty={dirty} external={!!external} onSave={() => void saveDraft()} onDiscard={discardDraft} />}
      </main>
    </div>
    <FilePreviewDialog file={viewedFile} categories={categories} onClose={() => setViewedFile(null)} onRestoreFocus={() => { const trigger = filePreviewFocus.current; if (trigger?.isConnected) trigger.focus({ preventScroll: true }); else (document.querySelector<HTMLElement>(".files-view .table-scroll") ?? mainHeading.current)?.focus({ preventScroll: true }); }} />
    <OperationDialogs preview={preview} undoTarget={undoTarget} categories={categories} action={action} busy={busy} working={working} issue={issue} reviewed={reviewed} operation={resultOperation}
      onReviewed={setReviewed} onUpdate={() => void updatePreview()} onClose={closeDialogs} onRestoreFocus={() => mainHeading.current?.focus()}
      onOrganize={() => { if (!preview || issue || !reviewed) return; const id = preview.id; void run(() => api.organize(id), "organize"); }}
      onUndo={() => { if (!undoTarget) return; const id = undoTarget.id; void run(async () => { await api.undo(id); return id; }, "undo"); }}
      onViewResult={() => { const id = action?.operationId; const operation = resultOperation ?? data?.history.find(op => op.id === id); if (operation) upsertHistory(summarizeOperation(operation)); closeDialogs(); setPage("history"); if (id !== undefined) setExpanded(id); }} />
    <Dialog open={closeRequested} onOpenChange={setCloseRequested}><DialogContent><DialogHeader><DialogTitle>{working ? t("Uma operação está em andamento", "An operation is in progress") : dirty ? t("Há alterações não salvas", "You have unsaved changes") : t("Fechar aplicativo?", "Close the app?")}</DialogTitle><DialogDescription>{working ? t("Aguarde a conclusão antes de fechar o aplicativo.", "Wait for it to finish before closing the app.") : dirty ? t("Você pode salvar ou descartar o rascunho antes de sair.", "You can save or discard the draft before leaving.") : t("A operação terminou. Consulte o histórico para conferir os resultados.", "The operation finished. See the history to check the results.")}</DialogDescription></DialogHeader>
      {working && <OperationFeedback action={isRunning(action) ? action : automatic} />}
      {external && <p className="inline-error" role="alert">{t("As configurações salvas foram alteradas. Revise as versões nas configurações antes de salvar.", "The saved settings changed. Review the versions in Settings before saving.")}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => { setCloseRequested(false); if (dirty) setPage("settings"); }}>{t("Continuar no aplicativo", "Stay in the app")}</Button><Button variant="outline" disabled={working} onClick={() => void closeApplication()}>{dirty ? t("Descartar e sair", "Discard and quit") : t("Sair", "Quit")}</Button><Button disabled={working || !dirty || !!external} onClick={() => { void saveDraft().then(saved => { if (saved) void closeApplication(); }); }}>{t("Salvar e sair", "Save and quit")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div></Tooltip.Provider>;
}

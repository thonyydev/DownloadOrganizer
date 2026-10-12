import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowRight, ArrowUpRight, AudioLines, Boxes, Check, ChevronRight, CircleCheck, Clock3, Code2, Download, FileText, FolderDown, FolderOpen, History, Image, LayoutDashboard, Loader2, Package, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Undo2, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileTable } from "@/components/file-table";
import { Settings } from "@/components/settings";
import { OperationDialogs } from "@/components/operation-dialogs";
import { OperationFeedback } from "@/components/operation-feedback";
import { ProblemNotice } from "@/components/problem-notice";
import { errorMessage, isRunning, previewIssue, reconcileDraft, samePreferences, type Action, type PreferencesDraft } from "@/lib/experience";
import { api, basename, bytes, date, labels, native, type Operation, type Preview, type Progress, type Snapshot } from "@/lib/api";
import "./App.css";

const pages = [{ id: "dashboard", name: "Visão geral", icon: LayoutDashboard }, { id: "files", name: "Arquivos", icon: FolderOpen }, { id: "history", name: "Histórico", icon: History }, { id: "settings", name: "Configurações", icon: Settings2 }] as const;
const categoryIcons: Record<string, typeof Image> = { images: Image, videos: Video, audio: AudioLines, documents: FileText, archives: Package, installers: Download, code: Code2, other: Boxes };

function Activity({ operation, onOpen, expanded }: { operation: Operation; onOpen: () => void; expanded?: boolean }) {
  const moved = operation.movements.filter(m => m.status === "moved").length;
  const undone = operation.movements.filter(m => m.status === "undone").length;
  const errors = operation.movements.filter(m => m.error || ["failed", "uncertain", "pending", "undo_pending"].includes(m.status)).length;
  return <button className="activity" onClick={onOpen} aria-expanded={expanded} aria-controls={expanded === undefined ? undefined : `movements-${operation.id}`}><span className={`activity-icon ${errors ? "warning" : ""}`}>{undone ? <Undo2 size={16} /> : <CircleCheck size={16} />}</span><span className="activity-copy"><strong>{undone ? `${undone} arquivo${undone !== 1 ? "s" : ""} restaurado${undone !== 1 ? "s" : ""}` : `${moved} arquivo${moved !== 1 ? "s" : ""} organizado${moved !== 1 ? "s" : ""}`}</strong><small>{operation.kind === "automatic" ? "Automação" : "Organização manual"} · {date(operation.created * 1000)}{errors > 0 && ` · ${errors} ocorrência(s)`}</small></span><ChevronRight size={15} /></button>;
}

export default function App() {
  const [page, setPage] = useState<(typeof pages)[number]["id"]>("dashboard");
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
  useEffect(() => { document.documentElement.classList.toggle("dark", data?.preferences.theme !== "light"); }, [data?.preferences.theme]);
  useEffect(() => { mainHeading.current?.focus(); }, [page]);
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
  const ready = files.filter(f => f.status === "ready").length;
  const conflicts = files.filter(f => f.status === "conflict").length;
  const organized = history.reduce((count, op) => count + op.movements.filter(m => m.status === "moved").length, 0);
  const visible = files.filter(f => (filter === "all" || f.category === filter) && f.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const current = pages.find(p => p.id === page)!;
  function showCategory(id: string) { setSearch(""); setFilter(id); setPage("files"); }
  function showOperation(op: Operation) { setPage("history"); setExpanded(op.id); }

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-icon"><FolderDown size={22} /></span><span>Download<span className="brand-sub">Organizer</span></span><Badge variant="outline" className="version">MVP</Badge></div>
      <div className="workspace-label">SEU ESPAÇO</div><nav aria-label="Navegação principal">{pages.map(item => <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}><item.icon size={17} /><span>{item.name}</span>{item.id === "files" && data && <span className="nav-count">{files.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-note"><ShieldCheck size={17} /><div><strong>Seus arquivos. Seu controle.</strong><span>100% local neste computador</span></div></div><div className="app-version"><span className="small-dot" />Download Organizer <span>v0.1.0</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Seu espaço<ChevronRight size={13} /><span>{current.name}</span></div><span className="local-badge"><ShieldCheck size={13} />Local & privado</span></header>
      <main className="content"><div className="page-heading"><div><div className="eyebrow">{page === "dashboard" ? "MENOS BAGUNÇA, MAIS CLAREZA" : "DOWNLOAD ORGANIZER"}</div><h1 ref={mainHeading} tabIndex={-1}>{page === "dashboard" ? "Tudo no seu lugar." : current.name}</h1><p>{page === "dashboard" ? "Uma pasta organizada. Uma coisa a menos para pensar." : page === "files" ? "Conheça seus arquivos e veja para onde cada um vai." : page === "history" ? "Cada movimentação registrada. Cada arquivo sob controle." : "Organize do seu jeito, com segurança em cada etapa."}</p></div><div className="heading-actions"><Button variant="outline" size="icon" aria-label="Atualizar arquivos" disabled={!native || working || loading} onClick={() => void run(async () => { await refresh(true); })}><RefreshCw aria-hidden="true" className={loading || (busy && action?.kind === "refresh") ? "spin" : ""} /></Button>{page !== "settings" && <Button disabled={!data || working || loading || !files.length || !!data?.scan_error} onClick={() => void updatePreview()}><Sparkles aria-hidden="true" />{busy && action?.kind === "preview" ? "Preparando prévia…" : "Organizar arquivos"}</Button>}</div></div>
        {!native && <div className="banner" role="status"><FolderDown size={19} /><div><strong>Abra o aplicativo desktop para acessar seus arquivos</strong><p>Execute <code>npm run tauri dev</code>. O navegador exibe a interface; as operações reais ficam no aplicativo Tauri.</p></div></div>}
        {dirty && page !== "settings" && <div className="banner" role="status"><div><strong>Há configurações não salvas</strong><p>Seu rascunho foi preservado. As operações usam as configurações salvas.</p><div className="notice-actions"><Button variant="outline" size="sm" onClick={() => setPage("settings")}>Revisar alterações</Button><Button variant="ghost" size="sm" disabled={working} onClick={discardDraft}>Descartar alterações</Button></div></div></div>}
        {error && !preview && !undoTarget && <ProblemNotice title="A ação não foi concluída" message={error} busy={working} action="Verificar novamente" onRecover={() => void run(async () => { await refresh(true); })} onDismiss={() => setError("")} />}
        {data?.scan_error && <ProblemNotice title="A pasta precisa de atenção" message={data.scan_error} persistent busy={working} action="Revisar diretórios" onRecover={() => setPage("settings")} />}
        {data?.watch_error && <ProblemNotice title="Há um problema no monitoramento" message={data.watch_error} persistent busy={working} action={data.preferences.automatic ? "Verificar e reativar monitor" : "Revisar automação"} onRecover={() => data.preferences.automatic ? void run(async () => { await api.retryMonitoring(); }, "monitor") : setPage("settings")} />}
        {message && <div className="banner success-banner" role="status"><Check size={18} aria-hidden="true" /><p>{message}</p><Button variant="ghost" size="icon" aria-label="Fechar aviso" onClick={() => setMessage("")}><X aria-hidden="true" /></Button></div>}
        {!preview && !undoTarget && isRunning(action) && <OperationFeedback action={action} />}
        {automatic && <div className="automatic-feedback"><p>Organização automática</p><OperationFeedback action={automatic} operation={data?.history.find(op => op.id === automatic.operationId)} /></div>}
        {loading ? <div className="loading-state"><Loader2 className="spin" size={26} /><p>Lendo seus arquivos com segurança…</p></div> : <>
        {page === "dashboard" && <>
          <section className="hero-panel"><div className="hero-copy"><span className="hero-kicker"><span className="small-dot" />UM ESPAÇO MAIS LEVE</span><h2>A organização começa<br />com uma boa prévia.</h2><p>Veja os destinos, confira os arquivos e confirme.<br />Você decide quando dar o próximo passo.</p><Button variant="secondary" onClick={() => setPage("files")}>Explorar arquivos<ArrowRight /></Button></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-file art-image"><Image size={23} /><span>.png</span></span><span className="art-file art-doc"><FileText size={23} /><span>.pdf</span></span><span className="art-file art-code"><Code2 size={23} /><span>.rs</span></span><div className="art-folder"><FolderDown size={55} strokeWidth={1.3} /><span>Um lugar para tudo</span></div><span className="art-check"><Check size={15} /></span></div></section>
          <div className="stats-grid"><div className="stat-card"><span>Arquivos na pasta<FolderOpen size={15} /></span><strong>{data ? files.length : "—"}</strong><small>{data ? bytes(files.reduce((sum, f) => sum + f.size, 0)) : "Aguardando aplicativo"} no total</small></div><div className="stat-card"><span>Prontos para organizar<Sparkles size={15} /></span><strong>{data ? ready : "—"}</strong><small>Após sua confirmação</small></div><div className="stat-card"><span>Organizados no histórico<CircleCheck size={15} /></span><strong>{data ? organized : "—"}</strong><small>Nas últimas 100 operações</small></div><div className="stat-card"><span>Conflitos preservados<ShieldCheck size={15} /></span><strong>{data ? conflicts : "—"}</strong><small>Nenhum arquivo sobrescrito</small></div></div>
          <section className="panel folder-panel"><span className="folder-square"><FolderOpen size={23} /></span><div className="folder-copy"><h2>Pasta de origem</h2><code title={data?.preferences.source}>{data?.preferences.source || "Selecione uma pasta nas configurações"}</code></div><span className={`monitor-status ${data?.monitoring ? "online" : ""}`}><span className="small-dot" />{data?.monitoring ? "Monitoramento ativo" : "Monitoramento pausado"}</span><Button variant="ghost" size="sm" onClick={() => setPage("settings")}>Configurar<ArrowUpRight /></Button></section>
          <div className="section-heading"><div><h2>Uma categoria para cada arquivo</h2><p>Destinos claros, sem complicação.</p></div><span>{categories.length || "—"} categorias</span></div><div className="categories-grid">{categories.map(category => { const Icon = categoryIcons[category.id] ?? Boxes; const count = files.filter(f => f.category === category.id).length; return <button className={`category-card tone-${category.id}`} key={category.id} onClick={() => showCategory(category.id)}><div className="category-card-top"><span className="category-icon"><Icon size={20} /></span><ArrowUpRight size={15} /></div><h3>{category.name}</h3><p>{count} arquivo{count !== 1 ? "s" : ""}<span>{data?.preferences.enabled_categories.includes(category.id) ? "Habilitada" : "Pausada"}</span></p><div className="category-bar"><span style={{ width: `${files.length ? count / files.length * 100 : 0}%` }} /></div></button>; })}</div>
          <div className="dashboard-bottom"><section className="panel"><div className="panel-heading"><h2><Clock3 size={16} />Atividades recentes</h2><Button variant="ghost" size="sm" onClick={() => setPage("history")}>Ver histórico<ArrowRight /></Button></div>{history.length ? history.slice(0, 4).map(op => <Activity key={op.id} operation={op} onOpen={() => showOperation(op)} />) : <div className="empty compact"><History size={25} /><h3>Um novo começo</h3><p>Suas organizações aparecerão aqui.</p></div>}</section><section className="safety-card"><ShieldCheck size={28} /><h3>Cuidado em cada movimento.</h3><p>Prévia antes de organizar, conflitos preservados e histórico real para desfazer.</p><span><Check size={13} />Sem exclusões permanentes</span><span><Check size={13} />Sem sobrescritas</span></section></div>
        </>}
        {page === "files" && <section className="panel"><div className="file-toolbar"><div className="search-input"><Search size={15} /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome…" aria-label="Buscar arquivos" /></div><label className="filter-select"><span className="sr-only">Filtrar por categoria</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas as categorias</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><span>{visible.length} arquivo(s)</span></div><FileTable files={visible} categories={categories} filtered={filter !== "all" || !!search} onClearFilters={() => { setFilter("all"); setSearch(""); }} /><div className="table-footer"><ShieldCheck size={13} />Arquivos recentes aguardam estabilidade. Atualize para verificar novamente.</div></section>}
        {page === "history" && <div className="history-stack">{history.length ? history.map(op => <section className="panel" key={op.id}><div className="history-header"><Activity operation={op} expanded={expanded === op.id} onOpen={() => setExpanded(expanded === op.id ? null : op.id)} /><Button variant="outline" size="sm" disabled={working || !op.movements.some(m => m.status === "moved")} onClick={() => { setAction(null); setError(""); setUndoTarget(op); }}><Undo2 />Desfazer</Button></div>{expanded === op.id && <div className="movement-list" id={`movements-${op.id}`}>{op.movements.map(m => <div className="movement" key={m.id}><div><strong>{basename(m.source)}</strong><span title={`${m.source} → ${m.destination}`}>{m.source}<ArrowRight size={12} />{m.destination}</span>{m.error && <p className="inline-error">{m.error}</p>}</div><span className={`status status-${m.status}`}>{labels[m.status] ?? m.status}</span></div>)}</div>}</section>) : <div className="panel empty"><History size={32} /><h3>Seu histórico começa aqui</h3><p>Organize arquivos para registrar sua primeira atividade.</p></div>}</div>}
        {page === "settings" && (data && draft ? <Settings draft={draft.value} categories={categories} busy={working} dirty={dirty} external={external} onChange={update => setDraft(current => current ? { ...current, value: update(current.value) } : current)} onSave={() => void saveDraft()} onDiscard={discardDraft} onAcceptExternal={() => setDraft(current => current && data ? { ...current, base: data.preferences } : current)} /> : <div className="panel empty"><Settings2 size={30} /><h3>Configurações disponíveis no desktop</h3><p>Abra o aplicativo Tauri para selecionar suas pastas.</p></div>)}
        </>}
        <footer className="content-footer"><span><ShieldCheck size={12} />Feito para cuidar dos seus arquivos</span><span>Sem nuvem. Sem distrações.</span></footer>
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
  </div>;
}

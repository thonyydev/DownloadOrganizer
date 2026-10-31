import { ChevronDown, ChevronRight, CircleCheck, History, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeedbackMotion, useMotionAllowed } from "@/components/motion/feedback";
import { Collapse } from "@/components/motion/collapse";
import { useContentMotion } from "@/components/motion/transitions";
import { displayPath, api, date, summarizeOperation, type DestinationSummary, type Operation, type OperationSummary as Summary } from "@/lib/api";
import { plural } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { OperationExplorer } from "@/components/operation-explorer";

function OperationSummary({ operation }: { operation: Operation | Summary }) {
  const [destinations, setDestinations] = useState<DestinationSummary | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if ("movements" in operation) return;
    let disposed = false;
    api.destinations(operation.id).then(value => { if (!disposed) { setDestinations(value); setError(""); } }).catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; };
  }, [operation, retry]);
  const summary = useMemo(() => {
    const folders = new Map<string, number>();
    for (const movement of "movements" in operation ? operation.movements : []) {
      const separator = Math.max(movement.destination.lastIndexOf("/"), movement.destination.lastIndexOf("\\"));
      if (separator < 0) continue;
      const folder = movement.destination.slice(0, separator + 1);
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
    const destinations = [...folders].sort((a, b) => b[1] - a[1]);
    return { ...summarizeOperation(operation), destinations };
  }, [operation]);
  const remaining = summary.destinations.slice(5);
  const folders = destinations ?? { folders: summary.destinations.slice(0, 5), other_folders: remaining.length, other_files: remaining.reduce((count, [, value]) => count + value, 0) };
  return <div className="operation-summary">
    <dl className="operation-totals"><div><dt>{t("Arquivos envolvidos", "Files involved")}</dt><dd>{summary.total}</dd></div><div><dt>{t("Organizados no destino", "Organized at the destination")}</dt><dd>{summary.moved}</dd></div><div><dt>{t("Restaurados", "Restored")}</dt><dd>{summary.undone}</dd></div><div><dt>{t("Falhas ou verificação", "Failures or checks")}</dt><dd>{summary.errors}</dd></div></dl>
    <p className="summary-meta">{operation.kind === "automatic" ? t("Automação", "Automation") : operation.kind === "manual" ? t("Organização manual", "Manual organization") : operation.kind} · {date(operation.created * 1000)}</p>
    {!("movements" in operation) && !destinations && !error && <p className="summary-meta" role="status">{t("Consultando destinos…", "Looking up destinations…")}</p>}
    {error && <p className="inline-error" role="alert">{t("Não foi possível consultar os destinos.", "Could not look up the destinations.")} <Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>{t("Tentar novamente", "Try again")}</Button></p>}
    {folders.folders.length > 0 && <div className="destination-summary"><strong>{t("Pastas de destino registradas", "Recorded destination folders")}</strong><dl>{folders.folders.map(([folder, count]) => <div key={folder}><dt>{displayPath(folder)}</dt><dd>{plural(count, t("arquivo", "file"), t("arquivos", "files"))}</dd></div>)}</dl>{folders.other_folders > 0 && <p>{plural(folders.other_folders, t("outra pasta", "other folder"), t("outras pastas", "other folders"))} · {plural(folders.other_files, t("arquivo", "file"), t("arquivos", "files"))}. {t("Consulte os caminhos no explorador.", "See the paths in the explorer.")}</p>}</div>}
    <OperationExplorer operation={operation} />
  </div>;
}

export function Activity({ operation, onOpen, expanded, motionAllowed = false }: { operation: Operation | Summary; onOpen: () => void; expanded?: boolean; motionAllowed?: boolean }) {
  const { moved, undone, errors } = useMemo(() => summarizeOperation(operation), [operation]);
  const mark = useFeedbackMotion<SVGSVGElement>(`${operation.id}:${moved}:${undone}:${errors}`, motionAllowed && errors === 0);
  return <button className="activity" onClick={onOpen} aria-expanded={expanded} aria-controls={expanded === undefined ? undefined : "movements-" + operation.id}>
    <span className={"activity-icon " + (errors ? "warning" : "")}>
      {undone ? <Undo2 ref={mark} size={16} aria-hidden="true" /> : <CircleCheck ref={mark} size={16} aria-hidden="true" />}
    </span>
    <span className="activity-copy">
      <strong>{undone ? plural(undone, t("arquivo restaurado", "file restored"), t("arquivos restaurados", "files restored")) : plural(moved, t("arquivo organizado", "file organized"), t("arquivos organizados", "files organized"))}</strong>
      <small><span className="operation-id">#{operation.id}</span>{operation.kind === "automatic" ? t("Automação", "Automation") : t("Organização manual", "Manual organization")}<span>·</span><time dateTime={new Date(operation.created * 1000).toISOString()}>{date(operation.created * 1000)}</time>{undone > 0 && moved > 0 && <span>· {moved} {t("ainda no destino", "still at the destination")}</span>}</small>
    </span>
    {errors > 0 && <span className="status status-conflict">{plural(errors, t("ocorrência", "issue"), t("ocorrências", "issues"))}</span>}
    {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
  </button>;
}

export function HistoryView({ history, expanded, working, openingUndo, onExpand, onUndo, hasMore, loading, pageError, onLoadMore, onRetry, newAvailable, onReload }: {
  history: (Operation | Summary)[]; expanded: number | null; working: boolean;
  onExpand: (id: number | null) => void; onUndo: (operation: Operation | Summary) => void;
  hasMore?: boolean; loading?: boolean; pageError?: string; onLoadMore?: () => void; onRetry?: () => void; newAvailable?: boolean; onReload?: () => void;
  openingUndo?: number | null;
}) {
  const motionAllowed = useMotionAllowed();
  const ref = useContentMotion(history.slice(0, 4).map(op => op.id).join(":"), motionAllowed);
  if (!history.length) return <div ref={ref} data-motion-group className="empty" role="status"><History size={24} aria-hidden="true" /><h2>{t("Nenhuma operação registrada", "No recorded operations")}</h2><p>{t("Após organizar arquivos, consulte aqui os resultados e as opções de desfazer.", "After you organize files, the results and undo options appear here.")}</p></div>;
  return <><div className="table-footer">{plural(history.length, t("operação carregada", "operation loaded"), t("operações carregadas", "operations loaded"))}{t(", da mais recente para a mais antiga", ", newest first")}{newAvailable && <Button variant="outline" size="sm" disabled={loading || working} onClick={onReload}>{t("Novas operações — atualizar lista", "New operations — refresh the list")}</Button>}</div><div ref={ref} data-motion-group className="history-list" aria-label={t("Operações registradas", "Recorded operations")}>{history.map(op => <section className="history-operation" key={op.id} aria-label={t("Operação", "Operation") + " " + op.id}>
    <div className="history-header"><Activity operation={op} motionAllowed={motionAllowed} expanded={expanded === op.id} onOpen={() => onExpand(expanded === op.id ? null : op.id)} />
      <Button variant="outline" size="sm" disabled={working || !summarizeOperation(op).moved} onClick={() => onUndo(op)}><Undo2 aria-hidden="true" />{openingUndo === op.id ? t("Preparando restauração…", "Preparing restore…") : t("Desfazer", "Undo")}</Button>
    </div>
    <Collapse open={expanded === op.id} className="movement-list" id={"movements-" + op.id}>{expanded === op.id ? <OperationSummary operation={op} /> : null}</Collapse>
  </section>)}</div>{pageError && <div role="alert" className="inline-error">{pageError}<Button variant="outline" size="sm" disabled={loading || working} onClick={onRetry}>{t("Tentar carregar novamente", "Try loading again")}</Button></div>}{hasMore && <div className="table-footer"><Button variant="outline" disabled={loading || working} onClick={onLoadMore}>{loading ? t("Carregando operações…", "Loading operations…") : t("Carregar mais", "Load more")}</Button></div>}</>;
}

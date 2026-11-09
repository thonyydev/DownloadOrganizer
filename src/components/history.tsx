import { ArrowRight, ChevronDown, ChevronRight, CircleCheck, FolderSearch, History, Search, Undo2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFeedbackMotion, useMotionAllowed } from "@/components/motion/feedback";
import { Collapse } from "@/components/motion/collapse";
import { useContentMotion } from "@/components/motion/transitions";
import { displayPath, api, basename, date, statusLabel, summarizeOperation, type DestinationSummary, type FoundMovement, type Operation, type OperationSummary as Summary } from "@/lib/api";
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
    <dl className="operation-totals"><div><dt>{t("Files involved")}</dt><dd>{summary.total}</dd></div><div><dt>{t("Organized at the destination")}</dt><dd>{summary.moved}</dd></div><div><dt>{t("Restored")}</dt><dd>{summary.undone}</dd></div><div><dt>{t("Failures or checks")}</dt><dd>{summary.errors}</dd></div></dl>
    <p className="summary-meta">{operation.kind === "automatic" ? t("Automation") : operation.kind === "manual" ? t("Manual organization") : operation.kind} · {date(operation.created * 1000)}</p>
    {!("movements" in operation) && !destinations && !error && <p className="summary-meta" role="status">{t("Looking up destinations…")}</p>}
    {error && <p className="inline-error" role="alert">{t("Could not look up the destinations.")} <Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>{t("Try again")}</Button></p>}
    {folders.folders.length > 0 && <div className="destination-summary"><strong>{t("Recorded destination folders")}</strong><dl>{folders.folders.map(([folder, count]) => <div key={folder}><dt>{displayPath(folder)}</dt><dd>{plural(count, t("file"), t("files"))}</dd></div>)}</dl>{folders.other_folders > 0 && <p>{plural(folders.other_folders, t("other folder"), t("other folders"))} · {plural(folders.other_files, t("file"), t("files"))}. {t("See the paths in the explorer.")}</p>}</div>}
    <OperationExplorer operation={operation} />
  </div>;
}

export function Activity({ operation, onOpen, expanded, motionAllowed = false, className = "" }: { operation: Operation | Summary; onOpen: () => void; expanded?: boolean; motionAllowed?: boolean; className?: string }) {
  const { moved, undone, errors } = useMemo(() => summarizeOperation(operation), [operation]);
  const mark = useFeedbackMotion<SVGSVGElement>(`${operation.id}:${moved}:${undone}:${errors}`, motionAllowed && errors === 0);
  return <button className={"activity " + className} onClick={onOpen} aria-expanded={expanded} aria-controls={expanded === undefined ? undefined : "movements-" + operation.id}>
    <span className={"activity-icon " + (errors ? "warning" : "")}>
      {undone ? <Undo2 ref={mark} size={16} aria-hidden="true" /> : <CircleCheck ref={mark} size={16} aria-hidden="true" />}
    </span>
    <span className="activity-copy">
      <strong>{undone ? plural(undone, t("file restored"), t("files restored")) : plural(moved, t("file organized"), t("files organized"))}</strong>
      <small><span className="operation-id">#{operation.id}</span>{operation.kind === "automatic" ? t("Automation") : t("Manual organization")}<span>·</span><time dateTime={new Date(operation.created * 1000).toISOString()}>{date(operation.created * 1000)}</time>{undone > 0 && moved > 0 && <span>· {moved} {t("still at the destination")}</span>}</small>
    </span>
    {errors > 0 && <span className="status status-conflict">{plural(errors, t("issue"), t("issues"))}</span>}
    {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
  </button>;
}

// The newest operation when the page opened: anything newer arrived while it was on screen.
export function useSeenOperation(history: readonly { id: number }[]) {
  const [seen] = useState(() => history[0]?.id ?? 0);
  return seen;
}
export const arrivalClass = (id: number, index: number, seen: number) => (id > seen ? " arrived" : "") + (index === 0 ? " latest" : "");

// Matches the backend's SEARCH_LIMIT: a full page means older matches may exist.
const searchLimit = 50;

// Finds a file by name across every operation, to see where it went.
function HistorySearch() {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; results: FoundMovement[]; error: string } | null>(null);
  const [revealError, setRevealError] = useState("");
  const text = query.trim();
  useEffect(() => {
    if (!text) return;
    let stale = false;
    const timer = setTimeout(() => api.searchHistory(text)
      .then(results => { if (!stale) setFound({ query: text, results, error: "" }); })
      .catch(error => { if (!stale) setFound({ query: text, results: [], error: String(error) }); }), 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [text]);
  const shown = text && found?.query === text ? found : null;
  // Only a short summary is live: the list itself would be read out at every keystroke.
  const summary = !shown || shown.error ? "" : shown.results.length ? plural(shown.results.length, t("file"), t("files")) : t("No moved file has this name.");
  return <div className="history-search">
    <label className="search-field"><span className="sr-only">{t("Search the history")}</span><span className="search-input"><Search size={16} aria-hidden="true" /><Input value={query} onChange={event => { setQuery(event.target.value); setRevealError(""); }} onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }} placeholder={t("Where did a file go? Search by name")} aria-label={t("Search the history")} /></span></label>
    <p className="sr-only" role="status">{summary}</p>
    {shown && <div>
      {shown.error ? <p className="inline-error" role="alert">{shown.error}</p> : !shown.results.length ? <p className="history-search-note">{t("No moved file has this name.")}</p> : <>
        {revealError && <p className="inline-error" role="alert">{revealError}</p>}
        <ul className="history-search-results" aria-label={t("Files found in the history")}>{shown.results.map(found => <li key={found.id} className="movement">
          <div><strong>{basename(found.source)}</strong><p className="history-search-route"><ArrowRight size={14} aria-hidden="true" /><span>{displayPath(found.destination)}</span></p><small>#{found.operation_id} · {date(found.created * 1000)}</small></div>
          <span className={"status status-" + found.status}>{statusLabel(found.status)}</span>
          {found.status === "moved" && <Button variant="ghost" size="sm" aria-label={`${t("Show in folder")}: ${basename(found.source)}`} onClick={() => { setRevealError(""); api.revealMovement(found.operation_id, found.id).catch(error => setRevealError(String(error))); }}><FolderSearch aria-hidden="true" />{t("Show in folder")}</Button>}
        </li>)}</ul>
        {shown.results.length === searchLimit && <p className="history-search-note">{t("Showing the 50 most recent matches. Type more of the name to narrow them.")}</p>}
      </>}
    </div>}
  </div>;
}

export function HistoryView({ history, expanded, working, openingUndo, onExpand, onUndo, hasMore, loading, pageError, onLoadMore, onRetry, newAvailable, onReload }: {
  history: (Operation | Summary)[]; expanded: number | null; working: boolean;
  onExpand: (id: number | null) => void; onUndo: (operation: Operation | Summary) => void;
  hasMore?: boolean; loading?: boolean; pageError?: string; onLoadMore?: () => void; onRetry?: () => void; newAvailable?: boolean; onReload?: () => void;
  openingUndo?: number | null;
}) {
  const motionAllowed = useMotionAllowed();
  const ref = useContentMotion(history.slice(0, 4).map(op => op.id).join(":"), motionAllowed);
  const seen = useSeenOperation(history);
  if (!history.length) return <div ref={ref} data-motion-group className="empty" role="status"><History size={24} aria-hidden="true" /><h2>{t("No recorded operations")}</h2><p>{t("After you organize files, the results and undo options appear here.")}</p></div>;
  return <><HistorySearch /><div className="table-footer">{plural(history.length, t("operation loaded"), t("operations loaded"))}{t(", newest first")}{newAvailable && <Button variant="outline" size="sm" disabled={loading || working} onClick={onReload}>{t("New operations — refresh the list")}</Button>}</div><div ref={ref} data-motion-group className="history-list" aria-label={t("Recorded operations")}>{history.map((op, index) => <section className={"history-operation" + arrivalClass(op.id, index, seen)} key={op.id} aria-label={t("Operation") + " " + op.id}>
    <div className="history-header"><Activity operation={op} motionAllowed={motionAllowed} expanded={expanded === op.id} onOpen={() => onExpand(expanded === op.id ? null : op.id)} />
      <Button variant="outline" size="sm" disabled={working || !summarizeOperation(op).moved} onClick={() => onUndo(op)}><Undo2 aria-hidden="true" />{openingUndo === op.id ? t("Preparing restore…") : t("Undo")}</Button>
    </div>
    <Collapse open={expanded === op.id} className="movement-list" id={"movements-" + op.id}>{expanded === op.id ? <OperationSummary operation={op} /> : null}</Collapse>
  </section>)}</div>{pageError && <div role="alert" className="inline-error">{pageError}<Button variant="outline" size="sm" disabled={loading || working} onClick={onRetry}>{t("Try loading again")}</Button></div>}{hasMore && <div className="table-footer"><Button variant="outline" disabled={loading || working} onClick={onLoadMore}>{loading ? t("Loading operations…") : t("Load more")}</Button></div>}</>;
}

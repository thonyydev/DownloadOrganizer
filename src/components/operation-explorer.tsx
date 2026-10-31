import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { displayPath, api, basename, statusLabel, type Movement, type Operation, type OperationSummary } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function movementProblem(movement: Movement) {
  return !!movement.error || ["failed", "uncertain", "pending", "undo_pending"].includes(movement.status);
}

function MovementList({ movements }: { movements: Movement[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const indexed = useMemo(() => {
    const problems: { movement: Movement; name: string; query: string }[] = [];
    const other: typeof problems = [];
    for (const movement of movements) {
      const name = basename(movement.source);
      (movementProblem(movement) ? problems : other).push({ movement, name, query: name.toLocaleLowerCase() });
    }
    return [...problems, ...other];
  }, [movements]);
  const statuses = useMemo(() => [...new Set(movements.map(m => m.status))], [movements]);
  const query = search.toLocaleLowerCase();
  const results = useMemo(() => indexed.filter(({ movement, query: name }) => name.includes(query) &&
    (status === "all" || (status === "problems" ? movementProblem(movement) : movement.status === status))), [indexed, query, status]);
  const getItemKey = useCallback((index: number) => results[index].movement.id, [results]);
  const virtual = results.length > 50;
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: results.length, getScrollElement: () => scrollRef.current, getItemKey,
    estimateSize: () => 150, overscan: 5, enabled: virtual, useAnimationFrameWithResizeObserver: true,
  });
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [query, status]);
  const items = virtual ? virtualizer.getVirtualItems() : results.map(({ movement }, index) => ({ index, key: movement.id, start: 0, end: 0 }));
  let previousEnd = 0;
  return <>
    <div className="file-toolbar explorer-toolbar">
      <label className="search-field"><span>{t("Buscar por nome", "Search by name")}</span><Input aria-label={t("Buscar arquivos da operação", "Search files in this operation")} value={search} onChange={event => setSearch(event.target.value)} placeholder={t("Nome do arquivo…", "File name…")} /></label>
      <label className="filter-select"><span>{t("Filtrar por status", "Filter by status")}</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">{t("Todos os status", "All statuses")}</option><option value="problems">{t("Com problemas", "With problems")}</option>{statuses.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
    </div>
    <p className="explorer-count">{results.length} {t("de", "of")} {plural(movements.length, t("arquivo", "file"), t("arquivos", "files"))} · {t("Ocorrências primeiro", "Issues first")}</p>
    <div ref={scrollRef} className="movement-scroll" role="region" aria-label={t("Arquivos da operação", "Files in this operation")} tabIndex={0} onKeyDown={event => {
      if (event.target !== event.currentTarget || !results.length || !["Home", "End"].includes(event.key)) return;
      event.preventDefault();
      if (virtual) virtualizer.scrollToIndex(event.key === "Home" ? 0 : results.length - 1, { align: event.key === "Home" ? "start" : "end", behavior: "auto" });
      else event.currentTarget.scrollTop = event.key === "Home" ? 0 : event.currentTarget.scrollHeight;
    }}>
      {results.length ? <ol className="explorer-list" aria-label={t("Movimentações da operação", "Moves in this operation")}>{items.map(item => {
        const { movement, name } = results[item.index];
        const gap = virtual ? item.start - previousEnd : 0;
        previousEnd = item.end;
        return <Fragment key={item.key}>{gap > 0 && <li aria-hidden="true" role="presentation" style={{ height: gap }} />}
          <li className="movement" data-movement-id={movement.id} data-index={item.index} ref={virtual ? virtualizer.measureElement : undefined} aria-posinset={item.index + 1} aria-setsize={results.length}>
            <div><strong>{name}</strong><dl className="movement-paths"><dt>{t("Origem", "Source")}</dt><dd>{displayPath(movement.source)}</dd><dt>{t("Destino", "Destination")}</dt><dd>{displayPath(movement.destination)}</dd></dl>{movement.error && <p className="inline-error">{movement.error}</p>}</div>
            <span className={"status status-" + movement.status}>{statusLabel(movement.status)}</span>
          </li></Fragment>;
      })}{virtual && virtualizer.getTotalSize() > previousEnd && <li aria-hidden="true" role="presentation" style={{ height: virtualizer.getTotalSize() - previousEnd }} />}</ol>
        : <div className="empty" role="status"><h2>{movements.length ? t("Nenhum arquivo corresponde aos filtros", "No files match the filters") : t("Nenhuma movimentação registrada", "No recorded moves")}</h2>{movements.length > 0 && <Button variant="outline" onClick={() => { setSearch(""); setStatus("all"); }}>{t("Limpar filtros", "Clear filters")}</Button>}</div>}
    </div>
  </>;
}

export function OperationExplorer({ operation }: { operation: Operation | OperationSummary }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || "movements" in operation) return;
    let disposed = false;
    api.operation(operation.id).then(value => { if (!disposed) { setDetails(value); setError(""); } }).catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; };
  }, [open, operation, retry]);
  const current = "movements" in operation ? operation : details?.id === operation.id ? details : null;
  return <Dialog open={open} onOpenChange={value => { if (value && !("movements" in operation)) { setDetails(null); setError(""); } setOpen(value); }}>
    <DialogTrigger asChild><Button className="summary-explore" variant="outline" size="sm">{t("Explorar arquivos", "Explore files")}</Button></DialogTrigger>
    <DialogContent className="operation-explorer">
      <DialogHeader><DialogTitle>{t("Arquivos da operação", "Files in operation")} #{operation.id}</DialogTitle><DialogDescription>{t("Consulte as movimentações registradas. Use o filtro para localizar problemas e Home ou End na lista para ir ao início ou ao final.", "See the recorded moves. Use the filter to find problems, and Home or End in the list to jump to the start or end.")}</DialogDescription></DialogHeader>
      {open && <>{error && <p className="inline-error" role="alert">{t("Não foi possível consultar os arquivos.", "Could not look up the files.")} <Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t("Tentar novamente", "Try again")}</Button></p>}{current ? <MovementList movements={current.movements} /> : !error && <p role="status">{t("Carregando arquivos da operação…", "Loading the operation's files…")}</p>}</>}
    </DialogContent>
  </Dialog>;
}

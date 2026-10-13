import { ChevronDown, ChevronRight, CircleCheck, History, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeedbackMotion, useMotionAllowed } from "@/components/motion/feedback";
import { Collapse } from "@/components/motion/collapse";
import { useContentMotion } from "@/components/motion/transitions";
import { date, type Movement, type Operation } from "@/lib/api";
import { useMemo } from "react";
import { movementProblem, OperationExplorer } from "@/components/operation-explorer";

function movementCounts(movements: Movement[]) {
  let moved = 0, undone = 0, errors = 0;
  for (const movement of movements) {
    if (movement.status === "moved") moved++;
    if (movement.status === "undone") undone++;
    if (movementProblem(movement)) errors++;
  }
  return { moved, undone, errors };
}

function OperationSummary({ operation }: { operation: Operation }) {
  const summary = useMemo(() => {
    const folders = new Map<string, number>();
    for (const movement of operation.movements) {
      const separator = Math.max(movement.destination.lastIndexOf("/"), movement.destination.lastIndexOf("\\"));
      if (separator < 0) continue;
      const folder = movement.destination.slice(0, separator + 1);
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
    const destinations = [...folders].sort((a, b) => b[1] - a[1]);
    return { ...movementCounts(operation.movements), destinations };
  }, [operation.movements]);
  const remaining = summary.destinations.slice(5);
  return <div className="operation-summary">
    <dl className="operation-totals"><div><dt>Arquivos envolvidos</dt><dd>{operation.movements.length}</dd></div><div><dt>Organizados no destino</dt><dd>{summary.moved}</dd></div><div><dt>Restaurados</dt><dd>{summary.undone}</dd></div><div><dt>Falhas ou verificação</dt><dd>{summary.errors}</dd></div></dl>
    <p className="summary-meta">{operation.kind === "automatic" ? "Automação" : operation.kind === "manual" ? "Organização manual" : operation.kind} · {date(operation.created * 1000)}</p>
    {summary.destinations.length > 0 && <div className="destination-summary"><strong>Pastas de destino registradas</strong><dl>{summary.destinations.slice(0, 5).map(([folder, count]) => <div key={folder}><dt>{folder}</dt><dd>{count} arquivo(s)</dd></div>)}</dl>{remaining.length > 0 && <p>{remaining.length} outras pastas · {remaining.reduce((count, [, value]) => count + value, 0)} arquivo(s). Consulte os caminhos no explorador.</p>}</div>}
    <OperationExplorer operation={operation} />
  </div>;
}

export function Activity({ operation, onOpen, expanded, motionAllowed = false }: { operation: Operation; onOpen: () => void; expanded?: boolean; motionAllowed?: boolean }) {
  const { moved, undone, errors } = useMemo(() => movementCounts(operation.movements), [operation.movements]);
  const mark = useFeedbackMotion<SVGSVGElement>(`${operation.id}:${moved}:${undone}:${errors}`, motionAllowed && errors === 0);
  return <button className="activity" onClick={onOpen} aria-expanded={expanded} aria-controls={expanded === undefined ? undefined : "movements-" + operation.id}>
    <span className={"activity-icon " + (errors ? "warning" : "")}>
      {undone ? <Undo2 ref={mark} size={16} aria-hidden="true" /> : <CircleCheck ref={mark} size={16} aria-hidden="true" />}
    </span>
    <span className="activity-copy">
      <strong>{undone ? undone + " arquivo" + (undone !== 1 ? "s restaurados" : " restaurado") : moved + " arquivo" + (moved !== 1 ? "s organizados" : " organizado")}</strong>
      <small><span className="operation-id">#{operation.id}</span>{operation.kind === "automatic" ? "Automação" : "Organização manual"}<span>·</span><time dateTime={new Date(operation.created * 1000).toISOString()}>{date(operation.created * 1000)}</time>{undone > 0 && moved > 0 && <span>· {moved} ainda no destino</span>}</small>
    </span>
    {errors > 0 && <span className="status status-conflict">{errors} ocorrência(s)</span>}
    {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
  </button>;
}

export function HistoryView({ history, expanded, working, onExpand, onUndo }: {
  history: Operation[]; expanded: number | null; working: boolean;
  onExpand: (id: number | null) => void; onUndo: (operation: Operation) => void;
}) {
  const motionAllowed = useMotionAllowed();
  const ref = useContentMotion(history.slice(0, 4).map(op => op.id).join(":"), motionAllowed);
  if (!history.length) return <div ref={ref} data-motion-group className="empty" role="status"><History size={24} aria-hidden="true" /><h2>Nenhuma operação registrada</h2><p>Após organizar arquivos, consulte aqui os resultados e as opções de desfazer.</p></div>;
  return <div ref={ref} data-motion-group className="history-list" aria-label="Operações registradas">{history.map(op => <section className="history-operation" key={op.id} aria-label={"Operação " + op.id}>
    <div className="history-header"><Activity operation={op} motionAllowed={motionAllowed} expanded={expanded === op.id} onOpen={() => onExpand(expanded === op.id ? null : op.id)} />
      <Button variant="outline" size="sm" disabled={working || !op.movements.some(m => m.status === "moved")} onClick={() => onUndo(op)}><Undo2 aria-hidden="true" />Desfazer</Button>
    </div>
    <Collapse open={expanded === op.id} className="movement-list" id={"movements-" + op.id}>{expanded === op.id ? <OperationSummary operation={op} /> : null}</Collapse>
  </section>)}</div>;
}

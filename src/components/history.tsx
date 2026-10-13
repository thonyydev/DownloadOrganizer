import { ChevronDown, ChevronRight, CircleCheck, History, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeedbackMotion, useMotionAllowed } from "@/components/motion/feedback";
import { Collapse } from "@/components/motion/collapse";
import { useContentMotion } from "@/components/motion/transitions";
import { basename, date, labels, type Operation } from "@/lib/api";

export function Activity({ operation, onOpen, expanded, motionAllowed = false }: { operation: Operation; onOpen: () => void; expanded?: boolean; motionAllowed?: boolean }) {
  const moved = operation.movements.filter(m => m.status === "moved").length;
  const undone = operation.movements.filter(m => m.status === "undone").length;
  const errors = operation.movements.filter(m => m.error || ["failed", "uncertain", "pending", "undo_pending"].includes(m.status)).length;
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
    <Collapse open={expanded === op.id} className="movement-list" id={"movements-" + op.id}>{expanded === op.id ? op.movements.map(m => <div className="movement" key={m.id}>
      <div><strong>{basename(m.source)}</strong><dl className="movement-paths"><dt>Origem</dt><dd>{m.source}</dd><dt>Destino</dt><dd>{m.destination}</dd></dl>{m.error && <p className="inline-error">{m.error}</p>}</div>
      <span className={"status status-" + m.status}>{labels[m.status] ?? m.status}</span>
    </div>) : null}</Collapse>
  </section>)}</div>;
}

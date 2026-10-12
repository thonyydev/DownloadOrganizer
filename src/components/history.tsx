import { ChevronDown, ChevronRight, CircleCheck, History, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { basename, date, labels, type Operation } from "@/lib/api";

export function Activity({ operation, onOpen, expanded }: { operation: Operation; onOpen: () => void; expanded?: boolean }) {
  const moved = operation.movements.filter(m => m.status === "moved").length;
  const undone = operation.movements.filter(m => m.status === "undone").length;
  const errors = operation.movements.filter(m => m.error || ["failed", "uncertain", "pending", "undo_pending"].includes(m.status)).length;
  return <button className="activity" onClick={onOpen} aria-expanded={expanded} aria-controls={expanded === undefined ? undefined : "movements-" + operation.id}>
    <span className={"activity-icon " + (errors ? "warning" : "")}>
      {undone ? <Undo2 size={16} aria-hidden="true" /> : <CircleCheck size={16} aria-hidden="true" />}
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
  if (!history.length) return <div className="empty" role="status"><History size={24} aria-hidden="true" /><h2>Nenhuma operação registrada</h2><p>Após organizar arquivos, consulte aqui os resultados e as opções de desfazer.</p></div>;
  return <div className="history-list" aria-label="Operações registradas">{history.map(op => <section className="history-operation" key={op.id} aria-label={"Operação " + op.id}>
    <div className="history-header"><Activity operation={op} expanded={expanded === op.id} onOpen={() => onExpand(expanded === op.id ? null : op.id)} />
      <Button variant="outline" size="sm" disabled={working || !op.movements.some(m => m.status === "moved")} onClick={() => onUndo(op)}><Undo2 aria-hidden="true" />Desfazer</Button>
    </div>
    {expanded === op.id && <div className="movement-list" id={"movements-" + op.id}>{op.movements.map(m => <div className="movement" key={m.id}>
      <div><strong>{basename(m.source)}</strong><dl className="movement-paths"><dt>Origem</dt><dd>{m.source}</dd><dt>Destino</dt><dd>{m.destination}</dd></dl>{m.error && <p className="inline-error">{m.error}</p>}</div>
      <span className={"status status-" + m.status}>{labels[m.status] ?? m.status}</span>
    </div>)}</div>}
  </section>)}</div>;
}

import { CircleCheck, Loader2, ShieldCheck } from "lucide-react";
import { summarizeOperation, type Operation, type OperationSummary } from "@/lib/api";
import type { Action } from "@/lib/experience";
import { useFeedbackMotion, useMotionAllowed } from "@/components/motion/feedback";
import { useContentMotion } from "@/components/motion/transitions";
import { plural } from "@/lib/utils";

export function OperationFeedback({ action, operation }: { action: Action | null; operation?: Operation | OperationSummary }) {
  const allowed = useMotionAllowed();
  const active = action?.phase === "preparing" || action?.phase === "organizing";
  const summary = operation ? summarizeOperation(operation) : null;
  const restored = summary?.undone ?? 0;
  const moved = summary?.moved ?? 0;
  const errors = summary?.errors ?? 0;
  const mark = useFeedbackMotion<SVGSVGElement>(`${action?.kind}:${action?.phase}:${action?.operationId}:${errors}`, allowed && action?.phase === "completed" && errors === 0);
  const panel = useContentMotion(`${action?.kind}:${action?.phase}`, allowed && action?.phase !== "error" && errors === 0);
  if (!action || (active && (action.kind === "refresh" || action.showLoading === false))) return null;
  // Generating a preview moves nothing: a "concluído" panel here would read as if files had already moved.
  if (action.kind === "preview" && action.phase === "completed") return null;
  const heading = action.phase === "preparing" ? action.kind === "save" ? "Salvando configurações…" : action.kind === "refresh" ? "Verificando o estado atual…" : action.kind === "monitor" ? "Verificando o monitoramento…" : "Preparando e verificando arquivos…"
    : action.phase === "organizing" ? action.kind === "undo" ? "Restaurando arquivos…" : "Organizando arquivos…"
    : action.phase === "error" ? "A operação encontrou um erro"
    : errors ? "Processamento concluído com ocorrências" : "Processamento concluído";
  return <div ref={panel} className={`progress-panel ${action.phase === "error" || errors ? "feedback-warning" : ""}`} role={active ? undefined : action.phase === "error" ? "alert" : "status"} aria-live={active ? undefined : action.phase === "error" ? "assertive" : "polite"} aria-atomic={active ? undefined : true}>
    {active ? <Loader2 className="spin" size={16} aria-hidden="true" /> : action.phase === "error" || errors ? <ShieldCheck size={16} aria-hidden="true" /> : <CircleCheck ref={mark} size={16} aria-hidden="true" />}
    <div><strong role={active ? "status" : undefined} aria-atomic={active ? true : undefined}>{heading}</strong>{action.error && <p>{action.error}</p>}{active && <p>{action.phase === "preparing" ? "Aguarde a validação dos caminhos e dos arquivos." : action.kind === "undo" ? "Restaurando os arquivos verificados à origem." : "Organizando os arquivos verificados nos destinos."}</p>}
      {active && action.progress && action.progress.total > 0 && <><p>{action.progress.completed} de {action.progress.total} arquivos processados · {Math.floor(action.progress.completed / action.progress.total * 100)}%</p><progress aria-label="Progresso da operação" value={action.progress.completed} max={action.progress.total} /></>}
      {active && (action.kind === "organize" || action.kind === "undo") && <p>As verificações podem demorar em arquivos grandes. Evite fechar o aplicativo.</p>}
      {!active && operation && <p>{action.kind === "undo" ? `${plural(restored, "restaurado", "restaurados")} · ${moved} ainda no destino` : plural(moved, "organizado", "organizados")} · {plural(errors, "ocorrência", "ocorrências")}. Confira os resultados individuais no histórico.</p>}
      {action.phase === "completed" && !operation && action.operationId !== undefined && <p>O resultado individual ainda não foi carregado. Atualize o histórico para conferi-lo.</p>}
    </div>
  </div>;
}

import { CircleCheck, Loader2, ShieldCheck } from "lucide-react";
import type { Operation } from "@/lib/api";
import type { Action } from "@/lib/experience";
import { useFeedbackMotion, useMotionAllowed } from "@/components/motion/feedback";
import { useContentMotion } from "@/components/motion/transitions";

export function OperationFeedback({ action, operation }: { action: Action | null; operation?: Operation }) {
  const allowed = useMotionAllowed();
  const active = action?.phase === "preparing" || action?.phase === "organizing";
  const restored = operation?.movements.filter(m => m.status === "undone").length ?? 0;
  const moved = operation?.movements.filter(m => m.status === "moved").length ?? 0;
  const errors = operation?.movements.filter(m => m.error || ["failed", "uncertain", "pending", "undo_pending"].includes(m.status)).length ?? 0;
  const mark = useFeedbackMotion<SVGSVGElement>(`${action?.kind}:${action?.phase}:${action?.operationId}:${errors}`, allowed && action?.phase === "completed" && errors === 0);
  const panel = useContentMotion(`${action?.kind}:${action?.phase}`, allowed && action?.phase !== "error" && errors === 0);
  if (!action || (active && (action.kind === "refresh" || action.showLoading === false))) return null;
  const heading = action.phase === "preparing" ? action.kind === "save" ? "Salvando configurações…" : action.kind === "refresh" ? "Verificando o estado atual…" : action.kind === "monitor" ? "Verificando o monitoramento…" : "Preparando e verificando arquivos…"
    : action.phase === "organizing" ? action.kind === "undo" ? "Restaurando arquivos…" : "Organizando arquivos…"
    : action.phase === "error" ? "A operação encontrou um erro"
    : errors ? "Processamento concluído com ocorrências" : "Processamento concluído";
  return <div ref={panel} className={`progress-panel ${action.phase === "error" || errors ? "feedback-warning" : ""}`} role={active ? undefined : action.phase === "error" ? "alert" : "status"} aria-live={active ? undefined : action.phase === "error" ? "assertive" : "polite"} aria-atomic={active ? undefined : true}>
    {active ? <Loader2 className="spin" size={18} aria-hidden="true" /> : action.phase === "error" || errors ? <ShieldCheck size={18} aria-hidden="true" /> : <CircleCheck ref={mark} size={18} aria-hidden="true" />}
    <div><strong role={active ? "status" : undefined} aria-atomic={active ? true : undefined}>{heading}</strong>{action.error && <p>{action.error}</p>}{active && <p>{action.phase === "preparing" ? "Aguarde a validação dos caminhos e dos arquivos." : action.kind === "undo" ? "Restaurando os arquivos verificados à origem." : "Organizando os arquivos verificados nos destinos."}</p>}
      {active && action.progress && action.progress.total > 0 && <><p>{action.progress.completed} de {action.progress.total} arquivos processados · {Math.floor(action.progress.completed / action.progress.total * 100)}%</p><progress aria-label="Progresso da operação" value={action.progress.completed} max={action.progress.total} /></>}
      {active && (action.kind === "organize" || action.kind === "undo") && <p>As verificações podem demorar em arquivos grandes. Evite fechar o aplicativo.</p>}
      {!active && operation && <p>{action.kind === "undo" ? `${restored} restaurado(s) · ${moved} ainda no destino` : `${moved} organizado(s)`} · {errors} ocorrência(s). Confira os resultados individuais no histórico.</p>}
      {action.phase === "completed" && !operation && action.operationId !== undefined && <p>O resultado individual ainda não foi carregado. Atualize o histórico para conferi-lo.</p>}
    </div>
  </div>;
}

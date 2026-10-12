import { CircleCheck, Loader2, ShieldCheck } from "lucide-react";
import type { Operation } from "@/lib/api";
import type { Action } from "@/lib/experience";

export function OperationFeedback({ action, operation }: { action: Action | null; operation?: Operation }) {
  if (!action) return null;
  const active = action.phase === "preparing" || action.phase === "organizing";
  const restored = operation?.movements.filter(m => m.status === "undone").length ?? 0;
  const moved = operation?.movements.filter(m => m.status === "moved").length ?? 0;
  const errors = operation?.movements.filter(m => m.error || ["failed", "uncertain", "pending", "undo_pending"].includes(m.status)).length ?? 0;
  const heading = action.phase === "preparing" ? action.kind === "save" ? "Salvando configurações…" : action.kind === "refresh" ? "Verificando o estado atual…" : action.kind === "monitor" ? "Verificando o monitoramento…" : "Preparando e verificando arquivos…"
    : action.phase === "organizing" ? action.kind === "undo" ? "Restaurando arquivos…" : "Organizando arquivos…"
    : action.phase === "error" ? "A operação encontrou um erro"
    : errors ? "Processamento concluído com ocorrências" : "Processamento concluído";
  return <div className={`progress-panel ${action.phase === "error" || errors ? "feedback-warning" : ""}`} role={action.phase === "error" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
    {active ? <Loader2 className="spin" size={18} aria-hidden="true" /> : action.phase === "error" || errors ? <ShieldCheck size={18} aria-hidden="true" /> : <CircleCheck size={18} aria-hidden="true" />}
    <div><strong>{heading}</strong>{action.error && <p>{action.error}</p>}{active && <p>{action.progress?.name || "Aguarde a validação dos caminhos e dos arquivos."}</p>}
      {active && action.progress && action.progress.total > 0 && <><p>{action.progress.completed} de {action.progress.total} arquivos processados</p><progress aria-label="Progresso da operação" value={action.progress.completed} max={action.progress.total} /></>}
      {active && (action.kind === "organize" || action.kind === "undo") && <p>As verificações podem demorar em arquivos grandes. Evite fechar o aplicativo.</p>}
      {!active && operation && <p>{action.kind === "undo" ? `${restored} restaurado(s) · ${moved} ainda no destino` : `${moved} organizado(s)`} · {errors} ocorrência(s). Confira os resultados individuais no histórico.</p>}
      {action.phase === "completed" && !operation && action.operationId !== undefined && <p>O resultado individual ainda não foi carregado. Atualize o histórico para conferi-lo.</p>}
    </div>
  </div>;
}

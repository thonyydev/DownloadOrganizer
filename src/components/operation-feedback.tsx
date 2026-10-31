import { CircleCheck, Loader2, ShieldCheck } from "lucide-react";
import { summarizeOperation, type Operation, type OperationSummary } from "@/lib/api";
import type { Action } from "@/lib/experience";
import { useFeedbackMotion, useMotionAllowed } from "@/components/motion/feedback";
import { useContentMotion } from "@/components/motion/transitions";
import { plural } from "@/lib/utils";
import { t } from "@/lib/i18n";

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
  const heading = action.phase === "preparing" ? action.kind === "save" ? t("Salvando configurações…", "Saving settings…") : action.kind === "refresh" ? t("Verificando o estado atual…", "Checking the current state…") : action.kind === "monitor" ? t("Verificando o monitoramento…", "Checking monitoring…") : t("Preparando e verificando arquivos…", "Preparing and checking files…")
    : action.phase === "organizing" ? action.kind === "undo" ? t("Restaurando arquivos…", "Restoring files…") : t("Organizando arquivos…", "Organizing files…")
    : action.phase === "error" ? t("A operação encontrou um erro", "The operation hit an error")
    : errors ? t("Processamento concluído com ocorrências", "Finished with issues") : t("Processamento concluído", "Finished");
  return <div ref={panel} className={`progress-panel ${action.phase === "error" || errors ? "feedback-warning" : ""}`} role={active ? undefined : action.phase === "error" ? "alert" : "status"} aria-live={active ? undefined : action.phase === "error" ? "assertive" : "polite"} aria-atomic={active ? undefined : true}>
    {active ? <Loader2 className="spin" size={16} aria-hidden="true" /> : action.phase === "error" || errors ? <ShieldCheck size={16} aria-hidden="true" /> : <CircleCheck ref={mark} size={16} aria-hidden="true" />}
    <div><strong role={active ? "status" : undefined} aria-atomic={active ? true : undefined}>{heading}</strong>{action.error && <p>{action.error}</p>}{active && <p>{action.phase === "preparing" ? t("Aguarde a validação dos caminhos e dos arquivos.", "Wait while paths and files are validated.") : action.kind === "undo" ? t("Restaurando os arquivos verificados à origem.", "Restoring the checked files to the source.") : t("Organizando os arquivos verificados nos destinos.", "Moving the checked files to their destinations.")}</p>}
      {active && action.progress && action.progress.total > 0 && <><p>{action.progress.completed} {t("de", "of")} {action.progress.total} {t("arquivos processados", "files processed")} · {Math.floor(action.progress.completed / action.progress.total * 100)}%</p><progress aria-label={t("Progresso da operação", "Operation progress")} value={action.progress.completed} max={action.progress.total} /></>}
      {active && (action.kind === "organize" || action.kind === "undo") && <p>{t("As verificações podem demorar em arquivos grandes. Evite fechar o aplicativo.", "Checks can take a while on large files. Avoid closing the app.")}</p>}
      {!active && operation && <p>{action.kind === "undo" ? `${plural(restored, t("restaurado", "restored"), t("restaurados", "restored"))} · ${moved} ${t("ainda no destino", "still at the destination")}` : plural(moved, t("organizado", "organized"), t("organizados", "organized"))} · {plural(errors, t("ocorrência", "issue"), t("ocorrências", "issues"))}. {t("Confira os resultados individuais no histórico.", "See each result in the history.")}</p>}
      {action.phase === "completed" && !operation && action.operationId !== undefined && <p>{t("O resultado individual ainda não foi carregado. Atualize o histórico para conferi-lo.", "Each result hasn't loaded yet. Refresh the history to check it.")}</p>}
    </div>
  </div>;
}

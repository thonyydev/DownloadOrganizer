import { FolderDown, Loader2, Undo2 } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileTable } from "@/components/file-table";
import { OperationFeedback } from "@/components/operation-feedback";
import { UndoFileList } from "@/components/undo-file-list";
import { TriageLegend } from "@/components/triage";
import { plural } from "@/lib/utils";
import type { Category, Operation, OperationSummary, Preview } from "@/lib/api";
import type { Action } from "@/lib/experience";

export function OperationDialogs({ preview, undoTarget, categories, action, busy, working, issue, reviewed, operation, onReviewed, onUpdate, onOrganize, onUndo, onClose, onViewResult, onRestoreFocus }: {
  preview: Preview | null; undoTarget: Operation | null; categories: Category[]; action: Action | null; busy: boolean; working: boolean;
  issue: string; reviewed: boolean; operation?: Operation | OperationSummary;
  onReviewed: (value: boolean) => void; onUpdate: () => void; onOrganize: () => void; onUndo: () => void; onClose: () => void; onViewResult: () => void;
  onRestoreFocus: () => void;
}) {
  const counts = useMemo(() => {
    const result = { ready: 0, conflict: 0, ignored: 0 };
    for (const file of preview?.files ?? []) result[file.status]++;
    return result;
  }, [preview?.files]);
  const ready = counts.ready;
  const previewAction = action?.kind === "organize" || action?.kind === "preview" ? action : null;
  const undoAction = action?.kind === "undo" ? action : null;
  const undoable = operation && "movements" in operation ? operation : undoTarget;
  const reversible = useMemo(() => undoable?.movements.filter(m => m.status === "moved") ?? [], [undoable?.movements]);
  const done = (value: Action | null) => value?.phase === "completed" && value.kind !== "preview";
  const close = (open: boolean) => { if (!open && !busy) onClose(); };
  const footer = <><Button variant="outline" onClick={onClose}>Fechar</Button><Button onClick={onViewResult}>Ver resultado no histórico</Button></>;
  return <>
    <Dialog open={!!preview} onOpenChange={close}>
      <DialogContent className="preview-dialog" showCloseButton={!busy} onCloseAutoFocus={e => { e.preventDefault(); onRestoreFocus(); }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>{done(previewAction) ? "Resultado da organização" : "Confira antes de organizar"}</DialogTitle><DialogDescription>Somente arquivos prontos serão movidos. Nenhum conflito será sobrescrito. A prévia expira em cinco minutos.</DialogDescription></DialogHeader>
        <OperationFeedback action={previewAction} operation={done(previewAction) || previewAction?.phase === "error" ? operation : undefined} />
        {!done(previewAction) && <>
          {issue && <p className="inline-error" role="alert">{issue}</p>}
          <TriageLegend counts={counts} />
          <div className="preview-files"><FileTable files={preview?.files ?? []} categories={categories} preview /></div>
          <label className="review-confirmation"><input type="checkbox" checked={reviewed} disabled={working || !!issue} onChange={e => onReviewed(e.target.checked)} />Conferi os arquivos e destinos desta prévia</label>
        </>}
        <DialogFooter>{done(previewAction) ? footer : <>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
          {previewAction?.phase === "error" && operation && <Button variant="outline" onClick={onViewResult}>Ver resultado no histórico</Button>}
          <Button variant="outline" disabled={working} onClick={onUpdate}>Atualizar prévia</Button>
          <Button disabled={working || !ready || !reviewed || !!issue} onClick={onOrganize}>{busy ? <Loader2 className="spin" aria-hidden="true" /> : <FolderDown aria-hidden="true" />}{busy ? "Aguarde a operação…" : "Confirmar organização"}</Button>
        </>}</DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!undoTarget} onOpenChange={close}>
      <DialogContent className="undo-dialog" showCloseButton={!busy} onCloseAutoFocus={e => { e.preventDefault(); onRestoreFocus(); }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>{done(undoAction) ? "Resultado da restauração" : "Restaurar os arquivos à origem?"}</DialogTitle><DialogDescription>Arquivos alterados, ausentes ou com conflitos serão preservados. O resultado individual ficará no histórico.</DialogDescription></DialogHeader>
        <OperationFeedback action={undoAction} operation={done(undoAction) || undoAction?.phase === "error" ? operation : undefined} />
        {!done(undoAction) && <><p className="undo-summary">Operação #{undoable?.id} · {reversible.length} de {plural(undoable?.movements.length ?? 0, "arquivo", "arquivos")} para restaurar</p><UndoFileList key={undoable?.id} movements={reversible} /></>}
        <DialogFooter>{done(undoAction) ? footer : <><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>{undoAction?.phase === "error" && operation && <Button variant="outline" onClick={onViewResult}>Ver resultado no histórico</Button>}<Button disabled={working || !reversible.length} onClick={onUndo}>{busy ? <Loader2 className="spin" aria-hidden="true" /> : <Undo2 aria-hidden="true" />}{busy ? "Restaurando…" : "Confirmar restauração"}</Button></>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

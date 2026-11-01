import { FolderDown, Loader2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileTable } from "@/components/file-table";
import { OperationFeedback } from "@/components/operation-feedback";
import { UndoFileList } from "@/components/undo-file-list";
import { TriageLegend } from "@/components/triage";
import { plural } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Category, Operation, OperationSummary, Preview } from "@/lib/api";
import type { Action } from "@/lib/experience";

interface Selection { id: number | null; excluded: Set<string>; rename: boolean }
const noneExcluded = new Set<string>();

export function OperationDialogs({ preview, undoTarget, categories, action, busy, working, issue, reviewed, operation, onReviewed, onUpdate, onOrganize, onUndo, onClose, onViewResult, onRestoreFocus }: {
  preview: Preview | null; undoTarget: Operation | null; categories: Category[]; action: Action | null; busy: boolean; working: boolean;
  issue: string; reviewed: boolean; operation?: Operation | OperationSummary;
  onReviewed: (value: boolean) => void; onUpdate: () => void; onOrganize: (excluded: string[], renameConflicts: boolean, count: number) => void; onUndo: () => void; onClose: () => void; onViewResult: () => void;
  onRestoreFocus: () => void;
}) {
  // Tied to the preview's id, so a refreshed preview starts with everything selected again.
  const [choice, setChoice] = useState<Selection>(() => ({ id: null, excluded: new Set(), rename: false }));
  const selection = choice.id === (preview?.id ?? null) ? choice : { id: preview?.id ?? null, excluded: noneExcluded, rename: false };
  const files = useMemo(() => (preview?.files ?? []).map(file => selection.rename && file.status === "conflict" && file.rename_to ? { ...file, destination: file.rename_to, status: "ready" as const, reason: t("Será renomeado; o arquivo existente será preservado", "Will be renamed; the existing file will be kept") } : file), [preview?.files, selection.rename]);
  const counts = useMemo(() => {
    const result = { ready: 0, conflict: 0, ignored: 0 };
    for (const file of files) result[file.status]++;
    return result;
  }, [files]);
  const selected = useMemo(() => files.reduce((count, file) => count + Number(file.status === "ready" && !selection.excluded.has(file.path)), 0), [files, selection.excluded]);
  const hasConflicts = (preview?.files ?? []).some(file => file.status === "conflict" && file.rename_to);
  function toggleFile(path: string) {
    const excluded = new Set(selection.excluded);
    if (!excluded.delete(path)) excluded.add(path);
    setChoice({ ...selection, excluded });
  }
  function toggleAll(all: boolean) {
    setChoice({ ...selection, excluded: all ? noneExcluded : new Set(files.filter(file => file.status === "ready").map(file => file.path)) });
  }
  const previewAction = action?.kind === "organize" || action?.kind === "preview" ? action : null;
  const undoAction = action?.kind === "undo" ? action : null;
  const undoable = operation && "movements" in operation ? operation : undoTarget;
  const reversible = useMemo(() => undoable?.movements.filter(m => m.status === "moved") ?? [], [undoable?.movements]);
  const done = (value: Action | null) => value?.phase === "completed" && value.kind !== "preview";
  const close = (open: boolean) => { if (!open && !busy) onClose(); };
  const footer = <><Button variant="outline" onClick={onClose}>{t("Fechar", "Close")}</Button><Button onClick={onViewResult}>{t("Ver resultado no histórico", "View result in history")}</Button></>;
  return <>
    <Dialog open={!!preview} onOpenChange={close}>
      <DialogContent className="preview-dialog" showCloseButton={!busy} onCloseAutoFocus={e => { e.preventDefault(); onRestoreFocus(); }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>{done(previewAction) ? t("Resultado da organização", "Organization result") : t("Confira antes de organizar", "Review before organizing")}</DialogTitle><DialogDescription>{t("Somente arquivos prontos serão movidos. Nenhum conflito será sobrescrito. A prévia expira em cinco minutos.", "Only ready files will be moved. No conflict will be overwritten. The preview expires in five minutes.")}</DialogDescription></DialogHeader>
        <OperationFeedback action={previewAction} operation={done(previewAction) || previewAction?.phase === "error" ? operation : undefined} />
        {!done(previewAction) && <>
          {issue && <p className="inline-error" role="alert">{issue}</p>}
          <TriageLegend counts={counts} />
          <div className="preview-files"><FileTable files={files} categories={categories} preview selection={{ excluded: selection.excluded, selected, ready: counts.ready, disabled: working, onToggle: toggleFile, onToggleAll: toggleAll }} /></div>
          <p className="preview-selection" role="status">{selected} {t("de", "of")} {counts.ready} {t("selecionados", "selected")}</p>
          {hasConflicts && <label className="review-confirmation"><input type="checkbox" checked={selection.rename} disabled={working || !!issue} onChange={event => setChoice({ ...selection, rename: event.target.checked })} />{t("Renomear arquivos em conflito", "Rename conflicting files")}</label>}
          <label className="review-confirmation"><input type="checkbox" checked={reviewed} disabled={working || !!issue} onChange={e => onReviewed(e.target.checked)} />{t("Conferi os arquivos e destinos desta prévia", "I reviewed the files and destinations in this preview")}</label>
        </>}
        <DialogFooter>{done(previewAction) ? footer : <>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t("Cancelar", "Cancel")}</Button>
          {previewAction?.phase === "error" && operation && <Button variant="outline" onClick={onViewResult}>{t("Ver resultado no histórico", "View result in history")}</Button>}
          <Button variant="outline" disabled={working} onClick={onUpdate}>{t("Atualizar prévia", "Refresh preview")}</Button>
          <Button disabled={working || !selected || !reviewed || !!issue} onClick={() => onOrganize([...selection.excluded], selection.rename, selected)}>{busy ? <Loader2 className="spin" aria-hidden="true" /> : <FolderDown aria-hidden="true" />}{busy ? t("Aguarde a operação…", "Wait for the operation…") : t("Confirmar organização", "Confirm organization")}</Button>
        </>}</DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!undoTarget} onOpenChange={close}>
      <DialogContent className="undo-dialog" showCloseButton={!busy} onCloseAutoFocus={e => { e.preventDefault(); onRestoreFocus(); }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>{done(undoAction) ? t("Resultado da restauração", "Restore result") : t("Restaurar os arquivos à origem?", "Restore the files to the source?")}</DialogTitle><DialogDescription>{t("Arquivos alterados, ausentes ou com conflitos serão preservados. O resultado individual ficará no histórico.", "Files that changed, are missing or have conflicts will be preserved. Each result will be in the history.")}</DialogDescription></DialogHeader>
        <OperationFeedback action={undoAction} operation={done(undoAction) || undoAction?.phase === "error" ? operation : undefined} />
        {!done(undoAction) && <><p className="undo-summary">{t("Operação", "Operation")} #{undoable?.id} · {reversible.length} {t("de", "of")} {plural(undoable?.movements.length ?? 0, t("arquivo", "file"), t("arquivos", "files"))} {t("para restaurar", "to restore")}</p><UndoFileList key={undoable?.id} movements={reversible} /></>}
        <DialogFooter>{done(undoAction) ? footer : <><Button variant="outline" disabled={busy} onClick={onClose}>{t("Cancelar", "Cancel")}</Button>{undoAction?.phase === "error" && operation && <Button variant="outline" onClick={onViewResult}>{t("Ver resultado no histórico", "View result in history")}</Button>}<Button disabled={working || !reversible.length} onClick={onUndo}>{busy ? <Loader2 className="spin" aria-hidden="true" /> : <Undo2 aria-hidden="true" />}{busy ? t("Restaurando…", "Restoring…") : t("Confirmar restauração", "Confirm restore")}</Button></>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

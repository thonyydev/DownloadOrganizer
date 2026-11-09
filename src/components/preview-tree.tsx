import { useMemo, useState } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { displayPath, statusLabel, type FileEntry } from "@/lib/api";
import { plannedFolder } from "@/components/file-table";
import { plural } from "@/lib/utils";
import { t } from "@/lib/i18n";

// The destination as it will look: one folder per group, with the files that will arrive there.
// Files stay in the order they come in, so conflicts still lead each folder.
export function PreviewTree({ files, excluded }: { files: FileEntry[]; excluded: Set<string> }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const { root, groups, stays } = useMemo(() => {
    const byFolder = new Map<string, FileEntry[]>();
    const stays: FileEntry[] = [];
    for (const file of files) {
      if (file.status === "ignored") { stays.push(file); continue; }
      const folder = plannedFolder(file);
      const list = byFolder.get(folder);
      if (list) list.push(file); else byFolder.set(folder, [file]);
    }
    // Every destination is <root>\<folder>\<name>.
    const sample = files.find(file => file.status !== "ignored");
    return { root: sample?.destination.replace(/[\\/][^\\/]+[\\/][^\\/]+$/, "") ?? "", groups: [...byFolder].sort(([a], [b]) => a.localeCompare(b)), stays };
  }, [files]);
  const toggle = (key: string, now: boolean) => setOpen(previous => {
    if (previous.has(key) === now) return previous;
    const next = new Set(previous);
    if (now) next.add(key); else next.delete(key);
    return next;
  });
  const folder = (key: string, label: string, list: FileEntry[]) => {
    const conflicts = list.reduce((count, file) => count + Number(file.status === "conflict"), 0);
    // Closed folders render no rows, so a large preview stays light.
    return <li key={key}><details open={open.has(key)} onToggle={event => toggle(key, event.currentTarget.open)}>
      <summary><ChevronRight size={14} className="preview-tree-chevron" aria-hidden="true" /><Folder size={16} aria-hidden="true" /><strong>{label}</strong><span className="preview-tree-count">{plural(list.length, t("file"), t("files"))}</span>{conflicts > 0 && <span className="status status-conflict">{plural(conflicts, t("conflict"), t("conflicts"))}</span>}</summary>
      {open.has(key) && <ul>{list.map(file => <li key={file.path} className={excluded.has(file.path) ? "excluded" : undefined}>
        <span className="preview-tree-name">{file.name}</span>
        {file.status === "conflict" && <span className="status status-conflict">{statusLabel(file.status)}</span>}
        {excluded.has(file.path) && <small>{t("Not selected")}</small>}
        {file.reason && <small className="reason">{file.reason}</small>}
      </li>)}</ul>}
    </details></li>;
  };
  return <div className="preview-tree">
    {root && <p className="preview-tree-root"><FolderOpen size={16} aria-hidden="true" /><span>{displayPath(root)}</span></p>}
    <ul aria-label={t("Destination folders")}>
      {groups.map(([name, list]) => folder(name, name + "/", list))}
      {stays.length > 0 && folder("", t("Stays where it is"), stays)}
    </ul>
  </div>;
}

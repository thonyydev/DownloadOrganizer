import { useEffect, useMemo, useState } from "react";
import { Search, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileTable } from "@/components/file-table";
import { bytes, native, type Category, type FileEntry } from "@/lib/api";
import { plural } from "@/lib/utils";
import { t } from "@/lib/i18n";

// The page remounts on each visit; the lowercased names are kept for as long as the list is the same.
const lowercased = new WeakMap<FileEntry[], { file: FileEntry; name: string }[]>();

// Filter and search live in the app, so the overview can open a category here.
export function FilesPage({ files, categories, counts, filter, search, onFilter, onSearch, working, onView, onKeep, onTrash, onRestoreFocus }: {
  files: FileEntry[]; categories: Category[]; counts: Map<string, number>; filter: string; search: string;
  onFilter: (filter: string) => void; onSearch: (search: string) => void; working: boolean;
  onView: (file: FileEntry, trigger: HTMLButtonElement) => void; onKeep: (file: FileEntry) => void;
  /** Resolves true once the files were sent, even if some stayed behind. */
  onTrash: (files: FileEntry[]) => Promise<boolean>; onRestoreFocus: () => void;
}) {
  // The order is a habit, so it outlives a restart.
  const [sort, setSort] = useState<"name" | "newest" | "largest">(() => { const saved = localStorage.getItem("download-organizer-sort"); return saved === "newest" || saved === "largest" ? saved : "name"; });
  useEffect(() => { localStorage.setItem("download-organizer-sort", sort); }, [sort]);
  // Files picked for the Recycle Bin; only those still shown are sent.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [trashing, setTrashing] = useState(false);
  const searchable = useMemo(() => {
    let cached = lowercased.get(files);
    if (!cached) lowercased.set(files, cached = files.map(file => ({ file, name: file.name.toLocaleLowerCase() })));
    return cached;
  }, [files]);
  const query = search.toLocaleLowerCase();
  const visible = useMemo(() => {
    const matching = filter === "all" && !query ? files : searchable.filter(({ file, name }) => (filter === "all" || file.category === filter || "status:" + file.status === filter) && name.includes(query)).map(({ file }) => file);
    // The backend lists by name; the other orders sort a copy.
    return sort === "name" ? matching : [...matching].sort(sort === "newest" ? (a, b) => b.modified - a.modified : (a, b) => b.size - a.size);
  }, [files, searchable, filter, query, sort]);
  const targets = useMemo(() => visible.filter(file => picked.has(file.path)), [visible, picked]);
  const conflicts = useMemo(() => files.reduce((count, file) => count + Number(file.status === "conflict"), 0), [files]);
  async function trash() {
    setTrashing(false);
    if (await onTrash(targets)) setPicked(new Set());
  }

  return <section className="files-view">
    <div className="file-toolbar" data-motion-group>
      <label className="search-field"><span className="sr-only">{t("Search files")}</span><span className="search-input"><Search size={16} aria-hidden="true" /><Input value={search} onChange={e => onSearch(e.target.value)} onKeyDown={e => { if (e.key === "Escape" && search) { e.preventDefault(); onSearch(""); } }} placeholder={t("Search by name")} aria-label={t("Search files")} />{search && <button type="button" className="search-clear" aria-label={t("Clear search")} onClick={e => { (e.currentTarget.previousElementSibling as HTMLInputElement).focus(); onSearch(""); }}><X size={14} aria-hidden="true" /></button>}</span></label>
      <label className="filter-select"><span className="sr-only">{t("Filter by category")}</span><select value={filter} onChange={e => onFilter(e.target.value)}><option value="all">{t("All categories")}</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name} ({counts.get(c.id) ?? 0})</option>)}{(conflicts > 0 || filter === "status:conflict") && <optgroup label={t("Status")}><option value="status:conflict">{t("Conflicts")} ({conflicts})</option></optgroup>}</select></label>
      <label className="filter-select"><span className="sr-only">{t("Sort files")}</span><select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="name">{t("Name (A–Z)")}</option><option value="newest">{t("Newest first")}</option><option value="largest">{t("Largest first")}</option></select></label>
      <span className="file-count">{plural(visible.length, t("file"), t("files"))}</span>
      {targets.length > 0 && <Button variant="outline" size="sm" disabled={!native || working} onClick={() => setTrashing(true)}><Trash2 aria-hidden="true" />{t("Move to the Recycle Bin")} ({targets.length})</Button>}
    </div>
    <FileTable onKeep={onKeep} onView={onView} filterKey={filter + ":" + query + ":" + sort} files={visible} categories={categories} filtered={filter !== "all" || !!search} onClearFilters={() => { onFilter("all"); onSearch(""); }}
      picks={{ paths: picked, disabled: working, onToggle: path => setPicked(current => { const next = new Set(current); if (!next.delete(path)) next.add(path); return next; }), onToggleAll: (paths, all) => setPicked(current => { const next = new Set(current); for (const path of paths) { if (all) next.add(path); else next.delete(path); } return next; }) }} />
    <div className="table-footer"><ShieldCheck size={16} aria-hidden="true" />{t("Recent files wait until they stop changing. Refresh to check again.")}</div>
    {/* The button that opened it is gone after a send, so focus goes back like after other operations. */}
    <Dialog open={trashing} onOpenChange={setTrashing}><DialogContent onCloseAutoFocus={e => { e.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader><DialogTitle>{t("Move to the Recycle Bin?")}</DialogTitle><DialogDescription>{plural(targets.length, t("file"), t("files"))}, {bytes(targets.reduce((total, file) => total + file.size, 0))}. {t("You can restore them from the Windows Recycle Bin. This isn't recorded in the history.")}</DialogDescription></DialogHeader>
      <ul className="trash-list">{targets.map(file => <li key={file.path}>{file.name}</li>)}</ul>
      <DialogFooter><Button variant="outline" onClick={() => setTrashing(false)}>{t("Cancel")}</Button><Button variant="destructive" disabled={working || !targets.length} onClick={() => void trash()}><Trash2 aria-hidden="true" />{t("Move to the Recycle Bin")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}

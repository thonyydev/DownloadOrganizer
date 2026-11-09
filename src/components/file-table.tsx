import { Tooltip } from "radix-ui";
import { File, ArrowRight, ChevronRight, Eye, Pin, SearchX } from "lucide-react";
import { basename, displayPath, bytes, date, statusLabel, type Category, type FileEntry } from "@/lib/api";
import { t, useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Fragment, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type Ref } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Collapse } from "@/components/motion/collapse";
import { useContentMotion } from "@/components/motion/transitions";
import { useMotionAllowed } from "@/components/motion/feedback";

// Every destination is <root>\<folder>\<name>; the table header shows the root once.
export function plannedFolder(file: FileEntry) { return file.destination.split(/[\\/]/).slice(-2)[0]; }
function plannedName(file: FileEntry) { return file.destination.split(/[\\/]/).slice(-1)[0]; }
const sourceFolder = (file: FileEntry) => file.path.replace(/[\\/][^\\/]*$/, "");

function FileName({ file, source }: { file: FileEntry; source?: string }) {
  return <><strong>{file.name}</strong>{!file.extension && <small className="file-extension">{t("No extension")}</small>}{source && <small className="file-source"><span className="sr-only">{t("Source")}: </span>{source}</small>}</>;
}

function FileDetails({ file, source, open, onToggle, onKeep }: { file: FileEntry; source?: string; open: boolean; onToggle: () => void; onKeep?: (file: FileEntry) => void }) {
  const interacted = useRef(false);
  const id = useId();
  return <div className="file-name"><button className="file-disclosure" aria-expanded={open} aria-controls={id} onClick={() => { interacted.current = true; onToggle(); }}><ChevronRight size={16} aria-hidden="true" /><span className="sr-only">{t("View path and destination")}</span></button><div className="file-copy"><FileName file={file} source={source} /><Collapse open={open} id={id} className="file-details" animateInitial={interacted.current}><p>{t("Source")}: {displayPath(file.path)}</p><p>{t("Planned destination")}: {displayPath(file.destination)}</p>{onKeep && file.status !== "ignored" && file.name === file.name.trim() && <Button variant="outline" size="sm" onClick={() => onKeep(file)}><Pin aria-hidden="true" />{t("Never organize this file")}</Button>}</Collapse></div></div>;
}

function RowSpace({ height, columns }: { height: number; columns: number }) {
  return height > 0 ? <tr aria-hidden="true" className="virtual-space"><td colSpan={columns} style={{ height }} /></tr> : null;
}

export interface PreviewSelection { excluded: Set<string>; selected: number; ready: number; disabled: boolean; onToggle: (path: string) => void; onToggleAll: (all: boolean) => void }

function FileRow({ file, source, index, preview, fullPaths, category, open, onToggle, onView, onKeep, rowRef, selection }: {
  file: FileEntry; source?: string; index: number; preview: boolean; fullPaths: boolean; category?: string; open: boolean;
  onToggle: (path: string) => void; rowRef?: Ref<HTMLTableRowElement>;
  onView?: (file: FileEntry, trigger: HTMLButtonElement) => void; onKeep?: (file: FileEntry) => void; selection?: PreviewSelection;
}) {
  const language = useLanguage();
  const size = useMemo(() => bytes(file.size), [file.size, language]);
  const modified = useMemo(() => preview ? "" : date(file.modified), [file.modified, preview, language]);
  // A double click opens the preview, like in File Explorer; the eye button stays the keyboard path.
  const openOnDoubleClick = !preview && onView ? (event: MouseEvent<HTMLTableRowElement>) => {
    const trigger = event.currentTarget.querySelector<HTMLButtonElement>(".file-view-button");
    if (trigger && !(event.target as HTMLElement).closest("button, input")) onView(file, trigger);
  } : undefined;
  return <tr data-index={index} data-file-path={file.path} aria-rowindex={index + 2} ref={rowRef} onDoubleClick={openOnDoubleClick}>
    <td>{preview ? <div className="file-name">{selection && file.status === "ready" ? <input type="checkbox" className="preview-check" aria-label={`${t("Organize")} ${file.name}`} checked={!selection.excluded.has(file.path)} disabled={selection.disabled} onChange={() => selection.onToggle(file.path)} /> : <span className="file-icon"><File size={16} aria-hidden="true" /></span>}<div className="file-copy"><FileName file={file} source={source} /></div></div> : <FileDetails file={file} source={source} open={open} onToggle={() => onToggle(file.path)} onKeep={onKeep} />}</td>
    {!preview && <td><span className={"category-label tone-" + file.category}><span className="tone-dot" aria-hidden="true" />{category}</span></td>}
    <td className="tabular number-cell">{size}</td><td>{preview && file.status === "ignored" ? <span className="stays">{t("Stays where it is")}</span> : preview ? <span className="destination" title={displayPath(file.destination)}><ArrowRight size={16} aria-hidden="true" />{fullPaths ? <span>{displayPath(file.destination)}</span> : <><span aria-hidden="true">{plannedFolder(file)}{plannedName(file) !== file.name && <>\{plannedName(file)}</>}</span><span className="sr-only">{displayPath(file.destination)}</span></>}</span> : <span className="tabular">{modified}</span>}</td>
    <td><div className="status-cell"><div><span className={"status status-" + file.status}>{statusLabel(file.status)}</span>{file.reason && <small className="reason">{file.reason}</small>}</div>{!preview && onView && <Tooltip.Root><Tooltip.Trigger asChild><Button variant="ghost" size="icon-xs" className="file-view-button" aria-haspopup="dialog" aria-label={`${t("View")} ${file.name}`} onClick={event => onView(file, event.currentTarget)}><Eye className="size-4" aria-hidden="true" /></Button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="path-tooltip" side="left" sideOffset={6}>{t("View")}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>}</div></td>
  </tr>;
}

export function FileTable({ files, categories, preview = false, fullPaths = false, filtered = false, onClearFilters, filterKey = "all", onView, onKeep, selection }: { files: FileEntry[]; categories: Category[]; preview?: boolean; fullPaths?: boolean; filtered?: boolean; onClearFilters?: () => void; filterKey?: string; onView?: (file: FileEntry, trigger: HTMLButtonElement) => void; onKeep?: (file: FileEntry) => void; selection?: PreviewSelection }) {
  const motionRef = useContentMotion(filterKey + ":" + (files.length ? "results" : "empty"), useMotionAllowed() && !preview);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const helpId = useId();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const pendingControl = useRef(".file-disclosure");
  const focusOwned = useRef(false);
  const previousFilter = useRef(filterKey);
  const toggle = useCallback((path: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; }), []);
  const indexByPath = useMemo(() => new Map(files.map((file, index) => [file.path, index])), [files]);
  // Several source folders can hold files with the same name, so each row then names its folder.
  const sourceLabels = useMemo(() => {
    const folders = [...new Set(files.map(sourceFolder))];
    const names = folders.map(basename);
    // Folders that share a name, such as C:\Downloads and D:\Downloads, show the whole path.
    return folders.length > 1 ? new Map(folders.map((folder, i) => [folder, names.indexOf(names[i]) === names.lastIndexOf(names[i]) ? names[i] : displayPath(folder)])) : null;
  }, [files]);
  const categoryNames = useMemo(() => new Map(categories.map(category => [category.id, category.name])), [categories]);
  const focusedIndex = focusedPath === null ? undefined : indexByPath.get(focusedPath);
  const virtual = files.length > 50;
  const getItemKey = useCallback((index: number) => files[index].path, [files]);
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indexes = defaultRangeExtractor(range);
    if (focusedIndex !== undefined && !indexes.includes(focusedIndex)) indexes.push(focusedIndex);
    return indexes.sort((a, b) => a - b);
  }, [focusedIndex]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 41,
    overscan: 5,
    enabled: virtual,
    paddingStart: headerHeight,
    scrollPaddingStart: headerHeight,
    useAnimationFrameWithResizeObserver: true,
    rangeExtractor,
  });
  const items = virtual ? virtualizer.getVirtualItems() : files.map((file, index) => ({ index, key: file.path, start: 0, end: 0 }));
  const setScrollRef = useCallback((element: HTMLDivElement | null) => { scrollRef.current = element; motionRef.current = element; }, [motionRef]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => setHeaderHeight(header.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [!!files.length]);
  useLayoutEffect(() => {
    if (previousFilter.current !== filterKey) {
      previousFilter.current = filterKey;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [filterKey]);
  useLayoutEffect(() => {
    if (focusedPath && focusedIndex === undefined) {
      pendingFocus.current = null;
      if (focusOwned.current) {
        focusOwned.current = false;
        (scrollRef.current ?? motionRef.current)?.focus({ preventScroll: true });
      }
    }
    if (pendingFocus.current) {
      const index = indexByPath.get(pendingFocus.current);
      const trigger = scrollRef.current?.querySelector<HTMLButtonElement>('tr[data-index="' + index + '"] ' + pendingControl.current);
      if (trigger) { pendingFocus.current = null; trigger.focus({ preventScroll: true }); }
    }
  });

  function navigateRows(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      if (virtual) virtualizer.scrollToIndex(event.key === "Home" ? 0 : files.length - 1, { align: event.key === "Home" ? "start" : "end", behavior: "auto" });
      else event.currentTarget.scrollTop = event.key === "Home" ? 0 : event.currentTarget.scrollHeight;
      return;
    }
    const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>(".file-disclosure, .file-view-button");
    if (!trigger) return;
    const current = Number(trigger.closest("tr")?.getAttribute("data-index"));
    const viewing = trigger.classList.contains("file-view-button");
    if (event.key === "Tab" && onView && (viewing ? event.shiftKey : !event.shiftKey)) return;
    let next: number;
    if (event.key === "Tab") next = current + (event.shiftKey ? -1 : 1);
    else if (event.key === "ArrowDown") next = current + 1;
    else if (event.key === "ArrowUp") next = current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = files.length - 1;
    else return;
    if (next < 0 || next >= files.length) return;
    event.preventDefault();
    pendingControl.current = event.key === "Tab" ? (event.shiftKey && onView ? ".file-view-button" : ".file-disclosure") : viewing ? ".file-view-button" : ".file-disclosure";
    pendingFocus.current = files[next].path;
    setFocusedPath(files[next].path);
    if (virtual) virtualizer.scrollToIndex(next, { align: "auto", behavior: "auto" });
  }

  if (!files.length) return <div ref={motionRef} tabIndex={-1} data-motion-group className="empty" role="status"><SearchX size={24} aria-hidden="true" /><h2>{filtered ? t("No results for these filters") : t("No files here")}</h2><p>{filtered ? t("The folder may contain files. Try another name or category.") : t("Files from the selected folder will appear here.")}</p>{filtered && onClearFilters && <Button variant="outline" onClick={onClearFilters}>{t("Clear filters")}</Button>}</div>;
  let previousEnd = headerHeight;
  const rows = items.map(item => {
    const file = files[item.index];
    const gap = virtual ? item.start - previousEnd : 0;
    previousEnd = item.end;
    return <Fragment key={file.path}>
      <RowSpace height={gap} columns={preview ? 4 : 5} />
      <FileRow file={file} source={sourceLabels?.get(sourceFolder(file))} index={item.index} preview={preview} fullPaths={fullPaths} category={categoryNames.get(file.category)} open={expanded.has(file.path)} onToggle={toggle} onView={onView} onKeep={onKeep} rowRef={virtual ? virtualizer.measureElement : undefined} selection={selection} />
    </Fragment>;
  });
  return <div ref={setScrollRef} data-motion-group className="table-scroll" role="region" tabIndex={0} aria-label={preview ? t("Preview files scroll area") : t("Files scroll area")} aria-describedby={helpId} onKeyDown={navigateRows}
    onFocusCapture={event => {
      focusOwned.current = true;
      setFocusedPath((event.target as HTMLElement).closest("tr")?.getAttribute("data-file-path") ?? null);
    }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { focusOwned.current = false; setFocusedPath(null); }
    }}>
    <p id={helpId} className="sr-only">{preview ? t("Use the scroll keys to review the files and destinations.") : t("Use Tab or the arrow keys to move through the details. Home and End go to the first and last file.")}</p>
    <table className={preview ? "preview-table" : "file-table"} aria-rowcount={files.length + 1}><caption className="sr-only">{preview ? t("Preview files and destinations") : t("Files in the source folder")}</caption><colgroup><col className="name-column" />{!preview && <col className="category-column" />}<col className="size-column" /><col className="detail-column" /><col className="status-column" /></colgroup><thead ref={headerRef}><tr aria-rowindex={1}><th scope="col">{selection && selection.ready > 0 && <input type="checkbox" className="preview-check" aria-label={t("Select all ready files")} checked={selection.selected === selection.ready} ref={element => { if (element) element.indeterminate = selection.selected > 0 && selection.selected < selection.ready; }} disabled={selection.disabled} onChange={event => selection.onToggleAll(event.target.checked)} />}{t("File")}</th>{!preview && <th scope="col">{t("Category")}</th>}<th scope="col" className="number-cell">{t("Size")}</th><th scope="col">{preview ? <>{t("Planned destination")}{!fullPaths && <> <code className="preview-root">{displayPath(files[0].destination).replace(/[^\\/]+[\\/][^\\/]+$/, "")}</code></>}</> : t("Modified")}</th><th scope="col">{t("Status")}</th></tr></thead><tbody>{rows}{virtual && <RowSpace height={virtualizer.getTotalSize() - previousEnd} columns={preview ? 4 : 5} />}</tbody></table>
  </div>;
}

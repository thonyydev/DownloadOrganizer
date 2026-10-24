import { File, ArrowRight, ChevronRight, Eye, SearchX } from "lucide-react";
import { displayPath, bytes, date, labels, type Category, type FileEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Fragment, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Collapse } from "@/components/motion/collapse";
import { useContentMotion } from "@/components/motion/transitions";
import { useMotionAllowed } from "@/components/motion/feedback";

function FileDetails({ file, open, onToggle }: { file: FileEntry; open: boolean; onToggle: () => void }) {
  const interacted = useRef(false);
  const id = useId();
  return <div className="file-details"><button className="file-disclosure" aria-expanded={open} aria-controls={id} onClick={() => { interacted.current = true; onToggle(); }}><ChevronRight size={12} aria-hidden="true" />Ver caminho e destino</button><Collapse open={open} id={id} animateInitial={interacted.current}><p>Origem: {displayPath(file.path)}</p><p>Destino previsto: {displayPath(file.destination)}</p></Collapse></div>;
}

function RowSpace({ height, columns }: { height: number; columns: number }) {
  return height > 0 ? <tr aria-hidden="true" className="virtual-space"><td colSpan={columns} style={{ height }} /></tr> : null;
}

function FileRow({ file, index, preview, category, open, onToggle, onView, rowRef }: {
  file: FileEntry; index: number; preview: boolean; category?: string; open: boolean;
  onToggle: (path: string) => void; rowRef?: Ref<HTMLTableRowElement>;
  onView?: (file: FileEntry, trigger: HTMLButtonElement) => void;
}) {
  const size = useMemo(() => bytes(file.size), [file.size]);
  const modified = useMemo(() => preview ? "" : date(file.modified), [file.modified, preview]);
  return <tr data-index={index} data-file-path={file.path} aria-rowindex={index + 2} ref={rowRef}>
    <td><div className="file-name"><span className={"file-icon tone-" + file.category}><File size={16} aria-hidden="true" /></span><div className="file-copy"><strong>{file.name}</strong><small className="file-extension">{file.extension ? "." + file.extension : "Sem extensão"}</small>{!preview && <FileDetails file={file} open={open} onToggle={() => onToggle(file.path)} />}</div></div></td>
    {!preview && <td><span className={"category-label tone-" + file.category}>{category}</span></td>}
    <td className="tabular number-cell">{size}</td><td>{preview ? <span className="destination"><ArrowRight size={14} aria-hidden="true" />{displayPath(file.destination)}</span> : <span className="tabular">{modified}</span>}</td>
    <td><span className={"status status-" + file.status}>{labels[file.status]}</span>{file.reason && <small className="reason">{file.reason}</small>}{!preview && onView && <Button variant="ghost" size="sm" className="file-view-button" aria-haspopup="dialog" aria-label={`Visualizar ${file.name}`} onClick={event => onView(file, event.currentTarget)}><Eye size={14} aria-hidden="true" />Visualizar</Button>}</td>
  </tr>;
}

export function FileTable({ files, categories, preview = false, filtered = false, onClearFilters, filterKey = "all", onView }: { files: FileEntry[]; categories: Category[]; preview?: boolean; filtered?: boolean; onClearFilters?: () => void; filterKey?: string; onView?: (file: FileEntry, trigger: HTMLButtonElement) => void }) {
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
    estimateSize: () => preview ? 88 : 92,
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

  if (!files.length) return <div ref={motionRef} tabIndex={-1} data-motion-group className="empty" role="status"><SearchX size={24} aria-hidden="true" /><h2>{filtered ? "Nenhum resultado para estes filtros" : "Nenhum arquivo por aqui"}</h2><p>{filtered ? "A pasta pode conter arquivos. Tente outro nome ou categoria." : "Os arquivos da pasta selecionada aparecerão aqui."}</p>{filtered && onClearFilters && <Button variant="outline" onClick={onClearFilters}>Limpar filtros</Button>}</div>;
  let previousEnd = headerHeight;
  const rows = items.map(item => {
    const file = files[item.index];
    const gap = virtual ? item.start - previousEnd : 0;
    previousEnd = item.end;
    return <Fragment key={file.path}>
      <RowSpace height={gap} columns={preview ? 4 : 5} />
      <FileRow file={file} index={item.index} preview={preview} category={categoryNames.get(file.category)} open={expanded.has(file.path)} onToggle={toggle} onView={onView} rowRef={virtual ? virtualizer.measureElement : undefined} />
    </Fragment>;
  });
  return <div ref={setScrollRef} data-motion-group className="table-scroll" role="region" tabIndex={0} aria-label={preview ? "Rolagem dos arquivos da prévia" : "Rolagem dos arquivos"} aria-describedby={helpId} onKeyDown={navigateRows}
    onFocusCapture={event => {
      focusOwned.current = true;
      setFocusedPath((event.target as HTMLElement).closest("tr")?.getAttribute("data-file-path") ?? null);
    }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { focusOwned.current = false; setFocusedPath(null); }
    }}>
    <p id={helpId} className="sr-only">{preview ? "Use as teclas de rolagem para conferir os arquivos e destinos." : "Use Tab ou as setas para navegar pelos detalhes. Home e End levam ao primeiro e último arquivo."}</p>
    <table className={preview ? "preview-table" : "file-table"} aria-rowcount={files.length + 1}><caption className="sr-only">{preview ? "Arquivos e destinos da prévia" : "Arquivos da pasta de origem"}</caption><colgroup><col className="name-column" />{!preview && <col className="category-column" />}<col className="size-column" /><col className="detail-column" /><col className="status-column" /></colgroup><thead ref={headerRef}><tr aria-rowindex={1}><th scope="col">Arquivo</th>{!preview && <th scope="col">Categoria</th>}<th scope="col" className="number-cell">Tamanho</th><th scope="col">{preview ? "Destino previsto" : "Modificado"}</th><th scope="col">Status</th></tr></thead><tbody>{rows}{virtual && <RowSpace height={virtualizer.getTotalSize() - previousEnd} columns={preview ? 4 : 5} />}</tbody></table>
  </div>;
}

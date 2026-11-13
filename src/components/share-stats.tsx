import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, bytes, type Category, type Stats } from "@/lib/api";
import { errorMessage } from "@/lib/experience";
import { locale, t } from "@/lib/i18n";
import logoSvg from "@/assets/branding/symbol-white.svg?raw";

const SIZE = 1080;
const BRAND = "#5fc4be";
// The dark theme tones of `.tone-*` in App.css: keep both in step.
const TONES: Record<string, string> = { images: "#af99e5", videos: "#e8907f", audio: "#dab67d", documents: "#89b5de", archives: "#6fc7b3", installers: "#e08fc4", code: "#b4cc6e", other: "#9fa3b2" };
const UI = '"Segoe UI Variable Display", "Segoe UI", sans-serif';

// What the card says, also used as the image's text alternative.
export function shareText(stats: Stats, categories: Category[]) {
  const number = new Intl.NumberFormat(locale());
  const name = (id: string) => categories.find(category => category.id === id)?.name ?? id;
  return {
    files: number.format(stats.files),
    filesLabel: stats.files === 1 ? t("file organized") : t("files organized"),
    figures: [
      [bytes(stats.bytes), t("moved")],
      [number.format(stats.operations), stats.operations === 1 ? t("operation") : t("operations")],
      [`${stats.files ? Math.round(stats.automatic / stats.files * 100) : 0}%`, t("automatic (plural)")],
    ] as [string, string][],
    categories: stats.categories.slice(0, 4).map(([id, count]) => ({ id, name: name(id), count: number.format(count), share: count / Math.max(1, stats.files) })),
    since: stats.since === null ? "" : `${t("Organizing since")} ${new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(stats.since * 1000)}`,
  };
}

function draw(canvas: HTMLCanvasElement, text: ReturnType<typeof shareText>, mark: HTMLImageElement | null) {
  const c = canvas.getContext("2d");
  if (!c) return;
  c.fillStyle = "#0c0c0e"; c.fillRect(0, 0, SIZE, SIZE);
  const glow = c.createRadialGradient(SIZE, 0, 0, SIZE, 0, 760);
  glow.addColorStop(0, "rgba(95,196,190,0.16)"); glow.addColorStop(1, "rgba(95,196,190,0)");
  c.fillStyle = glow; c.fillRect(0, 0, SIZE, SIZE);
  // maxWidth keeps a long translation inside its column instead of running off the card.
  const write = (value: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left", maxWidth = SIZE - 164) => { c.font = font; c.fillStyle = color; c.textAlign = align; c.fillText(value, x, y, maxWidth); };
  if (mark) c.drawImage(mark, 80, 76, 64, 64);
  write("Download Organizer", mark ? 164 : 80, 122, `600 38px ${UI}`, "#ededed");
  write(text.files, 76, 380, `700 220px ${UI}`, BRAND);
  write(text.filesLabel, 82, 450, `400 48px ${UI}`, "#ededed");
  text.figures.forEach(([value, label], index) => {
    const x = 82 + index * 320;
    write(value, x, 580, `600 56px ${UI}`, "#ededed", "left", 290);
    write(label, x, 624, `400 28px ${UI}`, "#9a9aa0", "left", 290);
  });
  text.categories.forEach((category, index) => {
    const y = 704 + index * 64;
    write(category.name, 82, y, `500 30px ${UI}`, "#ededed");
    write(category.count, SIZE - 82, y, `500 30px ${UI}`, "#9a9aa0", "right");
    c.fillStyle = "#232327"; c.beginPath(); c.roundRect(82, y + 14, SIZE - 164, 10, 5); c.fill();
    c.fillStyle = TONES[category.id] ?? TONES.other; c.beginPath(); c.roundRect(82, y + 14, Math.max(10, (SIZE - 164) * category.share), 10, 5); c.fill();
  });
  // Two lines: in some languages the date and the address don't fit side by side.
  write(text.since, 82, 984, `400 28px ${UI}`, "#9a9aa0");
  write("downloadorganizer.thonyy.dev", 82, 1028, `500 28px "Cascadia Code", Consolas, monospace`, BRAND);
}

const png = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(t("Could not create the image"))), "image/png"));

export function ShareStats({ open, categories, onClose }: { open: boolean; categories: Category[]; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState({ text: "", error: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let stale = false;
    setStats(null); setStatus({ text: "", error: false });
    api.stats().then(next => { if (!stale) setStats(next); }).catch(error => { if (!stale) setStatus({ text: errorMessage(error), error: true }); });
    return () => { stale = true; };
  }, [open]);
  const text = useMemo(() => stats ? shareText(stats, categories) : null, [stats, categories]);
  const empty = stats?.files === 0;
  // Only when the data changes: a redraw clears the logo until it loads again.
  useEffect(() => {
    const target = canvas.current;
    if (!target || !text) return;
    draw(target, text, null);
    const mark = new Image();
    mark.onload = () => draw(target, text, mark);
    // The symbol has only a viewBox: a size makes the browser draw it at full resolution.
    mark.src = "data:image/svg+xml," + encodeURIComponent(logoSvg.replace("<svg ", '<svg width="256" height="256" '));
  }, [text]);
  const act = async (job: (blob: Blob) => Promise<string>) => {
    if (!canvas.current) return;
    setBusy(true); setStatus({ text: "", error: false });
    try { const done = await job(await png(canvas.current)); if (done) setStatus({ text: done, error: false }); }
    catch (error) { setStatus({ text: errorMessage(error), error: true }); }
    finally { setBusy(false); }
  };
  const copy = () => act(async blob => { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); return t("Image copied. Paste it in your post."); });
  const save = () => act(async blob => await api.saveShareImage(new Uint8Array(await blob.arrayBuffer())) ? t("Image saved.") : "");
  const summary = text ? [`${text.files} ${text.filesLabel}`, ...text.figures.map(([value, label]) => `${value} ${label}`), ...text.categories.map(category => `${category.name}: ${category.count}`), text.since].filter(Boolean).join(". ") : "";
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="share-dialog">
      <DialogHeader><DialogTitle>{t("Share your stats")}</DialogTitle><DialogDescription>{t("The image shows only totals: no file names or paths.")}</DialogDescription></DialogHeader>
      <div className="share-preview">{text ? <canvas ref={canvas} width={SIZE} height={SIZE} role="img" aria-label={summary} /> : !status.error && <Loader2 className="spin" aria-label={t("Loading the stats…")} />}</div>
      <p className={status.error ? "inline-error" : "share-status"} role={status.error ? "alert" : "status"}>{status.text || (empty ? t("Nothing to share yet: organize some files first. Undone moves don't count.") : "")}</p>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>{t("Close")}</Button>
        <Button variant="outline" disabled={!text || empty || busy} onClick={() => void copy()}><Copy aria-hidden="true" />{t("Copy image")}</Button>
        <Button disabled={!text || empty || busy} onClick={() => void save()}><Download aria-hidden="true" />{t("Save image")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

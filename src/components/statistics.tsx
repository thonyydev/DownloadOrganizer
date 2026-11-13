import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { api, bytes, type Category, type OperationStat, type Statistics } from "@/lib/api";
import { errorMessage } from "@/lib/experience";
import { locale, t } from "@/lib/i18n";
import { plural } from "@/lib/utils";

export type Period = "7d" | "30d" | "12m" | "all";
const PERIODS: Period[] = ["7d", "30d", "12m", "all"];
const DAY = 86_400_000;
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const startOfMonth = (ms: number) => { const date = new Date(startOfDay(ms)); date.setDate(1); return date.getTime(); };
// Calendar steps, not fixed milliseconds, so a daylight saving change never splits a day.
const addDays = (ms: number, days: number) => { const date = new Date(ms); date.setDate(date.getDate() + days); return date.getTime(); };
const addMonths = (ms: number, months: number) => { const date = new Date(ms); date.setMonth(date.getMonth() + months); return date.getTime(); };

/** The first second the period covers, or null for all time. Periods start at a day or month boundary. */
export function periodStart(period: Period, now: number) {
  if (period === "all") return null;
  const start = period === "12m" ? addMonths(startOfMonth(now), -11) : addDays(startOfDay(now), period === "7d" ? -6 : -29);
  return Math.floor(start / 1000);
}

export interface Bucket { start: number; end: number; files: number; bytes: number; monthly: boolean }

/** Files per day up to about three months and per month beyond, so the chart never has a few bars or hundreds. */
export function timeline(operations: OperationStat[], period: Period, now: number): Bucket[] {
  const first = operations.length ? operations[0].created * 1000 : now;
  const monthly = period === "12m" || (period === "all" && now - first > 90 * DAY);
  const start = period !== "all" ? periodStart(period, now)! * 1000
    : monthly ? startOfMonth(first) : Math.min(startOfDay(first), addDays(startOfDay(now), -6));
  const buckets: Bucket[] = [];
  for (let at = start; at <= now;) {
    const end = monthly ? addMonths(at, 1) : addDays(at, 1);
    buckets.push({ start: at, end, files: 0, bytes: 0, monthly });
    at = end;
  }
  for (const operation of operations) {
    const at = operation.created * 1000;
    const bucket = buckets.find(item => at >= item.start && at < item.end);
    if (bucket) { bucket.files += operation.files; bucket.bytes += operation.bytes; }
  }
  return buckets;
}

/** Files organized per weekday (rows, Monday first) and hour (columns), in local time. */
export function activity(operations: OperationStat[]) {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const operation of operations) {
    const date = new Date(operation.created * 1000);
    grid[(date.getDay() + 6) % 7][date.getHours()] += operation.files;
  }
  return grid;
}

/** The top of the axis: 2, 4, 6, 10, 20, 40…, so the top and the middle line are whole numbers of files. */
export const niceMax = (value: number) => { if (value <= 2) return 2; const power = 10 ** Math.floor(Math.log10(value)); return [2, 4, 6, 10].map(step => step * power).find(step => step >= value)!; };
// 1 January 2024 was a Monday.
const weekdays = (weekday: "long" | "short") => Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale(), { weekday }).format(new Date(2024, 0, 1 + index)));
// Short for the axis; with minutes in sentences, where a bare "09" would not read as a time.
const hour = (value: number) => new Intl.DateTimeFormat(locale(), { hour: "numeric" }).format(new Date(2024, 0, 1, value));
const time = (value: number) => new Intl.DateTimeFormat(locale(), { hour: "numeric", minute: "2-digit" }).format(new Date(2024, 0, 1, value));
const files = (count: number) => plural(count, t("file"), t("files"));

interface Tip { x: number; y: number; value: string; label: string }

function Card({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return <section className={"stats-card" + (wide ? " wide" : "")} aria-label={title}><div className="section-heading"><h2>{title}</h2></div>{children}</section>;
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return <details className="stats-data"><summary>{t("Show data")}</summary><div className="table-scroll"><table><thead><tr>{head.map(cell => <th key={cell} scope="col">{cell}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column ? <td key={column}>{cell}</td> : <th key={column} scope="row">{cell}</th>)}</tr>)}</tbody></table></div></details>;
}

function Columns({ buckets, period, onTip }: { buckets: Bucket[]; period: Period; onTip: (tip: Tip | null) => void }) {
  const top = niceMax(Math.max(...buckets.map(bucket => bucket.files)));
  const number = new Intl.NumberFormat(locale());
  const short = new Intl.DateTimeFormat(locale(), buckets[0]?.monthly ? { month: "short" } : period === "7d" ? { weekday: "short" } : { day: "numeric", month: "numeric" });
  const long = new Intl.DateTimeFormat(locale(), buckets[0]?.monthly ? { month: "long", year: "numeric" } : { dateStyle: "full" });
  // At most about seven labels along the axis; the last bucket (now) is always labeled.
  const every = Math.ceil(buckets.length / 7);
  return <>
    <div className="column-chart" role="img" aria-label={`${t("Over time")}: ${files(buckets.reduce((sum, bucket) => sum + bucket.files, 0))}`}>
      <div className="column-axis" aria-hidden="true">{[top, top / 2, 0].map(tick => <span key={tick}>{number.format(tick)}</span>)}</div>
      <div className="column-plot" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
        {buckets.map(bucket => <div key={bucket.start} className="column-slot" onPointerEnter={(event: PointerEvent) => onTip({ x: event.clientX, y: event.clientY, value: files(bucket.files), label: `${long.format(bucket.start)} · ${bytes(bucket.bytes)}` })} onPointerLeave={() => onTip(null)}>
          <i style={{ height: `${bucket.files / top * 100}%` }} />
        </div>)}
      </div>
      <div className="column-labels" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
        {buckets.map((bucket, index) => <span key={bucket.start}>{(buckets.length - 1 - index) % every === 0 ? short.format(bucket.start) : ""}</span>)}
      </div>
    </div>
    <DataTable head={[t("Period"), t("Files"), t("Size")]} rows={buckets.map(bucket => [long.format(bucket.start), number.format(bucket.files), bytes(bucket.bytes)])} />
  </>;
}

function Bars({ rows, total }: { rows: { key: string; label: string; tone?: string; files: number; detail?: string }[]; total: number }) {
  const number = new Intl.NumberFormat(locale());
  const largest = Math.max(1, ...rows.map(row => row.files));
  return <ul className="stat-bars">{rows.map(row => <li key={row.key}>
    <span className="stat-bar-label">{row.tone && <span className={"tone-dot tone-" + row.tone} aria-hidden="true" />}{row.label}</span>
    <span className="stat-bar-track" aria-hidden="true"><i style={{ width: `${row.files / largest * 100}%` }} /></span>
    <span className="stat-bar-value">{number.format(row.files)}<small>{row.detail ?? `${Math.round(row.files / Math.max(1, total) * 100)}%`}</small></span>
  </li>)}</ul>;
}

function Heatmap({ grid, onTip }: { grid: number[][]; onTip: (tip: Tip | null) => void }) {
  const names = weekdays("long");
  const short = weekdays("short");
  const largest = Math.max(0, ...grid.flat());
  const busiest = largest ? grid.flatMap((row, day) => row.map((value, hourIndex) => ({ value, day, hourIndex }))).find(cell => cell.value === largest)! : null;
  const level = (value: number) => value ? Math.max(1, Math.ceil(value / largest * 4)) : 0;
  return <>
    {busiest && <p className="stats-note">{t("Busiest time")}: <strong>{names[busiest.day]}, {time(busiest.hourIndex)}</strong></p>}
    <div className="heatmap" role="img" aria-label={busiest ? `${t("Busiest time")}: ${names[busiest.day]}, ${time(busiest.hourIndex)}` : t("When you organize")}>
      {grid.map((row, day) => <div className="heatmap-row" key={day}>
        <span className="heatmap-day" aria-hidden="true">{short[day]}</span>
        {row.map((value, hourIndex) => <i key={hourIndex} className={"heat-" + level(value)} onPointerEnter={(event: PointerEvent) => onTip({ x: event.clientX, y: event.clientY, value: files(value), label: `${names[day]}, ${time(hourIndex)}` })} onPointerLeave={() => onTip(null)} />)}
      </div>)}
      <div className="heatmap-row heatmap-hours" aria-hidden="true"><span />{Array.from({ length: 24 }, (_, index) => <span key={index}>{index % 6 === 0 ? hour(index) : ""}</span>)}</div>
    </div>
    <div className="heatmap-legend" aria-hidden="true">{t("Less")}{[0, 1, 2, 3, 4].map(step => <i key={step} className={"heat-" + step} />)}{t("More")}</div>
    <DataTable head={[t("Day"), ...Array.from({ length: 24 }, (_, index) => hour(index))]} rows={grid.map((row, day) => [names[day], ...row])} />
  </>;
}

function Split({ automatic, manual }: { automatic: number; manual: number }) {
  const total = automatic + manual;
  const number = new Intl.NumberFormat(locale());
  const parts = [{ key: "automatic", label: t("Automatic"), value: automatic }, { key: "manual", label: t("Manual"), value: manual }].filter(part => part.value > 0);
  const share = (value: number) => Math.round(value / total * 100);
  return <>
    <div className="split-bar" role="img" aria-label={parts.map(part => `${part.label}: ${files(part.value)} (${share(part.value)}%)`).join(", ")}>
      {parts.map(part => <span key={part.key} className={"split-" + part.key} style={{ flexGrow: part.value }}>{share(part.value) >= 12 ? `${share(part.value)}%` : ""}</span>)}
    </div>
    <ul className="split-legend">{parts.map(part => <li key={part.key}><i className={"split-" + part.key} aria-hidden="true" />{part.label}<strong>{number.format(part.value)}</strong></li>)}</ul>
  </>;
}

export function StatisticsView({ categories, revision }: { categories: Category[]; revision: unknown }) {
  const [period, setPeriod] = useState<Period>("30d");
  const [state, setState] = useState<{ stats: Statistics | null; period: Period; now: number; loading: boolean; error: string }>({ stats: null, period: "30d", now: Date.now(), loading: true, error: "" });
  const [tip, setTip] = useState<Tip | null>(null);
  // Refetches when the period or the app's data changes. Only a new period dims the page: data changes
  // with every file that arrives while monitoring, and those refetches must stay invisible.
  // shortcut: refetches on each snapshot even when the history didn't change, key on the history if it gets slow.
  useEffect(() => {
    let stale = false;
    const now = Date.now();
    setState(current => ({ ...current, loading: period !== current.period, error: "" }));
    api.statistics(periodStart(period, now))
      .then(stats => { if (!stale) setState({ stats, period, now, loading: false, error: "" }); })
      .catch(error => { if (!stale) setState(current => ({ ...current, loading: false, error: errorMessage(error) })); });
    return () => { stale = true; };
  }, [period, revision]);
  const { stats } = state;
  const view = useMemo(() => {
    if (!stats) return null;
    const total = stats.operations.reduce((sum, operation) => sum + operation.files, 0);
    const automatic = stats.operations.filter(operation => operation.automatic).reduce((sum, operation) => sum + operation.files, 0);
    return { total, automatic, size: stats.operations.reduce((sum, operation) => sum + operation.bytes, 0), buckets: timeline(stats.operations, state.period, state.now), grid: activity(stats.operations) };
  }, [stats, state.period, state.now]);
  const name = (id: string) => categories.find(category => category.id === id)?.name ?? id;
  const number = new Intl.NumberFormat(locale());
  const labels: Record<Period, string> = { "7d": t("7 days"), "30d": t("30 days"), "12m": t("12 months"), all: t("All time") };
  return <div className="statistics">
    <div className="theme-picker" role="group" aria-label={t("Period")}>{PERIODS.map(value => <Button key={value} size="sm" aria-pressed={period === value} variant={period === value ? "secondary" : "ghost"} onClick={() => setPeriod(value)}>{labels[value]}</Button>)}</div>
    {state.error && <p className="inline-error" role="alert">{state.error}</p>}
    {!stats || !view ? !state.error && <p className="section-empty" role="status">{t("Loading the stats…")}</p>
      : <div className={"statistics-body" + (state.loading ? " refreshing" : "")} aria-busy={state.loading}>
        <dl className="file-summary">
          <div><dt>{t("Files organized")}</dt><dd>{number.format(view.total)}</dd></div>
          <div><dt>{t("Space moved")}</dt><dd>{bytes(view.size)}</dd></div>
          <div><dt>{t("Operations")}</dt><dd>{number.format(stats.operations.length)}</dd></div>
          <div><dt>{t("Organized automatically")}</dt><dd>{view.total ? Math.round(view.automatic / view.total * 100) : 0}%</dd></div>
        </dl>
        {!view.total && !stats.undone && !stats.failed ? <p className="section-empty">{t("Nothing was organized in this period.")}</p> : <div className="stats-grid">
          <Card title={t("Over time")} wide><Columns buckets={view.buckets} period={state.period} onTip={setTip} /></Card>
          <Card title={t("By category")}><Bars total={view.total} rows={stats.categories.map(([id, count, size]) => ({ key: id, label: name(id), tone: id, files: count, detail: bytes(size) }))} /></Card>
          <Card title={t("Most common extensions")}><Bars total={view.total} rows={stats.extensions.map(([extension, count]) => ({ key: extension, label: extension ? "." + extension : t("No extension"), files: count }))} /></Card>
          <Card title={t("When you organize")} wide><Heatmap grid={view.grid} onTip={setTip} /></Card>
          <Card title={t("Manual and automatic")}>{view.total ? <Split automatic={view.automatic} manual={view.total - view.automatic} /> : <p className="section-empty">{t("Nothing was organized in this period.")}</p>}</Card>
          <Card title={t("Results")}><dl className="stats-results">
            <div><dt>{t("Still organized")}</dt><dd>{number.format(view.total)}</dd></div>
            <div><dt>{t("Undone (plural)")}</dt><dd>{number.format(stats.undone)}</dd></div>
            <div><dt>{t("Failed or unconfirmed")}</dt><dd>{number.format(stats.failed)}</dd></div>
          </dl></Card>
          <Card title={t("Largest files")} wide>{stats.largest.length ? <ul className="stats-largest">{stats.largest.map(([file, size, category], index) => <li key={index}><span className={"tone-dot tone-" + category} aria-hidden="true" /><span className="stats-largest-name" title={file}>{file}</span><small>{name(category)}</small><strong>{bytes(size)}</strong></li>)}</ul> : <p className="section-empty">{t("Nothing was organized in this period.")}</p>}</Card>
        </div>}
      </div>}
    {tip && <div className="stats-tip" role="presentation" style={{ left: Math.min(Math.max(tip.x, 160), window.innerWidth - 160), top: tip.y }}><strong>{tip.value}</strong><span>{tip.label}</span></div>}
  </div>;
}

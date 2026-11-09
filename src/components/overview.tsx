import { Tooltip } from "radix-ui";
import { ArrowRight, FolderOpen, History, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Activity } from "@/components/history";
import { AnimatedCount } from "@/components/motion/animated-count";
import { useMotionAllowed } from "@/components/motion/feedback";
import { TriageBar, triageCounts } from "@/components/triage";
import { t } from "@/lib/i18n";
import type { ReactNode } from "react";
import { displayPath, basename, bytes, type OperationSummary, type Snapshot } from "@/lib/api";

export function Overview({ data, counts, onConflicts, onFiles, onSettings, onCategory, onHistory, onOperation, onOpenDestination }: {
  data: Snapshot | null; counts: Map<string, number>; onConflicts: () => void; onFiles: () => void; onSettings: () => void; onCategory: (id: string) => void;
  onHistory: () => void; onOperation: (operation: OperationSummary) => void; onOpenDestination: () => void;
}) {
  const motionAllowed = useMotionAllowed();
  const files = data?.files ?? [];
  const history = data?.history ?? [];
  const triage = triageCounts(files);
  const fullest = Math.max(1, ...counts.values());
  const stats: [string, number, ReactNode, boolean][] = [
    [t("Available"), files.length, bytes(files.reduce((sum, f) => sum + f.size, 0)), true],
    [t("Ready (plural)"), triage.ready, t("After review"), true],
    [t("Conflicts"), triage.conflict, triage.conflict ? <button type="button" className="stat-link" onClick={onConflicts}>{t("View conflicts")}</button> : t("Preserved"), false],
    [t("Organized (plural)"), history.reduce((sum, op) => sum + op.moved, 0), t("Last 100 operations"), true],
  ];
  return <div className="overview">
    <section data-motion-group className="source-section" aria-labelledby="source-heading">
      <div className="source-heading"><div className="folder-copy"><span className="section-label">{t("Source folder")}</span><div className="route"><h2 id="source-heading">{data?.preferences.source ? displayPath(basename(data.preferences.source)) + (data.preferences.extra_sources.length ? ` +${data.preferences.extra_sources.length}` : "") : t("No folder connected")}</h2>{data?.preferences.source && data.preferences.destination && <><ArrowRight aria-hidden="true" /><span className="route-target"><span className="sr-only">{t("Destination")}: </span>{displayPath(basename(data.preferences.destination))}</span></>}</div></div><Button variant="outline" size="sm" onClick={onSettings}>{t("Configure")}</Button></div>
      {data?.preferences.source ? <Tooltip.Root><Tooltip.Trigger asChild><code className="source-path" tabIndex={0}>{displayPath(data.preferences.source)}</code></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="path-tooltip" sideOffset={6} collisionPadding={12}>{[data.preferences.source, ...data.preferences.extra_sources].map(path => <div key={path}>{displayPath(path)}</div>)}</Tooltip.Content></Tooltip.Portal></Tooltip.Root> : <p className="source-path">{t("Select a folder in Settings to get started.")}</p>}
      <div className="source-meta"><span className={"monitor-status " + (data?.monitoring ? "online" : "")}><span className="small-dot" />{data?.monitoring ? t("Monitoring on") : t("Monitoring paused")}</span>{data && <span className="source-destination">{t("Destination")} <code>{displayPath(data.preferences.destination)}</code></span>}{data && <Button variant="ghost" size="sm" onClick={onOpenDestination}><FolderOpen aria-hidden="true" />{t("Open destination folder")}</Button>}<Button variant="ghost" size="sm" onClick={onFiles}>{t("Explore files")}<ArrowRight aria-hidden="true" /></Button></div>
      {data && <TriageBar counts={triage} />}
      <dl className="file-summary">{stats.map(([label, value, description, animated]) => <div key={label}><dt>{label}</dt><dd>{data ? animated ? <AnimatedCount value={value} /> : value : "—"}<span>{data ? description : t("Waiting for desktop")}</span></dd></div>)}</dl>
      <p className="operational-note"><ShieldCheck size={16} aria-hidden="true" />{t("Review the preview before moving. Conflicting files are never overwritten.")}</p>
    </section>
    <div className="overview-lists">
      <section data-motion-group aria-labelledby="categories-heading"><div className="section-heading"><h2 id="categories-heading">{t("Categories")}</h2></div>
        <div className="category-list">{data?.categories.length ? data.categories.map(category => { const count = counts.get(category.id) ?? 0; return <button className={"category-row tone-" + category.id} key={category.id} onClick={() => onCategory(category.id)}><span className="tone-dot" aria-hidden="true" /><span>{category.name}{data.preferences.enabled_categories.includes(category.id) ? <span className="sr-only"> {t("Enabled")}</span> : <small>{t("Paused")}</small>}</span><span className="slot-bar" aria-hidden="true"><i style={{ width: `${count / fullest * 100}%` }} /></span><span className="category-count">{count}</span></button>; }) : <p className="section-empty">{t("Categories will appear when you open the desktop app.")}</p>}</div>
      </section>
      <section data-motion-group aria-labelledby="recent-heading"><div className="section-heading"><h2 id="recent-heading">{t("Recent activity")}</h2><Button variant="ghost" size="sm" onClick={onHistory}>{t("View history")}<ArrowRight aria-hidden="true" /></Button></div>
        <div className="recent-list">{history.length ? history.slice(0, 4).map(op => <Activity key={op.id} operation={op} motionAllowed={motionAllowed} onOpen={() => onOperation(op)} />) : <div className="empty compact"><History size={16} aria-hidden="true" /><h3>{t("No recent activity")}</h3><p>{t("Results will appear after your first organization.")}</p></div>}</div>
      </section>
    </div>
  </div>;
}

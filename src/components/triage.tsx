import { plural } from "@/lib/utils";

export interface TriageCounts { ready: number; conflict: number; ignored: number }

// Above this, individual ticks stop being readable and a proportional fill says the same thing.
const maxTicks = 60;

export function triageCounts(files: readonly { status: "ready" | "conflict" | "ignored" }[]): TriageCounts {
  const counts: TriageCounts = { ready: 0, conflict: 0, ignored: 0 };
  for (const file of files) counts[file.status]++;
  return counts;
}

function triageLabels({ ready, conflict, ignored }: TriageCounts) {
  return [plural(ready, "pronto", "prontos"), plural(conflict, "conflito", "conflitos"), plural(ignored, "ignorado", "ignorados")];
}

export function TriageLegend({ counts }: { counts: TriageCounts }) {
  const [ready, conflict, ignored] = triageLabels(counts);
  return <p className="triage-legend"><span className="triage-ready">{ready}</span><span className="triage-conflict">{conflict}</span><span className="triage-ignored">{ignored}</span></p>;
}

/** One tick per file in the source folder, grouped by what the next organization would do with it. */
export function TriageBar({ counts }: { counts: TriageCounts }) {
  const total = counts.ready + counts.conflict + counts.ignored;
  const parts = (["ready", "conflict", "ignored"] as const).filter(part => counts[part] > 0);
  return <div className="triage">
    <div className="triage-bar" role="img" aria-label={total ? triageLabels(counts).join(", ") : "Nenhum arquivo na pasta de origem"}>
      {total === 0 ? <span className="triage-empty" /> : parts.map(part => <span key={part} className={`triage-part triage-${part}${total > maxTicks ? " solid" : ""}`} style={{ flexGrow: counts[part] }}>
        {total <= maxTicks && Array.from({ length: counts[part] }, (_, index) => <i key={index} />)}
      </span>)}
    </div>
    <TriageLegend counts={counts} />
  </div>;
}

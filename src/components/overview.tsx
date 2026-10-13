import { Tooltip } from "radix-ui";
import { ArrowRight, AudioLines, Boxes, Code2, Download, FileText, FolderOpen, History, Image, Package, ShieldCheck, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Activity } from "@/components/history";
import { AnimatedCount } from "@/components/motion/animated-count";
import { useMotionAllowed } from "@/components/motion/feedback";
import { basename, bytes, type Operation, type Snapshot } from "@/lib/api";

const categoryIcons: Record<string, typeof Image> = { images: Image, videos: Video, audio: AudioLines, documents: FileText, archives: Package, installers: Download, code: Code2, other: Boxes };

export function Overview({ data, onFiles, onSettings, onCategory, onHistory, onOperation }: {
  data: Snapshot | null; onFiles: () => void; onSettings: () => void; onCategory: (id: string) => void;
  onHistory: () => void; onOperation: (operation: Operation) => void;
}) {
  const motionAllowed = useMotionAllowed();
  const files = data?.files ?? [];
  const history = data?.history ?? [];
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.category, (counts.get(file.category) ?? 0) + 1);
  const stats: [string, number, string][] = [
    ["Disponíveis", files.length, bytes(files.reduce((sum, f) => sum + f.size, 0))],
    ["Prontos", files.filter(f => f.status === "ready").length, "Após conferência"],
    ["Conflitos", files.filter(f => f.status === "conflict").length, "Preservados"],
    ["Organizados", history.reduce((sum, op) => sum + op.movements.filter(m => m.status === "moved").length, 0), "Últimas 100 operações"],
  ];
  return <div className="overview">
    <section data-motion-group className="source-section" aria-labelledby="source-heading">
      <div className="source-heading"><span className="folder-mark"><FolderOpen size={20} aria-hidden="true" /></span><div className="folder-copy"><span className="section-label">Pasta de origem</span><h2 id="source-heading">{data?.preferences.source ? basename(data.preferences.source) : "Nenhuma pasta conectada"}</h2></div><Button variant="outline" size="sm" onClick={onSettings}>Configurar</Button></div>
      {data?.preferences.source ? <Tooltip.Root><Tooltip.Trigger asChild><code className="source-path" tabIndex={0}>{data.preferences.source}</code></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="path-tooltip" sideOffset={6} collisionPadding={12}>{data.preferences.source}</Tooltip.Content></Tooltip.Portal></Tooltip.Root> : <p className="source-path">Selecione uma pasta nas configurações para começar.</p>}
      <div className="source-meta"><span className={"monitor-status " + (data?.monitoring ? "online" : "")}><span className="small-dot" />{data?.monitoring ? "Monitoramento ativo" : "Monitoramento pausado"}</span>{data && <span className="source-destination">Destino <code>{data.preferences.destination}</code></span>}<Button variant="ghost" size="sm" onClick={onFiles}>Explorar arquivos<ArrowRight aria-hidden="true" /></Button></div>
      <dl className="file-summary">{stats.map(([label, value, description]) => <div key={label}><dt>{label}</dt><dd>{data ? label === "Conflitos" ? value : <AnimatedCount value={value} /> : "—"}<span>{data ? description : "Aguardando desktop"}</span></dd></div>)}</dl>
      <p className="operational-note"><ShieldCheck size={14} aria-hidden="true" />Confira a prévia antes de mover. Conflitos nunca são sobrescritos.</p>
    </section>
    <div className="overview-lists">
      <section data-motion-group aria-labelledby="categories-heading"><div className="section-heading"><h2 id="categories-heading">Categorias</h2><span>{data?.categories.length ?? 0} regras</span></div>
        <div className="category-list">{data?.categories.length ? data.categories.map(category => { const Icon = categoryIcons[category.id] ?? Boxes; return <button className={"category-row tone-" + category.id} key={category.id} onClick={() => onCategory(category.id)}><Icon size={16} aria-hidden="true" /><span>{category.name}<small>{data.preferences.enabled_categories.includes(category.id) ? "Habilitada" : "Pausada"}</small></span><span className="category-count">{counts.get(category.id) ?? 0}</span><ArrowRight size={14} aria-hidden="true" /></button>; }) : <p className="section-empty">As categorias aparecerão ao abrir o aplicativo desktop.</p>}</div>
      </section>
      <section data-motion-group aria-labelledby="recent-heading"><div className="section-heading"><h2 id="recent-heading">Atividade recente</h2><Button variant="ghost" size="sm" onClick={onHistory}>Ver histórico<ArrowRight aria-hidden="true" /></Button></div>
        <div className="recent-list">{history.length ? history.slice(0, 4).map(op => <Activity key={op.id} operation={op} motionAllowed={motionAllowed} onOpen={() => onOperation(op)} />) : <div className="empty compact"><History size={20} aria-hidden="true" /><h3>Nenhuma atividade recente</h3><p>Os resultados aparecerão após sua primeira organização.</p></div>}</div>
      </section>
    </div>
  </div>;
}

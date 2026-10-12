import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Moon, Sun, Save, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { type Category, type Preferences } from "@/lib/api";

export function Settings({ draft, categories, busy, dirty, external, onChange: setDraft, onSave, onDiscard, onAcceptExternal }: {
  draft: Preferences; categories: Category[]; busy: boolean; dirty: boolean; external: Preferences | null;
  onChange: (update: (value: Preferences) => Preferences) => void; onSave: () => void; onDiscard: () => void; onAcceptExternal: () => void;
}) {
  const [pickerError, setPickerError] = useState("");
  async function choose(field: "source" | "destination") {
    try {
      setPickerError("");
      const selected = await open({ directory: true, multiple: false, title: field === "source" ? "Escolher pasta de origem" : "Escolher pasta de destino" });
      if (typeof selected === "string") setDraft(p => ({ ...p, [field]: selected, ...(field === "source" && p.source === p.destination ? { destination: selected } : {}) }));
    } catch (error) { setPickerError(String(error)); }
  }
  return <div className="settings-stack">
    {external && <section className="banner error-banner" role="alert"><div><strong>As configurações salvas foram atualizadas</strong><p>Seu rascunho foi preservado. Compare a versão atual antes de decidir qual salvar.</p><dl className="external-preferences"><dt>Origem salva</dt><dd>{external.source}</dd><dt>Destino salvo</dt><dd>{external.destination}</dd><dt>Automação salva</dt><dd>{external.automatic ? "Ativada" : "Desativada"}</dd><dt>Categorias salvas</dt><dd>{categories.filter(c => external.enabled_categories.includes(c.id)).map(c => c.name).join(", ") || "Nenhuma"}</dd><dt>Tema salvo</dt><dd>{external.theme === "dark" ? "Escuro" : "Claro"}</dd></dl><div className="notice-actions"><Button variant="outline" disabled={busy} onClick={onDiscard}>Descartar rascunho e carregar atuais</Button><Button variant="outline" disabled={busy} onClick={onAcceptExternal}>Manter rascunho sobre esta versão</Button></div></div></section>}
    <p className="draft-status" role="status">{dirty ? "Alterações não salvas. As configurações salvas continuam em uso." : "Todas as alterações estão salvas."}</p>
    <section className="panel"><div className="panel-heading"><h2>Seus diretórios</h2><span>Somente arquivos da primeira camada</span></div><div className="settings-body">
      {(["source", "destination"] as const).map(field => <div className="setting-row directory-row" key={field}><div><h3 id={`directory-${field}`}>{field === "source" ? "Pasta de origem" : "Destino da organização"}</h3><p>{field === "source" ? "A pasta onde seus arquivos chegam." : "As categorias serão criadas dentro desta pasta."}</p><code>{draft[field] || "Nenhuma pasta selecionada"}</code></div><Button variant="outline" onClick={() => choose(field)} disabled={busy} aria-label={field === "source" ? "Selecionar pasta de origem" : "Selecionar destino da organização"}><FolderOpen aria-hidden="true" />Selecionar</Button></div>)}
      {pickerError && <p className="inline-error" role="alert">{pickerError}</p>}
    </div></section>
    <section className="panel"><div className="panel-heading"><h2><Zap size={16} />Organização automática</h2><span>Você está no controle</span></div><div className="settings-body"><div className="setting-row"><div><label htmlFor="automatic">Organizar novos arquivos</label><p>Ativa o monitoramento enquanto o aplicativo estiver aberto.</p></div><Switch id="automatic" checked={draft.automatic} disabled={busy} onCheckedChange={automatic => setDraft(p => ({ ...p, automatic }))} /></div><div className="notice"><ShieldCheck size={17} /><p>Ao ativar e salvar, você autoriza a movimentação de <strong>novos arquivos</strong> para as categorias abaixo, após 10 segundos sem gravações. Arquivos que já estão na pasta continuam exigindo uma prévia manual. Conflitos e arquivos ocupados são preservados.</p></div></div></section>
    <section className="panel"><div className="panel-heading"><h2>Categorias habilitadas</h2><span>Regras por extensão</span></div><div className="rule-grid">{categories.map(c => <div className="rule" key={c.id}><div><label htmlFor={`rule-${c.id}`} className={`tone-${c.id}`}>{c.name}</label><p>{c.extensions.length ? c.extensions.slice(0, 7).map(e => `.${e}`).join(" · ") : "Sem extensão ou extensão desconhecida"}</p></div><Switch id={`rule-${c.id}`} checked={draft.enabled_categories.includes(c.id)} disabled={busy} onCheckedChange={enabled => setDraft(p => ({ ...p, enabled_categories: enabled ? [...p.enabled_categories, c.id] : p.enabled_categories.filter(id => id !== c.id) }))} /></div>)}</div></section>
    <section className="panel"><div className="settings-body setting-row"><div><h3 id="appearance-label">Aparência</h3><p>Um espaço confortável para trabalhar.</p></div><div className="theme-picker" role="group" aria-labelledby="appearance-label"><Button aria-pressed={draft.theme === "dark"} variant={draft.theme === "dark" ? "secondary" : "ghost"} onClick={() => setDraft(p => ({ ...p, theme: "dark" }))} disabled={busy}><Moon aria-hidden="true" />Escuro</Button><Button aria-pressed={draft.theme === "light"} variant={draft.theme === "light" ? "secondary" : "ghost"} onClick={() => setDraft(p => ({ ...p, theme: "light" }))} disabled={busy}><Sun aria-hidden="true" />Claro</Button></div></div></section>
    <div className="settings-actions"><span>Seu rascunho é mantido ao navegar.</span><div className="notice-actions"><Button variant="outline" onClick={onDiscard} disabled={busy || !dirty}>Descartar alterações</Button><Button onClick={onSave} disabled={busy || !dirty || !!external}><Save aria-hidden="true" />{busy ? "Salvando…" : "Salvar preferências"}</Button></div></div>
  </div>;
}

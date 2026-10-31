import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Moon, Sun, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { displayPath, type Category, type Preferences } from "@/lib/api";
import { t } from "@/lib/i18n";

// Each language keeps its own name, so anyone can find theirs.
const languages = () => [{ id: "system", name: t("Sistema", "System") }, { id: "pt-BR", name: "Português (Brasil)" }, { id: "en", name: "English" }, { id: "es", name: "Español" }, { id: "fr", name: "Français" }, { id: "it", name: "Italiano" }] as const;
import { AudioSettings } from "@/components/audio/audio-settings";

export function Settings({ draft, categories, busy, dirty, external, onChange: setDraft, onDiscard, onAcceptExternal }: {
  draft: Preferences; categories: Category[]; busy: boolean; dirty: boolean; external: Preferences | null;
  onChange: (update: (value: Preferences) => Preferences) => void; onDiscard: () => void; onAcceptExternal: () => void;
}) {
  const [pickerError, setPickerError] = useState("");
  async function choose(field: "source" | "destination") {
    try {
      setPickerError("");
      const selected = await open({ directory: true, multiple: false, title: field === "source" ? t("Escolher pasta de origem", "Choose source folder") : t("Escolher pasta de destino", "Choose destination folder") });
      if (typeof selected === "string") setDraft(p => ({ ...p, [field]: selected, ...(field === "source" && p.source === p.destination ? { destination: selected } : {}) }));
    } catch (error) { setPickerError(String(error)); }
  }
  return <div className="settings-stack">
    {external && <section className="banner error-banner" role="alert"><div><strong>{t("As configurações salvas foram atualizadas", "The saved settings were updated")}</strong><p>{t("Seu rascunho foi preservado. Compare a versão atual antes de decidir qual salvar.", "Your draft was kept. Compare the current version before deciding which to save.")}</p><dl className="external-preferences"><dt>{t("Origem salva", "Saved source")}</dt><dd>{displayPath(external.source)}</dd><dt>{t("Destino salvo", "Saved destination")}</dt><dd>{displayPath(external.destination)}</dd><dt>{t("Automação salva", "Saved automation")}</dt><dd>{external.automatic ? t("Ativada", "On") : t("Desativada", "Off")}</dd><dt>{t("Categorias salvas", "Saved categories")}</dt><dd>{categories.filter(c => external.enabled_categories.includes(c.id)).map(c => c.name).join(", ") || t("Nenhuma", "None")}</dd><dt>{t("Tema salvo", "Saved theme")}</dt><dd>{external.theme === "dark" ? t("Escuro", "Dark") : t("Claro", "Light")}</dd><dt>{t("Idioma salvo", "Saved language")}</dt><dd>{languages().find(item => item.id === external.language)?.name}</dd></dl><div className="notice-actions"><Button variant="outline" disabled={busy} onClick={onDiscard}>{t("Descartar rascunho e carregar atuais", "Discard draft and load current")}</Button><Button variant="outline" disabled={busy} onClick={onAcceptExternal}>{t("Manter rascunho sobre esta versão", "Keep draft over this version")}</Button></div></div></section>}
    <p className="draft-status" role="status">{external ? t("As configurações salvas mudaram. Revise seu rascunho antes de salvar.", "The saved settings changed. Review your draft before saving.") : dirty ? t("Alterações não salvas. As configurações salvas continuam em uso.", "Unsaved changes. The saved settings are still in use.") : t("Todas as alterações estão salvas.", "All changes are saved.")}</p>
    <section data-motion-group className="settings-section" aria-labelledby="directories-heading">
      <div className="settings-section-heading"><h2 id="directories-heading">{t("Diretórios", "Folders")}</h2><p>{t("Somente arquivos da primeira camada são organizados", "Only files at the top level are organized")}</p></div>
      <div className="settings-body">
        {(["source", "destination"] as const).map(field => <div className="setting-row directory-row" key={field}><div><h3 id={"directory-" + field}>{field === "source" ? t("Pasta de origem", "Source folder") : t("Destino da organização", "Organization destination")}</h3><p>{field === "source" ? t("Pasta monitorada para receber arquivos", "Monitored folder that receives files") : t("As subpastas de categorias serão criadas aqui", "Category subfolders will be created here")}</p><code>{displayPath(draft[field]) || t("Nenhuma pasta selecionada", "No folder selected")}</code></div><Button variant="outline" size="sm" onClick={() => choose(field)} disabled={busy} aria-label={field === "source" ? t("Selecionar pasta de origem", "Select source folder") : t("Selecionar destino da organização", "Select organization destination")}><FolderOpen aria-hidden="true" />{t("Selecionar", "Select")}</Button></div>)}
        {pickerError && <p className="inline-error" role="alert">{pickerError}</p>}
        <p className="settings-draft-note">{t("Escolha um destino no mesmo volume da origem. A organização entre volumes diferentes não é suportada.", "Choose a destination on the same volume as the source. Organizing across volumes isn't supported.")}</p>
      </div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="automation-heading">
      <div className="settings-section-heading"><h2 id="automation-heading">{t("Organização automática", "Automatic organization")}</h2><p>{t("Preferência aplicada ao salvar", "Preference applied on save")}</p></div>
      <div className="settings-body"><div className="setting-row"><div><label htmlFor="automatic">{t("Organizar novos arquivos", "Organize new files")}</label><p>{t("Monitoramento enquanto o aplicativo estiver aberto", "Monitoring while the app is open")}</p></div><Switch id="automatic" checked={draft.automatic} disabled={busy} onCheckedChange={automatic => setDraft(p => ({ ...p, automatic }))} /></div><div className="notice"><ShieldCheck size={16} aria-hidden="true" /><p>{t("Ao ativar e salvar, você autoriza a movimentação de", "Turning this on and saving authorizes moving")} <strong>{t("novos arquivos", "new files")}</strong> {t("para as categorias abaixo, após 10 segundos sem gravações. Arquivos que já estão na pasta continuam exigindo uma prévia manual. Conflitos e arquivos ocupados são preservados.", "into the categories below, after 10 seconds without writes. Files already in the folder still need a manual preview. Conflicts and busy files are preserved.")}</p></div></div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="rules-heading">
      <div className="settings-section-heading"><h2 id="rules-heading">{t("Categorias habilitadas", "Enabled categories")}</h2><p>{t("Classificação por extensão. Categorias desativadas preservam os arquivos na origem.", "Sorted by extension. Turned-off categories keep their files in the source.")}</p></div>
      <div className="rule-grid">{categories.map(c => <div className="rule" key={c.id}><div><label htmlFor={"rule-" + c.id} className={"tone-" + c.id}><span className="tone-dot" aria-hidden="true" />{c.name}</label><p>{c.extensions.length ? c.extensions.slice(0, 7).map(e => "." + e).join(" ") : t("Sem extensão ou extensão desconhecida", "No extension or unknown extension")}</p></div><Switch id={"rule-" + c.id} checked={draft.enabled_categories.includes(c.id)} disabled={busy} onCheckedChange={enabled => setDraft(p => ({ ...p, enabled_categories: enabled ? [...p.enabled_categories, c.id] : p.enabled_categories.filter(id => id !== c.id) }))} /></div>)}</div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="appearance-label">
      <div className="settings-section-heading"><h2 id="appearance-label">{t("Aparência", "Appearance")}</h2><p>{t("Tema aplicado ao salvar as preferências", "Theme applied when you save the preferences")}</p></div>
      <div className="theme-picker" role="group" aria-labelledby="appearance-label"><Button aria-pressed={draft.theme === "dark"} variant={draft.theme === "dark" ? "secondary" : "ghost"} onClick={() => setDraft(p => ({ ...p, theme: "dark" }))} disabled={busy}><Moon aria-hidden="true" />{t("Escuro", "Dark")}</Button><Button aria-pressed={draft.theme === "light"} variant={draft.theme === "light" ? "secondary" : "ghost"} onClick={() => setDraft(p => ({ ...p, theme: "light" }))} disabled={busy}><Sun aria-hidden="true" />{t("Claro", "Light")}</Button></div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="language-label">
      <div className="settings-section-heading"><h2 id="language-label">{t("Idioma", "Language")}</h2><p>{t("Idioma aplicado ao salvar as preferências", "Language applied when you save the preferences")}</p></div>
      <div className="settings-body"><div className="theme-picker" role="group" aria-labelledby="language-label">{languages().map(item => <Button key={item.id} aria-pressed={draft.language === item.id} variant={draft.language === item.id ? "secondary" : "ghost"} onClick={() => setDraft(p => ({ ...p, language: item.id }))} disabled={busy}>{item.name}</Button>)}</div><p className="settings-draft-note language-note">{t("Novos arquivos vão para pastas com nomes neste idioma, como Documentos ou Documents. Pastas e arquivos que já existem não são movidos.", "New files go to folders named in this language, such as Documents or Documentos. Existing folders and files are not moved.")}</p></div>
    </section>
    <AudioSettings busy={busy} />
    <p className="settings-draft-note">{t("Seu rascunho das preferências principais é mantido ao navegar.", "Your preferences draft is kept while you navigate.")}</p>
  </div>;
}

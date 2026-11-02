import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { CircleHelp, FolderOpen, Moon, Plus, Sun, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { displayPath, type Category, type Preferences, type Rule } from "@/lib/api";
import { t } from "@/lib/i18n";

// Each language keeps its own name, so anyone can find theirs.
const languages = () => [{ id: "system", name: t("System") }, { id: "pt-BR", name: "Português (Brasil)" }, { id: "en", name: "English" }, { id: "es", name: "Español" }, { id: "fr", name: "Français" }, { id: "it", name: "Italiano" }] as const;
import { AudioSettings } from "@/components/audio/audio-settings";
import { firstRuleTutorial, RulesTutorial } from "@/components/rules-tutorial";

export function Settings({ draft, categories, busy, dirty, external, onChange: setDraft, onDiscard, onAcceptExternal }: {
  draft: Preferences; categories: Category[]; busy: boolean; dirty: boolean; external: Preferences | null;
  onChange: (update: (value: Preferences) => Preferences) => void; onDiscard: () => void; onAcceptExternal: () => void;
}) {
  const [pickerError, setPickerError] = useState("");
  const [tutorial, setTutorial] = useState(false);
  async function choose(field: "source" | "destination") {
    try {
      setPickerError("");
      const selected = await open({ directory: true, multiple: false, title: field === "source" ? t("Choose source folder") : t("Choose destination folder") });
      if (typeof selected === "string") setDraft(p => ({ ...p, [field]: selected, ...(field === "source" && p.source === p.destination ? { destination: selected } : {}) }));
    } catch (error) { setPickerError(String(error)); }
  }
  const updateRule = (index: number, change: Partial<Rule>) => setDraft(p => ({ ...p, rules: p.rules.map((rule, i) => i === index ? { ...rule, ...change } : rule) }));
  return <div className="settings-stack">
    {external && <section className="banner error-banner" role="alert"><div><strong>{t("The saved settings were updated")}</strong><p>{t("Your draft was kept. Compare the current version before deciding which to save.")}</p><dl className="external-preferences"><dt>{t("Saved source")}</dt><dd>{displayPath(external.source)}</dd><dt>{t("Saved destination")}</dt><dd>{displayPath(external.destination)}</dd><dt>{t("Saved automation")}</dt><dd>{external.automatic ? t("On") : t("Off")}</dd><dt>{t("Saved categories")}</dt><dd>{categories.filter(c => external.enabled_categories.includes(c.id)).map(c => c.name).join(", ") || t("None")}</dd><dt>{t("Saved theme")}</dt><dd>{external.theme === "dark" ? t("Dark") : t("Light")}</dd><dt>{t("Saved language")}</dt><dd>{languages().find(item => item.id === external.language)?.name}</dd><dt>{t("Saved notifications")}</dt><dd>{external.notifications ? t("On (plural)") : t("Off (plural)")}</dd><dt>{t("Saved updates")}</dt><dd>{external.updates ? t("On (plural)") : t("Off (plural)")}</dd><dt>{t("Saved startup")}</dt><dd>{external.autostart ? t("On") : t("Off")}</dd><dt>{t("Saved rules")}</dt><dd>{external.rules.length}</dd></dl><div className="notice-actions"><Button variant="outline" disabled={busy} onClick={onDiscard}>{t("Discard draft and load current")}</Button><Button variant="outline" disabled={busy} onClick={onAcceptExternal}>{t("Keep draft over this version")}</Button></div></div></section>}
    <p className="draft-status" role="status">{external ? t("The saved settings changed. Review your draft before saving.") : dirty ? t("Unsaved changes. The saved settings are still in use.") : t("All changes are saved.")}</p>
    <section data-motion-group className="settings-section" aria-labelledby="directories-heading">
      <div className="settings-section-heading"><h2 id="directories-heading">{t("Folders")}</h2><p>{t("Only files at the top level are organized")}</p></div>
      <div className="settings-body">
        {(["source", "destination"] as const).map(field => <div className="setting-row directory-row" key={field}><div><h3 id={"directory-" + field}>{field === "source" ? t("Source folder") : t("Organization destination")}</h3><p>{field === "source" ? t("Monitored folder that receives files") : t("Category subfolders will be created here")}</p><code>{displayPath(draft[field]) || t("No folder selected")}</code></div><Button variant="outline" size="sm" onClick={() => choose(field)} disabled={busy} aria-label={field === "source" ? t("Select source folder") : t("Select organization destination")}><FolderOpen aria-hidden="true" />{t("Select")}</Button></div>)}
        {pickerError && <p className="inline-error" role="alert">{pickerError}</p>}
        <p className="settings-draft-note">{t("On another drive, each file is copied, checked and only then removed from the source, which takes longer.")}</p>
      </div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="automation-heading">
      <div className="settings-section-heading"><h2 id="automation-heading">{t("Automatic organization")}</h2><p>{t("Preference applied on save")}</p></div>
      <div className="settings-body"><div className="setting-row"><div><label htmlFor="automatic">{t("Organize new files")}</label><p>{t("When you close the window, the app keeps monitoring from the tray")}</p></div><Switch id="automatic" checked={draft.automatic} disabled={busy} onCheckedChange={automatic => setDraft(p => ({ ...p, automatic }))} /></div><div className="notice"><ShieldCheck size={16} aria-hidden="true" /><p>{t("Turning this on and saving authorizes moving")} <strong>{t("new files")}</strong> {t("into the categories and custom rule folders below, after 10 seconds without writes. Files already in the folder still need a manual preview. Conflicts and busy files are preserved.")}</p></div></div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="system-heading">
      <div className="settings-section-heading"><h2 id="system-heading">{t("Startup, notifications and updates")}</h2><p>{t("Preferences applied on save")}</p></div>
      <div className="settings-body"><div className="setting-row"><div><label htmlFor="autostart">{t("Start with Windows")}</label><p>{t("With automatic organization on, the app starts straight in the tray")}</p></div><Switch id="autostart" checked={draft.autostart} disabled={busy} onCheckedChange={autostart => setDraft(p => ({ ...p, autostart }))} /></div><div className="setting-row"><div><label htmlFor="notifications">{t("Show notifications")}</label><p>{t("Tells you when automation organizes files or hits a problem, if the window isn't in focus")}</p></div><Switch id="notifications" checked={draft.notifications} disabled={busy} onCheckedChange={notifications => setDraft(p => ({ ...p, notifications }))} /></div><div className="setting-row"><div><label htmlFor="updates">{t("Update automatically")}</label><p>{t("Looks for new versions on GitHub every 6 hours. When off, the app doesn't use the internet")}</p></div><Switch id="updates" checked={draft.updates} disabled={busy} onCheckedChange={updates => setDraft(p => ({ ...p, updates }))} /></div></div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="rules-heading">
      <div className="settings-section-heading"><h2 id="rules-heading">{t("Enabled categories")}</h2><p>{t("Sorted by extension. Turned-off categories keep their files in the source, unless a custom rule fits them.")}</p></div>
      <div className="rule-grid">{categories.map(c => <div className="rule" key={c.id}><div><label htmlFor={"rule-" + c.id} className={"tone-" + c.id}><span className="tone-dot" aria-hidden="true" />{c.name}</label><p>{c.extensions.length ? c.extensions.slice(0, 7).map(e => "." + e).join(" ") : t("No extension or unknown extension")}</p></div><Switch id={"rule-" + c.id} checked={draft.enabled_categories.includes(c.id)} disabled={busy} onCheckedChange={enabled => setDraft(p => ({ ...p, enabled_categories: enabled ? [...p.enabled_categories, c.id] : p.enabled_categories.filter(id => id !== c.id) }))} /></div>)}</div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="custom-rules-heading">
      <div className="settings-section-heading"><h2 id="custom-rules-heading">{t("Custom rules")}</h2><p>{t("The first matching rule decides the folder, even if its category is turned off.")}</p></div>
      <div className="settings-body">{draft.rules.map((rule, index) => <div className="custom-rule" key={index}><Input aria-label={t("File name pattern")} placeholder="*.stl" value={rule.pattern} disabled={busy} onChange={event => updateRule(index, { pattern: event.target.value })} /><Input aria-label={t("Folder name")} placeholder={t("3D models")} value={rule.folder} disabled={busy} onChange={event => updateRule(index, { folder: event.target.value })} /><Button variant="ghost" size="icon" aria-label={t("Remove rule")} disabled={busy} onClick={() => setDraft(p => ({ ...p, rules: p.rules.filter((_, i) => i !== index) }))}><Trash2 aria-hidden="true" /></Button></div>)}<div className="notice-actions"><Button variant="outline" size="sm" disabled={busy} onClick={() => { setDraft(p => ({ ...p, rules: [...p.rules, { pattern: "", folder: "" }] })); if (firstRuleTutorial()) setTutorial(true); }}><Plus aria-hidden="true" />{t("Add rule")}</Button><Button variant="ghost" size="sm" onClick={() => { firstRuleTutorial(); setTutorial(true); }}><CircleHelp aria-hidden="true" />{t("How rules work")}</Button></div><p className="settings-draft-note language-note">{t("Use * for any text and ? for one character, such as invoice*.pdf. The folder is created inside the destination.")}</p></div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="appearance-label">
      <div className="settings-section-heading"><h2 id="appearance-label">{t("Appearance")}</h2><p>{t("Theme applied when you save the preferences")}</p></div>
      <div className="theme-picker" role="group" aria-labelledby="appearance-label"><Button aria-pressed={draft.theme === "dark"} variant={draft.theme === "dark" ? "secondary" : "ghost"} onClick={() => setDraft(p => ({ ...p, theme: "dark" }))} disabled={busy}><Moon aria-hidden="true" />{t("Dark")}</Button><Button aria-pressed={draft.theme === "light"} variant={draft.theme === "light" ? "secondary" : "ghost"} onClick={() => setDraft(p => ({ ...p, theme: "light" }))} disabled={busy}><Sun aria-hidden="true" />{t("Light")}</Button></div>
    </section>
    <section data-motion-group className="settings-section" aria-labelledby="language-label">
      <div className="settings-section-heading"><h2 id="language-label">{t("Language")}</h2><p>{t("Language applied when you save the preferences")}</p></div>
      <div className="settings-body"><div className="theme-picker" role="group" aria-labelledby="language-label">{languages().map(item => <Button key={item.id} aria-pressed={draft.language === item.id} variant={draft.language === item.id ? "secondary" : "ghost"} onClick={() => setDraft(p => ({ ...p, language: item.id }))} disabled={busy}>{item.name}</Button>)}</div><p className="settings-draft-note language-note">{t("New files go to folders named in this language, such as Documents or Documentos. Existing folders and files are not moved.")}</p></div>
    </section>
    <AudioSettings busy={busy} />
    {tutorial && <RulesTutorial onClose={() => setTutorial(false)} />}
    <p className="settings-draft-note">{t("Your preferences draft is kept while you navigate.")}</p>
  </div>;
}

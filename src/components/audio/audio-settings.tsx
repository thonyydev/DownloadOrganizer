import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAudioFeedback } from "./audio-provider";
import type { SoundName } from "@/lib/sounds";

const previews: { name: SoundName; label: string }[] = [
  { name: "organize", label: "Organização" }, { name: "restore", label: "Restauração" },
  { name: "warning", label: "Aviso" }, { name: "saved", label: "Confirmação" },
];
export function AudioSettings({ busy = false }: { busy?: boolean }) {
  const { preferences: saved, draft: preferences, dirty, storageError, motionAllowed, update, preview } = useAudioFeedback();
  const percent = Math.round(preferences.volume * 100);
  const previewsDisabled = busy || !preferences.enabled || preferences.volume === 0 || !motionAllowed;
  return <section data-motion-group className="settings-section" aria-labelledby="audio-heading">
    <div className="settings-section-heading"><h2 id="audio-heading">Áudio</h2><p>Personalize os sons de confirmação e o volume do aplicativo.</p></div>
    <div className="settings-body">
      <div className="setting-row"><div><label htmlFor="sound-enabled">Efeitos sonoros</label><p id="sound-description">Confirmações discretas para ações manuais. Automação silenciosa.</p></div><Switch id="sound-enabled" aria-describedby="sound-description" checked={preferences.enabled} disabled={busy} onCheckedChange={enabled => update({ ...preferences, enabled })} /></div>
      <div className="audio-volume"><label htmlFor="sound-volume">Volume <span aria-hidden="true">{percent}%</span></label><input id="sound-volume" type="range" min={0} max={100} step={1} value={percent} disabled={busy} aria-valuetext={`${percent}%`} onChange={event => update({ ...preferences, volume: Number(event.target.value) / 100 })} /></div>
      {preferences.volume !== saved.volume && <p className="audio-note">{!previewsDisabled && <>Teste o novo volume usando os botões abaixo.<br /></>}O novo volume será usado nos testes e salvo ao confirmar as preferências.</p>}
      {!motionAllowed && <p className="audio-note">Efeitos silenciados enquanto Reduzir movimento estiver ativo no sistema. Sua preferência de áudio foi preservada.</p>}
      <div className="audio-previews" role="group" aria-label="Prévia dos efeitos sonoros">{previews.map(sound => <Button key={sound.name} variant="outline" size="sm" disabled={previewsDisabled} onClick={() => preview(sound.name)} aria-label={`Testar som de ${sound.label.toLocaleLowerCase()}`}><Play aria-hidden="true" />{sound.label}</Button>)}</div>
      {storageError && dirty && <p className="inline-error" role="status">O áudio ainda não foi salvo. Tente Salvar preferências novamente ou descarte as alterações.</p>}
    </div>
  </section>;
}

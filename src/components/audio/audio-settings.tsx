import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAudioFeedback } from "./audio-provider";
import type { SoundName } from "@/lib/sounds";
import { t } from "@/lib/i18n";

export function AudioSettings({ busy = false }: { busy?: boolean }) {
  const { preferences: saved, draft: preferences, dirty, storageError, motionAllowed, update, preview } = useAudioFeedback();
  const previews: { name: SoundName; label: string; sound: string }[] = [
    { name: "organize", label: t("Organization"), sound: t("organization") }, { name: "restore", label: t("Restore"), sound: t("restore") },
    { name: "warning", label: t("Warning"), sound: t("warning") }, { name: "saved", label: t("Confirmation"), sound: t("confirmation") },
  ];
  const percent = Math.round(preferences.volume * 100);
  const previewsDisabled = busy || !preferences.enabled || preferences.volume === 0 || !motionAllowed;
  return <section data-motion-group className="settings-section" aria-labelledby="audio-heading">
    <div className="settings-section-heading"><h2 id="audio-heading">{t("Audio")}</h2><p>{t("Customize the app's confirmation sounds and volume.")}</p></div>
    <div className="settings-body">
      <div className="setting-row"><div><label htmlFor="sound-enabled">{t("Sound effects")}</label><p id="sound-description">{t("Subtle confirmations for manual actions. Automation stays silent.")}</p></div><Switch id="sound-enabled" aria-describedby="sound-description" checked={preferences.enabled} disabled={busy} onCheckedChange={enabled => update({ ...preferences, enabled })} /></div>
      <div className="audio-volume"><label htmlFor="sound-volume">{t("Volume")} <span aria-hidden="true">{percent}%</span></label><input id="sound-volume" type="range" min={0} max={100} step={1} value={percent} disabled={busy} aria-valuetext={`${percent}%`} onChange={event => update({ ...preferences, volume: Number(event.target.value) / 100 })} /></div>
      {preferences.volume !== saved.volume && <p className="audio-note">{!previewsDisabled && <>{t("Test the new volume with the buttons below.")}<br /></>}{t("The new volume will be used in tests and saved when you confirm the preferences.")}</p>}
      {!motionAllowed && <p className="audio-note">{t("Effects are muted while Reduce motion is on in the system. Your audio preference was kept.")}</p>}
      <div className="audio-previews" role="group" aria-label={t("Sound effects preview")}>{previews.map(sound => <Button key={sound.name} variant="outline" size="sm" disabled={previewsDisabled} onClick={() => preview(sound.name)} aria-label={`${t("Test sound:")} ${sound.sound}`}><Play aria-hidden="true" />{sound.label}</Button>)}</div>
      {storageError && dirty && <p className="inline-error" role="status">{t("The audio settings aren't saved yet. Try Save preferences again or discard the changes.")}</p>}
    </div>
  </section>;
}

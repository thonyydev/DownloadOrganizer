import { t } from "@/lib/i18n";
import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { SoundProvider, useAnalyser, useSound } from "@web-kits/audio/react";
import type { VoiceHandle } from "@web-kits/audio";
import { sounds, type SoundName } from "@/lib/sounds";

export const audioStorageKey = "download-organizer.audio.v1";
export interface AudioPreferences { enabled: boolean; volume: number }
export const defaultAudio: AudioPreferences = { enabled: true, volume: 0.25 };

function loadAudio(): AudioPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(audioStorageKey) ?? "null");
    if (value && typeof value === "object" && "enabled" in value && typeof value.enabled === "boolean"
      && "volume" in value && typeof value.volume === "number" && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1) {
      return { enabled: value.enabled, volume: value.volume };
    }
  } catch { /* Corrupt or unavailable storage uses safe defaults. */ }
  return defaultAudio;
}

type Players = Record<SoundName, () => VoiceHandle | undefined>;
interface Engine { prepare: () => void; play: (name: SoundName, preview?: boolean) => void; stop: (previewOnly?: boolean) => void }
interface AudioControls {
  preferences: AudioPreferences; draft: AudioPreferences; dirty: boolean; storageError: boolean; motionAllowed: boolean;
  save: (captured?: AudioPreferences) => void; discard: () => void;
  update: (preferences: AudioPreferences) => void; prepare: (forPreview?: boolean) => void; play: (name: SoundName) => void; preview: (name: SoundName) => void;
}
const AudioFeedbackContext = createContext<AudioControls | null>(null);
const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function motionAllowed() { return typeof window.matchMedia !== "function" || !window.matchMedia(motionQuery).matches; }
export function useAudioFeedback() {
  const value = useContext(AudioFeedbackContext);
  if (!value) throw new Error("AudioProvider ausente");
  return value;
}

// In 0.2.0, the React entrypoint has its own engine context. Access it through the
// public analyser instead of ensureReady() from the separate core entrypoint.
// This bridge is mounted synchronously ONLY on a user gesture; no FFT polling.
function PreviewPlayers({ playersRef }: { playersRef: RefObject<Players | null> }) {
  const organize = useSound(sounds.organize), restore = useSound(sounds.restore);
  const warning = useSound(sounds.warning), saved = useSound(sounds.saved);
  useLayoutEffect(() => { playersRef.current = { organize, restore, warning, saved }; return () => { playersRef.current = null; }; }, [playersRef, organize, restore, warning, saved]);
  return null;
}

function AudioEngine({ engineRef, draft, enabled }: { engineRef: RefObject<Engine | null>; draft: AudioPreferences; enabled: boolean }) {
  const analyser = useAnalyser({ fftSize: 32 });
  const context = analyser.node.context as AudioContext;
  const organize = useSound(sounds.organize), restore = useSound(sounds.restore);
  const warning = useSound(sounds.warning), saved = useSound(sounds.saved);
  const voice = useRef<VoiceHandle | undefined>(undefined);
  const previewVoice = useRef(false);
  const lifecycle = useRef(0);
  const previewPlayers = useRef<Players | null>(null);
  const engine = useMemo<Engine>(() => ({
    prepare() { if (context.state === "suspended") void context.resume().catch(() => {}); },
    play(name, preview) {
      // Never schedule an audible voice in a suspended context to play later.
      if (context.state !== "running") return;
      voice.current?.stop(0.015);
      previewVoice.current = !!preview;
      voice.current = (preview ? previewPlayers.current : { organize, restore, warning, saved })?.[name]();
    },
    stop(previewOnly) { if (previewOnly && !previewVoice.current) return; try { voice.current?.stop(0.015); } catch { /* Best-effort audio cleanup. */ } voice.current = undefined; },
  }), [context, organize, restore, warning, saved]);
  useLayoutEffect(() => { engineRef.current = engine; return () => { engineRef.current = null; }; }, [engine, engineRef]);
  useEffect(() => {
    const generation = ++lifecycle.current;
    return () => {
      engine.stop();
      // StrictMode replays effects; close only on an actual unmount.
      queueMicrotask(() => { if (lifecycle.current === generation && context.state !== "closed") void context.close().catch(() => {}); });
    };
  }, [context, engine]);
  return <SoundProvider enabled={draft.enabled && enabled} volume={draft.volume}><PreviewPlayers playersRef={previewPlayers} /></SoundProvider>;
}

class AudioUnavailable extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(loadAudio);
  const [draft, setDraft] = useState(preferences);
  const [storageError, setStorageError] = useState(false);
  const [started, setStarted] = useState(false);
  const canMove = useSyncExternalStore(subscribeMotion, motionAllowed, () => false);
  const engineRef = useRef<Engine | null>(null);
  const allowed = useRef(false);
  const previewAllowed = useRef(false);
  allowed.current = preferences.enabled && preferences.volume > 0 && canMove;
  previewAllowed.current = draft.enabled && draft.volume > 0 && canMove;
  const dirty = preferences.enabled !== draft.enabled || preferences.volume !== draft.volume;
  const update = useCallback((next: AudioPreferences) => {
    const safe = { enabled: next.enabled, volume: Math.min(1, Math.max(0, Number.isFinite(next.volume) ? next.volume : defaultAudio.volume)) };
    setDraft(safe);
  }, []);
  const save = useCallback((captured = draft) => {
    try { localStorage.setItem(audioStorageKey, JSON.stringify(captured)); }
    catch {
      setStorageError(true);
      throw new Error(t("Não foi possível salvar o áudio neste dispositivo. O rascunho não foi confirmado.", "Could not save the audio settings on this device. The draft was not confirmed."));
    }
    // Apply the saved provider values before the terminal confirmation can play.
    flushSync(() => { setPreferences(captured); setDraft(current => current === captured ? captured : current); setStorageError(false); });
  }, [draft]);
  const discard = useCallback(() => { setDraft(preferences); setStorageError(false); }, [preferences]);
  const prepareEngine = useCallback((preview = false) => {
    if (!(preview ? previewAllowed.current : allowed.current)) return;
    try {
      if (!engineRef.current && typeof window.AudioContext === "function") flushSync(() => setStarted(true));
      engineRef.current?.prepare();
    } catch { /* Audio must never interrupt the user's action. */ }
  }, []);
  const playEngine = useCallback((name: SoundName, preview = false) => {
    if (!(preview ? previewAllowed.current : allowed.current)) return;
    try { engineRef.current?.play(name, preview); } catch { /* Visual feedback remains authoritative. */ }
  }, []);
  const play = useCallback((name: SoundName) => playEngine(name), [playEngine]);
  const preview = useCallback((name: SoundName) => { prepareEngine(true); playEngine(name, true); }, [prepareEngine, playEngine]);
  useEffect(() => { engineRef.current?.stop(); }, [preferences, canMove]);
  useEffect(() => { engineRef.current?.stop(true); }, [draft]);
  return <SoundProvider enabled={preferences.enabled && canMove} volume={preferences.volume}>
    {started && <AudioUnavailable><AudioEngine engineRef={engineRef} draft={draft} enabled={canMove} /></AudioUnavailable>}
    <AudioFeedbackContext value={{ preferences, draft, dirty, storageError, motionAllowed: canMove, update, save, discard, prepare: prepareEngine, play, preview }}>{children}</AudioFeedbackContext>
  </SoundProvider>;
}

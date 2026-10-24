import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMotionAllowed } from "@/components/motion/feedback";
import { api, type FileEntry, type MediaPreview } from "@/lib/api";
import { errorMessage } from "@/lib/experience";

export const mediaExtensions = new Set(["mp3", "wav", "ogg", "oga", "m4a", "flac", "mp4", "m4v", "mov", "webm"]);
export function mediaTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
export interface MediaPlayerHandle { stop: () => void }
export interface MediaMetadata { duration: number; width: number; height: number }

export function MediaPreviewPlayer({ file, ref, onMetadata }: { file: FileEntry; ref: Ref<MediaPlayerHandle>; onMetadata: (metadata: MediaMetadata) => void }) {
  const media = useRef<HTMLMediaElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Keep the node until cleanup even if React has already detached its ref.
  const attachMedia = useCallback((element: HTMLMediaElement | null) => { if (element) { media.current = element; element.volume = 0.5; } }, []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cancel = useRef<() => void>(() => {});
  const graph = useRef<{ context: AudioContext; source: MediaElementAudioSourceNode; analyser: AnalyserNode } | null>(null);
  const frame = useRef(0);
  const stopped = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenPending, setFullscreenPending] = useState(false);
  const [session, setSession] = useState<MediaPreview | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState("");
  const motion = useMotionAllowed();

  const release = useCallback(() => {
    stopped.current = true;
    cancelAnimationFrame(frame.current);
    const element = media.current;
    media.current = null;
    if (element) { element.pause(); element.removeAttribute("src"); element.load(); }
    const nodes = graph.current;
    graph.current = null;
    if (nodes) { nodes.source.disconnect(); nodes.analyser.disconnect(); void nodes.context.close().catch(() => {}); }
    const container = root.current ?? element?.closest(".media-preview-player");
    if (container?.contains(document.fullscreenElement)) void document.exitFullscreen().catch(() => {});
  }, []);
  useImperativeHandle(ref, () => ({ stop: () => { cancel.current(); release(); } }), [release]);
  useEffect(() => {
    stopped.current = false;
    let active = true;
    let token: string | null = null;
    const close = () => { active = false; if (token) { void api.closeMediaPreview(token).catch(() => {}); token = null; } };
    cancel.current = close;
    api.openMediaPreview(file).then(result => {
      token = result.token;
      if (!active) { close(); return; }
      if (!/^[a-f0-9]{64}$/.test(result.token) || !["audio", "video"].includes(result.kind) || !/^(audio|video)\/[a-z0-9-]+$/.test(result.mime)) {
        close(); setError("Não foi possível abrir uma sessão segura de mídia."); return;
      }
      const probe = document.createElement(result.kind);
      if (!probe.canPlayType(result.mime)) { close(); setError("Este formato ou codec não é compatível com o player deste Windows."); return; }
      setSession(result);
    }).catch(reason => { if (active) setError(errorMessage(reason)); });
    return () => { close(); release(); };
  }, [file, release]);

  useEffect(() => {
    const nodes = graph.current;
    const target = canvas.current;
    if (!nodes || !target || !playing || !motion) return;
    const painter = target.getContext("2d");
    if (!painter) return;
    const values = new Uint8Array(nodes.analyser.frequencyBinCount);
    let previous = 0;
    const color = getComputedStyle(target).color;
    function draw(now: number) {
      if (now - previous >= 32 && painter && target) {
        previous = now;
        nodes!.analyser.getByteFrequencyData(values);
        painter.clearRect(0, 0, target.width, target.height);
        painter.fillStyle = color;
        const bars = 32, width = target.width / bars;
        for (let i = 0; i < bars; i++) {
          const height = values[i * Math.floor(values.length / bars)] / 255 * target.height;
          painter.fillRect(i * width + 2, target.height - height, width - 4, height);
        }
      }
      frame.current = requestAnimationFrame(draw);
    }
    frame.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame.current); painter.clearRect(0, 0, target.width, target.height); };
  }, [playing, motion]);

  useEffect(() => {
    const sync = () => setFullscreen(root.current?.contains(document.fullscreenElement) ?? false);
    const failed = (event: Event) => {
      if (!stopped.current && (event.target === document || root.current?.contains(event.target as Node))) {
        setNotice("Não foi possível alterar a tela cheia. Se necessário, pressione Escape para sair.");
      }
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("fullscreenerror", failed);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("fullscreenerror", failed);
    };
  }, []);

  async function toggleFullscreen() {
    const element = root.current;
    if (!element || fullscreenPending || stopped.current) return;
    const exiting = element.contains(document.fullscreenElement);
    setFullscreenPending(true);
    setNotice("");
    try {
      if (exiting) await document.exitFullscreen();
      else {
        await element.requestFullscreen();
        // Closing the dialog can race an in-flight native fullscreen request.
        if (stopped.current && element.contains(document.fullscreenElement)) await document.exitFullscreen();
      }
    } catch {
      if (!stopped.current) setNotice(exiting ? "Não foi possível sair da tela cheia. Pressione Escape para sair." : "Não foi possível abrir a tela cheia. Use a visualização nesta janela.");
    } finally {
      if (!stopped.current) {
        setFullscreen(root.current?.contains(document.fullscreenElement) ?? false);
        setFullscreenPending(false);
      }
    }
  }

  const fail = (message: string) => { setError(message); setPlaying(false); cancel.current(); release(); };
  async function togglePlayback() {
    const element = media.current;
    if (!element || !ready) return;
    if (!element.paused) { element.pause(); return; }
    // Create/resume Web Audio only in the user's play gesture; failure leaves native playback usable.
    if (session?.kind === "audio" && !graph.current && typeof AudioContext !== "undefined") {
      let context: AudioContext | null = null;
      try {
        context = new AudioContext();
        const source = context.createMediaElementSource(element);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser); analyser.connect(context.destination);
        graph.current = { context, source, analyser };
      } catch { if (context) void context.close().catch(() => {}); }
    }
    const nodes = graph.current;
    if (nodes) void nodes.context.resume().catch(() => {});
    try { await element.play(); }
    catch { setNotice("Não foi possível iniciar a reprodução. Tente novamente; o codec pode não ser compatível."); }
  }
  const updateMetadata = () => {
    const element = media.current;
    if (!element) return;
    const width = element instanceof HTMLVideoElement ? element.videoWidth : 0;
    const height = element instanceof HTMLVideoElement ? element.videoHeight : 0;
    if (width > 4096 || height > 4096 || width * height > 8_294_400) { fail("O vídeo excede o limite de visualização de 4K (8,3 megapixels)."); return; }
    const seconds = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;
    setDuration(seconds);
    setReady(seconds > 0);
    onMetadata({ duration: seconds, width, height });
  };
  const source = session ? convertFileSrc(session.token, "media-preview") : undefined;
  const events = {
    crossOrigin: "anonymous" as const, preload: "metadata", src: source,
    onLoadedMetadata: updateMetadata, onDurationChange: updateMetadata,
    onCanPlay: () => { setReady(true); setNotice(""); },
    onPlay: () => { setPlaying(true); setNotice(""); }, onPause: () => setPlaying(false), onEnded: () => setPlaying(false),
    onTimeUpdate: () => setPosition(media.current?.currentTime ?? 0),
    onVolumeChange: () => { setVolume(media.current?.volume ?? 0.5); setMuted(media.current?.muted ?? false); },
    onWaiting: () => setNotice("Carregando mídia…"),
    onError: () => { if (media.current?.getAttribute("src")) fail("Não foi possível reproduzir a mídia. O codec pode não ser compatível, o arquivo pode estar danificado ou ter mudado."); },
  };
  return <div className="media-preview-player" ref={root}>
    {error ? <p className="inline-error" role="alert">{error}</p> : <>
      {!session && <p role="status">Preparando mídia…</p>}
      {session?.kind === "video" ? <video aria-label={`Vídeo: ${file.name}`} ref={attachMedia} {...events} playsInline />
        : session && <><audio aria-label={`Áudio: ${file.name}`} ref={attachMedia} {...events} /><canvas ref={canvas} width={640} height={100} className="audio-spectrum" aria-hidden="true" /><p className="media-preview-caption">{playing ? "Reproduzindo áudio" : "Áudio pronto para reprodução"}{!motion ? " · Visualizador pausado" : ""}</p></>}
      {session && !ready && <p role="status">Lendo informações da mídia…</p>}
      {notice && <p className="media-preview-caption">{notice}</p>}
      {session && <div className="media-controls">
        <Button variant="outline" size="sm" disabled={!ready} aria-label={playing ? "Pausar" : "Reproduzir"} onClick={() => void togglePlayback()}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>
        <label className="media-seek"><span className="sr-only">Posição da reprodução</span><input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(position, duration)} disabled={!duration} onChange={event => { const value = Number(event.target.value); if (media.current) { media.current.currentTime = value; setPosition(value); } }} aria-valuetext={`${mediaTime(position)} de ${mediaTime(duration)}`} /></label>
        <span className="media-time">{mediaTime(position)} / {duration ? mediaTime(duration) : "—"}</span>
        <Button variant="ghost" size="sm" aria-label={muted ? "Ativar som" : "Silenciar"} aria-pressed={muted} onClick={() => { if (media.current) media.current.muted = !muted; }}>{muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button>
        <label className="media-volume"><span className="sr-only">Volume da mídia</span><input type="range" min={0} max={1} step={0.01} value={volume} onChange={event => { if (media.current) media.current.volume = Number(event.target.value); }} aria-valuetext={`${Math.round(volume * 100)}%`} /></label>
        {session.kind === "video" && <Button variant="ghost" size="sm" aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"} aria-pressed={fullscreen} disabled={fullscreenPending} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}</Button>}
      </div>}
    </>}
  </div>;
}

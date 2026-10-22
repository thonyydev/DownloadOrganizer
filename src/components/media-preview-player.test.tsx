import { createRef, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPreviewPlayer, mediaTime, type MediaPlayerHandle } from "./media-preview-player";
import { FilePreviewDialog } from "./file-preview-dialog";
import { api, type FileEntry, type MediaPreview } from "@/lib/api";

const environment = vi.hoisted(() => ({ motion: true }));
vi.mock("@/components/motion/feedback", () => ({ useMotionAllowed: () => environment.motion }));
vi.mock("@tauri-apps/api/core", async original => ({ ...await original<typeof import("@tauri-apps/api/core")>(), convertFileSrc: (token: string) => `http://media-preview.localhost/${token}` }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: { openMediaPreview: vi.fn(), closeMediaPreview: vi.fn(), filePreview: vi.fn() } }));
const audio: FileEntry = { name: "sample.wav", path: "/isolated/sample.wav", destination: "/isolated/audio/sample.wav", extension: "wav", category: "audio", size: 256, modified: 1700000000000, status: "ready", reason: null };
const video = { ...audio, name: "sample.mp4", path: "/isolated/sample.mp4", extension: "mp4", category: "videos" };
const descriptor: MediaPreview = { token: "a".repeat(64), kind: "audio", mime: "audio/wav" };
const metadata = vi.fn();
const originalFullscreen = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
const originalExitFullscreen = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
const analyser = { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128, connect: vi.fn(), disconnect: vi.fn(), getByteFrequencyData: vi.fn((values: Uint8Array) => values.fill(128)) };
const node = { connect: vi.fn(), disconnect: vi.fn() };
const context = { createMediaElementSource: vi.fn(() => node), createAnalyser: vi.fn(() => analyser), resume: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.resolve()) };
let contexts: number;
function ready(element: HTMLMediaElement, duration = 125) {
  Object.defineProperty(element, "duration", { value: duration, configurable: true });
  fireEvent.loadedMetadata(element);
}
async function mount(file = audio) {
  const ref = createRef<MediaPlayerHandle>();
  const view = render(<MediaPreviewPlayer file={file} ref={ref} onMetadata={metadata} />);
  const element = await screen.findByLabelText(`${file === video ? "Vídeo" : "Áudio"}: ${file.name}`) as HTMLMediaElement;
  return { ...view, element, ref };
}
beforeEach(() => {
  vi.clearAllMocks(); contexts = 0; environment.motion = true;
  vi.mocked(api.openMediaPreview).mockResolvedValue(descriptor);
  vi.mocked(api.closeMediaPreview).mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: false, configurable: true });
    this.dispatchEvent(new Event("play")); return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal("AudioContext", class { constructor() { contexts++; return context; } });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: "" } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  cleanup();
  if (originalFullscreen) Object.defineProperty(document, "fullscreenElement", originalFullscreen);
  else Reflect.deleteProperty(document, "fullscreenElement");
  if (originalExitFullscreen) Object.defineProperty(document, "exitFullscreen", originalExitFullscreen);
  else Reflect.deleteProperty(document, "exitFullscreen");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("player seguro de mídia", () => {
  it("não reproduz ao abrir; reproduz/pausa áudio, faz seek e controla volume/mute", async () => {
    const { element } = await mount();
    expect(element.autoplay).toBe(false);
    expect(element.preload).toBe("metadata");
    expect(element.crossOrigin).toBe("anonymous");
    expect(element.volume).toBe(0.5);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(contexts).toBe(0);
    ready(element);
    expect(screen.getByText("0:00 / 2:05")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    await screen.findByRole("button", { name: "Pausar" });
    expect(contexts).toBe(1);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(node.connect).toHaveBeenCalledWith(analyser);
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    expect(element.paused).toBe(true);
    fireEvent.change(screen.getByRole("slider", { name: "Posição da reprodução" }), { target: { value: "45" } });
    expect(element.currentTime).toBe(45);
    expect(screen.getByText("0:45 / 2:05")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Volume da mídia" }), { target: { value: "0.2" } });
    expect(element.volume).toBe(0.2);
    expect(screen.getByRole("slider", { name: "Volume da mídia" }).getAttribute("aria-valuetext")).toBe("20%");
    fireEvent.click(screen.getByRole("button", { name: "Silenciar" }));
    expect(element.muted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Ativar som" }));
    expect(element.muted).toBe(false);
    fireEvent.change(screen.getByRole("slider", { name: "Volume da mídia" }), { target: { value: "0" } });
    expect(element.volume).toBe(0);
    fireEvent.timeUpdate(element);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });

  it("reproduz e pausa vídeo, obtém duração/resolução e permite tela cheia sem autoplay", async () => {
    vi.mocked(api.openMediaPreview).mockResolvedValue({ ...descriptor, kind: "video", mime: "video/mp4" });
    const { element } = await mount(video);
    Object.defineProperties(element, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
    ready(element, 90);
    expect(metadata).toHaveBeenLastCalledWith({ duration: 90, width: 1920, height: 1080 });
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    await screen.findByRole("button", { name: "Pausar" });
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    expect(element.paused).toBe(true);
    expect(contexts).toBe(0);
    const fullscreen = vi.fn().mockResolvedValue(undefined);
    element.parentElement!.requestFullscreen = fullscreen;
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(fullscreen).toHaveBeenCalledOnce();
    expect(element.parentElement!.contains(screen.getByRole("button", { name: "Reproduzir" }))).toBe(true);
  });

  it("usa frequências reais apenas durante a reprodução e para ao ativar reduced motion", async () => {
    const view = await mount(); ready(view.element);
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    await screen.findByRole("button", { name: "Pausar" });
    const calls = vi.mocked(requestAnimationFrame).mock.calls;
    const callback = calls[calls.length - 1][0];
    act(() => callback(100));
    expect(analyser.getByteFrequencyData).toHaveBeenCalledOnce();
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
    environment.motion = false;
    view.rerender(<MediaPreviewPlayer file={audio} ref={view.ref} onMetadata={metadata} />);
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(screen.getByText(/Visualizador pausado/)).toBeTruthy();
    expect(api.openMediaPreview).toHaveBeenCalledOnce();
  });

  it("recusa codecs incompatíveis, sessões inválidas e falhas de autorização", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");
    const view = await mountError();
    expect(screen.getByRole("alert").textContent).toContain("codec");
    expect(api.closeMediaPreview).toHaveBeenCalledWith(descriptor.token);
    view.unmount();
    vi.mocked(api.openMediaPreview).mockResolvedValue({ ...descriptor, token: "../../unsafe" });
    const second = await mountError();
    expect(screen.getByRole("alert").textContent).toContain("sessão segura");
    second.unmount();
    vi.mocked(api.openMediaPreview).mockRejectedValue("Arquivo removido ou não autorizado.");
    await mountError();
    expect(screen.getByRole("alert").textContent).toContain("não autorizado");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("mostra erros nativos, excedentes de resolução e falha de play sem prometer codecs", async () => {
    const first = await mount(); ready(first.element);
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("codec"));
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    await screen.findByText(/Não foi possível iniciar/);
    fireEvent.error(first.element);
    expect(screen.getByRole("alert").textContent).toContain("danificado ou ter mudado");
    expect(api.closeMediaPreview).toHaveBeenCalledWith(descriptor.token);
    first.unmount();
    vi.mocked(api.openMediaPreview).mockResolvedValue({ ...descriptor, kind: "video", mime: "video/mp4" });
    const second = await mount(video);
    Object.defineProperties(second.element, { videoWidth: { value: 8000 }, videoHeight: { value: 8000 } });
    ready(second.element);
    expect(screen.getByRole("alert").textContent).toContain("4K");
    expect(second.element.getAttribute("src")).toBeNull();
  });

  it("fecha uma solicitação tardia e não permite que substitua o arquivo atual", async () => {
    let resolve!: (result: MediaPreview) => void;
    vi.mocked(api.openMediaPreview).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ ...descriptor, kind: "video", mime: "video/mp4" });
    const ref = createRef<MediaPlayerHandle>();
    const view = render(<MediaPreviewPlayer file={audio} ref={ref} onMetadata={metadata} />);
    view.rerender(<MediaPreviewPlayer key="video" file={video} ref={ref} onMetadata={metadata} />);
    await screen.findByLabelText(`Vídeo: ${video.name}`);
    await act(async () => resolve({ ...descriptor, token: "b".repeat(64) }));
    expect(api.closeMediaPreview).toHaveBeenCalledWith("b".repeat(64));
    expect(screen.getByLabelText(`Vídeo: ${video.name}`).getAttribute("src")).toContain(descriptor.token);
    view.unmount();
    expect(api.closeMediaPreview).toHaveBeenCalledWith(descriptor.token);
  });

  it.each(["X", "Escape"])("interrompe e libera recursos pelo %s, restaurando o foco", async method => {
    function Harness() {
      const [selected, setSelected] = useState<FileEntry | null>(null);
      const trigger = useRef<HTMLButtonElement>(null);
      return <><button ref={trigger} onClick={() => setSelected(audio)}>Abrir mídia</button><FilePreviewDialog file={selected} categories={[]} onClose={() => setSelected(null)} onRestoreFocus={() => trigger.current?.focus()} /></>;
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Abrir mídia" });
    fireEvent.click(trigger);
    const element = await screen.findByLabelText(`Áudio: ${audio.name}`) as HTMLMediaElement;
    ready(element);
    expect(screen.getByText("2:05")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    await screen.findByRole("button", { name: "Pausar" });
    const dialog = screen.getByRole("dialog");
    if (method === "X") fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    else fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(element.paused).toBe(true);
    expect(element.getAttribute("src")).toBeNull();
    expect(context.close).toHaveBeenCalledOnce();
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(analyser.disconnect).toHaveBeenCalledOnce();
    expect(api.closeMediaPreview).toHaveBeenCalledExactlyOnceWith(descriptor.token);
    expect(api.filePreview).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("mantém controles de teclado e limpa imediatamente antes da desmontagem visual", async () => {
    const view = await mount(); ready(view.element);
    const play = screen.getByRole("button", { name: "Reproduzir" });
    play.focus(); expect(document.activeElement).toBe(play);
    expect(screen.getByRole("slider", { name: "Posição da reprodução" }).getAttribute("aria-valuetext")).toBe("0:00 de 2:05");
    act(() => view.ref.current!.stop());
    expect(view.element.getAttribute("src")).toBeNull();
    expect(api.closeMediaPreview).toHaveBeenCalledExactlyOnceWith(descriptor.token);
    view.unmount();
    expect(api.closeMediaPreview).toHaveBeenCalledOnce();
  });
});
function fullscreenApi(element: HTMLElement) {
  let current: Element | null = null;
  const change = (value: Element | null) => { current = value; document.dispatchEvent(new Event("fullscreenchange")); };
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
  const request = vi.fn(async () => change(element));
  const exit = vi.fn(async () => change(null));
  element.requestFullscreen = request;
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
  return { request, exit, change };
}
async function fullscreenVideo() {
  vi.mocked(api.openMediaPreview).mockResolvedValue({ ...descriptor, kind: "video", mime: "video/mp4" });
  const view = await mount(video);
  ready(view.element, 90);
  const container = view.element.parentElement!;
  return { ...view, container, fullscreen: fullscreenApi(container) };
}

describe("alternância de tela cheia", () => {
  it("entra e sai pelo mesmo botão repetidamente sem interromper reprodução, posição ou volume", async () => {
    const view = await fullscreenVideo();
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    await screen.findByRole("button", { name: "Pausar" });
    view.element.currentTime = 24;
    view.element.volume = 0.3;
    for (let cycle = 0; cycle < 3; cycle++) {
      const button = screen.getByRole("button", { name: "Tela cheia" });
      fireEvent.click(button);
      await waitFor(() => expect((screen.getByRole("button", { name: "Sair da tela cheia" }) as HTMLButtonElement).disabled).toBe(false));
      expect(document.fullscreenElement).toBe(view.container);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(view.container.contains(screen.getByRole("button", { name: "Pausar" }))).toBe(true);
      expect(view.container.contains(screen.getByRole("slider", { name: "Volume da mídia" }))).toBe(true);
      fireEvent.click(button);
      await waitFor(() => expect((screen.getByRole("button", { name: "Tela cheia" }) as HTMLButtonElement).disabled).toBe(false));
      expect(document.fullscreenElement).toBeNull();
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(view.element.paused).toBe(false);
      expect(view.element.currentTime).toBe(24);
      expect(view.element.volume).toBe(0.3);
    }
    expect(view.fullscreen.request).toHaveBeenCalledTimes(3);
    expect(view.fullscreen.exit).toHaveBeenCalledTimes(3);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(api.openMediaPreview).toHaveBeenCalledOnce();
  });

  it("sincroniza o botão com fullscreenchange, inclusive a saída nativa por Escape", async () => {
    const view = await fullscreenVideo();
    act(() => view.fullscreen.change(view.container));
    expect(screen.getByRole("button", { name: "Sair da tela cheia" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(view.container, { key: "Escape" });
    // JSDOM does not implement native Escape: emulate the resulting browser event.
    act(() => view.fullscreen.change(null));
    expect(screen.getByRole("button", { name: "Tela cheia" }).getAttribute("aria-pressed")).toBe("false");
    act(() => view.fullscreen.change(document.body));
    expect(screen.getByRole("button", { name: "Tela cheia" }).getAttribute("aria-pressed")).toBe("false");
    expect(view.fullscreen.request).not.toHaveBeenCalled();
    expect(view.fullscreen.exit).not.toHaveBeenCalled();
  });

  it("trata rejeições de entrada e saída sem indicar um estado falso e permite tentar novamente", async () => {
    const view = await fullscreenVideo();
    view.fullscreen.request.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    await screen.findByText("Não foi possível abrir a tela cheia. Use a visualização nesta janela.");
    expect(screen.getByRole("button", { name: "Tela cheia" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Sair da tela cheia" }) as HTMLButtonElement).disabled).toBe(false));
    view.fullscreen.exit.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia" }));
    await screen.findByText("Não foi possível sair da tela cheia. Pressione Escape para sair.");
    expect(document.fullscreenElement).toBe(view.container);
    expect(screen.getByRole("button", { name: "Sair da tela cheia" }).getAttribute("aria-pressed")).toBe("true");
    act(() => view.fullscreen.change(null));
    expect(screen.getByRole("button", { name: "Tela cheia" })).toBeTruthy();
  });

  it("trata fullscreenerror e remove os listeners ao desmontar, sem duplicá-los em rerenders", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const view = await fullscreenVideo();
    view.rerender(<MediaPreviewPlayer file={video} ref={view.ref} onMetadata={metadata} />);
    fireEvent(view.container, new Event("fullscreenerror", { bubbles: true }));
    expect(screen.getByText(/Não foi possível alterar a tela cheia/)).toBeTruthy();
    for (const type of ["fullscreenchange", "fullscreenerror"]) {
      const listeners = add.mock.calls.filter(([name]) => name === type);
      expect(listeners).toHaveLength(1);
    }
    view.unmount();
    for (const type of ["fullscreenchange", "fullscreenerror"]) {
      const listener = add.mock.calls.find(([name]) => name === type)![1];
      expect(remove).toHaveBeenCalledWith(type, listener);
    }
  });

  it("sai da tela cheia ao fechar o modal e restaura o foco", async () => {
    vi.mocked(api.openMediaPreview).mockResolvedValue({ ...descriptor, kind: "video", mime: "video/mp4" });
    function Harness() {
      const [file, setFile] = useState<FileEntry | null>(null);
      const trigger = useRef<HTMLButtonElement>(null);
      return <><button ref={trigger} onClick={() => setFile(video)}>Abrir vídeo</button><FilePreviewDialog file={file} categories={[]} onClose={() => setFile(null)} onRestoreFocus={() => trigger.current?.focus()} /></>;
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Abrir vídeo" });
    fireEvent.click(trigger);
    const element = await screen.findByLabelText(`Vídeo: ${video.name}`) as HTMLMediaElement;
    ready(element);
    const fullscreen = fullscreenApi(element.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    await screen.findByRole("button", { name: "Sair da tela cheia" });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.fullscreenElement).toBeNull();
    expect(fullscreen.exit).toHaveBeenCalledOnce();
    expect(element.paused).toBe(true);
    expect(element.getAttribute("src")).toBeNull();
    expect(api.closeMediaPreview).toHaveBeenCalledExactlyOnceWith(descriptor.token);
    expect(document.activeElement).toBe(trigger);
  });

  it("encerra uma entrada em fullscreen que termina depois do fechamento", async () => {
    const view = await fullscreenVideo();
    let finish!: () => void;
    view.fullscreen.request.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { view.fullscreen.change(view.container); resolve(); }; }));
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect((screen.getByRole("button", { name: "Tela cheia" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => view.ref.current!.stop());
    await act(async () => finish());
    expect(document.fullscreenElement).toBeNull();
    expect(view.fullscreen.exit).toHaveBeenCalledOnce();
    view.unmount();
    expect(view.fullscreen.exit).toHaveBeenCalledOnce();
  });
});

async function mountError() {
  const view = render(<MediaPreviewPlayer file={audio} ref={createRef()} onMetadata={metadata} />);
  await screen.findByRole("alert"); return view;
}
it("formata tempos reais sem inventar duração", () => {
  expect(mediaTime(125.5)).toBe("2:05"); expect(mediaTime(0)).toBe("0:00");
  expect(mediaTime(NaN)).toBe("—"); expect(mediaTime(Infinity)).toBe("—"); expect(mediaTime(-1)).toBe("—");
});

import { StrictMode, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioProvider, audioStorageKey, useAudioFeedback } from "./audio-provider";
import { AudioSettings } from "./audio-settings";
import { sounds } from "@/lib/sounds";

const mocks = vi.hoisted(() => ({
  played: vi.fn(), stop: vi.fn(), provider: vi.fn(), unavailable: false,
  context: { state: "running", resume: vi.fn(), close: vi.fn() },
}));
vi.mock("@web-kits/audio/react", async () => {
  const { createContext, useContext, useRef, useCallback } = await import("react");
  const context = createContext({ enabled: true, volume: 1 });
  return {
  SoundProvider: (props: { enabled: boolean; volume: number; children: ReactNode }) => { mocks.provider(props.enabled, props.volume); return <context.Provider value={props}>{props.children}</context.Provider>; },
  useAnalyser: () => { if (mocks.unavailable) throw new Error("Audio API unavailable"); return { node: { context: mocks.context } }; },
  useSound: (definition: unknown) => {
    const state = useContext(context), ref = useRef(state); ref.current = state;
    return useCallback(() => { if (!ref.current.enabled || !ref.current.volume) return undefined; mocks.played(definition, ref.current.volume); return { stop: mocks.stop }; }, [definition]);
  },
}; });
function Harness({ busy = false }: { busy?: boolean }) {
  const audio = useAudioFeedback();
  const [error, setError] = useState("");
  return <><AudioSettings busy={busy} /><output data-testid="dirty">{audio.dirty ? "dirty" : "clean"}</output><button onClick={() => { try { audio.save(); } catch (e) { setError(String(e)); } }}>Salvar áudio</button><button onClick={audio.discard}>Descartar áudio</button><p>{error}</p><button onClick={() => { audio.prepare(); audio.play("organize"); }}>Concluir ação</button></>;
}
function start(busy = false) { return render(<StrictMode><AudioProvider><Harness busy={busy} /></AudioProvider></StrictMode>); }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); mocks.context.state = "running"; mocks.unavailable = false;
  mocks.context.resume.mockResolvedValue(undefined); mocks.context.close.mockResolvedValue(undefined);
  vi.stubGlobal("AudioContext", class {});
});
afterEach(async () => { cleanup(); await Promise.resolve(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("preferências e reprodução de áudio", () => {
  it("explica apenas o volume pendente e remove a mensagem ao restaurar, salvar ou descartar", () => {
    start(); const pending = /O novo volume será usado nos testes e salvo ao confirmar as preferências\./;
    expect(screen.queryByText(pending)).toBeNull();
    fireEvent.click(screen.getByRole("switch")); expect(screen.queryByText(pending)).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    const slider = screen.getByRole("slider", { name: "Volume" });
    fireEvent.change(slider, { target: { value: "40" } });
    const message = screen.getByText(pending);
    expect(message.textContent).toContain("Teste o novo volume usando os botões abaixo.");
    expect(slider.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(message.compareDocumentPosition(screen.getByRole("group", { name: "Prévia dos efeitos sonoros" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(message.closest("[aria-live], [role=status], [role=alert]")).toBeNull();
    fireEvent.change(slider, { target: { value: "50" } }); expect(screen.getByText(pending)).toBe(message);
    fireEvent.change(slider, { target: { value: "25" } }); expect(screen.queryByText(pending)).toBeNull();
    fireEvent.change(slider, { target: { value: "40" } }); fireEvent.click(screen.getByRole("button", { name: "Salvar áudio" }));
    expect(screen.queryByText(pending)).toBeNull();
    fireEvent.change(slider, { target: { value: "60" } }); fireEvent.click(screen.getByRole("button", { name: "Descartar áudio" }));
    expect(screen.queryByText(pending)).toBeNull();
  });
  it.each(["disabled", "zero", "busy", "reduced"])("não sugere testar prévias indisponíveis: %s", reason => {
    if (reason === "reduced") vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const view = start();
    fireEvent.change(screen.getByRole("slider"), { target: { value: reason === "zero" ? "0" : "40" } });
    if (reason === "disabled") fireEvent.click(screen.getByRole("switch"));
    if (reason === "busy") view.rerender(<StrictMode><AudioProvider><Harness busy /></AudioProvider></StrictMode>);
    expect(screen.getByText("O novo volume será usado nos testes e salvo ao confirmar as preferências.")).toBeTruthy();
    expect(screen.queryByText(/Teste o novo volume usando os botões abaixo\./)).toBeNull();
    const buttons = within(screen.getByRole("group", { name: "Prévia dos efeitos sonoros" })).getAllByRole("button");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it("inicia silencioso, habilitado e em 25%; testa os quatro efeitos sem sobreposição", () => {
    start(); expect(mocks.played).not.toHaveBeenCalled(); expect(mocks.context.resume).not.toHaveBeenCalled();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("25");
    expect(mocks.provider).toHaveBeenLastCalledWith(true, 0.25);
    for (const [label, sound] of [["organização", sounds.organize], ["restauração", sounds.restore], ["aviso", sounds.warning], ["confirmação", sounds.saved]] as const) {
      fireEvent.click(screen.getByRole("button", { name: `Testar som de ${label}` })); expect(mocks.played).toHaveBeenLastCalledWith(sound, 0.25);
    }
    expect(mocks.played).toHaveBeenCalledTimes(4); expect(mocks.stop).toHaveBeenCalledTimes(3);
  });
  it.each([0, 100, 43])("volume %s só é aplicado e persistido após salvar; prévia usa o rascunho", volume => {
    const view = start();
    fireEvent.change(screen.getByRole("slider"), { target: { value: String(volume) } });
    expect(screen.getByTestId("dirty").textContent).toBe("dirty"); expect(localStorage.getItem(audioStorageKey)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Testar som de organização" }));
    if (volume) expect(mocks.played).toHaveBeenLastCalledWith(sounds.organize, volume / 100);
    else expect(mocks.played).not.toHaveBeenCalled();
    expect(localStorage.getItem(audioStorageKey)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Concluir ação" })); expect(mocks.played).toHaveBeenLastCalledWith(sounds.organize, 0.25);
    fireEvent.click(screen.getByRole("button", { name: "Salvar áudio" }));
    expect(screen.getByTestId("dirty").textContent).toBe("clean");
    expect(JSON.parse(localStorage.getItem(audioStorageKey)!)).toEqual({ enabled: true, volume: volume / 100 });
    const count = mocks.played.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Concluir ação" }));
    if (volume) expect(mocks.played).toHaveBeenLastCalledWith(sounds.organize, volume / 100);
    else expect(mocks.played).toHaveBeenCalledTimes(count);
    view.unmount(); start();
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe(String(volume));
  });
  it("switch, descarte e retorno manual ao valor original respeitam os valores salvos", () => {
    start(); const write = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByTestId("dirty").textContent).toBe("dirty");
    expect((screen.getByRole("button", { name: "Testar som de organização" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Concluir ação" })); expect(mocks.played).toHaveBeenLastCalledWith(sounds.organize, 0.25);
    fireEvent.click(screen.getByRole("switch")); expect(screen.getByTestId("dirty").textContent).toBe("clean");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("switch")); fireEvent.click(screen.getByRole("button", { name: "Descartar áudio" }));
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("25");
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("dirty").textContent).toBe("clean"); expect(write).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "60" } });
    fireEvent.change(screen.getByRole("slider"), { target: { value: "25" } });
    expect(screen.getByTestId("dirty").textContent).toBe("clean");
  });
  it("rascunho habilitado pode ser testado sem habilitar operações salvas como silenciosas", () => {
    localStorage.setItem(audioStorageKey, JSON.stringify({ enabled: false, volume: 0.25 })); start();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Testar som de organização" })); expect(mocks.played).toHaveBeenCalledExactlyOnceWith(sounds.organize, 0.25);
    fireEvent.click(screen.getByRole("button", { name: "Concluir ação" })); expect(mocks.played).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Salvar áudio" }));
    fireEvent.click(screen.getByRole("button", { name: "Concluir ação" })); expect(mocks.played).toHaveBeenCalledTimes(2);
  });
  it.each(["broken", "null", '{"enabled":"yes","volume":0.4}', '{"enabled":true,"volume":2}', '{"enabled":false,"volume":-1}', '{"enabled":true}'])("usa defaults para storage inválido: %s", value => {
    localStorage.setItem(audioStorageKey, value); start();
    expect(mocks.provider).toHaveBeenLastCalledWith(true, 0.25);
  });
  it("storage indisponível não impede ajuste ou reprodução e informa a limitação", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    start(); fireEvent.change(screen.getByRole("slider"), { target: { value: "40" } });
    expect(mocks.provider).toHaveBeenLastCalledWith(true, 0.25);
    fireEvent.click(screen.getByRole("button", { name: "Salvar áudio" }));
    expect(screen.getByText(/O áudio ainda não foi salvo/)).toBeTruthy();
    expect(screen.getByTestId("dirty").textContent).toBe("dirty");
    fireEvent.click(screen.getByRole("button", { name: "Concluir ação" })); expect(mocks.played).toHaveBeenCalledOnce();
  });
  it("falha ou suspensão do áudio não gera reprodução atrasada nem quebra a ação", () => {
    start(); mocks.context.state = "suspended"; mocks.context.resume.mockRejectedValue(new Error("blocked"));
    fireEvent.click(screen.getByRole("button", { name: "Concluir ação" }));
    expect(mocks.played).not.toHaveBeenCalled();
    mocks.context.state = "running";
    expect(mocks.played).not.toHaveBeenCalled();
    mocks.played.mockImplementationOnce(() => { throw new Error("device unavailable"); });
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Concluir ação" }))).not.toThrow();
    fireEvent.click(screen.getByRole("button", { name: "Concluir ação" })); expect(mocks.played).toHaveBeenCalledTimes(2);
  });
  it("falha na criação do mecanismo preserva os controles e a ação principal", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    start(); mocks.unavailable = true;
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Concluir ação" }))).not.toThrow();
    expect(screen.getByRole("switch")).toBeTruthy(); expect(mocks.played).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "40" } });
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("40");
  });
  it("reduced motion muda ao vivo sem sobrescrever a preferência; foco por teclado permanece", () => {
    let reduced = false; const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }));
    start(); const button = screen.getByRole("button", { name: "Testar som de organização" }); button.focus(); expect(document.activeElement).toBe(button);
    act(() => { reduced = true; listeners.forEach(fn => fn()); });
    expect(screen.getByText(/Efeitos silenciados enquanto/)).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Concluir ação" })); expect(mocks.played).not.toHaveBeenCalled();
    act(() => { reduced = false; listeners.forEach(fn => fn()); });
    fireEvent.click(button); expect(mocks.played).toHaveBeenCalledOnce();
  });
  it("libera voz e contexto ao desmontar, preservando StrictMode", async () => {
    const view = start(); fireEvent.click(screen.getByRole("button", { name: "Concluir ação" }));
    await act(async () => { await Promise.resolve(); }); expect(mocks.context.close).not.toHaveBeenCalled();
    view.unmount(); await Promise.resolve(); expect(mocks.stop).toHaveBeenCalled(); expect(mocks.context.close).toHaveBeenCalledOnce();
  });
});

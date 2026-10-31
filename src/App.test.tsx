import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Operation, Preferences, Preview, Progress, Snapshot } from "./lib/api";
import { summarizeOperation } from "./lib/api";
import App from "./App";
import brandPrimary from "@/assets/branding/symbol-primary.svg";
import brandWhite from "@/assets/branding/symbol-white.svg";
import { sounds } from "@/lib/sounds";
import { audioStorageKey } from "@/components/audio/audio-provider";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(), history: vi.fn(), operation: vi.fn(), operationSummary: vi.fn(), destinations: vi.fn(), filePreview: vi.fn(), preview: vi.fn(), organize: vi.fn(), undo: vi.fn(), save: vi.fn(), retryMonitoring: vi.fn(),
  close: vi.fn(), choose: vi.fn(),
  events: new Map<string, (event: { payload: unknown }) => void>(),
  closeHandler: null as null | ((event: { preventDefault: () => void }) => void),
  sound: vi.fn(), soundStop: vi.fn(),
  audioContext: { state: "running", resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) },
  soundFunctions: new Map<unknown, () => { stop: () => void }>(),
}));
vi.mock("@web-kits/audio/react", () => ({
  SoundProvider: ({ children }: { children: ReactNode }) => children,
  useAnalyser: () => ({ node: { context: mocks.audioContext } }),
  useSound: (definition: unknown) => {
    if (!mocks.soundFunctions.has(definition)) mocks.soundFunctions.set(definition, () => { mocks.sound(definition); return { stop: mocks.soundStop }; });
    return mocks.soundFunctions.get(definition);
  },
}));
vi.mock("./lib/api", async importOriginal => ({
  ...await importOriginal<typeof import("./lib/api")>(), native: true,
  api: { snapshot: mocks.snapshot, history: mocks.history, operation: mocks.operation, operationSummary: mocks.operationSummary, destinations: mocks.destinations, filePreview: mocks.filePreview, preview: mocks.preview, organize: mocks.organize, undo: mocks.undo, save: mocks.save, retryMonitoring: mocks.retryMonitoring },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name, callback) => {
  mocks.events.set(name, callback); return () => mocks.events.delete(name);
}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
  close: mocks.close, onCloseRequested: async (callback: typeof mocks.closeHandler) => { mocks.closeHandler = callback; return () => { mocks.closeHandler = null; }; },
}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.choose }));

let snapshot: Omit<Snapshot, "history" | "history_cursor"> & { history: Operation[] };
const initial: Preferences = { source: "/isolated/source", destination: "/isolated/destination", language: "system", theme: "dark", automatic: false, enabled_categories: ["documents"] };
const operation: Operation = { id: 42, created: 1_700_000_000, kind: "manual", movements: [{ id: 1, source: "/isolated/source/a.txt", destination: "/isolated/destination/Documentos/a.txt", status: "moved", error: null, size: 1 }] };
function snapshotPayload(): Snapshot { return { ...snapshot, history: snapshot.history.slice(0, 100).map(summarizeOperation), history_cursor: snapshot.history.length > 100 ? snapshot.history[99].id : null }; }

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
async function start() {
  render(<App />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Organizar arquivos" }) as HTMLButtonElement).disabled).toBe(false));
}
function navigate(name: string) {
  const navigation = screen.getByRole("navigation", { name: "Navegação principal" });
  fireEvent.click(within(navigation).getByRole("button", { name }));
}
function progress(payload: Progress) { act(() => mocks.events.get("organizer-progress")?.({ payload })); }
async function updateSnapshot() {
  act(() => mocks.events.get("organizer-changed")?.({ payload: null }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
}
async function openPreview() {
  fireEvent.click(screen.getByRole("button", { name: "Organizar arquivos" }));
  const dialog = await screen.findByRole("dialog", { name: "Confira antes de organizar" });
  await waitFor(() => expect((within(dialog).getByRole("button", { name: "Atualizar prévia" }) as HTMLButtonElement).disabled).toBe(false));
  return dialog;
}

beforeEach(() => {
  localStorage.clear(); vi.stubGlobal("AudioContext", class {});
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("table-scroll") || this.classList.contains("undo-files") ? 400 : this.hasAttribute("data-undo-movement-id") ? 140 : this.tagName === "TR" ? 80 : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.clearAllMocks(); mocks.events.clear(); mocks.closeHandler = null;
  mocks.audioContext.state = "running";
  snapshot = {
    preferences: structuredClone(initial), categories: [{ id: "documents", name: "Documentos", extensions: ["txt"] }],
    files: [{ name: "a.txt", path: "/isolated/source/a.txt", destination: "/isolated/destination/Documentos/a.txt", extension: "txt", category: "documents", modified: 1_700_000_000_000, size: 1, status: "ready", reason: null }],
    history: [], monitoring: false, scan_error: null, watch_error: null, preview_id: null, language: "pt-BR",
  };
  mocks.snapshot.mockImplementation(async () => structuredClone(snapshotPayload()));
  mocks.history.mockImplementation(async (before: number | null) => {
    const operations = snapshot.history.filter(op => before === null || op.id < before).slice(0, 100);
    const last = operations[operations.length - 1];
    return { operations: operations.map(summarizeOperation), next_cursor: snapshot.history.some(op => op.id < (last?.id ?? 0)) ? last.id : null };
  });
  mocks.operation.mockImplementation(async (id: number) => {
    const operation = snapshot.history.find(op => op.id === id);
    if (!operation) throw new Error("Operação não encontrada");
    return structuredClone(operation);
  });
  mocks.filePreview.mockResolvedValue({ data_url: null, width: null, height: null });
  mocks.destinations.mockResolvedValue({ folders: [], other_folders: 0, other_files: 0 });
  mocks.operationSummary.mockImplementation(async (id: number) => {
    const operation = snapshot.history.find(op => op.id === id);
    if (!operation) throw new Error("Operação não encontrada");
    return summarizeOperation(operation);
  });
  mocks.preview.mockImplementation(async (): Promise<Preview> => {
    snapshot.preview_id = (snapshot.preview_id ?? 0) + 1;
    return { id: snapshot.preview_id, created: Math.floor(Date.now() / 1000), files: structuredClone(snapshot.files) };
  });
  mocks.save.mockImplementation(async (prefs: Preferences) => { snapshot.preferences = structuredClone(prefs); return structuredClone(prefs); });
  mocks.close.mockResolvedValue(undefined);
  mocks.choose.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("histórico paginado", () => {
  function seedHistory(count: number) {
    snapshot.history = Array.from({ length: count }, (_, index) => ({ ...structuredClone(operation), id: count - index }));
  }
  // Two rendered pages, Undo and navigation exceeded 5s on Windows CI; keep the margin local.
  it("carrega e restaura uma operação antiga sem perder páginas, expansão ou identidade", async () => {
    seedHistory(1006); await start(); navigate("Histórico");
    expect(document.querySelectorAll(".history-operation")).toHaveLength(100);
    expect(mocks.operation).not.toHaveBeenCalled();
    // Avoid computing accessible names for every action in the loaded history.
    const loadMore = screen.getByText("Carregar mais", { selector: "button" });
    // Flush the mocked command, then locate its unique accessible label without scanning every region's styles.
    await act(async () => { fireEvent.click(loadMore); });
    const row = screen.getByLabelText("Operação 900", { selector: "section" });
    expect(mocks.history).toHaveBeenCalledExactlyOnceWith(907);
    fireEvent.click(within(row).getByRole("button", { name: /1 arquivo organizado/ }));
    expect(within(row).getByText("Arquivos envolvidos")).toBeTruthy();
    expect(mocks.operation).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Desfazer" })); });
    const dialog = screen.getByRole("dialog", { name: "Restaurar os arquivos à origem?" });
    expect(mocks.operation).toHaveBeenCalledExactlyOnceWith(900);
    mocks.undo.mockImplementationOnce(async (id: number) => { snapshot.history.find(op => op.id === id)!.movements[0].status = "undone"; });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar restauração" })); });
    expect(within(dialog).getByText(/1 restaurado · 0 ainda no destino/)).toBeTruthy();
    expect(mocks.undo).toHaveBeenCalledExactlyOnceWith(900);
    await act(async () => { fireEvent.click(within(dialog.querySelector<HTMLElement>('[data-slot="dialog-footer"]')!).getByRole("button", { name: /^Fechar$/ })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelectorAll(".history-operation")).toHaveLength(200);
    const updated = screen.getByLabelText("Operação 900", { selector: "section" });
    expect(updated).toBe(row);
    expect(within(updated).getByRole("button", { name: /1 arquivo restaurado/ }).getAttribute("aria-expanded")).toBe("true");
    expect((within(updated).getByRole("button", { name: "Desfazer" }) as HTMLButtonElement).disabled).toBe(true);
    navigate("Arquivos"); navigate("Histórico");
    expect(document.querySelectorAll(".history-operation")).toHaveLength(200);
    const returned = screen.getByLabelText("Operação 900", { selector: "section" });
    expect(within(returned).getByRole("button", { name: /1 arquivo restaurado/, expanded: true })).toBeTruthy();
    expect((within(returned).getByRole("button", { name: "Desfazer" }) as HTMLButtonElement).disabled).toBe(true);
  }, 10_000);
  it("mantém a página após erro, oferece nova tentativa e sinaliza chegadas sem inserir duplicatas", async () => {
    seedHistory(5);
    mocks.snapshot.mockResolvedValueOnce({ ...snapshotPayload(), history: snapshot.history.slice(0, 2).map(summarizeOperation), history_cursor: 4 });
    await start(); navigate("Histórico");
    mocks.history.mockRejectedValueOnce("Histórico indisponível");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await screen.findByText("Histórico indisponível");
    expect(document.querySelectorAll(".history-operation")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Tentar carregar novamente" }));
    await screen.findByRole("region", { name: "Operação 1" });
    const row = screen.getByRole("region", { name: "Operação 1" });
    fireEvent.click(within(row).getByRole("button", { name: /1 arquivo organizado/ }));
    snapshot.history.unshift({ ...structuredClone(operation), id: 6 });
    await updateSnapshot();
    expect(screen.queryByRole("region", { name: "Operação 6" })).toBeNull();
    expect(screen.getByRole("region", { name: "Operação 1" })).toBe(row);
    mocks.history.mockResolvedValueOnce({ operations: snapshot.history.slice(0, 2).map(summarizeOperation), next_cursor: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Novas operações — atualizar lista" }));
    await screen.findByRole("region", { name: "Operação 6" });
    expect(screen.getByRole("region", { name: "Operação 1" })).toBe(row);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await screen.findByRole("region", { name: "Operação 4" });
    const ids = [...document.querySelectorAll(".history-operation")].map(row => row.getAttribute("aria-label"));
    expect(ids).toHaveLength(new Set(ids).size);
  });
});

describe("destinos compatíveis com a organização", () => {
  const volumeError = "A origem e o destino estão em volumes diferentes ou em compartilhamentos incompatíveis. Escolha um destino no mesmo volume da origem em Configurações e salve as preferências.";

  it("recusa salvar um destino incompatível e preserva o rascunho até descartar", async () => {
    await start(); navigate("Configurações");
    mocks.choose.mockResolvedValueOnce("/isolated/another-volume");
    fireEvent.click(screen.getByRole("button", { name: "Selecionar destino da organização" }));
    await screen.findByText("/isolated/another-volume");
    mocks.save.mockRejectedValueOnce(volumeError);
    const save = screen.getByRole("button", { name: "Salvar preferências" });
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(volumeError));
    expect(snapshot.preferences).toEqual(initial);
    expect(screen.getByText("/isolated/another-volume")).toBeTruthy();
    expect(screen.getByText("Alterações não salvas. As configurações salvas continuam em uso.")).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(false);
    navigate("Arquivos"); navigate("Configurações");
    expect(screen.getByText("/isolated/another-volume")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Descartar alterações" }));
    expect(screen.queryByText("/isolated/another-volume")).toBeNull();
    expect((screen.getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.organize).not.toHaveBeenCalled();
  });

  it("permite corrigir configurações antigas incompatíveis sem organizar arquivos", async () => {
    snapshot.preferences.destination = "/isolated/another-volume";
    snapshot.files = []; snapshot.scan_error = volumeError;
    render(<App />);
    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toContain(volumeError);
    expect((screen.getByRole("button", { name: "Organizar arquivos" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(warning).getByRole("button", { name: "Revisar diretórios" }));
    expect(screen.getByText("/isolated/another-volume")).toBeTruthy();
    mocks.choose.mockResolvedValueOnce(initial.destination);
    fireEvent.click(screen.getByRole("button", { name: "Selecionar destino da organização" }));
    await screen.findByText(initial.destination);
    mocks.save.mockImplementationOnce(async prefs => {
      snapshot.preferences = prefs; snapshot.scan_error = null; return prefs;
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await screen.findByText("Todas as alterações estão salvas.");
    await waitFor(() => expect(screen.queryByText(volumeError)).toBeNull());
    expect(mocks.save).toHaveBeenCalledWith(initial, { ...initial, destination: "/isolated/another-volume" });
    expect(mocks.organize).not.toHaveBeenCalled();
  });

  it("não autoriza uma prévia recusada nem reutiliza a confirmação se o volume mudar", async () => {
    await start();
    mocks.preview.mockRejectedValueOnce(volumeError);
    fireEvent.click(screen.getByRole("button", { name: "Organizar arquivos" }));
    await screen.findByText(volumeError);
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = await openPreview();
    mocks.organize.mockRejectedValueOnce(volumeError);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    await within(dialog).findByText(volumeError);
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Confirmar organização" }) as HTMLButtonElement).disabled).toBe(true));
    expect((within(dialog).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    expect(mocks.organize).toHaveBeenCalledOnce();
  });

  it("desabilita uma prévia aberta quando a leitura detecta volumes incompatíveis", async () => {
    await start();
    const dialog = await openPreview();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    snapshot.scan_error = volumeError; snapshot.files = [];
    await updateSnapshot();
    await within(dialog).findByText(volumeError);
    expect((within(dialog).getByRole("button", { name: "Confirmar organização" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.organize).not.toHaveBeenCalled();
  });
});

describe("feedback sonoro de ações reais", () => {
  async function confirmOrganization() {
    const dialog = await openPreview();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    return dialog;
  }
  it("5.000 eventos não tocam áudio; a confirmação real toca uma vez e refresh não repete", async () => {
    const file = snapshot.files[0];
    snapshot.files = Array.from({ length: 5000 }, (_, i) => ({ ...file, name: `file-${i}.txt`, path: `/isolated/source/file-${i}.txt`, destination: `/isolated/destination/file-${i}.txt` }));
    const pending = deferred<number>(); mocks.organize.mockReturnValueOnce(pending.promise);
    await start(); expect(mocks.sound).not.toHaveBeenCalled();
    const dialog = await confirmOrganization();
    act(() => {
      for (let i = 0; i < 5000; i++) mocks.events.get("organizer-progress")?.({ payload: { kind: "manual", phase: "organizing", completed: i + 1, total: 5000, name: `file-${i}.txt`, operation_id: 42 } });
      mocks.events.get("organizer-progress")?.({ payload: { kind: "manual", phase: "completed", completed: 5000, total: 5000, name: "", operation_id: 42 } });
    });
    expect(mocks.sound).not.toHaveBeenCalled();
    snapshot.history = [{ ...operation, movements: snapshot.files.map((entry, i) => ({ id: i, source: entry.path, destination: entry.destination, status: "moved", error: null, size: 1 })) }];
    await act(async () => pending.resolve(42));
    expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.organize);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ver resultado no histórico" }));
    fireEvent.click(screen.getByRole("button", { name: "Atualizar arquivos" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Atualizar arquivos" }) as HTMLButtonElement).disabled).toBe(false));
    progress({ kind: "manual", phase: "completed", completed: 5000, total: 5000, name: "", operation_id: 42 });
    expect(mocks.sound).toHaveBeenCalledOnce();
  });
  it.each(["failed", "uncertain", "pending", "undo_pending", "moved-with-error"])("organização com %s produz somente aviso", async status => {
    mocks.organize.mockImplementationOnce(async () => {
      snapshot.history = [structuredClone(operation)];
      snapshot.history[0].movements[0].status = status === "moved-with-error" ? "moved" : status;
      snapshot.history[0].movements[0].error = status === "moved-with-error" ? "Verificar arquivo" : null;
      return 42;
    });
    await start(); await confirmOrganization();
    await waitFor(() => expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.warning));
  });
  it.each([true, false])("restauração completa=%s utiliza apenas o feedback adequado", async complete => {
    snapshot.history = [structuredClone(operation)];
    mocks.undo.mockImplementationOnce(async () => {
      snapshot.history[0].movements[0].status = complete ? "undone" : "moved";
      snapshot.history[0].movements[0].error = complete ? null : "Origem ocupada";
    });
    await start(); navigate("Histórico");
    expect(mocks.sound).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    const dialog = await screen.findByRole("dialog", { name: "Restaurar os arquivos à origem?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar restauração" }));
    await waitFor(() => expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(complete ? sounds.restore : sounds.warning));
  });
  it.each([true, false])("salvar preferências combinadas com sucesso=%s preserva áudio pendente até confirmar", async success => {
    await start(); navigate("Configurações");
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "30" } });
    expect((screen.getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement).disabled).toBe(false);
    expect(localStorage.getItem(audioStorageKey)).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Organizar novos arquivos" }));
    if (!success) mocks.save.mockRejectedValueOnce("Não foi possível salvar");
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(success ? sounds.saved : sounds.warning));
    if (success) expect(localStorage.getItem(audioStorageKey)).toContain('"volume":0.3');
    else {
      expect(localStorage.getItem(audioStorageKey)).toBeNull();
      expect((screen.getByRole("slider", { name: "Volume" }) as HTMLInputElement).value).toBe("30");
      expect((screen.getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement).disabled).toBe(false);
    }
  });
  it("não reproduz eventos históricos ou automáticos, refresh, prévia e edição/descarte", async () => {
    snapshot.history = [structuredClone(operation)]; await start();
    for (const phase of ["preparing", "organizing", "completed"] as const) progress({ kind: "automatic", phase, total: 1, completed: phase === "completed" ? 1 : 0, name: "", operation_id: phase === "preparing" ? null : 42 });
    await waitFor(() => expect((screen.getByRole("button", { name: "Atualizar arquivos" }) as HTMLButtonElement).disabled).toBe(false));
    navigate("Histórico"); navigate("Configurações");
    fireEvent.click(screen.getByRole("switch", { name: "Organizar novos arquivos" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar alterações" }));
    navigate("Visão geral"); await openPreview();
    expect(mocks.sound).not.toHaveBeenCalled();
  });
  it("erro do comando toca aviso; falha do áudio não impede organização", async () => {
    mocks.sound.mockImplementationOnce(() => { throw new Error("Áudio indisponível"); });
    mocks.organize.mockRejectedValueOnce("Arquivo ocupado");
    await start(); const dialog = await confirmOrganization();
    expect(await within(dialog).findByText("Arquivo ocupado")).toBeTruthy();
    expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.warning);
  });
  it("resultado ausente não inventa sucesso", async () => {
    mocks.organize.mockResolvedValueOnce(42); await start(); await confirmOrganization();
    await screen.findByText(/Operação não encontrada/);
    expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.warning);
    expect(mocks.sound).not.toHaveBeenCalledWith(sounds.organize);
  });
  it("falha sonora não transforma uma organização confirmada em falha", async () => {
    mocks.organize.mockImplementationOnce(async () => { snapshot.history = [structuredClone(operation)]; return 42; });
    mocks.sound.mockImplementationOnce(() => { throw new Error("Dispositivo ausente"); });
    await start(); const dialog = await confirmOrganization();
    await within(dialog).findByText(/1 organizado · 0 ocorrência/);
    expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.organize);
    expect(screen.queryByText("Dispositivo ausente")).toBeNull();
  });
  it("salvamento confirmado não toca aviso extra se a atualização posterior falhar", async () => {
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("switch", { name: "Organizar novos arquivos" }));
    mocks.snapshot.mockRejectedValueOnce("Falha ao consultar estado");
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await screen.findByText("Falha ao consultar estado");
    expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.saved);
  });
  it("operações manuais distintas podem tocar novamente sem cooldown global", async () => {
    await start();
    for (const id of [42, 43]) {
      mocks.organize.mockImplementationOnce(async () => { snapshot.history = [{ ...structuredClone(operation), id }]; return id; });
      const dialog = await confirmOrganization();
      await waitFor(() => expect(mocks.sound).toHaveBeenCalledTimes(id === 42 ? 1 : 2));
      fireEvent.click(within(dialog).getByRole("button", { name: "Ver resultado no histórico" }));
    }
    expect(mocks.sound.mock.calls.every(([sound]) => sound === sounds.organize)).toBe(true);
  });
  it("mute não interrompe o salvamento principal", async () => {
    localStorage.setItem(audioStorageKey, JSON.stringify({ enabled: false, volume: 0.25 }));
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("switch", { name: "Organizar novos arquivos" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await screen.findByText("Preferências salvas. Verifique separadamente o estado do monitoramento.");
    expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.sound).not.toHaveBeenCalled();
  });
});

describe("rascunho de áudio no fluxo global", () => {
  const saveButton = () => screen.getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement;
  const discardButton = () => screen.getByRole("button", { name: "Descartar alterações" }) as HTMLButtonElement;
  function volume(value: number) { fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: String(value) } }); }
  it.each(["volume", "switch"])("apenas %s habilita ações globais e salva sem comandos Rust", async control => {
    await start(); navigate("Configurações");
    if (control === "volume") volume(60); else fireEvent.click(screen.getByRole("switch", { name: "Efeitos sonoros" }));
    expect(saveButton().disabled).toBe(false); expect(discardButton().disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Configurações" }).getAttribute("aria-describedby")).toBe("pending-preferences");
    expect(localStorage.getItem(audioStorageKey)).toBeNull();
    const snapshots = mocks.snapshot.mock.calls.length;
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(discardButton().disabled).toBe(true); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.snapshot).toHaveBeenCalledTimes(snapshots);
    expect(JSON.parse(localStorage.getItem(audioStorageKey)!)).toEqual({ enabled: control !== "switch", volume: control === "volume" ? 0.6 : 0.25 });
    expect(screen.getByText("Todas as alterações estão salvas.")).toBeTruthy();
    if (control === "volume") expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.saved);
    else expect(mocks.sound).not.toHaveBeenCalled();
  });
  it("restaurar manualmente o valor original remove dirty sem persistência", async () => {
    await start(); navigate("Configurações");
    volume(80); volume(25); expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Efeitos sonoros" })); expect(saveButton().disabled).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Efeitos sonoros" })); expect(saveButton().disabled).toBe(true);
    expect(localStorage.getItem(audioStorageKey)).toBeNull(); expect(mocks.sound).not.toHaveBeenCalled();
  });
  it("descartar restaura todos os rascunhos, inclusive áudio salvo anteriormente", async () => {
    const stored = JSON.stringify({ enabled: false, volume: 0.4 }); localStorage.setItem(audioStorageKey, stored);
    await start(); navigate("Configurações");
    volume(70); fireEvent.click(screen.getByRole("switch", { name: "Efeitos sonoros" }));
    fireEvent.click(screen.getByRole("button", { name: "Claro" })); fireEvent.click(discardButton());
    expect((screen.getByRole("slider", { name: "Volume" }) as HTMLInputElement).value).toBe("40");
    expect(screen.getByRole("switch", { name: "Efeitos sonoros" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: "Escuro" }).getAttribute("aria-pressed")).toBe("true");
    expect(saveButton().disabled).toBe(true); expect(localStorage.getItem(audioStorageKey)).toBe(stored); expect(mocks.sound).not.toHaveBeenCalled();
  });
  it("navegação e refresh preservam áudio pendente e a proteção de beforeunload", async () => {
    await start(); navigate("Configurações"); volume(75); navigate("Arquivos");
    expect(screen.getByText("Há configurações não salvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar arquivos" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Atualizar arquivos" }) as HTMLButtonElement).disabled).toBe(false));
    navigate("Histórico"); navigate("Configurações");
    expect((screen.getByRole("slider", { name: "Volume" }) as HTMLInputElement).value).toBe("75");
    const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    expect(saveButton().disabled).toBe(false); expect(localStorage.getItem(audioStorageKey)).toBeNull(); expect(mocks.sound).not.toHaveBeenCalled();
  });
  it.each(["Salvar e sair", "Descartar e sair"])("%s reconhece alterações apenas de áudio", async name => {
    await start(); navigate("Configurações"); volume(65);
    const preventDefault = vi.fn(); act(() => mocks.closeHandler?.({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name })); await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(mocks.save).not.toHaveBeenCalled();
    if (name === "Salvar e sair") {
      expect(JSON.parse(localStorage.getItem(audioStorageKey)!)).toEqual({ enabled: true, volume: 0.65 });
      expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.saved);
    } else { expect(localStorage.getItem(audioStorageKey)).toBeNull(); expect(mocks.sound).not.toHaveBeenCalled(); }
  });
  it("falha local após salvar principais mantém somente áudio pendente, permitindo repetir sem salvar Rust", async () => {
    await start(); navigate("Configurações"); volume(70); fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    const original = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("Quota"); });
    fireEvent.click(saveButton()); await screen.findByText(/Não foi possível salvar o áudio neste dispositivo/);
    expect(snapshot.preferences.theme).toBe("light"); expect(mocks.save).toHaveBeenCalledOnce();
    expect(localStorage.getItem(audioStorageKey)).toBeNull(); expect((screen.getByRole("slider", { name: "Volume" }) as HTMLInputElement).value).toBe("70");
    expect(saveButton().disabled).toBe(false); expect(screen.queryByText("Todas as alterações estão salvas.")).toBeNull();
    expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.warning);
    write.mockImplementation(original); fireEvent.click(saveButton()); await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(mocks.save).toHaveBeenCalledOnce(); expect(JSON.parse(localStorage.getItem(audioStorageKey)!).volume).toBe(0.7);
    expect(mocks.sound.mock.calls.map(([sound]) => sound)).toEqual([sounds.warning, sounds.saved]);
  });
  it("falha ao salvar áudio impede Salvar e sair e preserva o rascunho", async () => {
    await start(); navigate("Configurações"); volume(50);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    act(() => mocks.closeHandler?.({ preventDefault: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar e sair" }));
    await screen.findAllByText(/Não foi possível salvar o áudio neste dispositivo/);
    expect(mocks.close).not.toHaveBeenCalled(); expect(localStorage.getItem(audioStorageKey)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continuar no aplicativo" }));
    expect((screen.getByRole("slider", { name: "Volume" }) as HTMLInputElement).value).toBe("50");
  });
  it("ativar áudio salvo como desabilitado prepara a confirmação somente no gesto de salvar", async () => {
    localStorage.setItem(audioStorageKey, JSON.stringify({ enabled: false, volume: 0.25 }));
    await start(); navigate("Configurações"); fireEvent.click(screen.getByRole("switch", { name: "Efeitos sonoros" }));
    expect(mocks.sound).not.toHaveBeenCalled(); fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.saved); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rascunho mudo não silencia operações normais nem persiste ao testar", async () => {
    await start(); navigate("Configurações"); volume(80);
    fireEvent.click(screen.getByRole("button", { name: "Testar som de organização" }));
    expect(localStorage.getItem(audioStorageKey)).toBeNull(); mocks.sound.mockClear();
    fireEvent.click(screen.getByRole("switch", { name: "Efeitos sonoros" })); navigate("Visão geral");
    mocks.organize.mockImplementationOnce(async () => { snapshot.history = [structuredClone(operation)]; return 42; });
    const dialog = await openPreview(); fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    await waitFor(() => expect(mocks.sound).toHaveBeenCalledExactlyOnceWith(sounds.organize));
    expect(localStorage.getItem(audioStorageKey)).toBeNull();
  });
});

describe("feedback de operações breves", () => {
  it.each(["preview", "refresh"] as const)("%s bloqueia duplicatas e respeita a apresentação específica em ações rápidas e lentas", async kind => {
    await start(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const target = kind === "preview" ? mocks.preview : mocks.snapshot;
    const name = kind === "preview" ? "Organizar arquivos" : "Atualizar arquivos";
    const heading = kind === "preview" ? "Preparando e verificando arquivos…" : "Verificando o estado atual…";
    const result = kind === "preview" ? { id: 9, created: Math.floor(Date.now() / 1000), files: snapshot.files } : snapshotPayload();
    const quick = deferred<Preview | Snapshot>(); target.mockReturnValueOnce(quick.promise);
    const button = screen.getByRole("button", { name }); const calls = target.mock.calls.length;
    fireEvent.click(button); fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true); expect(target).toHaveBeenCalledTimes(calls + 1);
    if (kind === "refresh") expect(button.querySelector("svg")?.classList.contains("spin")).toBe(true);
    act(() => vi.advanceTimersByTime(70)); expect(screen.queryByText(heading)).toBeNull();
    await act(async () => quick.resolve(result)); expect(screen.queryByText(heading)).toBeNull();
    const slow = deferred<Preview | Snapshot>(); target.mockReturnValueOnce(slow.promise);
    const nextName = kind === "preview" ? "Atualizar prévia" : name;
    fireEvent.click(screen.getByRole("button", { name: nextName }));
    act(() => vi.advanceTimersByTime(130)); expect(screen.queryByText(heading)).toBeNull();
    act(() => vi.advanceTimersByTime(69)); expect(screen.queryByText(heading)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    if (kind === "preview") expect(screen.getByText(heading)).toBeTruthy();
    else {
      act(() => vi.advanceTimersByTime(5000)); expect(screen.queryByText(heading)).toBeNull();
      expect(document.querySelector(".progress-panel")).toBeNull();
      expect(button.querySelector("svg")?.classList.contains("spin")).toBe(true);
      act(() => mocks.closeHandler?.({ preventDefault: vi.fn() }));
      const close = screen.getByRole("dialog", { name: "Uma operação está em andamento" });
      expect(close.querySelector(".progress-panel")).toBeNull();
      fireEvent.click(within(close).getByRole("button", { name: "Continuar no aplicativo" }));
    }
    await act(async () => slow.resolve(result)); expect(screen.queryByText(heading)).toBeNull();
    act(() => vi.advanceTimersByTime(500)); expect(screen.queryByText(heading)).toBeNull();
    expect((screen.getByRole("button", { name: nextName }) as HTMLButtonElement).disabled).toBe(false);
    if (kind === "refresh") expect(button.querySelector("svg")?.classList.contains("spin")).toBe(false);
  });

  it.each(["preview", "refresh"] as const)("%s apresenta erros imediatamente e cancela a apresentação pendente", async kind => {
    await start(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = deferred<Preview | Snapshot>();
    (kind === "preview" ? mocks.preview : mocks.snapshot).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: kind === "preview" ? "Organizar arquivos" : "Atualizar arquivos" }));
    await act(async () => pending.reject("Falha de teste"));
    expect(screen.getByText("Falha de teste")).toBeTruthy();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByText("Preparando e verificando arquivos…")).toBeNull();
    expect(screen.queryByText("Verificando o estado atual…")).toBeNull();
    expect(screen.getByText("Falha de teste")).toBeTruthy();
  });

  it("cancela o agendamento de apresentação ao desmontar", async () => {
    await start(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = deferred<Preview>(); mocks.preview.mockReturnValueOnce(pending.promise);
    const clear = vi.spyOn(globalThis, "clearTimeout");
    fireEvent.click(screen.getByRole("button", { name: "Organizar arquivos" }));
    const timers = vi.getTimerCount(); cleanup();
    expect(clear).toHaveBeenCalled(); expect(vi.getTimerCount()).toBeLessThan(timers);
    act(() => vi.advanceTimersByTime(300)); expect(screen.queryByText("Preparando e verificando arquivos…")).toBeNull();
  });
});

describe("composição desktop", () => {
  it("visualiza o arquivo da tabela sem preparar organização e restaura o foco ao fechar", async () => {
    await start(); navigate("Arquivos");
    const trigger = screen.getByRole("button", { name: "Visualizar a.txt" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Visualizar arquivo" });
    await within(dialog).findByText("Visualização não disponível para este formato.");
    expect(mocks.filePreview).toHaveBeenCalledExactlyOnceWith(snapshot.files[0]);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.organize).not.toHaveBeenCalled();
    expect(mocks.undo).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
  it("usa o idioma do sistema informado pelo aplicativo nativo", async () => {
    snapshot.language = "en";
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it.each(["dark", "light"] as const)("usa o símbolo oficial com contraste no tema %s, preservando os demais ícones", async theme => {
    snapshot.preferences.theme = theme;
    await start();
    const brand = document.querySelector<HTMLImageElement>(".brand-icon img")!;
    expect(brand.getAttribute("src")).toBe(theme === "light" ? brandPrimary : brandWhite);
    expect(brand.getAttribute("width")).toBe("32"); expect(brand.getAttribute("height")).toBe("32");
    expect(brand.getAttribute("alt")).toBe(""); expect(brand.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector(".brand-icon svg")).toBeNull();
    expect(screen.getByRole("button", { name: "Organizar arquivos" }).querySelector("svg.lucide-folder-down")).toBeTruthy();
  });
  it("busca e filtra 10.000 registros sem renormalizar nomes em alterações não relacionadas", async () => {
    snapshot.categories.push({ id: "images", name: "Imagens", extensions: ["png"] });
    snapshot.files = Array.from({ length: 10000 }, (_, index) => ({ ...snapshot.files[0], name: "Arquivo-" + String(index).padStart(5, "0") + ".txt", path: "/isolated/" + index + ".txt", category: index % 2 ? "images" : "documents" }));
    const normalize = vi.spyOn(String.prototype, "toLocaleLowerCase");
    await start(); navigate("Arquivos");
    const normalizedFiles = () => normalize.mock.contexts.filter(value => String(value).startsWith("Arquivo-")).length;
    expect(normalizedFiles()).toBe(10000);
    const searchInput = screen.getByRole("textbox", { name: "Buscar arquivos" });
    act(() => document.querySelector<HTMLButtonElement>(".file-disclosure")!.focus());
    act(() => searchInput.focus());
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar arquivos" }), { target: { value: "ARQUIVO-09999" } });
    expect(document.activeElement).toBe(searchInput);
    expect(screen.getByText("1 arquivo")).toBeTruthy(); expect(screen.getByText("Arquivo-09999.txt")).toBeTruthy();
    expect(normalizedFiles()).toBe(10000);
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar arquivos" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por categoria" }), { target: { value: "images" } });
    expect(screen.getByText("5000 arquivos")).toBeTruthy();
    navigate("Configurações"); fireEvent.click(screen.getByRole("button", { name: "Claro" })); navigate("Arquivos");
    expect(normalizedFiles()).toBe(10000);
    expect(screen.getByText("5000 arquivos")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar arquivos" }), { target: { value: "inexistente" } });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(screen.getByText("10000 arquivos")).toBeTruthy();
    expect(document.querySelectorAll("tr[data-file-path]").length).toBeLessThan(25);
  });
  it("leva da categoria real à tabela filtrada e mantém os nomes de navegação estáveis", async () => {
    await start();
    expect(screen.getByRole("heading", { name: "source" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Documentos.*Habilitada/ }));
    expect(screen.getByRole("button", { name: "Arquivos" }).getAttribute("aria-current")).toBe("page");
    expect((screen.getByRole("combobox", { name: "Filtrar por categoria" }) as HTMLSelectElement).value).toBe("documents");
    expect(screen.getByRole("table", { name: "Arquivos da pasta de origem" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").every(header => header.getAttribute("scope") === "col")).toBe(true);
    navigate("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    const settings = screen.getByRole("button", { name: "Configurações" });
    expect(settings.getAttribute("aria-describedby")).toBe("pending-preferences");
    expect(document.getElementById("pending-preferences")?.textContent).toBe("Alterações não salvas");
  });
  it("mostra identidade e ocorrências da operação sem ocultar detalhes ou desfazer", async () => {
    snapshot.history = [structuredClone(operation)];
    snapshot.history[0].movements.push({ ...operation.movements[0], id: 2, source: "/isolated/source/locked.txt", status: "failed", error: "Arquivo ocupado" });
    await start(); navigate("Histórico");
    const row = screen.getByRole("region", { name: "Operação 42" });
    expect(within(row).getByText("#42")).toBeTruthy();
    expect(within(row).getByText("1 ocorrência")).toBeTruthy();
    expect((within(row).getByRole("button", { name: "Desfazer" }) as HTMLButtonElement).disabled).toBe(false);
    const expand = within(row).getByRole("button", { name: /1 arquivo organizado/ });
    fireEvent.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(within(row).getByText("Falhas ou verificação")).toBeTruthy();
    expect(within(row).queryByText("/isolated/source/locked.txt")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Explorar arquivos" }));
    const explorer = screen.getByRole("dialog", { name: "Arquivos da operação #42" });
    expect(await within(explorer).findByText("Arquivo ocupado")).toBeTruthy();
    expect(within(explorer).getByText("/isolated/source/locked.txt")).toBeTruthy();
  });
});

describe("rascunho de configurações", () => {
  it("mantém uma única dock nas configurações e preserva sua identidade ao editar, salvar e descartar", async () => {
    await start();
    expect(screen.queryByRole("region", { name: "Ações das configurações" })).toBeNull();
    navigate("Configurações");
    const dock = screen.getByRole("region", { name: "Ações das configurações" });
    const save = within(dock).getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement;
    const discard = within(dock).getByRole("button", { name: "Descartar alterações" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); expect(discard.disabled).toBe(true);
    expect(dock.closest(".page-content")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    expect(save.disabled).toBe(false); expect(discard.disabled).toBe(false);
    fireEvent.click(discard);
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Documentos" }));
    fireEvent.click(save);
    await screen.findByText("Todas as alterações estão salvas.");
    expect(save.disabled).toBe(true); expect(discard.disabled).toBe(true);
    expect(screen.getByRole("region", { name: "Ações das configurações" })).toBe(dock);
    expect(within(dock).getAllByRole("button")).toEqual([discard, save]);
    for (const page of ["Arquivos", "Histórico", "Visão geral"]) {
      navigate(page);
      expect(screen.queryByRole("region", { name: "Ações das configurações" })).toBeNull();
    }
    navigate("Configurações");
    expect((screen.getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("bloqueia ações durante o salvamento e mantém o rascunho após uma falha", async () => {
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    const pending = deferred<Preferences>(); mocks.save.mockReturnValueOnce(pending.promise);
    const dock = screen.getByRole("region", { name: "Ações das configurações" });
    fireEvent.click(within(dock).getByRole("button", { name: "Salvar preferências" }));
    const save = within(dock).getByRole("button", { name: "Salvando…" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect((within(dock).getByRole("button", { name: "Descartar alterações" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save); expect(mocks.save).toHaveBeenCalledOnce();
    await act(async () => pending.reject("Falha isolada ao salvar"));
    await screen.findByText("Falha isolada ao salvar");
    expect(screen.getByRole("button", { name: "Claro" }).getAttribute("aria-pressed")).toBe("true");
    expect(save.disabled).toBe(false);
    expect(screen.getByRole("region", { name: "Ações das configurações" })).toBe(dock);
  });
  it("preserva alterações ao navegar e só descarta explicitamente", async () => {
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    navigate("Histórico");
    expect(screen.getByText("Há configurações não salvas")).toBeTruthy();
    navigate("Configurações");
    expect(screen.getByRole("button", { name: "Claro" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Descartar alterações" }));
    expect(screen.getByRole("button", { name: "Escuro" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("preserva o rascunho externo e exige revisão antes de sobrescrever", async () => {
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    snapshot.preferences = { ...initial, automatic: true };
    await updateSnapshot();
    expect(screen.getByText("As configurações salvas foram atualizadas")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claro" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Manter rascunho sobre esta versão" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ ...initial, theme: "light" }, { ...initial, automatic: true }));
    await screen.findByText("Todas as alterações estão salvas.");
  });
  it("não anuncia um rascunho salvo enquanto a versão externa ainda precisa de revisão", async () => {
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    snapshot.preferences = { ...initial, automatic: true };
    await updateSnapshot();
    fireEvent.click(screen.getByRole("button", { name: "Escuro" }));
    expect(screen.getByText("As configurações salvas mudaram. Revise seu rascunho antes de salvar.")).toBeTruthy();
    expect(screen.queryByText("Todas as alterações estão salvas.")).toBeNull();
    expect((screen.getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("mantém alterações pendentes e não fecha o app se salvar falhar", async () => {
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    const preventDefault = vi.fn();
    act(() => mocks.closeHandler?.({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    mocks.save.mockRejectedValueOnce("Falha ao gravar preferências");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e sair" }));
    await screen.findAllByText("Falha ao gravar preferências");
    expect(mocks.close).not.toHaveBeenCalled();
    expect(screen.getByText("Alterações não salvas. As configurações salvas continuam em uso.")).toBeTruthy();
  });
  it("salva antes de permitir fechar e intercepta beforeunload", async () => {
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    act(() => mocks.closeHandler?.({ preventDefault: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar e sair" }));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(snapshot.preferences.theme).toBe("light");
  });
  it("informa preferências salvas sem esconder falha de monitoramento", async () => {
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    mocks.save.mockImplementationOnce(async prefs => {
      snapshot.preferences = prefs; snapshot.watch_error = "Monitoramento indisponível"; return prefs;
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await screen.findByText("Preferências salvas. Verifique separadamente o estado do monitoramento.");
    expect(screen.getByText("Monitoramento indisponível")).toBeTruthy();
    expect(screen.getByText("Todas as alterações estão salvas.")).toBeTruthy();
  });
});

describe("prévia e operações", () => {
  it("estabiliza os textos e conclui um lote manual curto sem esperar o intervalo visual", async () => {
    await start(); const dialog = await openPreview();
    const pending = deferred<number>(); mocks.organize.mockReturnValueOnce(pending.promise);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    vi.useFakeTimers();
    progress({ kind: "manual", phase: "organizing", operation_id: 42, completed: 0, total: 5000, name: "first.txt" });
    for (let i = 1; i < 5000; i++) progress({ kind: "manual", phase: i % 2 ? "preparing" : "organizing", operation_id: 42, completed: i, total: 5000, name: "rapid-" + i + ".txt" });
    expect(within(dialog).getByText("Organizando arquivos…")).toBeTruthy();
    expect(within(dialog).getByRole("progressbar").getAttribute("value")).toBe("0");
    expect(within(dialog).queryByText("first.txt")).toBeNull();
    expect(within(dialog).getByRole("progressbar").closest("[aria-live]")).toBeNull();
    progress({ kind: "manual", phase: "completed", operation_id: 42, completed: 5000, total: 5000, name: "" });
    expect(within(dialog).getByText("Processamento concluído")).toBeTruthy();
    snapshot.history = [structuredClone(operation)]; snapshot.preview_id = null;
    await act(async () => pending.resolve(42));
    expect(within(dialog).getByText("Processamento concluído")).toBeTruthy();
    expect(within(dialog).getByText(/1 organizado/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(300));
    expect(within(dialog).queryByRole("progressbar")).toBeNull();
    expect(within(dialog).getByText("Processamento concluído")).toBeTruthy();
  });

  it("conclui lotes automáticos imediatamente e reinicia o progresso somente para um novo lote", async () => {
    await start(); vi.useFakeTimers();
    const send = (phase: Progress["phase"], completed: number, id: number | null) => progress({ kind: "automatic", phase, completed, total: 5000, operation_id: id, name: "changing.txt" });
    send("preparing", 0, null); send("organizing", 0, 42); send("preparing", 4999, 42);
    snapshot.history = [{ ...structuredClone(operation), kind: "automatic" }];
    await act(async () => send("completed", 5000, 42));
    expect(screen.getByText("Processamento concluído")).toBeTruthy();
    expect(screen.getByText(/1 organizado/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(150)); expect(screen.queryByRole("progressbar")).toBeNull();
    send("preparing", 0, null); send("organizing", 0, 43); send("organizing", 100, 43);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("100");
    await act(async () => send("error", 100, 43));
    expect(screen.getByText("A operação encontrou um erro")).toBeTruthy();
    act(() => vi.advanceTimersByTime(150)); expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("mantém a confirmação segura por identificador com uma prévia de 5.000 arquivos", async () => {
    snapshot.files = Array.from({ length: 5000 }, (_, index) => ({ ...snapshot.files[0], name: "Arquivo-" + index + ".txt", path: "/isolated/preview/" + index + ".txt" }));
    await start(); const dialog = await openPreview();
    expect(within(dialog).getByText("5000 prontos")).toBeTruthy();
    expect(within(dialog).getByRole("table").getAttribute("aria-rowcount")).toBe("5001");
    expect(dialog.querySelectorAll("tr[data-file-path]").length).toBeLessThan(25);
    const pending = deferred<number>(); mocks.organize.mockReturnValueOnce(pending.promise);
    const id = snapshot.preview_id;
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    expect(mocks.organize).toHaveBeenCalledExactlyOnceWith(id);
    expect(snapshot.files).toHaveLength(5000);
    snapshot.history = [structuredClone(operation)]; snapshot.preview_id = null;
    await act(async () => pending.resolve(42));
  });
  it("mostra o registro parcial do lote se a execução for interrompida", async () => {
    await start(); const dialog = await openPreview();
    const pending = deferred<number>(); mocks.organize.mockReturnValueOnce(pending.promise);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    progress({ kind: "manual", phase: "organizing", operation_id: 42, completed: 1, total: 2, name: "a.txt" });
    snapshot.history = [structuredClone(operation)]; snapshot.preview_id = null;
    await act(async () => pending.reject("Falha ao registrar o próximo arquivo"));
    await within(dialog).findByText("Falha ao registrar o próximo arquivo");
    expect(within(dialog).getByText(/1 organizado/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Confirmar organização" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ver resultado no histórico" }));
    expect(screen.getByRole("button", { name: /1 arquivo organizado/ }).getAttribute("aria-expanded")).toBe("true");
  });
  it("bloqueia a prévia anterior quando a atualização falha", async () => {
    await start(); const dialog = await openPreview();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    mocks.preview.mockRejectedValueOnce("Origem indisponível");
    fireEvent.click(within(dialog).getByRole("button", { name: "Atualizar prévia" }));
    await within(dialog).findByText("Origem indisponível");
    expect((within(dialog).getByRole("button", { name: "Confirmar organização" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(mocks.organize).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Atualizar prévia" }));
    await waitFor(() => expect((within(dialog).getByRole("checkbox") as HTMLInputElement).disabled).toBe(false));
    expect((within(dialog).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })));
  });
  it("não apresenta os resultados de outro lote automático enquanto atualiza o histórico", async () => {
    snapshot.history = [{ ...structuredClone(operation), kind: "automatic" }];
    await start();
    progress({ kind: "automatic", phase: "completed", operation_id: 43, completed: 1, total: 1, name: "" });
    const feedback = screen.getByText("Processamento concluído").closest("[role=status]")! as HTMLElement;
    expect(within(feedback).queryByText(/1 organizado/)).toBeNull();
    snapshot.history.unshift({ ...structuredClone(operation), id: 43, kind: "automatic" });
    await updateSnapshot();
    expect(within(feedback).getByText(/1 organizado/)).toBeTruthy();
  });
  it("bloqueia prévia expirada e exige conferir uma nova versão", async () => {
    await start();
    mocks.preview.mockImplementationOnce(async () => {
      snapshot.preview_id = 7;
      return { id: 7, created: Math.floor(Date.now() / 1000) - 301, files: snapshot.files };
    });
    const dialog = await openPreview();
    expect(within(dialog).getByText(/Esta prévia expirou/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Confirmar organização" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Atualizar prévia" }));
    await waitFor(() => expect(within(dialog).queryByText(/Esta prévia expirou/)).toBeNull());
    expect((within(dialog).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(confirm.disabled).toBe(true);
    expect(mocks.organize).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(confirm.disabled).toBe(false);
  });
  it("detecta invalidação pelo backend e não reutiliza confirmação", async () => {
    await start(); const dialog = await openPreview();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    snapshot.preview_id = null; await updateSnapshot();
    expect(within(dialog).getByText(/invalidada por outra operação/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    expect(mocks.organize).not.toHaveBeenCalled();
  });
  it("mostra progresso no modal, impede confirmação dupla e aguarda antes de fechar", async () => {
    await start(); const dialog = await openPreview();
    const pending = deferred<number>(); mocks.organize.mockReturnValueOnce(pending.promise);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    const confirm = within(dialog).getByRole("button", { name: "Confirmar organização" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(mocks.organize).toHaveBeenCalledOnce();
    expect(within(dialog).getByText("Preparando e verificando arquivos…")).toBeTruthy();
    progress({ kind: "manual", phase: "organizing", completed: 0, total: 1, name: "a.txt" });
    expect(within(dialog).getByText("Organizando arquivos…")).toBeTruthy();
    expect(within(dialog).getByRole("progressbar")).toBeTruthy();
    act(() => mocks.closeHandler?.({ preventDefault: vi.fn() }));
    expect((screen.getByRole("button", { name: "Sair" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Continuar no aplicativo" }));
    snapshot.history = [structuredClone(operation)]; snapshot.files = []; snapshot.preview_id = null;
    await act(async () => pending.resolve(42));
    await screen.findByRole("dialog", { name: "Resultado da organização" });
    expect(within(dialog).getByText(/1 organizado/)).toBeTruthy();
    expect(mocks.close).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Ver resultado no histórico" }));
    const history = screen.getByRole("button", { name: /1 arquivo organizado/ });
    expect(history.getAttribute("aria-expanded")).toBe("true");
  });
  it("permite atualizar após erro de confirmação sem repetir o identificador antigo", async () => {
    await start(); const dialog = await openPreview();
    mocks.organize.mockRejectedValueOnce("PREVIEW_INVALID: A prévia foi invalidada");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    await within(dialog).findByText("A prévia foi invalidada");
    expect((within(dialog).getByRole("button", { name: "Confirmar organização" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Atualizar prévia" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Atualizar prévia" }) as HTMLButtonElement).disabled).toBe(false));
    expect((within(dialog).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(mocks.organize).toHaveBeenCalledOnce();
  });
  it("confirma 10.000 arquivos uma única vez usando o ID original e mantém bloqueios durante a restauração", async () => {
    snapshot.history = [{ ...operation, movements: Array.from({ length: 10000 }, (_, index) => ({ ...operation.movements[0], id: index + 1, source: `/isolated/source/File-${index}.txt`, destination: `/isolated/destination/File-${index}.txt` })) }];
    await start(); navigate("Histórico");
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    const dialog = await screen.findByRole("dialog", { name: "Restaurar os arquivos à origem?" });
    expect(within(dialog).getByText("Operação #42 · 10000 de 10000 arquivos para restaurar")).toBeTruthy();
    const rows = dialog.querySelectorAll("[data-undo-movement-id]");
    expect(rows.length).toBeGreaterThan(0); expect(rows.length).toBeLessThan(25);
    const pending = deferred<void>(); mocks.undo.mockReturnValueOnce(pending.promise);
    const confirm = within(dialog).getByRole("button", { name: "Confirmar restauração" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(mocks.undo).toHaveBeenCalledExactlyOnceWith(operation.id);
    expect((within(dialog).getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" }); expect(screen.getByRole("dialog")).toBe(dialog);
    snapshot.history[0].movements = snapshot.history[0].movements.map(movement => ({ ...movement, status: "undone" }));
    await act(async () => pending.resolve());
    await screen.findByRole("dialog", { name: "Resultado da restauração" });
    expect(within(dialog).getByText(/10000 restaurados · 0 ainda no destino/)).toBeTruthy();
    expect(dialog.querySelectorAll("[data-undo-movement-id]")).toHaveLength(0);
  });
  it("mostra restauração em andamento e resultados reais de desfazer", async () => {
    snapshot.history = [structuredClone(operation)]; await start(); navigate("Histórico");
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    const dialog = await screen.findByRole("dialog", { name: "Restaurar os arquivos à origem?" });
    const pending = deferred<void>(); mocks.undo.mockReturnValueOnce(pending.promise);
    const confirm = within(dialog).getByRole("button", { name: "Confirmar restauração" });
    fireEvent.click(confirm); fireEvent.click(confirm); expect(mocks.undo).toHaveBeenCalledOnce();
    progress({ kind: "undo", phase: "organizing", completed: 0, total: 1, name: "a.txt" });
    expect(within(dialog).getByText("Restaurando arquivos…")).toBeTruthy();
    vi.useFakeTimers();
    progress({ kind: "undo", phase: "preparing", completed: 1, total: 1, name: "another.txt" });
    expect(within(dialog).getByText("Restaurando arquivos…")).toBeTruthy();
    snapshot.history[0].movements[0].status = "undone";
    await act(async () => pending.resolve());
    act(() => vi.advanceTimersByTime(150));
    vi.useRealTimers();
    await screen.findByRole("dialog", { name: "Resultado da restauração" });
    expect(within(dialog).getByText(/1 restaurado · 0 ainda no destino/)).toBeTruthy();
  });
  it("atualiza os itens reversíveis após uma restauração interrompida", async () => {
    snapshot.history = [structuredClone(operation)]; await start(); navigate("Histórico");
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    const dialog = await screen.findByRole("dialog", { name: "Restaurar os arquivos à origem?" });
    const pending = deferred<void>(); mocks.undo.mockReturnValueOnce(pending.promise);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar restauração" }));
    progress({ kind: "undo", phase: "organizing", operation_id: 42, completed: 1, total: 1, name: "a.txt" });
    snapshot.history[0].movements[0].status = "undone";
    await act(async () => pending.reject("Lote interrompido após restaurar"));
    await within(dialog).findByText("Lote interrompido após restaurar");
    expect(within(dialog).getByText(/1 restaurado · 0 ainda no destino/)).toBeTruthy();
    expect(within(dialog).queryByText("Restaurar para: /isolated/source/a.txt")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Confirmar restauração" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Ver resultado no histórico" })).toBeTruthy();
  });
});

describe("avisos e clareza", () => {
  it("aguarda 500 ms na primeira dica, reabre sem atraso e encerra a sequência após inatividade", async () => {
    await start(); vi.useFakeTimers();
    const trigger = screen.getByText(initial.source);
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(499); });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("tooltip").textContent).toBe(initial.source);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe(initial.source);
    fireEvent.keyDown(trigger, { key: "Escape" });
    fireEvent.pointerLeave(trigger);
    act(() => { vi.advanceTimersByTime(301); });
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
  it("não mostra dicas ao atravessar o caminho e abre imediatamente pelo foco de teclado", async () => {
    await start(); vi.useFakeTimers();
    const trigger = screen.getByText(initial.source);
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.pointerLeave(trigger);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => { trigger.focus(); });
    expect(screen.getByRole("tooltip").textContent).toBe(initial.source);
    expect(trigger.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("mantém o aviso durante recuperação falha e só o remove após confirmação do backend", async () => {
    snapshot.preferences.automatic = true; snapshot.watch_error = "Monitoramento indisponível";
    await start();
    mocks.retryMonitoring.mockRejectedValueOnce("Pasta ainda indisponível");
    fireEvent.click(screen.getByRole("button", { name: "Verificar e reativar monitor" }));
    await screen.findByText("Pasta ainda indisponível");
    await waitFor(() => expect((screen.getByRole("button", { name: "Verificar e reativar monitor" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("Monitoramento indisponível")).toBeTruthy();
    mocks.retryMonitoring.mockImplementationOnce(async () => { snapshot.watch_error = null; snapshot.monitoring = true; });
    fireEvent.click(screen.getByRole("button", { name: "Verificar e reativar monitor" }));
    await waitFor(() => expect(screen.queryByText("Monitoramento indisponível")).toBeNull());
    expect(screen.getByText("Monitoramento ativo")).toBeTruthy();
  });
  it("ignora respostas de leitura antigas sem substituir a versão atual ou o rascunho", async () => {
    await start(); navigate("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    const oldSnapshot = structuredClone(snapshotPayload());
    const delayed = deferred<Snapshot>(); mocks.snapshot.mockReturnValueOnce(delayed.promise);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar arquivos" }));
    snapshot.preferences = { ...initial, automatic: true };
    await updateSnapshot();
    expect(screen.getByText("As configurações salvas foram atualizadas")).toBeTruthy();
    await act(async () => delayed.resolve(oldSnapshot));
    expect(screen.getByText("As configurações salvas foram atualizadas")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claro" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("mantém todos os problemas visíveis e recolhe sem anunciar resolução", async () => {
    snapshot.scan_error = "Pasta removida"; snapshot.watch_error = "Watcher parou";
    render(<App />); await screen.findByText("Pasta removida");
    expect(screen.getByText("Watcher parou")).toBeTruthy();
    const toggle = screen.getAllByRole("button", { name: "Recolher detalhes do problema" })[0];
    act(() => { toggle.focus(); });
    fireEvent.click(toggle);
    expect((screen.getByText("Pasta removida") as HTMLElement).hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByText("A pasta precisa de atenção · pendente")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar detalhes" }));
    expect(screen.getByText("Pasta removida")).toBeTruthy();
    expect((screen.getByText("Pasta removida") as HTMLElement).hidden).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });
  it("mantém foco no diálogo animado e restaura ao título após Escape", async () => {
    await start();
    const dialog = await openPreview();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Visão geral", level: 1 }));
    expect(mocks.organize).not.toHaveBeenCalled();
    await openPreview();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
  it("diferencia filtro sem resultados e expõe motivos sem depender de hover", async () => {
    snapshot.files[0].status = "ignored"; snapshot.files[0].reason = "Categoria desativada";
    await start(); fireEvent.click(screen.getByRole("button", { name: /^Arquivos/ }));
    expect(screen.getByText("Categoria desativada")).toBeTruthy();
    const details = screen.getByText("Ver caminho e destino"); fireEvent.click(details);
    expect(screen.getByText(/Destino previsto: \/isolated/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar arquivos" }), { target: { value: "nada" } });
    expect(screen.getByText("Nenhum resultado para estes filtros")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(screen.getByText("a.txt")).toBeTruthy();
  });
});

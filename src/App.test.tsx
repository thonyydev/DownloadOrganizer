import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Operation, Preferences, Preview, Progress, Snapshot } from "./lib/api";
import App from "./App";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(), preview: vi.fn(), organize: vi.fn(), undo: vi.fn(), save: vi.fn(), retryMonitoring: vi.fn(),
  close: vi.fn(), choose: vi.fn(),
  events: new Map<string, (event: { payload: unknown }) => void>(),
  closeHandler: null as null | ((event: { preventDefault: () => void }) => void),
}));
vi.mock("./lib/api", async importOriginal => ({
  ...await importOriginal<typeof import("./lib/api")>(), native: true,
  api: { snapshot: mocks.snapshot, preview: mocks.preview, organize: mocks.organize, undo: mocks.undo, save: mocks.save, retryMonitoring: mocks.retryMonitoring },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name, callback) => {
  mocks.events.set(name, callback); return () => mocks.events.delete(name);
}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
  close: mocks.close, onCloseRequested: async (callback: typeof mocks.closeHandler) => { mocks.closeHandler = callback; return () => { mocks.closeHandler = null; }; },
}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.choose }));

let snapshot: Snapshot;
const initial: Preferences = { source: "/isolated/source", destination: "/isolated/destination", theme: "dark", automatic: false, enabled_categories: ["documents"] };
const operation: Operation = { id: 42, created: 1_700_000_000, kind: "manual", movements: [{ id: 1, source: "/isolated/source/a.txt", destination: "/isolated/destination/Documentos/a.txt", status: "moved", error: null, size: 1 }] };

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
function navigate(name: string) { fireEvent.click(screen.getByRole("button", { name })); }
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
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.clearAllMocks(); mocks.events.clear(); mocks.closeHandler = null;
  snapshot = {
    preferences: structuredClone(initial), categories: [{ id: "documents", name: "Documentos", extensions: ["txt"] }],
    files: [{ name: "a.txt", path: "/isolated/source/a.txt", destination: "/isolated/destination/Documentos/a.txt", extension: "txt", category: "documents", modified: 1_700_000_000_000, size: 1, status: "ready", reason: null }],
    history: [], monitoring: false, scan_error: null, watch_error: null, preview_id: null,
  };
  mocks.snapshot.mockImplementation(async () => structuredClone(snapshot));
  mocks.preview.mockImplementation(async (): Promise<Preview> => {
    snapshot.preview_id = (snapshot.preview_id ?? 0) + 1;
    return { id: snapshot.preview_id, created: Math.floor(Date.now() / 1000), files: structuredClone(snapshot.files) };
  });
  mocks.save.mockImplementation(async (prefs: Preferences) => { snapshot.preferences = structuredClone(prefs); return structuredClone(prefs); });
  mocks.close.mockResolvedValue(undefined);
  mocks.choose.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("composição desktop", () => {
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
    expect(within(row).getByText("1 ocorrência(s)")).toBeTruthy();
    expect((within(row).getByRole("button", { name: "Desfazer" }) as HTMLButtonElement).disabled).toBe(false);
    const expand = within(row).getByRole("button", { name: /1 arquivo organizado/ });
    fireEvent.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(within(row).getByText("Arquivo ocupado")).toBeTruthy();
    expect(within(row).getByText("/isolated/source/locked.txt")).toBeTruthy();
  });
});

describe("rascunho de configurações", () => {
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
  it("mostra o registro parcial do lote se a execução for interrompida", async () => {
    await start(); const dialog = await openPreview();
    const pending = deferred<number>(); mocks.organize.mockReturnValueOnce(pending.promise);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar organização" }));
    progress({ kind: "manual", phase: "organizing", operation_id: 42, completed: 1, total: 2, name: "a.txt" });
    snapshot.history = [structuredClone(operation)]; snapshot.preview_id = null;
    await act(async () => pending.reject("Falha ao registrar o próximo arquivo"));
    await within(dialog).findByText("Falha ao registrar o próximo arquivo");
    expect(within(dialog).getByText(/1 organizado\(s\)/)).toBeTruthy();
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
    expect(within(feedback).queryByText(/1 organizado\(s\)/)).toBeNull();
    snapshot.history.unshift({ ...structuredClone(operation), id: 43, kind: "automatic" });
    await updateSnapshot();
    expect(within(feedback).getByText(/1 organizado\(s\)/)).toBeTruthy();
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
    expect(within(dialog).getByText(/1 organizado\(s\)/)).toBeTruthy();
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
  it("mostra restauração em andamento e resultados reais de desfazer", async () => {
    snapshot.history = [structuredClone(operation)]; await start(); navigate("Histórico");
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    const dialog = await screen.findByRole("dialog", { name: "Restaurar os arquivos à origem?" });
    const pending = deferred<void>(); mocks.undo.mockReturnValueOnce(pending.promise);
    const confirm = within(dialog).getByRole("button", { name: "Confirmar restauração" });
    fireEvent.click(confirm); fireEvent.click(confirm); expect(mocks.undo).toHaveBeenCalledOnce();
    progress({ kind: "undo", phase: "organizing", completed: 0, total: 1, name: "a.txt" });
    expect(within(dialog).getByText("Restaurando arquivos…")).toBeTruthy();
    snapshot.history[0].movements[0].status = "undone";
    await act(async () => pending.resolve());
    await screen.findByRole("dialog", { name: "Resultado da restauração" });
    expect(within(dialog).getByText(/1 restaurado\(s\) · 0 ainda no destino/)).toBeTruthy();
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
    expect(within(dialog).getByText(/1 restaurado\(s\) · 0 ainda no destino/)).toBeTruthy();
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
    const oldSnapshot = structuredClone(snapshot);
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

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HistoryView } from "./history";
import type { Operation } from "@/lib/api";
import { summarizeOperation } from "@/lib/api";

const queries = vi.hoisted(() => ({ operation: vi.fn(), destinations: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: queries }));

vi.mock("@/components/motion/feedback", () => ({ useMotionAllowed: () => false, useFeedbackMotion: () => ({ current: null }) }));
const props = { expanded: 42, working: false, onExpand: vi.fn(), onUndo: vi.fn() };
const operationOf = (count: number): Operation => ({ id: 42, kind: "manual", created: 1700000000, movements: Array.from({ length: count }, (_, index) => ({
  id: index + 1, source: "/isolated/source/File-" + index + ".txt", destination: "/isolated/destination/Documents/File-" + index + ".txt", status: "moved", error: null, size: 1,
})) });
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("movement-scroll") ? 400 : this.hasAttribute("data-movement-id") ? 150 : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("movement-scroll") ? [...this.querySelectorAll<HTMLLIElement>("li")].reduce((height, row) => height + (row.hasAttribute("data-movement-id") ? 150 : Number.parseFloat(row.style.height) || 0), 0) : 0; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { height: this.offsetHeight, width: 800, top: 0, left: 0, bottom: this.offsetHeight, right: 800, x: 0, y: 0, toJSON: () => ({}) }; });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: function (this: HTMLElement, options: ScrollToOptions) { const top = options.top ?? 0; if (this.scrollTop !== top) { this.scrollTop = top; fireEvent.scroll(this); } } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo); else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"); });
function total(name: string) { return screen.getByText(name).parentElement!.querySelector("dd")!.textContent; }
function explore() { fireEvent.click(screen.getByRole("button", { name: "Explorar arquivos" })); return screen.getByRole("dialog", { name: "Arquivos da operação #42" }); }

it("consulta somente os destinos ao expandir um resumo e virtualiza os detalhes carregados sob demanda", async () => {
  const operation = operationOf(5000);
  queries.destinations.mockResolvedValue({ folders: [["/isolated/destination/Documents/", 5000]], other_folders: 0, other_files: 0 });
  queries.operation.mockResolvedValue(operation);
  render(<HistoryView {...props} history={[summarizeOperation(operation)]} />);
  expect(total("Arquivos envolvidos")).toBe("5000");
  await screen.findByText("/isolated/destination/Documents/");
  expect(queries.destinations).toHaveBeenCalledExactlyOnceWith(42);
  expect(queries.operation).not.toHaveBeenCalled();
  const dialog = explore();
  await within(dialog).findByText("File-0.txt");
  expect(queries.operation).toHaveBeenCalledExactlyOnceWith(42);
  expect(dialog.querySelectorAll("[data-movement-id]").length).toBeLessThan(20);
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Buscar arquivos da operação" }), { target: { value: "4999" } });
  expect(within(dialog).getByText("File-4999.txt")).toBeTruthy();
});

it("permite recuperar falhas na consulta de destinos e de arquivos sem perder a operação", async () => {
  const operation = operationOf(1);
  queries.destinations.mockRejectedValueOnce("Consulta falhou").mockResolvedValueOnce({ folders: [], other_folders: 0, other_files: 0 });
  queries.operation.mockRejectedValueOnce("Consulta falhou").mockResolvedValueOnce(operation);
  render(<HistoryView {...props} history={[summarizeOperation(operation)]} />);
  await screen.findByText(/Não foi possível consultar os destinos/);
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  const trigger = screen.getByRole("button", { name: "Explorar arquivos" }); act(() => trigger.focus());
  const dialog = explore();
  await within(dialog).findByText(/Não foi possível consultar os arquivos/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Tentar novamente" }));
  await within(dialog).findByText("File-0.txt");
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(props.onUndo).not.toHaveBeenCalled();
});

it("resume os estados reais e agrupa os caminhos de destino sem montar arquivos", () => {
  const op = operationOf(6);
  op.movements[1].status = "undone";
  op.movements[2].status = "failed"; op.movements[2].error = "Bloqueado";
  op.movements[3].status = "uncertain"; op.movements[4].status = "undo_pending";
  op.movements[5].destination = "C:\\isolated\\Images\\file.png"; op.movements[5].error = "Falha na restauração";
  render(<HistoryView {...props} history={[op]} />);
  expect(total("Arquivos envolvidos")).toBe("6"); expect(total("Organizados no destino")).toBe("2");
  expect(total("Restaurados")).toBe("1"); expect(total("Falhas ou verificação")).toBe("4");
  expect(screen.getByText("/isolated/destination/Documents/")).toBeTruthy(); expect(screen.getByText("C:\\isolated\\Images\\")).toBeTruthy();
  expect(screen.getByText("5 arquivo(s)")).toBeTruthy(); expect(screen.queryByText("Bloqueado")).toBeNull();
  expect(document.querySelectorAll("[data-movement-id]")).toHaveLength(0);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Desfazer" })); expect(props.onUndo).toHaveBeenCalledExactlyOnceWith(op);
});

it.each([5000, 10000])("abre %i movimentações com DOM limitado e alcança os extremos pelo teclado", count => {
  render(<HistoryView {...props} history={[operationOf(count)]} />);
  expect(total("Arquivos envolvidos")).toBe(String(count)); expect(document.querySelectorAll(".movement")).toHaveLength(0);
  const dialog = explore();
  expect(dialog.querySelectorAll("[data-movement-id]").length).toBeGreaterThan(0);
  expect(dialog.querySelectorAll("[data-movement-id]").length).toBeLessThan(20);
  const scroll = within(dialog).getByRole("region", { name: "Arquivos da operação" });
  act(() => scroll.focus()); fireEvent.keyDown(scroll, { key: "End" });
  expect(within(dialog).getByText("File-" + (count - 1) + ".txt")).toBeTruthy();
  expect(document.activeElement).toBe(scroll); expect(dialog.querySelectorAll(".movement").length).toBeLessThan(20);
  fireEvent.keyDown(scroll, { key: "Home" }); expect(within(dialog).getByText("File-0.txt")).toBeTruthy();
});

it("mantém a distribuição compacta mesmo quando cada arquivo tem uma pasta diferente", () => {
  const op = operationOf(5000); op.movements.forEach((movement, index) => { movement.destination = "/isolated/folder-" + index + "/file.txt"; });
  render(<HistoryView {...props} history={[op]} />);
  expect(document.querySelectorAll(".destination-summary dt")).toHaveLength(5);
  expect(screen.getByText("4995 outras pastas · 4995 arquivo(s). Consulte os caminhos no explorador.")).toBeTruthy();
});

it("busca por nome, filtra status e problemas e apresenta os caminhos e erros", () => {
  const op = operationOf(5000); op.movements[4321].status = "failed"; op.movements[4321].error = "Destino ocupado";
  render(<HistoryView {...props} history={[op]} />); const dialog = explore();
  expect(dialog.querySelector("[data-movement-id]")?.getAttribute("data-movement-id")).toBe("4322");
  expect(within(dialog).getByText("Destino ocupado")).toBeTruthy();
  const input = within(dialog).getByRole("textbox", { name: "Buscar arquivos da operação" });
  const filter = within(dialog).getByRole("combobox", { name: "Filtrar por status" });
  fireEvent.change(input, { target: { value: "FILE-4999" } });
  expect(within(dialog).getByText("1 de 5000 arquivo(s) · Ocorrências primeiro")).toBeTruthy();
  expect(within(dialog).getByText(op.movements[4999].destination)).toBeTruthy();
  fireEvent.change(filter, { target: { value: "failed" } }); expect(within(dialog).getByText("Nenhum arquivo corresponde aos filtros")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Limpar filtros" }));
  fireEvent.change(filter, { target: { value: "problems" } });
  expect(within(dialog).getByText("File-4321.txt")).toBeTruthy(); expect(within(dialog).getByText(op.movements[4321].source)).toBeTruthy();
  expect(dialog.querySelectorAll(".movement")).toHaveLength(1);
});

it("atualiza resumo e explorador após desfazer sem alterar o controle de restauração", () => {
  const op = operationOf(2); const view = render(<HistoryView {...props} history={[op]} />); explore();
  const next = structuredClone(op); next.movements[0].status = "undone"; next.movements[1].status = "undone";
  view.rerender(<HistoryView {...props} history={[next]} />);
  expect(total("Organizados no destino")).toBe("0"); expect(total("Restaurados")).toBe("2");
  const dialog = screen.getByRole("dialog"); expect(dialog.querySelectorAll(".status-undone")).toHaveLength(2);
  expect((screen.getByRole("button", { name: "Desfazer", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
});

it("fecha com Escape ou X, sem rodapé, e restaura o foco no acionador sem mudar a rolagem", async () => {
  render(<HistoryView {...props} history={[operationOf(100)]} />);
  const trigger = screen.getByRole("button", { name: "Explorar arquivos" }); act(() => trigger.focus());
  const scrollBefore = document.documentElement.scrollTop;
  const dialog = explore(); expect(document.activeElement).toBe(within(dialog).getByRole("textbox"));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger); expect(document.documentElement.scrollTop).toBe(scrollBefore);
  const reopened = explore();
  expect(within(reopened).queryByRole("button", { name: "Fechar explorador" })).toBeNull();
  expect(reopened.querySelector('[data-slot="dialog-footer"]')).toBeNull();
  fireEvent.click(within(reopened).getByRole("button", { name: /^Fechar$/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.querySelectorAll(".movement")).toHaveLength(0);
  expect(document.activeElement).toBe(trigger);
});

it("preserva estados vazios e só monta o resumo quando expandido", () => {
  const view = render(<HistoryView {...props} history={[]} />); expect(screen.getByText("Nenhuma operação registrada")).toBeTruthy();
  view.rerender(<HistoryView {...props} expanded={null} history={[operationOf(0)]} />);
  expect(screen.queryByText("Arquivos envolvidos")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /0 arquivos organizados/ })); expect(props.onExpand).toHaveBeenCalledWith(42);
  view.rerender(<HistoryView {...props} history={[operationOf(0)]} />); const dialog = explore();
  expect(within(dialog).getByText("Nenhuma movimentação registrada")).toBeTruthy();
});

it("mantém 5.000 arquivos virtualizados durante a saída e reabre com movimentos novos", async () => {
  const computed = window.getComputedStyle.bind(window);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => new Proxy(computed(element), { get(target, key) {
    if (key === "animationName") return element.getAttribute("data-state") === "closed" ? "dialog-close" : "none";
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } }));
  const view = render(<HistoryView {...props} history={[operationOf(5000)]} />);
  const trigger = screen.getByRole("button", { name: "Explorar arquivos" }); act(() => trigger.focus());
  const dialog = explore(); const list = dialog.querySelector(".movement-scroll"); const rows = list!.innerHTML;
  fireEvent.click(within(dialog).getByRole("button", { name: /^Fechar$/ }));
  expect(dialog.getAttribute("data-state")).toBe("closed"); expect(dialog.hasAttribute("inert")).toBe(true);
  expect(dialog.querySelector(".movement-scroll")).toBe(list); expect(list!.innerHTML).toBe(rows);
  expect(dialog.querySelectorAll("[data-movement-id]").length).toBeLessThan(20);
  for (const element of document.querySelectorAll('[data-state="closed"]')) {
    const event = new Event("animationend", { bubbles: true }); Object.defineProperty(event, "animationName", { value: "dialog-close" }); fireEvent(element, event);
  }
  expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull(); await waitFor(() => expect(document.activeElement).toBe(trigger));
  const next = operationOf(1); next.movements[0].source = "/isolated/latest.txt";
  view.rerender(<HistoryView {...props} history={[next]} />);
  const reopened = explore(); expect(within(reopened).getByText("latest.txt")).toBeTruthy(); expect(within(reopened).queryByText("File-0.txt")).toBeNull();
});

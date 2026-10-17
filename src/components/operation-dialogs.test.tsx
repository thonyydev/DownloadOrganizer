import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { OperationDialogs } from "./operation-dialogs";
import type { Operation, Preview } from "@/lib/api";

vi.mock("@/components/motion/feedback", () => ({ useMotionAllowed: () => false, useFeedbackMotion: () => ({ current: null }) }));
const operation: Operation = { id: 42, kind: "manual", created: 1700000000, movements: [{ id: 1, source: "/isolated/file.txt", destination: "/isolated/destination/file.txt", status: "moved", size: 1, error: null }] };
const preview: Preview = { id: 1, created: 1700000000, files: [{ name: "file.txt", path: "/isolated/file.txt", destination: "/isolated/destination/file.txt", size: 1, extension: "txt", category: "documents", modified: 1700000000000, status: "ready", reason: null }] };
const props = { preview: null, undoTarget: null, categories: [], action: null, busy: false, working: false, issue: "", reviewed: true, onReviewed: vi.fn(), onUpdate: vi.fn(), onOrganize: vi.fn(), onUndo: vi.fn(), onClose: vi.fn(), onViewResult: vi.fn(), onRestoreFocus: vi.fn() };
const operationOf = (count: number): Operation => ({ ...operation, movements: Array.from({ length: count }, (_, index) => ({ ...operation.movements[0], id: index + 1, source: `/isolated/source/File-${index}.txt`, destination: `/isolated/destination/File-${index}.txt` })) });
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const observers: { elements: Set<Element>; callback: ResizeObserverCallback }[] = [];
let viewportHeight = 400;
let rowHeight = 140;
beforeEach(() => {
  vi.clearAllMocks();
  observers.length = 0; viewportHeight = 400; rowHeight = 140;
  vi.stubGlobal("ResizeObserver", class {
    entry: typeof observers[number];
    constructor(callback: ResizeObserverCallback) { this.entry = { callback, elements: new Set() }; observers.push(this.entry); }
    observe(element: Element) { this.entry.elements.add(element); }
    unobserve(element: Element) { this.entry.elements.delete(element); }
    disconnect() { this.entry.elements.clear(); }
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("undo-files") ? viewportHeight : this.hasAttribute("data-undo-movement-id") ? rowHeight : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("undo-files") ? [...this.querySelectorAll<HTMLElement>("li")].reduce((height, row) => height + (row.hasAttribute("data-undo-movement-id") ? rowHeight : Number.parseFloat(row.style.height) || 0), 0) : 0; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { height: this.offsetHeight, width: 500, top: 0, left: 0, bottom: this.offsetHeight, right: 500, x: 0, y: 0, toJSON: () => ({}) }; });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: function (this: HTMLElement, options: ScrollToOptions) { const top = options.top ?? 0; if (this.scrollTop !== top) { this.scrollTop = top; fireEvent.scroll(this); } } });
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  const computed = window.getComputedStyle.bind(window);
  // JSDOM has no animation clock/live computed styles; drive Radix animationend explicitly.
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => new Proxy(computed(element), { get(target, key) {
    if (key === "animationName") return element.getAttribute("data-state") === "closed" ? "dialog-close" : "none";
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } }));
});
afterEach(async () => { cleanup(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo); else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"); });
function panel() { return document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!; }
function endExit() {
  for (const element of document.querySelectorAll('[data-state="closed"]')) {
    const event = new Event("animationend", { bubbles: true }); Object.defineProperty(event, "animationName", { value: "dialog-close" }); fireEvent(element, event);
  }
}

it.each([0, 1, 100, 5000, 10000])("mostra a contagem real, mantém DOM limitado e alcança os extremos com %i arquivos", count => {
  const current = operationOf(count);
  render(<OperationDialogs {...props} undoTarget={current} />);
  const dialog = panel();
  expect(within(dialog).getByText(`Operação #42 · ${count} de ${count} arquivo(s) para restaurar.`)).toBeTruthy();
  const region = within(dialog).getByRole("region", { name: "Arquivos para restaurar" });
  expect(region.getAttribute("tabindex")).toBe("0");
  expect((within(dialog).getByRole("button", { name: "Confirmar restauração" }) as HTMLButtonElement).disabled).toBe(count === 0);
  const rows = () => dialog.querySelectorAll("[data-undo-movement-id]");
  if (!count) { expect(rows()).toHaveLength(0); expect(within(region).getByRole("status").textContent).toContain("Nenhum arquivo disponível"); return; }
  expect(rows().length).toBeGreaterThan(0); expect(rows().length).toBeLessThan(25);
  expect(within(region).getByText("Local atual: /isolated/destination/File-0.txt")).toBeTruthy();
  expect(within(region).getByText("Restaurar para: /isolated/source/File-0.txt")).toBeTruthy();
  act(() => region.focus()); fireEvent.keyDown(region, { key: "End" });
  expect(within(region).getByText(`File-${count - 1}.txt`)).toBeTruthy();
  expect(dialog.querySelector(`[data-undo-movement-id="${count}"]`)?.getAttribute("aria-setsize")).toBe(String(count));
  expect(dialog.querySelector(`[data-undo-movement-id="${count}"]`)?.getAttribute("aria-posinset")).toBe(String(count));
  expect(rows().length).toBeLessThan(25); expect(document.activeElement).toBe(region);
  fireEvent.keyDown(region, { key: "Home" }); expect(within(region).getByText("File-0.txt")).toBeTruthy();
  expect(current.movements).toHaveLength(count); expect(props.onUndo).not.toHaveBeenCalled();
});

it("atualiza movimentos parcialmente reversíveis sem remontar a lista nem perder a rolagem em refresh", () => {
  const current = operationOf(5000);
  const view = render(<OperationDialogs {...props} undoTarget={current} />);
  const region = within(panel()).getByRole("region", { name: "Arquivos para restaurar" });
  fireEvent.keyDown(region, { key: "End" }); const top = region.scrollTop;
  const next = structuredClone(current);
  view.rerender(<OperationDialogs {...props} undoTarget={current} operation={next} />);
  expect(within(panel()).getByRole("region", { name: "Arquivos para restaurar" })).toBe(region);
  expect(region.scrollTop).toBe(top); expect(within(region).getByText("File-4999.txt")).toBeTruthy();
  const partial = operationOf(5); partial.movements[0].status = "undone"; partial.movements[1].status = "failed"; partial.movements[2].status = "uncertain";
  view.rerender(<OperationDialogs {...props} undoTarget={current} operation={partial} action={{ kind: "undo", phase: "error", operationId: 42, error: "Falha parcial" }} />);
  expect(within(panel()).getByText("Operação #42 · 2 de 5 arquivo(s) para restaurar.")).toBeTruthy();
  expect(within(region).queryByText("File-0.txt")).toBeNull(); expect(within(region).getByText("File-3.txt")).toBeTruthy();
  expect(within(panel()).getByRole("alert").textContent).toContain("Falha parcial");
  expect((within(panel()).getByRole("button", { name: "Confirmar restauração" }) as HTMLButtonElement).disabled).toBe(false);
  partial.movements = partial.movements.map(movement => ({ ...movement, status: "undone" }));
  view.rerender(<OperationDialogs {...props} undoTarget={current} operation={{ ...partial }} />);
  expect((within(panel()).getByRole("button", { name: "Confirmar restauração" }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(["Escape", "X", "Cancelar"])("fecha 5.000 movimentos por %s mantendo a lista durante a saída e sem executar restauração", async method => {
  const view = render(<OperationDialogs {...props} undoTarget={operationOf(5000)} />);
  const old = panel(); const region = within(old).getByRole("region", { name: "Arquivos para restaurar" }); const content = region.innerHTML;
  if (method === "Escape") fireEvent.keyDown(old, { key: "Escape" });
  else fireEvent.click(method === "X" ? old.querySelector('[data-slot="dialog-close"]')! : within(old).getByRole("button", { name: "Cancelar" }));
  expect(props.onClose).toHaveBeenCalledOnce();
  view.rerender(<OperationDialogs {...props} />);
  expect(panel()).toBe(old); expect(old.querySelector(".undo-files")).toBe(region); expect(region.innerHTML).toBe(content);
  expect(old.hasAttribute("inert")).toBe(true); expect(old.querySelectorAll("[data-undo-movement-id]").length).toBeLessThan(25);
  fireEvent.click(within(old).getByText("Confirmar restauração")); expect(props.onUndo).not.toHaveBeenCalled();
  endExit(); await waitFor(() => expect(props.onRestoreFocus).toHaveBeenCalledOnce()); expect(panel()).toBeNull();
  view.rerender(<OperationDialogs {...props} undoTarget={{ ...operationOf(1), id: 43 }} />);
  expect(within(panel()).getByText("Operação #43 · 1 de 1 arquivo(s) para restaurar.")).toBeTruthy();
  expect(panel().querySelectorAll("[data-undo-movement-id]")).toHaveLength(1);
});

it("mede novamente caminhos com alturas variáveis após redimensionar", async () => {
  const current = operationOf(10000);
  current.movements[0].source = "/isolated/" + "long-path/".repeat(60) + "file.txt";
  render(<OperationDialogs {...props} undoTarget={current} />);
  const region = within(panel()).getByRole("region", { name: "Arquivos para restaurar" });
  viewportHeight = 200; rowHeight = 280;
  await act(async () => {
    for (const observer of observers) for (const element of observer.elements) observer.callback([{ target: element, borderBoxSize: [{ blockSize: (element as HTMLElement).offsetHeight, inlineSize: 500 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  expect(within(region).getByText("Restaurar para: " + current.movements[0].source)).toBeTruthy();
  expect(region.querySelectorAll("[data-undo-movement-id]").length).toBeLessThan(25);
  fireEvent.keyDown(region, { key: "End" }); expect(within(region).getByText("File-9999.txt")).toBeTruthy();
});

it.each([false, true])("preserva a prévia durante a saída, inclusive vazia=%s, e reabre com dados atuais", async empty => {
  const current = empty ? { ...preview, files: [] } : preview;
  const view = render(<OperationDialogs {...props} preview={current} />);
  const old = panel(); const content = old.textContent;
  fireEvent.click(within(old).getByRole("button", { name: "Cancelar" })); expect(props.onClose).toHaveBeenCalledOnce();
  view.rerender(<OperationDialogs {...props} reviewed={false} />);
  expect(panel()).toBe(old); expect(old.textContent).toBe(content); expect(old.hasAttribute("inert")).toBe(true);
  if (!empty) fireEvent.click(within(old).getByText("Confirmar organização"));
  expect(props.onOrganize).not.toHaveBeenCalled();
  endExit(); expect(panel()).toBeNull(); await waitFor(() => expect(props.onRestoreFocus).toHaveBeenCalledOnce());
  const next = { ...preview, id: 2, files: [{ ...preview.files[0], name: "new.txt", path: "/isolated/new.txt" }] };
  view.rerender(<OperationDialogs {...props} preview={next} reviewed={false} />);
  expect(within(panel()).getByText("new.txt")).toBeTruthy(); expect(within(panel()).queryByText("file.txt")).toBeNull();
  expect((within(panel()).getByRole("button", { name: "Confirmar organização" }) as HTMLButtonElement).disabled).toBe(true);
});

it("mantém o resultado concluído e impede ações antigas enquanto fecha pelo X", () => {
  const view = render(<OperationDialogs {...props} preview={preview} action={{ kind: "organize", phase: "completed", operationId: 42 }} operation={operation} />);
  const old = panel(); const content = old.textContent;
  fireEvent.click(old.querySelector('[data-slot="dialog-close"]')!);
  view.rerender(<OperationDialogs {...props} />);
  expect(old.textContent).toBe(content); expect(within(old).getByText("Resultado da organização")).toBeTruthy();
  fireEvent.click(within(old).getByText("Ver resultado no histórico")); expect(props.onViewResult).not.toHaveBeenCalled();
  endExit(); expect(panel()).toBeNull();
});

it("preserva os arquivos de Desfazer ao fechar por Escape e aceita uma reabertura antes do fim da saída", () => {
  const view = render(<OperationDialogs {...props} undoTarget={operation} />);
  const old = panel(); const content = old.textContent;
  fireEvent.keyDown(old, { key: "Escape" }); expect(props.onClose).toHaveBeenCalledOnce();
  view.rerender(<OperationDialogs {...props} />);
  expect(old.textContent).toBe(content); fireEvent.click(within(old).getByText("Confirmar restauração")); expect(props.onUndo).not.toHaveBeenCalled();
  const next = { ...operation, id: 43, movements: [{ ...operation.movements[0], source: "/isolated/new.txt" }] };
  view.rerender(<OperationDialogs {...props} undoTarget={next} />);
  expect(panel()).toBe(old); expect(old.hasAttribute("inert")).toBe(false); expect(within(old).getByText("new.txt")).toBeTruthy();
  expect(within(old).queryByText("file.txt")).toBeNull();
});

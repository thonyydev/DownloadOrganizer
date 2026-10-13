import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTable } from "./file-table";
import type { FileEntry } from "@/lib/api";

vi.mock("@/components/motion/feedback", () => ({ useMotionAllowed: () => false }));
const filesOf = (count: number): FileEntry[] => Array.from({ length: count }, (_, index) => ({
  name: "Arquivo-" + index + ".pdf", path: "/isolated/" + index + ".pdf",
  destination: "/isolated/destination/" + index + ".pdf", extension: "pdf",
  category: index % 2 ? "images" : "documents", modified: 1700000000000,
  size: 100, status: index % 10 === 0 ? "conflict" : "ready", reason: index % 10 === 0 ? "Nome já existe" : null,
}));
const categories = [{ id: "documents", name: "Documentos", extensions: ["pdf"] }, { id: "images", name: "Imagens", extensions: ["png"] }];
const observers: { elements: Set<Element>; callback: ResizeObserverCallback }[] = [];
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
let height = 400;
const rowHeight = (element: HTMLElement) => element.hasAttribute("data-file-path") ? element.querySelector('[aria-expanded="true"]') ? 180 : 80 : Number(element.querySelector("td")?.style.height.replace("px", "") ?? 0);
async function resize(element: HTMLElement) {
  await act(async () => { for (const observer of observers) if (observer.elements.has(element)) {
    observer.callback([{ target: element, borderBoxSize: [{ blockSize: element.offsetHeight, inlineSize: 800 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
  } await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
}
function scroller() { return screen.getByLabelText("Rolagem dos arquivos", { selector: "div" }); }
function scrollTo(element: HTMLElement, top: number) { element.scrollTop = top; fireEvent.scroll(element); }
beforeEach(() => {
  height = 400; observers.length = 0;
  vi.stubGlobal("ResizeObserver", class {
    entry: typeof observers[number];
    constructor(callback: ResizeObserverCallback) { this.entry = { callback, elements: new Set() }; observers.push(this.entry); }
    observe(element: Element) { this.entry.elements.add(element); }
    unobserve(element: Element) { this.entry.elements.delete(element); }
    disconnect() { this.entry.elements.clear(); }
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("table-scroll") ? height : this.tagName === "TR" ? rowHeight(this) : this.tagName === "THEAD" ? 40 : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("table-scroll") ? 40 + [...this.querySelectorAll<HTMLTableRowElement>("tbody tr")].reduce((total, row) => total + rowHeight(row), 0) : 100; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { height: this.offsetHeight, width: 800, top: 0, left: 0, bottom: this.offsetHeight, right: 800, x: 0, y: 0, toJSON: () => ({}) }; });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: function (this: HTMLElement, options: ScrollToOptions | number) { const top = typeof options === "number" ? options : options.top ?? 0; if (this.scrollTop !== top) scrollTo(this, top); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo); else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"); });
describe("tabela virtual", () => {
  it.each([100, 1000, 5000, 10000])("limita DOM e alcança o último registro com %i arquivos", count => {
    render(<FileTable files={filesOf(count)} categories={categories} />);
    expect(screen.getByRole("region", { name: "Rolagem dos arquivos" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("table").getAttribute("aria-rowcount")).toBe(String(count + 1));
    expect(document.querySelectorAll("tr[data-file-path]").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("tr[data-file-path]").length).toBeLessThan(25);
    const container = scroller();
    scrollTo(container, container.scrollHeight - height);
    expect(screen.getByText("Arquivo-" + (count - 1) + ".pdf")).toBeTruthy();
    expect(document.querySelectorAll("tr[data-file-path]").length).toBeLessThan(25);
    scrollTo(container, 0);
    expect(screen.getByText("Arquivo-0.pdf")).toBeTruthy();
  });
  it("mede expansão, conserva estado fora da viewport e mantém scroll num snapshot novo", async () => {
    const files = filesOf(5000); const view = render(<FileTable files={files} categories={categories} />);
    const container = scroller();
    const first = container.querySelector<HTMLTableRowElement>('tr[data-index="0"]')!;
    fireEvent.click(within(first).getByRole("button"));
    await resize(first);
    expect(first.getAttribute("aria-rowindex")).toBe("2");
    expect(first.querySelector('[aria-expanded="true"]')).toBeTruthy();
    expect(document.querySelector(".virtual-space td")?.getAttribute("style")).toBeTruthy();
    scrollTo(container, 8000);
    expect(screen.queryByText("Arquivo-0.pdf")).toBeNull();
    const retained = container.querySelector(".file-disclosure");
    view.rerender(<FileTable files={structuredClone(files)} categories={categories} />);
    expect(container.scrollTop).toBe(8000);
    expect(container.querySelector(".file-disclosure")).toBe(retained);
    scrollTo(container, 0);
    const reopened = container.querySelector<HTMLTableRowElement>('tr[data-index="0"]')!;
    expect(reopened.querySelector('[aria-expanded="true"]')).toBeTruthy();
    const trigger = within(reopened).getByRole("button");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)?.textContent).toContain(files[0].destination);
    fireEvent.click(trigger); await resize(reopened);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
  it("preserva a linha focada ao rolar e permite End, Home e Tab em registros não montados", () => {
    render(<FileTable files={filesOf(10000)} categories={categories} />);
    const container = scroller();
    const first = container.querySelector<HTMLButtonElement>(".file-disclosure")!;
    act(() => first.focus());
    scrollTo(container, 8000);
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "End" });
    const last = container.querySelector<HTMLButtonElement>('tr[data-index="9999"] .file-disclosure')!;
    expect(document.activeElement).toBe(last);
    expect(document.querySelectorAll("tr[data-file-path]").length).toBeLessThan(25);
    fireEvent.keyDown(last, { key: "Tab", shiftKey: true });
    expect(document.activeElement?.closest("tr")?.getAttribute("data-index")).toBe("9998");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement?.closest("tr")?.getAttribute("data-index")).toBe("0");
  });
  it("responde a resize e reinicia scroll somente quando o filtro muda", async () => {
    const files = filesOf(5000); const view = render(<FileTable files={files} categories={categories} />);
    const container = scroller(); scrollTo(container, 8000);
    height = 700; await resize(container);
    expect(container.scrollTop).toBe(8000);
    view.rerender(<FileTable files={files.filter(file => file.category === "images")} categories={categories} filterKey="images:" />);
    expect(container.scrollTop).toBe(0); fireEvent.scroll(container);
    expect(screen.getByRole("table").getAttribute("aria-rowcount")).toBe("2501");
    expect(screen.getByText("Arquivo-1.pdf")).toBeTruthy();
  });
  it("virtualiza a prévia sem reduzir os dados nem ocultar destinos e conflitos", () => {
    const files = filesOf(5000);
    render(<FileTable files={files} categories={categories} preview />);
    expect(screen.getByRole("table", { name: "Arquivos e destinos da prévia" }).getAttribute("aria-rowcount")).toBe("5001");
    expect(document.querySelectorAll("tr[data-file-path]").length).toBeLessThan(25);
    expect(screen.getByText(files[0].destination)).toBeTruthy();
    expect(screen.getAllByText("Nome já existe").length).toBeGreaterThan(0);
    const container = screen.getByLabelText("Rolagem dos arquivos da prévia", { selector: "div" });
    fireEvent.keyDown(container, { key: "End" });
    expect(screen.getByText(files[4999].destination)).toBeTruthy();
    expect(files).toHaveLength(5000);
  });
  it("recupera foco se o arquivo focado for removido sem roubá-lo em buscas posteriores", () => {
    const files = filesOf(100); const view = render(<FileTable files={files} categories={categories} />);
    act(() => scroller().querySelector<HTMLButtonElement>(".file-disclosure")!.focus());
    view.rerender(<FileTable files={[]} categories={categories} />);
    expect(document.activeElement).toBe(screen.getByRole("status"));
    view.rerender(<FileTable files={files.slice(1)} categories={categories} />);
    act(() => scroller().querySelector<HTMLButtonElement>(".file-disclosure")!.focus());
    view.rerender(<FileTable files={files.slice(2)} categories={categories} />);
    expect(document.activeElement).toBe(scroller());
  });
  it("diferencia pasta vazia de filtros sem resultados", () => {
    const clear = vi.fn(); const view = render(<FileTable files={[]} categories={categories} />);
    expect(screen.getByRole("status").textContent).toContain("Nenhum arquivo por aqui");
    view.rerender(<FileTable files={[]} categories={categories} filtered onClearFilters={clear} />);
    expect(screen.getByRole("status").textContent).toContain("Nenhum resultado");
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" })); expect(clear).toHaveBeenCalledOnce();
  });
});

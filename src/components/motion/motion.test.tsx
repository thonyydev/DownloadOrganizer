import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnimatedCount } from "./animated-count";
import { OperationFeedback } from "@/components/operation-feedback";
import { SuccessNotice } from "@/components/success-notice";
import { HistoryView } from "@/components/history";
import type { FileEntry, Operation } from "@/lib/api";
import { StrictMode, useRef, useState } from "react";
import { NavigationIndicator, PageTransition, usePagePosition } from "./transitions";
import { Collapse } from "./collapse";
import { FileTable } from "@/components/file-table";

const motion = vi.hoisted(() => ({ animate: vi.fn() }));
vi.mock("motion/react", async importOriginal => ({ ...await importOriginal<typeof import("motion/react")>(), animate: motion.animate }));
interface Playback {
  from: number | Element;
  to: number | { opacity: number[]; height?: number[]; y?: number[] };
  options: { duration: number; delay?: number; onUpdate?: (value: number) => void; onComplete?: () => void };
  stop: ReturnType<typeof vi.fn>;
}
let playbacks: Playback[];
let reduced: boolean;
let hidden: boolean;
let listeners: Set<() => void>;
let resize: () => void;
function reduce(value: boolean) { act(() => { reduced = value; listeners.forEach(listener => listener()); }); }
function visibility(value: boolean) { act(() => { hidden = value; document.dispatchEvent(new Event("visibilitychange")); }); }
const operation: Operation = { id: 42, created: 1700000000, kind: "manual", movements: [{ id: 1, source: "/isolated/a.txt", destination: "/isolated/destination/a.txt", size: 1, status: "moved", error: null }] };

beforeEach(() => {
  playbacks = []; reduced = false; hidden = false; listeners = new Set();
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return reduced; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  })));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  motion.animate.mockReset();
  motion.animate.mockImplementation((from, to, options) => {
    const playback = { from, to, options, stop: vi.fn() };
    playbacks.push(playback);
    return playback;
  });
});

describe("indicador persistente da navegação", () => {
  const pages = ["overview", "files", "history", "settings"];
  const menu = (page: string) => <nav><NavigationIndicator page={page} />{pages.map((id, index) => <button className="nav-item" data-index={index} aria-current={page === id ? "page" : undefined} key={id}>{id}</button>)}</nav>;
  function geometry() {
    const box = { origin: 100, step: 40, height: 36 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { top: box.origin + Number(this.getAttribute("data-index") ?? 0) * box.step, height: box.height } as DOMRect;
    });
    return box;
  }
  it("mantém o mesmo DOM e retoma da posição visual atual em alternâncias rápidas", () => {
    geometry();
    const view = render(menu("overview"));
    const bar = view.container.querySelector<HTMLElement>(".nav-indicator")!;
    expect(bar.style.transform).toBe("translateY(6px)");
    expect(bar.style.height).toBe("24px");
    view.rerender(menu("settings"));
    expect(playbacks[0].from).toBe(6); expect(playbacks[0].to).toBe(126);
    act(() => playbacks[0].options.onUpdate?.(78));
    view.rerender(menu("history"));
    expect(view.container.querySelector(".nav-indicator")).toBe(bar);
    expect(playbacks[0].stop).toHaveBeenCalledOnce();
    expect(playbacks[1].from).toBe(78); expect(playbacks[1].to).toBe(86);
    expect(bar.style.transform).toBe("translateY(78px)");
    act(() => { playbacks[0].options.onUpdate?.(120); playbacks[0].options.onComplete?.(); });
    expect(bar.style.transform).toBe("translateY(78px)");
    act(() => playbacks[1].options.onComplete?.());
    expect(bar.style.transform).toBe("translateY(86px)");
    view.rerender(menu("history")); act(() => resize());
    expect(playbacks).toHaveLength(2);
  });
  it("mede no espaço do menu: rolagem cancela; resize preserva frações e cancela callbacks antigos", () => {
    const box = geometry();
    const view = render(menu("settings"));
    box.origin -= 489;
    view.rerender(menu("overview"));
    expect(playbacks[0].from).toBe(126); expect(playbacks[0].to).toBe(6);
    act(() => playbacks[0].options.onUpdate?.(100));
    view.rerender(menu("settings"));
    box.step = 40.5; box.height = 36.5;
    act(() => resize());
    expect(playbacks[2].from).toBe(100); expect(playbacks[2].to).toBe(127.5);
    const bar = view.container.querySelector<HTMLElement>(".nav-indicator")!;
    expect(bar.style.height).toBe("24.5px");
    act(() => playbacks[1].options.onComplete?.());
    expect(bar.style.transform).toBe("translateY(100px)");
    view.unmount();
    expect(playbacks[2].stop).toHaveBeenCalledOnce();
  });
  it("inicializa sem viagem em StrictMode e aplica preferência reduzida sem remontagem ou replay", () => {
    geometry();
    const view = render(<StrictMode>{menu("settings")}</StrictMode>);
    const bar = view.container.querySelector<HTMLElement>(".nav-indicator")!;
    expect(bar.style.transform).toBe("translateY(126px)"); expect(playbacks).toHaveLength(0);
    view.rerender(<StrictMode>{menu("overview")}</StrictMode>);
    act(() => playbacks[0].options.onUpdate?.(80));
    reduce(true);
    expect(playbacks[0].stop).toHaveBeenCalledOnce();
    expect(view.container.querySelector(".nav-indicator")).toBe(bar);
    expect(bar.style.transform).toBe("translateY(6px)");
    view.rerender(<StrictMode>{menu("history")}</StrictMode>);
    expect(bar.style.transform).toBe("translateY(86px)");
    reduce(false); act(() => resize());
    expect(playbacks).toHaveLength(1);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("contagens reais com Motion", () => {
  it("mostra o primeiro valor imediatamente e não reinicia com o mesmo valor", () => {
    const view = render(<AnimatedCount value={9} />);
    const visual = view.container.querySelector(".count-visual")!;
    expect(visual.textContent).toBe("9");
    view.rerender(<AnimatedCount value={9} />);
    expect(playbacks).toHaveLength(0);
    view.rerender(<AnimatedCount value={12} />);
    expect(playbacks[0].from).toBe(9);
    expect(playbacks[0].to).toBe(12);
    expect(playbacks[0].options.duration).toBe(0.18);
    expect(view.container.querySelector(".sr-only")?.textContent).toBe("12");
    expect(view.container.querySelector(".count-width")?.textContent).toBe("12");
    expect(visual.getAttribute("aria-hidden")).toBe("true");
    expect(visual.textContent).toBe("9");
    act(() => playbacks[0].options.onUpdate?.(10));
    view.rerender(<AnimatedCount value={12} />);
    expect(playbacks).toHaveLength(1);
    expect(visual.textContent).toBe("10");
    act(() => playbacks[0].options.onComplete?.());
    expect(visual.textContent).toBe("12");
  });
  it("interrompe atualizações rápidas e desmontagem sem callbacks antigos alterarem o resultado", () => {
    const view = render(<AnimatedCount value={20} />);
    view.rerender(<AnimatedCount value={30} />);
    act(() => playbacks[0].options.onUpdate?.(24));
    view.rerender(<AnimatedCount value={4} />);
    expect(playbacks[0].stop).toHaveBeenCalledOnce();
    expect(playbacks[1].from).toBe(24);
    expect(playbacks[1].to).toBe(4);
    act(() => { playbacks[0].options.onUpdate?.(29); playbacks[0].options.onComplete?.(); });
    expect(view.container.querySelector(".count-visual")?.textContent).toBe("24");
    act(() => playbacks[1].options.onComplete?.());
    expect(view.container.querySelector(".count-visual")?.textContent).toBe("4");
    view.unmount();
    expect(playbacks[1].stop).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    render(<AnimatedCount value={4} />);
    expect(playbacks).toHaveLength(2);
  });
  it("encerra movimento ao mudar a preferência ou ocultar a janela", () => {
    const view = render(<AnimatedCount value={1} />);
    view.rerender(<AnimatedCount value={8} />);
    reduce(true);
    expect(playbacks[0].stop).toHaveBeenCalledOnce();
    expect(view.container.querySelector(".count-visual")?.textContent).toBe("8");
    view.rerender(<AnimatedCount value={15} />);
    expect(view.container.querySelector(".count-visual")?.textContent).toBe("15");
    reduce(false);
    expect(playbacks).toHaveLength(1);
    view.rerender(<AnimatedCount value={18} />);
    visibility(true);
    expect(playbacks[1].stop).toHaveBeenCalledOnce();
    view.rerender(<AnimatedCount value={21} />);
    expect(view.container.querySelector(".count-visual")?.textContent).toBe("21");
    visibility(false);
    expect(playbacks).toHaveLength(2);
  });
  it("não inicia animações quando movimento reduzido já está ativo", () => {
    reduced = true;
    const view = render(<AnimatedCount value={90} />);
    view.rerender(<AnimatedCount value={100} />);
    expect(playbacks).toHaveLength(0);
    expect(view.container.querySelector(".count-visual")?.textContent).toBe("100");
  });
});

describe("feedback sem atrasar estados e foco", () => {
  it("anima fases e conclusão, mantendo progresso, atualizações e erros imediatos", () => {
    const view = render(<OperationFeedback action={{ kind: "organize", phase: "preparing" }} />);
    expect(playbacks).toHaveLength(0);
    view.rerender(<OperationFeedback action={{ kind: "organize", phase: "organizing", progress: { kind: "manual", phase: "organizing", completed: 1, total: 2, name: "a.txt" } }} />);
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("1");
    expect(playbacks).toHaveLength(1);
    view.rerender(<OperationFeedback action={{ kind: "organize", phase: "organizing", progress: { kind: "manual", phase: "organizing", completed: 2, total: 2, name: "b.txt" } }} />);
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("2");
    expect(playbacks).toHaveLength(1);
    view.rerender(<OperationFeedback action={{ kind: "organize", phase: "completed", operationId: 42 }} operation={operation} />);
    expect(screen.getByText("Processamento concluído")).toBeTruthy();
    expect(playbacks).toHaveLength(3);
    expect((playbacks[1].from as Element).tagName.toLowerCase()).toBe("svg");
    view.rerender(<OperationFeedback action={{ kind: "organize", phase: "completed", operationId: 42 }} operation={structuredClone(operation)} />);
    expect(playbacks).toHaveLength(3);
    view.rerender(<OperationFeedback action={{ kind: "organize", phase: "error", error: "Arquivo ocupado" }} />);
    expect(screen.getByRole("alert").textContent).toContain("Arquivo ocupado");
    expect(playbacks[1].stop).toHaveBeenCalledOnce();
    expect(playbacks[2].stop).toHaveBeenCalledOnce();
    expect(playbacks).toHaveLength(3);
  });
  it("não anima resultado parcial nem conclusão que já estava presente", () => {
    const partial = { ...operation, movements: [...operation.movements, { ...operation.movements[0], id: 2, status: "failed", error: "Conflito" }] };
    const view = render(<OperationFeedback action={{ kind: "organize", phase: "preparing" }} />);
    view.rerender(<OperationFeedback action={{ kind: "organize", phase: "completed" }} operation={partial} />);
    expect(screen.getByText("Processamento concluído com ocorrências")).toBeTruthy();
    expect(playbacks).toHaveLength(0);
    view.unmount();
    render(<OperationFeedback action={{ kind: "organize", phase: "completed" }} operation={operation} />);
    expect(playbacks).toHaveLength(0);
  });
  it("mostra confirmação contextual imediatamente e preserva o botão focado", () => {
    const dismiss = vi.fn();
    const view = render(<SuccessNotice message="Preferências salvas" onDismiss={dismiss} />);
    const button = screen.getByRole("button", { name: "Fechar aviso" });
    button.focus();
    view.rerender(<SuccessNotice message="Preferências salvas" onDismiss={dismiss} />);
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole("status").textContent).toContain("Preferências salvas");
    expect(playbacks).toHaveLength(2);
    reduce(true);
    expect(playbacks[0].stop).toHaveBeenCalledOnce();
    expect(playbacks[1].stop).toHaveBeenCalledOnce();
    expect((playbacks[0].from as SVGElement).style.opacity).toBe("1");
    fireEvent.click(button);
    expect(dismiss).toHaveBeenCalledOnce();
  });
  it("histórico anima expansão; atualização do registro preserva identidade, foco e desfazer", () => {
    const onExpand = vi.fn(); const onUndo = vi.fn();
    const props = { expanded: null, working: false, onExpand, onUndo };
    const view = render(<HistoryView {...props} history={[operation]} />);
    const row = screen.getByRole("button", { name: /1 arquivo organizado/ });
    row.focus();
    view.rerender(<HistoryView {...props} expanded={42} history={[structuredClone(operation)]} />);
    expect(playbacks).toHaveLength(1);
    expect(playbacks[0].to).toHaveProperty("height");
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const restored = { ...operation, movements: [{ ...operation.movements[0], status: "undone" }] };
    view.rerender(<HistoryView {...props} expanded={42} history={[restored]} />);
    expect(playbacks).toHaveLength(2);
    expect(document.activeElement).toBe(row);
    expect(row.textContent).toContain("1 arquivo restaurado");
    expect((screen.getByRole("button", { name: "Desfazer" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("continuidade entre telas e estados", () => {
  it("coordena no máximo quatro grupos; refresh não repete entrada nem muda foco", () => {
    const page = (value: number) => <PageTransition>{Array.from({ length: 8 }, (_, i) => <section data-motion-group key={i}><button>{value}-{i}</button></section>)}</PageTransition>;
    const view = render(page(1));
    expect(playbacks).toHaveLength(5);
    expect(Math.max(...playbacks.map(p => p.options.delay ?? 0))).toBeLessThanOrEqual(0.076);
    const button = screen.getByRole("button", { name: "1-0" }); button.focus();
    view.rerender(page(2));
    expect(playbacks).toHaveLength(5);
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toBe("2-0");
    reduce(true);
    expect(playbacks.every(p => p.stop.mock.calls.length === 1)).toBe(true);
    expect((view.container.firstChild as HTMLElement).style.transform).toBe("none");
    reduce(false);
    expect(playbacks).toHaveLength(5);
  });
  it("não cancela a entrada definitiva sob StrictMode e cancela a tela desmontada", () => {
    const view = render(<StrictMode><PageTransition key="files"><p>Arquivos</p></PageTransition></StrictMode>);
    expect(playbacks).toHaveLength(2);
    expect(playbacks[0].stop).toHaveBeenCalledOnce();
    expect(playbacks[1].stop).not.toHaveBeenCalled();
    view.rerender(<StrictMode><PageTransition key="history"><p>Histórico</p></PageTransition></StrictMode>);
    expect(screen.queryByText("Arquivos")).toBeNull();
    expect(screen.getByText("Histórico")).toBeTruthy();
    expect(playbacks[1].stop).toHaveBeenCalledOnce();
    expect(playbacks[playbacks.length - 1].stop).not.toHaveBeenCalled();
  });
  it("filtro anima só o container e conserva detalhes em atualizações comuns", () => {
    const file: FileEntry = { path: "/isolated/a.txt", name: "a.txt", extension: "txt", category: "documents", destination: "/isolated/organized/a.txt", size: 1, modified: 1700000000000, status: "ready", reason: null };
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("table-scroll") ? 400 : this.tagName === "TR" ? 80 : 0; });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    const files = Array.from({ length: 300 }, (_, i) => ({ ...file, path: `/isolated/${i}.txt`, name: `${i}.txt` }));
    const view = render(<FileTable files={files} categories={[]} filterKey="all:" />);
    expect(playbacks).toHaveLength(0);
    const trigger = screen.getAllByRole("button", { name: "Ver caminho e destino" })[0]; trigger.focus();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(playbacks).toHaveLength(1);
    view.rerender(<FileTable files={structuredClone(files)} categories={[]} filterKey="all:" />);
    expect(playbacks).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    view.rerender(<FileTable files={files} categories={[]} filterKey="documents:" />);
    expect(playbacks).toHaveLength(2);
    expect((playbacks[1].from as HTMLElement).className).toBe("table-scroll");
    view.rerender(<FileTable files={[]} categories={[]} filterKey="documents:missing" filtered />);
    expect(screen.getByRole("status").textContent).toContain("Nenhum resultado para estes filtros");
    expect(playbacks).toHaveLength(3);
  });
  it("não repete entrada de detalhes já abertos quando uma linha virtual volta ao DOM", () => {
    const view = render(<Collapse open id="restored-details" animateInitial={false}><p>Destino preservado</p></Collapse>);
    expect(playbacks).toHaveLength(0);
    expect(document.getElementById("restored-details")?.style.height).toBe("auto");
    view.rerender(<Collapse open={false} id="restored-details" animateInitial={false}><p>Destino preservado</p></Collapse>);
    expect(playbacks).toHaveLength(1);
    expect(playbacks[0].options.duration).toBe(0.14);
  });
  it("recolhe com altura real; conteúdo de saída fica inerte e callbacks antigos não o removem após reabertura", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 60 } as DOMRect);
    const body = (open: boolean) => <><button aria-controls="details">Detalhes</button><Collapse open={open} id="details"><a href="#details">Caminho</a></Collapse></>;
    const view = render(body(false));
    view.rerender(body(true));
    expect(playbacks[0].to).toHaveProperty("height", [0, 120]);
    act(() => playbacks[0].options.onComplete?.());
    expect(view.container.querySelector<HTMLElement>("#details")?.style.height).toBe("auto");
    screen.getByRole("link").focus();
    view.rerender(body(false));
    expect(playbacks[1].to).toHaveProperty("height", [60, 0]);
    expect(view.container.querySelector("#details")?.getAttribute("aria-hidden")).toBe("true");
    expect(view.container.querySelector("#details")?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Detalhes" }));
    view.rerender(body(true));
    expect(playbacks[1].stop).toHaveBeenCalledOnce();
    act(() => playbacks[1].options.onComplete?.());
    expect(screen.getByRole("link")).toBeTruthy();
    view.rerender(body(false));
    reduce(true);
    expect(view.container.querySelector("#details")).toBeNull();
  });
  it("novo registro anima o container sem remontar a operação expandida ou seus controles", () => {
    const props = { expanded: 42, working: false, onExpand: vi.fn(), onUndo: vi.fn() };
    const view = render(<HistoryView {...props} history={[operation]} />);
    const row = screen.getByRole("button", { name: /1 arquivo organizado/ }); row.focus();
    const details = view.container.querySelector("#movements-42");
    view.rerender(<HistoryView {...props} history={[{ ...operation, id: 43 }, structuredClone(operation)]} />);
    expect(document.activeElement).toBe(row);
    expect(view.container.querySelector("#movements-42")).toBe(details);
    expect(playbacks).toHaveLength(2);
    expect((playbacks[1].from as HTMLElement).className).toBe("history-list");
    expect(screen.getAllByRole("button", { name: /1 arquivo organizado/ })[1]).toBe(row);
  });
  it("desmonta ao recolher quando a preferência reduzida já está ativa", () => {
    reduced = true;
    const view = render(<Collapse open id="reduced-details"><p>Caminho isolado</p></Collapse>);
    view.rerender(<Collapse open={false} id="reduced-details"><p>Caminho isolado</p></Collapse>);
    expect(view.container.querySelector("#reduced-details")).toBeNull();
    view.rerender(<Collapse open id="reduced-details"><p>Caminho isolado</p></Collapse>);
    reduce(false);
    expect(playbacks).toHaveLength(0);
  });
  it("restaura rolagem da página e da tabela sem reexecutar em refresh", () => {
    let scroll = 0;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scroll);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((options: ScrollToOptions | number) => { if (typeof options === "object") scroll = options.top ?? 0; });
    function Navigation() {
      const [page, update] = useState("files"); const [count, refresh] = useState(0);
      const heading = useRef<HTMLHeadingElement>(null);
      const navigate = usePagePosition(page, heading, update);
      return <><h1 ref={heading} tabIndex={-1}>{page}</h1><button onClick={() => navigate(page === "files" ? "history" : "files")}>Navegar</button><button onClick={() => refresh(count + 1)}>Atualizar {count}</button><PageTransition key={page}><div className="table-scroll" /></PageTransition></>;
    }
    const view = render(<Navigation />);
    scroll = 80; view.container.querySelector(".table-scroll")!.scrollTop = 230;
    fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
    expect(scroll).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
    expect(scroll).toBe(80);
    expect(view.container.querySelector(".table-scroll")?.scrollTop).toBe(230);
    expect(document.activeElement).toBe(screen.getByRole("heading"));
    const calls = scrollTo.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Atualizar 0" }));
    expect(scrollTo).toHaveBeenCalledTimes(calls);
    expect(view.container.querySelector(".table-scroll")?.scrollTop).toBe(230);
  });
});

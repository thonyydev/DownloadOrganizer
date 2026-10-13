import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { OperationDialogs } from "./operation-dialogs";
import type { Operation, Preview } from "@/lib/api";

vi.mock("@/components/motion/feedback", () => ({ useMotionAllowed: () => false, useFeedbackMotion: () => ({ current: null }) }));
const operation: Operation = { id: 42, kind: "manual", created: 1700000000, movements: [{ id: 1, source: "/isolated/file.txt", destination: "/isolated/destination/file.txt", status: "moved", size: 1, error: null }] };
const preview: Preview = { id: 1, created: 1700000000, files: [{ name: "file.txt", path: "/isolated/file.txt", destination: "/isolated/destination/file.txt", size: 1, extension: "txt", category: "documents", modified: 1700000000000, status: "ready", reason: null }] };
const props = { preview: null, undoTarget: null, categories: [], action: null, busy: false, working: false, issue: "", reviewed: true, onReviewed: vi.fn(), onUpdate: vi.fn(), onOrganize: vi.fn(), onUndo: vi.fn(), onClose: vi.fn(), onViewResult: vi.fn(), onRestoreFocus: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  const computed = window.getComputedStyle.bind(window);
  // JSDOM has no animation clock/live computed styles; drive Radix animationend explicitly.
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => new Proxy(computed(element), { get(target, key) {
    if (key === "animationName") return element.getAttribute("data-state") === "closed" ? "dialog-close" : "none";
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } }));
});
afterEach(async () => { cleanup(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function panel() { return document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!; }
function endExit() {
  for (const element of document.querySelectorAll('[data-state="closed"]')) {
    const event = new Event("animationend", { bubbles: true }); Object.defineProperty(event, "animationName", { value: "dialog-close" }); fireEvent(element, event);
  }
}

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

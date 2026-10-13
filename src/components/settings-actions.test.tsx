import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { animate } from "motion/react";
import { SettingsActions } from "./settings-actions";

vi.mock("motion/react", async importOriginal => ({ ...await importOriginal<typeof import("motion/react")>(), animate: vi.fn(() => ({ stop: vi.fn() })) }));
vi.mock("@/components/motion/feedback", () => ({ useMotionAllowed: () => motionAllowed }));
let resize: () => void;
let motionAllowed = true;
let pendingMeasure: FrameRequestCallback | undefined;
const disconnect = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  motionAllowed = true;
  pendingMeasure = undefined;
  vi.stubGlobal("requestAnimationFrame", vi.fn(callback => { pendingMeasure = callback; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn(() => { pendingMeasure = undefined; }));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(60);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 220, width: 1000 } as DOMRect);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.style.scrollPaddingBottom = ""; });
it("adapta os limites e a área segura à geometria real e restaura a rolagem ao sair", () => {
  document.documentElement.style.scrollPaddingBottom = "7px";
  const view = render(<main style={{ padding: "0 24px" }}><SettingsActions busy={false} dirty={false} external={false} onSave={() => {}} onDiscard={() => {}} /></main>);
  const main = screen.getByRole("main");
  const rail = screen.getByRole("region").parentElement!;
  expect(rail.style.left).toBe("244px"); expect(rail.style.width).toBe("952px");
  expect(main.style.getPropertyValue("--settings-actions-space")).toBe("60px");
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ left: 160, width: 500 } as DOMRect);
  vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!.get!).mockReturnValue(108);
  rail.style.bottom = "16px";
  resize();
  expect(rail.style.left).toBe("244px");
  resize();
  expect(requestAnimationFrame).toHaveBeenCalledOnce();
  pendingMeasure!(0);
  expect(rail.style.left).toBe("184px"); expect(rail.style.width).toBe("452px");
  expect(document.documentElement.style.scrollPaddingBottom).toBe("140px");
  expect(main.style.getPropertyValue("--settings-actions-space")).toBe("140px");
  resize(); view.unmount(); resize();
  expect(cancelAnimationFrame).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(main.style.getPropertyValue("--settings-actions-space")).toBe("");
  expect(document.documentElement.style.scrollPaddingBottom).toBe("7px");
});
it("não remonta nem repete a entrada quando as ações mudam de estado em StrictMode", () => {
  const props = { busy: false, dirty: false, external: false, onSave: vi.fn(), onDiscard: vi.fn() };
  const view = render(<StrictMode><main><SettingsActions {...props} /></main></StrictMode>);
  const dock = screen.getByRole("region", { name: "Ações das configurações" });
  const entrances = vi.mocked(animate).mock.calls.length;
  view.rerender(<StrictMode><main><SettingsActions {...props} dirty /></main></StrictMode>);
  expect(screen.getByRole("region")).toBe(dock);
  expect(vi.mocked(animate).mock.calls.length).toBe(entrances);
});
it("cancela o deslocamento ao ativar movimento reduzido sem esconder as ações", () => {
  const dock = <main><SettingsActions busy={false} dirty external={false} onSave={() => {}} onDiscard={() => {}} /></main>;
  const view = render(dock);
  const region = screen.getByRole("region");
  motionAllowed = false;
  view.rerender(<main><SettingsActions busy={false} dirty external={false} onSave={() => {}} onDiscard={() => {}} /></main>);
  expect(region.style.transform).toBe("none"); expect(region.style.opacity).toBe("1");
  expect(vi.mocked(animate).mock.results[0].value.stop).toHaveBeenCalledOnce();
  expect((screen.getByRole("button", { name: "Salvar preferências" }) as HTMLButtonElement).disabled).toBe(false);
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AudioProvider } from "@/components/audio/audio-provider";
import { firstRuleTutorial } from "@/components/rules-tutorial";
import { Settings } from "@/components/settings";
import { samePreferences } from "@/lib/experience";
import type { Preferences } from "@/lib/api";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { version } from "../../package.json";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
afterEach(() => { cleanup(); localStorage.clear(); });

const preferences: Preferences = { source: "/isolated/source", destination: "/isolated/destination", theme: "dark", language: "pt-BR", automatic: false, enabled_categories: [], notifications: true, updates: true, autostart: false, extra_sources: ["/isolated/desktop"], rules: [{ pattern: "*.stl", folder: "Modelos", keep: false }, { pattern: "*.obj", folder: "Malhas", keep: false }] };

function renderSettings() {
  let draft = preferences;
  const onChange = vi.fn((update: (value: Preferences) => Preferences) => { draft = update(draft); });
  render(<AudioProvider><Settings draft={preferences} categories={[]} busy={false} dirty={false} external={null} onChange={onChange} onDiscard={() => {}} onAcceptExternal={() => {}} /></AudioProvider>);
  return () => draft;
}

it("adiciona, edita e remove regras só no rascunho", () => {
  firstRuleTutorial();
  const draft = renderSettings();
  fireEvent.click(screen.getByRole("button", { name: "Adicionar regra" }));
  expect(draft().rules[2]).toEqual({ pattern: "", folder: "", keep: false });
  fireEvent.change(screen.getAllByRole("textbox", { name: "Nome da pasta" })[1], { target: { value: "Peças" } });
  expect(draft().rules[1]).toEqual({ pattern: "*.obj", folder: "Peças", keep: false });
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Deixar no lugar" })[0]);
  expect(draft().rules[0]).toEqual({ pattern: "*.stl", folder: "", keep: true });
  fireEvent.click(screen.getAllByRole("button", { name: "Remover regra" })[0]);
  expect(draft().rules.map(rule => rule.pattern)).toEqual(["*.obj", ""]);
});

it("ensina as regras passo a passo só na primeira vez", () => {
  const draft = renderSettings();
  const add = () => fireEvent.click(screen.getByRole("button", { name: "Adicionar regra", hidden: true }));
  add();
  expect(draft().rules).toHaveLength(3);
  expect(screen.getByRole("dialog", { name: "Suas próprias pastas para seus arquivos" })).toBeTruthy();
  expect(screen.getByText("Passo 1 de 5")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
  expect(screen.getByText("Passo 2 de 5")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
  expect(screen.getByText("Passo 1 de 5")).toBeTruthy();
  for (let step = 0; step < 4; step++) fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
  expect(screen.getByText("Passo 5 de 5")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Criar minhas regras" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  add();
  expect(screen.queryByRole("dialog")).toBeNull();
  cleanup();
  renderSettings();
  add();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("não abre de novo se o tutorial for fechado no meio", () => {
  renderSettings();
  const add = () => fireEvent.click(screen.getByRole("button", { name: "Adicionar regra", hidden: true }));
  add();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  add();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("devolve o foco ao botão que abriu o tutorial", async () => {
  renderSettings();
  const help = screen.getByRole("button", { name: "Como as regras funcionam" });
  help.focus();
  fireEvent.click(help);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(help));
});

it("reabre o tutorial pelo botão de ajuda sem alterar o rascunho", () => {
  const draft = renderSettings();
  fireEvent.click(screen.getByRole("button", { name: "Como as regras funcionam" }));
  expect(screen.getByText("Passo 1 de 5")).toBeTruthy();
  expect(draft()).toBe(preferences);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Como as regras funcionam" }));
  expect(screen.getByText("Passo 1 de 5")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  // Quem já leu pela ajuda não vê o tutorial de novo ao criar a primeira regra.
  fireEvent.click(screen.getByRole("button", { name: "Adicionar regra" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(draft().rules).toHaveLength(3);
});

it("trata regra alterada ou reordenada como alteração das preferências", () => {
  expect(samePreferences(preferences, { ...preferences, rules: [...preferences.rules] })).toBe(true);
  expect(samePreferences(preferences, { ...preferences, rules: [...preferences.rules].reverse() })).toBe(false);
  expect(samePreferences(preferences, { ...preferences, rules: [] })).toBe(false);
});

it("adiciona e remove outras pastas de origem só no rascunho", async () => {
  vi.mocked(open).mockResolvedValueOnce("/isolated/temp");
  const draft = renderSettings();
  fireEvent.click(screen.getByRole("button", { name: "Adicionar pasta de origem" }));
  await waitFor(() => expect(draft().extra_sources).toEqual(["/isolated/desktop", "/isolated/temp"]));
  fireEvent.click(screen.getByRole("button", { name: "Remover pasta de origem: /isolated/desktop" }));
  expect(draft().extra_sources).toEqual(["/isolated/temp"]);
  expect(samePreferences(preferences, { ...preferences, extra_sources: [] })).toBe(false);
});

it("verifica atualizações quando pedido e diz o resultado", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(null).mockResolvedValueOnce("9.9.9").mockRejectedValueOnce("Confira sua conexão e tente de novo.");
  renderSettings();
  const check = () => fireEvent.click(screen.getByRole("button", { name: "Verificar atualizações" }));
  check();
  expect(await screen.findByText(`Você está na versão mais recente (${version})`)).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("check_update");
  check();
  expect(await screen.findByText("Nova versão pronta para instalar: 9.9.9")).toBeTruthy();
  check();
  expect(await screen.findByText("Não foi possível verificar atualizações. Confira sua conexão e tente de novo.")).toBeTruthy();
});

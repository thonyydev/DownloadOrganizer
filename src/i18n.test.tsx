import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bytes, date, statusLabel, type FileEntry, type Rule } from "@/lib/api";
import { language, setLanguage, t, useLanguage } from "@/lib/i18n";
import { FileTable } from "@/components/file-table";
import { OperationFeedback } from "@/components/operation-feedback";
import { TriageBar } from "@/components/triage";
import { Overview } from "@/components/overview";
import { Settings } from "@/components/settings";
import { AudioProvider } from "@/components/audio/audio-provider";
import { samePreferences } from "@/lib/experience";
import { HistoryView } from "@/components/history";
import { UndoFileList } from "@/components/undo-file-list";
import { Tooltip } from "radix-ui";
import tauriConfig from "../src-tauri/tauri.conf.json";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

afterEach(cleanup);

const catalogs = import.meta.glob<Record<string, string>>("/i18n/*.json", { eager: true, import: "default" });
const keys = Object.keys(catalogs["/i18n/pt-BR.json"]);
const sources = { ...import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }), ...import.meta.glob("/src-tauri/src/*.rs", { query: "?raw", import: "default", eager: true }) } as Record<string, string>;
const translatable = new Set(Object.entries(sources).filter(([path]) => !/\.test\.|i18n\.(ts|rs)$|tests\.rs$/.test(path)).flatMap(([, source]) => [...source.split(/#\[cfg\(test\)\]\r?\nmod tests \{/)[0].matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\)/g)].map(match => match[1])));

describe("tabela de traduções", () => {
  it("tem um arquivo por idioma, com as mesmas chaves e sem texto vazio", () => {
    expect(Object.keys(catalogs).sort()).toEqual(["en", "es", "fr", "it", "pt-BR"].map(code => `/i18n/${code}.json`));
    for (const catalog of Object.values(catalogs)) {
      expect(Object.keys(catalog).sort()).toEqual([...keys].sort());
      expect(Object.values(catalog).filter(value => !value.trim())).toEqual([]);
    }
  });

  it("usa o sufixo das chaves só para distinguir plurais, sem mostrá-lo", () => {
    for (const catalog of Object.values(catalogs)) expect(Object.values(catalog).filter(value => value.includes("(plural)"))).toEqual([]);
    expect(catalogs["/i18n/en.json"]["Ready (plural)"]).toBe("Ready");
    expect(catalogs["/i18n/pt-BR.json"]["Ready (plural)"]).toBe("Prontos");
  });

  it("oferece no instalador um idioma para cada arquivo", () => {
    expect(tauriConfig.bundle.windows.nsis.languages).toHaveLength(Object.keys(catalogs).length);
  });

  it("cobre todos os textos do frontend e do Rust", () => {
    expect(translatable.size).toBeGreaterThan(400);
    expect([...translatable].filter(text => !keys.includes(text))).toEqual([]);
  });

  it("não guarda textos que não existem mais no código", () => {
    expect(keys.filter(text => !text.startsWith("folder.") && !translatable.has(text))).toEqual([]);
  });

  it("preserva os códigos de erro que o frontend remove", () => {
    for (const code of ["PREVIEW_INVALID", "PREFERENCES_CHANGED"]) {
      const key = keys.find(text => text.startsWith(code + ":"))!;
      for (const catalog of Object.values(catalogs)) expect(catalog[key].startsWith(code + ": ")).toBe(true);
    }
  });

  it("traduz textos, status e formatos nos novos idiomas", () => {
    setLanguage("es");
    expect(t("Organize files")).toBe("Organizar archivos");
    expect(statusLabel("conflict")).toBe("Conflicto");
    expect(bytes(1536)).toBe("1,5 KB");
    setLanguage("fr");
    expect(t("Organize files")).toBe("Organiser les fichiers");
    expect(date(Date.UTC(2026, 0, 31, 12))).toMatch(/31\/01\/2026/);
    setLanguage("it");
    expect(t("Organize files")).toBe("Organizza i file");
    expect(document.documentElement.lang).toBe("it");
  });

  it("mostra a própria chave quando um texto não está na tabela", () => {
    setLanguage("es");
    expect(t("New text")).toBe("New text");
  });
});

const preferences = { source: "/isolated/source", destination: "/isolated/destination", theme: "dark", language: "en", automatic: false, enabled_categories: ["documents"], notifications: true, updates: true, autostart: false, extra_sources: [] as string[], rules: [] as Rule[] } as const;
const categories = [{ id: "documents", name: "Documents", extensions: ["pdf"] }, { id: "other", name: "Other", extensions: [] }];
const files: FileEntry[] = [
  { name: "a.pdf", path: "/isolated/source/a.pdf", extension: "pdf", category: "documents", size: 1536, modified: Date.UTC(2026, 0, 31, 12), destination: "/isolated/destination/Documents/a.pdf", status: "ready", reason: null },
  { name: "b", path: "/isolated/source/b", extension: "", category: "other", size: 2, modified: Date.UTC(2026, 0, 31, 12), destination: "/isolated/destination/Other/b", status: "conflict", reason: "A file with this name already exists; it will be preserved" },
];
const snapshot = { preferences: { ...preferences, enabled_categories: [...preferences.enabled_categories] }, categories, files, history: [{ id: 1, created: 1767225600, kind: "manual", total: 3, moved: 2, undone: 1, errors: 1 }], history_cursor: null, monitoring: true, watch_error: null, scan_error: null, preview_id: null, language: "en" as const, update_version: null };

// Words that only appear in the Portuguese interface. Fixture names are English on purpose.
const portuguese = /[ãõçáéíóúâê]|\b(arquivos?|pasta|destino|origem|prévia|organizar|organizados?|configurações|histórico|categorias?|conflitos?|prontos?|ignorados?|desfazer|atualizar|não|você|com|para|de)\b|\(s\)/i;
const expectEnglish = () => expect(document.body.textContent).not.toMatch(portuguese);

describe("idioma", () => {
  it("escolhe o texto do idioma ativo e atualiza o atributo lang", () => {
    expect(t("Organize files")).toBe("Organizar arquivos");
    setLanguage("en");
    expect(language()).toBe("en");
    expect(t("Organize files")).toBe("Organize files");
    expect(document.documentElement.lang).toBe("en");
  });

  it("formata números e datas no idioma ativo", () => {
    expect(bytes(1536)).toBe("1,5 KB");
    expect(date(Date.UTC(2026, 0, 31, 12))).toMatch(/31\/01\/2026/);
    setLanguage("en");
    expect(bytes(1536)).toBe("1.5 KB");
    expect(date(Date.UTC(2026, 0, 31, 12))).toMatch(/1\/31\/26/);
  });

  it("traduz todos os status e preserva um status desconhecido", () => {
    setLanguage("en");
    expect(["ready", "ignored", "conflict", "moved", "undone", "failed", "uncertain", "pending", "undo_pending"].map(statusLabel)).toEqual(["Ready", "Ignored", "Conflict", "Organized", "Undone", "Failed", "Check", "Interrupted", "Check"]);
    expect(statusLabel("novo")).toBe("novo");
  });

  it("atualiza componentes inscritos quando o idioma muda", () => {
    function Probe() { useLanguage(); return <p>{t("Organize files")}</p>; }
    render(<Probe />);
    expect(screen.getByText("Organizar arquivos")).toBeTruthy();
    act(() => setLanguage("en"));
    expect(screen.getByText("Organize files")).toBeTruthy();
  });

});

describe("interface em inglês", () => {
  it("mostra a visão geral sem texto em português", () => {
    setLanguage("en");
    render(<Tooltip.Provider><Overview data={snapshot} onFiles={() => {}} onSettings={() => {}} onCategory={() => {}} onHistory={() => {}} onOperation={() => {}} onOpenDestination={() => {}} counts={new Map()} /></Tooltip.Provider>);
    expect(screen.getByRole("button", { name: /Documents.*Enabled/ })).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("1 ready, 1 conflict, 0 ignored");
    expectEnglish();
  });

  it("mostra a tabela e a prévia sem texto em português", () => {
    setLanguage("en");
    render(<FileTable files={files} categories={categories} onView={() => {}} />);
    expect(screen.getByRole("columnheader", { name: "Modified" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View a.pdf" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "View path and destination" })[0]);
    expect(screen.getByText(/Planned destination: \/isolated/)).toBeTruthy();
    expectEnglish();
    cleanup();
    render(<FileTable files={files} categories={categories} preview />);
    expect(screen.getByRole("columnheader", { name: /^Planned destination/ })).toBeTruthy();
    expectEnglish();
  });

  it("mostra o histórico e o desfazer sem texto em português", () => {
    setLanguage("en");
    render(<HistoryView history={snapshot.history} expanded={null} working={false} onExpand={() => {}} onUndo={() => {}} />);
    expect(screen.getByText("1 file restored")).toBeTruthy();
    expect(screen.getByText("· 2 still at the destination")).toBeTruthy();
    expect(screen.getByText("1 issue")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expectEnglish();
    cleanup();
    render(<UndoFileList movements={[{ id: 1, source: "/isolated/source/a.pdf", destination: "/isolated/destination/Documents/a.pdf", status: "moved", error: null, size: 1 }]} />);
    expect(screen.getByText(/Restore to: \/isolated/)).toBeTruthy();
  });

  it("mostra feedback e triagem com plural correto", () => {
    setLanguage("en");
    render(<><OperationFeedback action={{ kind: "organize", phase: "completed" }} /><TriageBar counts={{ ready: 1, conflict: 2, ignored: 1 }} /></>);
    expect(screen.getByText("Finished")).toBeTruthy();
    expect(screen.getByText("1 ready")).toBeTruthy();
    expect(screen.getByText("2 conflicts")).toBeTruthy();
    expectEnglish();
  });
});

describe("seletor de idioma", () => {
  const renderSettings = (onChange = vi.fn()) => {
    render(<AudioProvider><Settings draft={{ ...preferences, language: "system", enabled_categories: [...preferences.enabled_categories] }} categories={categories} busy={false} dirty={false} external={null} tab="appearance" onTab={() => {}} onChange={onChange} onDiscard={() => {}} onAcceptExternal={() => {}} /></AudioProvider>);
    return onChange;
  };

  it("começa no sistema e altera só o rascunho ao escolher manualmente", () => {
    const onChange = renderSettings();
    expect(screen.getByRole("button", { name: "Sistema" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(onChange.mock.calls[0][0]({ language: "system" }).language).toBe("en");
    expect(language()).toBe("pt-BR");
  });

  it("trata a troca de idioma como alteração das preferências", () => {
    const base = { ...preferences, enabled_categories: [...preferences.enabled_categories] };
    expect(samePreferences(base, { ...base, language: "system" })).toBe(false);
    expect(samePreferences(base, { ...base })).toBe(true);
  });

  it("avisa que as pastas novas seguem o idioma e nada existente é movido", () => {
    renderSettings();
    expect(screen.getByText(/Pastas e arquivos que já existem não são movidos/)).toBeTruthy();
  });
});

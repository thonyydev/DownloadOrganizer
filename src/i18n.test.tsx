import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bytes, date, statusLabel, type FileEntry } from "@/lib/api";
import { language, setLanguage, t, useLanguage } from "@/lib/i18n";
import translations from "@/lib/translations.json";
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

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

afterEach(cleanup);

const catalog = translations as Record<string, string[]>;
const sources = { ...import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }), ...import.meta.glob("/src-tauri/src/*.rs", { query: "?raw", import: "default", eager: true }) } as Record<string, string>;
const translatable = new Set(Object.entries(sources).filter(([path]) => !/\.test\.|i18n\.(ts|rs)$|tests\.rs$/.test(path)).flatMap(([, source]) => [...source.split(/#\[cfg\(test\)\]\r?\nmod tests \{/)[0].matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*,/g)].map(match => match[1])));

describe("tabela de traduções", () => {
  it("cobre todos os textos do frontend e do Rust nos três idiomas", () => {
    expect(translatable.size).toBeGreaterThan(400);
    expect([...translatable].filter(text => catalog[text]?.length !== 3 || catalog[text].some(value => !value.trim()))).toEqual([]);
  });

  it("não guarda textos que não existem mais no código", () => {
    expect(Object.keys(catalog).filter(text => !translatable.has(text))).toEqual([]);
  });

  it("preserva os códigos de erro que o frontend remove", () => {
    for (const code of ["PREVIEW_INVALID", "PREFERENCES_CHANGED"]) {
      const row = Object.entries(catalog).find(([text]) => text.startsWith(code + ":"))!;
      for (const value of row[1]) expect(value.startsWith(code + ": ")).toBe(true);
    }
  });

  it("traduz textos, status e formatos nos novos idiomas", () => {
    setLanguage("es");
    expect(t("Organizar arquivos", "Organize files")).toBe("Organizar archivos");
    expect(statusLabel("conflict")).toBe("Conflicto");
    expect(bytes(1536)).toBe("1,5 KB");
    setLanguage("fr");
    expect(t("Organizar arquivos", "Organize files")).toBe("Organiser les fichiers");
    expect(date(Date.UTC(2026, 0, 31, 12))).toMatch(/31\/01\/2026/);
    setLanguage("it");
    expect(t("Organizar arquivos", "Organize files")).toBe("Organizza i file");
    expect(document.documentElement.lang).toBe("it");
  });

  it("usa o inglês quando um texto não está na tabela", () => {
    setLanguage("es");
    expect(t("Texto novo", "New text")).toBe("New text");
  });
});

const preferences = { source: "/isolated/source", destination: "/isolated/destination", theme: "dark", language: "en", automatic: false, enabled_categories: ["documents"] } as const;
const categories = [{ id: "documents", name: "Documents", extensions: ["pdf"] }, { id: "other", name: "Other", extensions: [] }];
const files: FileEntry[] = [
  { name: "a.pdf", path: "/isolated/source/a.pdf", extension: "pdf", category: "documents", size: 1536, modified: Date.UTC(2026, 0, 31, 12), destination: "/isolated/destination/Documents/a.pdf", status: "ready", reason: null },
  { name: "b", path: "/isolated/source/b", extension: "", category: "other", size: 2, modified: Date.UTC(2026, 0, 31, 12), destination: "/isolated/destination/Other/b", status: "conflict", reason: "A file with this name already exists; it will be preserved" },
];
const snapshot = { preferences: { ...preferences, enabled_categories: [...preferences.enabled_categories] }, categories, files, history: [{ id: 1, created: 1767225600, kind: "manual", total: 3, moved: 2, undone: 1, errors: 1 }], history_cursor: null, monitoring: true, watch_error: null, scan_error: null, preview_id: null, language: "en" as const };

// Words that only appear in the Portuguese interface. Fixture names are English on purpose.
const portuguese = /[ãõçáéíóúâê]|\b(arquivos?|pasta|destino|origem|prévia|organizar|organizados?|configurações|histórico|categorias?|conflitos?|prontos?|ignorados?|desfazer|atualizar|não|você|com|para|de)\b|\(s\)/i;
const expectEnglish = () => expect(document.body.textContent).not.toMatch(portuguese);

describe("idioma", () => {
  it("escolhe o texto do idioma ativo e atualiza o atributo lang", () => {
    expect(t("Olá", "Hello")).toBe("Olá");
    setLanguage("en");
    expect(language()).toBe("en");
    expect(t("Olá", "Hello")).toBe("Hello");
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
    function Probe() { useLanguage(); return <p>{t("Olá", "Hello")}</p>; }
    render(<Probe />);
    expect(screen.getByText("Olá")).toBeTruthy();
    act(() => setLanguage("en"));
    expect(screen.getByText("Hello")).toBeTruthy();
  });

});

describe("interface em inglês", () => {
  it("mostra a visão geral sem texto em português", () => {
    setLanguage("en");
    render(<Tooltip.Provider><Overview data={snapshot} onFiles={() => {}} onSettings={() => {}} onCategory={() => {}} onHistory={() => {}} onOperation={() => {}} /></Tooltip.Provider>);
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
    expect(screen.getByRole("columnheader", { name: "Planned destination" })).toBeTruthy();
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
    render(<AudioProvider><Settings draft={{ ...preferences, language: "system", enabled_categories: [...preferences.enabled_categories] }} categories={categories} busy={false} dirty={false} external={null} onChange={onChange} onDiscard={() => {}} onAcceptExternal={() => {}} /></AudioProvider>);
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

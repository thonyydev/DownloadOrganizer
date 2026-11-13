import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Category, Stats } from "@/lib/api";

const mocks = vi.hoisted(() => ({ stats: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), api: { stats: mocks.stats, saveShareImage: mocks.save } }));
import { ShareStats, shareText } from "./share-stats";

const categories: Category[] = [{ id: "images", name: "Imagens", extensions: [] }, { id: "documents", name: "Documentos", extensions: [] }];
const stats: Stats = { files: 1234, bytes: 5 * 1024 ** 3, automatic: 617, operations: 1, since: Date.UTC(2026, 10, 1, 12) / 1000, categories: [["images", 900], ["documents", 300], ["audio", 20], ["code", 10], ["other", 4]] };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" })));
  mocks.stats.mockResolvedValue(stats);
  mocks.save.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("resume só totais, com no máximo quatro categorias", () => {
  const text = shareText(stats, categories);
  expect(text.files).toBe("1.234");
  expect(text.filesLabel).toBe("arquivos organizados");
  expect(text.figures).toEqual([["5 GB", "movidos"], ["1", "operação"], ["50%", "automáticos"]]);
  expect(text.categories.map(category => category.name)).toEqual(["Imagens", "Documentos", "audio", "code"]);
  expect(text.since).toMatch(/^Organizando desde 1 de nov\.? de 2026$/);
  expect(shareText({ ...stats, files: 0, automatic: 0, since: null, categories: [] }, categories)).toMatchObject({ filesLabel: "arquivos organizados", since: "" });
});

it("não deixa compartilhar um cartão zerado", async () => {
  mocks.stats.mockResolvedValue({ ...stats, files: 0, bytes: 0, automatic: 0, operations: 0, since: null, categories: [] });
  render(<ShareStats open categories={categories} onClose={() => {}} />);
  expect((await screen.findByRole("status")).textContent).toMatch(/^Nada para compartilhar ainda/);
  await screen.findByRole("img");
  expect((screen.getByRole("button", { name: "Salvar imagem" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Copiar imagem" }) as HTMLButtonElement).disabled).toBe(true);
});

it("mostra o cartão com texto alternativo e salva a imagem pelo backend", async () => {
  render(<ShareStats open categories={categories} onClose={() => {}} />);
  const card = await screen.findByRole("img");
  expect(card.getAttribute("aria-label")).toContain("1.234 arquivos organizados. 5 GB movidos");
  fireEvent.click(screen.getByRole("button", { name: "Salvar imagem" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Imagem salva."));
  expect(mocks.save.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
});

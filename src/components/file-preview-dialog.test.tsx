import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreviewDialog } from "./file-preview-dialog";
import { api, type FileEntry, type FilePreview } from "@/lib/api";

vi.mock("@/components/motion/feedback", () => ({ useMotionAllowed: () => false }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: { filePreview: vi.fn() } }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=";
const file: FileEntry = { name: "image.png", path: "/isolated/image.png", destination: "/isolated/Imagens/image.png", extension: "png", category: "images", size: 128, modified: 1700000000000, status: "ready", reason: null };
const categories = [{ id: "images", name: "Imagens", extensions: ["png"] }];
const noOp = () => {};
const response: FilePreview = { data_url: png, width: 1200, height: 800 };
function pending() {
  let resolve!: (result: FilePreview) => void;
  const promise = new Promise<FilePreview>(done => { resolve = done; });
  return { promise, resolve };
}
function Harness() {
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button ref={trigger} onClick={() => setSelected(file)}>Abrir visualização</button><FilePreviewDialog file={selected} categories={categories} onClose={() => setSelected(null)} onRestoreFocus={() => trigger.current?.focus()} /></>;
}
beforeEach(() => { vi.mocked(api.filePreview).mockReset().mockResolvedValue(response); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("visualização de arquivos", () => {
  it("exibe caminhos locais e UNC legíveis mantendo os originais na solicitação", async () => {
    const selected = { ...file, path: String.raw`\\?\C:\isolated\image.png`, destination: String.raw`\\?\UNC\server\share\image.png` };
    render(<FilePreviewDialog file={selected} categories={categories} onClose={noOp} onRestoreFocus={noOp} />);
    const dialog = screen.getByRole("dialog", { name: "Visualizar arquivo" });
    expect(within(dialog).getByText(String.raw`C:\isolated\image.png`)).toBeTruthy();
    expect(within(dialog).getByText(String.raw`\\server\share\image.png`)).toBeTruthy();
    await screen.findByRole("img");
    expect(api.filePreview).toHaveBeenCalledExactlyOnceWith(selected);
    expect(selected.path).toBe(String.raw`\\?\C:\isolated\image.png`);
    expect(selected.destination).toBe(String.raw`\\?\UNC\server\share\image.png`);
  });

  it("não lê nada antes de abrir; mostra carregamento, imagem e todos os metadados", async () => {
    const job = pending(); vi.mocked(api.filePreview).mockReturnValueOnce(job.promise);
    render(<Harness />);
    expect(api.filePreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Abrir visualização" }));
    const dialog = screen.getByRole("dialog", { name: "Visualizar arquivo" });
    expect(within(dialog).getByRole("status").textContent).toContain("Preparando");
    expect(within(dialog).getByText(file.name)).toBeTruthy();
    expect(within(dialog).getByText(file.path)).toBeTruthy();
    expect(within(dialog).getByText(file.destination)).toBeTruthy();
    await act(async () => job.resolve(response));
    expect(within(dialog).getByRole("img", { name: "Prévia de image.png" }).getAttribute("src")).toBe(png);
    for (const term of ["Nome", "Extensão", "Categoria", "Tamanho", "Modificado", "Resolução", "Origem", "Destino previsto"]) expect(within(dialog).getByText(term).tagName).toBe("DT");
    expect(within(dialog).getByText("1200 × 800 px")).toBeTruthy();
    expect(within(dialog).getByText("Imagens")).toBeTruthy();
    expect(api.filePreview).toHaveBeenCalledExactlyOnceWith(file);
  });

  it("fecha por X e Escape e restaura o foco ao botão de origem", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Abrir visualização" });
    fireEvent.click(trigger);
    let dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger); dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("informa formatos não suportados sem renderizar conteúdo arbitrário", async () => {
    vi.mocked(api.filePreview).mockResolvedValueOnce({ data_url: null, width: null, height: null });
    render(<FilePreviewDialog file={{ ...file, name: "file.svg", extension: "svg" }} categories={categories} onClose={noOp} onRestoreFocus={noOp} />);
    await screen.findByText("Visualização não disponível para este formato.");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("file.svg")).toBeTruthy();
  });

  it("reabre o mesmo arquivo sem apresentar a miniatura da solicitação anterior", async () => {
    const next = pending();
    vi.mocked(api.filePreview).mockResolvedValueOnce(response).mockReturnValueOnce(next.promise);
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Abrir visualização" });
    fireEvent.click(trigger); await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(trigger);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Preparando");
    await act(async () => next.resolve({ ...response, width: 900 }));
    expect(screen.getByText("900 × 800 px")).toBeTruthy();
  });

  it("mostra erros e permite uma nova tentativa de leitura sem organizar arquivos", async () => {
    vi.mocked(api.filePreview).mockRejectedValueOnce("O arquivo mudou. Atualize a lista.");
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Abrir visualização" }));
    expect((await screen.findByRole("alert")).textContent).toContain("O arquivo mudou");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByRole("img");
    expect(api.filePreview).toHaveBeenCalledTimes(2);
  });

  it("descarta resultados atrasados ao trocar de arquivo e ao fechar; reabre com dados atuais", async () => {
    const first = pending(); const second = pending(); const closed = pending();
    vi.mocked(api.filePreview).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(closed.promise);
    const view = render(<FilePreviewDialog file={file} categories={categories} onClose={noOp} onRestoreFocus={noOp} />);
    const other = { ...file, name: "second.png", path: "/isolated/second.png" };
    view.rerender(<FilePreviewDialog file={other} categories={categories} onClose={noOp} onRestoreFocus={noOp} />);
    await act(async () => second.resolve({ ...response, width: 200 }));
    await act(async () => first.resolve(response));
    expect(screen.getByText("200 × 800 px")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Prévia de second.png");
    view.rerender(<FilePreviewDialog file={{ ...other, modified: other.modified + 1 }} categories={categories} onClose={noOp} onRestoreFocus={noOp} />);
    expect(screen.queryByRole("img")).toBeNull();
    view.rerender(<FilePreviewDialog file={null} categories={categories} onClose={noOp} onRestoreFocus={noOp} />);
    await act(async () => closed.resolve(response));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<FilePreviewDialog file={other} categories={categories} onClose={noOp} onRestoreFocus={noOp} />);
    await screen.findByRole("img");
    expect(screen.getByText("1200 × 800 px")).toBeTruthy();
  });

  it("recusa URLs externas e reporta falha de exibição da miniatura", async () => {
    vi.mocked(api.filePreview).mockResolvedValueOnce({ ...response, data_url: "https://invalid.example/image.svg" });
    render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Abrir visualização" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    fireEvent.error(await screen.findByRole("img"));
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível exibir");
  });
});

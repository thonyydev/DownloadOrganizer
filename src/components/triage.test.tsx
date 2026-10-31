// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TriageBar, TriageLegend, triageCounts } from "./triage";
import { OperationFeedback } from "./operation-feedback";

afterEach(cleanup);

describe("triagem", () => {
  it("conta os arquivos pelo estado que o motor informou", () => {
    expect(triageCounts([{ status: "ready" }, { status: "ready" }, { status: "conflict" }, { status: "ignored" }])).toEqual({ ready: 2, conflict: 1, ignored: 1 });
  });

  it("concorda singular e plural na legenda", () => {
    render(<TriageLegend counts={{ ready: 1, conflict: 1, ignored: 2 }} />);
    expect(screen.getByText("1 pronto")).toBeTruthy();
    expect(screen.getByText("1 conflito")).toBeTruthy();
    expect(screen.getByText("2 ignorados")).toBeTruthy();
  });

  it("desenha uma marca por arquivo e omite estados sem arquivos", () => {
    const { container } = render(<TriageBar counts={{ ready: 3, conflict: 0, ignored: 1 }} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("3 prontos, 0 conflitos, 1 ignorado");
    expect(container.querySelectorAll(".triage-bar .triage-ready > i")).toHaveLength(3);
    expect(container.querySelector(".triage-bar .triage-conflict")).toBeNull();
  });

  it("não cria um elemento por arquivo em pastas grandes", () => {
    const { container } = render(<TriageBar counts={{ ready: 10000, conflict: 5, ignored: 0 }} />);
    expect(container.querySelectorAll(".triage-bar i")).toHaveLength(0);
    expect(container.querySelector<HTMLElement>(".triage-bar .triage-ready")!.style.flexGrow).toBe("10000");
  });

  it("distingue a pasta vazia na descrição acessível", () => {
    render(<TriageBar counts={{ ready: 0, conflict: 0, ignored: 0 }} />);
    expect(screen.getByRole("img", { name: "Nenhum arquivo na pasta de origem" })).toBeTruthy();
  });
});

describe("feedback da prévia", () => {
  it("não anuncia conclusão ao apenas gerar uma prévia, pois nada foi movido", () => {
    const { container } = render(<OperationFeedback action={{ kind: "preview", phase: "completed" }} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByText("Processamento concluído")).toBeNull();
  });

  it("mantém o erro da prévia visível", () => {
    render(<OperationFeedback action={{ kind: "preview", phase: "error", error: "Pasta indisponível" }} />);
    expect(screen.getByText("Pasta indisponível")).toBeTruthy();
  });

  it("mantém a conclusão de uma organização real", () => {
    render(<OperationFeedback action={{ kind: "organize", phase: "completed" }} />);
    expect(screen.getByText("Processamento concluído")).toBeTruthy();
  });
});

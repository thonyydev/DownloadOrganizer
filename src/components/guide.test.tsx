import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Guide, NEWS_VERSION, welcomeFor } from "@/components/guide";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("mostra o guia só para quem começa e as novidades só depois de atualizar", () => {
  expect(welcomeFor(false, NEWS_VERSION)).toBe("onboarding");
  expect(welcomeFor(false, NEWS_VERSION)).toBeNull();
  localStorage.clear();
  // Quem já usava uma versão sem esse registro tem histórico: é uma atualização.
  expect(welcomeFor(true, NEWS_VERSION)).toBe("news");
  localStorage.setItem("download-organizer-version", "0.1.2");
  expect(welcomeFor(false, NEWS_VERSION)).toBe("news");
  // Uma versão sem novidades escritas não mostra nada.
  expect(welcomeFor(true, "99.0.0")).toBeNull();
});

it("percorre o guia e termina indo para as configurações", () => {
  const finish = vi.fn();
  render(<Guide kind="onboarding" onClose={() => {}} onFinish={finish} />);
  expect(screen.getByRole("dialog", { name: "Boas-vindas ao Download Organizer" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();
  for (let step = 1; step < 6; step++) fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
  expect(screen.getByText("Passo 6 de 6")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Escolher minhas pastas" }));
  expect(finish).toHaveBeenCalledOnce();
});

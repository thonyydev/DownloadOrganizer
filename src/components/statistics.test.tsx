import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Category, OperationStat, Statistics } from "@/lib/api";

const mocks = vi.hoisted(() => ({ statistics: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), api: { statistics: mocks.statistics } }));
import { StatisticsView, activity, niceMax, periodStart, timeline } from "./statistics";

// Local time, as the page shows it: Friday 13 November 2026, 15:00.
const now = new Date(2026, 10, 13, 15).getTime();
const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime() / 1000;
const op = (created: number, files: number, automatic = false): OperationStat => ({ created, automatic, files, bytes: files * 10 });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("começa cada período num limite de dia ou de mês", () => {
  expect(periodStart("7d", now)).toBe(at(10, 7, 0));
  expect(periodStart("30d", now)).toBe(at(9, 15, 0));
  expect(periodStart("12m", now)).toBe(new Date(2025, 11, 1).getTime() / 1000);
  expect(periodStart("all", now)).toBeNull();
});

it("agrupa por dia nos períodos curtos e por mês nos longos", () => {
  const week = timeline([op(at(10, 7, 0), 2), op(at(10, 13, 9), 3), op(at(10, 13, 14), 1)], "7d", now);
  expect(week.map(bucket => bucket.files)).toEqual([2, 0, 0, 0, 0, 0, 4]);
  expect(week.every(bucket => !bucket.monthly)).toBe(true);
  const year = timeline([op(at(11 - 12, 5), 1), op(at(9, 1), 5)], "12m", now);
  expect(year).toHaveLength(12);
  expect(year[0].files).toBe(1);
  expect(year[10].files).toBe(5);
  // All time: a short history still spans a week of days; past about three months it switches to months.
  expect(timeline([op(at(10, 12), 1)], "all", now)).toHaveLength(7);
  const long = timeline([op(at(3, 2), 1)], "all", now);
  expect(long.every(bucket => bucket.monthly)).toBe(true);
  expect(long).toHaveLength(8);
});

it("soma os arquivos por dia da semana e hora, começando na segunda", () => {
  const grid = activity([op(at(10, 13, 9), 3), op(at(10, 9, 23), 2)]);
  expect(grid[4][9]).toBe(3);
  expect(grid[0][23]).toBe(2);
  expect(grid.flat().reduce((sum, value) => sum + value, 0)).toBe(5);
});

const categories: Category[] = [{ id: "documents", name: "Documentos", extensions: [] }];
const statistics: Statistics = { operations: [op(Date.now() / 1000 - 3600, 4, true), op(Date.now() / 1000 - 60, 2)], categories: [["documents", 6, 60]], extensions: [["pdf", 6]], largest: [["contrato.pdf", 30, "documents"]], undone: 1, failed: 0 };

it("mostra os totais do período e busca de novo ao trocar de período", async () => {
  mocks.statistics.mockResolvedValue(statistics);
  render(<StatisticsView categories={categories} revision={1} />);
  expect(await screen.findByText("contrato.pdf")).toBeTruthy();
  // The share of automatic files, in the figure and inside the split bar.
  expect(screen.getAllByText("67%")).toHaveLength(2);
  expect(screen.getByRole("img", { name: /Automático: 4 arquivos \(67%\), Manual: 2 arquivos \(33%\)/ })).toBeTruthy();
  expect(mocks.statistics.mock.calls[0][0]).toBeTypeOf("number");
  fireEvent.click(screen.getByRole("button", { name: "Tudo" }));
  await waitFor(() => expect(mocks.statistics).toHaveBeenLastCalledWith(null));
});

it("arredonda o topo do eixo para que a linha do meio seja um número inteiro", () => {
  expect([0, 1, 3, 5, 7, 12, 25, 45, 61].map(niceMax)).toEqual([2, 2, 4, 6, 10, 20, 40, 60, 100]);
});

it("diz o horário mais movimentado com minutos", async () => {
  mocks.statistics.mockResolvedValue(statistics);
  render(<StatisticsView categories={categories} revision={1} />);
  const busiest = new Date(statistics.operations[0].created * 1000);
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "numeric", minute: "2-digit" }).format(new Date(2024, 0, 1, busiest.getHours()));
  expect((await screen.findByText(/Horário mais movimentado/)).textContent).toContain(time);
});

it("só esmaece ao trocar de período, não quando os dados do app mudam", async () => {
  mocks.statistics.mockResolvedValue(statistics);
  const { container, rerender } = render(<StatisticsView categories={categories} revision={1} />);
  await screen.findByText("contrato.pdf");
  const body = () => container.querySelector(".statistics-body")!;
  rerender(<StatisticsView categories={categories} revision={2} />);
  expect(body().classList.contains("refreshing")).toBe(false);
  await waitFor(() => expect(mocks.statistics).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "7 dias" }));
  expect(body().classList.contains("refreshing")).toBe(true);
  await waitFor(() => expect(body().classList.contains("refreshing")).toBe(false));
});

it("avisa quando nada foi organizado no período", async () => {
  mocks.statistics.mockResolvedValue({ operations: [], categories: [], extensions: [], largest: [], undone: 0, failed: 0 });
  render(<StatisticsView categories={categories} revision={1} />);
  expect(await screen.findByText("Nada foi organizado neste período.")).toBeTruthy();
});

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHistoryPages } from "./use-history";
import type { HistoryPage, OperationSummary } from "./api";

const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("./api", () => ({ api: mocks }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
const summary = (id: number): OperationSummary => ({ id, created: 1, kind: "manual", total: 1, moved: 1, undone: 0, errors: 0 });
const page = (high: number, low: number): HistoryPage => ({ operations: Array.from({ length: high - low + 1 }, (_, i) => summary(high - i)), next_cursor: low > 1 ? low : null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

it("inicializa vazio e consulta várias páginas sem duplicar ou reordenar IDs", async () => {
  const { result } = renderHook(useHistoryPages);
  act(() => result.current.sync({ operations: [], next_cursor: null }));
  await act(() => result.current.loadMore()); expect(mocks.history).not.toHaveBeenCalled();
  act(() => result.current.sync(page(205, 106)));
  mocks.history.mockResolvedValueOnce(page(105, 6)).mockResolvedValueOnce(page(6, 1));
  await act(() => result.current.loadMore()); await act(() => result.current.loadMore());
  expect(mocks.history.mock.calls).toEqual([[106], [6]]);
  expect(result.current.operations.map(op => op.id)).toEqual(Array.from({ length: 205 }, (_, i) => 205 - i));
  expect(result.current.next_cursor).toBeNull();
});

it("mantém o cursor e a seleção ao receber novos registros e atualizar a lista explicitamente", async () => {
  const { result } = renderHook(useHistoryPages);
  act(() => result.current.sync(page(200, 101)));
  mocks.history.mockResolvedValueOnce(page(100, 1)); await act(() => result.current.loadMore());
  act(() => result.current.sync(page(1200, 1101)));
  expect(result.current.operations).toHaveLength(200);
  expect(result.current.newAvailable).toBe(true); expect(result.current.next_cursor).toBeNull();
  mocks.history.mockResolvedValueOnce(page(1200, 1101)); await act(() => result.current.reload(1));
  expect(result.current.operations).toHaveLength(101);
  expect(result.current.operations[100].id).toBe(1);
  expect(result.current.next_cursor).toBe(1101); expect(result.current.newAvailable).toBe(false);
});

it("preserva registros e cursor após falha e permite tentar novamente sem comandos duplicados", async () => {
  const { result } = renderHook(useHistoryPages);
  act(() => result.current.sync(page(150, 51)));
  mocks.history.mockRejectedValueOnce("Consulta indisponível");
  await act(() => result.current.loadMore());
  expect(result.current.error).toBe("Consulta indisponível"); expect(result.current.next_cursor).toBe(51);
  expect(result.current.operations).toHaveLength(100);
  const pending = deferred<HistoryPage>(); mocks.history.mockReturnValueOnce(pending.promise);
  let waiting: Promise<void>;
  act(() => { waiting = result.current.retry(); void result.current.retry(); });
  expect(mocks.history).toHaveBeenCalledTimes(2); expect(result.current.loading).toBe(true);
  expect(result.current.error).toBe("Consulta indisponível");
  await act(async () => { pending.resolve(page(50, 1)); await waiting; });
  expect(result.current.operations).toHaveLength(150); expect(result.current.error).toBe("");
});

it("atualiza operação antiga após Undo e rejeita uma resposta anterior ainda pendente", async () => {
  const { result, unmount } = renderHook(useHistoryPages);
  act(() => result.current.sync(page(200, 101)));
  const pending = deferred<HistoryPage>(); mocks.history.mockReturnValueOnce(pending.promise);
  let waiting: Promise<void>;
  act(() => { waiting = result.current.loadMore(); });
  act(() => result.current.upsert({ ...summary(1), moved: 0, undone: 1 }));
  await act(async () => { pending.resolve(page(100, 1)); await waiting; });
  expect(result.current.operations.find(op => op.id === 1)?.undone).toBe(1);
  expect(result.current.next_cursor).toBe(101); expect(result.current.loading).toBe(false);
  const last = deferred<HistoryPage>(); mocks.history.mockReturnValueOnce(last.promise);
  act(() => { void result.current.loadMore(); }); unmount();
  await act(async () => last.resolve(page(100, 1)));
});

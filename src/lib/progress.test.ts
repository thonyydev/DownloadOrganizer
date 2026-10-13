import { afterEach, expect, it, vi } from "vitest";
import type { Progress } from "./api";
import { createProgressPresenter } from "./progress";

afterEach(() => vi.useRealTimers());
const event = (completed: number, phase: Progress["phase"] = "organizing", kind = "manual"): Progress => ({ completed, total: 5000, phase, kind, name: "synthetic.txt", operation_id: 42 });

it.each(["manual", "automatic", "undo"])("limita uma rajada de 5.000 eventos de %s e mantém o evento mais recente", kind => {
  vi.useFakeTimers(); const publish = vi.fn(); const presenter = createProgressPresenter(publish);
  presenter.push(event(0, "preparing", kind)); presenter.push(event(0, "organizing", kind));
  for (let i = 1; i <= 5000; i++) { presenter.push(event(i, "preparing", kind)); presenter.push(event(i, "organizing", kind)); }
  expect(publish).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(149); expect(publish).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1); expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 5000, phase: "organizing" }));
  presenter.push(event(10)); vi.advanceTimersByTime(150);
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 5000 }));
});

it.each(["completed", "error"] as const)("mostra %s antes de 150 ms, cancela pendências e isola o próximo lote", phase => {
  vi.useFakeTimers(); const publish = vi.fn(); const presenter = createProgressPresenter(publish);
  presenter.push(event(0)); presenter.push(event(20));
  presenter.push({ ...event(0, phase), total: 0 });
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ phase, completed: 20, total: 5000 }));
  const calls = publish.mock.calls.length;
  presenter.push(event(21)); vi.advanceTimersByTime(300); expect(publish).toHaveBeenCalledTimes(calls);
  presenter.reset(); presenter.push({ ...event(0), operation_id: 43 }); presenter.push(event(4999));
  vi.advanceTimersByTime(150); expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ operation_id: 43, completed: 0 }));
  presenter.push({ ...event(1), operation_id: 43 }); presenter.stop(); vi.advanceTimersByTime(150);
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ operation_id: 43, completed: 0 }));
});

it("preserva o identificador e a última contagem ao encerrar pela resposta do comando", () => {
  vi.useFakeTimers(); const publish = vi.fn(); const presenter = createProgressPresenter(publish);
  presenter.push({ ...event(0, "preparing"), operation_id: null }); presenter.push(event(12, "preparing"));
  presenter.finish(); expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ operation_id: 42, completed: 12 }));
  vi.advanceTimersByTime(300); expect(publish).toHaveBeenCalledTimes(2);
});

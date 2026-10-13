import type { Progress } from "./api";

// Coalesce file events without delaying phase changes or terminal results.
export function createProgressPresenter(publish: (progress: Progress) => void) {
  let latest: Progress | null = null;
  let displayed: Progress | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const flush = () => { clear(); if (latest && latest !== displayed) { displayed = latest; publish(latest); } };
  return {
    reset() { clear(); latest = displayed = null; finished = false; },
    stop() { clear(); finished = true; },
    finish() { finished = true; flush(); },
    push(event: Progress) {
      if (finished || (latest?.operation_id != null && event.operation_id != null && latest.operation_id !== event.operation_id)) return false;
      const terminal = event.phase === "completed" || event.phase === "error";
      const phase = !terminal && latest?.phase === "organizing" ? "organizing" : event.phase;
      const total = event.total || latest?.total || 0;
      const completed = Math.min(total, Math.max(event.completed, latest?.completed ?? 0));
      const immediate = !latest || phase !== latest.phase;
      latest = { ...event, phase, total, completed, operation_id: event.operation_id ?? latest?.operation_id };
      if (terminal) { finished = true; flush(); }
      else if (immediate) { flush(); timer = setTimeout(flush, 150); }
      else if (!timer) timer = setTimeout(flush, 150);
      return true;
    },
  };
}

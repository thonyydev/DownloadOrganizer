import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HistoryPage, type OperationSummary } from "./api";
import { errorMessage } from "./experience";

function merge(current: OperationSummary[], incoming: OperationSummary[]) {
  return [...new Map([...current, ...incoming].map(op => [op.id, op])).values()].sort((a, b) => b.id - a.id);
}

export function useHistoryPages() {
  const [state, setState] = useState({ operations: [] as OperationSummary[], next_cursor: null as number | null, anchor: 0, latest: 0, loading: false, error: "" });
  const stateRef = useRef(state); stateRef.current = state;
  const request = useRef(0);
  const pending = useRef(false);
  const retry = useRef({ restart: false, retain: null as number | null });
  useEffect(() => () => { request.current++; }, []);

  const sync = useCallback((page: HistoryPage) => {
    setState(current => {
      if (!current.operations.length) return { ...current, ...page, anchor: page.operations[0]?.id ?? 0, latest: page.operations[0]?.id ?? 0 };
      const latest = new Map(page.operations.map(op => [op.id, op]));
      return { ...current, latest: page.operations[0]?.id ?? current.latest, operations: current.operations.map(op => latest.get(op.id) ?? op) };
    });
  }, []);

  const upsert = useCallback((operation: OperationSummary) => {
    request.current++; pending.current = false;
    setState(current => ({ ...current, loading: false, operations: merge(current.operations, [operation]) }));
  }, []);

  const load = useCallback(async (restart = false, retain: number | null = null) => {
    if (pending.current || (!restart && stateRef.current.next_cursor === null)) return;
    pending.current = true; retry.current = { restart, retain };
    const version = ++request.current;
    const before = restart ? null : stateRef.current.next_cursor;
    setState(current => ({ ...current, loading: true }));
    try {
      const page = await api.history(before);
      if (version !== request.current) return;
      setState(current => ({ ...current, error: "", loading: false, next_cursor: page.next_cursor,
        anchor: restart ? page.operations[0]?.id ?? 0 : current.anchor,
        latest: Math.max(current.latest, page.operations[0]?.id ?? 0),
        operations: merge(restart ? current.operations.filter(op => op.id === retain) : current.operations, page.operations) }));
    } catch (error) {
      if (version === request.current) setState(current => ({ ...current, loading: false, error: errorMessage(error) }));
    } finally { if (version === request.current) pending.current = false; }
  }, []);
  return { ...state, newAvailable: state.latest > state.anchor, sync, upsert, loadMore: () => load(), reload: (retain: number | null) => load(true, retain), retry: () => load(retry.current.restart, retry.current.retain) };
}

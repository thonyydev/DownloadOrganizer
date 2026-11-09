import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HistoryPage, type OperationSummary } from "./api";
import { errorMessage } from "./experience";

function merge(current: OperationSummary[], incoming: OperationSummary[]) {
  return [...new Map([...current, ...incoming].map(op => [op.id, op])).values()].sort((a, b) => b.id - a.id);
}

export function useHistoryPages() {
  const [state, setState] = useState({ operations: [] as OperationSummary[], next_cursor: null as number | null, loading: false, error: "" });
  const stateRef = useRef(state); stateRef.current = state;
  const request = useRef(0);
  const pending = useRef(false);
  useEffect(() => () => { request.current++; }, []);

  // The snapshot brings the newest page: new operations join the top of the list.
  const sync = useCallback((page: HistoryPage) => {
    const newest = stateRef.current.operations[0]?.id ?? 0;
    const oldestIncoming = page.operations[page.operations.length - 1]?.id ?? 0;
    // More than a page arrived since: merging would leave a gap, so the list starts over from this page.
    if (!newest || (page.next_cursor !== null && oldestIncoming > newest)) {
      request.current++; pending.current = false;
      setState(current => ({ ...current, loading: false, operations: page.operations, next_cursor: page.next_cursor }));
    } else setState(current => ({ ...current, operations: merge(current.operations, page.operations) }));
  }, []);

  const upsert = useCallback((operation: OperationSummary) => {
    request.current++; pending.current = false;
    setState(current => ({ ...current, loading: false, operations: merge(current.operations, [operation]) }));
  }, []);

  const load = useCallback(async () => {
    if (pending.current || stateRef.current.next_cursor === null) return;
    pending.current = true;
    const version = ++request.current;
    const before = stateRef.current.next_cursor;
    setState(current => ({ ...current, loading: true }));
    try {
      const page = await api.history(before);
      if (version !== request.current) return;
      setState(current => ({ ...current, error: "", loading: false, next_cursor: page.next_cursor, operations: merge(current.operations, page.operations) }));
    } catch (error) {
      if (version === request.current) setState(current => ({ ...current, loading: false, error: errorMessage(error) }));
    } finally { if (version === request.current) pending.current = false; }
  }, []);
  return { ...state, sync, upsert, loadMore: load, retry: load };
}

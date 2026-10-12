import { invoke, isTauri } from "@tauri-apps/api/core";

export interface Category { id: string; name: string; extensions: string[] }
export interface Preferences { source: string; destination: string; automatic: boolean; enabled_categories: string[]; theme: "dark" | "light" }
export interface FileEntry { name: string; path: string; extension: string; category: string; size: number; modified: number; destination: string; status: "ready" | "ignored" | "conflict"; reason: string | null }
export interface Movement { id: number; source: string; destination: string; status: string; error: string | null; size: number }
export interface Operation { id: number; created: number; kind: string; movements: Movement[] }
export interface Snapshot { preferences: Preferences; categories: Category[]; files: FileEntry[]; history: Operation[]; monitoring: boolean; watch_error: string | null; scan_error: string | null; preview_id: number | null }
export interface Preview { id: number; created: number; files: FileEntry[] }
export interface Progress { completed: number; total: number; name: string; kind: string; operation_id?: number | null; phase: "preparing" | "organizing" | "completed" | "error" }

export const native = isTauri();
export const api = {
  snapshot: () => invoke<Snapshot>("snapshot"),
  preview: () => invoke<Preview>("preview"),
  organize: (previewId: number) => invoke<number>("organize", { previewId }),
  undo: (operationId: number) => invoke<void>("undo_operation", { operationId }),
  save: (preferences: Preferences, expected: Preferences) => invoke<Preferences>("save_preferences", { preferences, expected }),
  retryMonitoring: () => invoke<void>("retry_monitoring"),
};

export function bytes(value: number) {
  if (!value) return "0 B";
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1024 ** unit)} ${["B", "KB", "MB", "GB"][unit]}`;
}
export function date(value: number) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(value); }
export function basename(path: string) { return path.split(/[\\/]/).pop() || path; }
export const labels: Record<string, string> = { ready: "Pronto", ignored: "Ignorado", conflict: "Conflito", moved: "Organizado", undone: "Desfeito", failed: "Falhou", uncertain: "Verificar", pending: "Interrompido", undo_pending: "Verificar" };

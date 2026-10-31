import { useSyncExternalStore } from "react";
import catalog from "./translations.json";

export type Language = "pt-BR" | "en" | "es" | "fr" | "it";

// Each row in translations.json: Portuguese text -> [Spanish, French, Italian].
const columns: Partial<Record<Language, number>> = { es: 0, fr: 1, it: 2 };
const locales: Record<Language, string> = { "pt-BR": "pt-BR", en: "en-US", es: "es-ES", fr: "fr-FR", it: "it-IT" };

const listeners = new Set<() => void>();

// The native app reports the Windows display language in its first snapshot.
function detect(): Language {
  const prefix = typeof navigator === "undefined" ? "" : navigator.language.slice(0, 2).toLowerCase();
  return prefix === "pt" ? "pt-BR" : prefix === "es" || prefix === "fr" || prefix === "it" ? prefix : "en";
}

let current: Language = detect();

export function language() { return current; }
export function locale() { return locales[current]; }

export function setLanguage(next: Language) {
  if (next === current) return;
  current = next;
  document.documentElement.lang = next;
  listeners.forEach(listener => listener());
}

/** Other languages look up the Portuguese text; a test fails if a row is missing. Call it during render, not at module level. */
export function t(portuguese: string, english: string) {
  if (current === "pt-BR") return portuguese;
  const column = columns[current];
  return column === undefined ? english : (catalog as Record<string, string[]>)[portuguese]?.[column] ?? english;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Re-renders the caller when the language changes. */
export function useLanguage() {
  return useSyncExternalStore(subscribe, language);
}

import { useSyncExternalStore } from "react";

export type Language = "pt-BR" | "en" | "es" | "fr" | "it";

// i18n/<language>.json: English key -> text in that language.
const catalogs = import.meta.glob<Record<string, string>>("/i18n/*.json", { eager: true, import: "default" });
const locales: Record<Language, string> = { "pt-BR": "pt-BR", en: "en-US", es: "es-ES", fr: "fr-FR", it: "it-IT" };

const listeners = new Set<() => void>();

// The native app reports the Windows display language in its first snapshot.
function detect(): Language {
  const prefix = typeof navigator === "undefined" ? "" : navigator.language.slice(0, 2).toLowerCase();
  return (Object.keys(locales) as Language[]).find(code => code.slice(0, 2) === prefix) ?? "en";
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

/** Looks up the key in the active language; a test fails if a key is missing. Call it during render, not at module level. */
export function t(key: string) {
  return catalogs[`/i18n/${current}.json`][key] ?? key;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Re-renders the caller when the language changes. */
export function useLanguage() {
  return useSyncExternalStore(subscribe, language);
}

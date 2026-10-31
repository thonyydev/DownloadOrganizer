import type { Preferences, Preview, Progress } from "./api";
import { t } from "./i18n";

export interface PreferencesDraft { base: Preferences; value: Preferences }
export interface Action {
  kind: "preview" | "organize" | "undo" | "save" | "refresh" | "monitor";
  phase: Progress["phase"];
  progress?: Progress;
  operationId?: number;
  error?: string;
  showLoading?: boolean;
}

export function samePreferences(a: Preferences, b: Preferences) {
  return a.source === b.source && a.destination === b.destination && a.automatic === b.automatic && a.theme === b.theme && a.language === b.language
    && [...a.enabled_categories].sort().join("\n") === [...b.enabled_categories].sort().join("\n");
}

export function reconcileDraft(current: PreferencesDraft | null, remote: Preferences): PreferencesDraft {
  if (!current || samePreferences(current.base, current.value) || samePreferences(current.value, remote)) {
    return { base: remote, value: remote };
  }
  return current;
}

export function previewIssue(preview: Preview, activeId: number | null, now: number) {
  if (now < preview.created * 1000 || now >= (preview.created + 300) * 1000) return t("Esta prévia expirou. Atualize e confira os arquivos novamente.", "This preview expired. Refresh it and review the files again.");
  if (activeId !== preview.id) return t("Esta prévia foi invalidada por outra operação. Atualize antes de confirmar.", "Another operation invalidated this preview. Refresh it before confirming.");
  return "";
}

export function errorMessage(error: unknown) {
  return String(error).replace(/^(PREVIEW_INVALID|PREFERENCES_CHANGED):\s*/, "");
}

export function isRunning(action: Action | null) {
  return action?.phase === "preparing" || action?.phase === "organizing";
}

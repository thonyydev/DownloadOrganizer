import type { SoundDefinition } from "@web-kits/audio";
import type { Operation } from "./api";

// Original create-sound recipes: short, warm sine gestures; no samples or reverb tails.
export const sounds = {
  organize: { layers: [
    { source: { type: "sine", frequency: 660, fm: { ratio: 2, depth: 18 } }, envelope: { attack: 0.008, decay: 0.13, release: 0.025 }, gain: 0.12 },
    { source: { type: "sine", frequency: 825 }, envelope: { attack: 0.008, decay: 0.13, release: 0.025 }, gain: 0.10, delay: 0.035 },
    { source: { type: "sine", frequency: 990 }, envelope: { attack: 0.008, decay: 0.13, release: 0.025 }, gain: 0.09, delay: 0.07 },
  ] },
  restore: { layers: [
    { source: { type: "sine", frequency: 990, fm: { ratio: 2, depth: 18 } }, envelope: { attack: 0.008, decay: 0.11, release: 0.025 }, gain: 0.11 },
    { source: { type: "sine", frequency: 660 }, envelope: { attack: 0.008, decay: 0.11, release: 0.025 }, gain: 0.10, delay: 0.04 },
  ] },
  warning: { layers: [
    { source: { type: "triangle", frequency: { start: 520, end: 450 } }, filter: { type: "lowpass", frequency: 1400, resonance: 0.7 }, envelope: { attack: 0.012, decay: 0.10, release: 0.025 }, gain: 0.10 },
    { source: { type: "sine", frequency: 360 }, envelope: { attack: 0.012, decay: 0.10, release: 0.025 }, gain: 0.06, delay: 0.025 },
  ] },
  saved: { source: { type: "sine", frequency: { start: 780, end: 880 } }, envelope: { attack: 0.005, decay: 0.09, release: 0.015 }, gain: 0.10 },
} satisfies Record<string, SoundDefinition>;

export type SoundName = keyof typeof sounds;

// A command/progress completion alone does not prove that the individual moves succeeded.
export function operationSound(kind: "organize" | "undo", operation?: Operation, expectedCount?: number): SoundName | null {
  if (!operation || (kind === "organize" && operation.kind !== "manual") || !operation.movements.length) return null;
  const status = kind === "undo" ? "undone" : "moved";
  if (operation.movements.some(m => m.error || m.status !== status)
    || (expectedCount !== undefined && operation.movements.length !== expectedCount)) return "warning";
  return kind === "undo" ? "restore" : "organize";
}

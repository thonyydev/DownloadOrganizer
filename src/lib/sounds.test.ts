import { describe, expect, it } from "vitest";
import { sounds, operationSound } from "./sounds";
import type { Operation } from "./api";
import type { Layer } from "@web-kits/audio";

const op = (status: string, error: string | null = null): Operation => ({ id: 1, kind: "manual", created: 1, movements: [{ id: 1, source: "/isolated/a", destination: "/isolated/b", status, error, size: 1 }] });
describe("identidade sonora e resultado real", () => {
  it("mantém envelope, frequência, duração e orçamento de ganho seguros", () => {
    for (const [name, sound] of Object.entries(sounds)) {
      const layers: Layer[] = "layers" in sound ? sound.layers : [sound];
      expect(layers.reduce((sum, layer) => sum + (layer.gain ?? 0), 0)).toBeLessThanOrEqual(0.6);
      let duration = 0;
      for (const layer of layers) {
        expect(layer.gain).toBeLessThanOrEqual(0.4);
        expect(layer.envelope!.decay).toBeGreaterThan(0);
        expect(layer.envelope!.attack).toBeGreaterThan(0);
        expect(layer.envelope!.release).toBeGreaterThan(0);
        if (layer.source.type === "sine" || layer.source.type === "triangle") {
          const frequency = layer.source.frequency;
          for (const hz of typeof frequency === "number" ? [frequency] : [frequency.start, frequency.end]) {
            expect(hz).toBeGreaterThanOrEqual(80); expect(hz).toBeLessThanOrEqual(8000);
          }
        }
        duration = Math.max(duration, (layer.delay ?? 0) + layer.envelope!.attack! + layer.envelope!.decay + layer.envelope!.release!);
      }
      expect(duration).toBeLessThanOrEqual(name === "saved" ? 0.16 : name === "organize" ? 0.3 : 0.25);
    }
  });
  it("só confirma resultados completos, conhecidos e coerentes", () => {
    expect(operationSound("organize", op("moved"), 1)).toBe("organize");
    expect(operationSound("undo", op("undone"))).toBe("restore");
    expect(operationSound("organize", op("moved"), 2)).toBe("warning");
    expect(operationSound("undo", op("moved"))).toBe("warning");
    expect(operationSound("organize", op("moved", "Falha"))).toBe("warning");
    expect(operationSound("organize")).toBeNull();
    expect(operationSound("organize", { ...op("moved"), movements: [] })).toBeNull();
    expect(operationSound("organize", { ...op("moved"), kind: "automatic" })).toBeNull();
  });
  it.each(["failed", "pending", "uncertain", "undo_pending", "unknown"])("%s nunca gera falso sucesso", status => {
    expect(operationSound("organize", op(status))).toBe("warning");
    expect(operationSound("undo", op(status))).toBe("warning");
  });
});

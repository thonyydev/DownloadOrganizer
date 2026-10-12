import { describe, expect, it } from "vitest";
import css from "./App.css?raw";

const blocks = [...css.matchAll(/:root(?::not\(\.dark\))? \{([^}]+)\}/g)].map(match =>
  Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[\da-f]+)/g)].map(value => [value[1], value[2]])),
);
function rgb(hex: string) {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map(char => char + char).join("") : digits;
  return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16) / 255);
}
function luminance(channels: number[]) {
  return channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(foreground: string, background: number[]) {
  const values = [luminance(rgb(foreground)), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe.each(["escuro", "claro"])("legibilidade no tema %s", theme => {
  const index = theme === "escuro" ? 0 : 1;
  const tokens = { ...blocks[0], ...blocks[index] };
  it("mantém contraste AA nos textos funcionais e botões", () => {
    for (const background of ["background", "card", "sidebar", "accent"]) {
      for (const foreground of ["foreground", "muted", "primary", "success-foreground", "warning-foreground", "error-foreground"]) {
        expect(contrast(tokens[foreground], rgb(tokens[background])), `${foreground} em ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(tokens["primary-foreground"], rgb(tokens.primary))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens["secondary-foreground"], rgb(tokens.secondary))).toBeGreaterThanOrEqual(4.5);
  });
  it("mantém contraste AA nas categorias e nos fundos translúcidos dos estados", () => {
    const allTones = [...css.matchAll(/\.tone-\w+ \{ --tone: (#[\da-f]+); \}/g)].map(match => match[1]);
    expect(allTones).toHaveLength(16);
    const tones = allTones.slice(index * 8, index * 8 + 8);
    for (const tone of tones) expect(contrast(tone, rgb(tokens.card)), tone).toBeGreaterThanOrEqual(4.5);
    for (const [foreground, background] of [["success-foreground", "#87bba0"], ["warning-foreground", "#d6ab7d"], ["primary", "#aa9af5"]]) {
      const tinted = rgb(background).map((value, i) => value * (0x13 / 255) + rgb(tokens.card)[i] * (1 - 0x13 / 255));
      expect(contrast(tokens[foreground], tinted), foreground).toBeGreaterThanOrEqual(4.5);
    }
  });
});

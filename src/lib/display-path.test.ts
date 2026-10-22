import { describe, expect, it } from "vitest";
import { displayPath } from "./api";

describe("displayPath", () => {
  it.each([
    [String.raw`\\?\C:\isolated\image.PNG`, String.raw`C:\isolated\image.PNG`],
    [String.raw`\\?\d:\Pasta com espaços\ação.png`, String.raw`d:\Pasta com espaços\ação.png`],
    [String.raw`\\?\UNC\server\share\image.png`, String.raw`\\server\share\image.png`],
    [String.raw`\\?\unc\server\share`, String.raw`\\server\share`],
    ["\\\\?\\C:\\", "C:\\"],
    ["\\\\?\\UNC\\server\\share\\", "\\\\server\\share\\"],
  ])("formata apenas o prefixo reconhecido: %s", (original, expected) => {
    expect(displayPath(original)).toBe(expected);
    expect(displayPath(expected)).toBe(expected);
  });

  it.each([
    "", String.raw`C:\isolated\image.png`, String.raw`\\server\share\image.png`,
    "/isolated/image.png", "relative/image.png", String.raw`C:image.png`,
    String.raw`\\?\C:image.png`, String.raw`\\?\C:/image.png`,
    String.raw`\\?\UNC\server`, "\\\\?\\UNC\\server\\",
    String.raw`\\?\UNC\\share\image.png`, String.raw`\\?\UNC\.\pipe\name`,
    String.raw`\\?\UNC\server\..\name`, String.raw`\\?\Volume{123}\image.png`,
    String.raw`\\?\GLOBALROOT\Device\file`, String.raw`\\.\pipe\name`,
  ])("preserva caminhos normais, incompletos e namespaces não reconhecidos: %s", path => {
    expect(displayPath(path)).toBe(path);
  });
});

// Regenerates public/third-party-notices.txt, shipped with the app. Run after changing dependencies:
// node scripts/third-party-notices.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const manifest = "src-tauri/Cargo.toml";
const run = args => execFileSync("cargo", args, { encoding: "utf8", maxBuffer: 1 << 28 });

function licenseTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => /^(licen[cs]e|copying|notice|unlicense)/i.test(name))
    .map(name => join(dir, name))
    .filter(path => { try { return readFileSync(path).length > 0; } catch { return false; } })
    .map(path => readFileSync(path, "utf8").replace(/\r\n/g, "\n").trim());
}

const packages = [];

// Only crates compiled into the app: normal dependencies, without build or test tooling.
const shipped = new Set(run(["tree", "--manifest-path", manifest, "-e", "normal", "--prefix", "none", "--locked", "--format", "{p}"])
  .split("\n").map(line => line.replace(/ \(.*$/, "").trim()).filter(Boolean));
const metadata = JSON.parse(run(["metadata", "--manifest-path", manifest, "--format-version", "1", "--locked"]));
for (const item of metadata.packages) {
  if (item.name === "download-organizer" || !shipped.has(`${item.name} v${item.version}`)) continue;
  packages.push({ id: `${item.name} ${item.version}`, license: item.license ?? "see text", texts: licenseTexts(dirname(item.manifest_path)) });
}

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
for (const [path, item] of Object.entries(lock.packages)) {
  if (!path || item.dev || item.optional) continue;
  const name = path.split("node_modules/").pop();
  packages.push({ id: `${name} ${item.version}`, license: item.license ?? "see text", texts: licenseTexts(path) });
}

// Most packages share a text, so each unique text is printed once.
const groups = new Map();
const missing = [];
for (const item of packages) {
  if (!item.texts.length) missing.push(item);
  for (const text of item.texts) groups.set(text, [...(groups.get(text) ?? []), item.id]);
}

const rule = "-".repeat(72);
let output = "Third-party software included in Download Organizer.\nThese notices apply to the listed packages, not to Download Organizer itself.\n\n";
output += `Packages\n${rule}\n${packages.map(item => `${item.id} (${item.license})`).sort().join("\n")}\n\n`;
if (missing.length) output += `Packages that ship no license file, covered by the license declared above:\n${missing.map(item => item.id).sort().join("\n")}\n\n`;
for (const [text, ids] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  output += `${rule}\n${ids.sort().join(", ")}\n\n${text}\n\n`;
}
writeFileSync("public/third-party-notices.txt", output);
console.log(`${packages.length} packages, ${groups.size} unique texts, ${missing.length} without a license file: ${missing.map(item => item.id).join(", ")}`);

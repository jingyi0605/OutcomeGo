import { access, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: bun scripts/release/create-legacy-cli-aliases.ts <directory>");

const artifacts = [
  "outcomego-darwin-arm64",
  "outcomego-darwin-arm64.gz",
  "outcomego-darwin-arm64.sigstore.json",
  "outcomego-darwin-x64",
  "outcomego-darwin-x64.gz",
  "outcomego-darwin-x64.sigstore.json",
  "outcomego-linux-arm64",
  "outcomego-linux-arm64.gz",
  "outcomego-linux-arm64.sigstore.json",
  "outcomego-linux-x64",
  "outcomego-linux-x64.gz",
  "outcomego-linux-x64.sigstore.json",
  "outcomego-windows-x64.exe",
  "outcomego-windows-x64.exe.gz",
  "outcomego-windows-x64.exe.sigstore.json",
] as const;

const root = resolve(directory);
for (const artifact of artifacts) {
  const source = join(root, artifact);
  await access(source);
  const legacy = join(root, artifact.replace(/^outcomego-/, "aiteamos-"));
  await copyFile(source, legacy);
  console.log(`Created legacy CLI alias ${legacy}`);
}

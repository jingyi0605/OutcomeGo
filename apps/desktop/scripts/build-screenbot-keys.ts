import { mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Builds the macOS helper that detects modifier chords (both Command keys) for ScreenBots, as
 * a universal binary for development or a single slice for a signed release.
 * Other platforms use Electron's globalShortcut and need no helper.
 */
const desktop = resolve(import.meta.dir, "..");
const source = resolve(desktop, "native/screenbot-keys.swift");
const output = resolve(desktop, "dist-electron/screenbot-keys");

if (process.platform !== "darwin") {
  console.log("screenbot-keys: skipped (macOS only)");
  process.exit(0);
}
const releaseArch = process.env.OUTCOMEGO_MAC_HELPER_ARCH;
if (releaseArch !== undefined && releaseArch !== "arm64" && releaseArch !== "x64") {
  throw new Error(`Unsupported macOS helper architecture: ${releaseArch}`);
}
const current = await stat(output).catch(() => null);
const sourceTime = (await stat(source)).mtimeMs;
if (!releaseArch && current && current.mtimeMs >= sourceTime && process.argv.includes("--if-stale")) process.exit(0);

await mkdir(resolve(desktop, "dist-electron"), { recursive: true });
const run = async (command: string[]) => {
  const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`${command[0]} failed`);
};
const build = (arch: string, path: string) =>
  run(["xcrun", "swiftc", "-Osize", "-target", `${arch}-apple-macos12.0`, source, "-o", path]);
if (releaseArch) {
  await build(releaseArch === "x64" ? "x86_64" : releaseArch, output);
  await run(["xcrun", "strip", "-x", output]);
} else {
  const architectures = ["arm64", "x86_64"];
  const parts = architectures.map((arch) => `${output}-${arch}`);
  await Promise.all(architectures.map((arch, index) => build(arch, parts[index]!)));
  await run(["lipo", "-create", ...parts, "-output", output]);
  await Promise.all(parts.map((part) => rm(part, { force: true })));
}
console.log(`screenbot-keys: built ${output}`);

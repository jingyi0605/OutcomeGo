import { resolve } from "node:path";

/**
 * Builds the Windows helper that tells the Bot floating window when another application starts
 * dragging (native/windows-drag, written in Go). macOS has screenbot-keys.swift for the same job;
 * other platforms need no helper.
 *
 * A machine without Go skips the build, and the floating window then only reacts once a drag
 * reaches it. A release (CI, or OUTCOMEGO_REQUIRE_WIN_HELPER=1) must not ship without it.
 */
const desktop = resolve(import.meta.dir, "..");
const source = resolve(desktop, "native/windows-drag");
const output = resolve(desktop, "dist-electron/dock-drag.exe");

if (process.platform !== "win32") {
  console.log("dock-drag: skipped (Windows only)");
  process.exit(0);
}

const architectures: Record<string, string> = { x64: "amd64", arm64: "arm64" };
const requested = process.env.OUTCOMEGO_WIN_HELPER_ARCH ?? process.arch;
const goArch = architectures[requested];
if (!goArch) throw new Error(`Unsupported Windows helper architecture: ${requested}`);

const go = Bun.which("go");
if (!go) {
  const message =
    "dock-drag: Go is not installed, so the dock will not detect drags from other apps";
  if (process.env.CI || process.env.OUTCOMEGO_REQUIRE_WIN_HELPER === "1") throw new Error(message);
  console.warn(`${message} (install Go 1.21 or newer to build it)`);
  process.exit(0);
}

const child = Bun.spawn([go, "build", "-trimpath", "-ldflags", "-s -w", "-o", output, "."], {
  cwd: source,
  env: { ...process.env, GOOS: "windows", GOARCH: goArch, CGO_ENABLED: "0" },
  stdout: "inherit",
  stderr: "inherit",
});
if ((await child.exited) !== 0) throw new Error("dock-drag: go build failed");
console.log(`dock-drag: built ${output}`);

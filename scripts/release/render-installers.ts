// Writes the server installers that the landing site would otherwise serve, so a release can
// host them as plain assets:
//   curl -fsSL https://github.com/<repo>/releases/latest/download/install.sh | sh
//   irm https://github.com/<repo>/releases/latest/download/install.ps1 | iex
//
//   bun scripts/release/render-installers.ts <output-directory>
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { installScript, powerShellInstallScript } from "../../apps/landing/lib/install-script";

const output = process.argv[2];
if (!output) throw new Error("Usage: bun scripts/release/render-installers.ts <output-directory>");
await mkdir(resolve(output), { recursive: true });
await Bun.write(resolve(output, "install.sh"), installScript);
await Bun.write(resolve(output, "install.ps1"), powerShellInstallScript);
console.log(`Wrote install.sh and install.ps1 to ${resolve(output)}`);

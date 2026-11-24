import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { componentIds } from "./engine-assets";

const limaVersion = "2.1.4";
const limaInputs = {
  arm64: {
    runtime: {
      url: `https://github.com/lima-vm/lima/releases/download/v${limaVersion}/lima-${limaVersion}-Darwin-arm64.tar.gz`,
      sha256: "14c5b283f1c5eb4078e5a300b8d241f69197a3e41326dfc685a69c9455917acf",
    },
    guestagents: {
      url: `https://github.com/lima-vm/lima/releases/download/v${limaVersion}/lima-additional-guestagents-${limaVersion}-Darwin-arm64.tar.gz`,
      sha256: "475c9dbcda16ebbae239c57758c487d5c255aa13d9e6db437dae964d03f9414c",
    },
    image: {
      url: "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-arm64.img",
      sha256: "e429865ad84a083a84fdbd51bf6fd6e4174bbb1610ba0d72ca01014c656d45bc",
    },
  },
  x64: {
    runtime: {
      url: `https://github.com/lima-vm/lima/releases/download/v${limaVersion}/lima-${limaVersion}-Darwin-x86_64.tar.gz`,
      sha256: "57f319f2d2b3e781cdceaaf58efc0cae92e31ccc774fee988df438c3a22feb45",
    },
    guestagents: {
      url: `https://github.com/lima-vm/lima/releases/download/v${limaVersion}/lima-additional-guestagents-${limaVersion}-Darwin-x86_64.tar.gz`,
      sha256: "c36676c01551a4057bcd3586989fe068f9b408c6be3ae6e86cd8e95cc4032781",
    },
    image: {
      url: "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img",
      sha256: "77d19e53656f87c95f1f6c6be59c789083b3f77fa08f9d88011ee04085c61f87",
    },
  },
} as const;

const sha256 = async (path: string) => {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
};

const downloadVerified = async (url: string, expected: string, destination: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  await Bun.write(destination, await response.arrayBuffer());
  if (await sha256(destination) !== expected) throw new Error(`Unexpected SHA-256 for ${url}`);
};

const run = async (command: string[], cwd?: string) => {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`${command[0]} failed`);
};

const filesUnder = async (directory: string): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else result.push(path);
  }
  return result;
};

const signMachOFiles = async (directory: string, identity: string) => {
  const candidates = await filesUnder(directory);
  for (const path of candidates) {
    const file = Bun.spawnSync(["file", "-b", path]).stdout.toString();
    if (!file.includes("Mach-O")) continue;
    await run(["codesign", "--force", "--options", "runtime", "--timestamp", "--entitlements", entitlements, "--sign", identity, path]);
    await run(["codesign", "--verify", "--strict", path]);
  }
};

const archive = async (directory: string, destination: string) => {
  await run(["tar", "--uid", "0", "--gid", "0", "--uname", "root", "--gname", "wheel", "-czf", destination, "-C", directory, "."]);
  await chmod(destination, 0o600);
};

const [architecture, outputArgument] = process.argv.slice(2);
if (architecture !== "arm64" && architecture !== "x64") {
  throw new Error("Usage: bun build-macos-engine.ts <arm64|x64> <output-directory>");
}
if (!outputArgument) throw new Error("Usage: bun build-macos-engine.ts <arm64|x64> <output-directory>");
const identity = process.env.MACOS_SIGNING_IDENTITY?.trim();
if (!identity || identity === "-") throw new Error("MACOS_SIGNING_IDENTITY must name the Developer ID Application identity");
const entitlements = resolve("apps/cli/engine-assets/entitlements.engine.mac.plist");

const output = resolve(outputArgument);
const work = `${output}.work`;
const input = limaInputs[architecture];
const runtimeInput = join(work, "lima.tar.gz");
const guestagentsInput = join(work, "guestagents.tar.gz");
const imageInput = join(work, "ubuntu.img");
const runtimeDirectory = join(work, "runtime");
const components = JSON.parse(await readFile(resolve("apps/cli/engine-assets/macos-components.json"), "utf8"));

await rm(work, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
await mkdir(output, { recursive: true, mode: 0o700 });
await downloadVerified(input.runtime.url, input.runtime.sha256, runtimeInput);
await downloadVerified(input.guestagents.url, input.guestagents.sha256, guestagentsInput);
await downloadVerified(input.image.url, input.image.sha256, imageInput);
await run(["tar", "-xzf", runtimeInput, "-C", runtimeDirectory]);
await run(["tar", "-xzf", guestagentsInput, "-C", runtimeDirectory]);
await signMachOFiles(runtimeDirectory, identity);
await run(["codesign", "--verify", "--strict", join(runtimeDirectory, "bin", "limactl")]);

const runtimeAsset = join(output, `outcomego-engine-darwin-${architecture}.tar.gz`);
const imageAsset = join(output, `outcomego-engine-darwin-${architecture}.qcow2`);
await archive(runtimeDirectory, runtimeAsset);
await cp(imageInput, imageAsset);
await chmod(imageAsset, 0o600);
const checksums = [
  `${await sha256(runtimeAsset)}  ${runtimeAsset.split("/").pop()}`,
  `${await sha256(imageAsset)}  ${imageAsset.split("/").pop()}`,
];
await writeFile(join(output, "SHA256SUMS"), `${checksums.join("\n")}\n`);
await writeFile(join(output, "engine-components-macos.json"), `${JSON.stringify(components, null, 2)}\n`);
console.log(`Prepared signed macOS ${architecture} engine assets with ${componentIds(components).size} reviewed components.`);

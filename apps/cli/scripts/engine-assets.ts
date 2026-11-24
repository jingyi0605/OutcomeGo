import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const windowsAsset = "outcomego-engine-windows-x64.tar.gz";
export const engineAssetNames = [windowsAsset, ...["arm64", "x64"].flatMap(architecture => [
  `outcomego-engine-darwin-${architecture}.tar.gz`, `outcomego-engine-darwin-${architecture}.qcow2`,
])];
interface Component { name: string; version: string; license: string; source: string; notice: string }
interface EngineAssetInput { name: string; source: string; sha256: string; components: string[] }
interface EngineAssetManifest { assets: EngineAssetInput[]; components: unknown }

const slug = /^[\w.+-]+$/;
const version = /^[\w.:+~\-]+$/;
const digest = /^[0-9a-f]{64}$/;
const https = (value: string) => { try { return new URL(value).protocol === "https:"; } catch { return false; } };
export const componentIds = (inventory: unknown): Set<string> => {
  if (!Array.isArray(inventory)) throw new Error("Expected a component inventory array.");
  const ids = new Set<string>();
  for (const entry of inventory as Component[]) {
    if (!entry || ![entry.name, entry.version, entry.license, entry.source, entry.notice].every(value => typeof value === "string" && value.length > 0) ||
      !slug.test(entry.name) || !version.test(entry.version) || !https(entry.source) || /^(?:unknown|unverified|pending)$/i.test(entry.license))
      throw new Error("Each engine component needs a pinned version, license, source and notice.");
    const id = `${entry.name}@${entry.version}`;
    if (ids.has(id)) throw new Error(`Duplicate component: ${id}`);
    ids.add(id);
  }
  return ids;
};

export const verifyComponentReferences = (assets: readonly EngineAssetInput[], inventory: unknown) => {
  const available = componentIds(inventory);
  const referenced = new Set<string>();
  const assetsSeen = new Set<string>();
  for (const asset of assets) {
    if (!engineAssetNames.includes(asset.name) || assetsSeen.has(asset.name) || typeof asset.source !== "string" || !digest.test(asset.sha256) || !Array.isArray(asset.components) || !asset.components.length)
      throw new Error("Invalid, duplicate or unpinned engine asset.");
    assetsSeen.add(asset.name);
    for (const component of asset.components) {
      if (!available.has(component)) throw new Error(`Undeclared engine component: ${component}`);
      referenced.add(component);
    }
  }
  if (referenced.size !== available.size) throw new Error("The engine inventory contains unreferenced components.");
};

const readEngineNotices = (notices: string): Component[] => {
  const block = /^```engine-components-json\r?\n([\s\S]*?)^```\s*$/m.exec(notices)?.[1];
  if (!block) throw new Error("THIRD-PARTY-NOTICES has no engine inventory.");
  const declared = JSON.parse(block) as Component[];
  componentIds(declared);
  return declared;
};

export const verifyEngineNotices = (components: unknown, notices: string) => {
  componentIds(components);
  if (!Array.isArray(components) || !components.length) throw new Error("The staged engine inventory is empty.");
  const declared = readEngineNotices(notices);
  const entries = (list: Component[]) => list.map(({ name, version, license, source, notice }) => JSON.stringify([name, version, license, source, notice])).sort();
  if (JSON.stringify(entries(components)) !== JSON.stringify(entries(declared))) throw new Error("THIRD-PARTY-NOTICES differs from the staged engine inventory.");
};

export const verifyWindowsPackageInventory = (status: string, expected: readonly string[]) => {
  const installed = new Set<string>();
  for (const paragraph of status.trim().split(/\n\n+/)) {
    const fields = new Map([...paragraph.matchAll(/^([\w-]+): (.*)$/gm)].map(([, name, value]) => [name, value]));
    if (fields.get("Status") !== "install ok installed") continue;
    const architecture = fields.get("Architecture");
    const id = `${fields.get("Package")}@${fields.get("Version")}`;
    if (architecture !== "amd64" && architecture !== "all") throw new Error(`Unexpected package architecture: ${id} (${architecture})`);
    if (installed.has(id)) throw new Error(`Duplicate installed package: ${id}`);
    installed.add(id);
  }
  const declared = new Set(expected);
  const added = [...installed].filter(id => !declared.has(id)).sort();
  const missing = [...declared].filter(id => !installed.has(id)).sort();
  if (added.length || missing.length) throw new Error(`Windows package inventory differs. Unexpected: ${added.join(", ")}. Missing: ${missing.join(", ")}.`);
};

const sha256 = async (path: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

const checkedFile = async (path: string, expected: string) => {
  if (!(await lstat(path)).isFile() || await sha256(path) !== expected) throw new Error(`Unexpected SHA-256: ${basename(path)}`);
};

const buildWslRootfs = async (source: string, destination: string, packages: readonly string[]) => {
  const directory = await mkdtemp(join(tmpdir(), "outcomego-rootfs-"));
  const root = join(directory, "root");
  const run = async (command: string[]) => {
    const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    if (await child.exited !== 0) throw new Error(`${command[0]} failed.`);
  };
  try {
    if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("Build WSL rootfs inside an isolated Linux builder that preserves numeric ownership.");
    await mkdir(root, { mode: 0o700 });
    await run(["tar", "--numeric-owner", "--same-owner", "-xf", source, "-C", root]);
    await chmod(root, 0o755);
    verifyWindowsPackageInventory(await readFile(join(root, "var/lib/dpkg/status"), "utf8"), packages);
    for (const path of ["etc", "etc/systemd", "etc/systemd/system"]) if (!(await lstat(join(root, path))).isDirectory()) throw new Error(`Missing rootfs directory: ${path}`);
    for (const path of ["usr/bin/docker", "usr/sbin/dockerd", "usr/libexec/docker/cli-plugins/docker-compose", "usr/bin/systemctl", "usr/bin/flock", "bin/sleep"])
      if (!(await lstat(join(root, path))).isFile()) throw new Error(`Missing rootfs executable: ${path}`);
    if (!(await lstat(join(root, "usr/bin/tar"))).isFile()) throw new Error("Missing rootfs executable: usr/bin/tar");
    for (const path of [
      "etc/hostname", "etc/resolv.conf", "etc/wsl.conf", "etc/systemd/system/docker.service",
      "etc/systemd/system/multi-user.target.wants/docker.service", "etc/systemd/system/multi-user.target.wants/containerd.service",
      "etc/systemd/system/sockets.target.wants/docker.socket",
    ])
      await rm(join(root, path), { force: true });
    await writeFile(join(root, "etc/wsl.conf"), "[boot]\nsystemd=true\n[automount]\nroot=/mnt/\n[interop]\nenabled=false\nappendWindowsPath=false\n", { mode: 0o644 });
    await writeFile(join(root, "etc/systemd/system/docker.service"), "[Unit]\nDescription=OutcomeGo container engine\nAfter=network.target\n[Service]\nExecStart=/usr/sbin/dockerd --host=unix:///var/run/docker.sock --config-file=/etc/outcomego-dockerd.json\nRestart=on-failure\nDelegate=yes\n", { mode: 0o644 });
    await writeFile(join(root, "etc/outcomego-dockerd.json"), "{}\n", { flag: "wx", mode: 0o644 });
    const tar = join(directory, "rootfs.tar");
    await run(["tar", "--sort=name", "--format=gnu", "--mtime=@0", "--numeric-owner", "-cf", tar, "-C", root, "."]);
    await run(["gzip", "-n", tar]);
    await copyFile(`${tar}.gz`, destination);
  } finally { await rm(directory, { recursive: true, force: true }); }
};

const stagePinnedAssets = async (manifest: EngineAssetManifest, output: string, buildRootfs = buildWslRootfs) => {
  if (!Array.isArray(manifest?.assets) || !manifest.assets.length) throw new Error("Supply candidate assets with pinned checksums.");
  verifyComponentReferences(manifest.assets, manifest.components);
  for (const asset of manifest.assets) await checkedFile(resolve(asset.source), asset.sha256);
  await mkdir(output, { mode: 0o700 });
  const checksums: string[] = [];
  for (const asset of [...manifest.assets].sort((left, right) => left.name.localeCompare(right.name))) {
    const destination = join(output, asset.name);
    if (asset.name === windowsAsset) await buildRootfs(resolve(asset.source), destination, asset.components);
    else await copyFile(resolve(asset.source), destination);
    checksums.push(`${await sha256(destination)}  ${asset.name}`);
  }
  await writeFile(join(output, "SHA256SUMS"), `${checksums.join("\n")}\n`);
  await writeFile(join(output, "engine-components.json"), `${JSON.stringify(manifest.components, null, 2)}\n`);
};

export const stageEngineAssets = async (manifestFile: string, output: string, buildRootfs = buildWslRootfs) =>
  stagePinnedAssets(JSON.parse(await readFile(manifestFile, "utf8")) as EngineAssetManifest, output, buildRootfs);

if (import.meta.main) {
  const [input, output, windowsOutput] = process.argv.slice(2);
  if (input === "--windows-rootfs" && output && windowsOutput) {
    const source = resolve(output);
    const components = readEngineNotices(await readFile("THIRD-PARTY-NOTICES", "utf8"));
    await stagePinnedAssets({
      assets: [{ name: windowsAsset, source, sha256: await sha256(source), components: [...componentIds(components)] }],
      components,
    }, windowsOutput);
  } else if (input && output && !windowsOutput) {
    await stageEngineAssets(input, output);
  } else {
    throw new Error("Usage: bun engine-assets.ts <pinned-input.json> <new-output-directory> | --windows-rootfs <rootfs.tar> <new-output-directory>");
  }
  console.log("Candidate engine assets staged without signing or publication.");
}

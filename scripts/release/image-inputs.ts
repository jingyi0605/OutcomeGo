import { createHash } from "node:crypto";
import { readFileSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export type ReleaseImage = "server" | "worker" | "migrate" | "computer" | "computer-base";
interface WorkspaceLock { workspaces: Record<string, Record<string, unknown>> }
const images: ReleaseImage[] = ["server", "worker", "migrate", "computer", "computer-base"];

// Fail closed when COPY syntax grows beyond the repository's simple source paths.
// Stage copies are already covered by the Dockerfile and their original inputs.
export const copySources = (dockerfile: string): string[] => {
  const sources: string[] = [];
  for (const line of dockerfile.split("\n")) {
    if (!/^(COPY|ADD)\s/i.test(line) || /\s--from=/.test(line)) continue;
    const fields = line.trim().split(/\s+/).slice(1).filter((field) => !field.startsWith("--"));
    if (fields.length < 2 || fields.some((field) => /[\[\]"*?\\$]/.test(field))) {
      throw new Error(`Unsupported Docker COPY syntax: ${line}`);
    }
    sources.push(...fields.slice(0, -1).map((path) => path.replace(/^\.\//, "").replace(/\/$/, "")));
  }
  return [...new Set(sources)].sort();
};

const normalizedContent = (path: string, content: Buffer, versionManifests: Set<string>): Buffer | string => {
  if (versionManifests.size === 0) return content;
  if (versionManifests.has(path)) {
    const manifest = JSON.parse(content.toString());
    delete manifest.version;
    return JSON.stringify(manifest);
  }
  if (path === "bun.lock") {
    const lock = Bun.JSONC.parse(content.toString()) as WorkspaceLock;
    for (const workspace of Object.values(lock.workspaces ?? {}) as Record<string, unknown>[]) {
      delete workspace.version;
    }
    return JSON.stringify(lock);
  }
  return content;
};

const baseRecipe = (dockerfile: string): string => {
  const stages = dockerfile.split(/(?=^FROM )/m).flatMap((recipe) => {
    const name = recipe.match(/^FROM .* AS ([\w-]+)\s*$/m)?.[1];
    return name ? [{ name, recipe }] : [];
  });
  const selected = new Set<string>();
  const visit = (name: string) => {
    const stage = stages.find((stage) => stage.name === name);
    if (!stage || selected.has(name)) return;
    selected.add(name);
    for (const reference of stage.recipe.matchAll(/(?:^FROM(?: --platform=\S+)?\s+|\s--from=)([\w-]+)(?:\s|$)/gm)) {
      visit(reference[1]!);
    }
  };
  visit("computer-base");
  if (selected.size === 0) throw new Error("Missing computer-base stage");
  const header = dockerfile.slice(0, dockerfile.indexOf("FROM "));
  return [header, ...stages.filter((stage) => selected.has(stage.name)).map((stage) => stage.recipe)].join("\n");
};

export function imageInputs(image: ReleaseImage, root = process.cwd()): string {
  if (!images.includes(image)) throw new Error(`Unknown image: ${image}`);
  const path = image.startsWith("computer") ? "docker/computer.Dockerfile" : "docker/app.Dockerfile";
  const dockerfile = readFileSync(join(root, path), "utf8");
  const recipe = image === "computer-base" ? baseRecipe(dockerfile) : dockerfile;
  const sources = copySources(recipe);
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  const selected = new Set(files.filter((file) => sources.some((source) => file === source || file.startsWith(`${source}/`))));
  for (const source of sources) {
    if (![...selected].some((file) => file === source || file.startsWith(`${source}/`))) {
      throw new Error(`No files found for Docker COPY source: ${source}`);
    }
  }
  selected.add(".dockerignore");
  if (image !== "computer-base") {
    selected.add("scripts/release/image-inputs.ts");
    selected.add(".github/workflows/release.yml");
  }
  // Only the server/worker final images contain bundles without workspace manifests.
  // Their release version comes from Compose, not package.json. Computer and migrate
  // ship manifests, so even metadata-only version changes conservatively rebuild them.
  const versionManifests = new Set<string>();
  if (image === "server" || image === "worker") {
    const lock = Bun.JSONC.parse(readFileSync(join(root, "bun.lock"), "utf8")) as WorkspaceLock;
    versionManifests.add("package.json");
    for (const workspace of Object.keys(lock.workspaces)) {
      versionManifests.add(workspace ? `${workspace}/package.json` : "package.json");
    }
  }
  const hash = createHash("sha256").update(`outcomego-image-inputs-v1\0${image}\0${recipe}\0`);
  for (const file of [...selected].sort()) {
    const path = join(root, file);
    const stat = lstatSync(path);
    const content = stat.isSymbolicLink()
      ? readlinkSync(path)
      : normalizedContent(file, readFileSync(path), versionManifests);
    const bytes = Buffer.from(content);
    const mode = stat.isSymbolicLink() ? "symlink" : stat.mode & 0o111 ? "executable" : "file";
    hash.update(`${file}\0${mode}\0${bytes.length}\0`).update(bytes).update("\0");
  }
  return hash.digest("hex");
}

if (import.meta.main) {
  const image = process.argv[2] as ReleaseImage;
  if (!images.includes(image)) throw new Error(`Usage: bun scripts/release/image-inputs.ts <${images.join("|")}>`);
  console.log(imageInputs(image));
}

// Single release version for every artifact (server, images, CLI, desktop, Android, iOS).
//
//   bun scripts/release/version.ts check [--tag v0.1.0-beta.1]
//   bun scripts/release/version.ts set <version>
//
// The root package.json is the source of truth. `check` fails when any workspace package,
// the bun.lock workspace entries or the iOS release.json disagree with it. Android reads the
// root package.json directly (apps/android/app/build.gradle.kts), so it cannot drift.
import { Glob } from "bun";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACKAGE_VERSION = /("version"\s*:\s*")([^"]+)(")/;
const LOCK_VERSION = /^( {6}"version": ")([^"]+)(",)$/gm;

const packageFiles = (): string[] => {
  const files = ["package.json"];
  for (const pattern of ["apps/*/package.json", "packages/*/package.json"]) {
    for (const file of new Glob(pattern).scanSync({ cwd: root })) files.push(file);
  }
  return files.sort();
};

const read = (file: string) => Bun.file(resolve(root, file)).text();
const write = (file: string, contents: string) => Bun.write(resolve(root, file), contents);
// iOS marketing versions cannot carry a prerelease suffix; the build number carries it instead.
const baseVersion = (version: string) => version.split("-")[0] ?? version;

const rootVersion = async (): Promise<string> => {
  const version = (JSON.parse(await read("package.json")) as { version?: string }).version;
  if (!version || !SEMVER.test(version)) throw new Error(`Invalid root version: ${version}`);
  return version;
};

const check = async (tag: string | undefined) => {
  const version = await rootVersion();
  const problems: string[] = [];
  if (tag && tag !== `v${version}`) problems.push(`tag ${tag} does not match version v${version}`);
  for (const file of packageFiles()) {
    const actual = (JSON.parse(await read(file)) as { version?: string }).version;
    if (actual !== version) problems.push(`${file} is ${actual ?? "missing"}, expected ${version}`);
  }
  const lock = await read("bun.lock");
  const lockVersions = [...lock.matchAll(LOCK_VERSION)].map((match) => match[2]);
  const expectedLockEntries = packageFiles().length - 1;
  if (lockVersions.length !== expectedLockEntries)
    problems.push(`bun.lock has ${lockVersions.length} workspace versions, expected ${expectedLockEntries}`);
  for (const actual of new Set(lockVersions))
    if (actual !== version) problems.push(`bun.lock workspace version ${actual}, expected ${version}`);
  const ios = JSON.parse(await read("apps/ios/release.json")) as { version?: string };
  if (ios.version !== baseVersion(version))
    problems.push(`apps/ios/release.json is ${ios.version}, expected ${baseVersion(version)}`);
  if (problems.length) {
    console.error(`Version check failed:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`All versions agree: ${version}${tag ? ` (tag ${tag})` : ""}`);
};

const set = async (version: string | undefined) => {
  if (!version || !SEMVER.test(version)) throw new Error("Usage: version.ts set <major.minor.patch[-prerelease]>");
  for (const file of packageFiles()) {
    const contents = await read(file);
    if (!PACKAGE_VERSION.test(contents)) throw new Error(`${file} has no version field`);
    await write(file, contents.replace(PACKAGE_VERSION, `$1${version}$3`));
  }
  await write("bun.lock", (await read("bun.lock")).replace(LOCK_VERSION, `$1${version}$3`));
  const ios = await read("apps/ios/release.json");
  await write("apps/ios/release.json", ios.replace(PACKAGE_VERSION, `$1${baseVersion(version)}$3`));
  console.log(`Set ${version}. Now run: python3 apps/ios/scripts/generate-project.py`);
};

const [command, ...rest] = process.argv.slice(2);
if (command === "check") {
  const tagIndex = rest.indexOf("--tag");
  await check(tagIndex >= 0 ? rest[tagIndex + 1] : undefined);
} else if (command === "set") {
  await set(rest[0]);
} else {
  console.error("Usage: bun scripts/release/version.ts <check [--tag vX] | set <version>>");
  process.exit(2);
}

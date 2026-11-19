import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";

const roots = ["apps/worker/test", "apps/server/test", "packages/messaging/test", "packages/db/test", "apps/computer/test"];
const legacyRead = "process.env.OPENTEAM_TEST_DATABASE_URL";
const fallback = "(process.env.OUTCOMEGO_TEST_DATABASE_URL ?? process.env.OPENTEAM_TEST_DATABASE_URL)";
const repositoryRoot = resolve(import.meta.dir, "../..");

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(resolve(directory, entry.name))
    : Promise.resolve(entry.name.endsWith(".ts") ? [resolve(directory, entry.name)] : [])))).flat();
}

/** Audit source gates without importing any test, starting a service or opening a database. */
export async function checkTestDatabaseGates(root = repositoryRoot) {
  const checked: string[] = [];
  const failures: string[] = [];
  for (const directory of roots) {
    for (const path of await files(resolve(root, directory))) {
      const source = await readFile(path, "utf8");
      if (!source.includes(legacyRead)) continue;
      checked.push(relative(root, path));
      if (source.replaceAll(fallback, "").includes(legacyRead)) failures.push(relative(root, path));
    }
  }
  return { status: failures.length ? "FAIL" : "PASS", files: checked.sort(), failures, databaseExecution: "PENDING" };
}

if (import.meta.main) {
  const result = await checkTestDatabaseGates();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "PASS" ? 0 : 1;
}

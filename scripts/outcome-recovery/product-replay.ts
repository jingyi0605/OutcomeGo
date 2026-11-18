import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { disposableDatabaseUrl } from "./report";

/** This entry records local service proof, never a real Bot or native UI replay. */
export async function main(args = process.argv.slice(2)): Promise<number> {
  const [scenario, output, ...extra] = args;
  if ((scenario !== "research" && scenario !== "human") || !output || extra.length)
    throw new Error("usage: product-replay.ts research|human output.json");
  disposableDatabaseUrl(process.env);
  const { runProductReplay } = await import("../../apps/server/test/fixtures/outcome-recovery/product-replay");
  const report = await runProductReplay(scenario, async result => {
    const path = resolve(output);
    await mkdir(dirname(path), { recursive: true });
    // An existing report is evidence; retries must use a fresh filename.
    await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  });
  console.log(JSON.stringify({
    scenario, status: report.status, output: resolve(output), ids: report.ids,
    databaseIsolation: report.databaseIsolation,
    checks: report.checks.length, realBotReplay: report.realBotReplay, nativeUIReplay: report.nativeUIReplay,
  }));
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = await main(); }
  catch {
    console.error(JSON.stringify({ status: "FAIL", code: "local_product_replay_failed", realBotReplay: "PENDING" }));
    process.exitCode = 1;
  }
}

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { RECOVERY_SCENARIOS } from "./check-outcome-contracts";
import { disposableDatabaseUrl, parseArguments, validateReport } from "./outcome-recovery/report";

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.list) {
    console.log(JSON.stringify({ scenarios: RECOVERY_SCENARIOS, runtimeReplay: "PENDING" }, null, 2));
    return 0;
  }
  if (options.plan) {
    console.log(JSON.stringify({
      scenario: options.scenario, status: "PENDING", executed: false,
      database: "explicit local disposable PostgreSQL on port 55437",
      requiredSources: ["Outcome recovery", "Decision builder", "Human receipt service"],
    }, null, 2));
    return 0;
  }
  disposableDatabaseUrl(process.env);
  // Delay product imports until execution so --list/--plan require no installed services.
  const { runScenario } = await import("./outcome-recovery/scenarios");
  const report = await runScenario(options.scenario!, async result => {
    validateReport(result);
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) {
      const path = resolve(options.output);
      await mkdir(dirname(path), { recursive: true });
      // Keep historical evidence: a second invocation needs a fresh report filename.
      await writeFile(path, json, { flag: "wx" });
    }
    console.log(json.trimEnd());
  });
  return report.status === "PASS" ? 0 : 1;
}

if (import.meta.main) {
  try { process.exitCode = await main(); }
  catch {
    // Error objects may include SQL, connection strings or private request payloads.
    console.error(JSON.stringify({ status: "FAIL", code: "recovery_replay_failed", runtimeReplay: "INCOMPLETE" }));
    process.exitCode = 1;
  }
}

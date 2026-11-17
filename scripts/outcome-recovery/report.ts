import { RECOVERY_SCENARIOS } from "../check-outcome-contracts";

export type RecoveryScenario = typeof RECOVERY_SCENARIOS[number];
export interface RecoveryReport {
  scenario: RecoveryScenario;
  status: "PASS" | "FAIL";
  initialState: Record<string, unknown>;
  injectedEventId: string;
  replayed: number;
  finalState: Record<string, unknown>;
  outputCount: number;
  decisionCount: number;
  evidence: {
    fixtureBotId: string;
    outcomeId: string;
    workItemId: string;
    checks: Array<{ name: string; passed: boolean }>;
    observations: Record<string, unknown>;
    execution: "local-disposable-database";
    remoteReplay: "PENDING";
  };
}

export function parseArguments(args: string[]) {
  let scenario: RecoveryScenario | undefined;
  let output: string | undefined;
  let list = false;
  let plan = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--list") list = true;
    else if (flag === "--plan") plan = true;
    else if (flag === "--scenario" || flag === "--output") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("missing_argument");
      if (flag === "--scenario") {
        if (!RECOVERY_SCENARIOS.includes(value as RecoveryScenario)) throw new Error("unknown_scenario");
        scenario = value as RecoveryScenario;
      } else output = value;
    } else throw new Error("unknown_argument");
  }
  if (!list && !scenario) throw new Error("scenario_required");
  return { scenario, output, list, plan };
}

/** Never inherit a development or production connection from DATABASE_URL. */
export function disposableDatabaseUrl(environment: Record<string, string | undefined>) {
  const value = environment.OUTCOMEGO_TEST_DATABASE_URL;
  if (!value) throw new Error("test_database_url_required");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("invalid_test_database_url"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "55437")
    throw new Error("expected_disposable_postgres_on_port_55437");
  return value;
}

/** Reports contain identifiers and bounded checks, never business text or raw errors. */
export function validateReport(report: RecoveryReport) {
  if (!RECOVERY_SCENARIOS.includes(report.scenario) ||
    !report.injectedEventId || !Number.isInteger(report.replayed) || report.replayed < 0 ||
    !Number.isInteger(report.outputCount) || report.outputCount < 0 ||
    !Number.isInteger(report.decisionCount) || report.decisionCount < 0 ||
    !report.evidence.checks.length)
    throw new Error("invalid_recovery_report");
  const passed = report.evidence.checks.every(check => check.passed);
  if ((report.status === "PASS") !== passed) throw new Error("report_status_mismatch");
  if (report.status === "PASS" && report.replayed < 1) throw new Error("replay_evidence_required");
  return report;
}

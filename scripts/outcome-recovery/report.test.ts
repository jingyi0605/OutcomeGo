import { describe, expect, test } from "bun:test";
import { RECOVERY_SCENARIOS } from "../check-outcome-contracts";
import { disposableDatabaseUrl, parseArguments, validateReport, type RecoveryReport } from "./report";

describe("Recovery replay invocation and evidence boundaries", () => {
  test("requires a known scenario and supports a nonexecuting plan", () => {
    for (const scenario of RECOVERY_SCENARIOS)
      expect(parseArguments(["--scenario", scenario, "--plan"])).toMatchObject({ scenario, plan: true });
    expect(() => parseArguments([])).toThrow("scenario_required");
    expect(() => parseArguments(["--scenario", "invented"])).toThrow("unknown_scenario");
    expect(() => parseArguments(["--output"])).toThrow("missing_argument");
    expect(() => parseArguments(["--force"])).toThrow("unknown_argument");
  });
  test("never falls back to DATABASE_URL or permits remote/default-port databases", () => {
    expect(() => disposableDatabaseUrl({ DATABASE_URL: "postgresql://localhost:5432/dev" })).toThrow("test_database_url_required");
    for (const value of ["postgresql://example.test:55437/test", "postgresql://localhost:5432/test", "file:///tmp/test"])
      expect(() => disposableDatabaseUrl({ OUTCOMEGO_TEST_DATABASE_URL: value })).toThrow("expected_disposable");
    expect(disposableDatabaseUrl({ OUTCOMEGO_TEST_DATABASE_URL: "postgresql://127.0.0.1:55437/fixture" })).toBe("postgresql://127.0.0.1:55437/fixture");
  });
  test("failed or absent database checks cannot be reported as PASS", () => {
    const report: RecoveryReport = {
      scenario: "receipt-retry", status: "PASS", initialState: { status: "in_progress" },
      injectedEventId: "fictional-failure", replayed: 2, finalState: { status: "submitted" }, outputCount: 0, decisionCount: 0,
      evidence: { fixtureBotId: "fictional-bot", outcomeId: "fictional-outcome", workItemId: "fictional-item",
        checks: [{ name: "database_receipt_count", passed: false }], observations: {},
        execution: "local-disposable-database", remoteReplay: "PENDING" },
    };
    expect(() => validateReport(report)).toThrow("report_status_mismatch");
    expect(validateReport({ ...report, status: "FAIL" }).status).toBe("FAIL");
    expect(() => validateReport({ ...report, evidence: { ...report.evidence, checks: [] } })).toThrow("invalid_recovery_report");
  });
});

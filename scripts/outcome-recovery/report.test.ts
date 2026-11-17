import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  test("requires an explicit local test database and preserves configured CI/replay ports", () => {
    expect(() => disposableDatabaseUrl({ DATABASE_URL: "postgresql://localhost:5432/dev" })).toThrow("test_database_url_required");
    for (const value of ["postgresql://production.example:5432/production", "file:///tmp/test"])
      expect(() => disposableDatabaseUrl({ OUTCOMEGO_TEST_DATABASE_URL: value })).toThrow("expected_explicit_local_test_postgres");
    for (const port of [5432, 55437, 55439]) {
      const value = `postgresql://127.0.0.1:${port}/fixture`;
      expect(disposableDatabaseUrl({ OUTCOMEGO_TEST_DATABASE_URL: value })).toBe(value);
    }
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
  test("database fixture and restart children use the configured test URL without a port override", async () => {
    for (const file of ["fixture.ts", "restart-process.ts", "recovery-process.ts"]) {
      const source = await readFile(resolve(import.meta.dir, "../../apps/server/test/fixtures/outcome-recovery", file), "utf8");
      expect(source).toContain("disposableDatabaseUrl(process.env)");
      expect(source).not.toContain("55437");
      expect(source).not.toContain("process.env.DATABASE_URL");
    }
  });
});

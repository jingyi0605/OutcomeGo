import { describe, expect, test } from "bun:test";
import { RECOVERY_SCENARIOS } from "../check-outcome-contracts";
import { validateReport } from "./report";

describe.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("Six real transactional recovery replays", () => {
  for (const scenario of RECOVERY_SCENARIOS) {
    test(scenario, async () => {
      const { runScenario } = await import("./scenarios");
      const report = validateReport(await runScenario(scenario));
      expect(report.evidence.checks.filter(check => !check.passed)).toEqual([]);
      expect(report.status).toBe("PASS");
      expect(report.evidence.remoteReplay).toBe("PENDING");
    }, 60_000);
  }
});

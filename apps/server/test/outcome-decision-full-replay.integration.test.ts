import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { runDecisionReplay } from "./fixtures/outcome-decision-replay";

describe.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("local Decision tool / inbox / API replay", () => {
  test("records the actual public choice and same-context continuation without claiming native clients", async () => {
    const output = process.env.OUTCOMEGO_DECISION_REPLAY_REPORT;
    const report = await runDecisionReplay(output ? async result => {
      await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    } : undefined);
    expect(report.status).toBe("PASS");
    expect(report.checks.length).toBeGreaterThanOrEqual(15);
    expect(report.checks.every(check => check.passed)).toBe(true);
    expect(report.realBotReplay).toBe("PENDING");
    expect(report.nativeClientsReplay).toBe("PENDING");
    expect(report.networkServerStarted).toBe(false);
    expect(report.contexts[1]?.contextSessionId).toBe(report.contexts[0]?.contextSessionId);
    expect(report.ids.rootRunId).not.toBe(report.ids.continuationRunId);
    expect(report.requests.some(step => step.operation === "RequestOutcomeDecision / trusted persisted context")).toBe(true);
    expect(report.requests.filter(step => step.operation === `POST /api/decisions/${report.ids.decisionId}/resolve`)).toHaveLength(3);
    expect(report.detail.outputs[0]?.runId).toBe(report.ids.continuationRunId);
    expect(report.transcript.total).toBeGreaterThan(0);
  }, 60_000);
});

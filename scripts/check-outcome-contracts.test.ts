import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkOutcomeContracts, repositoryRoot, validateParentFixture } from "./check-outcome-contracts";

const original = JSON.parse(await readFile(resolve(repositoryRoot, "specs/004-OutcomeGo整体项目/docs/fixtures/research-outcome.json"), "utf8"));
const states = { outcome: ["pending_approval", "approved", "running", "review_pending", "accepted"], agent: ["queued", "running", "completed"] };

test("parent fixtures and persisted contracts agree without claiming replay success", async () => {
  const result = await checkOutcomeContracts();
  expect(result.fixtureIds).toHaveLength(6);
  expect(result.topicCount).toBe(16);
  expect(result.occurrences.length).toBeGreaterThan(0);
  expect(result.runtimeReplay).toBe("PENDING");
});
test.each([
  ["unknown state", (fixture: any) => { fixture.expectedStates[0].values.push("Succeeded"); }],
  ["missing ID lineage", (fixture: any) => { fixture.idRelations = []; }],
  ["unsafe cleanup", (fixture: any) => { fixture.cleanup.scope = "all-bots"; }],
  ["credential field", (fixture: any) => { fixture.input.token = "fixture-does-not-need-credentials"; }],
  ["invented notification", (fixture: any) => { fixture.notificationCategories.push("progress"); }],
])("fixed fixture rejects %s", (_name, mutate) => {
  const fixture = structuredClone(original);
  mutate(fixture);
  expect(() => validateParentFixture(fixture, "research-outcome", states)).toThrow();
});

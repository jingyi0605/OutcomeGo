import { expect, test } from "bun:test";
import before from "./fixtures/outcome-prompt-before.json";
import { promptFixture } from "./fixtures/outcome-prompt";

test("ordinary platform prompt exactly matches the pre-runtime baseline", async () => {
  expect(await promptFixture("home")).toEqual(before.home);
});
test("Routine platform prompt exactly matches the pre-runtime baseline", async () => {
  expect(await promptFixture("automation")).toEqual(before.automation);
});
test("Outcome approved snapshot is hidden ambient context, isolated from the main prompt", async () => {
  const prompt = await promptFixture("outcome");
  expect(prompt.ambientContext).toContain("Approved goal");
  expect(prompt.ambientContext).toContain("Cite sources");
  expect(prompt.ambientContext).toContain("Production changes");
  expect(prompt.ambientContext).toContain("outcomes/outcome/work-item/");
  expect(prompt.instructions).not.toContain("Approved goal");
  expect(prompt.instructions).not.toContain("Track it with ReportRequestProgress");
  expect(prompt.acknowledgement.outcomeIds).toEqual([]);
  expect((await promptFixture("home")).ambientContext).toBeNull();
});

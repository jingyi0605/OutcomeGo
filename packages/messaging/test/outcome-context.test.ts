import { expect, test } from "bun:test";
import before from "./fixtures/outcome-prompt-before.json";
import { promptFixture } from "./fixtures/outcome-prompt";

const onceGuidance = "For a one-time arrangement, use a standalone trigger with a future runAt. Even for a reminder, schedule private read-only preparation when relevant authorized records can help, and deliver useful facts and questions at runAt via the parent handoff. Deliver the reminder on time even if preparation fails. Clarify ambiguous times.";

test("ordinary platform prompt adds only the one-time arrangement guidance to the pre-runtime baseline", async () => {
  const { instructions, ...rest } = await promptFixture("home");
  expect(instructions).toContain(onceGuidance);
  expect({ ...rest, instructions: instructions.replace(`${onceGuidance}\n`, "") }).toEqual({ ...before.home, outcomesEnabled: false });
});
test("Routine platform prompt adds only the one-time arrangement guidance to the pre-runtime baseline", async () => {
  const { instructions, ...rest } = await promptFixture("automation");
  expect(instructions).toContain(onceGuidance);
  expect({ ...rest, instructions: instructions.replace(`${onceGuidance}\n`, "") }).toEqual({ ...before.automation, outcomesEnabled: false });
});
test("Outcome approved snapshot is hidden ambient context, isolated from the main prompt", async () => {
  const prompt = await promptFixture("outcome", true);
  expect(prompt.ambientContext).toContain("Approved goal");
  expect(prompt.ambientContext).toContain("Cite sources");
  expect(prompt.ambientContext).toContain("Production changes");
  expect(prompt.ambientContext).toContain("outcomes/outcome/work-item/");
  expect(prompt.instructions).not.toContain("Approved goal");
  expect(prompt.instructions).not.toContain("Track it with ReportRequestProgress");
  expect(prompt.acknowledgement.outcomeIds).toEqual([]);
  expect((await promptFixture("home")).ambientContext).toBeNull();
});

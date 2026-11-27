import { expect, test } from "bun:test";
import before from "./fixtures/outcome-prompt-before.json";
import { promptFixture } from "./fixtures/outcome-prompt";

const onceGuidance = "For a one-time arrangement, do not save a routine: one-time triggers and fixed-date schedules are rejected. Use CreateOutcome with kind=scheduled_once, a future scheduledAt and the instruction in description. Even for a reminder, set an earlier prepareAt and prepareInstruction when relevant authorized records can help; preparation is private and read-only, and the result is delivered at scheduledAt via the parent handoff even if preparation fails. If CreateOutcome is not available in this turn, say it cannot be scheduled here (goal management may be off). Clarify ambiguous times.";

const normalizeUnrelatedPromptChanges = (value: string) =>
  value
    .replace(/- Drafting an email[\s\S]*?- An ask covers exactly what it names:/g, "- MAIL_DRAFT_RULE\n- An ask covers exactly what it names:")
    .replace(/- Email or messages to anyone but the user[^\n]*/g, "- MAIL_SAFETY_RULE");

test("ordinary platform prompt adds only the one-time arrangement guidance to the pre-runtime baseline", async () => {
  const { instructions, ...rest } = await promptFixture("home");
  expect(instructions).toContain(onceGuidance);
  expect({
    ...rest,
    instructions: normalizeUnrelatedPromptChanges(instructions.replace(`${onceGuidance}\n`, "")),
  }).toEqual({
    ...before.home,
    outcomesEnabled: false,
    instructions: normalizeUnrelatedPromptChanges(before.home.instructions),
  });
});
test("Routine platform prompt adds only the one-time arrangement guidance to the pre-runtime baseline", async () => {
  const { instructions, ...rest } = await promptFixture("automation");
  expect(instructions).toContain(onceGuidance);
  expect({
    ...rest,
    instructions: normalizeUnrelatedPromptChanges(instructions.replace(`${onceGuidance}\n`, "")),
  }).toEqual({
    ...before.automation,
    outcomesEnabled: false,
    instructions: normalizeUnrelatedPromptChanges(before.automation.instructions),
  });
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
